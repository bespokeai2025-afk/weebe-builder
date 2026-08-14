/**
 * Transcript assembly.
 *
 * The engine produces a stream of finalised utterances; downstream consumers
 * want Retell's two representations — a `"Agent: ...\nUser: ..."` text blob and
 * a `transcript_object` array. Both are derived here so they can never disagree.
 *
 * Relative imports only (reachable from vite.config.ts).
 */
import type { RetellTranscriptEntry, TranscriptTurn } from "./types";

const ROLE_LABEL: Record<TranscriptTurn["role"], string> = {
  agent: "Agent",
  user: "User",
};

/**
 * Order by time and join utterances the same speaker made back-to-back.
 *
 * Streaming STT emits several finals for one spoken sentence, and the graph VM
 * speaks a node in fragments, so an unmerged transcript reads as dozens of
 * one-word turns. That wrecks the analysis prompt and the transcript UI, and it
 * breaks the transition-condition classifier, which reasons over "what the user
 * just said" as a single message.
 */
export function mergeTurns(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  const cleaned = turns
    .map((t) => ({ ...t, text: t.text.trim() }))
    .filter((t) => t.text.length > 0)
    // Stable sort: equal timestamps keep arrival order, which is the true order
    // when an agent utterance and its transcription land in the same millisecond.
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.ts - b.t.ts || a.i - b.i)
    .map(({ t }) => t);

  const merged: TranscriptTurn[] = [];
  for (const turn of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.role === turn.role) {
      last.text = joinSentences(last.text, turn.text);
      continue;
    }
    merged.push({ ...turn });
  }
  return merged;
}

/**
 * Join two fragments of one utterance.
 *
 * A space is wrong when the previous fragment already ends a sentence, and
 * missing punctuation makes the LLM read two thoughts as one run-on.
 */
function joinSentences(a: string, b: string): string {
  const needsStop = !/[.!?,:;—-]$/.test(a);
  return needsStop ? `${a}. ${b}` : `${a} ${b}`;
}

/** Retell's plain-text transcript: one `Role: text` line per turn. */
export function formatTranscript(turns: readonly TranscriptTurn[]): string {
  return mergeTurns(turns)
    .map((t) => `${ROLE_LABEL[t.role]}: ${t.text}`)
    .join("\n");
}

export function toTranscriptObject(turns: readonly TranscriptTurn[]): RetellTranscriptEntry[] {
  return mergeTurns(turns).map((t) => ({ role: t.role, content: t.text }));
}

/** Turns as stored on `telephony_calls.transcript` (jsonb `[{role,text,ts}]`). */
export function toStoredTranscript(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  return mergeTurns(turns);
}
