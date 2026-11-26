/**
 * Where to cut a streamed reply into phrases for text-to-speech.
 *
 * Used by Fish (when to send `flush`) and Cartesia (when to send a phrase with server-side
 * buffering off). Both voices pause and end a phrase with an ending's intonation where they are
 * cut, so the cut has to fall where a speaker would pause anyway.
 *
 * The first cut used to fire after 12 characters, mid-phrase — "Perfect, and | is the property…" —
 * which put an audible break inside the sentence (a 380 ms gap measured on Fish at exactly that
 * cut). Cutting at the first clause boundary (a comma or full stop) reached first audio just as
 * fast in measurement (676 vs 695 ms median) with less dead air inside the line. After the first
 * phrase, cut only at sentence ends.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

/** With no clause punctuation yet, cut at a word boundary once this much text is waiting. */
export const FIRST_PHRASE_FALLBACK_CHARS = 60;

export function shouldFlushTtsPhrase(buffered: string, alreadyFlushed: boolean): boolean {
  const ready = buffered.trim();
  if (!ready) return false;
  if (!alreadyFlushed) {
    if (ready.length >= 6 && /[.!?,;:]["'”’)]?$/.test(ready)) return true;
    return ready.length >= FIRST_PHRASE_FALLBACK_CHARS && /\s$/.test(buffered);
  }
  return /[.!?]["'”’)]?$/.test(ready) && ready.length >= 24;
}
