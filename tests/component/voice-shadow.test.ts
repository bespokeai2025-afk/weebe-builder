import { describe, expect, it } from "vitest";

import { ConversationVm } from "@/lib/voice/graph/vm";
import type { ConversationFlow, FlowNode, VmLlm } from "@/lib/voice/graph/types";
import { replayThroughVm } from "@/lib/voice/shadow/replay";
import {
  diffTranscripts,
  formatShadowTranscript,
  parseTranscriptText,
  similarity,
} from "@/lib/voice/shadow/transcript-diff";

function llm(classify: (choices: string[]) => number = () => 0): VmLlm {
  return {
    generate: async () => "generated",
    classify: async (_m, choices) => classify(choices),
    extract: async () => ({}),
  };
}

function say(id: string, text: string, edges: FlowNode["edges"] = []): FlowNode {
  return { id, type: "conversation", instruction: { type: "static_text", text }, edges };
}

function edge(id: string, to: string): NonNullable<FlowNode["edges"]>[number] {
  return { id, destination_node_id: to, transition_condition: { type: "prompt", prompt: "" } };
}

function flowOf(nodes: FlowNode[]): ConversationFlow {
  return { start_node_id: nodes[0]?.id, nodes };
}

describe("similarity", () => {
  it("scores identical text as a perfect match", () => {
    expect(similarity("Can I book you in for Tuesday?", "Can I book you in for Tuesday?")).toBe(1);
  });

  it("separates a negation from the sentence it negates", () => {
    // The reason bigrams are used rather than word overlap: these two share
    // almost every word but mean opposite things.
    const score = similarity("yes tomorrow at three works", "no tomorrow at three does not work");
    expect(score).toBeLessThan(0.75);
  });

  it("still scores single-word turns, which have no bigrams", () => {
    expect(similarity("yes", "yes")).toBe(1);
    expect(similarity("yes", "no")).toBe(0);
  });

  it("treats punctuation and casing as noise", () => {
    expect(similarity("Hello there!", "hello there")).toBe(1);
  });

  it("scores an empty candidate against real text as zero", () => {
    expect(similarity("hello there", "")).toBe(0);
  });
});

describe("parseTranscriptText", () => {
  it("reads both Retell's labels and our own", () => {
    const turns = parseTranscriptText("Agent: Hi there\nUser: I need a quote\nAssistant: Of course");
    expect(turns).toEqual([
      { role: "agent", text: "Hi there" },
      { role: "user", text: "I need a quote" },
      { role: "agent", text: "Of course" },
    ]);
  });

  it("joins an utterance that runs over several lines", () => {
    const turns = parseTranscriptText("Agent: Hi there\nand welcome\nUser: thanks");
    expect(turns[0]).toEqual({ role: "agent", text: "Hi there and welcome" });
  });

  it("drops preamble before the first speaker label rather than guessing at it", () => {
    expect(parseTranscriptText("call started 12:04\nUser: hello")).toEqual([
      { role: "user", text: "hello" },
    ]);
  });

  it("round-trips through the stored format", () => {
    const turns = [
      { role: "agent" as const, text: "Hi" },
      { role: "user" as const, text: "Hello" },
    ];
    expect(parseTranscriptText(formatShadowTranscript(turns))).toEqual(turns);
  });
});

describe("diffTranscripts", () => {
  const ref = [
    { role: "agent" as const, text: "Hello, thanks for calling Acme. How can I help?" },
    { role: "user" as const, text: "I want a quote" },
    { role: "agent" as const, text: "Sure, what is your postcode?" },
  ];

  it("calls a verbatim replay aligned", () => {
    const diff = diffTranscripts(ref, ref);
    expect(diff.verdict).toBe("aligned");
    expect(diff.averageSimilarity).toBe(1);
    expect(diff.divergedAtTurn).toBeNull();
    expect(diff.turns.every((t) => t.verdict === "match")).toBe(true);
  });

  it("ignores user turns, which are replayed verbatim by construction", () => {
    const diff = diffTranscripts(ref, [
      ref[0],
      { role: "user", text: "completely different wording" },
      ref[2],
    ]);
    expect(diff.verdict).toBe("aligned");
    expect(diff.referenceAgentTurns).toBe(2);
    expect(diff.candidateAgentTurns).toBe(2);
  });

  it("reports the first diverging turn, not the last", () => {
    const diff = diffTranscripts(ref, [
      ref[0],
      { role: "agent", text: "Let me transfer you to billing right away." },
      { role: "agent", text: "Sure, what is your postcode?" },
    ]);
    expect(diff.divergedAtTurn).toBe(2);
  });

  it("caps the verdict at drifting when one side produced more turns", () => {
    // Structurally different flows are not aligned however well the overlapping
    // turns happen to score.
    const diff = diffTranscripts(ref, [ref[0]]);
    expect(diff.verdict).toBe("drifting");
    expect(diff.turns.at(-1)?.verdict).toBe("missing");
    expect(diff.divergedAtTurn).toBe(2);
  });

  it("marks turns only the native engine produced as extra", () => {
    const diff = diffTranscripts([ref[0]], [ref[0], { role: "agent", text: "Are you still there?" }]);
    expect(diff.turns.at(-1)?.verdict).toBe("extra");
    // An extra turn is not a divergence from the reference — there is nothing
    // there to diverge from — so it must not be reported as one.
    expect(diff.divergedAtTurn).toBeNull();
  });

  it("scores an empty replay as divergent rather than perfect", () => {
    const diff = diffTranscripts(ref, []);
    expect(diff.verdict).toBe("divergent");
    expect(diff.averageSimilarity).toBe(0);
  });
});

describe("replayThroughVm", () => {
  it("interleaves the replayed caller turns with the agent's replies", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("greet", "Hello", [edge("e1", "ask")]),
        say("ask", "What is your name?", [edge("e2", "bye")]),
        { id: "bye", type: "end", instruction: { type: "static_text", text: "Goodbye" } },
      ]),
      llm: llm(),
    });

    const result = await replayThroughVm(vm, ["hi", "Sam"]);

    expect(result.turns).toEqual([
      { role: "agent", text: "Hello" },
      { role: "user", text: "hi" },
      { role: "agent", text: "What is your name?" },
      { role: "user", text: "Sam" },
      { role: "agent", text: "Goodbye" },
    ]);
    expect(result.nodePath).toEqual(["greet", "ask", "bye"]);
    expect(result.endReason).not.toBeNull();
    expect(result.unusedUserTurns).toBe(0);
  });

  it("counts caller turns the flow ended before reaching", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("greet", "Hello", [edge("e1", "bye")]),
        { id: "bye", type: "end", instruction: { type: "static_text", text: "Goodbye" } },
      ]),
      llm: llm(),
    });

    const result = await replayThroughVm(vm, ["hi", "wait", "hello?"]);

    // An early end is the finding, so the remaining turns are reported rather
    // than forced through a dead line.
    expect(result.unusedUserTurns).toBe(2);
    expect(result.turns.filter((t) => t.role === "user")).toEqual([{ role: "user", text: "hi" }]);
  });

  it("treats a transfer as connected so the flow does not take its failure branch", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("greet", "Putting you through", [edge("e1", "xfer")]),
        {
          id: "xfer",
          type: "transfer_call",
          transfer_destination: { type: "predefined", number: "+15550000" },
        } as FlowNode,
      ]),
      llm: llm(),
    });

    const result = await replayThroughVm(vm, ["please transfer me"]);

    expect(result.transferredTo).toBe("+15550000");
  });

  it("records the failure branch when the caller asks for it explicitly", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("greet", "Putting you through", [edge("e1", "xfer")]),
        {
          id: "xfer",
          type: "transfer_call",
          transfer_destination: { type: "predefined", number: "+15550000" },
        } as FlowNode,
      ]),
      llm: llm(),
    });

    const result = await replayThroughVm(vm, ["please transfer me"], { transferSucceeds: false });

    expect(result.transferredTo).toBe("+15550000");
    expect(result.endReason).not.toBe("transferred");
  });
});
