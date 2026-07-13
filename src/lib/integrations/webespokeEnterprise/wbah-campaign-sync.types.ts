export type DynamicsCategorySlug =
  | "disqualified"
  | "tried_to_contact"
  | "rebook_initial_consultation";

export type DynamicsCategorySyncCategory = {
  slug: DynamicsCategorySlug;
  leadStatus: string;
  dynamicsFetched: number;
  skippedNoMobile: number;
  insertedCount: number;
  updatedCount: number;
  expiredCount: number;
  campaignScheduled: boolean;
  campaignName?: string;
};

export type DynamicsCategoryDuplicateLead = {
  lead_id: string;
  row_count: number;
  slugs: (string | null)[];
  has_legacy_null_slug: boolean;
};

export interface DynamicsCategorySyncResult {
  dryRun: boolean;
  categories: DynamicsCategorySyncCategory[];
  campaignsScheduled: string[];
  duplicateLeadIds: DynamicsCategoryDuplicateLead[];
}

export const DYNAMICS_CATEGORY_LABELS: Record<DynamicsCategorySlug, string> = {
  disqualified: "Disqualified",
  tried_to_contact: "Tried To Contact",
  rebook_initial_consultation: "Rebook Initial Consultation",
};

/** Campaign lead_status picker — Dynamics-synced cohorts only (DQ / TTC / RIC). */
export const WBAH_CAMPAIGN_LEAD_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: DYNAMICS_CATEGORY_LABELS.disqualified, label: DYNAMICS_CATEGORY_LABELS.disqualified },
  { value: DYNAMICS_CATEGORY_LABELS.tried_to_contact, label: DYNAMICS_CATEGORY_LABELS.tried_to_contact },
  {
    value: DYNAMICS_CATEGORY_LABELS.rebook_initial_consultation,
    label: DYNAMICS_CATEGORY_LABELS.rebook_initial_consultation,
  },
];

const WBAH_CAMPAIGN_LEAD_STATUS_SET = new Set(
  WBAH_CAMPAIGN_LEAD_STATUS_OPTIONS.map((o) => o.value.toLowerCase()),
);

export function isWbahCampaignLeadStatus(value: string): boolean {
  return WBAH_CAMPAIGN_LEAD_STATUS_SET.has(value.trim().toLowerCase());
}
