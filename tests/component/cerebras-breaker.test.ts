/**
 * `classify()` and `generate()` each independently retry Cerebras -> OpenAI on a quota/rate-limit
 * error, so without a shared breaker a single call could pay for a failed Cerebras attempt on
 * EVERY LLM call it makes for the rest of that call. `CerebrasBreaker` is the fix: once one call
 * trips it, later calls with the same breaker object skip straight to OpenAI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `gptComplete` is a plain (non-streaming) JSON request/response — see gpt.ts's `completeOnce`. */
function completionResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
  });
}

describe("CerebrasBreaker", () => {
  beforeEach(() => {
    vi.stubEnv("CEREBRAS_API_KEY", "cere-test");
    vi.stubEnv("OPENAI_API_KEY", "oai-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("trips on a Cerebras quota error and falls back to OpenAI for that call", async () => {
    const { gptComplete } = await import("@/lib/voice/llm/gpt");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("cerebras")) {
          return new Response("quota exceeded", { status: 429 });
        }
        return completionResponse("ok");
      }),
    );

    const breaker = { down: false };
    const out = await gptComplete(
      [{ role: "user", content: "hi" }],
      { model: "gpt-oss-120b", apiKey: "sk-test", provider: "cerebras", breaker },
    );

    expect(out).toBe("ok");
    expect(breaker.down).toBe(true);
    expect(calls).toEqual([
      expect.stringContaining("cerebras"),
      expect.stringContaining("openai"),
    ]);
  });

  it("skips Cerebras entirely once the breaker is already tripped — no wasted failing request", async () => {
    const { gptComplete } = await import("@/lib/voice/llm/gpt");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).includes("cerebras")) {
          throw new Error("must never be called once the breaker is down");
        }
        return completionResponse("ok");
      }),
    );

    const breaker = { down: true };
    const out = await gptComplete(
      [{ role: "user", content: "hi" }],
      { model: "gpt-oss-120b", apiKey: "sk-test", provider: "cerebras", breaker },
    );

    expect(out).toBe("ok");
    expect(calls).toEqual([expect.stringContaining("openai")]);
  });

  it("does not trip the breaker for a non-quota error — a real bug should still surface", async () => {
    const { gptComplete } = await import("@/lib/voice/llm/gpt");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("internal error", { status: 500 })),
    );

    const breaker = { down: false };
    await expect(
      gptComplete([{ role: "user", content: "hi" }], {
        model: "gpt-oss-120b",
        apiKey: "sk-test",
        provider: "cerebras",
        breaker,
      }),
    ).rejects.toThrow();
    expect(breaker.down).toBe(false);
  });
});

describe("gptComplete request shape", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "oai-test");
    vi.stubEnv("CEREBRAS_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends a plain (non-streaming) request and parses the JSON body directly", async () => {
    const { gptComplete } = await import("@/lib/voice/llm/gpt");
    let sentBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(String(init.body));
        return completionResponse('{"transition": 1}');
      }),
    );

    const out = await gptComplete([{ role: "user", content: "hi" }], {
      model: "gpt-4.1-nano",
      apiKey: "sk-test",
      provider: "openai",
      responseFormat: "json_object",
      maxTokens: 128,
      temperature: 0,
    });

    expect(out).toBe('{"transition": 1}');
    // The whole point: no SSE framing for a call that only ever reads the finished text.
    expect(sentBody).toMatchObject({ stream: false, response_format: { type: "json_object" } });
  });
});
