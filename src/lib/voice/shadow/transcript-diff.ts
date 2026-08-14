/**
 * Compare a reference transcript against the native engine's replay of it.
 *
 * Shadow testing answers one question: would the native engine have said
 * substantially the same things Retell said, given the same caller? Exact string
 * equality is useless for that — two LLM turns almost never match verbatim — so
 * turns are scored on bigram overlap and bucketed. What matters is the first
 * point of real divergence, because everything after it is conditioned on a
 * conversation that already differs.
 *
 * Only agent turns are compared. User turns are replayed verbatim, so they are
 * identical by construction and would inflate every score.
 */

export interface ShadowTurn {
  role: "agent" | "user";
  text: string;
}

export type TurnVerdict = "match" | "paraphrase" | "divergent" | "missing" | "extra";

export interface TurnDiff {
  /** 1-based index among agent turns. */
  index: number;
  reference: string | null;
  candidate: string | null;
  similarity: number;
  verdict: TurnVerdict;
}

export interface TranscriptDiff {
  turns: TurnDiff[];
  referenceAgentTurns: number;
  candidateAgentTurns: number;
  averageSimilarity: number;
  /** First agent turn that diverged or went missing; null when none did. */
  divergedAtTurn: number | null;
  verdict: "aligned" | "drifting" | "divergent";
}

/** At or above this, two turns say the same thing. */
const MATCH_THRESHOLD = 0.75;
/** At or above this, they say it differently but still mean it. */
const PARAPHRASE_THRESHOLD = 0.45;
/** Mean similarity a whole call needs to count as aligned. */
const ALIGNED_MEAN = 0.7;
/** Below this the replay is a different conversation, not a variation on one. */
const DRIFTING_MEAN = 0.45;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dice coefficient over word bigrams, falling back to word overlap for very
 * short turns.
 *
 * Bigrams rather than words because word overlap alone scores "yes, tomorrow at
 * three" and "no, not tomorrow at three" as nearly identical, and those are
 * opposite answers. Short turns have no bigrams at all, hence the fallback.
 */
export function similarity(a: string, b: string): number {
  const wordsA = normalise(a).split(" ").filter(Boolean);
  const wordsB = normalise(b).split(" ").filter(Boolean);
  if (wordsA.length === 0 && wordsB.length === 0) return 1;
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const bigrams = (words: string[]) =>
    words.length < 2 ? words : words.slice(0, -1).map((w, i) => `${w} ${words[i + 1]}`);

  const gramsA = bigrams(wordsA);
  const gramsB = bigrams(wordsB);

  const counts = new Map<string, number>();
  for (const g of gramsA) counts.set(g, (counts.get(g) ?? 0) + 1);

  let shared = 0;
  for (const g of gramsB) {
    const remaining = counts.get(g) ?? 0;
    if (remaining > 0) {
      shared += 1;
      counts.set(g, remaining - 1);
    }
  }
  return (2 * shared) / (gramsA.length + gramsB.length);
}

function verdictFor(score: number): TurnVerdict {
  if (score >= MATCH_THRESHOLD) return "match";
  if (score >= PARAPHRASE_THRESHOLD) return "paraphrase";
  return "divergent";
}

/** Compare agent turns positionally, since the caller side is replayed exactly. */
export function diffTranscripts(
  reference: ShadowTurn[],
  candidate: ShadowTurn[],
): TranscriptDiff {
  const refAgent = reference.filter((t) => t.role === "agent").map((t) => t.text);
  const candAgent = candidate.filter((t) => t.role === "agent").map((t) => t.text);

  const turns: TurnDiff[] = [];
  let divergedAtTurn: number | null = null;
  let scoreSum = 0;
  let scored = 0;

  for (let i = 0; i < Math.max(refAgent.length, candAgent.length); i++) {
    const ref = refAgent[i] ?? null;
    const cand = candAgent[i] ?? null;
    const index = i + 1;

    if (ref === null || cand === null) {
      // A turn only one side produced is a structural difference, not a wording
      // one, so it gets no similarity score and does not dilute the mean.
      turns.push({
        index,
        reference: ref,
        candidate: cand,
        similarity: 0,
        verdict: ref === null ? "extra" : "missing",
      });
      if (divergedAtTurn === null && ref !== null) divergedAtTurn = index;
      continue;
    }

    const score = similarity(ref, cand);
    const verdict = verdictFor(score);
    turns.push({
      index,
      reference: ref,
      candidate: cand,
      similarity: Number(score.toFixed(4)),
      verdict,
    });
    scoreSum += score;
    scored += 1;
    if (verdict === "divergent" && divergedAtTurn === null) divergedAtTurn = index;
  }

  const averageSimilarity = scored > 0 ? Number((scoreSum / scored).toFixed(4)) : 0;
  const missingOrExtra = turns.some((t) => t.verdict === "missing" || t.verdict === "extra");

  // A structural mismatch caps the verdict at "drifting" however well the turns
  // that do line up happen to score: the flows took different shapes.
  let verdict: TranscriptDiff["verdict"];
  if (averageSimilarity >= ALIGNED_MEAN && !missingOrExtra) verdict = "aligned";
  else if (averageSimilarity >= DRIFTING_MEAN) verdict = "drifting";
  else verdict = "divergent";

  return {
    turns,
    referenceAgentTurns: refAgent.length,
    candidateAgentTurns: candAgent.length,
    averageSimilarity,
    divergedAtTurn,
    verdict,
  };
}

/**
 * Parse a stored transcript back into turns.
 *
 * Retell (and our own `formatTranscript`) store "Role: text" lines, with an
 * utterance able to run across several lines. Anything before the first
 * recognised speaker label is dropped rather than guessed at.
 */
export function parseTranscriptText(text: string): ShadowTurn[] {
  const turns: ShadowTurn[] = [];
  let current: ShadowTurn | null = null;

  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = /^(agent|assistant|ai|bot|user|customer|caller|human)\s*:\s*(.*)$/i.exec(line);
    if (match) {
      if (current && current.text.trim()) turns.push({ ...current, text: current.text.trim() });
      const label = match[1].toLowerCase();
      const role: ShadowTurn["role"] =
        label === "user" || label === "customer" || label === "caller" || label === "human"
          ? "user"
          : "agent";
      current = { role, text: match[2] };
      continue;
    }

    // Continuation of the current utterance.
    if (current) current.text += ` ${line}`;
  }

  if (current && current.text.trim()) turns.push({ ...current, text: current.text.trim() });
  return turns;
}

/** Render turns back to the stored "Role: text" form. */
export function formatShadowTranscript(turns: ShadowTurn[]): string {
  return turns.map((t) => `${t.role === "agent" ? "Agent" : "User"}: ${t.text}`).join("\n");
}
