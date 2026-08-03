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
  existingCurrentStatus?: number | null;
  existingStateCode?: number | null;
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
    if (existingCurrentStatus === WBAH_DYNAMICS_STATUS.DISQUALIFIED) {
      return {
        ...base,
        rule: "negative",
        allenLogicResult: "RULE 1: NEGATIVE — already Disqualified — NO UPDATE",
      };
    }
    return {
      ...base,
      newCurrentStatus: WBAH_DYNAMICS_STATUS.DISQUALIFIED,
      skipStatusUpdate: false,
      skipStatecodeUpdate: true,
      skipAppointmentUpdate: true,
      rule: "negative",
      allenLogicResult: `RULE 1: NEGATIVE → Disqualified (${WBAH_DYNAMICS_STATUS.DISQUALIFIED})`,
    };
  }

  if (sentiment.includes("positive")) {
    if (hasValidCalendly(bookingUrl)) {
      return {
        ...base,
        newCurrentStatus: WBAH_DYNAMICS_STATUS.LOGGED,
        statecodeOverride: WBAH_DYNAMICS_STATE_OPEN,
        skipStatusUpdate: false,
        skipStatecodeUpdate: false,
        skipAppointmentUpdate: false,
        rule: "logged",
        allenLogicResult: `RULE 2: POSITIVE + Calendly → Logged (${WBAH_DYNAMICS_STATUS.LOGGED}) + Open`,
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
