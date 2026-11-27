/**
 * Transcripts for the speech bursts of one caller utterance, each requested the moment its burst
 * ends — see `CascadeSession.requestBurstTranscript` for why.
 *
 * Requests run one at a time, in order: providers hold a single pending finalize per session, so a
 * second one sent before the first returned would replace it.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */
export class BurstTranscripts {
  private pending: Array<Promise<string>> = [];
  private chain: Promise<unknown> = Promise.resolve();

  /** Queue one burst's transcript request behind any still running. */
  request(finalize: () => Promise<string>): void {
    const transcript = this.chain.then(finalize);
    this.chain = transcript.catch(() => {});
    // The turn awaits it and reports a failure; this only keeps an unused one from being unhandled.
    transcript.catch(() => {});
    this.pending.push(transcript);
  }

  /** The utterance's requests so far, left in place — for reading the words before the turn starts. */
  peek(): Array<Promise<string>> {
    return [...this.pending];
  }

  /** The utterance's requests so far, handed to the turn; the next utterance starts empty. */
  take(): Array<Promise<string>> {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  clear(): void {
    this.pending = [];
  }
}

/** The turn's text: each burst's transcript in the order spoken. Rejects if any request failed. */
export async function joinBurstTranscripts(transcripts: Array<Promise<string>>): Promise<string> {
  const texts = await Promise.all(transcripts);
  return texts
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" ");
}
