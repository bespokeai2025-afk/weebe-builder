/**
 * BuzzChat campaign-lead pipeline — stages, qualification, inbox queue.
 * Shared by Inbox, Contacts, CSV import, and lead-sync.
 */

export const CAMPAIGN_LEAD_STAGES = [
  "new_response",
  "contacted",
  "engaged",
  "qualified",
  "assigned",
  "follow_up",
  "converted",
  "closed",
] as const;

export type CampaignLeadStage = (typeof CAMPAIGN_LEAD_STAGES)[number];

export const CAMPAIGN_LEAD_STAGE_LABELS: Record<CampaignLeadStage, string> = {
  new_response: "New response",
  contacted: "Contacted",
  engaged: "Engaged",
  qualified: "Qualified",
  assigned: "Assigned",
  follow_up: "Follow-up",
  converted: "Converted",
  closed: "Closed",
};

export const DEFAULT_CAMPAIGN_LEAD_STAGE: CampaignLeadStage = "new_response";

export function isCampaignLeadStage(value: unknown): value is CampaignLeadStage {
  return (
    typeof value === "string" &&
    (CAMPAIGN_LEAD_STAGES as readonly string[]).includes(value)
  );
}

export type CampaignIntent = "sell" | "rent" | "both" | "";

export interface CampaignQualification {
  intent: CampaignIntent;
  asking_price: string;
  rental_price: string;
  availability: string;
  property_status: string;
  viewing_availability: string;
  notes: string;
}

export const EMPTY_CAMPAIGN_QUALIFICATION: CampaignQualification = {
  intent: "",
  asking_price: "",
  rental_price: "",
  availability: "",
  property_status: "",
  viewing_availability: "",
  notes: "",
};

const QUALIFICATION_KEY = "qualification";

export function readCampaignQualification(
  meta: Record<string, unknown> | null | undefined,
): CampaignQualification {
  const raw = meta && typeof meta === "object" ? meta[QUALIFICATION_KEY] : null;
  if (!raw || typeof raw !== "object") return { ...EMPTY_CAMPAIGN_QUALIFICATION };
  const q = raw as Record<string, unknown>;
  const intent = q.intent === "sell" || q.intent === "rent" || q.intent === "both" ? q.intent : "";
  return {
    intent,
    asking_price: String(q.asking_price ?? "").trim(),
    rental_price: String(q.rental_price ?? "").trim(),
    availability: String(q.availability ?? "").trim(),
    property_status: String(q.property_status ?? "").trim(),
    viewing_availability: String(q.viewing_availability ?? "").trim(),
    notes: String(q.notes ?? "").trim(),
  };
}

export function writeCampaignQualification(
  meta: Record<string, unknown> | null | undefined,
  qualification: CampaignQualification,
): Record<string, unknown> {
  return { ...(meta ?? {}), [QUALIFICATION_KEY]: qualification };
}

export function formatCampaignRequirement(q: CampaignQualification): string {
  if (q.intent === "sell") return q.asking_price ? `Sell · ${q.asking_price}` : "Sell";
  if (q.intent === "rent") return q.rental_price ? `Rent · ${q.rental_price}` : "Rent";
  if (q.intent === "both") {
    const bits = [q.asking_price && `Sell ${q.asking_price}`, q.rental_price && `Rent ${q.rental_price}`].filter(
      Boolean,
    );
    return bits.length ? `Both · ${bits.join(" · ")}` : "Sell & rent";
  }
  return "";
}

export function nextStageOnOutbound(current: string | null | undefined): CampaignLeadStage | null {
  if (!current || current === "new_response") return "contacted";
  return null;
}

export function nextStageOnInboundReply(current: string | null | undefined): CampaignLeadStage | null {
  if (current === "contacted") return "engaged";
  return null;
}

export type InboxQueueFilter =
  | "all"
  | "needs_reply"
  | "waiting"
  | "active"
  | "expired"
  | "closed";

export const INBOX_QUEUE_FILTERS: Array<{ id: InboxQueueFilter; label: string; hint: string }> = [
  { id: "all", label: "All", hint: "Every conversation" },
  { id: "needs_reply", label: "Needs reply", hint: "Client wrote last — reply now" },
  { id: "waiting", label: "Waiting", hint: "You wrote last, window still open" },
  { id: "active", label: "Active", hint: "Open 24h session" },
  { id: "expired", label: "Expired", hint: "24h window closed — send a template" },
  { id: "closed", label: "Closed", hint: "Marked done" },
];

export function threadMatchesInboxQueue(
  thread: {
    lastDirection?: string | null;
    needsReply?: boolean;
    status?: string | null;
    expired?: boolean;
  },
  filter: InboxQueueFilter,
): boolean {
  if (filter === "all") return true;
  const solved = thread.status === "solved";
  const needsReply = thread.needsReply === true || thread.lastDirection === "inbound";
  if (filter === "needs_reply") return needsReply && !solved;
  if (filter === "waiting") return !needsReply && !solved && !thread.expired;
  if (filter === "active") return !solved && !thread.expired;
  if (filter === "expired") return Boolean(thread.expired) && !solved;
  if (filter === "closed") return solved;
  return true;
}

export function propertyLabelFromMeta(meta: Record<string, unknown> | null | undefined): string {
  if (!meta || typeof meta !== "object") return "";
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = meta[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  };
  const building = pick("Building", "BuildingName 2", "Building 1");
  const unit = pick("UnitNumber", "property_number", "Unit");
  const project = pick("Master Project", "Project");
  const type = pick("Property Type", "Sub Type");
  return [project, building, unit, type].filter(Boolean).join(" · ");
}

export function parseCampaignIntent(raw: string | null | undefined): CampaignIntent {
  const s = String(raw ?? "").toLowerCase().trim();
  if (!s) return "";
  if (s === "both" || (s.includes("sell") && s.includes("rent"))) return "both";
  if (s === "sell" || s === "selling" || s === "sale" || s === "to sell") return "sell";
  if (s === "rent" || s === "rental" || s === "lease" || s === "to rent" || s === "to let") return "rent";
  return "";
}

export function parseCsvTags(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Seed qualification from CSV columns (Requirement, Asking Price, Rental Price). */
export function qualificationFromImportMeta(
  meta: Record<string, string> | null | undefined,
): CampaignQualification {
  const q = { ...EMPTY_CAMPAIGN_QUALIFICATION };
  if (!meta) return q;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = meta[key];
      if (v?.trim()) return v.trim();
    }
    return "";
  };
  q.intent = parseCampaignIntent(pick("Requirement", "Intent", "Looking To"));
  q.asking_price = pick("Asking Price", "Sale Price", "Selling Price", "Transaction Amount");
  q.rental_price = pick("Rental Price", "Rent", "Rent Price");
  q.property_status = pick("Completion Status", "Property Status");
  q.availability = pick("Availability", "Available From");
  return q;
}

/** Free-text is allowed only inside the 24h window after the client's last inbound message. */
export function isWhatsappFreeTextAllowed(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const ms = Date.parse(lastInboundAt);
  if (Number.isNaN(ms)) return false;
  return now - ms <= 24 * 60 * 60 * 1000;
}
