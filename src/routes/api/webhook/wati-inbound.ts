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
  getWatiConnectionForWorkspace,
  isWatiInboundMessageEvent,
  isWatiOutboundMessageEvent,
  isWatiReplyEvent,
  isWatiStatusEvent,
  parseWatiChatMessage,
  parseWatiInboundMessage,
  parseWatiReplyWebhookMessage,
} from "@/lib/whatsapp/wati-campaign.server";
import { parseWatiTicketWebhook } from "@/lib/whatsapp/wati-chat-status.shared";
import { resolveWatiReplyContactPhone } from "@/lib/whatsapp/wati-inbox-enrich.server";
import { markWhatsappContactDoNotContact } from "@/lib/whatsapp/wa-contact-message-stats.server";
import { isWhatsappOptOutMessage } from "@/lib/whatsapp/wa-opt-out.shared";
import {
  applyWatiMessageStatusToRow,
  extractWatiWebhookPhone,
  findOutboundMessageForWatiStatus,
  isWatiTemplateSentEvent,
  linkOutboundMessageToWatiLocalId,
  mapWatiStatusToDbStatus,
} from "@/lib/whatsapp/wati-message-status.server";
import {
  syncWhatsappConversation,
  updateWatiChatState,
} from "@/lib/whatsapp/whatsapp-conversations.server";
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
  return mapWatiStatusToDbStatus(
    payload.statusString ??
      payload.status ??
      payload.messageStatus ??
      payload.deliveryStatus ??
      payload.eventType ??
      payload.type,
  );
}

/**
 * Record that WATI actually delivered an event.
 *
 * wati_connections.webhook_manual only records that someone clicked "Confirm manual setup", so it
 * cannot distinguish a configured webhook from a silently undelivered one. This timestamp can.
 */
async function stampWebhookReceipt(
  sb: ReturnType<typeof adminClient>,
  workspaceId: string,
  eventType: unknown,
): Promise<void> {
  const { error } = await (sb as any)
    .from("wati_connections")
    .update({
      last_webhook_event_at: new Date().toISOString(),
      last_webhook_event_type: eventType == null ? null : String(eventType).slice(0, 120),
    })
    .eq("workspace_id", workspaceId);

  if (error) console.warn("[WATI WEBHOOK] receipt stamp failed", error.message);
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

async function applyMessageStatusUpdate(
  sb: ReturnType<typeof adminClient>,
  workspaceId: string,
  trackingId: string,
  status: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const phone = extractWatiWebhookPhone(payload);
  const whatsappMessageId =
    payload.whatsappMessageId != null ? String(payload.whatsappMessageId) : null;
  const row = await findOutboundMessageForWatiStatus(
    workspaceId,
    trackingId || null,
    phone,
    whatsappMessageId,
  );

  if (!row) {
    console.warn("[WATI WEBHOOK] Status event — no matching message", {
      trackingId,
      whatsappMessageId,
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
    whatsappMessageId,
  });

  if (!applied) return;
}

/**
 * Campaign that an inbound reply belongs to.
 *
 * sentMessageREPLIED_v2 carries the original message's localMessageId, which is exactly the
 * external_id we stored on the outbound row — so campaign attribution is a direct lookup. Plain
 * "message" events carry no such link, so fall back to the most recent campaign send to this
 * number inside WhatsApp's 24h session window.
 */
async function resolveInboundCampaignId(
  sb: ReturnType<typeof adminClient>,
  workspaceId: string,
  opts: { localMessageId?: string | null; whatsappMessageId?: string | null; phone: string },
): Promise<string | null> {
  if (opts.localMessageId || opts.whatsappMessageId) {
    const source = await findOutboundMessageForWatiStatus(
      workspaceId,
      opts.localMessageId ?? null,
      null,
      opts.whatsappMessageId ?? null,
    );
    if (source?.campaign_id) return source.campaign_id;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await (sb as any)
    .from("whatsapp_messages")
    .select("campaign_id")
    .eq("workspace_id", workspaceId)
    .eq("contact_phone", opts.phone)
    .eq("direction", "outbound")
    .not("campaign_id", "is", null)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(1);

  return (data?.[0]?.campaign_id as string | undefined) ?? null;
}

async function storeInboundMessage(
  sb: ReturnType<typeof adminClient>,
  workspaceId: string,
  message: NonNullable<ReturnType<typeof parseWatiInboundMessage>>,
  opts?: { campaignId?: string | null },
): Promise<void> {
  const leadId = await attachLeadToInboundMessage(
    sb as any,
    workspaceId,
    message.contact_phone,
    message.contact_name,
  );

  const row = {
    workspace_id: workspaceId,
    external_id: message.external_id,
    contact_phone: message.contact_phone,
    contact_name: message.contact_name,
    body: message.body,
    direction: "inbound" as const,
    provider: "wati",
    lead_id: leadId,
    campaign_id: opts?.campaignId ?? null,
    status: "delivered",
    sent_at: message.sent_at,
    whatsapp_message_id: message.whatsapp_message_id,
    conversation_id: message.conversation_id,
    ticket_id: message.ticket_id,
    reply_context_id: message.reply_context_id,
    media_url: message.media_url,
    media_mime_type: message.media_mime_type,
    media_filename: message.media_filename,
    wati_status: message.wati_status,
  };

  await upsertWhatsappMessage(sb, row);
  await syncWhatsappConversation(workspaceId, message.contact_phone);

  if (isWhatsappOptOutMessage(message.body)) {
    try {
      await markWhatsappContactDoNotContact(
        sb as any,
        workspaceId,
        message.contact_phone,
        message.contact_name,
      );
      console.log("[WATI WEBHOOK] Opt-out recorded for", message.contact_phone);
    } catch (e) {
      console.error("[WATI WEBHOOK] Opt-out mark failed", e);
    }
  }
}

async function storeOutboundMessage(
  sb: ReturnType<typeof adminClient>,
  workspaceId: string,
  message: NonNullable<ReturnType<typeof parseWatiChatMessage>>,
): Promise<void> {
  const row = {
    workspace_id: workspaceId,
    external_id: message.external_id,
    contact_phone: message.contact_phone,
    contact_name: message.contact_name,
    body: message.body,
    direction: "outbound" as const,
    provider: "wati",
    status: "sent",
    sent_at: message.sent_at,
    whatsapp_message_id: message.whatsapp_message_id,
    sender_channel: message.sender_channel,
    conversation_id: message.conversation_id,
    ticket_id: message.ticket_id,
    reply_context_id: message.reply_context_id,
    media_url: message.media_url,
    media_mime_type: message.media_mime_type,
    media_filename: message.media_filename,
    wati_status: message.wati_status,
  };
  await upsertWhatsappMessage(sb, row);
  await syncWhatsappConversation(workspaceId, message.contact_phone);
}

/** Columns added by migrations after the original table — dropped if the schema rejects them. */
const OPTIONAL_MESSAGE_COLUMNS = [
  "whatsapp_message_id",
  "sender_channel",
  "conversation_id",
  "ticket_id",
  "reply_context_id",
  "media_mime_type",
  "media_filename",
  "wati_status",
] as const;

async function upsertWhatsappMessage(
  sb: ReturnType<typeof adminClient>,
  row: Record<string, unknown>,
): Promise<void> {
  const upsert = (payload: Record<string, unknown>) =>
    (sb as any)
      .from("whatsapp_messages")
      .upsert(payload, { onConflict: "workspace_id,external_id" });

  const { error } = await upsert(row);
  if (!error) return;

  // An un-migrated environment rejects the newer columns by name. Retry without them rather than
  // losing the message entirely.
  const rejected = OPTIONAL_MESSAGE_COLUMNS.filter((column) =>
    String(error.message).includes(column),
  );
  if (rejected.length === 0) throw error;

  const fallback = { ...row };
  for (const column of OPTIONAL_MESSAGE_COLUMNS) delete fallback[column];

  const { error: retryErr } = await upsert(fallback);
  if (retryErr) throw retryErr;

  console.warn("[WATI WEBHOOK] stored message without optional columns", {
    missing: rejected,
  });
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

          await stampWebhookReceipt(sb, workspaceId, payload.eventType ?? payload.type);

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
            const whatsappMessageId =
              payload.whatsappMessageId != null ? String(payload.whatsappMessageId) : null;
            if (localMessageId && phone) {
              try {
                const linked = await linkOutboundMessageToWatiLocalId(
                  workspaceId,
                  localMessageId,
                  phone,
                  whatsappMessageId,
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

          // Campaign / template reply (sentMessageREPLIED_v2) — often the only event for campaign replies
          if (isWatiReplyEvent(payload)) {
            try {
              let phone = extractWatiWebhookPhone(payload);
              if (!phone) {
                const conn = await getWatiConnectionForWorkspace(sb as any, workspaceId);
                if (conn) {
                  phone = await resolveWatiReplyContactPhone(conn, payload);
                }
              }
              if (phone) {
                const message = parseWatiReplyWebhookMessage(payload, phone);
                if (message) {
                  const campaignId = await resolveInboundCampaignId(sb, workspaceId, {
                    localMessageId: extractStatusTrackingId(payload),
                    whatsappMessageId:
                      payload.whatsappMessageId != null ? String(payload.whatsappMessageId) : null,
                    phone,
                  });
                  await storeInboundMessage(sb, workspaceId, message, { campaignId });
                }
              } else {
                console.warn("[WATI WEBHOOK] Reply event — could not resolve contact phone", {
                  conversationId: payload.conversationId,
                  ticketId: payload.ticketId,
                  localMessageId: payload.localMessageId,
                });
              }
            } catch (e) {
              console.error("[WATI WEBHOOK] Reply insert error", e);
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

          if (isWatiInboundMessageEvent(payload)) {
            const message = parseWatiInboundMessage(payload);
            if (message) {
              try {
                const campaignId = await resolveInboundCampaignId(sb, workspaceId, {
                  localMessageId: null,
                  whatsappMessageId: null,
                  phone: message.contact_phone,
                });
                await storeInboundMessage(sb, workspaceId, message, { campaignId });
              } catch (e) {
                console.error("[WATI WEBHOOK] Inbound insert error", e);
              }
            }
            return json({ ok: true });
          }

          // Bot / agent replies sent inside WATI (owner === true)
          if (isWatiOutboundMessageEvent(payload)) {
            const message = parseWatiChatMessage(payload, "outbound");
            if (message) {
              try {
                await storeOutboundMessage(sb, workspaceId, message);
              } catch (e) {
                console.error("[WATI WEBHOOK] Outbound insert error", e);
              }
            }
            return json({ ok: true });
          }

          // Chat status changes (expired / open / solved). Last branch on purpose: it classifies on
          // eventDescription, so it must never get a chance to intercept a message event.
          const ticket = parseWatiTicketWebhook(payload);
          if (ticket) {
            const phone = extractWatiWebhookPhone(payload);
            if (phone) {
              try {
                await updateWatiChatState(workspaceId, phone, ticket);
              } catch (e) {
                console.error("[WATI WEBHOOK] Chat status update error", e);
              }
            }
            return json({ ok: true });
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
