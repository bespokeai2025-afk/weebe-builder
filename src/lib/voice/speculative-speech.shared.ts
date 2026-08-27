/**
 * Shared helpers for speculative speech started on stable partial STT.
 */

export interface SpeculativeSpeechRun {
  partial: string;
  ctrl: AbortController;
  readonly tokens: string[];
  readonly done: Promise<string>;
}

/** True when final STT is close enough to the partial that speculative output is usable. */
export function partialMatchesFinal(partial: string, final: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[.!?,]+$/g, "")
      .replace(/\s+/g, " ");
  const p = norm(partial);
  const f = norm(final);
  if (!p || !f) return false;
  if (p === f) return true;
  if (f.startsWith(p) || p.startsWith(f)) return true;
  if (f.includes(p) || p.includes(f)) return Math.min(p.length, f.length) >= 3;
  return false;
}

/** Replay buffered tokens as they arrive, then drain any remainder. */
export async function* streamSpeculativeTokens(run: SpeculativeSpeechRun): AsyncGenerator<string> {
  let i = 0;
  let settled = false;
  const markSettled = () => {
    settled = true;
  };
  void run.done.then(markSettled, markSettled);
  for (;;) {
    while (i < run.tokens.length) {
      yield run.tokens[i++]!;
    }
    if (settled || run.ctrl.signal.aborted) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  await run.done.catch(() => "");
  while (i < run.tokens.length) {
    yield run.tokens[i++]!;
  }
}
