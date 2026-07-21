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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function adminClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function mapWatiDeliveryStatus(payload: Record<string, unknown>): string | null {
  const raw = String(
    payload.status ??
      payload.messageStatus ??
      payload.deliveryStatus ??
      payload.eventType ??
      payload.type ??
      "",
  ).toLowerCase();
  if (raw.includes("read")) return "read";
  if (raw.includes("deliver")) return "delivered";
  if (raw.includes("fail")) return "failed";
  if (raw.includes("sent")) return "sent";
  if (raw.includes("queue")) return "queued";
  return null;
}

function extractExternalId(payload: Record<string, unknown>): string | null {
  const id =
    payload.id ??
    payload.messageId ??
    payload.whatsappMessageId ??
    payload.wamid ??
    (payload.message as Record<string, unknown> | undefined)?.id;
  return id ? String(id) : null;
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

        const sb = adminClient() as ReturnType<typeof adminClient> & { from: (t: string) => unknown };

        const workspaceId = await resolveWorkspaceId(sb as any, request, payload);
        if (!workspaceId) {
          console.warn("[WATI WEBHOOK] No workspace resolved", payload);
          return json({ ok: true });
        }

        // Delivery / read status updates
        if (isWatiStatusEvent(payload)) {
          const externalId = extractExternalId(payload);
          const status = mapWatiDeliveryStatus(payload);
          if (externalId && status) {
            try {
              await (sb as any)
                .from("whatsapp_messages")
                .update({ status })
                .eq("workspace_id", workspaceId)
                .eq("external_id", externalId);
            } catch (e) {
              console.error("[WATI WEBHOOK] Status update error", e);
            }
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
      },
    },
  },
});
