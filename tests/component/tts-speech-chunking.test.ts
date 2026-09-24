/**
 * How spoken text is cut into TTS segments.
 *
 * Every segment handed to a TTS provider is spoken as a complete utterance, so a cut in the middle
 * of a clause makes the voice fall away and restart. The old chunker flushed the first 12
 * characters at the nearest space — "Good afternoon" — and then restarted with the rest, which is
 * why the agent sounded robotic whichever voice was chosen.
 */
import { describe, expect, it } from "vitest";
import {
  batchIntoSentences,
  findSpeechCut,
  normalizeSpeechText,
  splitSpeakableChunks,
  VOICE_LATENCY_TTS_BATCH,
} from "@/lib/voice/tts/types";

async function* tokens(text: string, size = 4): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}
const collect = async (gen: AsyncIterable<string>) => {
  const out: string[] = [];
  for await (const s of gen) out.push(s);
  return out;
};

describe("findSpeechCut", () => {
  it("prefers a sentence end", () => {
    const s = "Yes, that works. And your surname?";
    expect(s.slice(0, findSpeechCut(s, 30))).toBe("Yes, that works.");
  });

  it("falls back to a clause break when there is no sentence end", () => {
    const s = "Good afternoon to you, this is reception";
    expect(s.slice(0, findSpeechCut(s, 30))).toBe("Good afternoon to you,");
  });

  it("falls back to a word boundary when there is no punctuation at all", () => {
    const s = "Good afternoon to you this is reception";
    expect(s.slice(0, findSpeechCut(s, 20)).endsWith(" ")).toBe(false);
    expect(s.slice(0, findSpeechCut(s, 20))).toBe("Good afternoon to");
  });
});

describe("batchIntoSentences", () => {
  it("does not open a turn on a clipped fragment", async () => {
    const line = "Good afternoon to you, this is reception at Dr Nyla's Medispa. How may I help you?";
    const segments = await collect(
      batchIntoSentences(tokens(line), VOICE_LATENCY_TTS_BATCH.maxChars, {
        firstFlushChars: VOICE_LATENCY_TTS_BATCH.firstFlushChars,
      }),
    );
    // Whatever the batching decides, every segment must end on punctuation.
    for (const s of segments) expect(s).toMatch(/[.!?,;:]$/);
    // And the old behaviour — a bare two-word opener cut at 12 chars — must not reappear.
    expect(segments[0]).not.toBe("Good afternoon");
    expect(segments[0]!.length).toBeGreaterThan(14);
    expect(segments.join(" ")).toContain("How may I help you?");
  });

  it("keeps whole sentences together", async () => {
    const segments = await collect(batchIntoSentences(tokens("Yes. No. Maybe."), 160, { firstFlushChars: 40 }));
    expect(segments.join(" ")).toBe("Yes. No. Maybe.");
  });

  it("splits an unpunctuated monologue on word boundaries, never mid-word", async () => {
    const long = "right ".repeat(60).trim();
    const segments = await collect(batchIntoSentences(tokens(long), 60, { firstFlushChars: 40 }));
    for (const s of segments) {
      expect(s.startsWith("right")).toBe(true);
      expect(s.endsWith("right")).toBe(true);
    }
  });

  it("loses no words", async () => {
    const line = "Certainly, I can check that for you. Which clinic would you prefer, London or Cheshire?";
    const segments = await collect(batchIntoSentences(tokens(line), 60, { firstFlushChars: 40 }));
    expect(segments.join(" ").replace(/\s+/g, " ")).toBe(line);
  });
});

describe("splitSpeakableChunks", () => {
  it("cuts a long pre-authored line on punctuation", () => {
    const line =
      "Thank you for calling, we are open Monday to Saturday, ten until eight, and our clinic is in Alderley Edge.";
    for (const chunk of splitSpeakableChunks(line, 40)) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk).not.toMatch(/\s$/);
    }
  });
});

describe("normalizeSpeechText", () => {
  it("removes the space a model leaves before punctuation", () => {
    expect(normalizeSpeechText("Hello , how are you ?")).toBe("Hello, how are you?");
  });
});
