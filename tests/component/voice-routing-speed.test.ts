/**
 * Routing speed without changing routing decisions:
 * - routing that moves off Cerebras uses the OpenAI classifier, not the speech default;
 * - a retired model costs one failed request per server, then its replacement is used;
 * - a slow routing request gets a duplicate after the server's own recent p90.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  gptComplete,
  gptStream,
  resetCerebrasCooldownForTests,
  resetRetiredModelsForTests,
} from "@/lib/voice/llm/gpt";
import { LatencyHedge } from "@/lib/voice/llm/latency-hedge";
import { resolveWebeeOpenAiClassifierModel } from "@/lib/voice/webee-native.shared";

const msgs = [{ role: "user" as const, content: "Hi" }];

function completion(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
}

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200 });
}

const RETIRED =
  '{"error":{"message":"The model `gpt-4.1-nano` has been deprecated","code":"model_not_found"}}';

describe("classifier fallback model", () => {
  let sent: Array<{ host: string; model: string }>;
  beforeEach(() => {
    resetCerebrasCooldownForTests();
    resetRetiredModelsForTests();
    vi.stubEnv("CEREBRAS_API_KEY", "csk-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { model: string; stream?: boolean };
        sent.push({ host: new URL(url).host, model: body.model });
        if (url.includes("cerebras")) return new Response("payment_required", { status: 402 });
        if (body.model === "gpt-4.1-nano") return new Response(RETIRED, { status: 404 });
        return body.stream ? sse("ok") : completion("ok");
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("moves routing to the OpenAI classifier it was given, not gpt-4o-mini", async () => {
    const out = await gptComplete(msgs, {
      model: "gpt-oss-120b",
      apiKey: "",
      provider: "cerebras",
      fallbackModels: { openai: "gpt-4.1-mini" },
    });
    expect(out).toBe("ok");
    expect(sent.map((s) => s.model)).toEqual(["gpt-oss-120b", "gpt-4.1-mini"]);

    // Cool-down: straight to OpenAI, still on the classifier model.
    await gptComplete(msgs, {
      model: "gpt-oss-120b",
      apiKey: "",
      provider: "cerebras",
      fallbackModels: { openai: "gpt-4.1-mini" },
    });
    expect(sent.at(-1)).toEqual({ host: "api.openai.com", model: "gpt-4.1-mini" });
  });

  it("keeps the old mapping when no fallback is named (speech)", async () => {
    await gptComplete(msgs, { model: "gpt-oss-120b", apiKey: "", provider: "cerebras" });
    expect(sent.at(-1)?.model).toBe("gpt-4o-mini");
  });

  it("replaces a retired model once per server, then sends the replacement directly", async () => {
    const opts = {
      model: "gpt-4.1-nano",
      apiKey: "",
      provider: "openai" as const,
      fallbackModels: { openai: "gpt-4.1-mini" },
    };
    expect(await gptComplete(msgs, opts)).toBe("ok");
    expect(sent.map((s) => s.model)).toEqual(["gpt-4.1-nano", "gpt-4.1-mini"]);

    sent = [];
    expect(await gptComplete(msgs, opts)).toBe("ok");
    expect(sent.map((s) => s.model)).toEqual(["gpt-4.1-mini"]);

    let streamed = "";
    for await (const t of gptStream(msgs, opts)) streamed += t;
    expect(streamed).toBe("ok");
    expect(sent.at(-1)?.model).toBe("gpt-4.1-mini");
  });

  it("surfaces a retired model when there is no replacement to use", async () => {
    await expect(
      gptComplete(msgs, { model: "gpt-4.1-nano", apiKey: "", provider: "openai" }),
    ).rejects.toThrow(/model_not_found/);
  });
});

describe("resolveWebeeOpenAiClassifierModel", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the agent setting, then the env, then the default", () => {
    vi.stubEnv("WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL", "");
    expect(resolveWebeeOpenAiClassifierModel({})).toBe("gpt-4.1-mini");
    vi.stubEnv("WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL", "gpt-5-nano");
    expect(resolveWebeeOpenAiClassifierModel({})).toBe("gpt-5-nano");
    expect(resolveWebeeOpenAiClassifierModel({ webeeOpenAiClassifierModel: "gpt-4o-mini" })).toBe(
      "gpt-4o-mini",
    );
  });

  it("ignores a model OpenAI cannot serve", () => {
    vi.stubEnv("WEBEE_NATIVE_OPENAI_CLASSIFIER_MODEL", "");
    expect(resolveWebeeOpenAiClassifierModel({ webeeOpenAiClassifierModel: "gpt-oss-120b" })).toBe(
      "gpt-4.1-mini",
    );
  });
});

describe("LatencyHedge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function warmed(ms: number[]): LatencyHedge {
    const h = new LatencyHedge({ minSamples: ms.length });
    for (const m of ms) h.record(m);
    return h;
  }

  function after<T>(ms: number, value: T, fail = false): Promise<T> {
    return new Promise((resolve, reject) =>
      setTimeout(() => (fail ? reject(new Error(String(value))) : resolve(value)), ms),
    );
  }

  it("does not hedge until it has seen enough requests", () => {
    const h = new LatencyHedge({ minSamples: 3 });
    h.record(100);
    h.record(200);
    expect(h.delayMs()).toBeNull();
    h.record(300);
    expect(h.delayMs()).not.toBeNull();
  });

  it("learns the delay from observed latencies (p90), capped", () => {
    const samples = Array.from({ length: 10 }, (_, i) => (i + 1) * 100); // 100..1000
    expect(warmed(samples).delayMs()).toBe(900);
    const capped = new LatencyHedge({ minSamples: 10, maxDelayMs: 500 });
    for (const s of samples) capped.record(s);
    expect(capped.delayMs()).toBe(500);
  });

  it("can be switched off", () => {
    vi.stubEnv("WEBEE_NATIVE_LLM_HEDGE", "off");
    expect(warmed([100, 100, 100]).delayMs()).toBeNull();
  });

  it("a fast request goes out once", async () => {
    const h = warmed([500, 500, 500]);
    const request = vi.fn(() => after(100, "first"));
    const p = h.run(request);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe("first");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("a slow request gets a duplicate and the first answer wins", async () => {
    const h = warmed([500, 500, 500]);
    const durations = [3000, 200];
    const request = vi.fn(() => {
      const ms = durations.shift()!;
      return after(ms, `took ${ms}`);
    });
    const p = h.run(request);
    await vi.advanceTimersByTimeAsync(800);
    await expect(p).resolves.toBe("took 200");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("uses the duplicate when the slow first request then fails", async () => {
    const h = warmed([500, 500, 500]);
    const plans: Array<[number, boolean]> = [[1500, true], [2000, false]];
    const request = vi.fn(() => {
      const [ms, fail] = plans.shift()!;
      return after(ms, fail ? "boom" : "second", fail);
    });
    const p = h.run(request);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBe("second");
  });

  it("an early failure is not retried", async () => {
    const h = warmed([500, 500, 500]);
    const request = vi.fn(() => after(100, "boom", true));
    const p = h.run(request);
    const done = expect(p).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(request).toHaveBeenCalledTimes(1);
  });
});
