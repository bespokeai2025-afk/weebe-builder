/**
 * Do-not-call / remove-from-list must be explicit — negative sentiment alone
 * (e.g. "not interested in selling") is not enough for Dynamics donotphone.
 */

const EXPLICIT_DNC_PATTERNS: RegExp[] = [
  /\b(?:do\s*not|don'?t)\s+(?:call|contact|phone|ring)\b/i,
  /\bstop\s+(?:calling|contacting|phoning)\b/i,
  /\bnever\s+call(?:\s+again|\s+me|\s+back)?\b/i,
  /\bno\s+more\s+calls?\b/i,
  /\btake\s+me\s+off\b/i,
  /\bremove\s+me\s+from\b/i,
  /\bremove\s+(?:my|their|the)\s+details\b/i,
  /\bdetails?\s+(?:to\s+be\s+)?removed\b/i,
  /\bremoved\s+(?:my|their|the)\s+details\b/i,
  /\bdelete\s+(?:my|their|the)\s+(?:details|information|data)\b/i,
  /\b(?:don'?t|do\s+not)\s+want\s+(?:to\s+be\s+)?(?:called|contacted)\b/i,
  /\b(?:don'?t|do\s+not)\s+want\s+any\s+(?:more\s+)?calls?\b/i,
  /\bremove\s+from\s+(?:the\s+)?(?:list|call\s*list|database|system)\b/i,
  /\b(?:be\s+)?removed\s+from\s+(?:the\s+)?(?:call\s*list|list)\b/i,
  /\btake\s+(?:my|their|the)\s+details?\s+off\b/i,
  /\bleave\s+me\s+alone\b/i,
  /\bopt[\s-]?out\b/i,
];

export function isWbahExplicitDoNotContactRequest(
  ...sources: Array<string | null | undefined>
): boolean {
  const combined = sources
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (!combined) return false;
  return EXPLICIT_DNC_PATTERNS.some((re) => re.test(combined));
}
