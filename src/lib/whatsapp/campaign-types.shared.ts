/**
 * Campaign Type registry — routing key for Avenue Elite's multi-business CRM.
 *
 * One Campaign object drives three business workflows (Listing Acquisition,
 * Off-Plan, Secondary) instead of three disconnected systems. This module is
 * the single place that maps `campaign_type` to its outcome set, lead-stage
 * transitions, and qualification schema.
 *
 * Listing Acquisition keeps using the existing, already-tested logic in
 * campaign-leads.shared.ts unchanged (this module delegates to it) — Off-Plan
 * and Secondary get their own outcome/qualification definitions here,
 * mirroring the same shape.
 */
import {
  CampaignLeadStage,
  ListingOutcome,
  LISTING_OUTCOMES,
  LISTING_OUTCOME_LABELS,
  SIMPLIFIED_LISTING_REMARKS,
  LISTING_STAGE_KEY,
  LISTING_OUTCOME_KEY,
  listingOutcomeToCampaignStage,
  listingOutcomeToLeadStatus,
  listingOutcomePromotesToSalesPipeline,
  isActiveListingOutcome,
} from "./campaign-leads.shared";

export const CAMPAIGN_TYPES = ["listing_acquisition", "off_plan", "secondary"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const DEFAULT_CAMPAIGN_TYPE: CampaignType = "listing_acquisition";

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  listing_acquisition: "Listing Acquisition",
  off_plan: "Off-Plan",
  secondary: "Secondary",
};

export function isCampaignType(value: unknown): value is CampaignType {
  return typeof value === "string" && (CAMPAIGN_TYPES as readonly string[]).includes(value);
}

/** Unknown/blank/legacy rows are Listing Acquisition — preserves current behavior everywhere. */
export function resolveCampaignType(value: unknown): CampaignType {
  return isCampaignType(value) ? value : DEFAULT_CAMPAIGN_TYPE;
}

// ─── Buyer outcomes (Off-Plan + Secondary share the same shape) ────────────

export const BUYER_OUTCOMES = [
  "interested",
  "qualified",
  "follow_up",
  "assigned",
  "converted",
  "not_interested",
  "already_purchased",
  "no_longer_looking",
  "no_response",
  "remark",
] as const;

export type BuyerOutcome = (typeof BUYER_OUTCOMES)[number];

export function isBuyerOutcome(value: unknown): value is BuyerOutcome {
  return typeof value === "string" && (BUYER_OUTCOMES as readonly string[]).includes(value);
}

const OFF_PLAN_OUTCOME_LABELS: Record<BuyerOutcome, string> = {
  interested: "Interested",
  qualified: "Qualified buyer/investor",
  follow_up: "Follow-up",
  assigned: "Assigned",
  converted: "Converted (closed)",
  not_interested: "Not interested",
  already_purchased: "Already purchased",
  no_longer_looking: "No longer looking / postponed",
  no_response: "No response",
  remark: "Remark / requirement",
};

const SECONDARY_OUTCOME_LABELS: Record<BuyerOutcome, string> = {
  ...OFF_PLAN_OUTCOME_LABELS,
  qualified: "Qualified buyer",
};

/** Active on the buyer board — closed/dead outcomes stay off it (mirrors ACTIVE_LISTING_OUTCOMES). */
export const ACTIVE_BUYER_OUTCOMES = [
  "interested",
  "qualified",
  "follow_up",
  "assigned",
  "remark",
] as const satisfies readonly BuyerOutcome[];

export function isActiveBuyerOutcome(value: string | null | undefined): boolean {
  return (ACTIVE_BUYER_OUTCOMES as readonly string[]).includes(value ?? "");
}

export function buyerOutcomeToCampaignStage(outcome: BuyerOutcome): CampaignLeadStage {
  switch (outcome) {
    case "interested":
    case "remark":
      return "engaged";
    case "qualified":
      return "qualified";
    case "follow_up":
    case "no_longer_looking":
    case "no_response":
      return "follow_up";
    case "assigned":
      return "assigned";
    case "converted":
      return "converted";
    case "not_interested":
    case "already_purchased":
      return "closed";
  }
}

export function buyerOutcomeToLeadStatus(outcome: BuyerOutcome): string | null {
  switch (outcome) {
    case "interested":
      return "interested";
    case "qualified":
      return "qualified";
    case "converted":
      return "completed";
    case "not_interested":
    case "already_purchased":
      return "not_interested";
    default:
      return null;
  }
}

export function buyerOutcomePromotesToPipeline(outcome: BuyerOutcome): boolean {
  return outcome === "converted";
}

// ─── Per-type dispatch (delegates to existing Listing logic unchanged) ─────

export type CampaignOutcome = ListingOutcome | BuyerOutcome;

export function outcomesForCampaignType(type: CampaignType): readonly CampaignOutcome[] {
  return type === "listing_acquisition" ? LISTING_OUTCOMES : BUYER_OUTCOMES;
}

export function isValidOutcomeForCampaignType(
  type: CampaignType,
  value: unknown,
): value is CampaignOutcome {
  return type === "listing_acquisition" ? isListingOutcomeValue(value) : isBuyerOutcome(value);
}

function isListingOutcomeValue(value: unknown): value is ListingOutcome {
  return typeof value === "string" && (LISTING_OUTCOMES as readonly string[]).includes(value);
}

export function outcomeLabel(type: CampaignType, outcome: CampaignOutcome): string {
  if (type === "listing_acquisition") return LISTING_OUTCOME_LABELS[outcome as ListingOutcome];
  const labels = type === "off_plan" ? OFF_PLAN_OUTCOME_LABELS : SECONDARY_OUTCOME_LABELS;
  return labels[outcome as BuyerOutcome];
}

export function outcomeLabelsForCampaignType(type: CampaignType): Array<{ id: CampaignOutcome; label: string }> {
  // Listing Acquisition's Remark dropdown shows only the simplified 4-option
  // triage list (the rest of LISTING_OUTCOMES remain valid stored/automation
  // values — see SIMPLIFIED_LISTING_REMARKS). outcomesForCampaignType is left
  // untouched so server-side validation still accepts the full vocabulary.
  const ids: readonly CampaignOutcome[] =
    type === "listing_acquisition" ? SIMPLIFIED_LISTING_REMARKS : outcomesForCampaignType(type);
  return ids.map((id) => ({ id, label: outcomeLabel(type, id) }));
}

export function campaignOutcomeToStage(type: CampaignType, outcome: CampaignOutcome): CampaignLeadStage {
  return type === "listing_acquisition"
    ? listingOutcomeToCampaignStage(outcome as ListingOutcome)
    : buyerOutcomeToCampaignStage(outcome as BuyerOutcome);
}

export function campaignOutcomeToLeadStatus(type: CampaignType, outcome: CampaignOutcome): string | null {
  return type === "listing_acquisition"
    ? listingOutcomeToLeadStatus(outcome as ListingOutcome)
    : buyerOutcomeToLeadStatus(outcome as BuyerOutcome);
}

export function campaignOutcomePromotesToPipeline(type: CampaignType, outcome: CampaignOutcome): boolean {
  return type === "listing_acquisition"
    ? listingOutcomePromotesToSalesPipeline(outcome as ListingOutcome)
    : buyerOutcomePromotesToPipeline(outcome as BuyerOutcome);
}

export function isActiveOutcomeForCampaignType(
  type: CampaignType,
  value: string | null | undefined,
): boolean {
  return type === "listing_acquisition" ? isActiveListingOutcome(value) : isActiveBuyerOutcome(value);
}

// ─── Generic outcome storage (any campaign type, one meta key) ─────────────
// Reuses the existing `listing_outcome` / `listing_stage` meta keys so a lead
// carries exactly one outcome regardless of which business type it belongs
// to — only the *vocabulary* validated against differs by type. This avoids
// touching the already-tested Listing-only read/write functions above.

export type CampaignOutcomeRecord = {
  status: CampaignOutcome;
  at: string;
  by?: string | null;
  /** Optional free-text reason alongside the remark (e.g. why "Not interested"). */
  reason?: string | null;
};

export function readCampaignOutcome(
  type: CampaignType,
  meta: Record<string, unknown> | null | undefined,
): CampaignOutcomeRecord | null {
  const raw = meta && typeof meta === "object" ? meta[LISTING_OUTCOME_KEY] : null;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (!isValidOutcomeForCampaignType(type, rec.status)) return null;
  return {
    status: rec.status as CampaignOutcome,
    at: String(rec.at ?? ""),
    by: rec.by != null ? String(rec.by) : null,
    reason: rec.reason != null ? String(rec.reason) : null,
  };
}

export function writeCampaignOutcome(
  type: CampaignType,
  meta: Record<string, unknown> | null | undefined,
  outcome: CampaignOutcomeRecord,
): Record<string, unknown> {
  const withOutcome = { ...(meta ?? {}), [LISTING_OUTCOME_KEY]: outcome };
  return { ...withOutcome, [LISTING_STAGE_KEY]: campaignOutcomeToStage(type, outcome.status) };
}

// ─── Qualification schemas ──────────────────────────────────────────────────

export interface OffPlanQualification {
  budget: string;
  preferred_area_project: string;
  developer_project: string;
  unit_type_size: string;
  investment_or_end_use: string;
  cash_or_financing: string;
  preferred_payment_plan: string;
  purchase_timeline: string;
  specific_requirements: string;
}

export const EMPTY_OFF_PLAN_QUALIFICATION: OffPlanQualification = {
  budget: "",
  preferred_area_project: "",
  developer_project: "",
  unit_type_size: "",
  investment_or_end_use: "",
  cash_or_financing: "",
  preferred_payment_plan: "",
  purchase_timeline: "",
  specific_requirements: "",
};

export interface SecondaryQualification {
  budget: string;
  preferred_area_community: string;
  property_type: string;
  bedrooms_size: string;
  cash_or_mortgage: string;
  ready_to_move_or_investment: string;
  purchase_timeline: string;
  specific_requirements: string;
  existing_property_preference: string;
}

export const EMPTY_SECONDARY_QUALIFICATION: SecondaryQualification = {
  budget: "",
  preferred_area_community: "",
  property_type: "",
  bedrooms_size: "",
  cash_or_mortgage: "",
  ready_to_move_or_investment: "",
  purchase_timeline: "",
  specific_requirements: "",
  existing_property_preference: "",
};

const OFF_PLAN_QUALIFICATION_KEY = "off_plan_qualification";
const SECONDARY_QUALIFICATION_KEY = "secondary_qualification";

function strField(v: unknown): string {
  return String(v ?? "").trim();
}

export function readOffPlanQualification(
  meta: Record<string, unknown> | null | undefined,
): OffPlanQualification {
  const raw = meta && typeof meta === "object" ? meta[OFF_PLAN_QUALIFICATION_KEY] : null;
  if (!raw || typeof raw !== "object") return { ...EMPTY_OFF_PLAN_QUALIFICATION };
  const q = raw as Record<string, unknown>;
  return {
    budget: strField(q.budget),
    preferred_area_project: strField(q.preferred_area_project),
    developer_project: strField(q.developer_project),
    unit_type_size: strField(q.unit_type_size),
    investment_or_end_use: strField(q.investment_or_end_use),
    cash_or_financing: strField(q.cash_or_financing),
    preferred_payment_plan: strField(q.preferred_payment_plan),
    purchase_timeline: strField(q.purchase_timeline),
    specific_requirements: strField(q.specific_requirements),
  };
}

export function writeOffPlanQualification(
  meta: Record<string, unknown> | null | undefined,
  qualification: OffPlanQualification,
): Record<string, unknown> {
  return { ...(meta ?? {}), [OFF_PLAN_QUALIFICATION_KEY]: qualification };
}

export function readSecondaryQualification(
  meta: Record<string, unknown> | null | undefined,
): SecondaryQualification {
  const raw = meta && typeof meta === "object" ? meta[SECONDARY_QUALIFICATION_KEY] : null;
  if (!raw || typeof raw !== "object") return { ...EMPTY_SECONDARY_QUALIFICATION };
  const q = raw as Record<string, unknown>;
  return {
    budget: strField(q.budget),
    preferred_area_community: strField(q.preferred_area_community),
    property_type: strField(q.property_type),
    bedrooms_size: strField(q.bedrooms_size),
    cash_or_mortgage: strField(q.cash_or_mortgage),
    ready_to_move_or_investment: strField(q.ready_to_move_or_investment),
    purchase_timeline: strField(q.purchase_timeline),
    specific_requirements: strField(q.specific_requirements),
    existing_property_preference: strField(q.existing_property_preference),
  };
}

export function writeSecondaryQualification(
  meta: Record<string, unknown> | null | undefined,
  qualification: SecondaryQualification,
): Record<string, unknown> {
  return { ...(meta ?? {}), [SECONDARY_QUALIFICATION_KEY]: qualification };
}

/** Short "requirement" summary shown on the board row, mirrors formatCampaignRequirement. */
export function formatOffPlanRequirement(q: OffPlanQualification): string {
  const bits = [q.developer_project, q.unit_type_size, q.budget].filter(Boolean);
  return bits.join(" · ");
}

export function formatSecondaryRequirement(q: SecondaryQualification): string {
  const bits = [q.property_type, q.bedrooms_size, q.budget].filter(Boolean);
  return bits.join(" · ");
}

// ─── Pipeline stage labels (reporting reference — board UI is a follow-up) ──

export const OFF_PLAN_PIPELINE_STAGES = [
  "project_presented",
  "unit_selected",
  "meeting_viewing",
  "reservation_booking",
  "spa_documentation",
  "developer_commission",
  "closed",
] as const;

export const OFF_PLAN_PIPELINE_STAGE_LABELS: Record<(typeof OFF_PLAN_PIPELINE_STAGES)[number], string> = {
  project_presented: "Project Presented",
  unit_selected: "Unit Selected",
  meeting_viewing: "Meeting / Viewing",
  reservation_booking: "Reservation / Booking",
  spa_documentation: "SPA / Documentation",
  developer_commission: "Developer / Commission",
  closed: "Closed",
};

export const SECONDARY_PIPELINE_STAGES = [
  "property_matching",
  "viewing",
  "offer",
  "negotiation",
  "mou_transfer",
  "closed",
] as const;

export const SECONDARY_PIPELINE_STAGE_LABELS: Record<(typeof SECONDARY_PIPELINE_STAGES)[number], string> = {
  property_matching: "Property Matching",
  viewing: "Viewing",
  offer: "Offer",
  negotiation: "Negotiation",
  mou_transfer: "MOU / Transfer",
  closed: "Closed",
};

// ─── Campaign type_fields (Developer/Project/Area etc.) ─────────────────────

export interface OffPlanCampaignFields {
  developer: string;
  project: string;
  area: string;
  unit_focus: string;
  buyer_objective: string;
}

export const EMPTY_OFF_PLAN_CAMPAIGN_FIELDS: OffPlanCampaignFields = {
  developer: "",
  project: "",
  area: "",
  unit_focus: "",
  buyer_objective: "",
};

export interface SecondaryCampaignFields {
  area: string;
  property_type: string;
  bedrooms_focus: string;
  buyer_objective: string;
  price_range: string;
}

export const EMPTY_SECONDARY_CAMPAIGN_FIELDS: SecondaryCampaignFields = {
  area: "",
  property_type: "",
  bedrooms_focus: "",
  buyer_objective: "",
  price_range: "",
};

export function readOffPlanCampaignFields(
  typeFields: Record<string, unknown> | null | undefined,
): OffPlanCampaignFields {
  const t = typeFields && typeof typeFields === "object" ? typeFields : {};
  return {
    developer: strField(t.developer),
    project: strField(t.project),
    area: strField(t.area),
    unit_focus: strField(t.unit_focus),
    buyer_objective: strField(t.buyer_objective),
  };
}

export function readSecondaryCampaignFields(
  typeFields: Record<string, unknown> | null | undefined,
): SecondaryCampaignFields {
  const t = typeFields && typeof typeFields === "object" ? typeFields : {};
  return {
    area: strField(t.area),
    property_type: strField(t.property_type),
    bedrooms_focus: strField(t.bedrooms_focus),
    buyer_objective: strField(t.buyer_objective),
    price_range: strField(t.price_range),
  };
}
