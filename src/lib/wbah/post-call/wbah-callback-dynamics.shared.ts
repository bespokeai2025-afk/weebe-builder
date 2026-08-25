/**
 * Retell callback analysis → Dynamics Lead callback fields.
 *
 * Dynamics Lead:
 * - cos_callbackrequest (DateTime) — agreed callback instant (UTC ISO on PATCH)
 * - cr_agentpreference (Picklist) — AI vs human dial preference
 */

import { normalizeCallbackDatetimeUtc } from "./wbah-uk-datetime.shared";

/** Dynamics Lead cr_agentpreference option set (verified on WBAH CRM). */
export const WBAH_DYNAMICS_AGENT_PREFERENCE = {
  AI_OR_HUMAN: 121590000,
  HUMAN_ONLY: 121590001,
} as const;

export type WbahCallbackHandler = "human" | "ai";

export type ResolvedWbahCallback = {
  /** Normalized Retell/API callback_type (e.g. after_legal, live_transfer_fallback). */
  callbackType: string | null;
  callbackHandler: WbahCallbackHandler | null;
  /** Which Retell analysis field supplied the datetime. */
  datetimeSource:
    | "callback_datetime"
    | "human_callback_datetime"
    | "booking_callback_datetime"
    | null;
  callbackDatetime: string | null;
  callbackDatetimeUtc: string | null;
  /** Dynamics cr_agentpreference picklist value, when applicable. */
  dynamicsAgentPreference: number | null;
  isCallbackRequest: boolean;
};

const HUMAN_CALLBACK_TYPES = new Set([
  "human_callback",
  "live_transfer_fallback",
]);

const AI_CALLBACK_TYPES = new Set([
  "ai_callback",
  "beyond_booking_window",
  "no_slots",
  "booking_unavailable",
  "vendor_unavailable",
]);

const LEGAL_RESCHEDULE_TYPES = new Set(["before_legal", "after_legal"]);

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() && String(v).trim() !== "NA") {
      return String(v).trim();
    }
  }
  return null;
}

function normalizeCallbackType(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return v || null;
}

export function isWbahHumanCallbackType(callbackType: string | null | undefined): boolean {
  const t = normalizeCallbackType(callbackType);
  return t != null && HUMAN_CALLBACK_TYPES.has(t);
}

export function isWbahAiCallbackType(callbackType: string | null | undefined): boolean {
  const t = normalizeCallbackType(callbackType);
  if (!t) return false;
  if (AI_CALLBACK_TYPES.has(t)) return true;
  if (LEGAL_RESCHEDULE_TYPES.has(t)) return true;
  return false;
}

/** Map schedule_callback API + post-call analysis values → Dynamics cr_agentpreference. */
export function mapWbahCallbackTypeToAgentPreference(input: {
  callbackType?: string | null;
  callbackHandler?: string | null;
  datetimeSource?: ResolvedWbahCallback["datetimeSource"];
}): number | null {
  const { callbackType, callbackHandler, datetimeSource } = input;
  const handler = String(callbackHandler ?? "").trim().toLowerCase();
  if (handler === "human" || isWbahHumanCallbackType(callbackType)) {
    return WBAH_DYNAMICS_AGENT_PREFERENCE.HUMAN_ONLY;
  }
  if (handler === "ai" || isWbahAiCallbackType(callbackType)) {
    return WBAH_DYNAMICS_AGENT_PREFERENCE.AI_OR_HUMAN;
  }
  if (datetimeSource === "human_callback_datetime") {
    return WBAH_DYNAMICS_AGENT_PREFERENCE.HUMAN_ONLY;
  }
  if (datetimeSource === "booking_callback_datetime") {
    return WBAH_DYNAMICS_AGENT_PREFERENCE.AI_OR_HUMAN;
  }
  if (normalizeCallbackType(callbackType)) {
    return WBAH_DYNAMICS_AGENT_PREFERENCE.AI_OR_HUMAN;
  }
  return null;
}

function resolveCallbackDatetimeFields(custom: Record<string, unknown>): {
  callbackDatetime: string | null;
  humanCallbackDatetime: string | null;
  bookingCallbackDatetime: string | null;
} {
  return {
    callbackDatetime: pickStr(custom, "callback_datetime", "callback_date_time"),
    humanCallbackDatetime: pickStr(custom, "human_callback_datetime"),
    bookingCallbackDatetime: pickStr(
      custom,
      "booking_callback_datetime",
      "ai_callback_datetime",
    ),
  };
}

/**
 * Resolve callback datetime + Dynamics agent preference from Retell custom_analysis_data.
 *
 * Datetime priority:
 * - human types → human_callback_datetime, then callback_datetime
 * - ai types → booking_callback_datetime, then callback_datetime
 * - before_legal / after_legal → callback_datetime
 * - unknown type → callback_datetime, human_callback_datetime, booking_callback_datetime
 */
export function resolveWbahCallbackFromAnalysis(
  custom: Record<string, unknown>,
): ResolvedWbahCallback {
  const callbackType = normalizeCallbackType(pickStr(custom, "callback_type"));
  const callbackHandlerRaw = pickStr(custom, "callback_handler");
  const handler: WbahCallbackHandler | null =
    callbackHandlerRaw === "human"
      ? "human"
      : callbackHandlerRaw === "ai"
        ? "ai"
        : isWbahHumanCallbackType(callbackType)
          ? "human"
          : isWbahAiCallbackType(callbackType)
            ? "ai"
            : null;

  const fields = resolveCallbackDatetimeFields(custom);

  let raw: string | null = null;
  let datetimeSource: ResolvedWbahCallback["datetimeSource"] = null;

  if (isWbahHumanCallbackType(callbackType) || handler === "human") {
    raw = fields.humanCallbackDatetime ?? fields.callbackDatetime;
    datetimeSource = fields.humanCallbackDatetime
      ? "human_callback_datetime"
      : fields.callbackDatetime
        ? "callback_datetime"
        : null;
  } else if (
    AI_CALLBACK_TYPES.has(callbackType ?? "") ||
    (handler === "ai" && !LEGAL_RESCHEDULE_TYPES.has(callbackType ?? ""))
  ) {
    raw = fields.bookingCallbackDatetime ?? fields.callbackDatetime;
    datetimeSource = fields.bookingCallbackDatetime
      ? "booking_callback_datetime"
      : fields.callbackDatetime
        ? "callback_datetime"
        : null;
  } else if (LEGAL_RESCHEDULE_TYPES.has(callbackType ?? "")) {
    raw = fields.callbackDatetime;
    datetimeSource = raw ? "callback_datetime" : null;
  } else {
    raw =
      fields.callbackDatetime ??
      fields.humanCallbackDatetime ??
      fields.bookingCallbackDatetime;
    datetimeSource = fields.callbackDatetime
      ? "callback_datetime"
      : fields.humanCallbackDatetime
        ? "human_callback_datetime"
        : fields.bookingCallbackDatetime
          ? "booking_callback_datetime"
          : null;
  }

  const callbackDatetimeUtc = raw ? normalizeCallbackDatetimeUtc(raw) : null;
  const isCallbackRequest = Boolean(raw && callbackDatetimeUtc);

  return {
    callbackType,
    callbackHandler: handler,
    datetimeSource,
    callbackDatetime: raw,
    callbackDatetimeUtc,
    dynamicsAgentPreference: isCallbackRequest
      ? mapWbahCallbackTypeToAgentPreference({
          callbackType,
          callbackHandler: callbackHandlerRaw,
          datetimeSource,
        })
      : null,
    isCallbackRequest,
  };
}
