import { describe, expect, it } from "vitest";

import {
  guardPrematureWrapUpStream,
  looksLikePlaybackEcho,
  looksLikePrematureWrapUp,
  replacePrematureWrapUp,
} from "@/lib/voice/graph/speech-guard.shared";

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

describe("speech-guard", () => {
  it("detects wrap-up closers the model invents mid-flow", () => {
    expect(
      looksLikePrematureWrapUp(
        "Thank you. That's all I need for now. If you have any questions before your consultation, please let us know.",
      ),
    ).toBe(true);
    expect(looksLikePrematureWrapUp("Is this a house or a flat?")).toBe(false);
  });

  it("swaps wrap-up speech for the node script", () => {
    expect(
      replacePrematureWrapUp("That's all I need for now.", "What type of property is it?"),
    ).toBe("What type of property is it?");
  });

  it("swaps instruction echo for the spoken fallback", () => {
    expect(replacePrematureWrapUp("Ask the preferred title", "What's your preferred title?")).toBe(
      "What's your preferred title?",
    );
  });

  it("replaces a streamed wrap-up on a conversation node", async () => {
    async function* stream() {
      yield "Thank you. That's all I need for now.";
    }
    expect(await collect(guardPrematureWrapUpStream(stream(), "What type of property is it?", false))).toBe(
      "What type of property is it?",
    );
  });

  it("lets end-node goodbyes through", async () => {
    async function* stream() {
      yield "Thanks for your time. Goodbye!";
    }
    expect(await collect(guardPrematureWrapUpStream(stream(), "fallback", true))).toBe(
      "Thanks for your time. Goodbye!",
    );
  });

  // The guard withholds every chunk until a sentence completes, and that wait sits
  // inside the measured first-token-to-first-audio window. onFirstRelease is what makes
  // the two halves distinguishable, so it has to fire exactly once, at the release.
  describe("onFirstRelease", () => {
    it("holds the release until the sentence actually completes", async () => {
      // Fires on the chunk carrying the "?" — not on the fragments before it.
      let pulled = 0;
      let firedAfterPulls = -1;
      async function* stream() {
        for (const chunk of ["Could you tell me", " what type", " of property it is?", " Thanks."]) {
          pulled++;
          yield chunk;
        }
      }
      await collect(
        guardPrematureWrapUpStream(stream(), "fallback", false, () => { firedAfterPulls = pulled; }),
      );
      expect(firedAfterPulls).toBe(3);
    });

    it("still releases once when the stream ends with no sentence boundary at all", async () => {
      let fired = 0;
      async function* stream() {
        yield "Could you tell me";
        yield " what type of property";
      }
      const out = await collect(
        guardPrematureWrapUpStream(stream(), "fallback", false, () => { fired++; }),
      );
      expect(fired).toBe(1);
      expect(out).toBe("Could you tell me what type of property");
    });

    it("fires once, on the chunk that is actually released", async () => {
      let fired = 0;
      async function* stream() {
        yield "Could you tell me";
        yield " what type of property it is?";
        yield " Any detail helps.";
      }
      const out = await collect(
        guardPrematureWrapUpStream(stream(), "fallback", false, () => { fired++; }),
      );
      expect(fired).toBe(1);
      expect(out).toBe("Could you tell me what type of property it is? Any detail helps.");
    });

    it("fires when a wrap-up is swapped for the fallback", async () => {
      let fired = 0;
      async function* stream() {
        yield "Thank you. That's all I need for now.";
      }
      const out = await collect(
        guardPrematureWrapUpStream(stream(), "What type of property is it?", false, () => { fired++; }),
      );
      expect(fired).toBe(1);
      expect(out).toBe("What type of property is it?");
    });

    it("fires on an end node, where nothing is withheld", async () => {
      let fired = 0;
      async function* stream() {
        yield "Thanks for your time.";
        yield " Goodbye!";
      }
      const out = await collect(
        guardPrematureWrapUpStream(stream(), "fallback", true, () => { fired++; }),
      );
      expect(fired).toBe(1);
      expect(out).toBe("Thanks for your time. Goodbye!");
    });

    it("is optional — the guard works without it", async () => {
      async function* stream() {
        yield "What type of property is it?";
      }
      expect(await collect(guardPrematureWrapUpStream(stream(), "fallback", false))).toBe(
        "What type of property is it?",
      );
    });
  });

  it("detects speaker echo of the agent line", () => {
    const agent =
      "Hi, this is Clare calling from We Buy Any House. Is selling your property still something you're thinking about?";
    expect(looksLikePlaybackEcho("Hi this is Clare calling from We Buy Any House", agent)).toBe(true);
    expect(looksLikePlaybackEcho("yes", agent)).toBe(false);
    expect(looksLikePlaybackEcho("Yes I am still thinking about selling", agent)).toBe(false);
  });
});
