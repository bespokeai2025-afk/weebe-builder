/**
 * Hedged streaming for the spoken reply: when the model has not produced its first word by this
 * server's recent median, send the same request again and speak from whichever starts first.
 *
 * The first word is most of a turn's latency on OpenAI — 1.2–2.1 s on a gpt-4.1-mini test call
 * where everything else took ~0.3 s — and it varies from request to request (one turn of that call
 * waited 3.6 s). A second request cannot make the provider faster, but the faster of two draws
 * comes back sooner than one, and it cuts the slow tail hardest. Hedging at the median duplicates
 * about half the requests, the slower half; a duplicate costs its input tokens and the handful of
 * output tokens it streams before it is stopped.
 *
 * The losing request is stopped once its own first token arrives (or it fails), not the moment the
 * winner is picked, so both first-token times are recorded. Recording only winners would pull the
 * median down and the hedge would fire earlier and earlier (see `LatencyHedge`).
 *
 * Relative imports only — this module is reachable from vite.config.ts.
 */
import type { LatencyHedge } from "./latency-hedge";

export type OpenStream = (signal: AbortSignal) => AsyncIterable<string>;

/** How long a losing request may take to show its first token before it is stopped unmeasured. */
const LOSER_MEASURE_LIMIT_MS = 10_000;

type Attempt = {
  ctrl: AbortController;
  it: AsyncIterator<string>;
  started: number;
  first: Promise<IteratorResult<string>>;
};

function linkedController(outer?: AbortSignal): AbortController {
  const ctrl = new AbortController();
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener("abort", () => ctrl.abort(outer.reason), { once: true });
  }
  return ctrl;
}

function stop(a: Attempt): void {
  a.ctrl.abort();
  void Promise.resolve(a.it.return?.()).catch(() => {});
}

export interface HedgedStreamOptions {
  signal?: AbortSignal;
  /**
   * Give up when no request has produced a word by then: every request is stopped and the stream
   * fails, so the caller speaks its fallback line. Without it a stalled provider held the reply —
   * and the whole call, which handles nothing else until a reply ends — for the transport's 25 s
   * timeout (plus the hedge delay): a live test call sat silent for ~27 s.
   */
  firstTokenTimeoutMs?: number;
  /** Called when the duplicate is sent and when one of the two wins, for the call log. */
  onHedge?(event: { kind: "sent"; afterMs: number } | { kind: "won"; duplicate: boolean; firstTokenMs: number }): void;
}

/**
 * Stream from `open`, duplicated after `hedge.delayMs()` if no token has arrived yet. Without
 * enough samples (or with hedging off) this is exactly `open` — one request.
 */
export async function* hedgedStream(
  open: OpenStream,
  hedge: LatencyHedge,
  options: HedgedStreamOptions = {},
): AsyncGenerator<string> {
  const delay = hedge.delayMs();
  const t0 = Date.now();

  const launch = (): Attempt => {
    const ctrl = linkedController(options.signal);
    const it = open(ctrl.signal)[Symbol.asyncIterator]();
    return { ctrl, it, started: Date.now(), first: it.next() };
  };

  const attempts: Attempt[] = [launch()];
  // Settles to the attempt that produced the first token, or rejects when every attempt failed.
  const resolveHooks: Array<() => void> = [];
  const winner = await new Promise<{ a: Attempt; r: IteratorResult<string> }>((resolveRaw, rejectRaw) => {
    const resolve = (v: { a: Attempt; r: IteratorResult<string> }) => {
      for (const h of resolveHooks) h();
      resolveRaw(v);
    };
    const reject = (e: unknown) => {
      for (const h of resolveHooks) h();
      rejectRaw(e);
    };
    let settled = false;
    let failures = 0;
    let lastError: unknown;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const watch = (a: Attempt) => {
      a.first.then(
        (r) => {
          if (!r.done) hedge.record(Date.now() - a.started);
          if (settled) {
            // The loser: measured, now stop it.
            stop(a);
            return;
          }
          if (r.done) {
            // Finished without a word (empty reply). If the other request is still running, let it
            // answer; otherwise this is the answer — an empty reply is not slowness, so no duplicate.
            failures++;
            if (attempts.length === 1 && timer) {
              clearTimeout(timer);
              timer = null;
            }
            if (failures >= attempts.length && !timer) {
              settled = true;
              resolve({ a, r });
            }
            return;
          }
          settled = true;
          if (timer) clearTimeout(timer);
          resolve({ a, r });
        },
        (err) => {
          failures++;
          lastError = err;
          if (settled) return;
          // A failure before the duplicate is due is a failure, not slowness — no retry here.
          if (attempts.length === 1 && timer) {
            clearTimeout(timer);
            timer = null;
          }
          if (failures >= attempts.length && !timer) {
            settled = true;
            reject(lastError);
          }
        },
      );
    };

    watch(attempts[0]!);
    const deadlineMs = options.firstTokenTimeoutMs;
    const deadline =
      deadlineMs && deadlineMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            timer = null;
            for (const a of attempts) stop(a);
            reject(new Error(`no first word within ${deadlineMs}ms`));
          }, deadlineMs)
        : null;
    const clearDeadline = () => {
      if (deadline) clearTimeout(deadline);
    };
    resolveHooks.push(clearDeadline);
    if (delay !== null) {
      timer = setTimeout(() => {
        timer = null;
        if (settled || options.signal?.aborted) return;
        const dup = launch();
        attempts.push(dup);
        options.onHedge?.({ kind: "sent", afterMs: Date.now() - t0 });
        watch(dup);
      }, delay);
    }
  });

  const { a: win, r: first } = winner;
  for (const other of attempts) {
    if (other === win) continue;
    // Give the loser a bounded window to report its first token (recorded in `watch`), then stop it.
    const limit = setTimeout(() => stop(other), LOSER_MEASURE_LIMIT_MS);
    void other.first.finally(() => clearTimeout(limit)).catch(() => {});
  }
  if (attempts.length > 1) {
    options.onHedge?.({ kind: "won", duplicate: win !== attempts[0], firstTokenMs: Date.now() - t0 });
  }

  if (first.done) return;
  try {
    yield first.value;
    for (;;) {
      const r = await win.it.next();
      if (r.done) return;
      yield r.value;
    }
  } finally {
    // Consumer stopped early (barge-in, abort) — stop the request too.
    stop(win);
  }
}
