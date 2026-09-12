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
  "no_activity",
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
  // Stored value stays "closed" (no data migration needed) — relabeled to
  // match the spec's terminology: this is where a lead lands when the
  // working relationship ends without a listing (cancelled / archived).
  closed: "Cancelled",
  no_activity: "No activity",
};

/** Stages that only exist on the listing board — never a sales-pipeline column. */
export const CAMPAIGN_ONLY_STAGES = new Set<string>([
  "new_response",
  "contacted",
  "engaged",
  "assigned",
  "converted",
  "closed",
  "no_activity",
]);

export const LISTING_STAGE_KEY = "listing_stage";
export const LISTING_OUTCOME_KEY = "listing_outcome";
export const LISTING_SLA_KEY = "listing_sla";

export const LISTING_OUTCOMES = [
  "interested",
  "qualified",
  "follow_up",
  "assigned",
  "converted",
  "lost",
  "not_interested",
  "already_sold_rented",
  "wrong_number",
  "duplicate",
  "no_response",
  "no_activity",
] as const;

export type ListingOutcome = (typeof LISTING_OUTCOMES)[number];

export const LISTING_OUTCOME_LABELS: Record<ListingOutcome, string> = {
  interested: "Interested",
  qualified: "Qualified",
  follow_up: "Follow-up",
  assigned: "Assigned",
  converted: "Converted (closed listing)",
  lost: "Lost",
  not_interested: "Not interested",
  already_sold_rented: "Already sold / rented",
  wrong_number: "Wrong number",
  duplicate: "Duplicate",
  no_response: "No response",
  no_activity: "No activity",
};

/**
 * The Remark dropdown shows only these four — the simple triage categories
 * from the spec ("Interested / Not Interested / No response / Sold or no
 * longer available"). The other LISTING_OUTCOMES values (qualified, assigned,
 * converted, etc.) remain valid stored values — "converted" in particular is
 * now driven by the Stage dropdown, not picked directly as a remark — so
 * existing data and any automation that still writes them keeps working;
 * only the human-facing dropdown is narrowed.
 */
export const SIMPLIFIED_LISTING_REMARKS = [
  "interested",
  "not_interested",
  "no_response",
  "already_sold_rented",
] as const satisfies readonly ListingOutcome[];

export type ListingOutcomeRecord = {
  status: ListingOutcome;
  at: string;
  by?: string | null;
  /** Optional free-text reason alongside the remark (e.g. why "Not interested"). */
  reason?: string | null;
};

export function isListingOutcome(value: unknown): value is ListingOutcome {
  return typeof value === "string" && (LISTING_OUTCOMES as readonly string[]).includes(value);
}

export function listingOutcomeToCampaignStage(outcome: ListingOutcome): CampaignLeadStage {
  switch (outcome) {
    case "interested":
      return "engaged";
    case "qualified":
      return "qualified";
    case "follow_up":
    case "no_response":
      return "follow_up";
    case "assigned":
      return "assigned";
    case "converted":
      return "converted";
    case "lost":
    case "not_interested":
    case "already_sold_rented":
    case "wrong_number":
    case "duplicate":
      return "closed";
    case "no_activity":
      return "no_activity";
  }
}

export function listingOutcomeToLeadStatus(outcome: ListingOutcome): string | null {
  switch (outcome) {
    case "interested":
      return "interested";
    case "qualified":
      return "qualified";
    case "converted":
      return "completed";
    case "not_interested":
    case "lost":
      return "not_interested";
    case "wrong_number":
    case "duplicate":
      return "do_not_call";
    default:
      return null;
  }
}

export function listingOutcomePromotesToSalesPipeline(outcome: ListingOutcome): boolean {
  return outcome === "converted";
}

/** Remarks that appear on the listing board. Closed / dead outcomes stay off it. */
export const ACTIVE_LISTING_OUTCOMES = [
  "interested",
  "qualified",
  "follow_up",
  "assigned",
] as const satisfies readonly ListingOutcome[];

export function isActiveListingOutcome(value: string | null | undefined): boolean {
  return (ACTIVE_LISTING_OUTCOMES as readonly string[]).includes(value ?? "");
}

/** Live remarked replies on the listing board — no per-remark chips, expired/closed stay out. */
export function belongsOnListingBoard(
  lead: { listing_outcome?: string | null; last_reply_at?: string | null },
  now: number = Date.now(),
): boolean {
  if (!isActiveListingOutcome(lead.listing_outcome)) return false;
  return isWhatsappFreeTextAllowed(lead.last_reply_at, now);
}

export function readListingStage(
  meta: Record<string, unknown> | null | undefined,
  pipelineStage?: string | null,
): CampaignLeadStage | null {
  const raw = meta && typeof meta === "object" ? meta[LISTING_STAGE_KEY] : null;
  if (isCampaignLeadStage(raw)) return raw;
  if (typeof pipelineStage === "string" && CAMPAIGN_ONLY_STAGES.has(pipelineStage)) {
    return pipelineStage as CampaignLeadStage;
  }
  return null;
}

export function writeListingStage(
  meta: Record<string, unknown> | null | undefined,
  stage: CampaignLeadStage,
): Record<string, unknown> {
  return { ...(meta ?? {}), [LISTING_STAGE_KEY]: stage };
}

export function readListingOutcome(
  meta: Record<string, unknown> | null | undefined,
): ListingOutcomeRecord | null {
  const raw = meta && typeof meta === "object" ? meta[LISTING_OUTCOME_KEY] : null;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!isListingOutcome(rec.status)) return null;
  return {
    status: rec.status,
    at: String(rec.at ?? ""),
    by: rec.by != null ? String(rec.by) : null,
    reason: rec.reason != null ? String(rec.reason) : null,
  };
}

export function writeListingOutcome(
  meta: Record<string, unknown> | null | undefined,
  outcome: ListingOutcomeRecord,
): Record<string, unknown> {
  const withOutcome = { ...(meta ?? {}), [LISTING_OUTCOME_KEY]: outcome };
  return writeListingStage(withOutcome, listingOutcomeToCampaignStage(outcome.status));
}

/** Sales Pipeline shows closed listings only — not campaign working stages. */
export function belongsOnSalesPipeline(lead: {
  pipeline_stage?: string | null;
  meta?: Record<string, unknown> | null;
}): boolean {
  const listing = readListingStage(lead.meta ?? null, lead.pipeline_stage ?? null);
  if (listing === "converted") return true;
  if (listing) return false;
  const stage = lead.pipeline_stage ?? "";
  return !CAMPAIGN_ONLY_STAGES.has(stage);
}

export function isSalesPipelineLocked(pipelineStage: string | null | undefined): boolean {
  return pipelineStage === "sale_done" || pipelineStage === "documentation";
}

// ─── Listing Pipeline — the second stage after a listing is converted ──────
// Spec: "Agreed → Details/Docs → Listing Created → Live → Viewings/Offers →
// Negotiation → Sold by Us → Closed", tracking what happened to the listing,
// separate from the generic cross-business sales pipeline (`pipeline_stage`)
// and from the BuzzChat working stage (`listing_stage`).

export const LISTING_PIPELINE_STAGES = [
  "agreed",
  "details_docs",
  "listing_created",
  "live",
  "viewings_offers",
  "negotiation",
  "sold_by_us",
  "closed",
] as const;

export type ListingPipelineStage = (typeof LISTING_PIPELINE_STAGES)[number];

export const LISTING_PIPELINE_STAGE_LABELS: Record<ListingPipelineStage, string> = {
  agreed: "Agreed",
  details_docs: "Details / Docs",
  listing_created: "Listing Created",
  live: "Live",
  viewings_offers: "Viewings / Offers",
  negotiation: "Negotiation",
  sold_by_us: "Sold/Rent",
  closed: "Closed",
};

export const DEFAULT_LISTING_PIPELINE_STAGE: ListingPipelineStage = "agreed";

export function isListingPipelineStage(value: unknown): value is ListingPipelineStage {
  return typeof value === "string" && (LISTING_PIPELINE_STAGES as readonly string[]).includes(value);
}

const LISTING_PIPELINE_KEY = "listing_pipeline";

export interface ListingPipelineRecord {
  stage: ListingPipelineStage;
  /** When the lead entered its *current* stage — drives "days in stage". */
  enteredAt: string;
  offerAmount: string;
}

export function readListingPipeline(
  meta: Record<string, unknown> | null | undefined,
): ListingPipelineRecord | null {
  const raw = meta && typeof meta === "object" ? meta[LISTING_PIPELINE_KEY] : null;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isListingPipelineStage(r.stage)) return null;
  return {
    stage: r.stage,
    enteredAt: typeof r.enteredAt === "string" && r.enteredAt ? r.enteredAt : new Date().toISOString(),
    offerAmount: String(r.offerAmount ?? "").trim(),
  };
}

/** Starts the listing pipeline at "agreed" — called once, when a listing lead converts. */
export function startListingPipeline(
  meta: Record<string, unknown> | null | undefined,
  now: string = new Date().toISOString(),
): Record<string, unknown> {
  if (readListingPipeline(meta)) return meta ?? {};
  const record: ListingPipelineRecord = { stage: DEFAULT_LISTING_PIPELINE_STAGE, enteredAt: now, offerAmount: "" };
  return { ...(meta ?? {}), [LISTING_PIPELINE_KEY]: record };
}

/** Moves to a new stage — bumps enteredAt only when the stage actually changes, so "days in stage" stays accurate. */
export function writeListingPipelineStage(
  meta: Record<string, unknown> | null | undefined,
  stage: ListingPipelineStage,
  now: string = new Date().toISOString(),
): Record<string, unknown> {
  const current = readListingPipeline(meta);
  const record: ListingPipelineRecord = {
    stage,
    enteredAt: current?.stage === stage ? current.enteredAt : now,
    offerAmount: current?.offerAmount ?? "",
  };
  return { ...(meta ?? {}), [LISTING_PIPELINE_KEY]: record };
}

export function writeListingPipelineOffer(
  meta: Record<string, unknown> | null | undefined,
  offerAmount: string,
): Record<string, unknown> {
  const current = readListingPipeline(meta) ?? {
    stage: DEFAULT_LISTING_PIPELINE_STAGE,
    enteredAt: new Date().toISOString(),
    offerAmount: "",
  };
  return { ...(meta ?? {}), [LISTING_PIPELINE_KEY]: { ...current, offerAmount } };
}

export function daysInListingPipelineStage(enteredAt: string, now: number = Date.now()): number {
  const ms = Date.parse(enteredAt);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.floor((now - ms) / (24 * 60 * 60 * 1000)));
}

export const LISTING_SLA_HOURS = 24;

export function isListingSlaBreached(
  lead: {
    assigned_to?: string | null;
    assigned_at?: string | null;
    last_contacted_at?: string | null;
    pipeline_stage?: string | null;
    meta?: Record<string, unknown> | null;
  },
  nowMs: number = Date.now(),
  hours: number = LISTING_SLA_HOURS,
): boolean {
  if (!lead.assigned_to || !lead.assigned_at) return false;
  const listing = readListingStage(lead.meta ?? null, lead.pipeline_stage ?? null);
  if (listing === "converted" || listing === "closed") return false;
  const sla = lead.meta && typeof lead.meta === "object" ? lead.meta[LISTING_SLA_KEY] : null;
  const slaRec = sla && typeof sla === "object" ? (sla as Record<string, unknown>) : null;
  if (slaRec && String(slaRec.assignedAt ?? "") === lead.assigned_at) return false;
  const assignedMs = Date.parse(lead.assigned_at);
  if (Number.isNaN(assignedMs) || nowMs - assignedMs < hours * 60 * 60 * 1000) return false;
  const contactedMs = lead.last_contacted_at ? Date.parse(lead.last_contacted_at) : 0;
  if (!Number.isNaN(contactedMs) && contactedMs >= assignedMs) return false;
  return true;
}

export function nextRoundRobinAssignee(
  memberIds: string[],
  currentId: string | null | undefined,
): string | null {
  const ids = memberIds.filter(Boolean);
  if (ids.length === 0) return null;
  const idx = currentId ? ids.indexOf(currentId) : -1;
  if (ids.length === 1) return idx >= 0 ? null : ids[0];
  if (idx < 0) return ids[0];
  return ids[(idx + 1) % ids.length] ?? null;
}

export const DEFAULT_CAMPAIGN_LEAD_STAGE: CampaignLeadStage = "new_response";

export function isCampaignLeadStage(value: unknown): value is CampaignLeadStage {
  return (
    typeof value === "string" &&
    (CAMPAIGN_LEAD_STAGES as readonly string[]).includes(value)
  );
}

/**
 * The Stage dropdown shows only these three — a lead coming in from Inbox has
 * no stage marked at all (shown as "Not set") until someone picks one of
 * these. The other CAMPAIGN_LEAD_STAGES values (new_response, contacted,
 * engaged, etc.) are still written automatically by inbound/outbound message
 * handling and remain valid stored values; only the human-facing dropdown is
 * narrowed to the three the spec calls out.
 */
export const SIMPLIFIED_LEAD_STAGES = [
  "follow_up",
  "converted",
  "closed",
] as const satisfies readonly CampaignLeadStage[];

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

// ─── Follow-up date + next action ───────────────────────────────────────────
// "Set follow-up date" / "keep the next follow-up/action visible" — kept
// alongside next_action so a due date always carries what to actually do.

const FOLLOW_UP_KEY = "follow_up";

export interface CampaignFollowUp {
  /** ISO date (yyyy-mm-dd) or full ISO datetime — stored as given, parsed for comparisons. */
  date: string | null;
  nextAction: string;
}

export const EMPTY_CAMPAIGN_FOLLOW_UP: CampaignFollowUp = { date: null, nextAction: "" };

export function readCampaignFollowUp(
  meta: Record<string, unknown> | null | undefined,
): CampaignFollowUp {
  const raw = meta && typeof meta === "object" ? meta[FOLLOW_UP_KEY] : null;
  if (!raw || typeof raw !== "object") return { ...EMPTY_CAMPAIGN_FOLLOW_UP };
  const f = raw as Record<string, unknown>;
  const date = typeof f.date === "string" && f.date.trim() ? f.date.trim() : null;
  return { date, nextAction: String(f.nextAction ?? "").trim() };
}

export function writeCampaignFollowUp(
  meta: Record<string, unknown> | null | undefined,
  followUp: CampaignFollowUp,
): Record<string, unknown> {
  return { ...(meta ?? {}), [FOLLOW_UP_KEY]: followUp };
}

export function isCampaignFollowUpOverdue(
  followUp: CampaignFollowUp,
  now: number = Date.now(),
): boolean {
  if (!followUp.date) return false;
  const ms = Date.parse(followUp.date);
  if (Number.isNaN(ms)) return false;
  return ms < now;
}

export function isCampaignFollowUpDueSoon(
  followUp: CampaignFollowUp,
  now: number = Date.now(),
  withinHours: number = 24,
): boolean {
  if (!followUp.date) return false;
  const ms = Date.parse(followUp.date);
  if (Number.isNaN(ms)) return false;
  return ms >= now && ms - now <= withinHours * 60 * 60 * 1000;
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
  | "working"
  | "all"
  | "needs_reply"
  | "waiting"
  | "active"
  | "expired"
  | "closed";

export const DEFAULT_INBOX_QUEUE_FILTER: InboxQueueFilter = "working";

export const INBOX_QUEUE_FILTERS: Array<{ id: InboxQueueFilter; label: string; hint: string }> = [
  { id: "working", label: "Inbox", hint: "Open replies that still need a remark — expired and closed stay out" },
  { id: "all", label: "All", hint: "Every conversation, including unreplied sends" },
  { id: "needs_reply", label: "Needs reply", hint: "Client wrote last — reply now" },
  { id: "waiting", label: "Waiting", hint: "You wrote last, window still open" },
  { id: "active", label: "Active", hint: "Open 24h session" },
  { id: "expired", label: "Expired", hint: "24h window closed — send a template" },
  { id: "closed", label: "Closed", hint: "Marked done" },
];

/** Default chips: waiting-for-remark replies, or the full mailbox. */
export const INBOX_PRIMARY_QUEUE_FILTERS = INBOX_QUEUE_FILTERS.filter(
  (f) => f.id === "working" || f.id === "all",
);

export function threadHasInboundReply(thread: {
  lastInboundAt?: string | null;
  lastDirection?: string | null;
  needsReply?: boolean;
}): boolean {
  return Boolean(thread.lastInboundAt) || thread.lastDirection === "inbound" || thread.needsReply === true;
}

export function threadMatchesInboxQueue(
  thread: {
    lastDirection?: string | null;
    lastInboundAt?: string | null;
    listingOutcome?: string | null;
    needsReply?: boolean;
    status?: string | null;
    expired?: boolean;
  },
  filter: InboxQueueFilter,
): boolean {
  if (filter === "all") return true;
  const solved = thread.status === "solved";
  const needsReply = thread.needsReply === true || thread.lastDirection === "inbound";
  if (filter === "working") {
    return threadHasInboundReply(thread) && !thread.listingOutcome && !solved && !thread.expired;
  }
  if (filter === "needs_reply") return needsReply && !solved;
  if (filter === "waiting") return !needsReply && !solved && !thread.expired;
  if (filter === "active") return !solved && !thread.expired;
  if (filter === "expired") return Boolean(thread.expired) && !solved;
  if (filter === "closed") return solved;
  return true;
}

/** Opens WhatsApp on the agent's personal phone for this number, with an optional pre-filled message. */
export function whatsappPersonalLink(phone: string | null | undefined, prefilledMessage?: string | null): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const base = `https://wa.me/${digits}`;
  const text = prefilledMessage?.trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Default re-engagement message for the 24h-expired WhatsApp fallback —
 * mirrors the spec's example ("Hey Bilel, I am chatting you regarding our
 * previous conversation..."). Falls back gracefully when property/campaign
 * context is missing rather than producing an awkward half-sentence.
 */
export function defaultWhatsappReengagementMessage(input: {
  contactName?: string | null;
  property?: string | null;
  campaignName?: string | null;
}): string {
  const name = input.contactName?.trim() || "there";
  const propertyBit = input.property?.trim()
    ? ` about ${input.property.trim()}`
    : input.campaignName?.trim()
      ? ` regarding our ${input.campaignName.trim()} conversation`
      : "";
  return `Hey ${name}, I'm following up on our previous conversation${propertyBit}. Just wanted to continue our discussion when you have a moment.`;
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

export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Free-text is allowed only inside the 24h window after the client's last inbound message. */
export function isWhatsappFreeTextAllowed(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const ms = Date.parse(lastInboundAt);
  if (Number.isNaN(ms)) return false;
  return now - ms <= WHATSAPP_WINDOW_MS;
}

/** Milliseconds left in the 24h window — negative/zero once closed, null if never opened. */
export function whatsappWindowRemainingMs(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!lastInboundAt) return null;
  const ms = Date.parse(lastInboundAt);
  if (Number.isNaN(ms)) return null;
  return WHATSAPP_WINDOW_MS - (now - ms);
}

export type WhatsappWindowUrgency = "safe" | "warning" | "critical" | "closed" | "none";

/** Escalates as the window nears expiry — drives color/urgency in the countdown UI. */
export function whatsappWindowUrgency(remainingMs: number | null): WhatsappWindowUrgency {
  if (remainingMs == null) return "none";
  if (remainingMs <= 0) return "closed";
  const ONE_HOUR = 60 * 60 * 1000;
  if (remainingMs <= ONE_HOUR) return "critical";
  if (remainingMs <= 4 * ONE_HOUR) return "warning";
  return "safe";
}

/** Human-readable countdown, e.g. "23h 12m left" / "42m left" / "Window closed". */
export function formatWhatsappWindowRemaining(remainingMs: number | null): string {
  if (remainingMs == null) return "";
  if (remainingMs <= 0) return "Window closed";
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m left`;
  return `${hours}h ${minutes}m left`;
}
