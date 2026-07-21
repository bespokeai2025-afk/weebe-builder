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

export type WbahLeadProfileField = { label: string; value: string };

function profileVal(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "object") return null;
  const s = String(v).trim();
  if (!s || /^n\/a$/i.test(s)) return null;
  if (s.startsWith("{") || s.startsWith("[")) return null;
  return s;
}

function profilePick(
  sources: Record<string, unknown>[],
  ...keys: string[]
): string | null {
  for (const src of sources) {
    for (const k of keys) {
      const v = profileVal(src[k]);
      if (v) return v;
    }
  }
  return null;
}

/** Human-readable CRM + post-call profile for the lead detail drawer. */
export function buildWbahLeadCrmProfile(
  crmRaw: Record<string, unknown> | null | undefined,
  extras?: {
    postCall?: Record<string, unknown> | null;
    row?: { name?: string | null; contact?: string | null; email?: string | null };
  },
): WbahLeadProfileField[] {
  const crm = crmRaw ? wbahCrmDataSource(crmRaw) : {};
  const post = (extras?.postCall ?? {}) as Record<string, unknown>;
  const sources = [crm, post];

  const name =
    profilePick(sources, "name", "fullName", "full_name", "customer_name", "Name") ??
    extras?.row?.name ??
    null;
  const first = profilePick(sources, "firstname", "firstName", "first_name", "Firstname");
  const last = profilePick(sources, "lastname", "lastName", "last_name", "Lastname");
  const displayName =
    name ??
    (first || last ? [first, last].filter(Boolean).join(" ") : null);

  const rows: Array<WbahLeadProfileField | null> = [
    displayName ? { label: "Name", value: displayName } : null,
    first ? { label: "First name", value: first } : null,
    last ? { label: "Last name", value: last } : null,
    {
      label: "Phone",
      value:
        profilePick(
          sources,
          "mobile_number",
          "mobileNumber",
          "phone",
          "toNumber",
          "ToNumber",
          "contact",
        ) ?? extras?.row?.contact,
    },
    {
      label: "Email",
      value:
        profilePick(sources, "email", "emailAddress", "Email") ?? extras?.row?.email ?? null,
    },
    {
      label: "Lead status",
      value: profilePick(sources, "lead_status", "leadStatus", "Lead Status"),
    },
    {
      label: "Property type",
      value: profilePick(sources, "property_type", "propertyType", "Property Type"),
    },
    {
      label: "Bedrooms",
      value: profilePick(sources, "bedrooms", "Bedrooms", "new_bedrooms"),
    },
    {
      label: "Property address",
      value: profilePick(
        sources,
        "new_propinfo_street2",
        "address1_line1",
        "address_line1",
        "address",
        "property_address",
        "Address1 Line1",
      ),
    },
    {
      label: "City",
      value: profilePick(sources, "new_propinfo_city", "address1_city", "city", "Address1 City"),
    },
    {
      label: "Postcode",
      value: profilePick(
        sources,
        "new_propinfo_postalcode",
        "address1_postalcode",
        "postal_code",
        "postcode",
        "Address1 Postalcode",
      ),
    },
    {
      label: "Contact address",
      value: profilePick(
        sources,
        "address1_composite",
        "contact_address",
        "Address1 Composite",
      ),
    },
    {
      label: "Title",
      value: profilePick(sources, "title", "Title", "salutation"),
    },
    {
      label: "Lead ID",
      value: profilePick(sources, "lead_id", "leadId", "unique_id", "Lead Id"),
    },
    {
      label: "Category",
      value: profilePick(sources, "sync_category_slug", "syncCategorySlug", "Category"),
    },
  ];

  return rows.filter((r): r is WbahLeadProfileField => Boolean(r?.value));
}

function formatProfileDurationMs(ms: unknown): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const sec = Math.round(n / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatProfileWhen(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  const d =
    !Number.isNaN(n) && n > 1e11
      ? new Date(n)
      : typeof v === "string"
        ? new Date(v)
        : null;
  if (!d || Number.isNaN(d.getTime())) return profileVal(v);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

/** Curated call fields for the lead detail drawer (no raw JSON/meta dump). */
export function buildWbahLeadCallProfile(
  call: Record<string, unknown> | null | undefined,
): WbahLeadProfileField[] {
  if (!call) return [];
  const src = call;

  const rows: Array<WbahLeadProfileField | null> = [
    {
      label: "Agent",
      value: profilePick([src], "agentName", "AgentName", "agent_name"),
    },
    {
      label: "Call status",
      value: profilePick([src], "callStatus", "CallStatus", "call_status"),
    },
    {
      label: "Sentiment",
      value: profilePick([src], "sentimentAnalysis", "SentimentAnalysis", "sentiment"),
    },
    {
      label: "Last called",
      value:
        formatProfileWhen(src.startTimestamp) ??
        formatProfileWhen(src.started_at) ??
        formatProfileWhen(src.StartTimestamp),
    },
    {
      label: "Duration",
      value:
        formatProfileDurationMs(src.durationMs ?? src.DurationMs) ??
        (src.duration_seconds != null
          ? formatProfileDurationMs(Number(src.duration_seconds) * 1000)
          : null),
    },
    {
      label: "Recording",
      value: profilePick([src], "recordingUrl", "RecordingUrl", "recording_url"),
    },
    {
      label: "Disconnection",
      value: profilePick(
        [src],
        "disconnectionReason",
        "DisconnectionReason",
        "disconnection_reason",
      ),
    },
    {
      label: "End reason",
      value: profilePick([src], "endReason", "EndReason", "end_reason"),
    },
  ];

  return rows.filter((r): r is WbahLeadProfileField => Boolean(r?.value));
}
