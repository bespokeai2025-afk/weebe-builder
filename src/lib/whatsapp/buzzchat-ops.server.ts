import { normalizeWhatsAppPhone } from "@/lib/whatsapp/wati-campaign.server";
import {
  countAlreadyMessagedPhones,
  fetchWorkspaceMessageStatsMaps,
  isPhoneAlreadyMessaged,
  loadWorkspaceDncPhones,
} from "@/lib/whatsapp/wa-contact-message-stats.server";

export type BuzzchatAudienceFilterResult = {
  leads: Array<Record<string, unknown>>;
  skippedDnc: number;
  skippedOverlap: number;
  totalBeforeFilter: number;
};

export async function filterBuzzchatCampaignLeads(
  sb: { from: (t: string) => any },
  workspaceId: string,
  leads: Array<Record<string, unknown>>,
  options: { allowOverlap?: boolean } = {},
): Promise<BuzzchatAudienceFilterResult> {
  const totalBeforeFilter = leads.length;
  const dncSet = await loadWorkspaceDncPhones(sb, workspaceId);
  const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);

  let skippedDnc = 0;
  let eligible = leads.filter((lead) => {
    const phone = normalizeWhatsAppPhone(String(lead.phone ?? ""));
    if (!phone) {
      skippedDnc++;
      return false;
    }
    if (dncSet.has(phone) || String(lead.status ?? "") === "do_not_call") {
      skippedDnc++;
      return false;
    }
    return true;
  });

  let skippedOverlap = 0;
  if (!options.allowOverlap) {
    const before = eligible.length;
    eligible = eligible.filter((lead) => {
      const phone = normalizeWhatsAppPhone(String(lead.phone ?? ""));
      return !isPhoneAlreadyMessaged(phone, byExact, byTail);
    });
    skippedOverlap = before - eligible.length;
  }

  return {
    leads: eligible,
    skippedDnc,
    skippedOverlap,
    totalBeforeFilter,
  };
}

export type BuzzchatOpsToday = {
  sent: number;
  failed: number;
  delivered: number;
  read: number;
  inbound: number;
  warmupDay: number | null;
  dailyCap: number | null;
  sentToday: number | null;
  remaining: number | null;
};

export async function getBuzzchatTodayStats(
  sb: { from: (t: string) => any },
  workspaceId: string,
): Promise<Omit<BuzzchatOpsToday, "warmupDay" | "dailyCap" | "sentToday" | "remaining">> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();

  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("direction, status, sent_at")
    .eq("workspace_id", workspaceId)
    .gte("sent_at", since)
    .limit(10000);
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;
  let delivered = 0;
  let read = 0;
  let inbound = 0;

  for (const row of (data ?? []) as Array<{ direction: string; status: string }>) {
    if (row.direction === "inbound") {
      inbound++;
      continue;
    }
    const st = String(row.status ?? "").toLowerCase();
    sent++;
    if (st.includes("fail")) failed++;
    else if (st.includes("read")) read++;
    else if (st.includes("deliver")) delivered++;
  }

  return { sent, failed, delivered, read, inbound };
}

export async function checkCampaignAudienceOverlap(
  sb: { from: (t: string) => any },
  workspaceId: string,
  phones: string[],
): Promise<{ total: number; alreadyMessaged: number; dnc: number; phones: string[] }> {
  const normalized = [
    ...new Set(phones.map((p) => normalizeWhatsAppPhone(p)).filter((p) => p.length >= 7)),
  ];

  const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
  const alreadyMessaged = await countAlreadyMessagedPhones(normalized, byExact, byTail);

  let dnc = 0;
  for (let i = 0; i < normalized.length; i += 200) {
    const chunk = normalized.slice(i, i + 200);
    const { data } = await sb
      .from("whatsapp_contacts")
      .select("phone, do_not_contact")
      .eq("workspace_id", workspaceId)
      .in("phone", chunk);
    for (const row of (data ?? []) as Array<{ phone: string; do_not_contact?: boolean }>) {
      if (row.do_not_contact) dnc++;
    }
  }

  return {
    total: normalized.length,
    alreadyMessaged,
    dnc,
    phones: normalized,
  };
}

export function buildBuzzchatExportCsv(
  contacts: Array<Record<string, unknown>>,
): string {
  const header =
    "name,phone,messaged,outbound_count,inbound_count,last_outbound_status,last_campaign,last_messaged_at,last_reply_at,do_not_contact,lead_status,source";
  const rows = contacts.map((c) => {
    const stats = c.wa_stats as Record<string, unknown> | undefined;
    const values = [
      c.name,
      c.phone,
      stats?.messaged ? "yes" : "no",
      stats?.outbound_count ?? 0,
      stats?.inbound_count ?? 0,
      stats?.last_outbound_status ?? "",
      stats?.last_campaign_name ?? "",
      stats?.last_outbound_at ?? "",
      stats?.last_inbound_at ?? "",
      c.do_not_contact ? "yes" : "no",
      c.lead_status ?? "",
      c.source ?? "",
    ];
    return values.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
  });
  return [header, ...rows].join("\n");
}
