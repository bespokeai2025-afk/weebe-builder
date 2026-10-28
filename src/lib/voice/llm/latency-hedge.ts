/**
 * Hedged requests for short LLM calls on a turn's critical path (routing, extraction).
 *
 * A routing call is a small, deterministic (temperature 0) request whose time is almost all
 * network and queueing, and its tail is long: 1.45 s median but 1.9–2.4 s at p90 on live turns,
 * with single calls past 3 s. While it runs the caller hears nothing. When a request is slower
 * than this server's own recent p90 for that kind of call, a second identical request goes out
 * and whichever answers first is used. By construction that duplicates about one request in ten,
 * and those are the slow ones.
 *
 * Nothing here is fixed per agent or per phrase: the delay is learned from the latencies this
 * process has actually seen, so it follows the provider in use (Cerebras ~0.4 s, OpenAI ~1.4 s)
 * without configuration. Set WEBEE_NATIVE_LLM_HEDGE=off to turn it off.
 *
 * The slower request is left to finish rather than aborted: its input is already paid for, and
 * its real duration keeps the p90 honest. Recording only the winner would pull the p90 down, so
 * the hedge would fire earlier and earlier.
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */

export interface LatencyHedgeOptions {
  /** Which observed latency starts the duplicate. Default 0.9. */
  quantile?: number;
  /** Samples needed before hedging starts. Default 10. */
  minSamples?: number;
  /** Rolling window. Default 50. */
  window?: number;
  /** Never hedge later than this; past it the duplicate cannot help. */
  maxDelayMs?: number;
}

export class LatencyHedge {
  private readonly samples: number[] = [];
  private readonly quantile: number;
  private readonly minSamples: number;
  private readonly window: number;
  private readonly maxDelayMs: number;

  constructor(options: LatencyHedgeOptions = {}) {
    this.quantile = options.quantile ?? 0.9;
    this.minSamples = options.minSamples ?? 10;
    this.window = options.window ?? 50;
    this.maxDelayMs = options.maxDelayMs ?? Number.POSITIVE_INFINITY;
  }

  /** Record how long one request took. */
  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.window) this.samples.shift();
  }

  /** When a request should get a duplicate, or null while there is too little data (or it is off). */
  delayMs(): number | null {
    if (hedgeDisabled()) return null;
    if (this.samples.length < this.minSamples) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = sorted[Math.min(sorted.length - 1, Math.floor(this.quantile * (sorted.length - 1)))]!;
    return Math.min(at, this.maxDelayMs);
  }

  /**
   * Run `request`; if it has not settled after `delayMs()`, run it again and take the first
   * success. Rejects only when every request that was started has failed. A request that fails
   * before the duplicate is due rejects straight away — this is for slowness, not a retry.
   */
  run<T>(request: () => Promise<T>): Promise<T> {
    const delay = this.delayMs();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let pending = 0;
      let lastError: unknown;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const launch = (primary: boolean) => {
        pending++;
        const started = Date.now();
        request().then(
          (value) => {
            pending--;
            // Every completion counts, the loser's included — see the module comment.
            this.record(Date.now() - started);
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            pending--;
            lastError = err;
            if (settled) return;
            if (primary && timer) {
              clearTimeout(timer);
              timer = null;
            }
            if (pending === 0 && !timer) {
              settled = true;
              reject(lastError);
            }
          },
        );
      };

      launch(true);
      if (delay !== null) {
        timer = setTimeout(() => {
          timer = null;
          if (!settled) launch(false);
        }, delay);
      }
    });
  }
}

function hedgeDisabled(): boolean {
  const raw =
    typeof process !== "undefined" ? String(process.env?.WEBEE_NATIVE_LLM_HEDGE ?? "") : "";
  return /^(off|false|0|no)$/i.test(raw.trim());
}
