/**
 * `pronunciationDictionary` — per-word pronunciation overrides authored in the builder.
 *
 * Fish Audio (the native TTS provider) has no IPA/CMU phoneme input at the API level
 * (checked `fish.provider.ts`'s start-request builder — no phoneme/SSML field exists),
 * so an actual phonetic override isn't possible without inventing a phoneme-to-grapheme
 * converter, which is its own large, error-prone subsystem. The practical substitute —
 * what most thin TTS integrations do when the backend lacks native phoneme support — is
 * to treat the dictionary's `phoneme` field as the literal respelling to say instead of
 * the word (e.g. word "Xero", phoneme "ZEE-ro"), and substitute it into the text before
 * synthesis. This is real, user-authored, per-agent behavior — not a hardcoded mapping.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export interface PronunciationEntry {
  word: string;
  alphabet: "ipa" | "cmu";
  phoneme: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Applies whole-word, case-insensitive substitutions. Longest words first so
 * a shorter entry ("Ada") can't clobber part of a longer one ("Adam") first.
 */
export function applyPronunciationDictionary(
  text: string,
  entries: PronunciationEntry[] | null | undefined,
): string {
  if (!entries?.length) return text;
  const usable = entries
    .filter((e) => e.word?.trim() && e.phoneme?.trim())
    .sort((a, b) => b.word.length - a.word.length);
  if (!usable.length) return text;

  return usable.reduce((acc, entry) => {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.word.trim())}\\b`, "gi");
    return acc.replace(pattern, entry.phoneme.trim());
  }, text);
}
