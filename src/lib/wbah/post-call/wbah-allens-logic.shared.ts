import { isWbahClearDecline, isWbahRefusalOnNegativeCall } from "./wbah-decline.shared";
import { normalizeCallbackDatetimeUtc } from "./wbah-uk-datetime.shared";
import { isWbahExplicitDoNotContactRequest } from "./wbah-explicit-dnc.shared";

/** Dynamics `new_currentstatus` option-set values (Allen's Logic V5). */
export const WBAH_DYNAMICS_STATUS = {
  CALLBACK: 181510002,
  DISQUALIFIED: 279640000,
  LOGGED: 100000008,
  TRIED_TO_CONTACT: 100000001,
} as const;

export const WBAH_DYNAMICS_STATE_OPEN = 0;

export type AllensLogicInput = {
  userSentiment: string | null | undefined;
  callbackDatetime: string | null | undefined;
  callbackDatetimeUtc?: string | null;
  callbackType?: string | null;
  /** The callback time was defaulted (caller gave none) — a clear decline still wins. */
  callbackDefaulted?: boolean;
  calendlyBookingUrl: string | null | undefined;
  /** True when Retell booked a slot (calendly_slot) even if WEBEE has no Calendly URL. */
  appointmentBooked?: boolean | null;
  existingCurrentStatus?: number | null;
  existingStateCode?: number | null;
  /** Call summaries / transcript — used to detect explicit remove-from-list requests. */
  callSummary?: string | null;
  detailedCallSummary?: string | null;
  transcript?: string | null;
};

export type AllensLogicResult = {
  newCurrentStatus: number | null;
  statecodeOverride: number | null;
  skipStatusUpdate: boolean;
  skipStatecodeUpdate: boolean;
  skipAppointmentUpdate: boolean;
  /** When true, do not replace cos_call_summary / sentiment (later short call after Logged). */
  skipNarrativeUpdate: boolean;
  isCallbackRequest: boolean;
  callbackDatetimeUtc: string | null;
  callbackType: string | null;
  rule: "remove" | "callback" | "logged" | "decline" | "tried_to_contact" | "none";
  allenLogicResult: string;
  /**
   * True only when the caller explicitly asked to stop contact / be removed
   * from the call list — not for every negative sentiment.
   */
  setDoNotPhone: boolean;
};

function hasValidCalendly(url: string | null | undefined): boolean {
  const v = String(url ?? "").trim();
  return Boolean(v && v !== "NA" && v !== "undefined" && v !== "null");
}

/**
 * Only a real date counts. Retell's callback_datetime extraction often returns junk
 * ("/", "null", ".", broken JSON — ~100 calls in 60 days); treating that as a
 * request set leads to Call Back Request with no callback time.
 */
function hasCallbackRequest(raw: string | null | undefined, utc: string | null | undefined): boolean {
  return Boolean(utc || normalizeCallbackDatetimeUtc(raw));
}

const NEW_LEAD_STATUS = 100000000;

/** The caller's side of a Retell transcript ("User: …" lines). */
function callerLinesOnly(transcript: string | null | undefined): string {
  return String(transcript ?? "")
    .split(/\r?\n/)
    .filter((line) => /^\s*user\s*:/i.test(line))
    .join(" ");
}

/**
 * Allen's Logic — what one AI call does to the lead's status.
 *
 *   remove    explicit "stop calling / remove me" → Disqualified + donotphone
 *   callback  callback requested                  → Call Back Request
 *   logged    appointment booked                  → Logged
 *   decline   clear "no" to selling               → Disqualified
 *   otherwise  Call Back Request / Logged stay as they are; a positive call (or
 *             a negative one on a new lead) → Tried To Contact; else no change
 *
 * Sentiment no longer disqualifies on its own: a silent answer, a caller who
 * wanted a human, or one annoyed at the timing all rate Negative while still
 * wanting to sell (audit: Joanna Hadyniak, Alice Ibrahim). And a call that is
 * not a remove/callback/booking/decline never moves a lead out of Call Back
 * Request or Logged — a later voicemail used to reset a callback to Tried To
 * Contact, which the morning cannot-contact sweep then disqualified.
 */
export function applyAllensLogicV5(input: AllensLogicInput): AllensLogicResult {
  const callbackRaw = String(input.callbackDatetime ?? "").trim();
  const callbackUtc = input.callbackDatetimeUtc ?? null;
  const callbackType = input.callbackType ?? null;
  const hasCallback = hasCallbackRequest(callbackRaw, callbackUtc);

  const sentiment = String(input.userSentiment ?? "").toLowerCase().trim();
  const bookingUrl = String(input.calendlyBookingUrl ?? "").trim();
  const existingCurrentStatus = input.existingCurrentStatus ?? null;
  const alreadyDisqualified = existingCurrentStatus === WBAH_DYNAMICS_STATUS.DISQUALIFIED;
  const heldStatus =
    existingCurrentStatus === WBAH_DYNAMICS_STATUS.LOGGED ||
    existingCurrentStatus === WBAH_DYNAMICS_STATUS.CALLBACK;

  const base: Omit<AllensLogicResult, "rule" | "allenLogicResult"> = {
    newCurrentStatus: null,
    statecodeOverride: null,
    skipStatusUpdate: true,
    skipStatecodeUpdate: true,
    skipAppointmentUpdate: true,
    skipNarrativeUpdate: false,
    isCallbackRequest: false,
    callbackDatetimeUtc: callbackUtc,
    callbackType,
    setDoNotPhone: false,
  };

  const disqualify = (rule: "remove" | "decline", setDoNotPhone: boolean, why: string): AllensLogicResult =>
    alreadyDisqualified
      ? {
          ...base,
          setDoNotPhone,
          rule,
          allenLogicResult: `${why} — already Disqualified${setDoNotPhone ? " — donotphone=true" : ""}`,
        }
      : {
          ...base,
          newCurrentStatus: WBAH_DYNAMICS_STATUS.DISQUALIFIED,
          skipStatusUpdate: false,
          setDoNotPhone,
          rule,
          allenLogicResult: `${why} → Disqualified (${WBAH_DYNAMICS_STATUS.DISQUALIFIED})${
            setDoNotPhone ? " + donotphone=true" : ""
          }`,
        };

  // A removal request in the AI summary wins over anything else on the call —
  // the summary reads the words in context ("stop calling us, we want a real
  // person" is a callback, not a removal).
  if (isWbahExplicitDoNotContactRequest(input.detailedCallSummary, input.callSummary)) {
    return disqualify("remove", true, "REMOVE: explicit stop-contact request");
  }

  const declined =
    isWbahClearDecline(input.detailedCallSummary, input.callSummary) ||
    (sentiment.includes("negative") &&
      isWbahRefusalOnNegativeCall(input.detailedCallSummary, input.callSummary));

  const hasBooking = hasValidCalendly(bookingUrl) || input.appointmentBooked === true;

  // A callback the caller asked for without a time never beats a booking or a clear no.
  if (hasCallback && !(input.callbackDefaulted && (declined || hasBooking))) {
    return {
      ...base,
      newCurrentStatus: WBAH_DYNAMICS_STATUS.CALLBACK,
      statecodeOverride: WBAH_DYNAMICS_STATE_OPEN,
      skipStatusUpdate: false,
      skipStatecodeUpdate: false,
      skipAppointmentUpdate: true,
      isCallbackRequest: true,
      rule: "callback",
      allenLogicResult: `CALLBACK → ${WBAH_DYNAMICS_STATUS.CALLBACK} at ${callbackUtc ?? callbackRaw}`,
    };
  }

  if (hasBooking) {
    return {
      ...base,
      newCurrentStatus: WBAH_DYNAMICS_STATUS.LOGGED,
      statecodeOverride: WBAH_DYNAMICS_STATE_OPEN,
      skipStatusUpdate: false,
      skipStatecodeUpdate: false,
      skipAppointmentUpdate: false,
      rule: "logged",
      allenLogicResult: hasValidCalendly(bookingUrl)
        ? `BOOKED + Calendly URL → Logged (${WBAH_DYNAMICS_STATUS.LOGGED}) + Open`
        : `BOOKED (calendly_slot) → Logged (${WBAH_DYNAMICS_STATUS.LOGGED}) + Open`,
    };
  }

  // The caller's own words (never the agent's script) only count on a negative
  // call that booked nothing — "Oh, they don't phone me?" on a booked call is not
  // a removal request.
  if (sentiment.includes("negative") && isWbahExplicitDoNotContactRequest(callerLinesOnly(input.transcript))) {
    return disqualify("remove", true, "REMOVE: caller asked to stop contact");
  }

  if (declined) {
    return disqualify("decline", false, `DECLINE: clear no to selling (${sentiment || "no sentiment"})`);
  }

  // Nothing decisive happened on this call.
  const keepNarrative = existingCurrentStatus === WBAH_DYNAMICS_STATUS.LOGGED;
  if (heldStatus) {
    return {
      ...base,
      skipNarrativeUpdate: keepNarrative,
      rule: "none",
      allenLogicResult: `NO CHANGE (${sentiment || "empty"}) — keep existing status ${existingCurrentStatus}`,
    };
  }

  const isNewLead = existingCurrentStatus == null || existingCurrentStatus === NEW_LEAD_STATUS;
  if (sentiment.includes("positive") || (isNewLead && sentiment.includes("negative"))) {
    return {
      ...base,
      newCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      statecodeOverride: WBAH_DYNAMICS_STATE_OPEN,
      skipStatusUpdate: false,
      skipStatecodeUpdate: false,
      skipAppointmentUpdate: true,
      rule: "tried_to_contact",
      allenLogicResult: `${sentiment.toUpperCase()} + no booking/decline → Tried To Contact (${WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT})`,
    };
  }

  return {
    ...base,
    rule: "none",
    allenLogicResult: `OTHER (${sentiment || "empty"}) → NO UPDATE`,
  };
}

/** n8n node 35 — appointment confirmed gate for Calendly invitee booking. */
export function isWbahAppointmentConfirmed(input: {
  appointmentConfirmed?: boolean | null;
  appointmentDate?: string | null;
  appointmentTime?: string | null;
  requestedStartUtc?: string | null;
}): boolean {
  if (input.appointmentConfirmed === true) return true;
  const date = String(input.appointmentDate ?? "").trim();
  const time = String(input.appointmentTime ?? input.requestedStartUtc ?? "").trim();
  if (!date || date === "NA") return false;
  if (!time || time === "NA") return false;
  return true;
}
