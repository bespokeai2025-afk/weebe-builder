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

describe("opening — begin after user silence", () => {
  const greetFlow = (startSpeaker: "user" | "agent", beginMs?: number) => ({
    start_node_id: "greet",
    start_speaker: startSpeaker,
    ...(beginMs ? { begin_after_user_silence_ms: beginMs } : {}),
    nodes: [{ id: "greet", type: "conversation", name: "greet", instruction: { type: "static_text", text: "Hi, this is Clare." } }] as FlowNode[],
  });

  it("a caller-first start with a silence wait greets when the wait runs out", async () => {
    const { llm } = llmWith(() => ({}));
    const vm = new ConversationVm({ flow: greetFlow("user", 1000), llm, hooks: { log: () => {} } });
    const begin = await drain(vm.run({ type: "begin" }));
    expect(begin[0]).toMatchObject({ type: "await_user", silenceTimeoutMs: 1000 });
    expect(spoken(await drain(vm.run({ type: "silence_timeout" })))).toEqual(["Hi, this is Clare."]);
  });

  it("a caller-first start with no wait still waits to be spoken to", async () => {
    const { llm } = llmWith(() => ({}));
    const vm = new ConversationVm({ flow: greetFlow("user"), llm });
    const begin = await drain(vm.run({ type: "begin" }));
    expect(spoken(begin)).toEqual([]);
    expect(begin[0]).toMatchObject({ type: "await_user" });
    expect((begin[0] as { silenceTimeoutMs?: number }).silenceTimeoutMs).toBeUndefined();
  });

  it("an agent-first start with no wait greets at once", async () => {
    const { llm } = llmWith(() => ({}));
    const vm = new ConversationVm({ flow: greetFlow("agent"), llm });
    expect(spoken(await drain(vm.run({ type: "begin" })))).toEqual(["Hi, this is Clare."]);
  });
});

describe("corrections and 'yes, but…' replies", () => {
  it("a reply that opens with 'yeah' but carries an email is not a yes", async () => {
    const { tryHeuristicEdgeIndex, carriesMoreThanAYes } = await import("@/lib/voice/graph/router");
    const conditions = ["Yes its correct", "no thats not correct"];
    expect(carriesMoreThanAYes("Yeah, it's Arjav. Virani 1 2 3 at gmail.com.")).toBe(true);
    expect(tryHeuristicEdgeIndex(conditions, "Yeah, it's Arjav. Virani 1 2 3 at gmail.com.")).toBeNull();
    expect(carriesMoreThanAYes("Yeah but the postcode is wrong")).toBe(true);
    // Plain confirmations still take the fast path.
    expect(tryHeuristicEdgeIndex(conditions, "Yes")).toBe(0);
    expect(tryHeuristicEdgeIndex(conditions, "Yeah, that's right")).toBe(0);
  });

  it("tells the next line when a corrected email could not be understood, instead of reading the old one as right", async () => {
    let turn = 0;
    const { llm, prompts } = llmWith(() => (turn++ === 0 ? { email_address: "old@icloud.com" } : { email_address: "rjavirani1238 email dot com" }));
    const vm = new ConversationVm({
      flow: {
        start_node_id: "confirm",
        nodes: [
          {
            id: "confirm",
            type: "conversation",
            name: "confirm",
            instruction: { type: "prompt", text: "Read back {{email_address}} and ask if it is correct" },
            edges: [{ id: "y", destination_node_id: "done", transition_condition: { type: "prompt", prompt: "caller confirms" } }],
          },
          { id: "done", type: "conversation", name: "done", instruction: { type: "static_text", text: "Done." } },
        ] as FlowNode[],
      },
      llm: { ...llm, classify: async () => -1 },
      variableNames: ["email_address"],
      hooks: { log: () => {} },
    });
    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "it's old at icloud dot com" }));
    await drain(vm.run({ type: "user_utterance", text: "No, the right email is rjavirani1238. email dot com." }));
    const tail = prompts.at(-1)!.at(-1)!.content;
    expect(tail).toMatch(/tried to correct their email address/i);
    expect(tail).toMatch(/Do not read the old/i);
    expect(vm.getVariables().email_address).toBe("old@icloud.com");
  });
});

describe("post-call analysis context", () => {
  it("dates the call in the agent's timezone and lists what the tools did", async () => {
    const { callContextBlock } = await import("@/lib/voice/lifecycle/analysis");
    const block = callContextBlock(
      Date.parse("2026-11-02T23:30:00Z"),
      [{ name: "get_available_slots", ok: true, result: "Monday 2 November: 12:00 PM" }],
      "Asia/Dubai",
    );
    expect(block).toMatch(/Call date: Tuesday,? 3 November 2026 \(2026-11-03, Asia\/Dubai\)/);
    expect(block).toMatch(/get_available_slots: succeeded/);
    expect(block).toMatch(/only when a tool that performs it is listed above as succeeded/);
  });

  it("falls back to UTC for a missing or invalid timezone", async () => {
    const { callContextBlock } = await import("@/lib/voice/lifecycle/analysis");
    expect(callContextBlock(Date.parse("2026-11-02T11:30:00Z"), [], "Not/AZone")).toMatch(/2026-11-02, UTC/);
    expect(callContextBlock(Date.parse("2026-11-02T11:30:00Z"), [])).toMatch(/The agent ran no tools/);
  });

  it("marks a failed tool as failed", async () => {
    const { callContextBlock } = await import("@/lib/voice/lifecycle/analysis");
    const block = callContextBlock(Date.now(), [{ name: "book_appointment", ok: false, result: "fetch failed" }]);
    expect(block).toMatch(/book_appointment: FAILED/);
  });
});

describe("email said to be wrong with nothing usable", () => {
  it("does not let the agent read the old email back as right", async () => {
    let turn = 0;
    const { llm, prompts } = llmWith(() => (turn++ === 0 ? { email_address: "bettybet64@yahoo.com" } : {}));
    const vm = new ConversationVm({
      flow: {
        start_node_id: "confirm",
        nodes: [
          {
            id: "confirm",
            type: "conversation",
            name: "confirm",
            instruction: { type: "prompt", text: "Read back {{email_address}} and ask if it is correct" },
            edges: [{ id: "y", destination_node_id: "done", transition_condition: { type: "prompt", prompt: "caller confirms" } }],
          },
          { id: "done", type: "conversation", name: "done", instruction: { type: "static_text", text: "Done." } },
        ] as FlowNode[],
      },
      llm: { ...llm, classify: async () => -1 },
      variableNames: ["email_address"],
      hooks: { log: () => {} },
    });
    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "it's bettybet64 at yahoo dot com" }));
    await drain(vm.run({ type: "user_utterance", text: "No, my email is a RG Avvi. - Whatever." }));
    expect(prompts.at(-1)!.at(-1)!.content).toMatch(/tried to correct their email address/i);
  });
});

describe("tool response_variables (Retell parity)", () => {
  it("reads declared paths out of the result", async () => {
    const { mapToolResponseVariables } = await import("@/lib/voice/graph/variables.shared");
    const out = mapToolResponseVariables(
      JSON.stringify({ success: true, message: "Booked for Monday 12:00", slot: { date: "2026-11-02" }, list: [{ t: "9am" }] }),
      { booking_message: "message", booked_date: "slot.date", first_time: "list.0.t", missing: "nope", empty: "" },
    );
    expect(out).toEqual({ booking_message: "Booked for Monday 12:00", booked_date: "2026-11-02", first_time: "9am" });
  });

  it("a booking result fills booking_message, so the 'contains Booked' exit fires and only declared outputs are reported", async () => {
    const { llm } = llmWith(() => ({}));
    const vm = new ConversationVm({
      flow: {
        start_node_id: "book",
        tools: [
          {
            tool_id: "tool-book",
            name: "book_appointment",
            type: "custom",
            url: "https://example.invalid/book",
            response_variables: { booking_message: "message", booked_date: "appointment_date" },
          },
        ],
        nodes: [
          {
            id: "book",
            type: "function",
            name: "book_appointment",
            tool_id: "tool-book",
            tool_type: "local",
            wait_for_result: true,
            edges: [
              {
                id: "ok",
                destination_node_id: "booked",
                transition_condition: {
                  type: "equation",
                  prompt: "",
                  operator: "||",
                  equations: [{ left: "{{booking_message}}", operator: "contains", right: '"Booked"' }],
                },
              },
            ],
          },
          { id: "booked", type: "conversation", name: "booked", instruction: { type: "static_text", text: "You're booked in." } },
        ] as unknown as FlowNode[],
      },
      llm,
      hooks: {
        log: () => {},
        executeTool: async () => ({
          ok: true,
          output: JSON.stringify({ success: true, message: "Booked: Monday 2 November 12:00", appointment_date: "2026-11-02", slot_count: 42 }),
        }),
      },
    });
    const out = await drain(vm.run({ type: "begin" }));
    expect(spoken(out)).toContain("You're booked in.");
    const reported = out.find((d) => d.type === "variables") as { values: Record<string, unknown> } | undefined;
    expect(reported?.values).toEqual({ booking_message: "Booked: Monday 2 November 12:00", booked_date: "2026-11-02" });
    expect(String(vm.getVariables().slot_count)).toBe("42");
  });
});

describe("address quick-match and postcodes", () => {
  it("does not wave a street-only reply through an exit that wants the full address", async () => {
    const { tryHeuristicEdgeIndex, hasPostcodeLike } = await import("@/lib/voice/graph/router");
    const conds = ["user gives full property address as requested or confirms adress is correct", "no thats not correct"];
    expect(tryHeuristicEdgeIndex(conds, "13 Cordon Road.")).toBeNull();
    expect(tryHeuristicEdgeIndex(conds, "13 Cordon Road, LS22 7AG")).toBe(0);
    expect(hasPostcodeLike("sw1a 1aa")).toBe(true);
    expect(hasPostcodeLike("13 Cordon Road")).toBe(false);
  });
});

describe("function step outcome and passed-in corrections", () => {
  const bookFlow = (edges: unknown[] = []) => ({
    start_node_id: "book",
    tools: [{ tool_id: "tool-book", name: "book_appointment", type: "custom", url: "https://example.invalid/book" }],
    nodes: [
      { id: "book", type: "function", name: "Book", tool_id: "tool-book", tool_type: "local", wait_for_result: true, edges },
      { id: "done", type: "conversation", name: "done", instruction: { type: "static_text", text: "Booked." } },
    ] as unknown as FlowNode[],
  });

  it("a failed tool with no exit to follow is spoken about, not left in silence", async () => {
    const { llm, prompts } = llmWith(() => ({}));
    const vm = new ConversationVm({
      flow: bookFlow(),
      llm,
      hooks: { log: () => {}, executeTool: async () => ({ ok: false, output: '{"error":"fetch failed (ENOTFOUND x)"}' }) },
    });
    const out = await drain(vm.run({ type: "begin" }));
    expect(spoken(out).length).toBeGreaterThan(0);
    expect(prompts.at(-1)!.at(-1)!.content).toMatch(/"book_appointment" step did not work/);
    expect(prompts.at(-1)!.at(-1)!.content).toMatch(/Do not say it was done/);
    // The caller replies while still on that step: the agent answers instead of going silent.
    const before = prompts.length;
    const reply = await drain(vm.run({ type: "user_utterance", text: "So is it booked?" }));
    expect(spoken(reply).length).toBeGreaterThan(0);
    expect(prompts.length).toBeGreaterThan(before);
  });

  it("does not ask the extractor for tool outputs", async () => {
    const asked: string[][] = [];
    const llm: VmLlm = {
      async generate() { return "line"; },
      async *generateStream() { yield "line"; },
      async classify() { return -1; },
      async extract(_m, fields) { asked.push(fields.map((f) => f.name)); return {}; },
    };
    const vm = new ConversationVm({
      flow: {
        start_node_id: "book",
        tools: [{ tool_id: "t", name: "get_available_slots", type: "custom", url: "https://example.invalid" }],
        nodes: [
          { id: "book", type: "function", name: "slots", tool_id: "t", tool_type: "local", wait_for_result: true,
            edges: [{ id: "e", destination_node_id: "ask", transition_condition: { type: "prompt", prompt: "" } }] },
          { id: "ask", type: "conversation", name: "ask", instruction: { type: "prompt", text: "Ask for {{email_address}}" } },
        ] as unknown as FlowNode[],
      },
      llm,
      hooks: { log: () => {}, executeTool: async () => ({ ok: true, output: JSON.stringify({ message: "slots…", slot_count: 42 }) }) },
    });
    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "my email is a at b dot com" }));
    expect(asked.at(-1)).toContain("email_address");
    expect(asked.at(-1)).not.toContain("message");
    expect(asked.at(-1)).not.toContain("slot_count");
  });

  it("a passed-in email is replaced when the caller says a new one, not when the model guesses", async () => {
    let next: Record<string, VariableValue> = {};
    const { llm } = llmWith(() => next);
    const vm = new ConversationVm({
      flow: {
        start_node_id: "ask",
        nodes: [{ id: "ask", type: "conversation", name: "ask", instruction: { type: "prompt", text: "Confirm {{email_address}}" } }] as FlowNode[],
      },
      llm: { ...llm, classify: async () => -1 },
      variables: { email_address: "nathanpratt1994@icloud.com" },
      hooks: { log: () => {} },
    });
    await drain(vm.run({ type: "begin" }));
    next = { email_address: "someone.else@example.com" };
    await drain(vm.run({ type: "user_utterance", text: "yes that's right" }));
    expect(vm.getVariables().email_address).toBe("nathanpratt1994@icloud.com");
    next = { email_address: "nathanbrett1994@icloud.com" };
    await drain(vm.run({ type: "user_utterance", text: "No, email is nathanbrett1994@icloud.com" }));
    expect(vm.getVariables().email_address).toBe("nathanbrett1994@icloud.com");
  });
});

describe("an answer that does not validate", () => {
  it("is not read back as confirmed when it is what the step asked for", async () => {
    let turn = 0;
    const { llm, prompts } = llmWith(() => (turn++ === 0 ? { email_address: "arjav virani at" } : {}));
    const vm = new ConversationVm({
      flow: {
        start_node_id: "ask",
        nodes: [{ id: "ask", type: "conversation", name: "ask", instruction: { type: "prompt", text: "Ask for {{email_address}}" } }] as FlowNode[],
      },
      llm: { ...llm, classify: async () => -1 },
      variableNames: ["email_address"],
      hooks: { log: () => {} },
    });
    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "it's arjav virani at" }));
    expect(vm.getVariables().email_address ?? "").toBe("");
    expect(prompts.at(-1)!.at(-1)!.content).toMatch(/did not come through as a valid value/);
  });

  it("a bad guess about a field this step is not asking for changes nothing", async () => {
    let turn = 0;
    const { llm, prompts } = llmWith(() => (turn++ === 0 ? { email_address: "junk at" } : {}));
    const vm = new ConversationVm({
      flow: {
        start_node_id: "ask",
        nodes: [{ id: "ask", type: "conversation", name: "ask", instruction: { type: "prompt", text: "Ask what type of property it is" } }] as FlowNode[],
      },
      llm: { ...llm, classify: async () => -1 },
      variableNames: ["email_address"],
      hooks: { log: () => {} },
    });
    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "it's a house, email me at junk" }));
    expect(prompts.at(-1)!.at(-1)!.content).not.toMatch(/did not come through as a valid value/);
  });
});

describe("function step speed", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("starts the tool before the 'one moment' line is spoken, and skips a slow model when required args are known", async () => {
    const order: string[] = [];
    let extractCalls = 0;
    const llm: VmLlm = {
      async generate() { return "line"; },
      async *generateStream() { yield "line"; },
      async classify() { return 0; },
      async extract() {
        extractCalls++;
        await sleep(5_000); // a model that would hold the tool for 5 s
        return {};
      },
    };
    const vm = new ConversationVm({
      flow: {
        start_node_id: "book",
        tools: [
          {
            tool_id: "t",
            name: "book_appointment",
            type: "custom",
            url: "https://example.invalid",
            parameters: { type: "object", required: ["email"], properties: { email: { type: "string" } } },
          },
        ],
        nodes: [
          {
            id: "book", type: "function", name: "book", tool_id: "t", tool_type: "local", wait_for_result: true,
            speak_during_execution: true, execution_message_description: "One moment while I book that in.",
            edges: [{ id: "e", destination_node_id: "done", transition_condition: { type: "prompt", prompt: "" } }],
          },
          { id: "done", type: "conversation", name: "done", instruction: { type: "static_text", text: "Done." } },
        ] as unknown as FlowNode[],
      },
      llm,
      variables: { email: "a@b.com" },
      hooks: {
        log: () => {},
        executeTool: async (inv) => {
          order.push(`tool:${JSON.stringify(inv.args)}`);
          return { ok: true, output: "{}" };
        },
      },
    });
    const t0 = Date.now();
    for await (const d of vm.run({ type: "begin" })) {
      if (d.type === "speak" && d.text?.startsWith("One moment")) order.push("filler");
    }
    expect(extractCalls).toBe(1);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(order[0]).toBe("filler");
    expect(order[1]).toBe('tool:{"email":"a@b.com"}');
  }, 10_000);
});
