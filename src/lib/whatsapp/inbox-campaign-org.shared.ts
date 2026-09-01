/**
 * Campaign / Area organisation for the BuzzChat General Inbox.
 * Pure helpers — used by the inbox list and tests.
 */

export const ARCHIVED_CAMPAIGN_STATUSES = new Set(["completed", "failed", "cancelled", "stopped"]);

export type InboxCampaignScope = "all" | "active" | "archive";

export function isArchivedCampaignStatus(status: string | null | undefined): boolean {
  return ARCHIVED_CAMPAIGN_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function areaFromPropertyMeta(
  meta: Record<string, unknown> | null | undefined,
): string {
  if (!meta || typeof meta !== "object") return "";
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const collapse = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
      const want = collapse(key);
      const direct = meta[key];
      if (direct != null && String(direct).trim()) return String(direct).trim();
      for (const [k, v] of Object.entries(meta)) {
        if (collapse(k) === want && v != null && String(v).trim()) {
          return String(v).trim();
        }
      }
    }
    return "";
  };
  return pick(
    "Master Location",
    "Master Project",
    "Project",
    "community",
    "Area",
    "Location",
  );
}

export function lastCampaignIdFromMessages(
  messages: Array<{ campaign_id?: unknown; direction?: unknown; sent_at?: unknown }>,
): string | null {
  if (!messages.length) return null;
  const withCampaign = messages.filter((m) => String(m.campaign_id ?? "").trim());
  if (withCampaign.length === 0) return null;
  const outbound = withCampaign.filter((m) => m.direction === "outbound");
  const pool = outbound.length > 0 ? outbound : withCampaign;
  const latest = [...pool].sort(
    (a, b) => new Date(String(b.sent_at ?? 0)).getTime() - new Date(String(a.sent_at ?? 0)).getTime(),
  )[0];
  const id = String(latest?.campaign_id ?? "").trim();
  return id || null;
}

export function campaignIdsFromMessages(
  messages: Array<{ campaign_id?: unknown }>,
): string[] {
  return [
    ...new Set(
      messages.map((m) => String(m.campaign_id ?? "").trim()).filter(Boolean),
    ),
  ];
}

export function phoneLookupVariants(phone: string | null | undefined): string[] {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  return [...new Set([raw, digits, digits ? `+${digits}` : ""].filter(Boolean))];
}

export function threadMatchesInboxOrg(
  thread: {
    lastCampaignId?: string | null;
    campaignIds?: string[];
    campaignArchived?: boolean;
    area?: string | null;
    status?: string | null;
  },
  filters: {
    scope?: InboxCampaignScope;
    campaignId?: string | null;
    area?: string | null;
  },
): boolean {
  if (filters.campaignId) {
    const ids = thread.campaignIds ?? (thread.lastCampaignId ? [thread.lastCampaignId] : []);
    if (!ids.includes(filters.campaignId)) return false;
  }
  if (filters.area && (thread.area ?? "") !== filters.area) return false;
  // A specific campaign was chosen from the scoped dropdown — don't hide it again.
  if (filters.campaignId) return true;
  if (filters.scope === "archive") {
    return thread.campaignArchived === true;
  }
  if (filters.scope === "active") {
    return thread.campaignArchived !== true;
  }
  return true;
}

export function mergeWhatsappMessageRows(
  groups: Array<Array<Record<string, unknown>>>,
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const group of groups) {
    for (const row of group) {
      const id = String(row.id ?? "").trim();
      const key =
        id ||
        `${String(row.contact_phone ?? "")}|${String(row.sent_at ?? "")}|${String(row.body ?? "")}|${String(row.direction ?? "")}`;
      if (!byKey.has(key)) byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      new Date(String(a.sent_at ?? 0)).getTime() - new Date(String(b.sent_at ?? 0)).getTime(),
  );
}
