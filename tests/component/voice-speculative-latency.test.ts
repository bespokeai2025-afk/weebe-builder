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

  it("warms prompt nodes through the LLM, even when the instruction looks spoken", () => {
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
    const warm = vm.peekSpeechWarmTarget("yes");
    expect(warm?.kind).toBe("prompt");
    if (warm?.kind === "prompt") {
      expect(warm.nodeId).toBe("next");
      expect(warm.messages[0]?.content).toContain("Can I take your name?");
    }
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

/**
 * Pre-endpoint fanout. `peekSpeechWarmTarget` only answers when a heuristic predicts one
 * destination; on every other turn nothing used to start until after the endpoint, leaving the
 * ~800ms VAD hangover idle while the whole LLM round trip waited behind it.
 */
describe("speechWarmFanout", () => {
  /** Two prompt destinations behind conditions no heuristic can resolve. */
  function ambiguousFlow(): ConversationFlow {
    return {
      start_node_id: "start",
      start_speaker: "agent",
      nodes: [
        {
          id: "start",
          type: "conversation",
          // Static so the node is not also a self-candidate — keeps the assertion about edges.
          instruction: { type: "static_text", text: "Freehold or leasehold?" },
          edges: [
            {
              id: "e1",
              destination_node_id: "free",
              transition_condition: { type: "prompt", prompt: "if its freehold" },
            },
            {
              id: "e2",
              destination_node_id: "lease",
              transition_condition: { type: "prompt", prompt: "if its leasehold" },
            },
          ],
        },
        {
          id: "free",
          type: "conversation",
          instruction: { type: "prompt", text: "Confirm freehold and ask the next question." },
        },
        {
          id: "lease",
          type: "conversation",
          instruction: { type: "prompt", text: "Confirm leasehold and ask the next question." },
        },
      ],
    };
  }

  function startedVm(flow: ConversationFlow = ambiguousFlow()) {
    const vm = new ConversationVm({ flow, llm: noopLlm });
    vm.run({ type: "begin" });
    return vm;
  }

  it("warms every plausible destination when no single one is predicted", () => {
    const vm = startedVm();
    // Confirms the premise: this partial is exactly the case that needs the classifier.
    expect(vm.peekSpeechWarmTarget("It's a free wall.")).toBeNull();

    const fanout = vm.speechWarmFanout("It's a free wall.");
    expect(fanout.map((t) => t.nodeId).sort()).toEqual(["free", "lease"]);
    expect(fanout.every((t) => t.kind === "prompt")).toBe(true);
  });

  it("skips a destination that already has a run in flight, so a growing partial cannot stack duplicates", () => {
    const vm = startedVm();
    vm.setSpeculativeSpeech("free", {
      partial: "it's a free",
      ctrl: new AbortController(),
      tokens: [],
      done: Promise.resolve(""),
    } as SpeculativeSpeechRun);

    expect(vm.speechWarmFanout("It's a free wall.").map((t) => t.nodeId)).toEqual(["lease"]);
  });

  it("honours the candidate limit", () => {
    const vm = startedVm();
    expect(vm.speechWarmFanout("It's a free wall.", 1)).toHaveLength(1);
  });

  it("returns nothing when the provider cannot stream", () => {
    const vm = new ConversationVm({
      flow: ambiguousFlow(),
      llm: { classify: async () => 0, generate: async () => "ok" },
    });
    vm.run({ type: "begin" });
    expect(vm.speechWarmFanout("It's a free wall.")).toEqual([]);
  });

  it("leaves static destinations alone — they need no LLM call", () => {
    const vm = startedVm(flowWithStaticEdge());
    expect(vm.speechWarmFanout("something ambiguous entirely")).toEqual([]);
  });
});
