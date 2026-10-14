/**
 * Whether to say "Sorry, I didn't catch that" when speech-to-text returns nothing.
 *
 * Voice detection fires on any sound: a breath, line noise, a cough, or — on a phone call — the
 * echo of the agent's own last words coming back down the line just after it stops. Speech-to-text
 * then (correctly) finds no words. Answering every one of those with "Sorry, I didn't catch that"
 * made the agent interrupt itself straight after its own questions, often twice, before the caller
 * had said anything. That is only the right response when the caller clearly spoke and it was lost:
 * a sound long enough to be words, that did not start right as the agent stopped talking.
 * Anything else is ignored and the agent keeps listening; the normal reminder still covers a
 * caller who has gone quiet.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

/** Utterance audio (including the end-of-turn hangover) shorter than this is not lost speech. */
export const MIN_LOST_SPEECH_MS = 1_400;
/** Sound starting this soon after the agent stopped is treated as echo / line noise. */
export const ECHO_TAIL_MS = 2_000;

export function shouldNudgeOnEmptyTranscript(args: {
  /** Length of the endpointed audio, in ms. */
  utteranceMs: number;
  /** When the caller's sound started (ms epoch), if known. */
  speechStartAt: number | null;
  /** When the agent's last audio finished playing (ms epoch); 0 if it hasn't spoken. */
  lastPlaybackEndAt: number;
}): boolean {
  if (args.utteranceMs < MIN_LOST_SPEECH_MS) return false;
  if (args.speechStartAt && args.lastPlaybackEndAt && args.speechStartAt - args.lastPlaybackEndAt < ECHO_TAIL_MS) {
    return false;
  }
  return true;
}
