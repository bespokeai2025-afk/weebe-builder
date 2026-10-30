import { describe, expect, it } from "vitest";
import { hedgedStream } from "@/lib/voice/llm/hedged-stream";
import { LatencyHedge } from "@/lib/voice/llm/latency-hedge";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });

/** A fake model stream: first word after `firstMs`, then the rest quickly. */
function fakeOpen(plan: Array<{ firstMs: number; words: string[]; fail?: boolean }>) {
  const calls: { aborted: boolean }[] = [];
  const open = (signal: AbortSignal) => {
    const p = plan[calls.length] ?? plan[plan.length - 1]!;
    const rec = { aborted: false };
    calls.push(rec);
    signal.addEventListener("abort", () => (rec.aborted = true));
    return (async function* () {
      await sleep(p.firstMs, signal);
      if (p.fail) throw new Error("boom");
      for (const w of p.words) {
        yield w;
        await sleep(1, signal);
      }
    })();
  };
  return { open, calls };
}

function trainedHedge(ms: number): LatencyHedge {
  const h = new LatencyHedge({ quantile: 0.5, minSamples: 3 });
  for (let i = 0; i < 3; i++) h.record(ms);
  return h;
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const w of it) out.push(w);
  return out;
}

describe("hedgedStream", () => {
  it("sends one request until it has learned a delay", async () => {
    const { open, calls } = fakeOpen([{ firstMs: 30, words: ["a", "b"] }]);
    const words = await collect(hedgedStream(open, new LatencyHedge({ minSamples: 3 })));
    expect(words).toEqual(["a", "b"]);
    expect(calls).toHaveLength(1);
  });

  it("speaks from the duplicate when the original is slow, and stops the original", async () => {
    const { open, calls } = fakeOpen([
      { firstMs: 300, words: ["slow"] },
      { firstMs: 10, words: ["fast", "reply"] },
    ]);
    const hedge = trainedHedge(40);
    const t0 = Date.now();
    const words = await collect(hedgedStream(open, hedge));
    expect(words).toEqual(["fast", "reply"]);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(calls).toHaveLength(2);
    await sleep(350);
    expect(calls[0]!.aborted).toBe(true);
  });

  it("keeps the original when it answers before the delay", async () => {
    const { open, calls } = fakeOpen([{ firstMs: 10, words: ["quick"] }]);
    const words = await collect(hedgedStream(open, trainedHedge(100)));
    expect(words).toEqual(["quick"]);
    expect(calls).toHaveLength(1);
  });

  it("falls back to the other request when one fails after the duplicate is sent", async () => {
    const { open } = fakeOpen([
      { firstMs: 80, words: [], fail: true },
      { firstMs: 60, words: ["ok"] },
    ]);
    expect(await collect(hedgedStream(open, trainedHedge(20)))).toEqual(["ok"]);
  });

  it("fails straight away when the original fails before the duplicate is due", async () => {
    const { open, calls } = fakeOpen([{ firstMs: 5, words: [], fail: true }]);
    await expect(collect(hedgedStream(open, trainedHedge(200)))).rejects.toThrow("boom");
    expect(calls).toHaveLength(1);
  });

  it("stops both requests when the caller aborts", async () => {
    const { open, calls } = fakeOpen([
      { firstMs: 300, words: ["x"] },
      { firstMs: 300, words: ["y"] },
    ]);
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 80);
    await expect(collect(hedgedStream(open, trainedHedge(20), { signal: ctrl.signal }))).rejects.toThrow();
    expect(calls.every((c) => c.aborted)).toBe(true);
  });

  it("records the loser's first-word time too", async () => {
    const { open } = fakeOpen([
      { firstMs: 120, words: ["late"] },
      { firstMs: 10, words: ["early"] },
    ]);
    const hedge = trainedHedge(30);
    await collect(hedgedStream(open, hedge));
    await sleep(150);
    // 3 seeded + winner + loser
    expect((hedge as unknown as { samples: number[] }).samples).toHaveLength(5);
  });
});

describe("LatencyHedge initial delay", () => {
  it("uses the initial delay until it has samples, then the learned one", () => {
    const h = new LatencyHedge({ quantile: 0.5, minSamples: 3, initialDelayMs: 1500 });
    expect(h.delayMs()).toBe(1500);
    for (const ms of [400, 500, 600]) h.record(ms);
    expect(h.delayMs()).toBe(500);
    expect(new LatencyHedge({ minSamples: 3 }).delayMs()).toBeNull();
  });
});
