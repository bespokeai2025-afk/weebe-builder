/**
 * When a streaming STT partial is already a finished answer — and when it is plainly not.
 *
 * Only signals that hold for any agent, whatever it collects: the recogniser's own punctuation,
 * words a finished sentence cannot end on, a bare yes/no-type reply, and numbers being read out
 * (judged by their shape). Nothing here knows about addresses, postcodes, titles or phone
 * numbers — rules like that suited one flow and misjudged the rest, so they are not the builder's
 * to assume. A step that needs more patience gets it from its own end-of-speech setting.
 */

import { isLikelyEnglishSttHallucination, isMostlyNonLatinScript } from "./language-lock.shared";
import { spokenDigitCount } from "./graph/router";

/** A bare reply that answers a yes/no-type question on its own: "Yes.", "Okay, sure". */
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

/** Partial is a finished answer that can be committed straight away. */
export function looksLikeCommitReadyPartial(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2) return false;
  if (isMostlyNonLatinScript(t) || isLikelyEnglishSttHallucination(t)) return false;
  return looksLikeCompleteShortReply(t);
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
]);

/** Tokens that read out digits: numerals, digit words, "oh"/"o", "double"/"triple". */
const DIGIT_TOKEN = /^(\d+|zero|oh|o|one|two|three|four|five|six|seven|eight|nine|double|triple|quadruple|hundred|thousand)$/;

/**
 * A number being read out digit by digit — any kind (a reference, an account, a phone number).
 * Callers pause between digit groups and the recogniser ends each group with a full stop, so
 * neither the pause nor the punctuation means they are done: on a test call the turn was cut
 * after "O seven seven double o." and the rest of the number was lost. Judged by shape only:
 * nearly every word is a digit, and at least three digits so far. Amounts ("$50,000"), years
 * ("In 2023"), dates and single numbers ("12", "Seven.") are not shaped like this. The cost of a
 * finished number is the longer end-of-speech wait, once.
 */
export function looksLikeNumberBeingReadOut(text: string): boolean {
  if (/[$£€%]|\d{1,3}(,\d{3})+/.test(text)) return false;
  const words = text.toLowerCase().replace(/[.,!?;:\-]+/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const digitWords = words.filter((w) => DIGIT_TOKEN.test(w)).length;
  if (digitWords / words.length < 0.8) return false;
  return spokenDigitCount(text) >= 3;
}

/**
 * True when the partial looks cut off mid-utterance.
 *
 * `resolveEndpointHangoverMs` could otherwise only shorten the silence window, so it had to be set
 * high defensively — a tax on every turn. Detecting incompleteness lets the base window come down
 * and the extra patience be spent only where it is needed.
 */
export function looksLikeIncompletePartial(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[,;:\-]+$/g, "");
  if (!t) return false;
  // Ahead of the punctuation rule: here the full stop is the recogniser's, not the caller's.
  if (looksLikeNumberBeingReadOut(text)) return true;
  // Terminal punctuation is the caller's own signal that they are done.
  if (/[.!?]$/.test(text.trim())) return false;
  // A commit-ready answer is complete by definition; never hold it back.
  if (looksLikeCommitReadyPartial(text)) return false;

  const words = t.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  if (!last) return false;

  if (DANGLING_WORDS.has(last)) return true;

  // The recogniser's own punctuation: it ends a finished thought with a full stop, and leaves a
  // comma where the speaker paused mid-list ("12 High Street, Manchester," … "M1 1AA").
  if (/,$/.test(text.trim()) && words.length >= 2) return true;

  return false;
}

/** Longest we will wait on an unfinished-sounding partial. */
export const INCOMPLETE_PARTIAL_HANGOVER_MS = 900;

/** Silence hangover after last speech, given the current partial. */
export function resolveEndpointHangoverMs(partialText: string | undefined, baseMs: number): number {
  const t = partialText?.trim() ?? "";
  if (!t) return baseMs;
  if (looksLikeCommitReadyPartial(t)) {
    return Math.min(baseMs, 250);
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
  if (looksLikeCommitReadyPartial(t)) {
    return Math.min(baseMs, 50);
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
