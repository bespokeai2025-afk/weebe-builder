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
  isCallbackRequest: boolean;
  callbackDatetimeUtc: string | null;
  callbackType: string | null;
  rule: "callback" | "negative" | "logged" | "tried_to_contact" | "none";
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

function hasCallbackRequest(raw: string | null | undefined, utc: string | null | undefined): boolean {
  const r = String(raw ?? "").trim();
  return Boolean(utc || (r && r !== "NA"));
}

/**
 * Allen's Logic V5 — mirrors production n8n "Apply Allens Logic" node.
 */
export function applyAllensLogicV5(input: AllensLogicInput): AllensLogicResult {
  const callbackRaw = String(input.callbackDatetime ?? "").trim();
  const callbackUtc = input.callbackDatetimeUtc ?? null;
  const callbackType = input.callbackType ?? null;
  const hasCallback = hasCallbackRequest(callbackRaw, callbackUtc);

  const sentiment = String(input.userSentiment ?? "").toLowerCase().trim();
  const bookingUrl = String(input.calendlyBookingUrl ?? "").trim();
  const existingCurrentStatus = input.existingCurrentStatus ?? null;
  const existingStateCode = input.existingStateCode ?? null;

  const base: Omit<AllensLogicResult, "rule" | "allenLogicResult"> = {
    newCurrentStatus: null,
    statecodeOverride: null,
    skipStatusUpdate: true,
    skipStatecodeUpdate: true,
    skipAppointmentUpdate: true,
    isCallbackRequest: false,
    callbackDatetimeUtc: callbackUtc,
    callbackType,
    setDoNotPhone: false,
  };

  if (hasCallback) {
    return {
      ...base,
      newCurrentStatus: WBAH_DYNAMICS_STATUS.CALLBACK,
      statecodeOverride: WBAH_DYNAMICS_STATE_OPEN,
      skipStatusUpdate: false,
      skipStatecodeUpdate: false,
      skipAppointmentUpdate: true,
      isCallbackRequest: true,
      rule: "callback",
      allenLogicResult: `RULE 0: CALLBACK → ${WBAH_DYNAMICS_STATUS.CALLBACK} at ${callbackUtc ?? callbackRaw}`,
    };
  }

  if (sentiment.includes("negative")) {
    const explicitDnc = isWbahExplicitDoNotContactRequest(
      input.detailedCallSummary,
      input.callSummary,
      input.transcript,
    );
    const dncSuffix = explicitDnc ? " + donotphone=true (explicit remove/stop contact)" : "";

    if (existingCurrentStatus === WBAH_DYNAMICS_STATUS.DISQUALIFIED) {
      return {
        ...base,
        setDoNotPhone: explicitDnc,
        rule: "negative",
        allenLogicResult: explicitDnc
          ? "RULE 1: NEGATIVE — already Disqualified — explicit DNC — donotphone=true"
          : "RULE 1: NEGATIVE — already Disqualified — no explicit DNC request",
      };
    }
    return {
      ...base,
      newCurrentStatus: WBAH_DYNAMICS_STATUS.DISQUALIFIED,
      skipStatusUpdate: false,
      skipStatecodeUpdate: true,
      skipAppointmentUpdate: true,
      setDoNotPhone: explicitDnc,
      rule: "negative",
      allenLogicResult: `RULE 1: NEGATIVE → Disqualified (${WBAH_DYNAMICS_STATUS.DISQUALIFIED})${dncSuffix}`,
    };
  }

  if (sentiment.includes("positive")) {
    const hasBooking = hasValidCalendly(bookingUrl) || input.appointmentBooked === true;
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
          ? `RULE 2: POSITIVE + Calendly URL → Logged (${WBAH_DYNAMICS_STATUS.LOGGED}) + Open`
          : `RULE 2: POSITIVE + appointment booked → Logged (${WBAH_DYNAMICS_STATUS.LOGGED}) + Open`,
      };
    }
    return {
      ...base,
      newCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT,
      statecodeOverride: WBAH_DYNAMICS_STATE_OPEN,
      skipStatusUpdate: false,
      skipStatecodeUpdate: false,
      skipAppointmentUpdate: true,
      rule: "tried_to_contact",
      allenLogicResult: `RULE 3: POSITIVE + no Calendly → Tried To Contact (${WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT})`,
    };
  }

  return {
    ...base,
    rule: "none",
    allenLogicResult: `RULE 4: OTHER (${sentiment || "empty"}) → NO UPDATE`,
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
