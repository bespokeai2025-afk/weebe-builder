import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENGINE_CONFIG_ENV,
  maxDetailReasks,
  speechFirstWordTimeoutMs,
  speechHedgeInitialDelayMs,
  ttsNoAudioTimeoutMs,
} from "@/lib/voice/engine-config.shared";

describe("engine config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("has defaults", () => {
    expect(speechFirstWordTimeoutMs()).toBe(8000);
    expect(speechHedgeInitialDelayMs()).toBe(1500);
    expect(ttsNoAudioTimeoutMs()).toBe(8000);
    expect(maxDetailReasks()).toBe(3);
  });

  it("is overridden by the environment, and ignores junk", () => {
    vi.stubEnv(ENGINE_CONFIG_ENV.speechFirstWordTimeoutMs, "5000");
    vi.stubEnv(ENGINE_CONFIG_ENV.ttsNoAudioTimeoutMs, "nonsense");
    expect(speechFirstWordTimeoutMs()).toBe(5000);
    expect(ttsNoAudioTimeoutMs()).toBe(8000);
  });

  it("lets a node set its own re-ask limit", () => {
    expect(maxDetailReasks(1)).toBe(1);
    expect(maxDetailReasks(0)).toBe(0);
    expect(maxDetailReasks("x")).toBe(3);
  });
});
