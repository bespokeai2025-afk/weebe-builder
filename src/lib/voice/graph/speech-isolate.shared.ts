/**
 * Keep the speech LLM on the current node only.
 *
 * A leftover global prompt or the previous agent line is how one workflow's
 * questions leak into another. Mode is still declared on the node — this only
 * constrains what the model is allowed to say.
 */

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "is",
  "it",
  "you",
  "your",
  "please",
  "could",
  "would",
  "can",
  "just",
  "that",
  "this",
  "with",
  "from",
  "have",
  "has",
  "are",
  "was",
  "be",
  "do",
  "did",
  "not",
  "any",
  "our",
  "we",
  "i",
  "me",
  "my",
  "thank",
  "thanks",
  "great",
  "okay",
  "ok",
  "want",
  "ask",
  "confirm",
  "like",
  "need",
  "get",
  "tell",
  "help",
  "sure",
  "looking",
  "about",
  "their",
  "they",
  "them",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, " ")
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function related(word: string, allowed: Set<string>): boolean {
  if (allowed.has(word)) return true;
  for (const other of allowed) {
    if (word.startsWith(other) || other.startsWith(word)) return true;
  }
  return false;
}

/** First sentence / short identity — never a collect script. */
export function personaFromGlobalPrompt(globalPrompt: string, max = 120): string {
  const first = globalPrompt
    .split(/[\n.!?]/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .find((s) => s.length > 0);
  if (!first) return "";
  if (/\b(always|collect|ask|confirm|book|address|postcode|email|phone)\b/i.test(first) && first.length > 80) {
    return first.slice(0, max).trim();
  }
  return first.length <= max ? first : `${first.slice(0, max).trim()}…`;
}

export function speechOnNodeTask(spoken: string, nodeText: string, nodeName = ""): boolean {
  const spokenWords = tokens(spoken);
  if (spokenWords.length === 0) return true;
  const allowed = new Set(tokens(`${nodeText} ${nodeName}`));
  if (allowed.size === 0) return true;
  let hits = 0;
  const extra: string[] = [];
  for (const word of spokenWords) {
    if (related(word, allowed)) hits += 1;
    else extra.push(word);
  }
  if (hits >= 1) return true;
  return extra.length < 2;
}

export function constrainGeneratedSpeech(
  spoken: string,
  fallback: string,
  nodeText: string,
  nodeName = "",
): { text: string; offTopic: boolean } {
  const clean = spoken.trim();
  if (!clean) return { text: fallback.trim(), offTopic: Boolean(fallback.trim()) };
  if (speechOnNodeTask(clean, nodeText, nodeName)) {
    return { text: clean, offTopic: false };
  }
  const safe = fallback.trim();
  return { text: safe || clean, offTopic: Boolean(safe) };
}
