import { describe, expect, it } from "vitest";

import {
  partialMatchesFinal,
  streamSpeculativeTokens,
  type SpeculativeSpeechRun,
} from "@/lib/voice/speculative-speech.shared";
import { ConversationVm } from "@/lib/voice/graph/vm";
import type { ConversationFlow, VmLlm } from "@/lib/voice/graph/types";

const noopLlm: VmLlm = {
  classify: async () => 0,
  generate: async () => "ok",
  generateStream: async function* () {
    yield "ok";
  },
};

function flowWithStaticEdge(): ConversationFlow {
  return {
    start_node_id: "start",
    start_speaker: "agent",
    nodes: [
      {
        id: "start",
        type: "conversation",
        instruction: { type: "static_text", text: "Hello" },
        edges: [
          {
            id: "e1",
            destination_node_id: "next",
            transition_condition: {
              type: "prompt",
              prompt: "User says yes or confirms",
            },
          },
        ],
      },
      {
        id: "next",
        type: "conversation",
        instruction: { type: "static_text", text: "Great, moving on." },
      },
    ],
  };
}

describe("partialMatchesFinal", () => {
  it("matches identical and prefix variants", () => {
    expect(partialMatchesFinal("yes", "yes")).toBe(true);
    expect(partialMatchesFinal("yes", "yes.")).toBe(true);
    expect(partialMatchesFinal("my name is ar", "my name is arjo")).toBe(true);
    expect(partialMatchesFinal("hello", "goodbye")).toBe(false);
  });
});

describe("ConversationVm.peekSpeechWarmTarget", () => {
  it("returns static text for heuristic yes match", () => {
    const vm = new ConversationVm({ flow: flowWithStaticEdge(), llm: noopLlm });
    vm.run({ type: "begin" });
    const target = vm.peekSpeechWarmTarget("yes");
    expect(target).toEqual({ kind: "static", text: "Great, moving on." });
  });

  it("returns the Always destination even when edges were lifted off the node", () => {
    const vm = new ConversationVm({
      flow: {
        start_node_id: "start",
        start_speaker: "agent",
        nodes: [
          {
            id: "start",
            type: "conversation",
            instruction: { type: "static_text", text: "Does that sound ok?" },
            edges: [
              {
                id: "e1",
                destination_node_id: "name",
                transition_condition: { type: "prompt", prompt: "" },
              },
            ],
          },
          {
            id: "name",
            type: "conversation",
            instruction: { type: "static_text", text: "Can I take your name?" },
          },
        ],
      },
      llm: noopLlm,
    });
    expect(vm.peekSpeechWarmTarget("yes")).toEqual({
      kind: "static",
      text: "Can I take your name?",
    });
    expect(vm.peekSpeechWarmTarget("aarajo")).toEqual({
      kind: "static",
      text: "Can I take your name?",
    });
  });

  it("treats a spoken prompt script as static TTS warm text", () => {
    const vm = new ConversationVm({
      flow: {
        start_node_id: "start",
        start_speaker: "agent",
        nodes: [
          {
            id: "start",
            type: "conversation",
            instruction: { type: "static_text", text: "Is that postcode correct?" },
            edges: [
              {
                id: "e1",
                destination_node_id: "next",
                transition_condition: { type: "prompt", prompt: "User says yes or confirms" },
              },
            ],
          },
          {
            id: "next",
            type: "conversation",
            instruction: {
              type: "prompt",
              text: "Can I take your name?\nDo not ask any other questions.",
            },
          },
        ],
      },
      llm: noopLlm,
    });
    vm.run({ type: "begin" });
    expect(vm.peekSpeechWarmTarget("yes")).toEqual({
      kind: "static",
      text: "Can I take your name?",
    });
  });
});

describe("streamSpeculativeTokens", () => {
  it("yields tokens as they arrive instead of waiting for the producer to finish", async () => {
    const ctrl = new AbortController();
    const tokens: string[] = [];
    let resolveDone!: (text: string) => void;
    const run: SpeculativeSpeechRun = {
      partial: "yes",
      ctrl,
      tokens,
      done: new Promise((resolve) => {
        resolveDone = resolve;
      }),
    };

    const seen: string[] = [];
    const consume = (async () => {
      for await (const chunk of streamSpeculativeTokens(run)) seen.push(chunk);
    })();

    tokens.push("Hello");
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["Hello"]);

    tokens.push(" there.");
    resolveDone("Hello there.");
    await consume;
    expect(seen.join("")).toBe("Hello there.");
  });
});
