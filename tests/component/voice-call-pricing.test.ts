import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gptComplete, gptStream, resetModelRequestRulesForTests } from "@/lib/voice/llm/gpt";
import { DEFAULT_PRICES, priceTable, tokenPriceFor } from "@/lib/voice/providers/pricing.config.shared";
import { CallUsageMeter, type LlmUsage } from "@/lib/voice/usage-meter.shared";

describe("call pricing from usage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prices tokens per model, cached input at the cached rate", () => {
    const m = new CallUsageMeter();
    // 10k input of which 8k cached, 500 out, on gpt-4.1: 2k×$2 + 8k×$0.5 + 500×$8 per 1M.
    m.addLlm({ provider: "openai", model: "gpt-4.1-2025-04-14", inputTokens: 10_000, cachedTokens: 8_000, outputTokens: 500 }, "speech");
    expect(m.cost().llmUsd).toBeCloseTo((2_000 * 2 + 8_000 * 0.5 + 500 * 8) / 1e6, 10);
  });

  it("uses the Fast rate for priority requests, and never mixes up mini and full", () => {
    expect(tokenPriceFor("gpt-4.1", "priority")).toEqual(DEFAULT_PRICES.llmFast["gpt-4.1"]);
    expect(tokenPriceFor("gpt-4.1-mini-2025-04-14", null)).toEqual(DEFAULT_PRICES.llm["gpt-4.1-mini"]);
    expect(tokenPriceFor("some-unknown-model", null)).toBeNull();
  });

  it("prices Cartesia per character / per second of audio, Deepgram per minute with keyterms", () => {
    const m = new CallUsageMeter();
    m.addTts("cartesia", "sonic-3.6", "Hello there."); // 12 characters
    m.addSttAudio("cartesia", "ink-2", 60);
    m.addSttAudio("deepgram", "nova-3", 60, true);
    const c = m.cost();
    expect(c.ttsUsd).toBeCloseTo((12 * 37.4) / 1e6, 10);
    expect(c.sttUsd).toBeCloseTo((60 * 3 * 37.4) / 1e6 + (0.0048 + 0.0013), 10);
  });

  it("flags usage it has no rate for instead of pricing it at zero silently", () => {
    const m = new CallUsageMeter();
    m.addLlm({ provider: "openai", model: "brand-new-model", inputTokens: 100, cachedTokens: 0, outputTokens: 10 });
    expect(m.cost().lines[0]!.unpriced).toBe(true);
  });

  it("takes overrides from WEBEE_NATIVE_PRICES", () => {
    vi.stubEnv("WEBEE_NATIVE_PRICES", JSON.stringify({ cartesiaUsdPer1MCredits: 45, llm: { "gpt-4.1": { input: 1, cachedInput: 0.25, output: 4 } } }));
    const t = priceTable();
    expect(t.cartesiaUsdPer1MCredits).toBe(45);
    expect(t.llm["gpt-4.1"]!.input).toBe(1);
    expect(t.llm["gpt-4.1-mini"]).toEqual(DEFAULT_PRICES.llm["gpt-4.1-mini"]);
  });
});

describe("OpenAI usage reporting", () => {
  const msgs = [{ role: "user" as const, content: "Hi there, how are you?" }];
  let bodies: Array<Record<string, unknown>>;

  beforeEach(() => {
    resetModelRequestRulesForTests();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("CEREBRAS_API_KEY", "");
    bodies = [];
    const usage = { prompt_tokens: 1200, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 1024 } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if (body.stream) {
          const lines = [
            { choices: [{ delta: { content: "Fine, " } }] },
            { choices: [{ delta: { content: "thanks." } }] },
            { choices: [], usage, service_tier: "default" },
          ];
          return new Response(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("") + "data: [DONE]\n\n");
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetModelRequestRulesForTests();
  });

  it("asks a stream for usage and reports it, cached tokens included", async () => {
    const got: LlmUsage[] = [];
    let text = "";
    for await (const d of gptStream(msgs, { model: "gpt-4.1", apiKey: "", provider: "openai", onUsage: (u) => got.push(u) })) text += d;
    expect(text).toBe("Fine, thanks.");
    expect(bodies[0]).toMatchObject({ stream_options: { include_usage: true } });
    expect(got).toEqual([
      { provider: "openai", model: "gpt-4.1", inputTokens: 1200, cachedTokens: 1024, outputTokens: 9, serviceTier: "default" },
    ]);
  });

  it("reports a completion's usage", async () => {
    const got: LlmUsage[] = [];
    await gptComplete(msgs, { model: "gpt-4.1-mini", apiKey: "", provider: "openai", onUsage: (u) => got.push(u) });
    expect(got[0]).toMatchObject({ model: "gpt-4.1-mini", inputTokens: 1200, cachedTokens: 1024, outputTokens: 9 });
  });

  it("estimates a stream cut off before its usage arrived — it is still billed", async () => {
    const got: LlmUsage[] = [];
    for await (const _ of gptStream(msgs, { model: "gpt-4.1", apiKey: "", provider: "openai", onUsage: (u) => got.push(u) })) break;
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ estimated: true, outputTokens: 2 });
  });

  it("sends no stream_options when nothing meters the call", async () => {
    for await (const _ of gptStream(msgs, { model: "gpt-4.1", apiKey: "", provider: "openai" })) void _;
    expect(bodies[0]).not.toHaveProperty("stream_options");
  });
});
