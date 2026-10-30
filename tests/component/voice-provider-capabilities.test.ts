import { describe, expect, it } from "vitest";
import {
  AssemblyAiSttProvider,
  CartesiaSttProvider,
  DeepgramSttProvider,
  FishSttProvider,
  WhisperSttProvider,
} from "@/lib/voice/stt";

/**
 * Each STT provider declares how it behaves before the endpoint, and the voice engine reads only
 * that — so these declarations are the whole difference between providers as far as turn-taking
 * goes. Pin them, and the rules that keep them coherent.
 */
const providers = [
  new CartesiaSttProvider("k"),
  new DeepgramSttProvider("k"),
  new FishSttProvider("k"),
  new AssemblyAiSttProvider("k"),
  new WhisperSttProvider("k"),
];

describe("STT provider capabilities", () => {
  it("every provider declares them", () => {
    for (const p of providers) {
      expect(p.capabilities, p.name).toEqual({
        partials: expect.any(Boolean),
        segmentFinalsBeforeEndpoint: expect.any(Boolean),
        partialCanReplaceFinal: expect.any(Boolean),
      });
    }
  });

  it("only a provider with partials may skip the final", () => {
    for (const p of providers) {
      if (p.capabilities.partialCanReplaceFinal) expect(p.capabilities.partials, p.name).toBe(true);
    }
  });

  it("a streaming provider has something to start pre-endpoint work from", () => {
    for (const p of providers.filter((x) => x.streaming)) {
      const c = p.capabilities;
      expect(c.partials || c.segmentFinalsBeforeEndpoint, p.name).toBe(true);
    }
  });

  it("matches what each provider was measured to do", () => {
    const by = Object.fromEntries(providers.map((p) => [p.name, p.capabilities]));
    expect(by.cartesia).toMatchObject({ partials: false, segmentFinalsBeforeEndpoint: true, partialCanReplaceFinal: false });
    expect(by.fish).toMatchObject({ partials: true, partialCanReplaceFinal: false });
    expect(by.deepgram).toMatchObject({ partials: true, partialCanReplaceFinal: false });
    expect(by.assemblyai).toMatchObject({ partials: true, partialCanReplaceFinal: true });
    expect(by.whisper).toMatchObject({ partials: false, segmentFinalsBeforeEndpoint: false });
  });
});
