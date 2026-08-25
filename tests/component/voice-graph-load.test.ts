import { describe, expect, it } from "vitest";

import { loadFlowFromAgent } from "@/lib/voice/graph/load";
import { compileFlow } from "@/lib/voice/graph/flow";
import { ConversationVm } from "@/lib/voice/graph/vm";
import type { VmDirective, VmLlm } from "@/lib/voice/graph/types";

/**
 * These tests exercise the seam between the builder's exporter and the VM. The
 * VM deliberately consumes the exporter's output rather than the builder's own
 * node shape, so that a native call and a Retell call interpret the same graph —
 * if that contract slips, shadow testing compares two different agents.
 */

function builderNode(
  id: string,
  kind: string,
  data: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { kind, label: id, dialogue: "", ...data },
  };
}

function stubLlm(classify: (choices: string[]) => number = () => 0) {
  const generatePrompts: string[] = [];
  const llm: VmLlm = {
    generate: async (messages) => {
      generatePrompts.push(messages.map((m) => m.content).join("\n"));
      return "generated";
    },
    classify: async (_messages, choices) => classify(choices),
    extract: async () => ({}),
  };
  return Object.assign(llm, { generatePrompts });
}

async function drain(gen: AsyncGenerator<VmDirective>): Promise<VmDirective[]> {
  const out: VmDirective[] = [];
  for await (const d of gen) out.push(d);
  return out;
}

const speech = (ds: VmDirective[]) =>
  ds
    .filter((d): d is Extract<VmDirective, { type: "speak" }> => d.type === "speak")
    .map((d) => d.text);

describe("loadFlowFromAgent", () => {
  it("exports a builder graph into a flow the VM can execute", () => {
    const flowData = {
      nodes: [
        builderNode("greet", "conversation", {
          isStart: true,
          instructionType: "static_text",
          dialogue: "Hello, how can I help?",
          transitions: [{ id: "t1", condition: "caller has a question", target: "answer" }],
        }),
        builderNode("answer", "conversation", { dialogue: "Let me look that up." }),
      ],
      edges: [{ id: "e1", source: "greet", target: "answer", sourceHandle: "t1" }],
    };

    const loaded = loadFlowFromAgent(flowData, { agentName: "Test", globalPrompt: "Be brief." });
    const compiled = compileFlow(loaded.flow);

    expect(compiled.startNodeId).toBe("greet");
    expect(compiled.globalPrompt).toBe("Be brief.");
    expect(compiled.nodes.get("greet")?.edges?.[0]).toMatchObject({
      destination_node_id: "answer",
      transition_condition: { type: "prompt", prompt: "caller has a question" },
    });
    expect(compiled.warnings).toEqual([]);
  });

  it("maps every voice node kind onto an executable flow node type", () => {
    const flowData = {
      nodes: [
        builderNode("a", "conversation", { isStart: true }),
        builderNode("b", "function", { toolId: "book" }),
        builderNode("c", "call_transfer", { transferNumber: "+447412345678" }),
        builderNode("d", "press_digit"),
        builderNode("e", "logic_split"),
        builderNode("f", "agent_transfer", { dialogue: "agent_123" }),
        builderNode("g", "sms", { smsMessage: "hi" }),
        builderNode("h", "extract_variable", { variableName: "postcode" }),
        builderNode("i", "code", { codeSource: "return {}" }),
        builderNode("j", "ending", { endingPrompt: "Bye" }),
        builderNode("k", "check_documents"),
        builderNode("l", "send_upload_link"),
        builderNode("m", "http_request", { httpUrl: "https://example.test" }),
        // Notes are annotations, not steps, and must not reach the VM.
        builderNode("note", "note"),
      ],
      edges: [],
    };

    const compiled = compileFlow(loadFlowFromAgent(flowData, {}).flow);

    expect([...compiled.nodes.keys()].sort()).toEqual(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].sort(),
    );
    // No node was dropped for being unsupported.
    expect(compiled.warnings.join(" ")).not.toMatch(/unsupported type/);
    expect([...compiled.nodes.values()].map((n) => n.type)).toEqual(
      expect.arrayContaining([
        "conversation",
        "function",
        "transfer_call",
        "press_digit",
        "branch",
        "agent_swap",
        "sms",
        "extract_dynamic_variables",
        "code",
        "end",
      ]),
    );
  });

  it("runs an exported builder graph end to end", async () => {
    const flowData = {
      nodes: [
        builderNode("greet", "conversation", {
          isStart: true,
          instructionType: "static_text",
          dialogue: "Hi {{first_name}}, are you free to talk?",
          transitions: [
            { id: "t1", condition: "caller says yes", target: "pitch" },
            { id: "t2", condition: "caller says no", target: "bye" },
          ],
        }),
        builderNode("pitch", "conversation", {
          instructionType: "static_text",
          dialogue: "Great, here is the offer.",
          transitions: [{ id: "t3", condition: "done", target: "bye" }],
        }),
        builderNode("bye", "ending", { endingPrompt: "Thanks for your time." }),
      ],
      edges: [
        { id: "e1", source: "greet", target: "pitch", sourceHandle: "t1" },
        { id: "e2", source: "greet", target: "bye", sourceHandle: "t2" },
        { id: "e3", source: "pitch", target: "bye", sourceHandle: "t3" },
      ],
    };

    const loaded = loadFlowFromAgent(flowData, {}, { first_name: "Ada" });
    // Prefers the "yes" branch where one is offered, otherwise takes the only way
    // out of the node.
    const llm = stubLlm((choices) => {
      const yes = choices.findIndex((c) => c === "caller says yes");
      return yes >= 0 ? yes : 0;
    });
    const vm = new ConversationVm({ flow: loaded.flow, llm, variables: loaded.variables });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual([
      "Hi Ada, are you free to talk?",
    ]);
    expect(speech(await drain(vm.run({ type: "user_utterance", text: "sure" })))).toEqual([
      "Great, here is the offer.",
    ]);

    // The exporter emits `ending` nodes as prompt instructions, so the closing
    // line is generated from the author's intent rather than read verbatim.
    const last = await drain(vm.run({ type: "user_utterance", text: "sounds good" }));
    expect(speech(last)).toEqual(["generated"]);
    expect(llm.generatePrompts.at(-1)).toContain("Thanks for your time.");
    expect(last.at(-1)).toMatchObject({ type: "end_call", reason: "flow_ended" });
  });

  it("reads static ending nodes verbatim", async () => {
    const flowData = {
      nodes: [
        builderNode("greet", "conversation", {
          isStart: true,
          instructionType: "static_text",
          dialogue: "Hello.",
          transitions: [{ id: "t1", condition: "done", target: "bye" }],
        }),
        builderNode("bye", "ending", {
          instructionType: "static_text",
          endingPrompt: "Thanks for calling. Goodbye!",
        }),
      ],
      edges: [{ id: "e1", source: "greet", target: "bye", sourceHandle: "t1" }],
    };

    const loaded = loadFlowFromAgent(flowData, {});
    const llm = stubLlm(() => 0);
    const vm = new ConversationVm({ flow: loaded.flow, llm, variables: loaded.variables });

    await drain(vm.run({ type: "begin" }));
    const last = await drain(vm.run({ type: "user_utterance", text: "ok" }));
    expect(speech(last)).toEqual(["Thanks for calling. Goodbye!"]);
    expect(last.at(-1)).toMatchObject({ type: "end_call", reason: "flow_ended" });
  });

  it("seeds declared defaults but leaves uncollected variables absent", () => {
    const loaded = loadFlowFromAgent(
      { nodes: [], edges: [], variables: [{ name: "brand", defaultValue: "WEBEE" }, { name: "postcode" }] },
      {},
    );

    expect(loaded.variables).toEqual({ brand: "WEBEE" });
  });

  it("lets caller-supplied variables win over declared defaults", () => {
    const loaded = loadFlowFromAgent(
      { nodes: [], edges: [], variables: [{ name: "brand", defaultValue: "WEBEE" }] },
      {},
      { brand: "Acme" },
    );

    expect(loaded.variables.brand).toBe("Acme");
  });

  it("reports a flow with nothing to execute instead of failing silently", () => {
    const loaded = loadFlowFromAgent({ nodes: [], edges: [] }, {});

    expect(loaded.warnings.join(" ")).toMatch(/no conversation-flow nodes/);
  });

  it("falls back to an imported raw flow when the export throws", () => {
    // A dynamic transfer with no variable name is a validation error the exporter
    // raises; the round-tripped flow is still runnable.
    const flowData = {
      nodes: [builderNode("x", "call_transfer", { transferMode: "dynamic", transferDynamicVariable: "" })],
      edges: [],
    };
    const rawConversationFlow = {
      start_node_id: "raw1",
      nodes: [
        {
          id: "raw1",
          type: "conversation",
          instruction: { type: "static_text", text: "From the imported flow" },
          edges: [],
        },
      ],
    };

    const loaded = loadFlowFromAgent(flowData, { rawConversationFlow });

    expect(loaded.warnings.join(" ")).toMatch(/flow export failed/);
    expect(loaded.warnings.join(" ")).toMatch(/rawConversationFlow/);
    expect(compileFlow(loaded.flow).startNodeId).toBe("raw1");
  });

  it("tolerates junk instead of throwing at call time", () => {
    expect(() => loadFlowFromAgent(null, null)).not.toThrow();
    expect(() => loadFlowFromAgent("nonsense", 42)).not.toThrow();
    expect(loadFlowFromAgent(undefined, undefined).flow.nodes ?? []).toEqual([]);
  });
});
