/**
 * Hide the underlying voice provider's brand name from user-facing exports.
 * The downloaded JSON is what customers see; the deploy pipeline still uses
 * the real provider format internally.
 *
 * Replacements are case-preserving so "Retell" → "Webespoke", "RETELL" →
 * "WEBESPOKE", and "retell" → "webespoke". This is applied to the entire
 * JSON text (keys and string values) so URL hosts like "api.retellai.com",
 * voice IDs like "retell-Anna", and any stray mentions are scrubbed.
 *
 * On import we reverse the substitution so the deploy path receives the
 * real schema.
 */
const BRAND_SRC = "retell";
const BRAND_DST = "webespoke";

function applyCaseReplacement(text: string, from: string, to: string): string {
  const re = new RegExp(from, "gi");
  return text.replace(re, (match) => {
    if (match === match.toUpperCase()) return to.toUpperCase();
    if (match[0] === match[0].toUpperCase()) {
      return to[0].toUpperCase() + to.slice(1);
    }
    return to;
  });
}

/** Apply before showing/downloading JSON to the user. */
export function sanitizeExportJson(jsonText: string): string {
  let out = applyCaseReplacement(jsonText, BRAND_SRC, BRAND_DST);
  // Also scrub the Lovable brand (and the common misspelling "loveable").
  out = applyCaseReplacement(out, "loveable", BRAND_DST);
  out = applyCaseReplacement(out, "lovable", BRAND_DST);
  return out;
}

/** Apply after reading a user-imported JSON, before passing to the deploy/import path. */
export function desanitizeImportJson(jsonText: string): string {
  return applyCaseReplacement(jsonText, BRAND_DST, BRAND_SRC);
}
