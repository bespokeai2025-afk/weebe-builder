import { describe, expect, it } from "vitest";

import { AudioPlaybackController } from "@/lib/voice/browser/audio-playback-controller.shared";
import { ResponseLifecycle } from "@/lib/voice/response-lifecycle.shared";
import { resolveVoiceRuntimeConfig } from "@/lib/voice/voice-runtime-config.shared";
import { splitSpeakableChunks } from "@/lib/voice/tts/types";

describe("ResponseLifecycle", () => {
  it("invalidates stale response ids on supersede", () => {
    const life = new ResponseLifecycle();
    const first = life.begin(1, "node-a");
    const second = life.begin(1, "node-b");
    expect(life.isActive(first)).toBe(false);
    expect(life.isActive(second)).toBe(true);
  });

  it("cancel clears the active id", () => {
    const life = new ResponseLifecycle();
    const id = life.begin(2);
    life.cancel("caller interrupted");
    expect(life.isActive(id)).toBe(false);
    expect(life.snapshot.state).toBe("cancelled");
  });
});

describe("resolveVoiceRuntimeConfig", () => {
  it("maps interruption sensitivity into barge-in frames", () => {
    const sensitive = resolveVoiceRuntimeConfig({ interruptionSensitivity: 1 });
    const conservative = resolveVoiceRuntimeConfig({ interruptionSensitivity: 0 });
    expect(sensitive.interruption.bargeInSpeechFrames).toBeLessThan(
      conservative.interruption.bargeInSpeechFrames,
    );
  });
});

describe("splitSpeakableChunks", () => {
  it("splits long static intros into multiple chunks", () => {
    const intro =
      "Hello, thanks for taking my call. I just wanted to quickly explain how this works. " +
      "It will only take a minute.";
    const chunks = [...splitSpeakableChunks(intro, 80)];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toContain("Hello");
    expect(chunks.join(" ")).toContain("minute.");
  });
});

describe("AudioPlaybackController", () => {
  it("drops audio for stale response ids", async () => {
    let currentTime = 0;
    const ctx = {
      state: "running",
      currentTime,
      createBuffer: (_c: number, len: number) => ({
        duration: len / 24000,
        copyToChannel: () => {},
      }),
      createBufferSource: () => {
        const node = {
          buffer: null as unknown,
          onended: null as (() => void) | null,
          connect: () => {},
          start: () => {},
          stop: () => {},
        };
        return node;
      },
      resume: async () => {},
    } as unknown as AudioContext;

    const playback = new AudioPlaybackController(() => ctx, () => ctx.destination, {
      sampleRate: 24000,
    });
    playback.setActiveResponse(2);
    const pcm = Buffer.alloc(480).toString("base64");
    await playback.enqueueAudio(pcm, 1);
    expect(playback.queueLength).toBe(0);
  });
});
