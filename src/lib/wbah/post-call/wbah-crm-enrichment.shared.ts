/**
 * Transcript/summary fallbacks when Retell structured_json_output is incomplete.
 */

function isEmptyValue(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function combinedSummaryText(
  custom: Record<string, unknown> | undefined,
  working: Record<string, unknown>,
  transcript?: string | null,
): string {
  return [
    custom?.detailed_call_summary,
    custom?.call_summary,
    working.cos_call_summary,
    transcript,
  ]
    .filter((v) => !isEmptyValue(v))
    .map((v) => String(v))
    .join(" ");
}

/** Caller asked for human callback but Retell used generic callback_type. */
export function summaryRequestsHumanCallback(
  custom: Record<string, unknown> | undefined,
): boolean {
  const text = combinedSummaryText(custom, {}).toLowerCase();
  return (
    /\bhuman (only )?(callback|call back)\b/.test(text) ||
    /\b(speak|talk) (to|with) (a )?human\b/.test(text) ||
    /\bcallback (with|from) (a )?(real )?(person|human)\b/.test(text) ||
    /\brequest(ed)? (a )?(callback from a )?(real )?(person|human)\b/.test(text) ||
    /\brequest(ed)? (a )?human (agent|adviser|advisor)\b/.test(text) ||
    /\b(wants?|would like) (to )?(speak|talk) (to|with) (a )?(real )?(person|human|someone)\b/.test(text) ||
    /\b(get|have) a real person (to )?call\b/.test(text) ||
    /\bnot you\b.*\b(real person|human|colleague)\b/.test(text) ||
    /\bcolleague will call\b/.test(text)
  );
}

export function transcriptIndicatesContactSameAsProperty(transcript?: string | null): boolean {
  if (isEmptyValue(transcript)) return false;
  const text = String(transcript).toLowerCase();
  return (
    /\bcontact address details (the )?same (as )?(your )?(property )?address\b/.test(text) ||
    /\bcontact address (is )?(the )?same\b/.test(text) ||
    (/\bcontact address\b/.test(text) && /\bsame as (your )?(property )?address\b/.test(text))
  );
}

export function summaryIndicatesContactSameAsProperty(
  custom: Record<string, unknown> | undefined,
): boolean {
  const text = combinedSummaryText(custom, {}).toLowerCase();
  return (
    /\bcontact (address|details)? (is )?(the )?same (as )?(the )?(property|address|home)\b/.test(
      text,
    ) ||
    /\bsame (as )?(the )?(property|home) address\b/.test(text) ||
    /\b(contact )?address (is )?same\b/.test(text) ||
    /\bmailing address (is )?(the )?same\b/.test(text) ||
    /\bpostal address (is )?(the )?same\b/.test(text) ||
    /\bconfirmed (that )?(the )?contact (address|details) (match|matches|are the same)\b/.test(
      text,
    ) ||
    /\b(yes,? )?(that'?s|it'?s) (also )?(my )?(contact )?(home )?address\b/.test(text) ||
    /\bcontact details (are )?(the )?same (as|address)\b/.test(text)
  );
}

export function summaryIndicatesOwnerOccupied(
  custom: Record<string, unknown> | undefined,
  working: Record<string, unknown>,
): boolean {
  const text = combinedSummaryText(custom, working).toLowerCase();
  return (
    /\b(i'?m |i am )?(currently )?(living|staying|residing) (there|here|in the property|at the property)\b/.test(
      text,
    ) ||
    /\blive (in|at) the property\b/.test(text) ||
    /\bowner.?occup/i.test(text) ||
    /\bi live (here|there|in)\b/.test(text) ||
    /\b(i'?m |i am ) the owner (and )?(live|living|stay|staying)\b/.test(text) ||
    /\buser lives there\b/.test(text) ||
    /\b(lives?|living) there\b/.test(text) ||
    /\blive in it\b/.test(text) ||
    /\boccupies? the property\b/.test(text) ||
    /\bcurrently lived in\b/.test(text) ||
    /\blived in by the (caller|user|owner|vendor)\b/.test(text) ||
    /\b(lives?|living|lived) (there|in the property|at the property|in it)\b/.test(text) ||
    /\bnot (vacant|empty|tenanted|rented out)\b/.test(text) && /\b(live|living|stay|staying)\b/.test(text)
  );
}

/** Owner lives at property — not vacant and not let to a tenant. Overrides incorrect rented flags. */
export function applyOwnerOccupiedCorrection(
  target: Record<string, unknown>,
  custom?: Record<string, unknown>,
  verifiedDetails?: Record<string, unknown>,
): void {
  if (!summaryIndicatesOwnerOccupied(custom, { ...verifiedDetails, ...target })) return;
  target.cos_propertyempty = 181510000;
  target.cos_propertyrented = 181510000;
  target.vacant_or_tenanted = "";
}

/** Caller denied that the property is rented — never keep a Yes rented flag. */
export function summaryIndicatesNotRented(
  custom?: Record<string, unknown>,
  working?: Record<string, unknown>,
  transcript?: string | null,
): boolean {
  const text = combinedSummaryText(custom, working ?? {}, transcript).toLowerCase();
  if (!text.trim()) return false;
  if (
    /\b(not|never|no longer)\s+(being\s+)?(currently\s+)?(rented|tenanted|let out)\b/.test(text)
  ) {
    return true;
  }
  if (/\b(isn'?t|is not|was not|wasn'?t)\s+(currently\s+)?(rented|tenanted|let out)\b/.test(text)) {
    return true;
  }
  if (/\bno,?\s+(it'?s |the property is )?(not )?(rented|tenanted)\b/.test(text)) return true;
  if (
    /\b(asked|ask(?:ed)? (?:if|whether))\b[\s\S]{0,80}\b(rented|tenanted)\b[\s\S]{0,120}\b(said|says|answered)\s+no\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(rented|tenanted)\??[\s.]*\b(the )?(caller|user|they)\s+(said|says|answered)\s+no\b/.test(text)
  ) {
    return true;
  }
  if (/\b(denied|denies)\s+(that )?(it (is |was )?)?(rented|tenanted)\b/.test(text)) return true;
  if (
    /\b(user|caller)\s*[:\-]\s*(no|nope|nah)\b/.test(text) &&
    /\brented\b/.test(text) &&
    !/\b(user|caller)\s*[:\-]\s*yes\b/.test(text)
  ) {
    return true;
  }
  return false;
}

export function applyNotRentedCorrection(
  target: Record<string, unknown>,
  custom?: Record<string, unknown>,
  verifiedDetails?: Record<string, unknown>,
  transcript?: string | null,
): void {
  const working = { ...verifiedDetails, ...target };
  if (!summaryIndicatesNotRented(custom, working, transcript)) return;
  target.cos_propertyrented = 181510000;
  if (String(target.vacant_or_tenanted ?? "") === "181510001") {
    target.vacant_or_tenanted = "";
  }
}

function cleanNumber(v: unknown): number | undefined {
  if (isEmptyValue(v)) return undefined;
  const cleaned = String(v).replace(/[£$,]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

/** Extract monthly rent from summary when structured field empty (rented properties). */
export function extractRentAchievedFromSummaries(
  custom: Record<string, unknown> | undefined,
  working: Record<string, unknown>,
): void {
  if (!isEmptyValue(working.new_propinfo_rentachieved)) return;
  const text = combinedSummaryText(custom, working);
  // Do not treat "ground rent £450" as monthly rent (Charlotte / leasehold).
  const m =
    text.match(/\b(?:monthly\s+)?rent\s+achieved\s*[£$]?\s*(\d[\d,]*(?:\.\d+)?)/i) ||
    text.match(/\bmonthly\s+rent\s+(?:of|is|at)\s*[£$]?\s*(\d[\d,]*(?:\.\d+)?)/i) ||
    text.match(/(?:achieving|getting|receives?)\s+[£$]?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:per month|pcm|a month|monthly)/i);
  if (m?.[1]) {
    working.new_propinfo_rentachieved = m[1].replace(/,/g, "");
  }
}

export function extractTenureFromSummaries(
  custom: Record<string, unknown> | undefined,
  working: Record<string, unknown>,
): void {
  if (!isEmptyValue(working.cos_tenure) || !isEmptyValue(working.tenure)) return;
  const text = combinedSummaryText(custom, working).toLowerCase();
  if (/\bleasehold\b/.test(text)) {
    working.cos_tenure = "279640001";
    working.tenure = "279640001";
    return;
  }
  if (/\bfreehold\b/.test(text)) {
    working.cos_tenure = "279640000";
    working.tenure = "279640000";
    return;
  }
  if (/\bshared ownership\b/.test(text)) {
    working.cos_tenure = "279640002";
    working.tenure = "279640002";
  }
}

export function extractTimeframeFromSummaries(
  custom: Record<string, unknown> | undefined,
  working: Record<string, unknown>,
): void {
  if (!isEmptyValue(working.new_propinfo_howquickly) || !isEmptyValue(working.timeframe)) return;
  const text = combinedSummaryText(custom, working).toLowerCase();

  if (
    /\b(asap|immediately|straight away|right away|less than (a )?month|<\s*1 month|within (a )?month)\b/.test(
      text,
    )
  ) {
    working.new_propinfo_howquickly = "100000000";
    working.timeframe = "100000000";
    return;
  }
  if (/\b(1|one) month(s)?\b/.test(text) && !/\b(2|3|three|four|more)\b/.test(text)) {
    working.new_propinfo_howquickly = "100000001";
    working.timeframe = "100000001";
    return;
  }
  if (/\b(2|two) months?\b/.test(text)) {
    working.new_propinfo_howquickly = "100000002";
    working.timeframe = "100000002";
    return;
  }
  if (/\b(3|three) months?\b/.test(text) && !/\b(3\+|more than 3|over 3|4|four|5|six)\b/.test(text)) {
    working.new_propinfo_howquickly = "100000003";
    working.timeframe = "100000003";
    return;
  }
  if (
    /\b(3\+|more than 3|over 3|4|four|5|five|6|six|12|twelve|year|longer|no rush|not in a hurry)\b/.test(
      text,
    )
  ) {
    working.new_propinfo_howquickly = "100000004";
    working.timeframe = "100000004";
  }
}

export function extractVacantOrTenantedFromSummaries(
  custom: Record<string, unknown> | undefined,
  working: Record<string, unknown>,
  transcript?: string | null,
): void {
  if (!isEmptyValue(working.vacant_or_tenanted)) return;
  if (summaryIndicatesOwnerOccupied(custom, working)) return;
  if (summaryIndicatesNotRented(custom, working, transcript)) return;

  const text = combinedSummaryText(custom, working, transcript).toLowerCase();
  if (
    /\b(it'?s |property is )?(tenanted|rented out|let out|has (a )?tenant|it is rented)\b/.test(text) &&
    !/\b(asked|ask(?:ed)? (?:if|whether)).{0,80}\b(rented|tenanted)\b/.test(text)
  ) {
    working.vacant_or_tenanted = "181510001";
    return;
  }
  if (/\b(vacant|empty property|no tenant|unoccupied|nobody living)\b/.test(text)) {
    working.vacant_or_tenanted = "181510000";
  }
}

export function shouldMirrorPropertyToContact(
  source: Record<string, unknown>,
  custom?: Record<string, unknown>,
  transcript?: string | null,
): boolean {
  const explicitFlag = boolTrue(
    source.contact_same_as_property ??
      source.contact_address_same_as_property ??
      source.same_as_property_address,
  );
  if (explicitFlag) return true;
  if (summaryIndicatesContactSameAsProperty(custom)) return true;
  if (transcriptIndicatesContactSameAsProperty(transcript)) return true;

  const SAME_AS_PROPERTY_PATTERN =
    /\b(?:same\s*(as)?\s*(the\s*)?(property|prop(?:erty)?(?:\s*address)?|address|home)|yes[\s,]*same)\b/i;
  for (const value of [source.address1_line1, source.contact_address]) {
    if (!isEmptyValue(value) && SAME_AS_PROPERTY_PATTERN.test(String(value).trim())) {
      return true;
    }
  }

  return false;
}

export function enrichWbahVerifiedDetailsFromSummaries(
  working: Record<string, unknown>,
  custom?: Record<string, unknown>,
  transcript?: string | null,
): void {
  extractTenureFromSummaries(custom, working);
  extractTimeframeFromSummaries(custom, working);
  extractVacantOrTenantedFromSummaries(custom, working, transcript);

  if (shouldMirrorPropertyToContact(working, custom, transcript)) {
    working.contact_same_as_property = "true";
  }
}

function boolTrue(v: unknown): boolean {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}

export { cleanNumber as cleanWbahMoneyNumber };
