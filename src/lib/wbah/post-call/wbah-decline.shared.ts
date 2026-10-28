/**
 * A clear "no" to selling, read from the AI call summaries (not the transcript,
 * which also holds the agent's own lines).
 *
 * Negative sentiment alone is not a decline: a silent answer, a caller who
 * wanted a human, or someone annoyed at the timing all rate Negative while still
 * wanting to sell. Equally, "declined to book a consultation" is not a decline —
 * on live calls it mostly means "send me a price first" or "already spoke to a
 * consultant" — so it is deliberately not matched.
 */

/** Refusals of the call or of contact, which say nothing about selling on their own. */
const CONTACT_DECLINE_PATTERNS: RegExp[] = [
  // "not interested" — but not "not interested in speaking to an AI"
  /\bnot\s+interested\b(?!\s+in\s+(?:speaking|talking)\s+(?:to|with)\s+(?:an?\s+)?(?:ai|automated|robot|bot|machine))/i,
  /\bdeclined\s+(?:the\s+offer|further\s+(?:updates|calls|contact))\b/i,
];

/** A no to selling itself — decisive whatever else the call was about. */
const SELLING_DECLINE_PATTERNS: RegExp[] = [
  /\bnot\s+interested\s+in\s+selling\b/i,
  /\bno\s+longer\s+(?:interested|selling|looking\s+to\s+sell|wish(?:es|ing)?\s+to\s+sell|want(?:s|ing)?\s+to\s+sell|needs?\s+to\s+sell)\b/i,
  // "declined to proceed" alone usually means the consultation, not the sale.
  /\b(?:declined|declines|declining|refused|refuses|refusing)\s+to\s+sell\b/i,
  /\b(?:declined|declines|declining|refused|refuses|refusing)\s+to\s+(?:proceed|continue|go\s+ahead)\s+with\s+(?:the\s+)?(?:sale|selling|(?:their|the|her|his)\s+(?:property|house|home|enquiry|sale)|the\s+offer)\b/i,
  /\b(?:does|do|did)\s*(?:not|n['’]t)\s+(?:want|wish|intend|plan)\s+to\s+sell\b/i,
  /\b(?:decided|chose|choosing|deciding)\s+not\s+to\s+sell\b/i,
  /\bnot\s+(?:looking|planning|intending|wanting)\s+to\s+sell\b/i,
  /\bnot\s+(?:considering|thinking\s+(?:about|of))\s+selling\b/i,
  /\b(?:not|never)\s+(?:put|placed|listed)\s+(?:any|the|a|their|her|his)\s+(?:house|property|home)\s+(?:up\s+)?(?:for\s+sale|on\s+the\s+market)\b/i,
  /\b(?:already|has|have)\s+(?:now\s+)?sold\b/i,
  /\bnot\s+(?:to\s+)?sell\s+(?:the|their|her|his|my)\s+(?:property|house|home)\b/i,
  /\b(?:does|do|did)\s*(?:not|n['’]t)\s+need\s+to\s+sell\b/i,
  /\balready\s+(?:engaged|instructed|using|working\s+with|signed\s+with)\s+(?:another|an?|other)\s+(?:seller|agent|estate\s+agent|company|buyer)\b/i,
  /\b(?:never|did\s*(?:not|n['’]t))\s+make\s+(?:an|any|the)\s+enquiry\b/i,
  /\bnever\s+made\s+(?:an|any|the)\s+enquiry\b/i,
  /\bdenied\s+(?:making|submitting)\b/i,
  /\bwrong\s+(?:number|person)\b/i,
  /\bnot\s+the\s+(?:correct|right)\s+(?:contact|person|number)\b/i,
];

/**
 * The caller turned down the AI, not the sale: they expected or wanted a person. They still want
 * an offer, so the WBAH team should call them — not disqualify them as Not Interested.
 * call_678f045434b26c8f034f8e18ecf (28 Oct): "I thought it was a human that was going to call me"
 * → summaries "declined to proceed after learning it was an AI assistant and not a human
 * consultant … declined further contact" → disqualified, Not Interested.
 */
const AI_OBJECTION: RegExp[] = [
  /\b(?:expect(?:ed|ing|s)?|thought\s+(?:it\s+was|they\s+would\s+(?:speak|talk)\s+(?:to|with))|want(?:ed|s|ing)?|asked\s+for|request(?:ed|ing|s)?|prefer(?:red|s|ring)?)\s+(?:to\s+(?:speak|talk)\s+(?:to|with)\s+)?(?:an?\s+)?(?:human|real\s+person|actual\s+person|live\s+person|person)\b/i,
  /\b(?:learn(?:ed|t|ing)|realis(?:ed|ing)|realiz(?:ed|ing)|found\s+out|discover(?:ed|ing)|being\s+told|was\s+told)\s+(?:that\s+)?(?:it|this|the\s+(?:call|caller|agent))\s+was\s+(?:an?\s+)?(?:ai|automated|robot|bot|machine|virtual)\b/i,
  /\b(?:an?\s+)?(?:ai|automated|robot|bot|virtual)\s+(?:assistant|agent|caller|call|system|voice)\s+(?:and|rather\s+than)\s+not\s+(?:a\s+)?(?:human|real\s+person|person|consultant)\b/i,
  /\bnot\s+(?:a\s+)?(?:human|real\s+person)\b/i,
  /\b(?:does|do|did)\s*(?:not|n['’]t)\s+want\s+to\s+(?:speak|talk)\s+(?:to|with)\s+(?:an?\s+)?(?:ai|automated|robot|bot|machine)\b/i,
];

export function isWbahAiObjection(...summaries: Array<string | null | undefined>): boolean {
  const text = summaries.map((s) => String(s ?? "")).join(" ");
  return AI_OBJECTION.some((re) => re.test(text));
}

/** Refusals with no object ("declined to proceed") — decisive only on a negative call. */
const BARE_REFUSAL: RegExp[] = [
  /\b(?:declined|declines|declining|refused|refuses|refusing)\s+to\s+(?:proceed|continue|go\s+ahead|engage)\b/i,
  /\bdeclin(?:ed|es|ing)\s+further\s+assistance\b/i,
  /\bdid\s*(?:not|n['’]t)\s+agree\s+to\s+proceed\b/i,
];

/** Reasons that make a refusal "not now / not like this" rather than "no". */
const SOFT_REASON: RegExp[] = [
  /\b(?:busy|at\s+work|driving|not\s+a\s+good\s+time|another\s+time|later)\b/i,
  /\b(?<!no\s)(?:call\s*back|callback)\b/i,
  /\b(?:speak|talk)\s+(?:to|with)\s+(?:a\s+)?(?:human|real\s+person|someone|a\s+person)\b/i,
  /\b(?:wanted|requested|asked\s+for)\s+(?:a\s+)?(?:human|real\s+person)\b/i,
  /\b(?:by|via|an?)\s+email\b|\bemail(?:ed)?\s+(?:instead|to\s+(?:them|her|him))\b/i,
];

/**
 * A refusal with no stated object, on a negative call, with no softer reason in
 * the short summary. Soft reasons are read from the short summary only — the
 * detailed one routinely says "no callback requested" or "a consultation with a
 * human consultant", which would block every match.
 */
export function isWbahRefusalOnNegativeCall(
  detailedSummary: string | null | undefined,
  callSummary: string | null | undefined,
): boolean {
  const all = [detailedSummary, callSummary].map((s) => String(s ?? "")).join(" ");
  const short = String(callSummary ?? "");
  if (isWbahAiObjection(all)) return false;
  return BARE_REFUSAL.some((re) => re.test(all)) && !SOFT_REASON.some((re) => re.test(short));
}

export function isWbahClearDecline(...summaries: Array<string | null | undefined>): boolean {
  const text = summaries
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (!text) return false;
  if (SELLING_DECLINE_PATTERNS.some((re) => re.test(text))) return true;
  // "Not interested" or "declined further contact" after turning down the AI is about the call.
  return !isWbahAiObjection(text) && CONTACT_DECLINE_PATTERNS.some((re) => re.test(text));
}
