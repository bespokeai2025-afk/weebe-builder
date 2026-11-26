/**
 * Shared helpers for speculative speech started on stable partial STT.
 */

export interface SpeculativeSpeechRun {
  partial: string;
  ctrl: AbortController;
  readonly tokens: string[];
  readonly done: Promise<string>;
  /**
   * When the request went out and its first token came back. A run can start before its turn
   * exists, so the turn that adopts it records these rather than the run marking a trace itself.
   */
  requestedAt?: number;
  firstTokenAt?: number;
  model?: string;
  promptChars?: number;
}

/** Hesitations and openers that change nothing about what the caller said. */
const LEADING_FILLER = /^(?:(?:um+|uh+|er+|erm+|hmm+|mm+|ah+|oh|so|well)\s+)+/;
/** Courtesies at the end that change nothing either. */
const TRAILING_COURTESY = /(?:\s+(?:please|thanks|thank you|cheers|mate))+$/;

/** The words of a transcript, without case, punctuation, fillers or courtesies. */
export function canonicalUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_FILLER, "")
    .replace(TRAILING_COURTESY, "")
    .trim();
}

/**
 * True when the final transcript says the same thing as the partial a speculative reply (or
 * route) was started from, so that reply still answers what the caller said.
 *
 * Punctuation, case, leading fillers and trailing courtesies are ignored: "Yes, that's right." is
 * the partial "yes that's right". Any other difference rejects it. This used to accept a final that
 * merely started with or contained the partial, so a reply started on "yes" was spoken for "yes but
 * I'm not the owner", and one started on "my name is ar" for "my name is Arjo" — answering words the
 * caller never finished saying. A rejected run costs tokens; the reply is then generated from the
 * final, as it would have been without speculation.
 */
export function partialMatchesFinal(partial: string, final: string): boolean {
  const p = canonicalUtterance(partial);
  const f = canonicalUtterance(final);
  return !!p && p === f;
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
