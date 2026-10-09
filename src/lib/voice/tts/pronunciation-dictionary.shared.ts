/**
 * `pronunciationDictionary` — per-word pronunciation overrides authored in the builder.
 *
 * An entry is {word, alphabet, phoneme} where `alphabet` says how `phoneme` is written:
 *   - "respell": plain "sounds like" text ("ZEER-oh"). Works with every voice — it is swapped in
 *     for the word before synthesis.
 *   - "ipa" / "cmu": real phonemes. Each voice takes a different notation, so the entry is
 *     converted per provider:
 *       Fish Audio  → CMU Arpabet inside `<|phoneme_start|>…<|phoneme_end|>` (English only; IPA
 *                     is converted to CMU first, Fish does not accept IPA for English).
 *       Cartesia    → IPA inside `<<a|b|c>>` (CMU is converted to IPA first).
 *       others      → no phoneme input; the entry is skipped (use "respell" for those voices).
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export type PronunciationAlphabet = "ipa" | "cmu" | "respell";

export interface PronunciationEntry {
  word: string;
  alphabet: PronunciationAlphabet;
  phoneme: string;
}

export interface PronunciationTarget {
  /** TTS provider name as the native engine knows it: "fish" | "cartesia" | "openai". */
  provider?: string | null;
}

// ── Phoneme tables ────────────────────────────────────────────────────────────

interface PhonemeUnit {
  ipa: string;
  /** CMU symbols this unit becomes (a diphthong-like unit can need two). */
  cmu: string[];
  vowel: boolean;
}

/** Longest symbols first, so "tʃ" is read before "t" and "ɑː" before "ɑ". */
const IPA_UNITS: PhonemeUnit[] = [
  { ipa: "tʃ", cmu: ["CH"], vowel: false },
  { ipa: "dʒ", cmu: ["JH"], vowel: false },
  { ipa: "aɪ", cmu: ["AY"], vowel: true },
  { ipa: "aʊ", cmu: ["AW"], vowel: true },
  { ipa: "eɪ", cmu: ["EY"], vowel: true },
  { ipa: "oʊ", cmu: ["OW"], vowel: true },
  { ipa: "əʊ", cmu: ["OW"], vowel: true },
  { ipa: "ɔɪ", cmu: ["OY"], vowel: true },
  { ipa: "ɪə", cmu: ["IH", "R"], vowel: true },
  { ipa: "eə", cmu: ["EH", "R"], vowel: true },
  { ipa: "ʊə", cmu: ["UH", "R"], vowel: true },
  { ipa: "ɑː", cmu: ["AA"], vowel: true },
  { ipa: "ɔː", cmu: ["AO"], vowel: true },
  { ipa: "ɜː", cmu: ["ER"], vowel: true },
  { ipa: "iː", cmu: ["IY"], vowel: true },
  { ipa: "uː", cmu: ["UW"], vowel: true },
  { ipa: "ɒ", cmu: ["AA"], vowel: true },
  { ipa: "æ", cmu: ["AE"], vowel: true },
  { ipa: "ɛ", cmu: ["EH"], vowel: true },
  { ipa: "e", cmu: ["EH"], vowel: true },
  { ipa: "ɪ", cmu: ["IH"], vowel: true },
  { ipa: "i", cmu: ["IY"], vowel: true },
  { ipa: "ʊ", cmu: ["UH"], vowel: true },
  { ipa: "u", cmu: ["UW"], vowel: true },
  { ipa: "ʌ", cmu: ["AH"], vowel: true },
  { ipa: "ə", cmu: ["AH"], vowel: true },
  { ipa: "ɚ", cmu: ["ER"], vowel: true },
  { ipa: "ɝ", cmu: ["ER"], vowel: true },
  { ipa: "ɑ", cmu: ["AA"], vowel: true },
  { ipa: "ɔ", cmu: ["AO"], vowel: true },
  { ipa: "a", cmu: ["AA"], vowel: true },
  { ipa: "o", cmu: ["OW"], vowel: true },
  { ipa: "b", cmu: ["B"], vowel: false },
  { ipa: "d", cmu: ["D"], vowel: false },
  { ipa: "f", cmu: ["F"], vowel: false },
  { ipa: "g", cmu: ["G"], vowel: false },
  { ipa: "ɡ", cmu: ["G"], vowel: false },
  { ipa: "h", cmu: ["HH"], vowel: false },
  { ipa: "k", cmu: ["K"], vowel: false },
  { ipa: "l", cmu: ["L"], vowel: false },
  { ipa: "ɫ", cmu: ["L"], vowel: false },
  { ipa: "m", cmu: ["M"], vowel: false },
  { ipa: "n", cmu: ["N"], vowel: false },
  { ipa: "ŋ", cmu: ["NG"], vowel: false },
  { ipa: "p", cmu: ["P"], vowel: false },
  { ipa: "r", cmu: ["R"], vowel: false },
  { ipa: "ɹ", cmu: ["R"], vowel: false },
  { ipa: "s", cmu: ["S"], vowel: false },
  { ipa: "ʃ", cmu: ["SH"], vowel: false },
  { ipa: "t", cmu: ["T"], vowel: false },
  { ipa: "θ", cmu: ["TH"], vowel: false },
  { ipa: "ð", cmu: ["DH"], vowel: false },
  { ipa: "v", cmu: ["V"], vowel: false },
  { ipa: "w", cmu: ["W"], vowel: false },
  { ipa: "j", cmu: ["Y"], vowel: false },
  { ipa: "z", cmu: ["Z"], vowel: false },
  { ipa: "ʒ", cmu: ["ZH"], vowel: false },
];

/** CMU Arpabet → the IPA used for Cartesia (General American). */
const CMU_TO_IPA: Record<string, { stressed: string; unstressed: string }> = {
  AA: { stressed: "ɑ", unstressed: "ɑ" },
  AE: { stressed: "æ", unstressed: "æ" },
  AH: { stressed: "ʌ", unstressed: "ə" },
  AO: { stressed: "ɔ", unstressed: "ɔ" },
  AW: { stressed: "aʊ", unstressed: "aʊ" },
  AY: { stressed: "aɪ", unstressed: "aɪ" },
  B: { stressed: "b", unstressed: "b" },
  CH: { stressed: "tʃ", unstressed: "tʃ" },
  D: { stressed: "d", unstressed: "d" },
  DH: { stressed: "ð", unstressed: "ð" },
  EH: { stressed: "ɛ", unstressed: "ɛ" },
  ER: { stressed: "ɝ", unstressed: "ɚ" },
  EY: { stressed: "eɪ", unstressed: "eɪ" },
  F: { stressed: "f", unstressed: "f" },
  G: { stressed: "ɡ", unstressed: "ɡ" },
  HH: { stressed: "h", unstressed: "h" },
  IH: { stressed: "ɪ", unstressed: "ɪ" },
  IY: { stressed: "i", unstressed: "i" },
  JH: { stressed: "dʒ", unstressed: "dʒ" },
  K: { stressed: "k", unstressed: "k" },
  L: { stressed: "l", unstressed: "l" },
  M: { stressed: "m", unstressed: "m" },
  N: { stressed: "n", unstressed: "n" },
  NG: { stressed: "ŋ", unstressed: "ŋ" },
  OW: { stressed: "oʊ", unstressed: "oʊ" },
  OY: { stressed: "ɔɪ", unstressed: "ɔɪ" },
  P: { stressed: "p", unstressed: "p" },
  R: { stressed: "ɹ", unstressed: "ɹ" },
  S: { stressed: "s", unstressed: "s" },
  SH: { stressed: "ʃ", unstressed: "ʃ" },
  T: { stressed: "t", unstressed: "t" },
  TH: { stressed: "θ", unstressed: "θ" },
  UH: { stressed: "ʊ", unstressed: "ʊ" },
  UW: { stressed: "u", unstressed: "u" },
  V: { stressed: "v", unstressed: "v" },
  W: { stressed: "w", unstressed: "w" },
  Y: { stressed: "j", unstressed: "j" },
  Z: { stressed: "z", unstressed: "z" },
  ZH: { stressed: "ʒ", unstressed: "ʒ" },
};

const CMU_VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW",
]);

const IGNORED_IPA = new Set([".", "‿", "(", ")", "ʔ", "ˑ", "ʰ", " ", "\t", "‍", "͡"]);

interface IpaToken {
  unit: PhonemeUnit;
  stress: 0 | 1 | 2 | null;
}

/** Splits IPA into phonemes with the stress marker that precedes each. Null if any symbol is unknown. */
function tokenizeIpa(raw: string): IpaToken[] | null {
  const text = raw.normalize("NFC").replace(/^\/|\/$/g, "").replace(/^\[|\]$/g, "").trim();
  const out: IpaToken[] = [];
  let pendingStress: 1 | 2 | null = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "ˈ") {
      pendingStress = 1;
      i += 1;
      continue;
    }
    if (ch === "ˌ") {
      pendingStress = 2;
      i += 1;
      continue;
    }
    if (IGNORED_IPA.has(ch)) {
      i += 1;
      continue;
    }
    const unit = IPA_UNITS.find((u) => text.startsWith(u.ipa, i));
    if (!unit) return null;
    out.push({ unit, stress: unit.vowel ? pendingStress : null });
    if (unit.vowel) pendingStress = null;
    i += unit.ipa.length;
  }
  return out.length ? out : null;
}

function parseCmu(raw: string): Array<{ symbol: string; stress: number | null }> | null {
  const parts = raw.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  const out: Array<{ symbol: string; stress: number | null }> = [];
  for (const part of parts) {
    const m = /^([A-Z]{1,2})([012])?$/.exec(part);
    if (!m || !CMU_TO_IPA[m[1]!]) return null;
    out.push({ symbol: m[1]!, stress: m[2] === undefined ? null : Number(m[2]) });
  }
  return out;
}

/** IPA → space-separated CMU Arpabet with stress digits, or null if it can't be converted. */
export function ipaToCmu(ipa: string): string | null {
  const tokens = tokenizeIpa(ipa);
  if (!tokens) return null;
  const anyStress = tokens.some((t) => t.stress !== null);
  const out: string[] = [];
  for (const { unit, stress } of tokens) {
    unit.cmu.forEach((symbol, idx) => {
      if (!CMU_VOWELS.has(symbol) || idx > 0) {
        out.push(symbol);
        return;
      }
      if (unit.ipa === "ə" || unit.ipa === "ɚ") {
        out.push(`${symbol}0`);
      } else if (stress !== null) {
        out.push(`${symbol}${stress}`);
      } else {
        out.push(anyStress ? `${symbol}0` : symbol);
      }
    });
  }
  return out.join(" ");
}

/**
 * CMU Arpabet → Cartesia phoneme segments. A stress mark is its own segment ("ˈ|æ"): measured on
 * sonic-2 and sonic-3, fusing it to the vowel ("ˈæ") mangled words ("quick" → "quack"/"cute").
 */
function cmuToCartesiaUnits(cmu: string): string[] | null {
  const parsed = parseCmu(cmu);
  if (!parsed) return null;
  const out: string[] = [];
  for (const { symbol, stress } of parsed) {
    const row = CMU_TO_IPA[symbol]!;
    if (!CMU_VOWELS.has(symbol)) {
      out.push(row.stressed);
      continue;
    }
    if (stress === 1) out.push("ˈ");
    else if (stress === 2) out.push("ˌ");
    out.push(stress === 0 ? row.unstressed : row.stressed);
  }
  return out;
}

function ipaToCartesiaUnits(ipa: string): string[] | null {
  const tokens = tokenizeIpa(ipa);
  if (!tokens) return null;
  const out: string[] = [];
  for (const { unit, stress } of tokens) {
    if (stress === 1) out.push("ˈ");
    else if (stress === 2) out.push("ˌ");
    out.push(unit.ipa);
  }
  return out;
}

// ── Per-provider rendering ────────────────────────────────────────────────────

/** Whether a provider can speak real phonemes (as opposed to respellings). */
export function providerSupportsPhonemes(provider: string | null | undefined): boolean {
  const p = String(provider ?? "").toLowerCase();
  return p === "fish" || p === "cartesia";
}

/**
 * The text to speak in place of the word for this voice, or null when this entry can't be
 * expressed on it (a phoneme entry on a voice with no phoneme input, or invalid phonemes).
 */
export function renderPronunciation(
  entry: PronunciationEntry,
  target: PronunciationTarget | null | undefined,
): string | null {
  const phoneme = entry.phoneme?.trim();
  if (!entry.word?.trim() || !phoneme) return null;
  if (entry.alphabet === "respell") return phoneme;
  const provider = String(target?.provider ?? "").toLowerCase();

  if (provider === "fish") {
    const cmu =
      entry.alphabet === "cmu"
        ? parseCmu(phoneme)?.map((p) => `${p.symbol}${p.stress ?? ""}`).join(" ")
        : ipaToCmu(phoneme);
    return cmu ? `<|phoneme_start|>${cmu}<|phoneme_end|>` : null;
  }
  if (provider === "cartesia") {
    const units = entry.alphabet === "cmu" ? cmuToCartesiaUnits(phoneme) : ipaToCartesiaUnits(phoneme);
    return units?.length ? `<<${units.join("|")}>>` : null;
  }
  return null;
}

/** Problem with an entry for the UI, or null when it is fine for every phoneme-capable voice. */
export function validatePronunciationEntry(entry: PronunciationEntry): string | null {
  if (!entry.word?.trim()) return "Enter the word or phrase.";
  if (!entry.phoneme?.trim()) return "Enter how it should sound.";
  if (entry.alphabet === "ipa" && !tokenizeIpa(entry.phoneme)) {
    return "Contains a symbol that isn't recognised IPA.";
  }
  if (entry.alphabet === "cmu" && !parseCmu(entry.phoneme)) {
    return "CMU must be space-separated symbols like “W IH0 B IY1”.";
  }
  return null;
}

// ── Matching ──────────────────────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Compiled {
  regex: RegExp | null;
  /** word → replacement (lowercased, single-spaced keys). */
  map: Map<string, string>;
  /** Lowercased word lists of multi-word entries, for stream hold-back. */
  phrases: string[][];
  maxWords: number;
}

const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function compile(
  entries: PronunciationEntry[] | null | undefined,
  target: PronunciationTarget | null | undefined,
): Compiled {
  const map = new Map<string, string>();
  for (const e of entries ?? []) {
    const rendered = renderPronunciation(e, target);
    if (rendered) map.set(normKey(e.word), rendered);
  }
  if (!map.size) return { regex: null, map, phrases: [], maxWords: 1 };
  // One alternation, longest first: a shorter entry ("Ada") can't clobber part of a longer one
  // ("Adam"), and a replacement is never re-matched by another entry.
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const source = keys.map((k) => escapeRegExp(k).replace(/ /g, "\\s+")).join("|");
  const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, "giu");
  const phrases = keys.filter((k) => k.includes(" ")).map((k) => k.split(" "));
  return { regex, map, phrases, maxWords: Math.max(1, ...keys.map((k) => k.split(" ").length)) };
}

/**
 * Whole-word, case-insensitive substitution of every entry this voice can express.
 * Entries it can't express are left as the original word.
 */
export function applyPronunciationDictionary(
  text: string,
  entries: PronunciationEntry[] | null | undefined,
  target?: PronunciationTarget | null,
): string {
  if (!entries?.length || !text) return text;
  const c = compile(entries, target);
  if (!c.regex) return text;
  return text.replace(c.regex, (m) => c.map.get(normKey(m)) ?? m);
}

/** Entries that can't be spoken on this voice (so the builder can say so instead of staying silent). */
export function unsupportedPronunciationEntries(
  entries: PronunciationEntry[] | null | undefined,
  target: PronunciationTarget | null | undefined,
): PronunciationEntry[] {
  return (entries ?? []).filter(
    (e) => e.word?.trim() && e.phoneme?.trim() && renderPronunciation(e, target) === null,
  );
}

/**
 * Apply the dictionary (and an optional text pre-pass) to a token stream.
 *
 * Tokens split words — "Xe" + "ro" — and phrases, so text is released only up to the last
 * whitespace, and a trailing run of words that could still become a multi-word entry is held
 * back. That is at most a word or two of delay, and only when there is something to apply;
 * with nothing to apply the stream passes through untouched.
 */
export async function* applyPronunciationDictionaryStream(
  source: AsyncIterable<string>,
  entries: PronunciationEntry[] | null | undefined,
  target: PronunciationTarget | null | undefined,
  prepass?: (text: string) => string,
): AsyncGenerator<string> {
  const c = compile(entries, target);
  if (!c.regex && !prepass) {
    yield* source;
    return;
  }
  const transform = (text: string) => {
    const pre = prepass ? prepass(text) : text;
    return c.regex ? pre.replace(c.regex, (m) => c.map.get(normKey(m)) ?? m) : pre;
  };

  let buf = "";
  for await (const delta of source) {
    if (!delta) continue;
    buf += delta;
    let cut = -1;
    for (let i = buf.length - 1; i >= 0; i--) {
      if (/\s/.test(buf[i]!)) {
        cut = i + 1;
        break;
      }
    }
    if (cut <= 0) continue;
    cut = holdBackPhraseStart(buf, cut, c.phrases);
    if (cut <= 0) continue;
    const out = transform(buf.slice(0, cut));
    buf = buf.slice(cut);
    if (out) yield out;
  }
  if (buf) {
    const out = transform(buf);
    if (out) yield out;
  }
}

/** Move `cut` earlier so a trailing partial multi-word entry stays in the buffer. */
function holdBackPhraseStart(buf: string, cut: number, phrases: string[][]): number {
  if (!phrases.length) return cut;
  const words = [...buf.slice(0, cut).matchAll(/\S+/g)];
  let earliest = cut;
  for (const phrase of phrases) {
    for (let k = Math.min(phrase.length - 1, words.length); k >= 1; k--) {
      const tail = words.slice(words.length - k);
      const matches = tail.every((w, i) => {
        const word = w[0].toLowerCase().replace(/[^\p{L}\p{N}']+$/u, "");
        return word === phrase[i];
      });
      if (matches) {
        earliest = Math.min(earliest, tail[0]!.index!);
        break;
      }
    }
  }
  return earliest;
}
