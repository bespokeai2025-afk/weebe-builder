/**
 * Grow the on-screen agent transcript as audio actually plays, instead of
 * dumping the whole node script in one block.
 */

export function splitSpokenSentences(text: string): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [t];
}

/**
 * How much of `full` the caller has likely heard, given PCM16 bytes already sent.
 * Snaps back to the last sentence (or word) boundary so the UI does not show
 * half a word.
 */
export function transcriptCaughtUpToAudio(
  full: string,
  pcmBytes: number,
  sampleRate: number,
): string {
  const spoken = full.replace(/\s+/g, " ").trim();
  if (!spoken || pcmBytes <= 0 || sampleRate <= 0) return "";
  const seconds = pcmBytes / (sampleRate * 2);
  const chars = Math.floor(seconds * 18);
  if (chars >= spoken.length) return spoken;
  const cut = spoken.slice(0, Math.max(chars, 1));
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (sentence >= 8) return spoken.slice(0, sentence + 1).trim();
  const space = cut.lastIndexOf(" ");
  return (space > 6 ? cut.slice(0, space) : cut).trim();
}
