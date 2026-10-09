/**
 * Turn what a caller *says* for an email address, a spelled name or an address into the text it
 * stands for, before the model sees it.
 *
 * Speech-to-text writes identifiers the way they sound — "j o e at gmail dot com",
 * "S I O B H A N", "ess double you one a one a a", "forty two baker street" — and a language model
 * then guesses at them: dropping a letter, joining two words, or reading an email back wrong.
 * These are exactly the values that must be right (and that a caller can't easily re-check), so
 * the conversion is done here, deterministically, the same way `normaliseSpokenNumbers` does it
 * for phone numbers. Everything is conservative: a rewrite happens only when the whole shape is
 * recognised (an email needs a local part, "at", a domain and a real TLD), and anything else is
 * left exactly as the caller said it.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export interface SpokenIdentifierOptions {
  /**
   * Recognise spoken UK postcodes ("s w one a one a a" → "SW1A 1AA"). Postcode shapes differ
   * per country, so this is only switched on for agents that work in the UK.
   */
  ukPostcodes?: boolean;
}

const DIGIT_WORD: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const REPEAT: Record<string, number> = { double: 2, triple: 3 };

/** Words that mark where an email's local part starts (they are never part of it). */
const LEAD_STOP = new Set([
  "is", "its", "it's", "it", "my", "mine", "email", "e-mail", "mail", "address", "the", "a", "an",
  "and", "um", "uh", "erm", "hmm", "so", "okay", "ok", "yes", "yeah", "yep", "sure", "that's",
  "thats", "i", "me", "you", "your", "contact", "reach", "send", "to", "on", "of", "or", "but",
  "well", "right", "please", "then", "also", "its", "at", "this", "here", "use", "using",
  "been", "be", "was", "are", "am", "have", "has", "had", "not", "no", "for", "with", "from",
]);
/** Words that can't start or sit inside a domain ("look at my website dot com"). */
const DOMAIN_STOP = new Set([
  "is", "its", "it's", "it", "my", "mine", "the", "a", "an", "and", "um", "uh", "erm", "hmm", "so",
  "okay", "ok", "yes", "yeah", "i", "you", "your", "to", "on", "of", "or", "but", "well",
  "please", "this", "here", "at", "was", "are", "am", "not", "no", "for", "with", "from",
]);

const TLDS = new Set([
  "com", "org", "net", "co", "uk", "io", "ai", "in", "edu", "gov", "info", "me", "app", "dev",
  "us", "ca", "au", "de", "fr", "es", "it", "nl", "ie", "nz", "biz", "xyz", "tech", "online",
  "store", "site", "uae", "ae", "sg", "za", "ng", "pk", "bd", "lk", "ph", "my", "id", "jp", "cn",
  "ru", "br", "mx", "ch", "se", "no", "dk", "fi", "pl", "pt", "be", "at",
]);

const SYMBOL_WORD: Record<string, string> = {
  dot: ".",
  underscore: "_",
  dash: "-",
  hyphen: "-",
  plus: "+",
};

// ── Tokens ────────────────────────────────────────────────────────────────────

interface Tok {
  /** Original text including trailing punctuation. */
  raw: string;
  /** Lowercased, trailing punctuation stripped. */
  word: string;
  start: number;
  end: number;
  /** Punctuation that followed the word ("," "." "?"…), if any. */
  trail: string;
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const trailMatch = /[,.!?;:]+$/.exec(raw);
    const trail = trailMatch ? trailMatch[0] : "";
    const word = raw.slice(0, raw.length - trail.length).toLowerCase();
    out.push({ raw, word, start: m.index, end: m.index + raw.length, trail });
  }
  return out;
}

const isLetter = (w: string) => /^[a-z]$/.test(w);

// ── Emails ────────────────────────────────────────────────────────────────────

/** What a token contributes inside an email, or null when it can't be part of one. */
function emailPiece(t: Tok): { text: string; consumed: number } | null {
  const w = t.word;
  if (!w) return null;
  if (w in SYMBOL_WORD) return { text: SYMBOL_WORD[w]!, consumed: 1 };
  if (w in DIGIT_WORD) return { text: DIGIT_WORD[w]!, consumed: 1 };
  // "j-o-e" / "j.o.e" — hyphen- or dot-separated single characters are a spelled word.
  if (/^(?:[a-z0-9][-.])+[a-z0-9]$/.test(w)) return { text: w.replace(/[-.]/g, ""), consumed: 1 };
  // A word, or something already written like "priya.shah" / "john_doe".
  if (/^[a-z0-9]+(?:[._+-][a-z0-9]+)*$/.test(w)) return { text: w, consumed: 1 };
  return null;
}

function normalisedAtPhrases(text: string): string {
  return text
    .replace(/\bat\s+the\s+rate(?:\s+of)?\b/gi, "at")
    .replace(/\bfull\s+stop\b/gi, "dot")
    .replace(/\bunder\s+score\b/gi, "underscore");
}

/** Domain starting at `from`: labels joined by "dot", ending in a real TLD. */
function parseDomain(
  toks: Tok[],
  from: number,
): { text: string; endIndex: number } | null {
  let i = from;
  const labels: string[] = [];
  for (;;) {
    // One label: a run of word/letter/digit tokens.
    let label = "";
    let singleToken: string | null = null;
    let count = 0;
    let onlyLetters = true;
    while (i < toks.length) {
      const t = toks[i]!;
      if (t.word === "dot") break;
      if (DOMAIN_STOP.has(t.word)) break;
      const piece = emailPiece(t);
      if (!piece || piece.text === "." || piece.text === "_" || piece.text === "+") break;
      if (piece.text === "-" && count === 0) break;
      label += piece.text;
      if (!isLetter(t.word)) onlyLetters = false;
      singleToken = count === 0 ? piece.text : null;
      count += 1;
      i += piece.consumed;
      // "…dot com" — a lone TLD word ends the address; don't swallow what follows ("thanks").
      if (labels.length > 0 && singleToken && TLDS.has(singleToken) && !isLetter(singleToken)) {
        if (toks[i - 1]!.trail && toks[i - 1]!.trail !== "") break;
        if (toks[i]?.word !== "dot") break;
      }
      // A trailing punctuation mark ends the run (sentence over).
      if (toks[i - 1]!.trail) break;
      // Spelled-out letters continue only while they keep being single letters.
      if (onlyLetters && count > 1 && toks[i] && !isLetter(toks[i]!.word) && toks[i]!.word !== "dot") break;
    }
    if (!label) return null;
    labels.push(label);
    const dot = toks[i];
    if (dot && dot.word === "dot" && !toks[i - 1]!.trail) {
      i += 1;
      continue;
    }
    break;
  }
  if (labels.length < 2) return null;
  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,6}$/.test(tld)) return null;
  return { text: labels.join("."), endIndex: i };
}

/** Local part ending just before `atIndex`: walk back over email-ish tokens. */
function parseLocal(
  toks: Tok[],
  atIndex: number,
): { text: string; startIndex: number } | null {
  const pieces: string[] = [];
  let startIndex = atIndex;
  for (let i = atIndex - 1; i >= 0 && atIndex - i <= 40; i--) {
    const t = toks[i]!;
    // Punctuation after a word ends the phrase before it (a lone spelled letter's period is fine).
    if (t.trail && i !== atIndex - 1 && t.word.length > 1) break;
    if (t.trail && i === atIndex - 1 && /[?!]/.test(t.trail)) break;
    if (LEAD_STOP.has(t.word)) break;
    const piece = emailPiece(t);
    if (!piece) break;
    pieces.unshift(piece.text);
    startIndex = i;
  }
  const text = pieces.join("").replace(/^[._+-]+|[._+-]+$/g, "");
  if (!text) return null;
  return { text, startIndex };
}

/** "double l" → one token "ll", so every later step sees plain characters. */
function mergeRepeats(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    const n = toks[i + 1];
    if (t.word in REPEAT && n && !t.trail) {
      const ch = isLetter(n.word)
        ? n.word
        : n.word in DIGIT_WORD
          ? DIGIT_WORD[n.word]!
          : /^\d$/.test(n.word)
            ? n.word
            : null;
      if (ch) {
        out.push({ raw: `${t.raw} ${n.raw}`, word: ch.repeat(REPEAT[t.word]!), start: t.start, end: n.end, trail: n.trail });
        i += 1;
        continue;
      }
    }
    out.push(t);
  }
  return out;
}

/** Rewrite every spoken email in the text as `local@domain`. */
export function normaliseSpokenEmails(input: string): string {
  if (!input || !/\bat\b|@/i.test(input)) return input;
  let text = normalisedAtPhrases(input);
  const toks = mergeRepeats(tokenize(text));
  const edits: Array<{ start: number; end: number; value: string; trail: string }> = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (t.word === "at" && i > 0) {
      const domain = parseDomain(toks, i + 1);
      const local = domain ? parseLocal(toks, i) : null;
      if (domain && local) {
        const last = toks[domain.endIndex - 1]!;
        edits.push({
          start: toks[local.startIndex]!.start,
          end: last.end,
          value: `${local.text}@${domain.text}`,
          trail: last.trail,
        });
        i = domain.endIndex;
        continue;
      }
    }
    i += 1;
  }
  for (const e of edits.reverse()) {
    text = text.slice(0, e.start) + e.value + e.trail + text.slice(e.end);
  }
  return text;
}

// ── Spelled words ─────────────────────────────────────────────────────────────

/**
 * "S I O B H A N", "s-i-o-b-h-a-n", "L as in Lima, E as in Echo, E" → "Siobhan". A run of at least
 * three single letters (a doubled letter counts as two) is a word being spelled.
 */
export function collapseSpelledWords(input: string): string {
  if (!input) return input;
  const toks = tokenize(input);
  const edits: Array<{ start: number; end: number; value: string; trail: string }> = [];
  let i = 0;
  while (i < toks.length) {
    const run = readSpelledRun(toks, i);
    if (run && run.letters.join("").length >= 3) {
      const word = run.letters.join("").toLowerCase();
      const last = toks[run.endIndex - 1]!;
      edits.push({
        start: toks[i]!.start,
        end: last.end,
        value: word.charAt(0).toUpperCase() + word.slice(1),
        trail: last.trail,
      });
      i = run.endIndex;
      continue;
    }
    i += 1;
  }
  let text = input;
  for (const e of edits.reverse()) {
    text = text.slice(0, e.start) + e.value + e.trail + text.slice(e.end);
  }
  return text;
}

function readSpelledRun(
  toks: Tok[],
  from: number,
): { letters: string[]; endIndex: number } | null {
  const letters: string[] = [];
  let i = from;
  while (i < toks.length) {
    const t = toks[i]!;
    const hyphenated = /^(?:[a-z]-)+[a-z]$/.exec(t.word);
    if (hyphenated) {
      letters.push(...t.word.split("-"));
      i += 1;
    } else if (t.word in REPEAT && toks[i + 1] && isLetter(toks[i + 1]!.word)) {
      letters.push(toks[i + 1]!.word.repeat(REPEAT[t.word]!));
      i += 2;
    } else if (isLetter(t.word) && (t.raw.length === 1 || /^[a-z][,.]?$/i.test(t.raw))) {
      letters.push(t.word);
      i += 1;
      // "L as in Lima"
      if (toks[i]?.word === "as" && toks[i + 1]?.word === "in" && toks[i + 2]) i += 3;
    } else {
      break;
    }
    // A sentence-ending mark ends the run.
    const last = toks[i - 1]!;
    if (last.trail && /[.!?]/.test(last.trail) && last.word.length > 1) break;
  }
  return letters.length ? { letters, endIndex: i } : null;
}

// ── UK postcodes ──────────────────────────────────────────────────────────────

// Inward letters never include C I K M O V.
const UK_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[ABD-HJLNP-UW-Z]{2})$/;

function postcodeChars(t: Tok, next?: Tok): { text: string; consumed: number } | null {
  const w = t.word;
  if (isLetter(w) && /^[A-Za-z][,.]?$/.test(t.raw)) return { text: w.toUpperCase(), consumed: 1 };
  if (w in DIGIT_WORD) return { text: DIGIT_WORD[w]!, consumed: 1 };
  if (w === "oh" || w === "o") return null;
  if (w in REPEAT && next) {
    const n = next.word;
    const ch = isLetter(n) ? n.toUpperCase() : n in DIGIT_WORD ? DIGIT_WORD[n]! : /^\d$/.test(n) ? n : null;
    return ch ? { text: ch.repeat(REPEAT[w]!), consumed: 2 } : null;
  }
  // Already-written pieces: "SW1A", "1AA", "7", "NW1".
  if (/^[A-Za-z0-9]{1,4}$/.test(t.raw.replace(/[,.]$/, "")) && /\d/.test(w)) {
    return { text: t.raw.replace(/[,.]$/, "").toUpperCase(), consumed: 1 };
  }
  return null;
}

/** "s w one a one a a" / "SW1A 1AA" → "SW1A 1AA". UK format only. */
export function normaliseSpokenUkPostcodes(input: string): string {
  if (!input) return input;
  const toks = tokenize(input);
  const edits: Array<{ start: number; end: number; value: string; trail: string }> = [];
  let i = 0;
  while (i < toks.length) {
    let matched = false;
    // Try the longest window first so "SW1A 1AA" isn't cut short.
    for (let len = Math.min(10, toks.length - i); len >= 2 && !matched; len--) {
      let chars = "";
      let j = i;
      let ok = true;
      while (j < i + len) {
        const piece = postcodeChars(toks[j]!, toks[j + 1]);
        if (!piece || j + piece.consumed > i + len) {
          ok = false;
          break;
        }
        chars += piece.text;
        j += piece.consumed;
      }
      if (!ok || j !== i + len) continue;
      const m = UK_POSTCODE.exec(chars);
      if (!m || (chars.match(/\d/g) ?? []).length < 2) continue;
      const last = toks[i + len - 1]!;
      edits.push({
        start: toks[i]!.start,
        end: last.end,
        value: `${m[1]} ${m[2]}`,
        trail: last.trail,
      });
      i += len;
      matched = true;
    }
    if (!matched) i += 1;
  }
  let text = input;
  for (const e of edits.reverse()) {
    text = text.slice(0, e.start) + e.value + e.trail + text.slice(e.end);
  }
  return text;
}

// ── House / flat numbers ──────────────────────────────────────────────────────

const STREET_CUE =
  /^(street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|way|place|pl|boulevard|blvd|close|crescent|terrace|gardens|grove|square|park|hill|walk|row|mews|green|rise|view|parade)$/;
const UNIT_CUE = new Set([
  "flat", "apartment", "apt", "unit", "number", "no", "house", "suite", "floor", "room", "plot",
  "block", "building", "level",
]);

function parseNumberWords(words: string[]): number | null {
  if (words.length === 0) return null;
  // "one four" → 14 — a run of single digit words reads as digits.
  if (words.length >= 2 && words.every((w) => w in DIGIT_WORD || w === "oh")) {
    return Number(words.map((w) => (w === "oh" ? "0" : DIGIT_WORD[w])).join(""));
  }
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w === "and") continue;
    if (w in DIGIT_WORD) current += Number(DIGIT_WORD[w]);
    else if (w in TEENS) current += TEENS[w]!;
    else if (w in TENS) current += TENS[w]!;
    else if (w === "hundred") {
      current = (current || 1) * 100;
    } else return null;
    seen = true;
  }
  total += current;
  return seen ? total : null;
}

const isNumberWord = (w: string) =>
  w in DIGIT_WORD || w in TEENS || w in TENS || w === "hundred" || w === "oh";

/**
 * "forty two baker street" → "42 baker street"; "flat twelve" → "flat 12". Only fires beside a
 * street word or a flat/apartment/number cue, so "I have two kids" is untouched.
 */
export function normaliseSpokenAddressNumbers(input: string): string {
  if (!input) return input;
  const toks = tokenize(input);
  const edits: Array<{ start: number; end: number; value: string; trail: string }> = [];
  let i = 0;
  while (i < toks.length) {
    if (!isNumberWord(toks[i]!.word)) {
      i += 1;
      continue;
    }
    let j = i;
    const words: string[] = [];
    while (j < toks.length && (isNumberWord(toks[j]!.word) || (toks[j]!.word === "and" && words.length))) {
      words.push(toks[j]!.word);
      if (toks[j]!.trail) {
        j += 1;
        break;
      }
      j += 1;
    }
    while (words.at(-1) === "and") {
      words.pop();
      j -= 1;
    }
    const prev = toks[i - 1]?.word ?? "";
    const next1 = toks[j]?.word ?? "";
    const next2 = toks[j + 1]?.word ?? "";
    const lastTok = toks[j - 1]!;
    const beside =
      UNIT_CUE.has(prev) ||
      (!lastTok.trail && (STREET_CUE.test(next1) || (/^[a-z]+$/.test(next1) && STREET_CUE.test(next2))));
    const value = beside ? parseNumberWords(words) : null;
    if (value !== null && words.length > 0 && !(words.length === 1 && words[0] === "oh")) {
      edits.push({ start: toks[i]!.start, end: lastTok.end, value: String(value), trail: lastTok.trail });
    }
    i = Math.max(j, i + 1);
  }
  let text = input;
  for (const e of edits.reverse()) {
    text = text.slice(0, e.start) + e.value + e.trail + text.slice(e.end);
  }
  return text;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Email → postcode → spelled word → house number. Order matters: an email consumes its own spelled
 * letters and digit words before anything else can mistake them for a name or a postcode.
 */
export function normaliseSpokenIdentifiers(
  text: string,
  options: SpokenIdentifierOptions = {},
): string {
  if (!text || !text.trim()) return text;
  let out = normaliseSpokenEmails(text);
  if (options.ukPostcodes) out = normaliseSpokenUkPostcodes(out);
  out = collapseSpelledWords(out);
  out = normaliseSpokenAddressNumbers(out);
  return out;
}
