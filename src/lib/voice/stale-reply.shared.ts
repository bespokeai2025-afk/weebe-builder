/**
 * Was this caller utterance said before they could have heard the agent's latest line?
 *
 * The case it exists for: the caller says "yeah", the transcript is slow, so they say "yeah" again.
 * The first one answers the current node and the agent moves on to the next node's question. The
 * second was already said — but it reached routing after the move, so it was taken as the answer
 * to a question the caller had not heard yet, and that node was skipped.
 *
 * An utterance that began before the agent's reply started playing (plus a reaction margin) cannot
 * be answering that reply. When such an utterance is only an acknowledgement or a repeat of the
 * previous answer, it carries nothing new and is dropped. Anything with content is still handled.
 *
 * Relative imports only — reachable from the voice runtime.
 */

/** Nobody answers a question within this long of it starting to play. */
export const STALE_REPLY_MARGIN_MS = 600;

export function isStaleReply(params: {
  /** When the caller started saying this utterance. */
  speechStartAt: number | null;
  /** When the previous caller utterance was accepted (0 before any). */
  lastAcceptedUserAt: number;
  /** When the agent began its reply to that utterance (null: it has not spoken since). */
  replySpeakAt: number | null;
  /** When that reply's audio started playing (null: not yet). */
  replyAudioStartAt: number | null;
  marginMs?: number;
}): boolean {
  const { speechStartAt, lastAcceptedUserAt, replySpeakAt, replyAudioStartAt } = params;
  if (!lastAcceptedUserAt || speechStartAt === null) return false;
  // The agent said nothing in reply (e.g. a silent step) — there is no new question to protect.
  if (replySpeakAt === null) return false;
  // Reply chosen but not audible yet: anything said now predates it.
  if (replyAudioStartAt === null) return true;
  return speechStartAt < replyAudioStartAt + (params.marginMs ?? STALE_REPLY_MARGIN_MS);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ACKNOWLEDGEMENTS = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "ya",
  "yah",
  "ok",
  "okay",
  "sure",
  "right",
  "alright",
  "all right",
  "correct",
  "that's right",
  "thats right",
  "yes please",
  "mm hmm",
  "mhm",
  "uh huh",
  "hmm",
  "hello",
]);

/** The same words as `previous` (ignoring case and punctuation). */
export function isRepeatOf(text: string, previous: string): boolean {
  const a = normalize(text);
  return a.length > 0 && a === normalize(previous);
}

/**
 * Nothing but an acknowledgement ("yeah", "yes yes", "okay.") or a repeat of the previous answer.
 * The acknowledgement list is English, so other languages only match exact repeats.
 */
export function isAckOrRepeat(text: string, previous: string, english: boolean): boolean {
  if (isRepeatOf(text, previous)) return true;
  if (!english) return false;
  const words = normalize(text);
  if (!words) return false;
  if (ACKNOWLEDGEMENTS.has(words)) return true;
  // "yeah yeah", "yes, okay"
  const parts = words.split(" ");
  return parts.length <= 3 && parts.every((w) => ACKNOWLEDGEMENTS.has(w));
}
