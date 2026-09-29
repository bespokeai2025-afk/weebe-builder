/**
 * `normalizeForSpeech` — Retell converts digits and symbols into words before
 * synthesis so a TTS voice doesn't read "$12" as a currency symbol glyph or
 * "5%" as raw punctuation. `normalizeSpeechText` in `tts/types.ts` already
 * exists but only fixes whitespace/punctuation spacing artifacts — a
 * different, narrower job — and runs unconditionally regardless of this
 * setting. This is the actual symbol/abbreviation-to-words pass, gated by
 * the agent's own toggle.
 *
 * Deliberately conservative: this does NOT spell out arbitrary digit strings
 * (phone numbers, order IDs, postcodes) as words — those need to stay
 * digit-by-digit for the caller to catch them, and the agent explicitly
 * cares about capturing phone/email accurately, so a blanket digit-to-words
 * pass would work against that goal. It only rewrites symbols whose spoken
 * form is unambiguous.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bDr\./g, "Doctor"],
  [/\bMr\./g, "Mister"],
  [/\bMrs\./g, "Missus"],
  [/\bMs\./g, "Miz"],
  [/\bProf\./g, "Professor"],
  [/\bSt\./g, "Street"],
  [/\bAve\./g, "Avenue"],
  [/\bRd\./g, "Road"],
  [/\betc\./gi, "et cetera"],
];

function currencyWord(symbol: string): string | null {
  switch (symbol) {
    case "$":
      return "dollars";
    case "£":
      return "pounds";
    case "€":
      return "euros";
    default:
      return null;
  }
}

/** `$12`, `$12.50` -> "12 dollars", "12.50 dollars". */
function spellCurrency(text: string): string {
  return text.replace(/([$£€])\s?(\d+(?:\.\d+)?)/g, (_match, symbol: string, amount: string) => {
    const word = currencyWord(symbol);
    return word ? `${amount} ${word}` : `${amount}`;
  });
}

/** `5%` -> "5 percent". */
function spellPercent(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?)\s?%/g, "$1 percent");
}

function spellAmpersand(text: string): string {
  return text.replace(/\s&\s/g, " and ");
}

function spellAbbreviations(text: string): string {
  return ABBREVIATIONS.reduce((acc, [pattern, word]) => acc.replace(pattern, word), text);
}

/** No-op when `normalizeForSpeech` isn't enabled — an unset toggle must not change existing output. */
export function normalizeForSpeech(
  text: string,
  settings: Record<string, unknown> | null | undefined,
): string {
  if (settings?.normalizeForSpeech !== true) return text;
  return spellAbbreviations(spellAmpersand(spellPercent(spellCurrency(text))));
}
