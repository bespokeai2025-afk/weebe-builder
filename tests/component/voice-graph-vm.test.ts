import { describe, expect, it } from "vitest";

import { compileFlow, interpolate } from "@/lib/voice/graph/flow";
import { selectEdge } from "@/lib/voice/graph/router";
import { ConversationVm } from "@/lib/voice/graph/vm";
import type {
  ConversationFlow,
  FlowNode,
  LlmMessage,
  VariableValue,
  VmDirective,
  VmLlm,
} from "@/lib/voice/graph/types";

// ─── Test doubles ─────────────────────────────────────────────────────────────

interface FakeLlmOverrides {
  generate?: (messages: LlmMessage[]) => string;
  classify?: (messages: LlmMessage[], choices: string[]) => number;
  extract?: (
    messages: LlmMessage[],
    fields: Array<{ name: string }>,
  ) => Record<string, VariableValue>;
}

interface FakeLlm extends VmLlm {
  calls: {
    generate: LlmMessage[][];
    classify: Array<{ messages: LlmMessage[]; choices: string[] }>;
    extract: Array<{ fields: Array<{ name: string }> }>;
  };
}

function fakeLlm(overrides: FakeLlmOverrides = {}): FakeLlm {
  const calls: FakeLlm["calls"] = { generate: [], classify: [], extract: [] };
  return {
    calls,
    async generate(messages) {
      calls.generate.push(messages);
      return overrides.generate?.(messages) ?? "a generated line";
    },
    async classify(messages, choices) {
      calls.classify.push({ messages, choices });
      return overrides.classify?.(messages, choices) ?? 0;
    },
    async extract(messages, fields) {
      calls.extract.push({ fields });
      return overrides.extract?.(messages, fields) ?? {};
    },
  };
}

async function drain(gen: AsyncGenerator<VmDirective>): Promise<VmDirective[]> {
  const out: VmDirective[] = [];
  for await (const d of gen) out.push(d);
  return out;
}

const speech = (ds: VmDirective[]) =>
  ds.filter((d): d is Extract<VmDirective, { type: "speak" }> => d.type === "speak").map((d) => d.text);
const kinds = (ds: VmDirective[]) => ds.map((d) => d.type);

/** A `conversation` node that speaks fixed words. */
function say(id: string, text: string, edges: FlowNode["edges"] = []): FlowNode {
  return {
    id,
    type: "conversation",
    name: id,
    instruction: { type: "static_text", text },
    edges,
  };
}

function edge(id: string, to: string, prompt = ""): NonNullable<FlowNode["edges"]>[number] {
  return { id, destination_node_id: to, transition_condition: { type: "prompt", prompt } };
}

function flowOf(nodes: FlowNode[], extra: Partial<ConversationFlow> = {}): ConversationFlow {
  return { start_node_id: nodes[0]?.id, nodes, ...extra };
}

// ─── Flow compilation ─────────────────────────────────────────────────────────

describe("compileFlow", () => {
  it("drops nodes it cannot execute rather than guessing", () => {
    const compiled = compileFlow({
      start_node_id: "a",
      nodes: [
        say("a", "hi"),
        { id: "b", type: "wa_template" } as unknown as FlowNode,
        { type: "conversation" } as unknown as FlowNode,
        say("a", "duplicate"),
      ],
    });

    expect([...compiled.nodes.keys()]).toEqual(["a"]);
    expect(compiled.warnings.join(" ")).toMatch(/unsupported type "wa_template"/);
    expect(compiled.warnings.join(" ")).toMatch(/no id/);
    expect(compiled.warnings.join(" ")).toMatch(/duplicate node id/);
  });

  it("strips edges pointing at nodes that did not survive compilation", () => {
    const compiled = compileFlow({
      start_node_id: "a",
      nodes: [say("a", "hi", [edge("e1", "ghost", "always")])],
    });

    expect(compiled.nodes.get("a")?.edges?.[0].destination_node_id).toBeUndefined();
    expect(compiled.warnings.join(" ")).toMatch(/points at missing node "ghost"/);
  });

  it("falls back to the first conversation node when start_node_id is bogus", () => {
    const compiled = compileFlow({
      start_node_id: "nope",
      nodes: [{ id: "x", type: "branch", edges: [] }, say("greet", "hello")],
    });

    expect(compiled.startNodeId).toBe("greet");
    expect(compiled.warnings.join(" ")).toMatch(/not a valid node/);
  });

  it("treats a node as global only when it carries a condition", () => {
    const compiled = compileFlow({
      start_node_id: "a",
      nodes: [
        say("a", "hi"),
        { ...say("human", "connecting you"), is_global: true },
        { ...say("bye", "bye"), global_node_setting: { condition: "caller wants to leave" } },
      ],
    });

    expect(compiled.globalNodes.map((g) => g.node.id)).toEqual(["bye"]);
  });

  it("refuses to make the start node global, which would trap the call", () => {
    const compiled = compileFlow({
      start_node_id: "a",
      nodes: [{ ...say("a", "hi"), global_node_setting: { condition: "anything" } }],
    });

    expect(compiled.globalNodes).toHaveLength(0);
    expect(compiled.warnings.join(" ")).toMatch(/cannot also be a global node/);
  });

  it("reads start_speaker from the node before the flow", () => {
    expect(compileFlow(flowOf([say("a", "hi")], { start_speaker: "user" })).startSpeaker).toBe("user");
    expect(
      compileFlow({
        start_node_id: "a",
        start_speaker: "user",
        nodes: [{ ...say("a", "hi"), start_speaker: "agent" }],
      }).startSpeaker,
    ).toBe("agent");
  });
});

describe("interpolate", () => {
  it("substitutes known variables", () => {
    expect(interpolate("Hi {{name}}, you owe {{amount}}", { name: "Ada", amount: 42 })).toBe(
      "Hi Ada, you owe 42",
    );
  });

  it("leaves unknown references visible instead of speaking a hole", () => {
    expect(interpolate("Hi {{name}}", {})).toBe("Hi {{name}}");
    expect(interpolate("Hi {{name}}", { name: "" })).toBe("Hi {{name}}");
  });
});

// ─── Routing ──────────────────────────────────────────────────────────────────

describe("selectEdge", () => {
  const ctx = { history: [], variables: {}, globalPrompt: "" };

  it("takes a lone unconditional edge without paying for a classifier call", async () => {
    const llm = fakeLlm();
    const chosen = await selectEdge([edge("e1", "next")], ctx, llm);

    expect(chosen?.destination_node_id).toBe("next");
    expect(llm.calls.classify).toHaveLength(0);
  });

  it("ignores edges with no destination", async () => {
    const llm = fakeLlm();
    const stub = { id: "e1", transition_condition: { type: "prompt" as const, prompt: "failed" } };

    expect(await selectEdge([stub], ctx, llm)).toBeNull();
  });

  it("returns null when the classifier says nothing applies", async () => {
    const llm = fakeLlm({ classify: () => -1 });

    expect(await selectEdge([edge("e1", "a", "yes"), edge("e2", "b", "no")], ctx, llm)).toBeNull();
  });

  it("keeps the call moving when the classifier itself fails", async () => {
    const llm: VmLlm = {
      generate: async () => "",
      classify: async () => {
        throw new Error("classifier down");
      },
      extract: async () => ({}),
    };
    const chosen = await selectEdge([edge("e1", "a", "yes"), edge("e2", "b", "")], ctx, llm);

    // The unconditional branch is the safe default, not simply the first edge.
    expect(chosen?.destination_node_id).toBe("b");
  });
});

// ─── Conversation nodes and turn-taking ───────────────────────────────────────

describe("ConversationVm conversation flow", () => {
  it("speaks the start node and hands the floor to the caller", async () => {
    const vm = new ConversationVm({ flow: flowOf([say("greet", "Hello there")]), llm: fakeLlm() });
    const out = await drain(vm.run({ type: "begin" }));

    expect(kinds(out)).toEqual(["speak", "await_user"]);
    expect(speech(out)).toEqual(["Hello there"]);
  });

  it("stays silent until spoken to when start_speaker is user", async () => {
    const vm = new ConversationVm({
      flow: flowOf([say("greet", "Hello")], { start_speaker: "user" }),
      llm: fakeLlm(),
    });

    expect(kinds(await drain(vm.run({ type: "begin" })))).toEqual(["await_user"]);
    expect(speech(await drain(vm.run({ type: "user_utterance", text: "hi?" })))).toEqual(["Hello"]);
  });

  it("generates dialogue for prompt instructions and passes the task to the model", async () => {
    const llm = fakeLlm({ generate: () => "Sure, I can help with that." });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask why they are calling" },
          edges: [],
        },
      ]),
      llm,
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(speech(out)).toEqual(["Sure, I can help with that."]);
    const system = llm.calls.generate[0][0].content;
    expect(system).toContain("Ask why they are calling");
    expect(system).toContain("ONLY the words to say next");
  });

  it("interpolates collected variables into static speech", async () => {
    const vm = new ConversationVm({
      flow: flowOf([say("greet", "Hello {{first_name}}")]),
      llm: fakeLlm(),
      variables: { first_name: "Ada" },
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Hello Ada"]);
  });

  it("honours the NO_RESPONSE_NEEDED sentinel instead of reading it aloud", async () => {
    const vm = new ConversationVm({
      flow: flowOf([say("listen", "NO_RESPONSE_NEEDED")]),
      llm: fakeLlm(),
    });

    expect(kinds(await drain(vm.run({ type: "begin" })))).toEqual(["await_user"]);
  });

  it("advances to the branch the caller's reply selects", async () => {
    const llm = fakeLlm({
      classify: (_m, choices) => choices.findIndex((c) => c === "caller says yes"),
    });
    const vm = new ConversationVm({
      flow: flowOf([
        say("ask", "Are you interested?", [
          edge("e1", "no", "caller says no"),
          edge("e2", "yes", "caller says yes"),
        ]),
        say("yes", "Great!"),
        say("no", "No problem."),
      ]),
      llm,
    });

    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "yeah go on" }));

    expect(speech(out)).toEqual(["Great!"]);
    expect(vm.nodeId).toBe("yes");
  });

  it("takes another turn on the same node when no transition condition is met", async () => {
    const llm = fakeLlm({ classify: () => -1 });
    const vm = new ConversationVm({
      flow: flowOf([say("ask", "What is your account number?", [edge("e1", "done", "gave a number")]), say("done", "Thanks")]),
      llm,
    });

    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "who is this?" }));

    expect(speech(out)).toEqual(["What is your account number?"]);
    expect(vm.nodeId).toBe("ask");
  });

  it("records both sides of the conversation for downstream routing", async () => {
    const vm = new ConversationVm({ flow: flowOf([say("greet", "Hello")]), llm: fakeLlm({ classify: () => -1 }) });

    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "hi there" }));

    expect(vm.getTranscript().map((m) => `${m.role}:${m.content}`)).toEqual([
      "assistant:Hello",
      "user:hi there",
      "assistant:Hello",
    ]);
  });
});

// ─── End, branch, extract ─────────────────────────────────────────────────────

describe("ConversationVm terminal and logic nodes", () => {
  it("speaks the closing line then ends the call", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("greet", "Hi", [edge("e1", "bye")]),
        { id: "bye", type: "end", instruction: { type: "static_text", text: "Goodbye!" } },
      ]),
      llm: fakeLlm(),
    });

    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "nothing else" }));

    expect(speech(out)).toEqual(["Goodbye!"]);
    expect(out.at(-1)).toEqual({ type: "end_call", nodeId: "bye", reason: "flow_ended" });
    expect(vm.isEnded).toBe(true);
  });

  it("passes through a branch node without speaking", async () => {
    const llm = fakeLlm({ classify: (_m, c) => c.findIndex((x) => x === "balance is overdue") });
    const vm = new ConversationVm({
      flow: flowOf([
        { id: "split", type: "branch", edges: [edge("e1", "current", "balance is current"), edge("e2", "chase", "balance is overdue")] },
        say("current", "All good"),
        say("chase", "You have an overdue balance"),
      ]),
      llm,
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(speech(out)).toEqual(["You have an overdue balance"]);
  });

  it("falls back to a branch else_edge when nothing matches", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "split",
          type: "branch",
          edges: [edge("e1", "vip", "caller is a VIP")],
          else_edge: edge("else", "standard", "Else"),
        },
        say("vip", "VIP service"),
        say("standard", "Standard service"),
      ]),
      llm: fakeLlm({ classify: () => -1 }),
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Standard service"]);
  });

  it("extracts declared variables and continues without waiting", async () => {
    const llm = fakeLlm({ extract: () => ({ postcode: "SW1A 1AA" }) });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "grab",
          type: "extract_dynamic_variables",
          instruction: { type: "prompt", text: "Extract the postcode" },
          variables: [{ name: "postcode", description: "the caller's postcode", type: "string" }],
          edges: [edge("e1", "confirm")],
        },
        say("confirm", "Got it: {{postcode}}"),
      ]),
      llm,
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out[0]).toEqual({ type: "variables", nodeId: "grab", values: { postcode: "SW1A 1AA" } });
    expect(speech(out)).toEqual(["Got it: SW1A 1AA"]);
    expect(vm.getVariables()).toEqual({ postcode: "SW1A 1AA" });
    expect(llm.calls.extract[0].fields.map((f) => f.name)).toEqual(["postcode"]);
  });

  it("keeps the call alive when extraction fails", async () => {
    const llm: VmLlm = {
      generate: async () => "",
      classify: async () => 0,
      extract: async () => {
        throw new Error("extractor down");
      },
    };
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "grab",
          type: "extract_dynamic_variables",
          variables: [{ name: "postcode", description: "postcode", type: "string" }],
          edges: [edge("e1", "next")],
        },
        say("next", "Carrying on"),
      ]),
      llm,
      hooks: { log: () => {} },
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Carrying on"]);
  });
});

// ─── Function nodes ───────────────────────────────────────────────────────────

describe("ConversationVm function nodes", () => {
  const bookingNode = (overrides: Record<string, unknown> = {}): FlowNode =>
    ({
      id: "book",
      type: "function",
      name: "book_appointment",
      tool_id: "book_appointment",
      tool_type: "local",
      edges: [edge("e1", "done")],
      ...overrides,
    }) as FlowNode;

  it("runs the tool, reports the result and continues", async () => {
    const calls: string[] = [];
    const vm = new ConversationVm({
      flow: flowOf([bookingNode(), say("done", "Booked")]),
      llm: fakeLlm(),
      hooks: {
        executeTool: async (inv) => {
          calls.push(inv.toolName);
          return { ok: true, output: '{"reference":"AB12"}' };
        },
      },
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(calls).toEqual(["book_appointment"]);
    expect(out.find((d) => d.type === "tool_call")).toMatchObject({ ok: true, toolId: "book_appointment" });
    expect(speech(out)).toEqual(["Booked"]);
  });

  it("speaks a filler line while the tool runs", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        bookingNode({ speak_during_execution: true, execution_message_description: "One moment" }),
        say("done", "Booked"),
      ]),
      llm: fakeLlm(),
      hooks: { executeTool: async () => ({ ok: true, output: "{}" }) },
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out[0]).toEqual({ type: "speak", nodeId: "book", text: "One moment", interruptible: true });
  });

  it("takes the else_edge when the tool fails", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        bookingNode({ else_edge: edge("else", "sorry", "Failed") }),
        say("done", "Booked"),
        say("sorry", "That did not work"),
      ]),
      llm: fakeLlm(),
      hooks: { executeTool: async () => ({ ok: false, output: '{"error":"no slots"}' }) },
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["That did not work"]);
  });

  it("does not wait for a fire-and-forget tool", async () => {
    let settled = false;
    const vm = new ConversationVm({
      flow: flowOf([bookingNode({ wait_for_result: false }), say("done", "Moving on")]),
      llm: fakeLlm(),
      hooks: {
        executeTool: async () => {
          await new Promise((r) => setTimeout(r, 30));
          settled = true;
          return { ok: true, output: "{}" };
        },
      },
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(speech(out)).toEqual(["Moving on"]);
    expect(kinds(out)).not.toContain("tool_call");
    expect(settled).toBe(false);
  });

  it("ends the call when a hang-up tool reports it", async () => {
    const vm = new ConversationVm({
      flow: flowOf([bookingNode(), say("done", "unreachable")]),
      llm: fakeLlm(),
      hooks: { executeTool: async () => ({ ok: true, output: "{}", endCall: true }) },
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out.at(-1)).toMatchObject({ type: "end_call", reason: "flow_ended" });
    expect(speech(out)).toEqual([]);
  });

  it("fills declared webhook parameters from the conversation", async () => {
    let seenArgs: unknown;
    const llm = fakeLlm({ extract: () => ({ payload: '{"x":1}' }) });
    const vm = new ConversationVm({
      flow: flowOf([
        bookingNode({
          tool_type: "webhook",
          url: "https://example.test/hook?w={{workspace}}",
          parameters: { type: "object", properties: { payload: { type: "string", description: "body" } }, required: [] },
        }),
        say("done", "ok"),
      ]),
      llm,
      variables: { workspace: "acme" },
      hooks: {
        executeTool: async (inv) => {
          seenArgs = inv.args;
          expect(inv.url).toBe("https://example.test/hook?w=acme");
          return { ok: true, output: "{}" };
        },
      },
    });
    await drain(vm.run({ type: "begin" }));

    expect(seenArgs).toEqual({ payload: '{"x":1}' });
  });

  it("promotes tool-returned variables into the store", async () => {
    const vm = new ConversationVm({
      flow: flowOf([bookingNode(), say("done", "Reference {{reference}}")]),
      llm: fakeLlm(),
      hooks: { executeTool: async () => ({ ok: true, output: "{}", variables: { reference: "AB12" } }) },
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Reference AB12"]);
  });

  it("survives a missing tool executor by taking the failure path", async () => {
    const vm = new ConversationVm({
      flow: flowOf([bookingNode({ else_edge: edge("else", "sorry", "Failed") }), say("done", "Booked"), say("sorry", "Cannot do that")]),
      llm: fakeLlm(),
      hooks: { log: () => {} },
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Cannot do that"]);
  });
});

// ─── DTMF, SMS, code ──────────────────────────────────────────────────────────

describe("ConversationVm press_digit, sms and code nodes", () => {
  it("waits for a digit and routes on a literal match without a classifier", async () => {
    const llm = fakeLlm();
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "menu",
          type: "press_digit",
          instruction: { type: "static_text", text: "Press 1 for sales, 2 for support" },
          pause_detection_ms: 2500,
          edges: [edge("e1", "sales", "caller presses 1"), edge("e2", "support", "caller presses 2")],
        },
        say("sales", "Sales here"),
        say("support", "Support here"),
      ]),
      llm,
    });

    const first = await drain(vm.run({ type: "begin" }));
    expect(first).toContainEqual({ type: "await_digit", nodeId: "menu", pauseDetectionMs: 2500 });

    const out = await drain(vm.run({ type: "digit", digit: "2" }));
    expect(speech(out)).toEqual(["Support here"]);
    expect(llm.calls.classify).toHaveLength(0);
  });

  it("does not confuse digit 1 with a condition about 11", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "menu",
          type: "press_digit",
          edges: [edge("e1", "eleven", "caller presses 11"), edge("e2", "one", "caller presses 1")],
        },
        say("eleven", "Eleven"),
        say("one", "One"),
      ]),
      llm: fakeLlm(),
    });

    await drain(vm.run({ type: "begin" }));
    expect(speech(await drain(vm.run({ type: "digit", digit: "1" })))).toEqual(["One"]);
  });

  it("routes an SMS node by whether sending succeeded", async () => {
    const build = (ok: boolean) =>
      new ConversationVm({
        flow: flowOf([
          {
            id: "text",
            type: "sms",
            instruction: { type: "static_text", text: "Your code is {{code}}" },
            success_edge: edge("s", "sent", "Sent successfully"),
            failed_edge: edge("f", "failed", "Failed to send"),
          },
          say("sent", "Sent it"),
          say("failed", "Could not send"),
        ]),
        llm: fakeLlm(),
        variables: { code: "9931" },
        hooks: { sendSms: async () => ok },
      });

    const good = await drain(build(true).run({ type: "begin" }));
    expect(good).toContainEqual({ type: "sms", nodeId: "text", message: "Your code is 9931", ok: true });
    expect(speech(good)).toEqual(["Sent it"]);

    expect(speech(await drain(build(false).run({ type: "begin" })))).toEqual(["Could not send"]);
  });

  it("skips a code node rather than evaluating flow-authored JavaScript", async () => {
    const logs: string[] = [];
    const vm = new ConversationVm({
      flow: flowOf([
        { id: "calc", type: "code", code: "process.exit(1)", edges: [edge("e1", "next")] },
        say("next", "Still here"),
      ]),
      llm: fakeLlm(),
      hooks: { log: (m) => logs.push(m) },
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Still here"]);
    expect(logs.join(" ")).toMatch(/no runCode hook/);
  });

  it("merges variables from a sandboxed code hook when one is provided", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        { id: "calc", type: "code", code: "return { total: 7 }", edges: [edge("e1", "next")] },
        say("next", "Total is {{total}}"),
      ]),
      llm: fakeLlm(),
      hooks: { runCode: async () => ({ total: 7 }) },
    });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Total is 7"]);
  });
});

// ─── Transfers ────────────────────────────────────────────────────────────────

describe("ConversationVm transfer and agent swap", () => {
  const transferNode = (dest: Record<string, unknown>, extra: Record<string, unknown> = {}): FlowNode =>
    ({
      id: "xfer",
      type: "transfer_call",
      transfer_destination: dest,
      transfer_option: { type: "cold_transfer" },
      ...extra,
    }) as FlowNode;

  it("emits a predefined transfer and waits for the outcome", async () => {
    const vm = new ConversationVm({
      flow: flowOf([transferNode({ type: "predefined", number: "+447412345678" })]),
      llm: fakeLlm(),
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out).toContainEqual({
      type: "transfer_call",
      nodeId: "xfer",
      destination: "+447412345678",
      transferType: "cold_transfer",
      sipHeaders: undefined,
    });
    // The call is not over yet: the transfer-failed edge is still reachable.
    expect(vm.isEnded).toBe(false);

    const done = await drain(vm.run({ type: "transfer_result", ok: true }));
    expect(done).toContainEqual({ type: "end_call", nodeId: "xfer", reason: "transferred" });
  });

  it("follows the transfer-failed edge when the carrier could not connect", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        transferNode({ type: "predefined", number: "+447412345678" }, { edge: edge("f", "sorry", "Transfer failed") }),
        say("sorry", "Nobody is available"),
      ]),
      llm: fakeLlm(),
    });

    await drain(vm.run({ type: "begin" }));
    expect(speech(await drain(vm.run({ type: "transfer_result", ok: false })))).toEqual(["Nobody is available"]);
  });

  it("resolves an inferred destination from a collected variable", async () => {
    const llm = fakeLlm();
    const vm = new ConversationVm({
      flow: flowOf([transferNode({ type: "inferred", prompt: "callback_number" })]),
      llm,
      variables: { callback_number: "+441234567890" },
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out[0]).toMatchObject({ type: "transfer_call", destination: "+441234567890" });
    // Already known, so there is nothing to ask the model about.
    expect(llm.calls.extract).toHaveLength(0);
  });

  it("asks the conversation for an inferred destination that was never collected", async () => {
    const llm = fakeLlm({ extract: () => ({ callback_number: "+441111111111" }) });
    const vm = new ConversationVm({
      flow: flowOf([transferNode({ type: "inferred", prompt: "callback_number" })]),
      llm,
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out[0]).toMatchObject({ type: "transfer_call", destination: "+441111111111" });
  });

  it("reports an error and takes the failed edge when no destination resolves", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        transferNode({ type: "predefined", number: "" }, { edge: edge("f", "sorry", "Transfer failed") }),
        say("sorry", "Cannot transfer"),
      ]),
      llm: fakeLlm(),
      hooks: { log: () => {} },
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(kinds(out)).toContain("error");
    expect(speech(out)).toEqual(["Cannot transfer"]);
  });

  it("hands off on agent_swap and stops driving the call", async () => {
    const vm = new ConversationVm({
      flow: flowOf([{ id: "swap", type: "agent_swap", agent_id: "agent_123", agent_version: 4 }]),
      llm: fakeLlm(),
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out[0]).toEqual({ type: "agent_swap", nodeId: "swap", agentId: "agent_123", agentVersion: 4 });
    expect(out.at(-1)).toMatchObject({ type: "end_call", reason: "agent_swapped" });
  });
});

// ─── Global nodes and loop safety ─────────────────────────────────────────────

describe("ConversationVm global nodes", () => {
  const flowWithGlobal = (returnToPrevious: boolean): ConversationFlow =>
    flowOf([
      say("ask", "How can I help?", [edge("e1", "done", "the caller is finished")]),
      say("done", "Thanks"),
      {
        ...say("human", "Putting you through to a colleague"),
        global_node_setting: { condition: "caller asks for a human", return_to_previous: returnToPrevious },
      },
    ]);

  it("pre-empts the current node's edges when a global condition fires", async () => {
    // The global check runs first and claims the turn.
    const llm = fakeLlm({ classify: (_m, choices) => (choices.includes("caller asks for a human") ? 0 : -1) });
    const vm = new ConversationVm({ flow: flowWithGlobal(false), llm });

    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "let me talk to a person" }));

    expect(speech(out)).toEqual(["Putting you through to a colleague"]);
    expect(vm.nodeId).toBe("human");
  });

  it("returns to the interrupted node when the global node asks to", async () => {
    const llm = fakeLlm({ classify: (_m, choices) => (choices.includes("caller asks for a human") ? 0 : -1) });
    const vm = new ConversationVm({ flow: flowWithGlobal(true), llm, hooks: { log: () => {} } });

    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "a person please" }));
    // The global node has no outgoing edges, so the next turn unwinds to "ask".
    const out = await drain(vm.run({ type: "user_utterance", text: "actually never mind" }));

    expect(speech(out)).toEqual(["How can I help?"]);
    expect(vm.nodeId).toBe("ask");
  });

  it("leaves the scripted path alone when no global condition matches", async () => {
    const llm = fakeLlm({ classify: (_m, choices) => (choices.includes("the caller is finished") ? 0 : -1) });
    const vm = new ConversationVm({ flow: flowWithGlobal(false), llm });

    await drain(vm.run({ type: "begin" }));
    expect(speech(await drain(vm.run({ type: "user_utterance", text: "that is all" })))).toEqual(["Thanks"]);
  });
});

describe("ConversationVm safety rails", () => {
  it("breaks out of a loop of non-blocking nodes instead of spinning forever", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        { id: "a", type: "branch", edges: [edge("e1", "b")] },
        { id: "b", type: "branch", edges: [edge("e2", "a")] },
      ]),
      llm: fakeLlm(),
      maxStepsPerTurn: 6,
      hooks: { log: () => {} },
    });
    const out = await drain(vm.run({ type: "begin" }));

    expect(out.at(-1)).toMatchObject({ type: "end_call", reason: "step_limit" });
    expect(out.filter((d) => d.type === "error")).toHaveLength(1);
  });

  it("ends cleanly when a flow has no executable nodes", async () => {
    const vm = new ConversationVm({ flow: { nodes: [] }, llm: fakeLlm(), hooks: { log: () => {} } });
    const out = await drain(vm.run({ type: "begin" }));

    expect(kinds(out)).toEqual(["error", "end_call"]);
    expect(vm.isEnded).toBe(true);
  });

  it("ends the call at a dead end rather than going silent", async () => {
    const vm = new ConversationVm({
      flow: flowOf([{ id: "split", type: "branch", edges: [] }]),
      llm: fakeLlm(),
      hooks: { log: () => {} },
    });

    expect(await drain(vm.run({ type: "begin" }))).toContainEqual({
      type: "end_call",
      nodeId: "split",
      reason: "dead_end",
    });
  });

  it("ignores input once the call has ended", async () => {
    const vm = new ConversationVm({
      flow: flowOf([{ id: "bye", type: "end", instruction: { type: "static_text", text: "Bye" } }]),
      llm: fakeLlm(),
    });

    await drain(vm.run({ type: "begin" }));
    expect(await drain(vm.run({ type: "user_utterance", text: "hello?" }))).toEqual([]);
  });

  it("only begins once", async () => {
    const vm = new ConversationVm({ flow: flowOf([say("greet", "Hi")]), llm: fakeLlm() });

    expect(speech(await drain(vm.run({ type: "begin" })))).toEqual(["Hi"]);
    expect(await drain(vm.run({ type: "begin" }))).toEqual([]);
  });
});
