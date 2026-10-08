/**
 * The wrap-up guard sits between the speech model and TTS. Two ways it cut replies off:
 * a first sentence ending in a space/newline token counted as "replaced" and the stream stopped
 * there; and a goodbye phrase anywhere later stopped the stream mid-reply, dropping the question.
 */
import { describe, expect, it } from "vitest";
import { guardPrematureWrapUpStream } from "@/lib/voice/graph/speech-guard.shared";

async function speak(tokens: string[], endNode = false): Promise<string> {
  let out = "";
  for await (const d of guardPrematureWrapUpStream(
    (async function* () {
      yield* tokens;
    })(),
    "Is it vacant or rented?",
    endNode,
  ))
    out += d;
  return out;
}

describe("speech wrap-up guard", () => {
  it("keeps the whole reply when the first sentence's token carries a trailing space", async () => {
    expect(await speak(["Got it. ", "Is it vacant", " or rented?"])).toBe("Got it. Is it vacant or rented?");
    expect(await speak(["Thanks.\n", "How many bedrooms?"])).toBe("Thanks.\nHow many bedrooms?");
  });

  it("drops a goodbye sentence but keeps the question after it", async () => {
    expect(await speak(["Lovely.", " I hope you have a good day so far!", " Is it freehold or leasehold?"])).toBe(
      "Lovely. Is it freehold or leasehold?",
    );
  });

  it("never drops a sentence that asks the caller something", async () => {
    const line = ["Perfect.", " You're all set on the details, so what is your timeframe?"];
    expect(await speak(line)).toBe(line.join(""));
  });

  it("still stops a premature goodbye, and leaves end nodes alone", async () => {
    expect(await speak(["Thanks.", " That's all I need for now.", " Have a great day!"])).toBe("Thanks. ");
    expect(await speak(["Thanks.", " Have a great day!"], true)).toBe("Thanks. Have a great day!");
  });
});
