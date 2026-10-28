import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CEREBRAS_QUOTA_COOLDOWN_MS,
  gptComplete,
  gptStream,
  isCerebrasCoolingDown,
  resetCerebrasCooldownForTests,
} from "@/lib/voice/llm/gpt";

const msgs = [{ role: "user" as const, content: "Hi" }];

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200 });
}

describe("Cerebras out of credit", () => {
  let hosts: string[];
  beforeEach(() => {
    resetCerebrasCooldownForTests();
    vi.stubEnv("CEREBRAS_API_KEY", "csk-test");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    hosts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        hosts.push(new URL(url).host);
        if (url.includes("cerebras")) {
          return new Response('{"message":"Payment required","code":"payment_required"}', { status: 402 });
        }
        const stream = JSON.parse(String(init?.body)).stream;
        return stream
          ? sse("Hello")
          : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetCerebrasCooldownForTests();
  });

  it("pays the failed Cerebras round trip once per server, not once per request", async () => {
    let out = "";
    for await (const d of gptStream(msgs, { model: "gpt-oss-120b", apiKey: "", provider: "cerebras" })) out += d;
    expect(out).toBe("Hello");
    expect(isCerebrasCoolingDown()).toBe(true);

    // New call, no per-call breaker passed: goes straight to OpenAI.
    for await (const _ of gptStream(msgs, { model: "gpt-oss-120b", apiKey: "", provider: "cerebras" })) {
      /* drain */
    }
    await gptComplete(msgs, { model: "gpt-oss-120b", apiKey: "", provider: "cerebras" });
    expect(hosts.filter((h) => h.includes("cerebras"))).toHaveLength(1);
    expect(hosts.filter((h) => h.includes("openai"))).toHaveLength(3);
  });

  it("tries Cerebras again after the cool-down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await gptComplete(msgs, { model: "gpt-oss-120b", apiKey: "", provider: "cerebras" });
    expect(isCerebrasCoolingDown()).toBe(true);
    vi.setSystemTime(Date.now() + CEREBRAS_QUOTA_COOLDOWN_MS + 1);
    expect(isCerebrasCoolingDown()).toBe(false);
    await gptComplete(msgs, { model: "gpt-oss-120b", apiKey: "", provider: "cerebras" });
    expect(hosts.filter((h) => h.includes("cerebras"))).toHaveLength(2);
  });
});
