import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveWebeeClassifierModel,
  resolveWebeeLlmProvider,
  resolveWebeeSpeechModel,
} from "@/lib/voice/webee-native.shared";

const saved = {
  cerebras: process.env.CEREBRAS_API_KEY,
  provider: process.env.WEBEE_NATIVE_LLM_PROVIDER,
};

beforeEach(() => {
  delete process.env.WEBEE_NATIVE_LLM_PROVIDER;
});
afterEach(() => {
  if (saved.cerebras === undefined) delete process.env.CEREBRAS_API_KEY;
  else process.env.CEREBRAS_API_KEY = saved.cerebras;
  if (saved.provider === undefined) delete process.env.WEBEE_NATIVE_LLM_PROVIDER;
  else process.env.WEBEE_NATIVE_LLM_PROVIDER = saved.provider;
});

describe("default LLM provider", () => {
  it("prefers Cerebras when a key is configured", () => {
    // ~549ms to first speakable token vs ~2080ms on OpenAI; first token
    // dominates voice latency.
    process.env.CEREBRAS_API_KEY = "csk-test";
    expect(resolveWebeeLlmProvider()).toBe("cerebras");
  });

  it("falls back to OpenAI with no Cerebras key", () => {
    // Declaring cerebras without a key would send gpt-oss-120b to OpenAI,
    // which rejects it — so the fallback has to be the provider, not just the
    // model.
    delete process.env.CEREBRAS_API_KEY;
    expect(resolveWebeeLlmProvider()).toBe("openai");
  });

  it("still honours an explicit override in both directions", () => {
    process.env.CEREBRAS_API_KEY = "csk-test";
    process.env.WEBEE_NATIVE_LLM_PROVIDER = "openai";
    expect(resolveWebeeLlmProvider()).toBe("openai");

    delete process.env.CEREBRAS_API_KEY;
    process.env.WEBEE_NATIVE_LLM_PROVIDER = "cerebras";
    expect(resolveWebeeLlmProvider()).toBe("cerebras");
  });

  it("lets a per-agent setting beat the env default", () => {
    process.env.CEREBRAS_API_KEY = "csk-test";
    expect(resolveWebeeLlmProvider({ webeeLlmProvider: "openai" })).toBe("openai");
  });
});

describe("models follow the provider", () => {
  it("serves a Cerebras-hosted model when defaulting to Cerebras", () => {
    process.env.CEREBRAS_API_KEY = "csk-test";
    expect(resolveWebeeSpeechModel()).toBe("gpt-oss-120b");
    expect(resolveWebeeClassifierModel()).toBe("gpt-oss-120b");
  });

  it("serves OpenAI-hosted models when falling back", () => {
    delete process.env.CEREBRAS_API_KEY;
    expect(resolveWebeeSpeechModel()).not.toBe("gpt-oss-120b");
    expect(resolveWebeeClassifierModel()).not.toBe("gpt-oss-120b");
  });

  it("never pairs a Cerebras model with the OpenAI provider", () => {
    // The mismatch that would 400 every turn.
    for (const key of ["csk-test", ""]) {
      if (key) process.env.CEREBRAS_API_KEY = key;
      else delete process.env.CEREBRAS_API_KEY;
      const provider = resolveWebeeLlmProvider();
      const model = resolveWebeeSpeechModel();
      if (provider === "openai") expect(model.startsWith("gpt-oss-")).toBe(false);
    }
  });
});
