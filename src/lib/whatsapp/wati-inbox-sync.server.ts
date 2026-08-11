/**
 * Sync WEBEE Buzzchat inbox from WATI V1 getMessages (per-contact history).
 * V3 /conversations/{phone}/messages returns 404 on some EU tenants — V1 works.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { watiApiV1Base } from "@/lib/whatsapp/wati-api-base.shared";
import {
  getWatiConnectionForWorkspace,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp/wati-campaign.server";
import { extractWatiConversationMessageText, fetchWatiConversationMessages } from "@/lib/whatsapp/wati-inbox-enrich.server";
import { mapWatiStatusString } from "@/lib/whatsapp/wati-message-status.server";

type WatiConn = {
  api_key: string;
  tenant_id: string;
  api_host: string | null;
};

export type ParsedWatiInboxMessage = {
  contact_phone: string;
  body: string;
  direction: "inbound" | "outbound";
  external_id: string;
  whatsapp_message_id: string | null;
  sent_at: string;
  sender_channel: string | null;
  status: string;
};

const syncThrottleMs =
  process.env.NODE_ENV === "development" || process.env.WATI_INBOX_SYNC_FAST === "1"
    ? 8_000
    : 60_000;
const lastSyncByWorkspace = new Map<string, number>();

function watiAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
}

/** Map a WATI V1 getMessages row to a whatsapp_messages insert row. */
export function parseWatiV1InboxMessage(
  msg: Record<string, unknown>,
  contactPhone: string,
): ParsedWatiInboxMessage | null {
  const eventType = String(msg.eventType ?? msg.type ?? "").toLowerCase();
  if (eventType === "ticket") return null;

  const body = extractWatiConversationMessageText(msg);
  if (!body?.trim()) return null;

  let direction: "inbound" | "outbound";
  let senderChannel: string | null = null;

  if (eventType === "message" || eventType === "message_bsuid") {
    if (msg.owner === false) {
      direction = "inbound";
    } else {
      direction = "outbound";
      const operator = String(msg.operatorName ?? msg.agentName ?? "").toLowerCase();
      senderChannel = operator.includes("bot") ? "bot" : "wati";
    }
  } else if (eventType === "broadcastmessage" || eventType.includes("broadcast")) {
    direction = "outbound";
    const lower = body.toLowerCase();
    senderChannel = lower.includes("auto-reply") || lower.includes("auto reply") ? "bot" : "campaign";
  } else if (eventType.includes("template")) {
    direction = "outbound";
    senderChannel = "template";
  } else if (msg.owner === false) {
    direction = "inbound";
  } else {
    direction = "outbound";
    senderChannel = "wati";
  }

  const externalId = String(
    msg.id ?? msg.localMessageId ?? msg.local_message_id ?? msg.messageId ?? "",
  ).trim();
  if (!externalId) return null;

  const whatsappMessageId =
    msg.whatsappMessageId != null
      ? String(msg.whatsappMessageId)
      : msg.whatsapp_message_id != null
        ? String(msg.whatsapp_message_id)
        : null;

  const sentAt =
    msg.created != null
      ? String(msg.created)
      : msg.timestamp != null
        ? new Date(Number(msg.timestamp) * 1000).toISOString()
        : new Date().toISOString();

  const status = mapWatiStatusString(msg.statusString ?? msg.status) ?? "sent";

  return {
    contact_phone: normalizeWhatsAppPhone(contactPhone),
    body: body.trim(),
    direction,
    external_id: externalId,
    whatsapp_message_id: whatsappMessageId,
    sent_at: sentAt,
    sender_channel: senderChannel,
    status: direction === "inbound" ? "delivered" : status,
  };
}

export async function fetchWatiV1MessagesForPhone(
  conn: WatiConn,
  phone: string,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<Array<Record<string, unknown>>> {
  const pageSize = opts?.pageSize ?? 50;
  const maxPages = opts?.maxPages ?? 5;
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return [];

  const headers = watiAuthHeaders(conn.api_key);
  const collected: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `${watiApiV1Base(conn.tenant_id, conn.api_host)}/getMessages/${encodeURIComponent(normalized)}?pageSize=${pageSize}&pageNumber=${page}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) break;

      const json = (await res.json()) as Record<string, unknown>;
      const items = (json.messages as { items?: unknown[] } | undefined)?.items ??
        (json.items as unknown[] | undefined) ??
        (json.message_list as unknown[] | undefined) ??
        [];

      const list = Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
      if (list.length === 0) break;

      collected.push(...list);
      if (list.length < pageSize) break;
    } catch {
      break;
    }
  }

  return collected;
}

/** V1 getMessages first; V3 conversation API as fallback (EU tenants / campaign threads). */
export async function fetchWatiMessagesForPhone(
  conn: WatiConn,
  phone: string,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<Array<Record<string, unknown>>> {
  const v1 = await fetchWatiV1MessagesForPhone(conn, phone, opts);
  if (v1.length > 0) return v1;
  return fetchWatiConversationMessages(conn, phone, {
    pageSize: opts?.pageSize ?? 50,
    maxPages: opts?.maxPages ?? 5,
  });
}

function parseSentAtMs(value: unknown): number | null {
  if (value == null) return null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

function findDuplicateMessage(
  parsed: ParsedWatiInboxMessage,
  existing: Array<{
    id?: string;
    external_id?: string | null;
    whatsapp_message_id?: string | null;
    sent_at?: string | null;
    body?: string | null;
    direction?: string | null;
    sender_channel?: string | null;
  }>,
): (typeof existing)[number] | null {
  for (const row of existing) {
    if (row.external_id && row.external_id === parsed.external_id) return row;
    if (
      parsed.whatsapp_message_id &&
      row.whatsapp_message_id &&
      row.whatsapp_message_id === parsed.whatsapp_message_id
    ) {
      return row;
    }

    const existingMs = parseSentAtMs(row.sent_at);
    const parsedMs = parseSentAtMs(parsed.sent_at);
    if (
      existingMs != null &&
      parsedMs != null &&
      Math.abs(existingMs - parsedMs) <= 5000 &&
      row.direction === parsed.direction &&
      String(row.body ?? "").trim() === parsed.body.trim()
    ) {
      return row;
    }
  }
  return null;
}

export async function syncWatiInboxForPhones(
  workspaceId: string,
  phones: string[],
  opts?: { maxPages?: number },
): Promise<number> {
  const conn = await getWatiConnectionForWorkspace(supabaseAdmin as any, workspaceId);
  if (!conn) return 0;

  const admin = supabaseAdmin as any;
  const uniquePhones = [...new Set(phones.map((p) => normalizeWhatsAppPhone(p)).filter(Boolean))];
  if (uniquePhones.length === 0) return 0;

  let inserted = 0;

  for (const phone of uniquePhones) {
    const watiMessages = await fetchWatiMessagesForPhone(conn, phone, {
      maxPages: opts?.maxPages ?? 3,
    });
    if (watiMessages.length === 0) continue;

    const { data: existingRows } = await admin
      .from("whatsapp_messages")
      .select("id, external_id, whatsapp_message_id, sent_at, body, direction, sender_channel")
      .eq("workspace_id", workspaceId)
      .eq("contact_phone", phone)
      .order("sent_at", { ascending: false })
      .limit(200);

    const existing = (existingRows ?? []) as Array<{
      id?: string;
      external_id?: string | null;
      whatsapp_message_id?: string | null;
      sent_at?: string | null;
      body?: string | null;
      direction?: string | null;
      sender_channel?: string | null;
    }>;

    const toInsert: Record<string, unknown>[] = [];
    const toPatch: Array<{ id: string; patch: Record<string, unknown> }> = [];

    for (const raw of watiMessages) {
      const parsed = parseWatiV1InboxMessage(raw, phone);
      if (!parsed) continue;

      const duplicate = findDuplicateMessage(parsed, existing);
      if (duplicate) {
        const patch: Record<string, unknown> = {};
        if (parsed.sender_channel && !duplicate.sender_channel) {
          patch.sender_channel = parsed.sender_channel;
        }
        if (
          parsed.body.length > String(duplicate.body ?? "").length &&
          !String(duplicate.body ?? "").startsWith("[Template:")
        ) {
          patch.body = parsed.body;
        }
        if (duplicate.id && Object.keys(patch).length > 0) {
          toPatch.push({ id: duplicate.id, patch });
        }
        continue;
      }

      if (toInsert.some((r) => r.external_id === parsed.external_id)) continue;

      toInsert.push({
        workspace_id: workspaceId,
        external_id: parsed.external_id,
        contact_phone: parsed.contact_phone,
        body: parsed.body,
        direction: parsed.direction,
        provider: "wati",
        status: parsed.status,
        sent_at: parsed.sent_at,
        whatsapp_message_id: parsed.whatsapp_message_id,
        sender_channel: parsed.sender_channel,
      });

      existing.push({
        external_id: parsed.external_id,
        whatsapp_message_id: parsed.whatsapp_message_id,
        sent_at: parsed.sent_at,
        body: parsed.body,
        direction: parsed.direction,
        sender_channel: parsed.sender_channel,
      });
    }

    for (const { id, patch } of toPatch) {
      const { error } = await admin.from("whatsapp_messages").update(patch).eq("id", id);
      if (!error) inserted++;
    }

    if (toInsert.length === 0) continue;

    for (const row of toInsert) {
      const { error } = await admin.from("whatsapp_messages").upsert(row, {
        onConflict: "workspace_id,external_id",
        ignoreDuplicates: true,
      });
      if (!error) inserted++;
      else if (!String(error.message).includes("duplicate")) {
        const { sender_channel: _s, whatsapp_message_id: _w, ...fallback } = row;
        const { error: retryErr } = await admin.from("whatsapp_messages").upsert(fallback, {
          onConflict: "workspace_id,external_id",
          ignoreDuplicates: true,
        });
        if (!retryErr) inserted++;
      }
    }
  }

  return inserted;
}

async function collectInboxSyncPhones(workspaceId: string): Promise<string[]> {
  const admin = supabaseAdmin as any;

  const { data: recentMsgs } = await admin
    .from("whatsapp_messages")
    .select("contact_phone")
    .eq("workspace_id", workspaceId)
    .order("sent_at", { ascending: false })
    .limit(500);

  const phones = new Set<string>();
  for (const row of recentMsgs ?? []) {
    const p = normalizeWhatsAppPhone(String(row.contact_phone ?? ""));
    if (p) phones.add(p);
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: campaignOutbound } = await admin
    .from("whatsapp_messages")
    .select("contact_phone")
    .eq("workspace_id", workspaceId)
    .eq("direction", "outbound")
    .eq("provider", "wati")
    .not("campaign_id", "is", null)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(200);

  for (const row of campaignOutbound ?? []) {
    const p = normalizeWhatsAppPhone(String(row.contact_phone ?? ""));
    if (p) phones.add(p);
  }

  const { data: contacts } = await admin
    .from("whatsapp_contacts")
    .select("phone")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(100);

  for (const c of contacts ?? []) {
    const p = normalizeWhatsAppPhone(String(c.phone ?? ""));
    if (p) phones.add(p);
  }

  return [...phones].slice(0, 50);
}

/** Pull WATI history for explicit phones (no throttle) — use when a thread is open locally. */
export async function syncWatiInboxFromWatiApi(
  workspaceId: string,
  phones: string[],
  opts?: { maxPages?: number },
): Promise<number> {
  const unique = [...new Set(phones.map((p) => normalizeWhatsAppPhone(p)).filter(Boolean))];
  if (unique.length === 0) return 0;
  return syncWatiInboxForPhones(workspaceId, unique, { maxPages: opts?.maxPages ?? 5 });
}

/** Throttled background sync — pulls recent WATI history including bot auto-replies. */
export async function maybeSyncWatiInboxFromApi(
  workspaceId: string,
  opts?: { force?: boolean },
): Promise<number> {
  if (!opts?.force) {
    const now = Date.now();
    const last = lastSyncByWorkspace.get(workspaceId) ?? 0;
    if (now - last < syncThrottleMs) return 0;
    lastSyncByWorkspace.set(workspaceId, now);
  }

  const phoneList = await collectInboxSyncPhones(workspaceId);
  return syncWatiInboxForPhones(workspaceId, phoneList);
}
