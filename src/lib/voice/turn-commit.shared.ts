/**
 * When a streaming STT partial is already a finished collect-path answer,
 * skip Fish finalize and shorten VAD hangover + coalesce — Retell-style commit.
 */

import { isLikelyEnglishSttHallucination, isMostlyNonLatinScript } from "./language-lock.shared";
import {
  looksLikeOwnerAnswer,
  looksLikePhoneAnswer,
  looksLikeTitleAnswer,
} from "./graph/router";

const UK_POSTCODE = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i;

export function looksLikeCompleteShortReply(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
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

/** Silence hangover after last speech, given the current partial. */
export function resolveEndpointHangoverMs(
  partialText: string | undefined,
  baseMs: number,
): number {
  const t = partialText?.trim() ?? "";
  if (!t) return baseMs;
  if (looksLikeCompleteShortReply(t) || looksLikeTitleAnswer(t)) {
    return Math.min(baseMs, 250);
  }
  if (looksLikeCommitReadyPartial(t)) {
    return Math.min(baseMs, 350);
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
