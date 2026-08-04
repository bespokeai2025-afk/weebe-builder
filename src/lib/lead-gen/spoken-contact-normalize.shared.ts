/**
 * Spoken-contact normalization — voice transcriptions render spoken numbers as
 * words ("jomwa eighty seven at gmail dot com" → "jomwaseightyseven@gmail.com").
 * These helpers conservatively convert number-words back to digits before a
 * lead is saved, keeping the raw value alongside for audit.
 *
 * Conservative by design:
 *  - Emails: only a number-word run at the END of the local part is converted
 *    (the common "name + number suffix" pattern). We never touch the domain and
 *    never rewrite words in the middle of a name (avoids "stone" → "s10n").
 *  - Phones: number-words anywhere are converted; all other letters reject the
 *    conversion (we don't guess).
 */

const UNITS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

type Token = { kind: "unit" | "teen" | "ten"; value: number };

/** Tokenize a concatenated (no separator) number-word string. Returns null if
 * the WHOLE string is not exactly a sequence of number words. */
function tokenizeNumberWords(s: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  const lower = s.toLowerCase();
  // longest-match-first candidate list
  const candidates: Array<[string, Token]> = [
    ...Object.entries(TEENS).map(([w, v]) => [w, { kind: "teen", value: v }] as [string, Token]),
    ...Object.entries(TENS).map(([w, v]) => [w, { kind: "ten", value: v }] as [string, Token]),
    ...Object.entries(UNITS).map(([w, v]) => [w, { kind: "unit", value: v }] as [string, Token]),
    // NOTE: "hundred"/"thousand" are intentionally rejected — compound number
    // grammar ("one hundred twenty three") is ambiguous in concatenated digit
    // contexts, and guessing would silently store a wrong contact.
  ].sort((a, b) => b[0].length - a[0].length) as Array<[string, Token]>;
  while (i < lower.length) {
    // skip separators between words
    if (lower[i] === "-" || lower[i] === " " || lower[i] === "_") { i++; continue; }
    let matched = false;
    for (const [w, tok] of candidates) {
      if (lower.startsWith(w, i)) {
        out.push(tok);
        i += w.length;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  return out.length > 0 ? out : null;
}

/** Convert a token sequence to digits, combining "tens + unit" ("eighty seven"
 * → "87") and treating everything else as spoken-digit concatenation
 * ("one two three" → "123", "nineteen" → "19"). */
function tokensToDigits(tokens: Token[]): string {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "ten" && i + 1 < tokens.length && tokens[i + 1].kind === "unit" && tokens[i + 1].value !== 0) {
      out += String(t.value + tokens[i + 1].value);
      i++;
    } else {
      out += String(t.value);
    }
  }
  return out;
}

/**
 * Normalize a transcribed email. Returns the normalized email plus whether it
 * changed. Never throws; invalid inputs are returned as-is (trimmed).
 */
export function normalizeSpokenEmail(raw: string | null | undefined): { email: string | null; changed: boolean } {
  if (!raw) return { email: null, changed: false };
  const originalRaw = String(raw).trim();
  let email = originalRaw.toLowerCase();
  // trailing punctuation from sentence context ("...@gmail.com.")
  email = email.replace(/[.,;:!?]+$/, "");
  // spoken separators when no @ present
  if (!email.includes("@")) {
    email = email.replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+/g, "");
  }
  const atIdx = email.indexOf("@");
  if (atIdx > 0) {
    const local = email.slice(0, atIdx);
    const domain = email.slice(atIdx);
    // find the longest number-word suffix of the local part (leave ≥1 char of name)
    let best: { start: number; digits: string } | null = null;
    for (let start = 1; start < local.length; start++) {
      const tokens = tokenizeNumberWords(local.slice(start));
      if (tokens) { best = { start, digits: tokensToDigits(tokens) }; break; }
    }
    // Require a multi-digit result: single-digit suffixes are too ambiguous —
    // real names end in number words ("stone" → "st1", "capone" → "cap1").
    if (best && best.digits.length >= 2) email = local.slice(0, best.start) + best.digits + domain;
  }
  return { email, changed: email !== originalRaw };
}

/**
 * Normalize a transcribed phone number: converts number-words to digits and
 * strips filler. Returns null-change when the value already looks numeric.
 */
export function normalizeSpokenPhone(raw: string | null | undefined): { phone: string | null; changed: boolean } {
  if (!raw) return { phone: null, changed: false };
  const original = String(raw).trim();
  // Already digit-like (allow +, spaces, dashes, dots, parens)
  if (/^[+\d][\d\s\-().]*$/.test(original)) {
    const cleaned = (original.startsWith("+") ? "+" : "") + original.replace(/\D/g, "");
    return { phone: cleaned, changed: cleaned !== original };
  }
  // Word-by-word conversion: every alpha word must be a number word, else bail.
  const parts = original.toLowerCase().split(/[\s\-.]+/).filter(Boolean);
  let out = original.startsWith("+") ? "+" : "";
  for (const p of parts) {
    const stripped = p.replace(/^\+/, "");
    if (/^\d+$/.test(stripped)) { out += stripped; continue; }
    const tokens = tokenizeNumberWords(stripped);
    if (!tokens) return { phone: original, changed: false };
    out += tokensToDigits(tokens);
  }
  return { phone: out, changed: out !== original };
}
