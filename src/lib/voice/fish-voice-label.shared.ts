/**
 * Display helpers for Fish Audio voices in the Builder.
 * Shared between server catalog mapping and client UI rows.
 */
export interface FishVoiceDisplayFields {
  title: string;
  languages: string[];
  tags: string[];
  owned: boolean;
}

/** Human-readable subtitle: gender/accent tags + languages. */
export function formatFishVoiceSubtitle(voice: FishVoiceDisplayFields): string {
  const parts: string[] = [];
  if (voice.owned) parts.push("Your clone");

  const tagHints = (voice.tags ?? [])
    .filter((t) => /^(male|female|man|woman|narrat|british|american|australian|english|neutral)/i.test(t))
    .slice(0, 3);
  if (tagHints.length) parts.push(tagHints.join(" · "));

  const langs = (voice.languages ?? []).filter(Boolean).slice(0, 2);
  if (langs.length) parts.push(langs.join(", "));
  else if (!voice.owned) parts.push("Voice library");

  return parts.join(" · ") || "Voice library";
}

/** Primary row label — cleans up noisy Fish titles when possible. */
export function formatFishVoiceLabel(voice: FishVoiceDisplayFields): string {
  const title = (voice.title ?? "Untitled voice").trim();
  if (voice.owned) return title;

  // Prefer a descriptive tag over meme-style titles when tags look more professional.
  const narr = voice.tags?.find((t) => /narrat|assistant|professional|calm|warm|friendly/i.test(t));
  if (narr && title.length > 40 && /[^\x00-\x7F]/.test(title)) {
    return narr.charAt(0).toUpperCase() + narr.slice(1);
  }
  return title;
}

/** Group key for section headers in the voice list. */
export function fishVoiceGroup(voice: Pick<FishVoiceDisplayFields, "owned">): "yours" | "library" {
  return voice.owned ? "yours" : "library";
}
