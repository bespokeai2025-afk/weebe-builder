/**
 * Reconcile WATI message delivery/read status via API + webhook helpers.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { watiApiV1Base, watiApiV3Base } from "@/lib/whatsapp/wati-api-base.shared";
import { normalizeWhatsAppPhone, phoneTail } from "@/lib/whatsapp/wati-campaign.server";

const STATUS_ORDER: Record<string, number> = {
  failed: -1,
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function mapWatiStatusString(raw: unknown): string | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("replied")) return "replied";
  if (s.includes("read")) return "read";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("fail")) return "failed";
  if (s.includes("sent")) return "sent";
  if (s.includes("queue")) return "queued";
  return null;
}

/**
 * Same mapping, coerced to the message_status enum (queued|sent|delivered|read|failed).
 *
 * WATI reports "REPLIED" as a status, which has no enum member — writing it raw fails the insert
 * and silently drops the row. A reply proves the message was read, so it lands on "read"; keep the
 * raw WATI string in whatsapp_messages.wati_status when the distinction matters.
 */
export function mapWatiStatusToDbStatus(raw: unknown): string | null {
  const mapped = mapWatiStatusString(raw);
  if (!mapped) return null;
  return mapped === "replied" ? "read" : mapped;
}

export function shouldApplyMessageStatus(current: string, next: string): boolean {
  if (next === "failed") return current !== "read" && current !== "delivered";
  const cur = STATUS_ORDER[current] ?? 0;
  const nxt = STATUS_ORDER[next] ?? 0;
  return nxt > cur;
}

export function extractWatiWebhookPhone(payload: Record<string, unknown>): string | null {
  const raw =
    payload.waId ??
    payload.phone ??
    payload.phone_number ??
    payload.from ??
    (payload.contact as Record<string, unknown> | undefined)?.phone ??
    null;
  if (!raw) return null;
  const phone = normalizeWhatsAppPhone(String(raw));
  return phone || null;
}

export function isWatiTemplateSentEvent(payload: Record<string, unknown>): boolean {
  const t = String(payload.eventType ?? payload.type ?? payload.event ?? "").toLowerCase();
  return t.includes("templatemessagesent");
}

/** Match outbound row by phone (exact + tail), most recent sent/delivered first. */
async function findRecentOutboundByPhone(
  workspaceId: string,
  phone: string,
): Promise<{
  id: string;
  status: string;
  campaign_id: string | null;
  external_id: string | null;
  contact_phone: string;
} | null> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return null;

  const base = () =>
    sb()
      .from("whatsapp_messages")
      .select("id, status, campaign_id, external_id, contact_phone")
      .eq("workspace_id", workspaceId)
      .eq("direction", "outbound")
      .eq("provider", "wati");

  const { data: exact } = await base()
    .eq("contact_phone", normalized)
    .in("status", ["sent", "delivered"])
    .order("sent_at", { ascending: false })
    .limit(1);
  if (exact?.[0]) return exact[0];

  const tail = phoneTail(normalized);
  if (!tail) return null;

  const { data: recent } = await base()
    .in("status", ["sent", "delivered"])
    .order("sent_at", { ascending: false })
    .limit(30);
  return (
    (recent ?? []).find((r: { contact_phone: string }) =>
      normalizeWhatsAppPhone(r.contact_phone).endsWith(tail),
    ) ?? null
  );
}

/**
 * templateMessageSent_v2 carries WATI's real localMessageId + waId.
 * READ/DELIVERED webhooks only include localMessageId — link it here first.
 */
export async function linkOutboundMessageToWatiLocalId(
  workspaceId: string,
  watiLocalMessageId: string,
  phone: string,
  whatsappMessageId?: string | null,
): Promise<boolean> {
  const localId = String(watiLocalMessageId ?? "").trim();
  if (!localId) return false;

  const row = await findRecentOutboundByPhone(workspaceId, phone);
  if (!row) return false;

  const patch: Record<string, unknown> = {};
  if (row.external_id !== localId) patch.external_id = localId;
  const wamid = whatsappMessageId ? String(whatsappMessageId).trim() : "";
  if (wamid) patch.whatsapp_message_id = wamid;

  if (Object.keys(patch).length === 0) return true;

  await sb()
    .from("whatsapp_messages")
    .update(patch)
    .eq("id", row.id);
  return true;
}

type WatiConn = {
  api_key: string;
  tenant_id: string;
  api_host: string | null;
};

function sb() {
  return supabaseAdmin as any;
}

async function getWatiConn(workspaceId: string): Promise<WatiConn | null> {
  const { data } = await sb()
    .from("wati_connections")
    .select("api_key, tenant_id, api_host, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "connected")
    .maybeSingle();
  if (!data?.api_key || !data?.tenant_id) return null;
  return data as WatiConn;
}

async function refreshCampaignStatsForMessage(
  workspaceId: string,
  campaignId: string,
): Promise<void> {
  const { data: campaignMsgs } = await sb()
    .from("whatsapp_messages")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("campaign_id", campaignId)
    .eq("direction", "outbound");

  const outbound = (campaignMsgs ?? []) as Array<{ status: string }>;
  const sent = outbound.length;
  const delivered = outbound.filter((m) => ["delivered", "read"].includes(m.status)).length;
  const read = outbound.filter((m) => m.status === "read").length;

  const { data: campaign } = await sb()
    .from("whatsapp_campaigns")
    .select("stats")
    .eq("id", campaignId)
    .maybeSingle();

  const prevStats = (campaign?.stats ?? {}) as Record<string, unknown>;
  await sb()
    .from("whatsapp_campaigns")
    .update({
      stats: { ...prevStats, sent, delivered, read },
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);
}

export async function applyWatiMessageStatusToRow(opts: {
  workspaceId: string;
  messageId: string;
  currentStatus: string;
  newStatus: string;
  campaignId?: string | null;
  whatsappMessageId?: string | null;
}): Promise<boolean> {
  if (!shouldApplyMessageStatus(opts.currentStatus, opts.newStatus)) return false;

  const patch: Record<string, unknown> = { status: opts.newStatus };
  const wamid = opts.whatsappMessageId ? String(opts.whatsappMessageId).trim() : "";
  if (wamid) patch.whatsapp_message_id = wamid;

  await sb()
    .from("whatsapp_messages")
    .update(patch)
    .eq("id", opts.messageId);

  if (opts.campaignId) {
    await refreshCampaignStatsForMessage(opts.workspaceId, opts.campaignId);
  }
  return true;
}

/** Find outbound row by localMessageId, whatsappMessageId, or latest send to phone. */
export async function findOutboundMessageForWatiStatus(
  workspaceId: string,
  trackingId: string | null,
  phone: string | null,
  whatsappMessageId?: string | null,
): Promise<{
  id: string;
  status: string;
  campaign_id: string | null;
  external_id: string | null;
  contact_phone: string;
} | null> {
  const base = () =>
    sb()
      .from("whatsapp_messages")
      .select("id, status, campaign_id, external_id, contact_phone, whatsapp_message_id")
      .eq("workspace_id", workspaceId)
      .eq("direction", "outbound")
      .eq("provider", "wati");

  if (trackingId) {
    const { data: byExternal } = await base().eq("external_id", trackingId).maybeSingle();
    if (byExternal) return byExternal;
  }

  const wamid = whatsappMessageId ? String(whatsappMessageId).trim() : "";
  if (wamid) {
    const { data: byWamid } = await base().eq("whatsapp_message_id", wamid).maybeSingle();
    if (byWamid) return byWamid;

    const { data: byExtWamid } = await base().eq("external_id", wamid).maybeSingle();
    if (byExtWamid) return byExtWamid;
  }

  // READ/DELIVERED v2 webhooks omit waId — phone fallback only helps v1 / templateMessageSent.
  if (phone) {
    const match = await findRecentOutboundByPhone(workspaceId, phone);
    if (match) return match;
  }

  return null;
}

async function reconcileViaV3ConversationMessages(
  conn: WatiConn,
  workspaceId: string,
  msg: { id: string; contact_phone: string; status: string; campaign_id: string | null; external_id?: string | null },
): Promise<boolean> {
  const phone = normalizeWhatsAppPhone(msg.contact_phone);
  if (!phone) return false;

  const headers = {
    Authorization: `Bearer ${conn.api_key.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };

  const phoneVariants = [phone];
  if (phone.startsWith("44") && phone.length > 10) phoneVariants.push(phone.slice(2));
  if (!phone.startsWith("44") && phone.length >= 10) phoneVariants.push(`44${phone}`);

  for (const variant of phoneVariants) {
    const url = `${watiApiV3Base(conn.api_host)}/conversations/${encodeURIComponent(variant)}/messages?page_number=1&page_size=20`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;

      const json = (await res.json()) as Record<string, unknown>;
      const list = (json.message_list ?? json.messages ?? json.data ?? []) as Array<
        Record<string, unknown>
      >;

      const outbound = list.filter((m) => {
        if (m.owner === false) return false;
        const type = String(m.type ?? "").toLowerCase();
        return type !== "ticket";
      });

      const localId = String(msg.external_id ?? "").trim();
      let match =
        (localId
          ? outbound.find(
              (m) =>
                String(m.local_message_id ?? m.localMessageId ?? "") === localId ||
                String(m.local_message_id ?? m.localMessageId ?? "").endsWith(localId),
            )
          : null) ?? outbound[0];

      if (!match) continue;

      const newStatus = mapWatiStatusString(
        match.statusString ?? match.status ?? match.messageStatus,
      );
      if (!newStatus) continue;

      const wamid = String(match.whatsapp_message_id ?? match.whatsappMessageId ?? "").trim();
      const watiLocalId = String(match.local_message_id ?? match.localMessageId ?? "").trim();

      const applied = await applyWatiMessageStatusToRow({
        workspaceId,
        messageId: msg.id,
        currentStatus: msg.status,
        newStatus,
        campaignId: msg.campaign_id,
        whatsappMessageId: wamid || null,
      });

      if (applied && watiLocalId && watiLocalId !== msg.external_id) {
        await sb()
          .from("whatsapp_messages")
          .update({ external_id: watiLocalId })
          .eq("id", msg.id);
      }
      return applied;
    } catch {
      continue;
    }
  }

  return false;
}

/** Poll WATI for delivery/read on recent outbound rows (webhook fallback). */
export async function reconcileWatiOutboundMessageStatuses(workspaceId: string): Promise<number> {
  const conn = await getWatiConn(workspaceId);
  if (!conn) return 0;

  const { data: msgs } = await sb()
    .from("whatsapp_messages")
    .select("id, external_id, contact_phone, status, campaign_id")
    .eq("workspace_id", workspaceId)
    .eq("direction", "outbound")
    .eq("provider", "wati")
    .in("status", ["sent", "delivered"])
    .not("external_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(100);

  let updated = 0;
  const headers = {
    Authorization: `Bearer ${conn.api_key.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };

  for (const msg of msgs ?? []) {
    const localId = String(msg.external_id ?? "");
    const phone = normalizeWhatsAppPhone(msg.contact_phone);
    if (!phone) continue;

    let applied = false;

    if (localId && !localId.startsWith("wati_")) {
      const url = `${watiApiV1Base(conn.tenant_id, conn.api_host)}/whatsApp/messages/${encodeURIComponent(phone)}/${encodeURIComponent(localId)}`;
      try {
        const res = await fetch(url, { headers });
        if (res.ok) {
          const json = (await res.json()) as { result?: { statusString?: string } };
          const newStatus = mapWatiStatusString(json.result?.statusString);
          if (newStatus) {
            applied = await applyWatiMessageStatusToRow({
              workspaceId,
              messageId: msg.id,
              currentStatus: msg.status,
              newStatus,
              campaignId: msg.campaign_id,
              whatsappMessageId:
                (json.result as { whatsappMessageId?: string } | undefined)?.whatsappMessageId ??
                null,
            });
          }
        }
      } catch {
        /* try V3 fallback */
      }
    }

    if (!applied) {
      applied = await reconcileViaV3ConversationMessages(conn, workspaceId, msg);
    }

    if (applied) updated++;
  }

  return updated;
}
