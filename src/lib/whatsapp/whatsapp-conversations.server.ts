/**
 * Per-conversation inbox state — assignment, chat status, tags, unread counts.
 *
 * Threads are keyed by (workspace_id, contact_phone), the same key the inbox groups messages on.
 * State is recomputed from message history by the sync_whatsapp_conversation SQL function so that
 * WATI webhook redeliveries can't double-count unread messages.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizeWhatsAppPhone } from "@/lib/whatsapp/wati-campaign.server";

export const WHATSAPP_CHAT_STATUSES = ["open", "pending", "solved"] as const;
export type WhatsappChatStatus = (typeof WHATSAPP_CHAT_STATUSES)[number];

export function isWhatsappChatStatus(value: unknown): value is WhatsappChatStatus {
  return WHATSAPP_CHAT_STATUSES.includes(value as WhatsappChatStatus);
}

export type WhatsappConversationRow = {
  id: string;
  contact_phone: string;
  contact_name: string | null;
  status: WhatsappChatStatus;
  assignee_id: string | null;
  assigned_team_id: string | null;
  tags: string[] | null;
  attributes: Record<string, unknown> | null;
  unread_count: number;
  last_read_at: string | null;
  last_message_at: string | null;
  last_direction: string | null;
  wati_conversation_id: string | null;
  wati_ticket_id: string | null;
  wati_chat_status: string | null;
  wati_topic: string | null;
  wati_agent_name: string | null;
  last_inbound_at: string | null;
  last_message_origin: string | null;
};

/** Column list shared by every conversation read so new state can't be missed off one of them. */
export const WHATSAPP_CONVERSATION_COLUMNS =
  "id, contact_phone, contact_name, status, assignee_id, assigned_team_id, tags, attributes, " +
  "unread_count, last_read_at, last_message_at, last_direction, wati_conversation_id, " +
  "wati_ticket_id, wati_chat_status, wati_topic, wati_agent_name, last_inbound_at, " +
  "last_message_origin";

/**
 * Refresh a thread's denormalised state after its messages change.
 *
 * Best-effort: the inbox falls back to deriving unread/last-activity from messages, so a failure
 * here must never break webhook ingestion or a send.
 */
export async function syncWhatsappConversation(
  workspaceId: string,
  contactPhone: string,
): Promise<void> {
  const phone = normalizeWhatsAppPhone(contactPhone);
  if (!workspaceId || !phone) return;

  const { error } = await (supabaseAdmin as any).rpc("sync_whatsapp_conversation", {
    _workspace_id: workspaceId,
    _contact_phone: phone,
  });

  if (error) {
    console.warn("[wa-conversations] sync failed", {
      phone,
      error: error.message,
    });
  }
}

/** Refresh several threads at once (used after a bulk WATI history pull). */
export async function syncWhatsappConversations(
  workspaceId: string,
  contactPhones: Iterable<string>,
): Promise<void> {
  const unique = [
    ...new Set([...contactPhones].map((p) => normalizeWhatsAppPhone(p)).filter(Boolean)),
  ];
  const CONCURRENCY = 5;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    await Promise.all(
      unique.slice(i, i + CONCURRENCY).map((phone) => syncWhatsappConversation(workspaceId, phone)),
    );
  }
}

/**
 * Store WATI's own view of a chat — the status chip, topic and operator shown in WATI's inbox.
 *
 * Only wati_* columns are written; `status` stays our operator-owned triage state so the two
 * never overwrite each other.
 */
export async function updateWatiChatState(
  workspaceId: string,
  contactPhone: string,
  state: { status?: string | null; statusAt?: string | null; topicName?: string | null; agentName?: string | null },
): Promise<void> {
  const phone = normalizeWhatsAppPhone(contactPhone);
  if (!workspaceId || !phone) return;

  const patch: Record<string, unknown> = {};
  if (state.status) {
    patch.wati_chat_status = state.status;
    patch.wati_chat_status_at = state.statusAt ?? new Date().toISOString();
  }
  if (state.topicName) patch.wati_topic = state.topicName;
  if (state.agentName) patch.wati_agent_name = state.agentName;
  if (Object.keys(patch).length === 0) return;

  const { error } = await (supabaseAdmin as any)
    .from("whatsapp_conversations")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("contact_phone", phone);

  if (error) {
    console.warn("[wa-conversations] chat state update failed", {
      phone,
      error: error.message,
    });
  }
}

/** Conversation state for a set of phones, keyed by normalised phone. */
export async function getWhatsappConversationsByPhone(
  sb: { from: (t: string) => any },
  workspaceId: string,
  phones: string[],
): Promise<Map<string, WhatsappConversationRow>> {
  const byPhone = new Map<string, WhatsappConversationRow>();
  const unique = [...new Set(phones.map((p) => normalizeWhatsAppPhone(p)).filter(Boolean))];
  if (unique.length === 0) return byPhone;

  const { data, error } = await sb
    .from("whatsapp_conversations")
    .select(WHATSAPP_CONVERSATION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .in("contact_phone", unique);

  if (error) {
    console.warn("[wa-conversations] fetch failed", error.message);
    return byPhone;
  }

  for (const row of (data ?? []) as WhatsappConversationRow[]) {
    byPhone.set(normalizeWhatsAppPhone(row.contact_phone), row);
  }
  return byPhone;
}
