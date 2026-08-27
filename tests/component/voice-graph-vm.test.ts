import { describe, expect, it } from "vitest";

import { compileFlow, interpolate } from "@/lib/voice/graph/flow";
import { selectEdge, selectGlobalNode, looksLikeGlobalInterrupt } from "@/lib/voice/graph/router";
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
    async *generateStream(messages) {
      calls.generate.push(messages);
      yield overrides.generate?.(messages) ?? "a generated line";
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
  for await (const d of gen) {
    out.push(d);
    // yieldSpeech waits for the consumer to drain textStream before advancing.
    if (d.type === "speak" && d.textStream) {
      for await (const _chunk of d.textStream) {
        /* discard — speech() still reports [streamed] */
      }
    }
  }
  return out;
}

/** Drain directives and consume any streamed speech for assertions. */
async function drainWithSpeech(gen: AsyncGenerator<VmDirective>): Promise<{
  directives: VmDirective[];
  speeches: string[];
}> {
  const directives: VmDirective[] = [];
  const speeches: string[] = [];
  for await (const d of gen) {
    directives.push(d);
    if (d.type !== "speak") continue;
    if (d.text) speeches.push(d.text);
    else if (d.textStream) {
      let full = "";
      for await (const chunk of d.textStream) full = full ? `${full} ${chunk}` : chunk;
      speeches.push(full.trim());
    }
  }
  return { directives, speeches };
}

const speech = (ds: VmDirective[]) =>
  ds
    .filter((d): d is Extract<VmDirective, { type: "speak" }> => d.type === "speak")
    .map((d) => d.text ?? "[streamed]");
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

function edge(
  id: string,
  to: string,
  prompt = "",
  type: "prompt" | "equation" = "prompt",
): NonNullable<FlowNode["edges"]>[number] {
  return { id, destination_node_id: to, transition_condition: { type, prompt } };
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

    const dangling =
      compiled.nodes.get("a")?.always_edge ?? compiled.nodes.get("a")?.edges?.[0];
    expect(dangling?.destination_node_id).toBeUndefined();
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

    expect(chosen.edge?.destination_node_id).toBe("next");
    expect(chosen.method).toBe("unconditional");
    expect(llm.calls.classify).toHaveLength(0);
  });

  it("ignores edges with no destination", async () => {
    const llm = fakeLlm();
    const stub = { id: "e1", transition_condition: { type: "prompt" as const, prompt: "failed" } };

    expect((await selectEdge([stub], ctx, llm)).edge).toBeNull();
  });

  it("returns null when the classifier says nothing applies", async () => {
    const llm = fakeLlm({ classify: () => -1 });

    expect((await selectEdge([edge("e1", "a", "yes"), edge("e2", "b", "no")], ctx, llm)).edge).toBeNull();
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
    expect(chosen.edge?.destination_node_id).toBe("b");
  });

  it("routes obvious yes/no without a classifier call", async () => {
    const llm = fakeLlm();
    const yesCtx = {
      history: [{ role: "user" as const, content: "Yes." }],
      variables: {},
      globalPrompt: "",
    };
    const chosen = await selectEdge(
      [edge("e1", "yes-node", "user says yes or confirms"), edge("e2", "no-node", "user says no")],
      yesCtx,
      llm,
    );

    expect(chosen.edge?.destination_node_id).toBe("yes-node");
    expect(chosen.method).toBe("heuristic");
    expect(llm.calls.classify).toHaveLength(0);
  });

  it("routes equation edges without a classifier call", async () => {
    const llm = fakeLlm();
    const ctx = {
      history: [{ role: "user" as const, content: "Botox please" }],
      variables: { appointment_type: "botox" },
      globalPrompt: "",
    };
    const chosen = await selectEdge(
      [
        edge("e1", "botox-node", '{{appointment_type}} == "botox"', "equation"),
        edge("e2", "other-node", '{{appointment_type}} == "consultation"', "equation"),
      ],
      ctx,
      llm,
    );

    expect(chosen.edge?.destination_node_id).toBe("botox-node");
    expect(chosen.method).toBe("equation");
    expect(llm.calls.classify).toHaveLength(0);
  });

  it("routes yes to the edge that matches the question just asked", async () => {
    const llm = fakeLlm({ classify: () => -1 });
    const chosen = await selectEdge(
      [
        edge("e1", "same", "User confirms their name matches the property documents"),
        edge("e2", "diff", "User says the name on the documents is different"),
      ],
      {
        history: [
          {
            role: "assistant",
            content: "Great, is your name the same as on the property documents?",
          },
          { role: "user", content: "Yes." },
        ],
        variables: {},
        globalPrompt: "",
      },
      llm,
    );
    expect(chosen.edge?.destination_node_id).toBe("same");
    expect(llm.calls.classify).toHaveLength(0);
  });
});

describe("selectGlobalNode fast path", () => {
  it("skips the classifier for normal replies like yes or a name", async () => {
    const llm = fakeLlm();
    const globals = [{ condition: "caller asks for a human", node: { id: "human" } }];
    const ctx = {
      history: [{ role: "user" as const, content: "Yes" }],
      variables: {},
      globalPrompt: "",
    };

    expect(looksLikeGlobalInterrupt("Yes")).toBe(false);
    expect((await selectGlobalNode(globals, ctx, llm)).hit).toBeNull();
    expect(llm.calls.classify).toHaveLength(0);
  });

  it("routes human interrupt via heuristic without classifier", async () => {
    const llm = fakeLlm({
      classify: (_m, choices) => choices.findIndex((c) => c.includes("human")),
    });
    const globals = [{ condition: "caller asks for a human", node: { id: "human" } }];
    const ctx = {
      history: [{ role: "user" as const, content: "I need to speak to a human" }],
      variables: {},
      globalPrompt: "",
    };

    expect(looksLikeGlobalInterrupt("I need to speak to a human")).toBe(true);
    const hit = await selectGlobalNode(globals, ctx, llm);
    expect(hit.hit?.node.id).toBe("human");
    expect(hit.method).toBe("global_heuristic");
    expect(llm.calls.classify).toHaveLength(0);
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
    const out = await drainWithSpeech(vm.run({ type: "begin" }));

    expect(out.speeches).toEqual(["Sure, I can help with that."]);
    const system = llm.calls.generate[0][0].content;
    expect(system).toContain("Ask why they are calling");
    expect(system).toContain("ONLY the next words to speak");
  });

  it("does not dump unused CRM fields into the speech prompt", async () => {
    const llm = fakeLlm({ generate: () => "Is this a house or a flat?" });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask what type of property it is." },
          edges: [],
        },
      ]),
      llm,
      variables: {
        first_name: "Steven",
        last_name: "Pearce",
        email: "steviepiow@gmail.com",
      },
    });
    await drainWithSpeech(vm.run({ type: "begin" }));

    const system = llm.calls.generate[0][0].content;
    expect(system).not.toContain("Steven");
    expect(system).not.toContain("Pearce");
    expect(system).not.toContain("# Known information");
    expect(system).toContain("that's all you need");
  });

  it("includes only CRM fields this turn's script actually reads", async () => {
    const llm = fakeLlm({ generate: () => "Hello Steven, is that right?" });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: {
            type: "prompt",
            text: "Ask the caller to confirm the name {{first_name}}.",
          },
          edges: [],
        },
      ]),
      llm,
      variables: {
        first_name: "Steven",
        last_name: "Pearce",
        email: "steviepiow@gmail.com",
      },
    });
    await drainWithSpeech(vm.run({ type: "begin" }));

    const system = llm.calls.generate[0][0].content;
    expect(system).toContain("first_name=Steven");
    expect(system).toContain("Task (do not read aloud)");
    expect(system).not.toContain("Speak the script");
    expect(system).not.toContain("Pearce");
    expect(system).not.toContain("steviepiow");
  });

  it("does not speak generic Ask-task node text if the model echoes it", async () => {
    const llm = fakeLlm({ generate: () => "Ask the preferred title" });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: {
            type: "prompt",
            text: "Ask the preferred title\nMr, Mrs, Miss, Ms, Dr",
          },
          edges: [],
        },
      ]),
      llm,
    });
    const out = await drainWithSpeech(vm.run({ type: "begin" }));
    expect(out.speeches.join(" ")).toBe("What's your preferred title?");
    const system = llm.calls.generate[0][0].content;
    expect(system).toContain("Task (do not read aloud)");
    expect(system).not.toMatch(/Script:\nAsk the preferred title/);
  });

  it("speaks static_text nodes verbatim and generates prompt nodes", async () => {
    const llm = fakeLlm({
      generate: () => "What's your postcode?",
    });
    const staticVm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: {
            type: "static_text",
            text: "Can I take your postcode?\nDo not ask any other questions.",
          },
          edges: [],
        },
      ]),
      llm,
    });
    const staticOut = await drainWithSpeech(staticVm.run({ type: "begin" }));
    expect(staticOut.speeches).toEqual(["Can I take your postcode?"]);
    expect(llm.calls.generate).toHaveLength(0);

    const promptVm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: {
            type: "prompt",
            text: "Ask the preferred title",
          },
          edges: [],
        },
      ]),
      llm,
    });
    const promptOut = await drainWithSpeech(promptVm.run({ type: "begin" }));
    expect(promptOut.speeches.join(" ")).toBe("What's your postcode?");
    expect(llm.calls.generate.length).toBeGreaterThan(0);
  });

  it("speaks the node fallback when the speech model yields no content", async () => {
    const llm = fakeLlm({ generate: () => "" });
    llm.generateStream = async function* () {
      /* gpt-oss spent the budget on reasoning */
    };
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask the preferred title" },
          edges: [],
        },
      ]),
      llm,
    });
    const out = await drainWithSpeech(vm.run({ type: "begin" }));
    expect(out.speeches.join(" ")).toBe("What's your preferred title?");
    expect(out.directives.some((d) => d.type === "await_user")).toBe(true);
  });

  it("replaces a wrap-up line with a spoken question on a generic Ask node", async () => {
    const llm = fakeLlm({
      generate: () =>
        "Thank you. That's all I need for now. If you have any questions before your consultation, please let us know.",
    });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask what type of property it is." },
          edges: [],
        },
      ]),
      llm,
    });
    const out = await drainWithSpeech(vm.run({ type: "begin" }));
    expect(out.speeches.join(" ")).toContain("What type of property is it?");
    expect(out.speeches.join(" ")).not.toMatch(/that's all I need/i);
    expect(out.speeches.join(" ")).not.toMatch(/^Ask /);
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

  it("waits silently on prompt nodes when routing misses instead of improvising", async () => {
    const llm = fakeLlm({
      classify: () => -1,
      generate: () => "What is the property address?",
    });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask for the property address only." },
          edges: [edge("e1", "done", "gave an address")],
        },
        say("done", "Thanks"),
      ]),
      llm,
    });

    await drainWithSpeech(vm.run({ type: "begin" }));
    const first = await drainWithSpeech(vm.run({ type: "user_utterance", text: "maybe later" }));
    expect(first.speeches).toEqual([]);
    expect(first.directives.some((d) => d.type === "await_user")).toBe(true);
    const second = await drain(vm.run({ type: "user_utterance", text: "still thinking" }));
    expect(speech(second)).toEqual([]);
    expect(second.some((d) => d.type === "await_user")).toBe(true);
    expect(vm.nodeId).toBe("ask");
  });

  it("skips the floor question when the caller said house", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("type", "Is it a house, flat, or bungalow?", [
          edge("e1", "floor", "caller gave the property type"),
        ]),
        say("floor", "Which floor is it on?", [edge("e2", "tenure", "user answers")]),
        say("tenure", "Is it vacant or rented?"),
      ]),
      llm: fakeLlm(),
    });

    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "House" }));
    expect(speech(out)).toEqual(["Is it vacant or rented?"]);
    expect(vm.nodeId).toBe("tenure");
  });

  it("clarifies a vacant/rented mishear instead of leaving the node", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("tenure", "Is the property currently vacant or rented?", [
          edge("e1", "next", "user said vacant"),
          edge("e2", "rent", "user said rented"),
        ]),
        say("next", "Thanks"),
        say("rent", "Rented ok"),
      ]),
      llm: fakeLlm({ classify: () => -1 }),
    });

    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "It is weekend." }));
    expect(speech(out).join(" ")).toMatch(/vacant/i);
    expect(vm.nodeId).toBe("tenure");
  });

  it("follows skip_response without waiting for the caller", async () => {
    const intro: FlowNode = {
      ...say("intro", "Here is a disclaimer."),
      skip_response_edge: edge("skip", "ask", "Skip response"),
    };
    const vm = new ConversationVm({
      flow: flowOf([intro, say("ask", "What is your name?")]),
      llm: fakeLlm(),
    });
    const out = await drain(vm.run({ type: "begin" }));
    expect(speech(out)).toEqual(["Here is a disclaimer.", "What is your name?"]);
    expect(vm.nodeId).toBe("ask");
  });

  it("follows a conversation else edge when no prompt matches", async () => {
    const ask: FlowNode = {
      ...say("ask", "Anything else?", [edge("e1", "more", "caller wants to add more")]),
      else_edge: edge("else", "done", "Else"),
    };
    const vm = new ConversationVm({
      flow: flowOf([ask, say("more", "Go on"), say("done", "Moving on")]),
      llm: fakeLlm({ classify: () => -1 }),
    });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "That's it." }));
    expect(speech(out)).toEqual(["Moving on"]);
    expect(vm.nodeId).toBe("done");
  });

  it("starts else-path speech before the classifier returns", async () => {
    const order: string[] = [];
    let streamCalls = 0;
    const llm: VmLlm = {
      async generate() {
        return "Next question.";
      },
      async *generateStream() {
        streamCalls += 1;
        order.push("stream");
        yield "Next question.";
      },
      async classify() {
        await new Promise((r) => setTimeout(r, 25));
        order.push("classify");
        return -1;
      },
      async extract() {
        return {};
      },
    };
    const ask: FlowNode = {
      id: "ask",
      type: "conversation",
      instruction: { type: "prompt", text: "Ask if they want to add more." },
      edges: [edge("e1", "more", "caller wants to add more details about zebras")],
      else_edge: edge("else", "done", "Else"),
    };
    const done: FlowNode = {
      id: "done",
      type: "conversation",
      instruction: { type: "prompt", text: "Ask for the postcode." },
    };
    const vm = new ConversationVm({
      flow: flowOf([ask, say("more", "Go on"), done]),
      llm,
    });
    await drainWithSpeech(vm.run({ type: "begin" }));
    const out = await drainWithSpeech(
      vm.run({ type: "user_utterance", text: "That's all thanks." }),
    );
    expect(order[0]).toBe("stream");
    expect(order).toContain("classify");
    expect(out.speeches.join(" ")).toContain("Next question");
    expect(vm.nodeId).toBe("done");
    // begin + raced dest — dest must reuse the in-flight stream, not start a third.
    expect(streamCalls).toBe(2);
  });

  it("reuses speculative speech started before the final transcript", async () => {
    let streamCalls = 0;
    const llm: VmLlm = {
      async generate() {
        return "What type of property is it?";
      },
      async *generateStream() {
        streamCalls += 1;
        yield "What type of property is it?";
      },
      async classify() {
        return 0;
      },
      async extract() {
        return {};
      },
    };
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask for the postcode." },
          edges: [edge("e1", "next", "user gave a postcode")],
        },
        {
          id: "next",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask for the property type." },
        },
      ]),
      llm,
    });
    await drainWithSpeech(vm.run({ type: "begin" }));
    vm.setSpeculativeSpeech("next", {
      partial: "SW1A 1AA",
      ctrl: new AbortController(),
      tokens: ["What type of property is it?"],
      done: Promise.resolve("What type of property is it?"),
    });
    const out = await drainWithSpeech(vm.run({ type: "user_utterance", text: "SW1A 1AA" }));
    expect(out.speeches.join(" ")).toContain("What type of property is it");
    expect(vm.nodeId).toBe("next");
    expect(streamCalls).toBe(1);
  });

  it("replays the last spoken line when the caller says what", async () => {
    const vm = new ConversationVm({
      flow: flowOf([
        say("ask", "Can I have your postcode?", [edge("e1", "next", "user gave a postcode")]),
        say("next", "Thanks"),
      ]),
      llm: fakeLlm({ classify: () => 0 }),
    });
    await drain(vm.run({ type: "begin" }));
    const out = await drain(vm.run({ type: "user_utterance", text: "What?" }));
    expect(speech(out)).toEqual(["Can I have your postcode?"]);
    expect(vm.nodeId).toBe("ask");
  });

  it("routes spelled-out phone numbers without waiting for the LLM classifier", async () => {
    const llm = fakeLlm({
      classify: () => {
        throw new Error("classifier should not run");
      },
      generate: () => "Thanks, noted your number.",
    });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask_phone",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask for contact number." },
          edges: [edge("e1", "next", "caller provides phone number or contact number")],
        },
        say("next", "What is your email?"),
      ]),
      llm,
    });

    await drainWithSpeech(vm.run({ type: "begin" }));
    const out = await drainWithSpeech(
      vm.run({
        type: "user_utterance",
        text: "Double nine six four nine one nine triple zero.",
      }),
    );

    expect(out.speeches).toEqual(["What is your email?"]);
    expect(vm.nodeId).toBe("next");
    expect(llm.calls.classify).toHaveLength(0);
  });

  it("routes substantive address replies via heuristics without classifier or ack filler", async () => {
    const llm = fakeLlm({
      classify: () => -1,
      generate: () => "Got it, thanks for that.",
    });
    const vm = new ConversationVm({
      flow: flowOf([
        {
          id: "ask",
          type: "conversation",
          instruction: { type: "prompt", text: "Ask for the property address only." },
          edges: [edge("e1", "done", "gave an exact street address")],
        },
        say("done", "Thanks"),
      ]),
      llm,
    });

    await drainWithSpeech(vm.run({ type: "begin" }));
    const out = await drainWithSpeech(
      vm.run({ type: "user_utterance", text: "Ten Upping Street London" }),
    );

    expect(out.speeches).toEqual(["Thanks"]);
    expect(vm.nodeId).toBe("done");
    expect(llm.calls.classify).toHaveLength(0);
    // Opening prompt node may generate once; no extra ack filler on stay-put routing miss.
    expect(llm.calls.generate.length).toBeLessThanOrEqual(1);
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
