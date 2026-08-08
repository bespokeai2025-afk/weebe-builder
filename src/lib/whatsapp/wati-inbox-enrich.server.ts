/**
 * Resolve inbox template shorthand via WATI V3 conversation messages API.
 * @see GET /api/ext/v3/conversations/{target}/messages
 */

import { watiApiV3Base } from "@/lib/whatsapp/wati-api-base.shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getWatiConnectionForWorkspace,
  normalizeWhatsAppPhone,
} from "@/lib/whatsapp/wati-campaign.server";

type WatiConn = {
  api_key: string;
  tenant_id: string;
  api_host: string | null;
};

export function buildWatiConversationPhoneVariants(phone: string): string[] {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return [];

  const variants = new Set<string>([normalized, `+${normalized}`]);

  if (normalized.startsWith("971") && normalized.length > 10) {
    variants.add(normalized.slice(3));
    variants.add(`+971${normalized.slice(3)}`);
  } else if (/^[0-9]{9}$/.test(normalized)) {
    variants.add(`971${normalized}`);
    variants.add(`+971${normalized}`);
  }

  if (normalized.startsWith("44") && normalized.length > 10) {
    variants.add(normalized.slice(2));
    variants.add(`+44${normalized.slice(2)}`);
  } else if (/^[0-9]{10}$/.test(normalized) && !normalized.startsWith("91")) {
    variants.add(`44${normalized}`);
  }

  if (normalized.startsWith("91") && normalized.length >= 12) {
    variants.add(normalized.slice(2));
    variants.add(`+91${normalized.slice(2)}`);
  } else if (/^[6-9][0-9]{9}$/.test(normalized)) {
    variants.add(`91${normalized}`);
    variants.add(`+91${normalized}`);
  }

  return [...variants];
}

/** Best-effort rendered body from a WATI conversation message row. */
export function extractWatiConversationMessageText(
  msg: Record<string, unknown>,
): string | null {
  const templateParams = msg.parameters ?? msg.customParams ?? msg.templateParameters;
  const templateName = msg.templateName ?? msg.template_name ?? msg.elementName;

  const candidates: unknown[] = [
    msg.text,
    msg.finalText,
    msg.messageText,
    msg.caption,
    msg.eventDescription,
    (msg.data as Record<string, unknown> | undefined)?.text,
    (msg.message as Record<string, unknown> | undefined)?.text,
    (msg.templateMessage as Record<string, unknown> | undefined)?.body,
    (msg.templateMessage as Record<string, unknown> | undefined)?.text,
    (msg.templateMessage as Record<string, unknown> | undefined)?.sentMessage,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const text = candidate.trim();
    if (!text) continue;
    if (text.startsWith("[Template:")) continue;
    return text;
  }

  if (templateName && Array.isArray(templateParams) && templateParams.length > 0) {
    const values = templateParams
      .map((p) => {
        if (typeof p === "string") return p.trim();
        if (p && typeof p === "object") {
          const row = p as Record<string, unknown>;
          return String(row.value ?? row.paramValue ?? row.text ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
    if (values.length > 0) {
      return values.join(" · ");
    }
  }

  return null;
}

function watiAuthHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };
}

export async function fetchWatiConversationMessages(
  conn: WatiConn,
  phone: string,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<Array<Record<string, unknown>>> {
  const pageSize = opts?.pageSize ?? 100;
  const maxPages = opts?.maxPages ?? 10;
  const headers = watiAuthHeaders(conn.api_key);
  const collected: Array<Record<string, unknown>> = [];

  for (const variant of buildWatiConversationPhoneVariants(phone)) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${watiApiV3Base(conn.tenant_id, conn.api_host)}/conversations/${encodeURIComponent(variant)}/messages?page_number=${page}&page_size=${pageSize}`;
      try {
        const res = await fetch(url, { headers });
        if (!res.ok) break;

        const json = (await res.json()) as Record<string, unknown>;
        const list = (json.message_list ?? json.messages ?? json.data ?? []) as Array<
          Record<string, unknown>
        >;
        if (list.length === 0) break;

        collected.push(...list);
        if (list.length < pageSize) break;
      } catch {
        break;
      }
    }

    if (collected.length > 0) break;
  }

  return collected;
}

function parseSentAtMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return value > 1e12 ? value : value * 1000;
  }
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

function isOutboundWatiMessage(msg: Record<string, unknown>): boolean {
  if (msg.owner === false) return false;
  const type = String(msg.type ?? "").toLowerCase();
  if (type === "ticket") return false;
  if (type === "interactive" || type === "text" || type === "template" || type === "image") {
    return true;
  }
  return msg.owner === true || extractWatiConversationMessageText(msg) != null;
}

/** Match a stored whatsapp_messages row to WATI conversation API text. */
export function matchWatiConversationMessageText(
  stored: {
    external_id?: unknown;
    whatsapp_message_id?: unknown;
    sent_at?: unknown;
    direction?: unknown;
  },
  watiMessages: Array<Record<string, unknown>>,
): string | null {
  const outbound = watiMessages.filter(isOutboundWatiMessage);
  if (outbound.length === 0) return null;

  const trackingId = String(
    stored.external_id ?? stored.whatsapp_message_id ?? "",
  ).trim();

  if (trackingId) {
    const byTracking = outbound.find((m) => {
      const wamid = String(m.whatsapp_message_id ?? m.whatsappMessageId ?? "").trim();
      const local = String(m.local_message_id ?? m.localMessageId ?? "").trim();
      const id = String(m.id ?? "").trim();
      return (
        trackingId === wamid ||
        trackingId === local ||
        trackingId === id ||
        (wamid && trackingId === wamid) ||
        (local && (local === trackingId || local.endsWith(trackingId) || trackingId.endsWith(local)))
      );
    });
    const text = byTracking ? extractWatiConversationMessageText(byTracking) : null;
    if (text) return text;
  }

  const wamid = String(stored.whatsapp_message_id ?? "").trim();
  if (wamid && wamid !== trackingId) {
    const byWamid = outbound.find((m) => {
      const id = String(m.whatsapp_message_id ?? m.whatsappMessageId ?? m.id ?? "").trim();
      return id === wamid;
    });
    const text = byWamid ? extractWatiConversationMessageText(byWamid) : null;
    if (text) return text;
  }

  const sentMs = parseSentAtMs(stored.sent_at);
  if (sentMs != null) {
    let best: { diff: number; text: string } | null = null;
    for (const m of outbound) {
      const text = extractWatiConversationMessageText(m);
      if (!text) continue;
      const msgMs =
        parseSentAtMs(m.timestamp) ??
        parseSentAtMs(m.created) ??
        parseSentAtMs(m.time);
      if (msgMs == null) continue;
      const diff = Math.abs(msgMs - sentMs);
      if (diff > 2 * 60 * 60 * 1000) continue;
      if (!best || diff < best.diff) best = { diff, text };
    }
    if (best) return best.text;
  }

  return null;
}

/** Pair stored shorthand rows to unused WATI outbound messages by closest timestamp. */
function matchWatiConversationMessageByUnusedIndex(
  stored: { sent_at?: unknown },
  watiMessages: Array<Record<string, unknown>>,
  usedIndexes: Set<number>,
): string | null {
  const sentMs = parseSentAtMs(stored.sent_at);
  if (sentMs == null) return null;

  let bestIdx = -1;
  let bestDiff = Number.POSITIVE_INFINITY;

  watiMessages.forEach((m, idx) => {
    if (usedIndexes.has(idx) || !isOutboundWatiMessage(m)) return;
    const text = extractWatiConversationMessageText(m);
    if (!text) return;
    const msgMs =
      parseSentAtMs(m.timestamp) ?? parseSentAtMs(m.created) ?? parseSentAtMs(m.time);
    if (msgMs == null) return;
    const diff = Math.abs(msgMs - sentMs);
    if (diff > 2 * 60 * 60 * 1000) return;
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = idx;
    }
  });

  if (bestIdx < 0) return null;
  usedIndexes.add(bestIdx);
  return extractWatiConversationMessageText(watiMessages[bestIdx]!);
}

export async function enrichInboxBodiesFromWatiApi(
  sb: { from: (t: string) => any },
  workspaceId: string,
  messages: Array<Record<string, unknown>>,
  isTemplateShorthand: (body: unknown) => body is string,
): Promise<void> {
  const unresolved = messages.filter((m) => isTemplateShorthand(m.body));
  if (unresolved.length === 0) return;

  const conn = await getWatiConnectionForWorkspace(sb, workspaceId);
  if (!conn) return;

  const byPhone = new Map<string, Array<Record<string, unknown>>>();
  for (const m of unresolved) {
    const phone = normalizeWhatsAppPhone(String(m.contact_phone ?? ""));
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone)!.push(m);
  }

  const conversationCache = new Map<string, Array<Record<string, unknown>>>();
  const dbUpdates: Array<{ id: string; body: string }> = [];

  for (const [phone, rows] of byPhone) {
    let watiMessages = conversationCache.get(phone);
    if (!watiMessages) {
      watiMessages = await fetchWatiConversationMessages(conn, phone, { maxPages: 10 });
      conversationCache.set(phone, watiMessages);
    }
    if (watiMessages.length === 0) continue;

    const sortedRows = [...rows].sort(
      (a, b) =>
        (parseSentAtMs(a.sent_at) ?? 0) - (parseSentAtMs(b.sent_at) ?? 0),
    );
    const usedWatiIndexes = new Set<number>();

    for (const row of sortedRows) {
      let resolved = matchWatiConversationMessageText(row, watiMessages);
      if (!resolved) {
        resolved = matchWatiConversationMessageByUnusedIndex(
          row,
          watiMessages,
          usedWatiIndexes,
        );
      }
      if (!resolved) continue;
      row.body = resolved;
      if (row.id) dbUpdates.push({ id: String(row.id), body: resolved });
    }
  }

  await Promise.all(
    dbUpdates.map(({ id, body }) =>
      (supabaseAdmin as any).from("whatsapp_messages").update({ body }).eq("id", id),
    ),
  );
}
