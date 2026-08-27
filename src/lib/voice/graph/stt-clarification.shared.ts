/**
 * Detect when STT output is too ambiguous for the current graph step — re-prompt
 * instead of letting the speech LLM guess (e.g. "Fled" → flat, "Weekend" → rented).
 */

export function looksLikePropertyTypeAnswer(userText: string): boolean {
  return /\b(flat|house|bungalow|apartment|maisonette|detached|semi[\s-]?detached|terraced|studio|penthouse|cottage|villa)\b/i.test(
    userText,
  );
}

export function looksLikeTenureAnswer(userText: string): boolean {
  return /\b(vacant|empty|unoccupied|rented|renting|tenanted|tenant|tenants|living there|live there|i live|we live|owner.?occupied|owner occupied)\b/i.test(
    userText,
  );
}

export function looksLikeFloorAnswer(userText: string): boolean {
  const t = userText.trim().toLowerCase();
  return (
    /\b(ground|first|second|third|fourth|fifth|top|basement|lower|upper)\s*(floor)?\b/.test(t) ||
    /\b\d+(st|nd|rd|th)\b/.test(t)
  );
}

const LIKELY_MISHEARS = new Set([
  "fled",
  "weekend",
  "weakend",
  "we can",
  "flood",
  "flat.",
  "flee",
  "mt",
  "empty",
]);

/** True when STT is probably a homophone/garble, not an intentional answer. */
export function looksLikeLikelyMishear(userText: string): boolean {
  const t = userText.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (!t || t.length > 40) return false;
  if (LIKELY_MISHEARS.has(t)) return true;
  return /\b(weekend|weakend|we can|fled|flood|flee)\b/.test(t);
}

/**
 * Return a short re-prompt when the caller's reply doesn't match what the node
 * is collecting. Null means proceed with normal routing.
 */
export function clarificationForNode(
  nodeInstruction: string | undefined,
  userText: string,
): string | null {
  const raw = String(nodeInstruction ?? "");
  const t = userText.trim().toLowerCase().replace(/[.!?,]+$/g, "");
  if (!t) return null;

  const asksPropertyType =
    /\bproperty type\b/i.test(raw) || /\{\{property_type\}\}/i.test(raw);
  if (asksPropertyType && !looksLikePropertyTypeAnswer(userText)) {
    if (looksLikeLikelyMishear(userText) || t.length <= 8) {
      return "Sorry, I didn't quite catch that. Is it a house, a flat, or a bungalow?";
    }
  }

  const asksTenure =
    /\bvacant or rented\b/i.test(raw) ||
    /\bvacant or tenanted\b/i.test(raw) ||
    /\bempty, or is there a tenant\b/i.test(raw) ||
    (/\bvacant\b/i.test(raw) && /\b(tenanted|rented|tenant)\b/i.test(raw));
  if (asksTenure && !looksLikeTenureAnswer(userText)) {
    if (looksLikeLikelyMishear(userText) || /^(yes|no|okay|ok)$/i.test(t)) {
      return "Sorry, is the property vacant, rented out, or do you live there yourself?";
    }
  }

  if (/\bwhich floor\b/i.test(raw) && !looksLikeFloorAnswer(userText)) {
    if (looksLikeLikelyMishear(userText) || (t.length <= 10 && !/\d/.test(t))) {
      return "Sorry, which floor is the property on? For example, ground, first, or second.";
    }
  }

  return null;
}

/** Houses and bungalows do not need a floor number — skip floor-collection nodes. */
export function historyIndicatesStandaloneHouse(
  history: ReadonlyArray<{ role: string; content: string }>,
): boolean {
  const blob = history
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  if (!blob.trim()) return false;
  if (/\b(flat|apartment|maisonette|studio|penthouse)\b/.test(blob)) return false;
  return /\b(house|bungalow|detached|semi[\s-]?detached|cottage)\b/.test(blob);
}
