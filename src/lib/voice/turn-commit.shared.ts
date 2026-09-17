/**
 * When a streaming STT partial is already a finished collect-path answer,
 * skip Fish finalize and shorten VAD hangover + coalesce — Retell-style commit.
 */

import { isLikelyEnglishSttHallucination, isMostlyNonLatinScript } from "./language-lock.shared";
import { looksLikeOwnerAnswer, looksLikePhoneAnswer, looksLikeTitleAnswer } from "./graph/router";

const UK_POSTCODE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i;

export function looksLikeCompleteShortReply(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "");
  if (!t || t.length > 28) return false;
  return /^(yes|yeah|yep|yup|no|nope|nah|ok|okay|sure|correct|right|please|continue|next|go ahead)(?:\s+(please|thanks|thank you|sure))?$/.test(
    t,
  );
}

export function looksLikeUkPostcode(text: string): boolean {
  return UK_POSTCODE.test(text.trim());
}

/** Digit/spoken phone that is long enough to treat as complete. */
export function looksLikeCompletePhoneAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || !looksLikePhoneAnswer(t)) return false;
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 10) return true;
  const numberWords =
    t.match(
      /\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|double|triple|quadruple)\b/gi,
    ) ?? [];
  return numberWords.length >= 8;
}

/**
 * Partial is a finished collect-path answer. Addresses stay out — callers often
 * pause between street and city, and those need the longer coalesce.
 */
export function looksLikeCommitReadyPartial(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2) return false;
  if (isMostlyNonLatinScript(t) || isLikelyEnglishSttHallucination(t)) return false;
  if (looksLikeCompleteShortReply(t)) return true;
  if (looksLikeTitleAnswer(t)) return true;
  if (looksLikeOwnerAnswer(t)) return true;
  if (looksLikeUkPostcode(t) && t.split(/\s+/).length <= 4) return true;
  if (looksLikeCompletePhoneAnswer(t)) return true;
  return false;
}

/**
 * Words that cannot end a finished sentence, so a partial trailing on one means
 * the caller is still mid-thought.
 *
 * Kept to high-confidence cases only. A false positive here makes the agent
 * feel laggy on a turn that was actually complete, which is the exact fault
 * this whole mechanism exists to remove — so anything ambiguous is left out.
 */
const DANGLING_WORDS = new Set([
  // conjunctions / connectives
  "and", "but", "or", "so", "because", "cos", "cause", "although", "though",
  "if", "when", "while", "plus", "then",
  // prepositions
  "of", "to", "at", "in", "on", "for", "with", "from", "by", "into", "about",
  "near", "off", "over", "under",
  // determiners / possessives that demand a noun
  "a", "an", "the", "my", "your", "our", "their", "his", "her", "its", "this",
  "that", "these", "those", "some", "any",
  // copulas / auxiliaries mid-clause
  "is", "are", "was", "were", "am", "be", "been", "will", "would", "can",
  "could", "should", "have", "has", "had", "do", "does", "did", "its",
  // hesitation
  "um", "uh", "er", "erm", "hmm", "ah", "eh", "like", "well", "just", "kind",
  "sort",
  // spelling / dictation in progress
  "double", "triple",
]);

/** Outward code with no inward half yet — "PR5" before "6XQ" arrives. */
const PARTIAL_POSTCODE_TAIL = /\b[a-z]{1,2}\d{1,2}[a-z]?$/i;

/**
 * True when the partial looks cut off mid-utterance.
 *
 * This is the half that was missing. `resolveEndpointHangoverMs` could only
 * ever shorten the silence window, so `silenceDurationMs` had to be set high
 * (400–700ms) defensively to avoid clipping anyone — a tax on every single
 * turn. Detecting incompleteness lets the base window come down and the extra
 * patience be spent only where it is actually needed.
 */
export function looksLikeIncompletePartial(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[,;:\-]+$/g, "");
  if (!t) return false;
  // Terminal punctuation is the caller's own signal that they are done.
  if (/[.!?]$/.test(text.trim())) return false;
  // A commit-ready answer is complete by definition; never hold it back.
  if (looksLikeCommitReadyPartial(text)) return false;

  const words = t.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (!last) return false;

  if (DANGLING_WORDS.has(last)) return true;

  // Mid-number: a lone short digit run is almost never a finished answer,
  // but a long one (phone number) usually is.
  if (/^\d+$/.test(last) && last.length <= 3 && words.length <= 2) return true;

  // Half a postcode, with nothing after it.
  if (words.length <= 3 && PARTIAL_POSTCODE_TAIL.test(last) && /\d/.test(last)) {
    return !looksLikeUkPostcode(t);
  }

  return false;
}

/** Silence hangover after last speech, given the current partial. */
/** Longest we will wait on an unfinished-sounding partial. */
export const INCOMPLETE_PARTIAL_HANGOVER_MS = 900;

export function resolveEndpointHangoverMs(partialText: string | undefined, baseMs: number): number {
  const t = partialText?.trim() ?? "";
  if (!t) return baseMs;
  if (looksLikeCompleteShortReply(t) || looksLikeTitleAnswer(t)) {
    return Math.min(baseMs, 250);
  }
  if (looksLikeCommitReadyPartial(t)) {
    return Math.min(baseMs, 350);
  }
  // Mid-thought: hold the window open rather than clipping the caller. Only
  // ever extends, never shortens, so a deliberately long base is respected.
  if (looksLikeIncompletePartial(t)) {
    return Math.max(baseMs, INCOMPLETE_PARTIAL_HANGOVER_MS);
  }
  return baseMs;
}

/** Wait after VAD endpoint before STT — shorter when the partial is already complete. */
export function resolveUtteranceCoalesceMs(
  partialText: string | undefined,
  baseMs: number,
): number {
  const t = partialText?.trim() ?? "";
  if (!t) return baseMs;
  if (looksLikeCompleteShortReply(t) || looksLikeTitleAnswer(t)) {
    return Math.min(baseMs, 50);
  }
  if (looksLikeCommitReadyPartial(t)) {
    return Math.min(baseMs, 80);
  }
  return baseMs;
}

/** Use the stable partial as the turn text instead of waiting on Fish commit. */
export function shouldSkipSttFinal(partial: string, hasHeuristicWarm = false): boolean {
  const t = partial.trim();
  if (!t || t.length < 2) return false;
  if (isMostlyNonLatinScript(t) || isLikelyEnglishSttHallucination(t)) return false;
  if (looksLikeCompleteShortReply(t) && hasHeuristicWarm) return true;
  return looksLikeCommitReadyPartial(t);
}

/**
 * A turn that has not started STT or TTS — safe to replace.
 * Never treat an in-flight greeting / agent line as idle (that muted the call).
 */
export function isIdleCallerTurn(
  turn:
    | {
        sttAt?: number;
        speakAt?: number;
        firstAudioAt?: number;
      }
    | null
    | undefined,
): boolean {
  if (!turn) return false;
  if (turn.speakAt || turn.firstAudioAt) return false;
  return !turn.sttAt;
}
