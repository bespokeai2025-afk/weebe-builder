import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gptComplete, gptStream, resetModelRequestRulesForTests } from "@/lib/voice/llm/gpt";

const msgs = [{ role: "user" as const, content: "Hi" }];

/** A fake OpenAI that refuses parameters the way the real API does for the named model. */
function fakeOpenAi(rules: { effort?: string | null; temperature?: "default-only" }) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      const reject = (message: string) =>
        new Response(JSON.stringify({ error: { message } }), { status: 400 });
      if ("max_tokens" in body) {
        return reject("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.");
      }
      if (rules.effort === null && "reasoning_effort" in body) {
        return reject("Unrecognized request argument supplied: reasoning_effort");
      }
      if (rules.effort && body.reasoning_effort !== rules.effort) {
        return reject(
          `Unsupported value: 'reasoning_effort' does not support '${String(body.reasoning_effort)}' with this model. Supported values are: '${rules.effort}', 'low', 'medium', and 'high'.`,
        );
      }
      if (rules.temperature === "default-only" && "temperature" in body) {
        return reject("Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.");
      }
      if (body.stream) {
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`);
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    }),
  );
  return bodies;
}

describe("OpenAI request parameters across model families", () => {
  beforeEach(() => {
    resetModelRequestRulesForTests();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("CEREBRAS_API_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetModelRequestRulesForTests();
  });

  it("sends max_completion_tokens and no reasoning effort to gpt-4.1 models, first time", async () => {
    const bodies = fakeOpenAi({ effort: null });
    await gptComplete(msgs, { model: "gpt-4.1-mini", apiKey: "", provider: "openai", maxTokens: 128, temperature: 0 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ max_completion_tokens: 128, temperature: 0 });
    expect(bodies[0]).not.toHaveProperty("max_tokens");
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  });

  it("asks a reasoning model for no reasoning, so it answers at once", async () => {
    const bodies = fakeOpenAi({ effort: "none" });
    await gptComplete(msgs, { model: "gpt-6-luna", apiKey: "", provider: "openai", maxTokens: 128 });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.reasoning_effort).toBe("none");
  });

  it("learns a model's lowest effort and default-only temperature once, then sends them first time", async () => {
    const bodies = fakeOpenAi({ effort: "minimal", temperature: "default-only" });
    let out = "";
    for await (const d of gptStream(msgs, { model: "gpt-5-mini", apiKey: "", provider: "openai", maxTokens: 60, temperature: 0.3 })) out += d;
    expect(out).toBe("ok");
    const first = bodies.length;
    expect(first).toBe(3); // effort refused, then temperature refused, then served

    await gptComplete(msgs, { model: "gpt-5-mini", apiKey: "", provider: "openai", maxTokens: 60, temperature: 0 });
    expect(bodies).toHaveLength(first + 1);
    expect(bodies.at(-1)).toMatchObject({ reasoning_effort: "minimal" });
    expect(bodies.at(-1)).not.toHaveProperty("temperature");
  });

  it("adds the service tier and prompt cache key only when set", async () => {
    const bodies = fakeOpenAi({ effort: null });
    await gptComplete(msgs, { model: "gpt-4.1-mini", apiKey: "", provider: "openai" });
    expect(bodies[0]).not.toHaveProperty("service_tier");
    expect(bodies[0]).not.toHaveProperty("prompt_cache_key");

    vi.stubEnv("WEBEE_NATIVE_OPENAI_SERVICE_TIER", "priority");
    await gptComplete(msgs, { model: "gpt-4.1-mini", apiKey: "", provider: "openai", promptCacheKey: "webee-agent-1" });
    expect(bodies[1]).toMatchObject({ service_tier: "priority", prompt_cache_key: "webee-agent-1" });
  });

  it("still surfaces a 400 it cannot fix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid 'messages': empty" } }), { status: 400 })),
    );
    await expect(gptComplete(msgs, { model: "gpt-4.1-mini", apiKey: "", provider: "openai" })).rejects.toThrow(/400/);
  });
});
