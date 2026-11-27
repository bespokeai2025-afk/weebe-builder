import { describe, expect, it } from "vitest";

import { RouteReplyArgumentsParser, resolveRoutingMode } from "@/lib/voice/graph/route-reply.shared";
import { ConversationVm } from "@/lib/voice/graph/vm";
import type { ConversationFlow, LlmMessage, VmDirective, VmLlm } from "@/lib/voice/graph/types";

function feed(parser: RouteReplyArgumentsParser, fragments: string[]) {
  let transition: number | null | undefined;
  let reply = "";
  for (const f of fragments) {
    const got = parser.push(f);
    if (got.transition !== undefined) transition = got.transition;
    if (got.reply) reply += got.reply;
  }
  return { transition, reply };
}

describe("workflow_reply argument parser", () => {
  it("emits the transition as soon as its number is complete, before the reply", () => {
    const p = new RouteReplyArgumentsParser();
    expect(p.push('{"transi').transition).toBeUndefined();
    expect(p.push('tion": 1').transition).toBeUndefined(); // "1" could still become "12"
    expect(p.push("2,").transition).toBe(12);
    expect(p.push(' "reply": "Hel').reply).toBe("Hel");
    expect(p.push('lo there."}').reply).toBe("lo there.");
  });

  it("decodes escapes split across fragments", () => {
    const { reply } = feed(new RouteReplyArgumentsParser(), [
      '{"transition":0,"reply":"It\\',
      "'s \\\"fine\\\" \\u00e9",
      '\\nok"}',
    ]);
    expect(reply).toBe("It's \"fine\" é\nok");
  });

  it("handles a reply that comes before the transition", () => {
    const { transition, reply } = feed(new RouteReplyArgumentsParser(), ['{"reply":"Sure.","transition":3}']);
    expect(transition).toBe(3);
    expect(reply).toBe("Sure.");
  });

  it("reports a non-number transition as null (the VM stays)", () => {
    const { transition } = feed(new RouteReplyArgumentsParser(), ['{"transition":"rented","reply":"x"}']);
    expect(transition).toBeNull();
  });
});

describe("routing mode setting", () => {
  it("uses the agent's setting, then the env, then separate", () => {
    expect(resolveRoutingMode({ webeeRoutingMode: "combined" })).toBe("combined");
    expect(resolveRoutingMode({})).toBe("separate");
  });
});

// ─── VM ───────────────────────────────────────────────────────────────────────

/** Conditions the quick rules cannot decide, so routing reaches the model. */
function flow(): ConversationFlow {
  return {
    start_node_id: "ask",
    nodes: [
      {
        id: "ask",
        type: "conversation",
        name: "Occupancy",
        instruction: { type: "prompt", text: "Ask how the property is currently used." },
        edges: [
          {
            id: "e1",
            destination_node_id: "holiday",
            transition_condition: { type: "prompt", prompt: "Caller describes a holiday let arrangement" },
          },
          {
            id: "e2",
            destination_node_id: "tenancy",
            transition_condition: { type: "prompt", prompt: "Caller describes a long-term tenancy" },
          },
        ],
      },
      {
        id: "holiday",
        type: "conversation",
        name: "Holiday let",
        instruction: { type: "prompt", text: "Ask how many weeks a year it is booked." },
      },
      {
        id: "tenancy",
        type: "conversation",
        name: "Tenancy",
        instruction: { type: "static_text", text: "Thanks. How long is left on the tenancy?" },
      },
    ],
  };
}

function fakeLlm(args: string | Error) {
  const calls = { stream: 0, classify: 0, routeAndReply: [] as LlmMessage[][] };
  const llm: VmLlm = {
    generate: async () => "a generated line",
    async *generateStream() {
      calls.stream++;
      yield "How is the property used at the moment?";
    },
    classify: async () => {
      calls.classify++;
      return 0; // the first option
    },
    extract: async () => ({}),
    routeAndReply(messages) {
      calls.routeAndReply.push(messages);
      if (args instanceof Error) {
        return { transition: Promise.reject(args), reply: (async function* () {})() };
      }
      const m = /"transition"\s*:\s*(-?\d+)/.exec(args);
      const reply = /"reply"\s*:\s*"([^"]*)"/.exec(args)?.[1] ?? "";
      return {
        transition: Promise.resolve(m ? Number(m[1]) : null),
        reply: (async function* () {
          for (const word of reply.split(/(?<= )/)) yield word;
        })(),
      };
    },
  };
  return { llm, calls };
}

async function spoken(gen: AsyncGenerator<VmDirective>): Promise<string[]> {
  const out: string[] = [];
  for await (const d of gen) {
    if (d.type !== "speak") continue;
    if (d.text) out.push(d.text);
    else if (d.textStream) {
      let full = "";
      for await (const c of d.textStream) full += c;
      out.push(full);
    }
  }
  return out;
}

const CALLER = "We let it out on Airbnb most of the year.";

describe("combined route and reply", () => {
  it("routes and speaks from one call — no classifier, no second speech call", async () => {
    const { llm, calls } = fakeLlm('{"transition": 1, "reply": "Lovely. How many weeks a year is it booked?"}');
    const vm = new ConversationVm({ flow: flow(), llm, routingMode: "combined" });
    await spoken(vm.run({ type: "begin" }));
    const streamsBefore = calls.stream;

    const out = await spoken(vm.run({ type: "user_utterance", text: CALLER }));

    expect(vm.nodeId).toBe("holiday");
    expect(out.join(" ")).toContain("How many weeks a year is it booked?");
    expect(calls.classify).toBe(0);
    expect(calls.stream).toBe(streamsBefore); // the reply came from the routing call
    const system = String(calls.routeAndReply[0]![0]!.content);
    expect(system).toContain("Ask how many weeks a year it is booked."); // destination's task
    expect(system).toMatch(/Tenancy" says a fixed line/);
  });

  it("speaks a fixed-text destination as authored, not the model's reply", async () => {
    const { llm } = fakeLlm('{"transition": 2, "reply": "Something the model made up."}');
    const vm = new ConversationVm({ flow: flow(), llm, routingMode: "combined" });
    await spoken(vm.run({ type: "begin" }));
    const out = await spoken(vm.run({ type: "user_utterance", text: CALLER }));
    expect(vm.nodeId).toBe("tenancy");
    expect(out).toEqual(["Thanks. How long is left on the tenancy?"]);
  });

  it("stays on the step when the transition is not an option (fail-closed)", async () => {
    const { llm, calls } = fakeLlm('{"transition": 7, "reply": "x"}');
    const vm = new ConversationVm({ flow: flow(), llm, routingMode: "combined" });
    await spoken(vm.run({ type: "begin" }));
    await spoken(vm.run({ type: "user_utterance", text: CALLER }));
    expect(vm.nodeId).toBe("ask");
    expect(calls.classify).toBe(0);
  });

  it("falls back to the classifier when the call itself fails", async () => {
    const { llm, calls } = fakeLlm(new Error("400 tools not supported"));
    const vm = new ConversationVm({ flow: flow(), llm, routingMode: "combined" });
    await spoken(vm.run({ type: "begin" }));
    await spoken(vm.run({ type: "user_utterance", text: CALLER }));
    expect(calls.classify).toBe(1);
    expect(vm.nodeId).toBe("holiday");
  });

  it("leaves the default (separate) mode exactly as it was", async () => {
    const { llm, calls } = fakeLlm('{"transition": 1, "reply": "x"}');
    const vm = new ConversationVm({ flow: flow(), llm });
    await spoken(vm.run({ type: "begin" }));
    await spoken(vm.run({ type: "user_utterance", text: CALLER }));
    expect(calls.routeAndReply).toHaveLength(0);
    expect(calls.classify).toBe(1);
    expect(vm.nodeId).toBe("holiday");
  });
});
