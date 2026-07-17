/** CRM fields from UAT CRM_data / call-output nested `crmData`. */
export interface WbahCrmData {
  lead_status: string;
  need_to_call: boolean;
  is_negative_sentiment: boolean;
  disqualification_reason: string | null;
  new_disqualifiedreason_code: number | null;
  disqualified_at: string | null;
  disqualification_source: string | null;
  sync_category_slug: string | null;
  clear_all_data?: boolean;
  isActive?: boolean;
}

export const DQ_REASON_LABELS: Record<number, string> = {
  181510000: "Cannot Help",
  279640002: "Not Interested",
};

function pickBool(raw: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    if (raw[k] === undefined || raw[k] === null) continue;
    return raw[k] === true;
  }
  return undefined;
}

function pickNum(raw: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = raw[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickStr(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Flatten top-level CRM row + nested `crmData` object. */
export function wbahCrmDataSource(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw.crmData ?? raw.crm_data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...raw, ...(nested as Record<string, unknown>) };
  }
  return raw;
}

export function parseWbahCrmData(
  raw: Record<string, unknown> | null | undefined,
): WbahCrmData | null {
  if (!raw || typeof raw !== "object") return null;
  const src = wbahCrmDataSource(raw);
  const leadStatus = pickStr(src, "lead_status", "leadStatus");
  if (!leadStatus) return null;

  return {
    lead_status: leadStatus,
    need_to_call: pickBool(src, "need_to_call", "needToCall") ?? false,
    is_negative_sentiment:
      pickBool(src, "is_negative_sentiment", "isNegativeSentiment") ?? false,
    disqualification_reason: pickStr(
      src,
      "disqualification_reason",
      "disqualificationReason",
    ),
    new_disqualifiedreason_code: pickNum(
      src,
      "new_disqualifiedreason_code",
      "newDisqualifiedreasonCode",
    ),
    disqualified_at: pickStr(src, "disqualified_at", "disqualifiedAt"),
    disqualification_source: pickStr(
      src,
      "disqualification_source",
      "disqualificationSource",
    ),
    sync_category_slug: pickStr(src, "sync_category_slug", "syncCategorySlug"),
    clear_all_data: pickBool(src, "clear_all_data", "clearAllData"),
    isActive: pickBool(src, "isActive", "is_active") ?? true,
  };
}

export function dqReasonLabel(crm: WbahCrmData): string {
  if (
    crm.new_disqualifiedreason_code != null &&
    DQ_REASON_LABELS[crm.new_disqualifiedreason_code]
  ) {
    return DQ_REASON_LABELS[crm.new_disqualifiedreason_code];
  }
  return crm.disqualification_reason ?? "—";
}

/** Callable for campaigns — uses need_to_call, not is_negative_sentiment. */
export function isWbahLeadCallable(crm: WbahCrmData | null | undefined): boolean {
  if (!crm) return false;
  if (crm.clear_all_data === true) return false;
  if (crm.isActive === false) return false;
  return crm.need_to_call === true;
}

export function isWbahLeadDisqualified(crm: WbahCrmData | null | undefined): boolean {
  return (crm?.lead_status ?? "").toLowerCase() === "disqualified";
}

const DQ_DETAIL_KEYS = new Set([
  "disqualification_reason",
  "disqualificationReason",
  "new_disqualifiedreason_code",
  "newDisqualifiedreasonCode",
  "disqualified_at",
  "disqualifiedAt",
  "disqualification_source",
  "disqualificationSource",
  "need_to_call",
  "needToCall",
  "is_negative_sentiment",
  "isNegativeSentiment",
  "crmData",
  "crm_data",
]);

export function wbahCrmDetailWithoutDisqualification(
  data?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!DQ_DETAIL_KEYS.has(k) && v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
