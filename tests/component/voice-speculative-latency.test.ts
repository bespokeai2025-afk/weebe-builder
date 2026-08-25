import { describe, expect, it } from "vitest";

import { partialMatchesFinal } from "@/lib/voice/speculative-speech.shared";
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
});
