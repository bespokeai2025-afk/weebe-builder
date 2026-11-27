/**
 * When the session may start listening afresh (the agent's line has finished or been fully sent)
 * without losing something the caller is saying.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

/**
 * The caller is part-way through an utterance the VAD has open, and at least one frame of it was
 * loud enough to be the caller rather than the agent's echo. Resetting now would drop it.
 */
export function callerMidUtterance(state: { callerSpeaking: boolean; utteranceLoud: boolean }): boolean {
  return state.callerSpeaking && state.utteranceLoud;
}

/** The utterance began before the agent's audio stopped — so it may hold the agent's own echo. */
export function startedDuringPlayback(speechStartAt: number | null, lastPlaybackEndAt: number): boolean {
  return speechStartAt !== null && lastPlaybackEndAt > 0 && speechStartAt <= lastPlaybackEndAt;
}
