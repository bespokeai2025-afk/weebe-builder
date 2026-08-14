/**
 * Keep WEBEE inbox aligned with WATI by merging V1 + V3 conversation history on every inbox load.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { watiApiV1Base } from "@/lib/whatsapp/wati-api-base.shared";
import {
  getWatiConnectionForWorkspace,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp/wati-campaign.server";
import {
  extractWatiConversationMessageText,
  fetchWatiConversationMessages,
} from "@/lib/whatsapp/wati-inbox-enrich.server";
import { type WatiChatState, deriveWatiChatState } from "@/lib/whatsapp/wati-chat-status.shared";
import { mapWatiStatusToDbStatus } from "@/lib/whatsapp/wati-message-status.server";
import {
  syncWhatsappConversations,
  updateWatiChatState,
} from "@/lib/whatsapp/whatsapp-conversations.server";
import {
  collapseOptimisticOutboundDuplicates,
  findRedundantOptimisticMessageIds,
} from "@/lib/whatsapp/whatsapp-message-dedupe.server";
import { isWatiNonTextPlaceholderBody } from "@/lib/whatsapp/wati-message-content.shared";

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
  wati_status: string | null;
  conversation_id: string | null;
  ticket_id: string | null;
};

const syncThrottleMs =
  process.env.NODE_ENV === "development" || process.env.WATI_INBOX_SYNC_FAST === "1"
    ? 8_000
    : 12_000;
const lastSyncByWorkspace = new Map<string, number>();
/** Phones pulled per pass. Kept small because the inbox waits on this sync. */
const SYNC_PHONE_LIMIT = 35;
/** Of that budget, how much is reserved for threads that already have replies. */
const SYNC_PRIORITY_LIMIT = 15;
const SYNC_CONCURRENCY = 5;

/**
 * Where the rotating half of the last sync stopped, per workspace.
 *
 * A workspace can have far more chats than one pass can fetch. Without a cursor the newest
 * campaign sends win every pass and older conversations — exactly the ones holding replies —
 * are never polled at all.
 */
const syncCursorByWorkspace = new Map<string, number>();

/** Columns added by migrations after the original table — dropped when an insert rejects them. */
const OPTIONAL_MESSAGE_COLUMNS = [
  "sender_channel",
  "whatsapp_message_id",
  "wati_status",
  "conversation_id",
  "ticket_id",
] as const;

function watiMessageDedupeKey(msg: Record<string, unknown>): string {
  const id = String(
    msg.id ??
      msg.localMessageId ??
      msg.local_message_id ??
      msg.whatsappMessageId ??
      msg.whatsapp_message_id ??
      "",
  ).trim();
  if (id) return id;
  const text = extractWatiConversationMessageText(msg) ?? "";
  const ts = parseWatiMessageSentAt(msg);
  const owner = msg.owner === false ? "in" : "out";
  return `${owner}:${ts}:${text.slice(0, 80)}`;
}

/**
 * Combine two views of the same message field by field.
 *
 * V1 and V3 describe a message differently — a shared contact card only appears on V1's `contacts`,
 * while V3 omits the field entirely — so replacing one record with the other loses whichever
 * fields the winner does not carry. A null never overwrites a populated value.
 */
function mergeWatiMessageRecords(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    merged[key] = value;
  }
  return merged;
}

/** Merge V1 + V3 rows — V1 alone often has outbound only; replies live in V3 on EU tenants. */
export function mergeWatiMessageLists(
  ...lists: Array<Array<Record<string, unknown>>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  for (const list of lists) {
    for (const msg of list) {
      const key = watiMessageDedupeKey(msg);
      const existing = merged.get(key);
      merged.set(key, existing ? mergeWatiMessageRecords(existing, msg) : msg);
    }
  }
  return [...merged.values()];
}

export function parseWatiMessageSentAt(msg: Record<string, unknown>): string {
  if (msg.created != null) {
    const created = String(msg.created);
    if (created && !Number.isNaN(Date.parse(created))) return created;
  }
  if (msg.timestamp != null) {
    const raw = msg.timestamp;
    if (typeof raw === "string" && raw.includes("T")) {
      const ms = Date.parse(raw);
      if (!Number.isNaN(ms)) return new Date(ms).toISOString();
    }
    const n = Number(raw);
    if (!Number.isNaN(n)) {
      return new Date(n > 1e12 ? n : n * 1000).toISOString();
    }
  }
  return new Date().toISOString();
}

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

  /** WATI names the sender; a bot operator is how we tell automation from a human agent. */
  const operatorSenderChannel = (): string => {
    const operator = String(
      msg.operatorName ?? msg.operator_name ?? msg.agentName ?? "",
    ).toLowerCase();
    return operator.includes("bot") ? "bot" : "wati";
  };

  if (eventType === "message" || eventType === "message_bsuid") {
    if (msg.owner === false) {
      direction = "inbound";
    } else {
      direction = "outbound";
      senderChannel = operatorSenderChannel();
    }
  } else if (eventType === "broadcastmessage" || eventType.includes("broadcast")) {
    direction = "outbound";
    const lower = body.toLowerCase();
    senderChannel =
      lower.includes("auto-reply") || lower.includes("auto reply") ? "bot" : "campaign";
  } else if (eventType.includes("template")) {
    direction = "outbound";
    senderChannel = "template";
  } else if (msg.owner === false) {
    direction = "inbound";
  } else {
    // API V3 rows carry a media/text `type` rather than an eventType, so they land here.
    direction = "outbound";
    senderChannel = operatorSenderChannel();
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

  const sentAt = parseWatiMessageSentAt(msg);

  const rawStatus = msg.statusString ?? msg.status;
  const status = mapWatiStatusToDbStatus(rawStatus) ?? "sent";
  const idOrNull = (value: unknown): string | null => {
    const s = value == null ? "" : String(value).trim();
    return s || null;
  };

  return {
    contact_phone: normalizeWhatsAppPhone(contactPhone),
    body: body.trim(),
    direction,
    external_id: externalId,
    whatsapp_message_id: whatsappMessageId,
    sent_at: sentAt,
    sender_channel: senderChannel,
    status: direction === "inbound" ? "delivered" : status,
    wati_status: idOrNull(rawStatus),
    conversation_id: idOrNull(msg.conversationId ?? msg.conversation_id),
    ticket_id: idOrNull(msg.ticketId ?? msg.ticket_id),
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
      if (!res.ok) {
        console.warn("[wati-v1] getMessages failed", {
          status: res.status,
          phone: normalized,
          page,
        });
        break;
      }

      const json = (await res.json()) as Record<string, unknown>;
      const items =
        (json.messages as { items?: unknown[] } | undefined)?.items ??
        (json.items as unknown[] | undefined) ??
        (json.message_list as unknown[] | undefined) ??
        [];

      const list = Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
      if (list.length === 0) break;

      collected.push(...list);
      if (list.length < pageSize) break;
    } catch (e) {
      console.warn("[wati-v1] getMessages error", {
        phone: normalized,
        page,
        error: (e as Error).message,
      });
      break;
    }
  }

  return collected;
}

/**
 * Always merge V1 + V3 — campaign replies often appear only in V3 on eu-api.wati.io.
 *
 * `skipV3` halves the request count for bulk sweeps, where V1's single page already covers the
 * recent history a catch-up needs.
 */
export async function fetchWatiMessagesForPhone(
  conn: WatiConn,
  phone: string,
  opts?: { pageSize?: number; maxPages?: number; skipV3?: boolean },
): Promise<Array<Record<string, unknown>>> {
  const pageSize = opts?.pageSize ?? 50;
  const maxPages = opts?.maxPages ?? 5;

  if (opts?.skipV3) {
    return fetchWatiV1MessagesForPhone(conn, phone, { pageSize, maxPages });
  }

  const [v1, v3] = await Promise.all([
    fetchWatiV1MessagesForPhone(conn, phone, { pageSize, maxPages }),
    fetchWatiConversationMessages(conn, phone, { pageSize, maxPages }),
  ]);
  return mergeWatiMessageLists(v1, v3);
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
    // A stored placeholder is this same message from a parse that could not read its content, so
    // requiring equal bodies would store an upgraded copy alongside the original.
    const sameContent =
      String(row.body ?? "").trim() === parsed.body.trim() ||
      isWatiNonTextPlaceholderBody(row.body);
    if (
      existingMs != null &&
      parsedMs != null &&
      Math.abs(existingMs - parsedMs) <= 5000 &&
      row.direction === parsed.direction &&
      sameContent
    ) {
      return row;
    }
  }
  return null;
}

/**
 * Campaign a reply belongs to: the most recent campaign send to this contact at or before the
 * reply, inside WhatsApp's 24h session window.
 *
 * The reply webhook can match exactly via localMessageId, but history pulled from the WATI API
 * carries no such link, so proximity to the send is the only available signal.
 */
export function attributeReplyToCampaign(
  sentAt: string,
  campaignSends: Array<{ campaignId: string; sentAt: number }>,
): string | null {
  const repliedAt = new Date(sentAt).getTime();
  if (!Number.isFinite(repliedAt)) return null;

  const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
  let best: { campaignId: string; sentAt: number } | null = null;

  for (const send of campaignSends) {
    if (send.sentAt > repliedAt) continue;
    if (repliedAt - send.sentAt > SESSION_WINDOW_MS) continue;
    if (!best || send.sentAt > best.sentAt) best = send;
  }

  return best?.campaignId ?? null;
}

/**
 * Persist WATI's own view of each chat (its "Expired"/"Open"/"Solved" chip, topic and operator).
 *
 * Only the wati_* columns are written — `status` stays our operator-owned triage state.
 */
async function applyWatiChatStates(
  workspaceId: string,
  states: Map<string, WatiChatState>,
): Promise<void> {
  for (const [phone, state] of states) {
    await updateWatiChatState(workspaceId, phone, state);
  }
}

export type SyncInboxOptions = {
  maxPages?: number;
  pageSize?: number;
  concurrency?: number;
  /** Skip the V3 pass — used by bulk sweeps to halve the number of WATI requests. */
  skipV3?: boolean;
};

export async function syncWatiInboxForPhones(
  workspaceId: string,
  phones: string[],
  opts?: SyncInboxOptions,
): Promise<number> {
  const conn = await getWatiConnectionForWorkspace(supabaseAdmin as any, workspaceId);
  if (!conn) return 0;
  // Narrowing is lost inside syncOnePhone below, so bind the non-null connection here.
  const connection = conn;

  const admin = supabaseAdmin as any;
  const uniquePhones = [...new Set(phones.map((p) => normalizeWhatsAppPhone(p)).filter(Boolean))];
  if (uniquePhones.length === 0) return 0;

  let inserted = 0;

  async function syncOnePhone(
    phone: string,
  ): Promise<{ inserted: number; chatState: WatiChatState | null }> {
    const watiMessages = await fetchWatiMessagesForPhone(connection, phone, {
      maxPages: opts?.maxPages ?? 5,
      pageSize: opts?.pageSize,
      skipV3: opts?.skipV3,
    });
    if (watiMessages.length === 0) return { inserted: 0, chatState: null };

    // Ticket rows travel with the messages, so chat status costs no extra request.
    const chatState = deriveWatiChatState(watiMessages);

    const { data: existingRows } = await admin
      .from("whatsapp_messages")
      .select(
        "id, external_id, whatsapp_message_id, sent_at, body, direction, sender_channel, campaign_id",
      )
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
      campaign_id?: string | null;
    }>;

    // Captured before the loop below starts appending parsed rows to `existing`.
    const campaignSends = existing
      .filter((r) => r.direction === "outbound" && r.campaign_id && r.sent_at)
      .map((r) => ({
        campaignId: r.campaign_id as string,
        sentAt: new Date(r.sent_at as string).getTime(),
      }))
      .filter((s) => Number.isFinite(s.sentAt));

    const toInsert: Record<string, unknown>[] = [];
    const toPatch: Array<{ id: string; patch: Record<string, unknown> }> = [];
    let phoneInserted = 0;

    for (const raw of watiMessages) {
      const parsed = parseWatiV1InboxMessage(raw, phone);
      if (!parsed) continue;

      const duplicate = findDuplicateMessage(parsed, existing);
      if (duplicate) {
        const patch: Record<string, unknown> = {};
        if (parsed.sender_channel && !duplicate.sender_channel) {
          patch.sender_channel = parsed.sender_channel;
        }
        const storedBody = String(duplicate.body ?? "");
        // A placeholder gives way to real content even when that content is shorter, e.g.
        // "[document]" to "plan.pdf" — but never the reverse, and never a same-value rewrite.
        const isUpgrade = isWatiNonTextPlaceholderBody(storedBody)
          ? !isWatiNonTextPlaceholderBody(parsed.body)
          : parsed.body.length > storedBody.length;
        if (!storedBody.startsWith("[Template:") && isUpgrade) {
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
        wati_status: parsed.wati_status,
        conversation_id: parsed.conversation_id,
        ticket_id: parsed.ticket_id,
        campaign_id:
          parsed.direction === "inbound"
            ? attributeReplyToCampaign(parsed.sent_at, campaignSends)
            : null,
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
      if (!error) phoneInserted++;
    }

    for (const row of toInsert) {
      const { error } = await admin.from("whatsapp_messages").upsert(row, {
        onConflict: "workspace_id,external_id",
        ignoreDuplicates: true,
      });
      if (!error) phoneInserted++;
      else if (!String(error.message).includes("duplicate")) {
        // Retry without columns added by later migrations, so an un-migrated environment still
        // captures the message instead of dropping it.
        const fallback = { ...row };
        for (const column of OPTIONAL_MESSAGE_COLUMNS) delete fallback[column];
        const { error: retryErr } = await admin.from("whatsapp_messages").upsert(fallback, {
          onConflict: "workspace_id,external_id",
          ignoreDuplicates: true,
        });
        if (!retryErr) phoneInserted++;
        else {
          console.warn("[wati-inbox-sync] insert failed", {
            phone,
            externalId: row.external_id,
            error: retryErr.message,
          });
        }
      }
    }

    // A send from the inbox writes an optimistic row under a synthesised id; once WATI reports the
    // same message under its real id the optimistic copy is a duplicate. `existing` is only used to
    // decide whether it is worth looking — the collapse itself re-reads, so a message whose insert
    // failed above can never have its optimistic copy dropped.
    if (findRedundantOptimisticMessageIds(existing).length > 0) {
      await collapseOptimisticOutboundDuplicates(workspaceId, phone);
    }

    return { inserted: phoneInserted, chatState };
  }

  const concurrency = Math.max(1, opts?.concurrency ?? SYNC_CONCURRENCY);

  for (let i = 0; i < uniquePhones.length; i += concurrency) {
    const batch = uniquePhones.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((phone) => syncOnePhone(phone)));

    const touchedPhones = new Set<string>();
    const chatStates = new Map<string, WatiChatState>();

    results.forEach((result, idx) => {
      const phone = batch[idx]!;
      if (result.inserted > 0) touchedPhones.add(phone);
      if (result.chatState?.status) {
        chatStates.set(phone, result.chatState);
        // Guarantee the conversation row exists before its WATI status is patched in.
        touchedPhones.add(phone);
      }
      inserted += result.inserted;
    });

    // Flushed per batch rather than once at the end so a long sweep that gets cut short still
    // keeps the conversations it already pulled.
    await syncWhatsappConversations(workspaceId, touchedPhones);
    await applyWatiChatStates(workspaceId, chatStates);
  }

  return inserted;
}

/**
 * Phones worth polling, split by how urgently they need refreshing.
 *
 * `priority` holds threads that already have a reply — live conversations whose freshness the
 * inbox is judged on. `rotating` is everything else, swept a slice at a time.
 */
type InboxSyncPlan = { priority: string[]; rotating: string[] };

async function collectInboxSyncPhones(workspaceId: string): Promise<InboxSyncPlan> {
  const admin = supabaseAdmin as any;
  const priority: string[] = [];
  const rotating: string[] = [];
  const seen = new Set<string>();

  const addPhone = (raw: unknown, target: string[]) => {
    const p = normalizeWhatsAppPhone(String(raw ?? ""));
    if (p && !seen.has(p)) {
      seen.add(p);
      target.push(p);
    }
  };

  const { data: replied } = await admin
    .from("whatsapp_messages")
    .select("contact_phone")
    .eq("workspace_id", workspaceId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(500);

  for (const row of replied ?? []) addPhone(row.contact_phone, priority);

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
    .limit(2000);

  for (const row of campaignOutbound ?? []) addPhone(row.contact_phone, rotating);

  const { data: recentMsgs } = await admin
    .from("whatsapp_messages")
    .select("contact_phone")
    .eq("workspace_id", workspaceId)
    .order("sent_at", { ascending: false })
    .limit(2000);

  for (const row of recentMsgs ?? []) addPhone(row.contact_phone, rotating);

  const { data: contacts } = await admin
    .from("whatsapp_contacts")
    .select("phone")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1000);

  for (const c of contacts ?? []) addPhone(c.phone, rotating);

  return { priority, rotating };
}

/**
 * Pick this pass's phones: all active threads (up to the reserved share) plus the next slice of
 * the rotating list, advancing the cursor so repeated passes cover every chat.
 */
export function selectInboxSyncBatch(
  plan: InboxSyncPlan,
  cursor: number,
): { phones: string[]; nextCursor: number } {
  const priority = plan.priority.slice(0, SYNC_PRIORITY_LIMIT);
  const budget = SYNC_PHONE_LIMIT - priority.length;
  const rotating = plan.rotating;

  if (budget <= 0 || rotating.length === 0) {
    return { phones: priority, nextCursor: cursor };
  }

  const take = Math.min(budget, rotating.length);
  const start = ((cursor % rotating.length) + rotating.length) % rotating.length;
  const slice: string[] = [];
  for (let i = 0; i < take; i++) slice.push(rotating[(start + i) % rotating.length]!);

  return { phones: [...priority, ...slice], nextCursor: (start + take) % rotating.length };
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

/** Throttled background sync — merges WATI V1+V3 history including campaign replies. */
export async function maybeSyncWatiInboxFromApi(
  workspaceId: string,
  opts?: { force?: boolean },
): Promise<number> {
  if (!opts?.force) {
    const now = Date.now();
    const last = lastSyncByWorkspace.get(workspaceId) ?? 0;
    if (now - last < syncThrottleMs) return 0;
  }
  lastSyncByWorkspace.set(workspaceId, Date.now());

  const plan = await collectInboxSyncPhones(workspaceId);
  const { phones, nextCursor } = selectInboxSyncBatch(
    plan,
    syncCursorByWorkspace.get(workspaceId) ?? 0,
  );
  syncCursorByWorkspace.set(workspaceId, nextCursor);

  return syncWatiInboxForPhones(workspaceId, phones);
}

/**
 * Sweep every known chat in one go, including contacts that exist only in WATI.
 *
 * The throttled sync deliberately polls a slice at a time to keep inbox loads fast, so a workspace
 * connected after conversations already happened needs one full pass to catch up.
 */
export async function backfillWatiInbox(
  workspaceId: string,
  opts?: { includeWatiContacts?: boolean } & SyncInboxOptions,
): Promise<number> {
  const plan = await collectInboxSyncPhones(workspaceId);
  const phones = new Set<string>([...plan.priority, ...plan.rotating]);

  if (opts?.includeWatiContacts !== false) {
    for (const phone of await fetchAllWatiContactPhones(workspaceId)) phones.add(phone);
  }

  // One big V1 page per chat instead of paging V1 and V3: a sweep of hundreds of chats is bound by
  // request count, and a single page already covers more history than a catch-up needs.
  return syncWatiInboxForPhones(workspaceId, [...phones], {
    maxPages: opts?.maxPages ?? 1,
    pageSize: opts?.pageSize ?? 100,
    concurrency: opts?.concurrency ?? 12,
    skipV3: opts?.skipV3 ?? true,
  });
}

/**
 * Every contact WATI knows about — the only way to discover chats a customer started without us
 * having messaged them first, since WATI exposes no chat-list endpoint.
 */
async function fetchAllWatiContactPhones(workspaceId: string): Promise<string[]> {
  const conn = await getWatiConnectionForWorkspace(supabaseAdmin as any, workspaceId);
  if (!conn) return [];

  const headers = watiAuthHeaders(conn.api_key);
  const phones: string[] = [];
  const pageSize = 100;

  for (let page = 1; page <= 50; page++) {
    const url = `${watiApiV1Base(conn.tenant_id, conn.api_host)}/getContacts?pageSize=${pageSize}&pageNumber=${page}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn("[wati-v1] getContacts failed", { status: res.status, page });
        break;
      }

      const json = (await res.json()) as Record<string, unknown>;
      const list = Array.isArray(json.contact_list)
        ? (json.contact_list as Array<Record<string, unknown>>)
        : [];
      if (list.length === 0) break;

      for (const contact of list) {
        const phone = normalizeWhatsAppPhone(String(contact.phone ?? contact.wAid ?? ""));
        if (phone) phones.push(phone);
      }
      if (list.length < pageSize) break;
    } catch (e) {
      console.warn("[wati-v1] getContacts error", { page, error: (e as Error).message });
      break;
    }
  }

  return [...new Set(phones)];
}
