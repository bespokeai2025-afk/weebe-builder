/** Dynamics `new_currentstatus` option-set values (Allen's Logic V5). */
export const WBAH_DYNAMICS_STATUS = {
  CALLBACK: 181510002,
  DISQUALIFIED: 279640000,
  LOGGED: 100000008,
  TRIED_TO_CONTACT: 100000001,
} as const;

export type AllensLogicInput = {
  userSentiment: string | null | undefined;
  callbackDatetime: string | null | undefined;
  calendlyBookingUrl: string | null | undefined;
};

export type AllensLogicResult = {
  /** null = Rule 4 — do not PATCH status */
  newCurrentStatus: number | null;
  rule: "callback" | "negative" | "logged" | "tried_to_contact" | "none";
};

/**
 * Allen's Logic V5 — mirrors production n8n "Apply Allens Logic" node.
 *
 * Rule 0: callback_datetime set → Call Back Request (181510002)
 * Rule 1: negative sentiment → Disqualified (279640000)
 * Rule 2: positive + Calendly URL → Logged (100000008)
 * Rule 3: positive, no Calendly → Tried To Contact (100000001)
 * Rule 4: otherwise → no status update
 */
export function applyAllensLogicV5(input: AllensLogicInput): AllensLogicResult {
  const callback = String(input.callbackDatetime ?? "").trim();
  if (callback) {
    return { newCurrentStatus: WBAH_DYNAMICS_STATUS.CALLBACK, rule: "callback" };
  }

  const sentiment = String(input.userSentiment ?? "").toLowerCase();
  if (sentiment.includes("negative")) {
    return { newCurrentStatus: WBAH_DYNAMICS_STATUS.DISQUALIFIED, rule: "negative" };
  }

  if (sentiment.includes("positive")) {
    const hasBooking = Boolean(String(input.calendlyBookingUrl ?? "").trim());
    if (hasBooking) {
      return { newCurrentStatus: WBAH_DYNAMICS_STATUS.LOGGED, rule: "logged" };
    }
    return { newCurrentStatus: WBAH_DYNAMICS_STATUS.TRIED_TO_CONTACT, rule: "tried_to_contact" };
  }

  return { newCurrentStatus: null, rule: "none" };
}
