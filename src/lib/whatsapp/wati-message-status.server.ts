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
  if (s.includes("read")) return "read";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("fail")) return "failed";
  if (s.includes("sent")) return "sent";
  if (s.includes("queue")) return "queued";
  return null;
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
): Promise<boolean> {
  const localId = String(watiLocalMessageId ?? "").trim();
  if (!localId) return false;

  const row = await findRecentOutboundByPhone(workspaceId, phone);
  if (!row) return false;
  if (row.external_id === localId) return true;

  await sb()
    .from("whatsapp_messages")
    .update({ external_id: localId })
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
}): Promise<boolean> {
  if (!shouldApplyMessageStatus(opts.currentStatus, opts.newStatus)) return false;

  await sb()
    .from("whatsapp_messages")
    .update({ status: opts.newStatus })
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
      .select("id, status, campaign_id, external_id, contact_phone")
      .eq("workspace_id", workspaceId)
      .eq("direction", "outbound")
      .eq("provider", "wati");

  if (trackingId) {
    const { data: byExternal } = await base().eq("external_id", trackingId).maybeSingle();
    if (byExternal) return byExternal;

    // WATI sometimes sends whatsappMessageId before we stored it — match recent rows by phone next
  }

  if (phone) {
    const match = await findRecentOutboundByPhone(workspaceId, phone);
    if (match) return match;
  }

  return null;
}

async function reconcileViaV3ConversationMessages(
  conn: WatiConn,
  workspaceId: string,
  msg: { id: string; contact_phone: string; status: string; campaign_id: string | null },
): Promise<boolean> {
  const phone = normalizeWhatsAppPhone(msg.contact_phone);
  if (!phone) return false;

  const url = `${watiApiV3Base(conn.tenant_id, conn.api_host)}/conversations/${encodeURIComponent(phone)}/messages?page_number=1&page_size=15`;
  const headers = {
    Authorization: `Bearer ${conn.api_key.replace(/^Bearer\s+/i, "")}`,
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return false;
    const json = (await res.json()) as {
      message_list?: Array<{ owner?: boolean; status?: string; type?: string }>;
    };
    const outbound = (json.message_list ?? []).filter(
      (m) => m.owner === true && String(m.type ?? "").toLowerCase() !== "ticket",
    );
    const latest = outbound[0];
    if (!latest?.status) return false;

    const newStatus = mapWatiStatusString(latest.status);
    if (!newStatus) return false;

    return applyWatiMessageStatusToRow({
      workspaceId,
      messageId: msg.id,
      currentStatus: msg.status,
      newStatus,
      campaignId: msg.campaign_id,
    });
  } catch {
    return false;
  }
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
