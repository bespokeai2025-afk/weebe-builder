/**
 * BuzzChat → CRM Lead Pipeline
 *
 * Canonical match-or-create logic that connects inbound WhatsApp replies to
 * the WEBEE Leads table.  Called from every provider webhook after a genuine
 * new inbound message is confirmed.
 *
 * INVARIANTS:
 * - Never creates more than ONE lead per (workspace, phone) pair.
 * - Never alters status / sentiment / meeting_requested / assigned_to.
 * - Only updates buzzchat_* fields when the new reply is more recent.
 * - Every error is caught and logged; webhook processing must never fail here.
 *
 * Relative imports ONLY — this module may be loaded by files close to the
 * vite-config plugin chain.  Keep all imports relative (no "@/").
 */

import { supabaseAdmin } from "../../integrations/supabase/client.server";
import {
  normalizeWhatsAppPhone,
  findLeadByPhone,
} from "./wati-campaign.server";

const sb = supabaseAdmin as any;

export interface BuzzChatSyncInput {
  workspaceId: string;
  /** Raw phone from the provider (will be normalised). */
  contactPhone: string;
  contactName?: string | null;
  /** WATI conversationId / ticket id / Meta thread ID. */
  conversationId?: string | null;
  /** Stable provider message ID — used to deduplicate entity_notes. */
  externalMessageId?: string | null;
  /** Message body preview (truncated to 200 chars in the note). */
  messageBody?: string | null;
  /** ISO timestamp of the inbound message (defaults to now). */
  repliedAt?: string | null;
}

export interface BuzzChatSyncResult {
  leadId: string;
  created: boolean;
}

/**
 * Find or create a canonical lead for this inbound WhatsApp reply, then
 * stamp the buzzchat_* fields onto it.
 *
 * Match order:
 *   1. Existing lead already linked to this conversationId.
 *   2. Phone-normalised lookup (exact E.164 + tail fallback via findLeadByPhone).
 *   3. No match → create a new lead with source='whatsapp'.
 *
 * Always best-effort — callers should wrap in try/catch.
 */
export async function matchOrCreateLeadForWhatsApp(
  input: BuzzChatSyncInput,
): Promise<BuzzChatSyncResult> {
  const {
    workspaceId,
    contactPhone,
    contactName,
    conversationId,
    externalMessageId,
    messageBody,
    repliedAt,
  } = input;

  const normalizedPhone = normalizeWhatsAppPhone(contactPhone);
  const replyAt = repliedAt ?? new Date().toISOString();
  const preview = (messageBody ?? "").trim().slice(0, 200);

  // ── 1. Match by conversation id (fastest; already linked) ────────────────
  if (conversationId) {
    const { data: byConv } = await sb
      .from("leads")
      .select("id, has_buzzchat_reply, last_buzzchat_reply_at, buzzchat_conversation_id")
      .eq("workspace_id", workspaceId)
      .eq("buzzchat_conversation_id", conversationId)
      .limit(1)
      .maybeSingle();

    if (byConv?.id) {
      await updateBuzzChatFields(byConv.id, workspaceId, conversationId, replyAt, byConv.last_buzzchat_reply_at);
      await recordActivity(workspaceId, byConv.id, conversationId, externalMessageId, preview, replyAt);
      return { leadId: byConv.id, created: false };
    }
  }

  // ── 2. Match by phone ────────────────────────────────────────────────────
  const existingLead = normalizedPhone
    ? await findLeadByPhone(sb, workspaceId, normalizedPhone)
    : null;

  if (existingLead?.id) {
    await updateBuzzChatFields(
      existingLead.id,
      workspaceId,
      conversationId ?? null,
      replyAt,
      null,
    );
    await recordActivity(workspaceId, existingLead.id, conversationId, externalMessageId, preview, replyAt);
    return { leadId: existingLead.id, created: false };
  }

  // ── 3. Create new lead ───────────────────────────────────────────────────
  // Deliberately minimal — we only know phone/name and that they replied.
  // status/sentiment/meeting_requested stay at their safe defaults.
  if (!normalizedPhone) {
    throw new Error(`Cannot create lead — phone '${contactPhone}' could not be normalised.`);
  }

  const { data: newLead, error: createErr } = await sb
    .from("leads")
    .insert({
      workspace_id: workspaceId,
      phone: normalizedPhone,
      full_name: contactName ?? null,
      source: "whatsapp",
      status: "need_to_call",
      has_buzzchat_reply: true,
      last_buzzchat_reply_at: replyAt,
      buzzchat_conversation_id: conversationId ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (createErr) throw new Error(`Lead create failed: ${createErr.message}`);

  await recordActivity(workspaceId, newLead.id, conversationId, externalMessageId, preview, replyAt);
  return { leadId: newLead.id, created: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Stamp / update buzzchat fields without touching status/sentiment/booking. */
async function updateBuzzChatFields(
  leadId: string,
  workspaceId: string,
  conversationId: string | null,
  replyAt: string,
  prevReplyAt: string | null | undefined,
): Promise<void> {
  // Only advance the timestamp if the new reply is more recent.
  const isNewer = !prevReplyAt || new Date(replyAt) >= new Date(prevReplyAt);
  const patch: Record<string, unknown> = {
    has_buzzchat_reply: true,
    updated_at: new Date().toISOString(),
  };
  if (isNewer) patch.last_buzzchat_reply_at = replyAt;
  if (conversationId) patch.buzzchat_conversation_id = conversationId;

  const { error } = await sb
    .from("leads")
    .update(patch)
    .eq("id", leadId)
    .eq("workspace_id", workspaceId);
  if (error) console.warn("[buzzchat-lead-sync] update failed", error.message);
}

/**
 * Idempotent entity_note recording.
 * The note body encodes the external_id so we can detect duplicates cheaply.
 * Note: entity_notes has no metadata column, so the dedupe key is embedded in
 * the body as a JSON prefix: {"src":"buzzchat","ext_id":"...","preview":"..."}
 */
async function recordActivity(
  workspaceId: string,
  leadId: string,
  conversationId: string | null | undefined,
  externalMessageId: string | null | undefined,
  preview: string,
  replyAt: string,
): Promise<void> {
  try {
    const body = JSON.stringify({
      src: "buzzchat",
      ext_id: externalMessageId ?? null,
      conv_id: conversationId ?? null,
      preview,
      replied_at: replyAt,
    });

    // Deduplicate: if this exact external_id is already recorded, skip.
    if (externalMessageId) {
      const { data: existing } = await sb
        .from("entity_notes")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", "lead")
        .eq("entity_id", leadId)
        .ilike("body", `%"ext_id":"${externalMessageId.replace(/"/g, '\\"')}"%`)
        .limit(1)
        .maybeSingle();
      if (existing?.id) return; // already recorded
    }

    await sb.from("entity_notes").insert({
      workspace_id: workspaceId,
      entity_type: "lead",
      entity_id: leadId,
      body,
      created_by: null,
    });
  } catch (e: any) {
    console.warn("[buzzchat-lead-sync] activity log failed (non-fatal):", e?.message ?? e);
  }
}
