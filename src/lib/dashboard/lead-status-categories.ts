// Reusable Lead Status category definitions.
//
// These group the raw `leads.status` values into the higher-level buckets shown
// in the Leads page "Lead Status" filter. Keeping the mapping here (rather than
// inline in the page or the server fn) lets both the client filter and the
// backend query share one source of truth.

export const LEAD_STATUS_CATEGORIES = [
  { value: "all", label: "All" },
  { value: "tried_to_contact", label: "Tried to Contact" },
  { value: "disqualified", label: "Disqualified" },
  { value: "rebooked_consultation", label: "Rebooked Consultation" },
] as const;

export type LeadStatusCategory = (typeof LEAD_STATUS_CATEGORIES)[number]["value"];

// Underlying `leads.status` values that make up each category.
export const LEAD_STATUS_CATEGORY_MAP: Record<
  Exclude<LeadStatusCategory, "all">,
  string[]
> = {
  tried_to_contact: ["no_answer", "not_connected", "need_to_call"],
  disqualified: ["not_interested"],
  rebooked_consultation: ["callback_requested", "scheduled"],
};

export function isLeadStatusCategory(v: string): v is LeadStatusCategory {
  return LEAD_STATUS_CATEGORIES.some((c) => c.value === v);
}

/** True when a lead's raw status belongs to the given category ("all" always matches). */
export function leadMatchesStatusCategory(
  status: string | null | undefined,
  category: LeadStatusCategory,
): boolean {
  if (category === "all") return true;
  const allowed = LEAD_STATUS_CATEGORY_MAP[category];
  return !!status && allowed.includes(status);
}
