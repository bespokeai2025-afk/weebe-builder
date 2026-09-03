/**
 * Bias STT toward builder `boostedKeywords`.
 *
 * Two layers, used by both Fish and Deepgram:
 *   1. Provider hint — Fish `prompt`, Deepgram `keywords=` query.
 *   2. Post-correction: swap a near-miss token for the closest keyword.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export function keywordBoostPrompt(keywords: string[] | undefined): string | undefined {
  const terms = uniqueKeywords(keywords);
  return terms.length ? terms.join(", ") : undefined;
}

export function applyKeywordBoost(text: string, keywords: string[] | undefined): string {
  const terms = uniqueKeywords(keywords);
  if (!text.trim() || terms.length === 0) return text;

  let out = text;
  for (const term of terms) {
    if (term.includes(" ")) {
      out = replaceNearPhrase(out, term);
    }
  }
  return out.replace(/\b[\w']+\b/g, (word) => closestKeyword(word, terms) ?? word);
}

export function uniqueKeywords(keywords: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords ?? []) {
    const term = String(raw ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function closestKeyword(word: string, terms: string[]): string | null {
  const lower = word.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const term of terms) {
    if (term.includes(" ")) continue;
    const t = term.toLowerCase();
    if (t === lower) return preserveCase(word, term);
    const maxDist = t.length >= 8 ? 2 : t.length >= 4 ? 1 : 0;
    if (!maxDist) continue;
    const dist = levenshtein(lower, t);
    if (dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      best = term;
    }
  }
  return best ? preserveCase(word, best) : null;
}

function replaceNearPhrase(text: string, phrase: string): string {
  const words = phrase.split(/\s+/).filter(Boolean);
  if (words.length < 2) return text;
  const pattern = new RegExp(
    `\\b${words.map((w) => escapeRegExp(w)).join("\\s+")}\\b`,
    "gi",
  );
  const exact = text.replace(pattern, phrase);
  if (exact !== text) return exact;

  const tokens = text.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i] || /^\s+$/.test(tokens[i]!)) continue;
    const slice: string[] = [];
    const idx: number[] = [];
    for (let j = i; j < tokens.length && slice.length < words.length; j++) {
      if (!tokens[j] || /^\s+$/.test(tokens[j]!)) continue;
      slice.push(tokens[j]!);
      idx.push(j);
    }
    if (slice.length !== words.length) break;
    const ok = slice.every((tok, n) => {
      const want = words[n]!.toLowerCase();
      const got = tok.toLowerCase();
      if (got === want) return true;
      const maxDist = want.length >= 8 ? 2 : want.length >= 4 ? 1 : 0;
      return maxDist > 0 && levenshtein(got, want) <= maxDist;
    });
    if (!ok) continue;
    for (let n = 0; n < words.length; n++) {
      tokens[idx[n]!] = preserveCase(slice[n]!, words[n]!);
    }
  }
  return tokens.join("");
}

function preserveCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source.length > 1) return replacement.toUpperCase();
  if (source[0] && source[0] === source[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = cur;
    }
  }
  return row[b.length]!;
}
