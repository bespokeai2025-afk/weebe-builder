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

  it("detects speaker echo of the agent line", () => {
    const agent =
      "Hi, this is Clare calling from We Buy Any House. Is selling your property still something you're thinking about?";
    expect(looksLikePlaybackEcho("Hi this is Clare calling from We Buy Any House", agent)).toBe(true);
    expect(looksLikePlaybackEcho("yes", agent)).toBe(false);
    expect(looksLikePlaybackEcho("Yes I am still thinking about selling", agent)).toBe(false);
  });
});
