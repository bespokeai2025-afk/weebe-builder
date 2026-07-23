/**
 * WATI Inbound Webhook
 *
 * Receives message + delivery events from WATI.
 * Links inbound messages to leads by phone number.
 *
 * Configure in WATI:
 *   https://<domain>/api/webhook/wati-inbound?workspace=<workspace_id>
 *
 * Always returns HTTP 200 so WATI stops retrying (except invalid JSON).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  attachLeadToInboundMessage,
  isWatiStatusEvent,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp/wati-campaign.server";
import {
  applyWatiMessageStatusToRow,
  extractWatiWebhookPhone,
  findOutboundMessageForWatiStatus,
  isWatiTemplateSentEvent,
  linkOutboundMessageToWatiLocalId,
  mapWatiStatusString,
} from "@/lib/whatsapp/wati-message-status.server";
import {
  isWatiTemplateLifecycleEvent,
  watiTemplatePatchFromWebhook,
} from "@/lib/whatsapp/wati-template-status.shared";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function adminClient() {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on server — webhook cannot write to DB.",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function mapWatiDeliveryStatus(payload: Record<string, unknown>): string | null {
  return mapWatiStatusString(
    payload.statusString ??
      payload.status ??
      payload.messageStatus ??
      payload.deliveryStatus ??
      payload.eventType ??
      payload.type,
  );
}

/** WATI status webhooks key off localMessageId — never use payload.id (that is the event id). */
function extractStatusTrackingId(payload: Record<string, unknown>): string | null {
  const id =
    payload.localMessageId ??
    payload.local_message_id ??
    payload.whatsappMessageId ??
    payload.wamid ??
    payload.messageId;
  return id ? String(id) : null;
}

function extractExternalId(payload: Record<string, unknown>): string | null {
  return extractStatusTrackingId(payload);
}

async function applyMessageStatusUpdate(
  sb: ReturnType<typeof adminClient>,
  workspaceId: string,
  trackingId: string,
  status: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const phone = extractWatiWebhookPhone(payload);
  const row = await findOutboundMessageForWatiStatus(
    workspaceId,
    trackingId || null,
    phone,
  );

  if (!row) {
    console.warn("[WATI WEBHOOK] Status event — no matching message", {
      trackingId,
      phone,
      eventType: payload.eventType,
      status,
    });
    return;
  }

  const applied = await applyWatiMessageStatusToRow({
    workspaceId,
    messageId: row.id,
    currentStatus: row.status,
    newStatus: status,
    campaignId: row.campaign_id,
  });

  if (!applied) return;
}

function normalizeWatiEvent(payload: Record<string, unknown>): {
  message: {
    contact_phone: string;
    contact_name: string | null;
    body: string;
    direction: "inbound" | "outbound";
    external_id: string | null;
  } | null;
} {
  const phone =
    payload.waId ??
    payload.phone ??
    payload.from ??
    (payload.contact as Record<string, unknown> | undefined)?.phone ??
    null;

  if (!phone) return { message: null };

  const body =
    (payload.text as Record<string, unknown> | undefined)?.body ??
    (payload.message as Record<string, unknown> | undefined)?.text ??
    payload.text ??
    payload.caption ??
    "[Non-text message]";

  const name =
    payload.senderName ??
    (payload.contact as Record<string, unknown> | undefined)?.name ??
    (payload.profile as Record<string, unknown> | undefined)?.name ??
    null;

  const directionRaw = String(payload.direction ?? payload.type ?? "").toLowerCase();
  const direction: "inbound" | "outbound" =
    directionRaw.includes("outbound") || directionRaw.includes("sent_by_business")
      ? "outbound"
      : "inbound";

  return {
    message: {
      contact_phone: normalizeWhatsAppPhone(String(phone)),
      contact_name: name ? String(name) : null,
      body: typeof body === "string" ? body : JSON.stringify(body),
      direction,
      external_id: extractExternalId(payload),
    },
  };
}

async function resolveWorkspaceId(
  sb: ReturnType<typeof adminClient>,
  request: Request,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("workspace") ?? url.searchParams.get("workspace_id");
  if (fromQuery) return fromQuery;

  if (payload.workspaceId) return String(payload.workspaceId);

  const receivedSecret = request.headers.get("x-wati-secret") ?? "";
  if (receivedSecret) {
    const { data: conn } = await sb
      .from("wati_connections")
      .select("webhook_secret, workspace_id")
      .not("webhook_secret", "is", null)
      .limit(50);

    const matched = (conn ?? []).find(
      (c: { webhook_secret: string; workspace_id: string }) => c.webhook_secret === receivedSecret,
    );
    if (matched) return matched.workspace_id;
  }

  const { data: conns } = await sb
    .from("wati_connections")
    .select("workspace_id")
    .eq("status", "connected")
    .limit(1);
  return conns?.[0]?.workspace_id ?? null;
}

async function applyWatiTemplateWebhook(
  sb: ReturnType<typeof adminClient>,
  workspaceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { templateName, watiTemplateId, patch } = watiTemplatePatchFromWebhook(payload);
  if (!templateName && !watiTemplateId) return;

  let query = (sb as any).from("wati_templates").update(patch).eq("workspace_id", workspaceId);
  if (watiTemplateId) {
    query = query.eq("wati_template_id", watiTemplateId);
  } else if (templateName) {
    query = query.eq("name", templateName);
  }

  const { error } = await query;
  if (error) {
    console.error("[WATI WEBHOOK] Template status update error", error.message);
  }
}

export const Route = createFileRoute("/api/webhook/wati-inbound")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          },
        }),

      POST: async ({ request }) => {
        let payload: Record<string, unknown>;
        try {
          payload = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        try {
          const sb = adminClient() as ReturnType<typeof adminClient> & { from: (t: string) => unknown };

          const workspaceId = await resolveWorkspaceId(sb as any, request, payload);
          if (!workspaceId) {
            console.warn("[WATI WEBHOOK] No workspace resolved", payload);
            return json({ ok: true });
          }

          // Template approval / quality lifecycle (create templates in WATI UI)
          if (isWatiTemplateLifecycleEvent(payload)) {
            try {
              await applyWatiTemplateWebhook(sb, workspaceId, payload);
            } catch (e) {
              console.error("[WATI WEBHOOK] Template lifecycle error", e);
            }
            return json({ ok: true });
          }

          // templateMessageSent_v2 — link WATI localMessageId to our outbound row (required before READ webhooks)
          if (isWatiTemplateSentEvent(payload)) {
            const localMessageId = extractStatusTrackingId(payload);
            const phone = extractWatiWebhookPhone(payload);
            if (localMessageId && phone) {
              try {
                const linked = await linkOutboundMessageToWatiLocalId(
                  workspaceId,
                  localMessageId,
                  phone,
                );
                if (!linked) {
                  console.warn("[WATI WEBHOOK] templateMessageSent — no outbound row for phone", {
                    localMessageId,
                    phone,
                  });
                }
              } catch (e) {
                console.error("[WATI WEBHOOK] templateMessageSent link error", e);
              }
            }
            return json({ ok: true });
          }

          // Delivery / read status updates (sentMessageDELIVERED_v2, sentMessageREAD_v2, etc.)
          if (isWatiStatusEvent(payload)) {
            const trackingId = extractStatusTrackingId(payload);
            const status = mapWatiDeliveryStatus(payload);
            if (status) {
              try {
                await applyMessageStatusUpdate(sb, workspaceId, trackingId ?? "", status, payload);
              } catch (e) {
                console.error("[WATI WEBHOOK] Status update error", e);
              }
            } else {
              console.warn("[WATI WEBHOOK] Status event — unmapped status", {
                eventType: payload.eventType,
                statusString: payload.statusString,
                trackingId,
              });
            }
            return json({ ok: true });
          }

          const { message } = normalizeWatiEvent(payload);
          if (!message || message.direction !== "inbound") {
            return json({ ok: true });
          }

          try {
            const leadId = await attachLeadToInboundMessage(
              sb as any,
              workspaceId,
              message.contact_phone,
              message.contact_name,
            );

            await (sb as any).from("whatsapp_messages").insert({
              workspace_id: workspaceId,
              external_id: message.external_id,
              contact_phone: message.contact_phone,
              contact_name: message.contact_name,
              body: message.body,
              direction: "inbound",
              provider: "wati",
              lead_id: leadId,
              status: "delivered",
              sent_at: new Date().toISOString(),
            });
          } catch (e) {
            console.error("[WATI WEBHOOK] DB insert error", e);
          }

          return json({ ok: true });
        } catch (e) {
          // WATI marks webhooks "Defective" on non-2xx — always acknowledge receipt.
          console.error("[WATI WEBHOOK] Unhandled handler error", e);
          return json({ ok: true, warning: "processed with server error logged" });
        }
      },
    },
  },
});
