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
    expect(sensitive.interruption.bargeInSpeechFrames).toBe(3);
    expect(conservative.interruption.bargeInSpeechFrames).toBe(10);
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

  it("queues a new response after audio still playing instead of cutting it off", async () => {
    const starts: number[] = [];
    let stopped = 0;
    const ctx = {
      state: "running",
      currentTime: 0,
      createBuffer: (_c: number, len: number) => ({ duration: len / 24000, copyToChannel: () => {} }),
      createBufferSource: () => ({
        buffer: null as unknown,
        onended: null as (() => void) | null,
        connect: () => {},
        start: (at: number) => starts.push(at),
        stop: () => {
          stopped += 1;
        },
      }),
      resume: async () => {},
    } as unknown as AudioContext;
    const playback = new AudioPlaybackController(() => ctx, () => ctx.destination, { sampleRate: 24000 });
    const oneSecond = Buffer.alloc(48000).toString("base64");

    playback.setActiveResponse(1);
    await playback.enqueueAudio(oneSecond, 1);
    playback.setActiveResponse(2);
    await playback.enqueueAudio(oneSecond, 2);

    expect(stopped).toBe(0);
    expect(starts).toHaveLength(2);
    expect(starts[1]).toBeCloseTo(starts[0]! + 1, 5);

    playback.cancelCurrentAudio("barge_in");
    expect(stopped).toBe(2);
  });
});
