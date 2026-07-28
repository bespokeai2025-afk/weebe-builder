export type DynamicsCategorySlug =
  | "disqualified"
  | "tried_to_contact"
  | "rebook_initial_consultation"
  | "test_lead"
  | "callback_request";

export type DynamicsCategorySyncCategory = {
  slug: string;
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

export const TEST_LEAD_STATUS = "Test Lead";
export const TEST_LEAD_SLUG = "test_lead";

export const DYNAMICS_CATEGORY_LABELS: Record<DynamicsCategorySlug, string> = {
  disqualified: "Disqualified",
  tried_to_contact: "Tried To Contact",
  rebook_initial_consultation: "Rebook Initial Consultation",
  test_lead: TEST_LEAD_STATUS,
  callback_request: "Callback Request",
};

export type WbahCampaignLeadStatusOption = {
  value: string;
  label: string;
  source?: string;
  isRebookSync?: boolean;
};

export function isTestLeadSource(source: string | null | undefined): boolean {
  return String(source ?? "").toLowerCase() === "test";
}

export function isTestLeadStatus(value: string | null | undefined): boolean {
  return normalizeCampaignLeadStatus(value) === TEST_LEAD_STATUS;
}

/** Map API/UI variants ("Test", test_lead, …) → canonical campaign filter "Test Lead". */
export function normalizeCampaignLeadStatus(value: string | null | undefined): string {
  const v = String(value ?? "").trim();
  if (!v) return v;
  const lower = v.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (lower === "test" || lower === "test lead" || lower === "testlead") {
    return TEST_LEAD_STATUS;
  }
  return v;
}

const LEAD_STATUS_SYNC_SLUG: Record<string, DynamicsCategorySlug> = {
  [DYNAMICS_CATEGORY_LABELS.disqualified]: "disqualified",
  [DYNAMICS_CATEGORY_LABELS.tried_to_contact]: "tried_to_contact",
  [DYNAMICS_CATEGORY_LABELS.rebook_initial_consultation]: "rebook_initial_consultation",
  [TEST_LEAD_STATUS]: "test_lead",
};

/** CRM cohort slug used by Dynamics sync — backend may match on this instead of lead_status alone. */
export function campaignSyncCategorySlugForLeadStatus(
  leadStatus: string | null | undefined,
): DynamicsCategorySlug | null {
  const normalized = normalizeCampaignLeadStatus(leadStatus);
  return LEAD_STATUS_SYNC_SLUG[normalized] ?? null;
}

export function normalizeCampaignLeadStatusOption(
  option: WbahCampaignLeadStatusOption,
): WbahCampaignLeadStatusOption {
  const label = String(option.label ?? option.value ?? "").trim();
  const value = String(option.value ?? option.label ?? "").trim();
  // Only canonicalize category-sync Test Lead (source=test). Keep picklist "TestLead" distinct
  // so both options can appear in the dropdown without Radix Select value collisions.
  if (isTestLeadSource(option.source)) {
    return {
      ...option,
      value: TEST_LEAD_STATUS,
      label: label || TEST_LEAD_STATUS,
    };
  }
  return { ...option, value, label: label || value };
}

/** Legacy Dynamics picklist option — not the category-sync cohort used for UAT test campaigns. */
export function isPicklistTestLeadOption(option: WbahCampaignLeadStatusOption): boolean {
  const v = String(option.value ?? "").trim();
  return v === "TestLead" && !isTestLeadSource(option.source);
}

export type WbahCampaignLeadStatusOptionsResult = {
  options: WbahCampaignLeadStatusOption[];
  fromApi: boolean;
};

function mapRawLeadStatusOptions(raw: unknown[]): WbahCampaignLeadStatusOption[] {
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const value = String(o.value ?? o.label ?? "").trim();
      const label = String(o.label ?? o.value ?? "").trim();
      if (!value && !label) return null;
      return normalizeCampaignLeadStatusOption({
        value: value || label,
        label: label || value,
        source: (o.source as string | undefined) ?? "dynamics",
        isRebookSync: Boolean(o.isRebookSync),
      });
    })
    .filter((x): x is WbahCampaignLeadStatusOption => x != null);
}

/** Parse GET /campaigns/lead-status-options — never drops source=test or picklist TestLead. */
export function parseCampaignLeadStatusOptionsFromApi(
  body: unknown,
): WbahCampaignLeadStatusOption[] {
  if (!body) return [];
  if (Array.isArray(body)) return mapRawLeadStatusOptions(body);
  if (typeof body !== "object") return [];

  const o = body as Record<string, unknown>;
  if (Array.isArray(o.data)) return mapRawLeadStatusOptions(o.data);

  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    const inner = o.data as Record<string, unknown>;
    if (Array.isArray(inner.options)) return mapRawLeadStatusOptions(inner.options);
    if (Array.isArray(inner.leadStatusOptions)) {
      return mapRawLeadStatusOptions(inner.leadStatusOptions);
    }
  }

  if (Array.isArray(o.options)) return mapRawLeadStatusOptions(o.options);
  return [];
}

export function isTestLeadCategorySlug(slug: string | null | undefined): boolean {
  const s = String(slug ?? "")
    .trim()
    .toLowerCase();
  return s === TEST_LEAD_SLUG || s === "testlead" || s === "test_lead";
}

export function dynamicsCategoryLabel(slug: string, leadStatus?: string): string {
  return (
    DYNAMICS_CATEGORY_LABELS[slug as DynamicsCategorySlug] ??
    leadStatus ??
    slug.replace(/_/g, " ")
  );
}

export function hasTestLeadSyncEnabled(
  options: WbahCampaignLeadStatusOption[] | null | undefined,
): boolean {
  return (options ?? []).some(
    (o) => isTestLeadSource(o.source) || isTestLeadStatus(o.value),
  );
}

export function hasTestLeadInSyncPreview(
  result: DynamicsCategorySyncResult | null | undefined,
): boolean {
  return (result?.categories ?? []).some((c) => isTestLeadCategorySlug(c.slug));
}

/** Backend opt-in — treat disabled/unknown test cohort reads as empty, not hard errors. */
export function isTestLeadSyncDisabledError(message: string | null | undefined): boolean {
  const m = String(message ?? "").toLowerCase();
  if (!m) return false;
  return (
    /test lead/.test(m) ||
    /test_lead/.test(m) ||
    /not enabled/.test(m) ||
    /disabled/.test(m) ||
    /invalid.*sync_category/.test(m) ||
    /unknown.*category/.test(m) ||
    /unsupported.*category/.test(m)
  );
}

/** Campaign lead_status picker — Dynamics-synced cohorts only (DQ / TTC / RIC). */
export const WBAH_CAMPAIGN_LEAD_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: DYNAMICS_CATEGORY_LABELS.disqualified, label: DYNAMICS_CATEGORY_LABELS.disqualified },
  {
    value: DYNAMICS_CATEGORY_LABELS.tried_to_contact,
    label: DYNAMICS_CATEGORY_LABELS.tried_to_contact,
  },
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

// ── Campaign scheduling (UAT /campaigns API) ───────────────────────────────────

export type CampaignFrequency = "Daily" | "Custom";

export interface CampaignScheduleDayOption {
  value: number; // Luxon 1=Monday … 7=Sunday
  label: string;
  short: string;
}

export interface CampaignScheduleOptions {
  weekdays: CampaignScheduleDayOption[];
  weekdayConvention: string;
  examples: {
    everyDay: number[] | null;
    mondayToFriday: number[];
    weekends: number[];
  };
}

/** Fallback when GET /campaigns/schedule-options is unavailable (Luxon 1=Mon … 7=Sun). */
export const DEFAULT_CAMPAIGN_WEEKDAY_OPTIONS: CampaignScheduleDayOption[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
  { value: 7, label: "Sunday", short: "Sun" },
];

export const DEFAULT_CAMPAIGN_SCHEDULE_EXAMPLES: CampaignScheduleOptions["examples"] = {
  everyDay: null,
  mondayToFriday: [1, 2, 3, 4, 5],
  weekends: [6, 7],
};

export function resolveCampaignScheduleOptions(
  fromApi?: Partial<CampaignScheduleOptions> | null,
): CampaignScheduleOptions {
  const weekdays =
    fromApi?.weekdays && fromApi.weekdays.length > 0
      ? fromApi.weekdays
      : DEFAULT_CAMPAIGN_WEEKDAY_OPTIONS;
  return {
    weekdays,
    weekdayConvention:
      fromApi?.weekdayConvention?.trim() || "Luxon 1=Monday … 7=Sunday",
    examples: {
      ...DEFAULT_CAMPAIGN_SCHEDULE_EXAMPLES,
      ...(fromApi?.examples ?? {}),
    },
  };
}

export interface WbahCampaignScheduleFields {
  call_time?: string;
  call_hour?: number;
  call_minute?: number;
  timezone?: string;
  frequency_type?: "daily" | "custom";
  frequency?: CampaignFrequency | string;
  interval_days?: number;
  start_date?: string | null;
  end_date?: string | null;
  days_of_week_list?: number[] | null;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function campaignCallTime(c: WbahCampaignScheduleFields): string {
  if (c.call_time) return c.call_time.slice(0, 5);
  if (c.call_hour != null) {
    return `${String(c.call_hour).padStart(2, "0")}:${String(c.call_minute ?? 0).padStart(2, "0")}`;
  }
  return "09:00";
}

function formatCampaignDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const mi = parseInt(m, 10) - 1;
  return `${parseInt(d, 10)} ${MONTH_SHORT[mi] ?? m} ${y}`;
}

function formatCampaignDateRange(start?: string | null, end?: string | null): string {
  if (start && end) return ` (${formatCampaignDateLabel(start)} – ${formatCampaignDateLabel(end)})`;
  if (start) return ` (from ${formatCampaignDateLabel(start)})`;
  if (end) return ` (until ${formatCampaignDateLabel(end)})`;
  return "";
}

/** True when end_date (YYYY-MM-DD) is before today (UTC calendar day). */
export function isCampaignScheduleExpired(endDate?: string | null): boolean {
  if (!endDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return endDate < today;
}

/** Human-readable schedule line for list/detail cards. */
export function formatCampaignScheduleSummary(
  c: WbahCampaignScheduleFields,
  weekdayShortByValue?: Record<number, string>,
): string {
  const tz = c.timezone ?? "Europe/London";
  const time = campaignCallTime(c);
  const weekdays = c.days_of_week_list ?? null;
  const freqCustom =
    (c.frequency_type ?? String(c.frequency ?? "").toLowerCase()) === "custom";
  const interval = c.interval_days ?? 1;
  const dateRange = formatCampaignDateRange(c.start_date, c.end_date);

  if (weekdays && weekdays.length > 0) {
    const sorted = [...weekdays].sort((a, b) => a - b);
    const isMonFri =
      sorted.length === 5 && [1, 2, 3, 4, 5].every((d) => sorted.includes(d));
    const isWeekends =
      sorted.length === 2 && sorted.includes(6) && sorted.includes(7);
    if (isMonFri) return `Mon–Fri at ${time} ${tz}${dateRange}`;
    if (isWeekends) return `Weekends at ${time} ${tz}${dateRange}`;
    const labels = sorted
      .map((d) => weekdayShortByValue?.[d] ?? `Day ${d}`)
      .join(", ");
    return `${labels} at ${time} ${tz}${dateRange}`;
  }

  if (freqCustom && interval > 1) {
    return `Every ${interval} days at ${time} ${tz}${dateRange}`;
  }

  return `Daily at ${time} ${tz}${dateRange}`;
}
