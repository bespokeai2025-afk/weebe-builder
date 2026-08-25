/**
 * Language consistency for WEBEE Native voice calls.
 *
 * Without an explicit lock, Whisper/Deepgram auto-detect from audio and the LLM
 * mirrors whatever script it sees — which is why a brief Arabic or Hindi utterance
 * can derail an English sales agent mid-call.
 */

const ENGLISH_CODES = new Set([
  "en",
  "en-us",
  "en-gb",
  "en-au",
  "en-in",
  "en-ca",
  "en-ie",
  "en-nz",
  "en-za",
]);

/** Primary BCP-47 code from builder speechLanguages, or undefined when multilingual. */
export function resolvePrimarySpeechLanguage(
  speechLanguages?: string[] | null,
  fallback = "en-US",
): string | undefined {
  const list = (speechLanguages?.length ? speechLanguages : [fallback]).map((c) =>
    String(c).trim(),
  );
  if (list.some((c) => c.toLowerCase() === "multi")) return undefined;
  return list[0] || fallback;
}

/** ISO-639-1 / Deepgram language code for STT (en-US → en). */
export function resolveSttLanguageCode(
  speechLanguages?: string[] | null,
  fallback = "en-US",
): string | undefined {
  const primary = resolvePrimarySpeechLanguage(speechLanguages, fallback);
  if (!primary) return undefined;
  const base = primary.split("-")[0]?.toLowerCase();
  return base || undefined;
}

/** True when the agent is configured for English only. */
export function isEnglishOnlyAgent(
  speechLanguages?: string[] | null,
  fallback = "en-US",
): boolean {
  const primary = resolvePrimarySpeechLanguage(speechLanguages, fallback);
  if (!primary) return false;
  return ENGLISH_CODES.has(primary.toLowerCase()) || primary.toLowerCase().startsWith("en-");
}

/**
 * System-prompt block injected into every graph turn and flat-mode calls.
 * Returns empty string for explicit multilingual agents.
 */
export function buildLanguageLockInstruction(
  speechLanguages?: string[] | null,
  fallback = "en-US",
): string {
  const primary = resolvePrimarySpeechLanguage(speechLanguages, fallback);
  if (!primary) {
    return [
      "Language: respond in the same language the caller uses most recently.",
      "If the caller mixes languages, prefer English for business clarity.",
    ].join(" ");
  }

  if (isEnglishOnlyAgent(speechLanguages, fallback)) {
    return [
      "CRITICAL LANGUAGE RULE: You MUST speak and write ONLY in English for this entire call.",
      "All spoken replies must use Latin letters (A–Z) only — never Devanagari, Arabic, Chinese,",
      "or other non-Latin scripts in what you say.",
      "If speech recognition returns a name in another script (e.g. आर जो), infer the English",
      "spelling (Arjo) and say it in Latin letters; do not echo the foreign script.",
      "When collecting a name, accept what the caller says once and move on — never ask them to",
      "repeat, spell, or switch language.",
      "Never switch to Arabic, Hindi, Urdu, or any other language unless the caller explicitly",
      "asks you to speak that language.",
    ].join(" ");
  }

  const name = primary.replace("_", "-");
  return [
    `CRITICAL LANGUAGE RULE: You MUST speak and write ONLY in ${name} for this entire call.`,
    "Do not switch languages unless the caller explicitly asks you to.",
  ].join(" ");
}

/** True when most letters are outside the Latin script (e.g. Devanagari from mis-detected STT). */
export function isMostlyNonLatinScript(text: string): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters?.length) return false;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return latin / letters.length < 0.5;
}

/** CJK / filler syllables Fish ASR often hallucinates on silence or echo. */
export function isLikelyEnglishSttHallucination(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{P}\s]+$/u.test(t)) {
    // Repeated CJK on web calls is usually echo/silence — unless it is a clear greeting.
    if (/^哈喽/.test(t) && t.replace(/[哈喽，,\s]/g, "").length === 0) return false;
    return true;
  }
  if (/^[\p{Script=Arabic}\p{P}\s]+$/u.test(t)) return true;
  if (/^(嗯|啊|呃|哦|はい|네|أرجو)[。．.!?]?$/u.test(t)) return true;
  if (/^係啊[！!]?$/u.test(t)) return true;
  return false;
}

/** Common CJK greetings mis-detected instead of English "hello". */
const CJK_GREETING_ROMAN: Record<string, string> = {
  哈喽: "hello",
  你好: "hello",
};

const DEVANAGARI_CONSONANT: Record<number, string> = {
  0x0915: "k",
  0x0916: "kh",
  0x0917: "g",
  0x0918: "gh",
  0x0919: "ng",
  0x091a: "ch",
  0x091b: "chh",
  0x091c: "j",
  0x091d: "jh",
  0x091e: "ny",
  0x091f: "t",
  0x0920: "th",
  0x0921: "d",
  0x0922: "dh",
  0x0923: "n",
  0x0924: "t",
  0x0925: "th",
  0x0926: "d",
  0x0927: "dh",
  0x0928: "n",
  0x0929: "n",
  0x092a: "p",
  0x092b: "ph",
  0x092c: "b",
  0x092d: "bh",
  0x092e: "m",
  0x092f: "y",
  0x0930: "r",
  0x0931: "r",
  0x0932: "l",
  0x0933: "l",
  0x0934: "l",
  0x0935: "v",
  0x0936: "sh",
  0x0937: "sh",
  0x0938: "s",
  0x0939: "h",
};

const DEVANAGARI_VOWEL: Record<number, string> = {
  0x0905: "a",
  0x0906: "aa",
  0x0907: "i",
  0x0908: "ee",
  0x0909: "u",
  0x090a: "oo",
  0x090f: "e",
  0x0910: "ai",
  0x0913: "o",
  0x0914: "au",
  0x093e: "a",
  0x093f: "i",
  0x0940: "ee",
  0x0941: "u",
  0x0942: "oo",
  0x0947: "e",
  0x0948: "ai",
  0x094b: "o",
  0x094c: "au",
};

/**
 * Rough Devanagari → Latin for English-locked calls.
 * Fish often returns Hindi script for English speech (names, "hello"); dropping
 * those transcripts freezes the agent after the greeting.
 */
export function romanizeDevanagari(text: string): string {
  let out = "";
  let pending = "";

  const flushConsonant = (vowel = "a") => {
    if (!pending) return;
    out += pending + vowel;
    pending = "";
  };

  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x094d) {
      if (pending) {
        out += pending;
        pending = "";
      }
      continue;
    }
    if (code in DEVANAGARI_VOWEL && !pending) {
      out += DEVANAGARI_VOWEL[code];
      continue;
    }
    if (code in DEVANAGARI_VOWEL && pending) {
      flushConsonant(DEVANAGARI_VOWEL[code]);
      continue;
    }
    if (code in DEVANAGARI_CONSONANT) {
      if (pending) flushConsonant();
      pending = DEVANAGARI_CONSONANT[code];
      continue;
    }
    if (/\s/.test(ch)) {
      flushConsonant();
      out += " ";
      continue;
    }
    if (code === 0x0964 || code === 0x0965) {
      flushConsonant();
      continue;
    }
  }
  flushConsonant();
  return out.replace(/\s+/g, " ").trim();
}

/** Best-effort Latin from non-Latin Fish output on English agents. */
export function romanizeForEnglishStt(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  for (const [src, dst] of Object.entries(CJK_GREETING_ROMAN)) {
    if (trimmed.includes(src)) return dst;
  }

  if (/[\u0900-\u097F]/.test(trimmed)) {
    const roman = romanizeDevanagari(trimmed)
      .replace(/\baara\b/gi, "ar")
      .replace(/\bhelo\b/gi, "hello")
      .replace(/\bhaalo\b/gi, "hello")
      .replace(/\s+/g, " ")
      .trim();
    if (roman.length >= 2) return roman;
  }

  return "";
}

/**
 * Normalize STT for English-locked agents: drop hallucinations, romanize Indic
 * script, then strip anything still non-Latin.
 */
export function normalizeEnglishLockedSttText(text: string, language?: string): string {
  const trimmed = text.trim();
  if (!trimmed || language !== "en") return trimmed;
  if (isLikelyEnglishSttHallucination(trimmed)) return "";

  let working = trimmed;
  if (isMostlyNonLatinScript(working)) {
    const romanized = romanizeForEnglishStt(working);
    if (romanized) working = romanized;
  }

  const latin = working
    .replace(/[^\p{Script=Latin}\p{N}\s.,!?'"$%-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (latin.length < 2) {
    const romanized = romanizeForEnglishStt(trimmed);
    return romanized.length >= 2 ? romanized : "";
  }
  return latin;
}

/** Human label for the in-call engine banner. */
export function formatSpeechLanguageLabel(
  speechLanguages?: string[] | null,
  fallback = "en-US",
): string {
  const primary = resolvePrimarySpeechLanguage(speechLanguages, fallback);
  if (!primary) return "Multilingual";
  if (isEnglishOnlyAgent(speechLanguages, fallback)) return "English";
  return primary;
}
