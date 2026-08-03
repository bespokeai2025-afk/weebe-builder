import { findLeadByPhone, normalizeWhatsAppPhone, phoneTail } from "@/lib/whatsapp/wati-campaign.server";

export type WaContactMessageStats = {
  outbound_count: number;
  inbound_count: number;
  total_count: number;
  last_outbound_at: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  messaged: boolean;
  last_outbound_status: string | null;
  last_campaign_id: string | null;
  last_campaign_name: string | null;
  delivered_count: number;
  read_count: number;
  failed_count: number;
};

const EMPTY_STATS: WaContactMessageStats = {
  outbound_count: 0,
  inbound_count: 0,
  total_count: 0,
  last_outbound_at: null,
  last_inbound_at: null,
  last_message_at: null,
  messaged: false,
  last_outbound_status: null,
  last_campaign_id: null,
  last_campaign_name: null,
  delivered_count: 0,
  read_count: 0,
  failed_count: 0,
};

type MessageRow = {
  contact_phone: string;
  direction: string;
  sent_at: string;
  status?: string | null;
  campaign_id?: string | null;
};

function bumpMax(current: string | null, next: string): string {
  if (!current) return next;
  return new Date(next).getTime() >= new Date(current).getTime() ? next : current;
}

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? "sent").toLowerCase();
  if (s.includes("read")) return "read";
  if (s.includes("deliver")) return "delivered";
  if (s.includes("fail")) return "failed";
  if (s.includes("queue")) return "queued";
  return "sent";
}

export function aggregateWaMessageStatsByPhone(
  messages: MessageRow[],
  campaignNames: Map<string, string>,
): Map<string, WaContactMessageStats> {
  const byExact = new Map<string, WaContactMessageStats>();

  const sorted = [...messages].sort(
    (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
  );

  for (const row of sorted) {
    const phone = normalizeWhatsAppPhone(row.contact_phone);
    if (!phone) continue;

    const prev = byExact.get(phone) ?? { ...EMPTY_STATS };
    const stats: WaContactMessageStats = {
      ...prev,
      total_count: prev.total_count + 1,
      last_message_at: bumpMax(prev.last_message_at, row.sent_at),
      messaged: prev.messaged,
    };

    if (row.direction === "outbound") {
      stats.outbound_count = prev.outbound_count + 1;
      const st = normalizeStatus(row.status);
      if (st === "delivered") stats.delivered_count = prev.delivered_count + 1;
      if (st === "read") stats.read_count = prev.read_count + 1;
      if (st === "failed") stats.failed_count = prev.failed_count + 1;

      if (!prev.last_outbound_at) {
        stats.last_outbound_at = row.sent_at;
        stats.last_outbound_status = st;
        if (row.campaign_id) {
          stats.last_campaign_id = String(row.campaign_id);
          stats.last_campaign_name = campaignNames.get(String(row.campaign_id)) ?? null;
        }
      } else {
        stats.last_outbound_at = prev.last_outbound_at;
        stats.last_outbound_status = prev.last_outbound_status;
        stats.last_campaign_id = prev.last_campaign_id;
        stats.last_campaign_name = prev.last_campaign_name;
      }
      stats.messaged = true;
    } else if (row.direction === "inbound") {
      stats.inbound_count = prev.inbound_count + 1;
      stats.last_inbound_at = bumpMax(prev.last_inbound_at, row.sent_at);
    }

    byExact.set(phone, stats);
  }

  return byExact;
}

export function buildWaMessageStatsTailIndex(
  byExact: Map<string, WaContactMessageStats>,
): Map<string, WaContactMessageStats> {
  const byTail = new Map<string, WaContactMessageStats>();
  for (const [phone, stats] of byExact) {
    const tail = phoneTail(phone);
    if (tail && !byTail.has(tail)) byTail.set(tail, stats);
  }
  return byTail;
}

export function lookupWaContactMessageStats(
  phone: string | null | undefined,
  byExact: Map<string, WaContactMessageStats>,
  byTail: Map<string, WaContactMessageStats>,
): WaContactMessageStats {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return { ...EMPTY_STATS };
  const exact = byExact.get(normalized);
  if (exact) return exact;
  const tail = phoneTail(normalized);
  if (tail && byTail.has(tail)) return byTail.get(tail)!;
  return { ...EMPTY_STATS };
}

export function isPhoneAlreadyMessaged(
  phone: string,
  byExact: Map<string, WaContactMessageStats>,
  byTail: Map<string, WaContactMessageStats>,
): boolean {
  return lookupWaContactMessageStats(phone, byExact, byTail).messaged;
}

async function fetchCampaignNameMap(
  sb: { from: (t: string) => any },
  workspaceId: string,
  campaignIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(campaignIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data } = await sb
      .from("whatsapp_campaigns")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .in("id", chunk);
    for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
      map.set(String(row.id), row.name);
    }
  }
  return map;
}

export async function fetchWorkspaceMessageStatsMaps(
  sb: { from: (t: string) => any },
  workspaceId: string,
): Promise<{
  byExact: Map<string, WaContactMessageStats>;
  byTail: Map<string, WaContactMessageStats>;
}> {
  const { data, error } = await sb
    .from("whatsapp_messages")
    .select("contact_phone, direction, sent_at, status, campaign_id")
    .eq("workspace_id", workspaceId)
    .order("sent_at", { ascending: false })
    .limit(25000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as MessageRow[];
  const campaignIds = rows
    .map((r) => (r.campaign_id ? String(r.campaign_id) : null))
    .filter(Boolean) as string[];
  const campaignNames = await fetchCampaignNameMap(sb, workspaceId, campaignIds);
  const byExact = aggregateWaMessageStatsByPhone(rows, campaignNames);
  return { byExact, byTail: buildWaMessageStatsTailIndex(byExact) };
}

export async function markWhatsappContactsMessaged(
  sb: { from: (t: string) => any },
  workspaceId: string,
  phones: string[],
): Promise<void> {
  const normalized = [
    ...new Set(phones.map((p) => normalizeWhatsAppPhone(p)).filter((p) => p.length >= 7)),
  ];
  if (normalized.length === 0) return;

  const now = new Date().toISOString();
  for (let i = 0; i < normalized.length; i += 200) {
    const chunk = normalized.slice(i, i + 200);
    await sb
      .from("whatsapp_contacts")
      .update({ lead_status: "contacted", updated_at: now })
      .eq("workspace_id", workspaceId)
      .in("phone", chunk);
  }
}

export async function markWhatsappContactDoNotContact(
  sb: { from: (t: string) => any },
  workspaceId: string,
  phone: string,
  contactName?: string | null,
): Promise<void> {
  const normalized = normalizeWhatsAppPhone(phone);
  if (!normalized) return;
  const now = new Date().toISOString();

  const { data: existing } = await sb
    .from("whatsapp_contacts")
    .select("id, tags")
    .eq("workspace_id", workspaceId)
    .eq("phone", normalized)
    .maybeSingle();

  const tags = Array.from(
    new Set([...(existing?.tags ?? []), "dnc"].filter(Boolean)),
  );

  if (existing?.id) {
    await sb
      .from("whatsapp_contacts")
      .update({
        do_not_contact: true,
        lead_status: "lost",
        tags,
        updated_at: now,
      })
      .eq("id", existing.id);
  } else {
    await sb.from("whatsapp_contacts").insert({
      workspace_id: workspaceId,
      phone: normalized,
      name: contactName ?? null,
      do_not_contact: true,
      lead_status: "lost",
      tags,
      source: "webhook",
    });
  }

  const lead = await findLeadByPhone(sb, workspaceId, normalized);
  if (lead?.id) {
    await sb
      .from("leads")
      .update({ whatsapp_opt_in: false, status: "do_not_call", updated_at: now })
      .eq("id", lead.id);
  }
}

export async function countAlreadyMessagedPhones(
  phones: string[],
  byExact: Map<string, WaContactMessageStats>,
  byTail: Map<string, WaContactMessageStats>,
): Promise<number> {
  let count = 0;
  const seen = new Set<string>();
  for (const p of phones) {
    const n = normalizeWhatsAppPhone(p);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    if (isPhoneAlreadyMessaged(n, byExact, byTail)) count++;
  }
  return count;
}

export async function loadWorkspaceDncPhones(
  sb: { from: (t: string) => any },
  workspaceId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  const { data, error } = await sb
    .from("whatsapp_contacts")
    .select("phone")
    .eq("workspace_id", workspaceId)
    .eq("do_not_contact", true)
    .limit(10000);
  if (error) {
    if (String(error.message).includes("do_not_contact")) return set;
    throw new Error(error.message);
  }
  for (const row of (data ?? []) as Array<{ phone: string }>) {
    const p = normalizeWhatsAppPhone(row.phone);
    if (p) set.add(p);
  }
  return set;
}
