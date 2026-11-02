import { describe, expect, it } from "vitest";
import { ConversationVm } from "@/lib/voice/graph/vm";
import { edgeGateVars, missingGateVars } from "@/lib/voice/graph/required-details.shared";
import type { FlowNode, LlmMessage, VariableValue, VmDirective, VmLlm } from "@/lib/voice/graph/types";

/**
 * Retell's "don't move on until the details are in" pattern on WEBEE Native:
 *   ask step ──answered──► extract step ──{{email}} exists AND {{postcode}} exists──► next
 */

type Extract = (messages: LlmMessage[]) => Record<string, VariableValue>;

function llmWith(extract: Extract, generated: string[] = []) {
  const prompts: LlmMessage[][] = [];
  const llm: VmLlm = {
    async generate(m) {
      prompts.push(m);
      return "line";
    },
    async *generateStream(m) {
      prompts.push(m);
      generated.push("line");
      yield "line";
    },
    // Prompt exits: "the caller answered" always applies.
    async classify() {
      return 0;
    },
    async extract(m) {
      return extract(m);
    },
  };
  return { llm, prompts };
}

async function drain(gen: AsyncGenerator<VmDirective>) {
  const out: VmDirective[] = [];
  for await (const d of gen) {
    out.push(d);
    if (d.type === "speak" && d.textStream) for await (const _ of d.textStream) void _;
  }
  return out;
}

const gate = (to: string) => ({
  id: "gate",
  destination_node_id: to,
  transition_condition: {
    type: "equation" as const,
    prompt: "",
    operator: "&&" as const,
    equations: [
      { left: "{{email}}", operator: "exists" },
      { left: "{{postcode}}", operator: "exists" },
    ],
  },
});

function flow(extractEdges: FlowNode["edges"], elseTo?: string) {
  return {
    start_node_id: "ask",
    nodes: [
      {
        id: "ask",
        type: "conversation",
        name: "ask",
        instruction: { type: "prompt", text: "Ask for the caller's email and postcode" },
        edges: [{ id: "a1", destination_node_id: "grab", transition_condition: { type: "prompt", prompt: "caller answered" } }],
      },
      {
        id: "grab",
        type: "extract_dynamic_variables",
        variables: [
          { name: "email", description: "email", type: "string" },
          { name: "postcode", description: "postcode", type: "string" },
        ],
        edges: extractEdges,
        ...(elseTo ? { else_edge: { id: "else", destination_node_id: elseTo, transition_condition: { type: "prompt", prompt: "Else" } } } : {}),
      },
      { id: "next", type: "conversation", name: "next", instruction: { type: "static_text", text: "Thanks, all done." } },
      { id: "other", type: "conversation", name: "other", instruction: { type: "static_text", text: "Else path." } },
    ] as FlowNode[],
  };
}

const spoken = (ds: VmDirective[]) =>
  ds.filter((d): d is Extract<VmDirective, { type: "speak" }> => d.type === "speak").map((d) => d.text ?? "[streamed]");

describe("required details — helpers", () => {
  it("names the variables equation exits test, and which are empty", () => {
    expect(edgeGateVars([gate("next")])).toEqual(["email", "postcode"]);
    expect(missingGateVars([gate("next")], { email: "a@b.com", postcode: "" })).toEqual(["postcode"]);
    expect(edgeGateVars([{ id: "p", destination_node_id: "x", transition_condition: { type: "prompt", prompt: "caller agreed" } }])).toEqual([]);
  });
});

describe("required details — extract step gate", () => {
  it("moves on once every gated detail is captured", async () => {
    const { llm } = llmWith(() => ({ email: "a@b.com", postcode: "LS22 7AG" }));
    const vm = new ConversationVm({ flow: flow([gate("next")]), llm });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "a@b.com and LS22 7AG" }));
    expect(spoken(out)).toContain("Thanks, all done.");
  });

  it("goes back and asks for only what is missing instead of walking through the gate", async () => {
    const { llm, prompts } = llmWith(() => ({ email: "a@b.com" }));
    const vm = new ConversationVm({ flow: flow([gate("next")]), llm, hooks: { log: () => {} } });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "it's a@b.com" }));
    expect(spoken(out)).not.toContain("Thanks, all done.");
    const tail = prompts.at(-1)!.at(-1)!.content;
    expect(tail).toMatch(/Still needed from the caller: postcode\./i);
    expect(tail).toMatch(/already have email/i);
  });

  it("gives up after three attempts and moves on as before", async () => {
    const { llm } = llmWith(() => ({ email: "a@b.com" }));
    const vm = new ConversationVm({ flow: flow([gate("next")]), llm, hooks: { log: () => {} } });
    await drain(vm.run({ type: "begin" }));
    for (let i = 0; i < 3; i++) {
      const out = await drain(vm.run({ type: "user_utterance", text: "no postcode, sorry" }));
      expect(spoken(out)).not.toContain("Thanks, all done.");
    }
    const out = await drain(vm.run({ type: "user_utterance", text: "still no" }));
    expect(spoken(out)).toContain("Thanks, all done.");
  });

  it("an explicit else exit still wins", async () => {
    const { llm } = llmWith(() => ({ email: "a@b.com" }));
    const vm = new ConversationVm({ flow: flow([gate("next")], "other"), llm });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "a@b.com" }));
    expect(spoken(out)).toContain("Else path.");
  });
});

describe("required details — else drawn in the builder", () => {
  it("treats an exit labelled Else as the extract step's else", async () => {
    const { llm } = llmWith(() => ({ email: "a@b.com" }));
    const drawnElse = { id: "e", destination_node_id: "other", transition_condition: { type: "prompt" as const, prompt: "Else" } };
    const vm = new ConversationVm({ flow: flow([gate("next"), drawnElse]), llm });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "a@b.com" }));
    expect(spoken(out)).toContain("Else path.");
  });

  it("does not take the drawn else when the gate passes", async () => {
    const { llm } = llmWith(() => ({ email: "a@b.com", postcode: "LS22 7AG" }));
    const drawnElse = { id: "e", destination_node_id: "other", transition_condition: { type: "prompt" as const, prompt: "" } };
    const vm = new ConversationVm({ flow: flow([drawnElse, gate("next")]), llm });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "a@b.com LS22 7AG" }));
    expect(spoken(out)).toContain("Thanks, all done.");
  });
});

describe("required details — equation exits on an ask step", () => {
  it("sees a detail given in the same reply (no one-turn lag)", async () => {
    const { llm } = llmWith(() => ({ email: "a@b.com" }));
    const vm = new ConversationVm({
      flow: {
        start_node_id: "ask",
        nodes: [
          {
            id: "ask",
            type: "conversation",
            name: "ask",
            instruction: { type: "prompt", text: "Ask for the caller's email" },
            edges: [
              {
                id: "g",
                destination_node_id: "next",
                transition_condition: { type: "equation", prompt: "", operator: "&&", equations: [{ left: "{{email}}", operator: "exists" }] },
              },
            ],
          },
          { id: "next", type: "conversation", name: "next", instruction: { type: "static_text", text: "Got your email." } },
        ] as FlowNode[],
      },
      llm,
      variableNames: ["email"],
    });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "my email is a at b dot com" }));
    expect(spoken(out)).toContain("Got your email.");
  });
});
