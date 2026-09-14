import { describe, expect, it } from "vitest";
import { ConversationVm } from "@/lib/voice/graph/vm";
import { interpolate, interpolateStaticSpeech } from "@/lib/voice/graph/flow";
import { resolveVariables, renderVariableValue } from "@/lib/voice/graph/variables.shared";
import type { VmDirective } from "@/lib/voice/graph/types";

async function drain(gen: AsyncGenerator<VmDirective>): Promise<VmDirective[]> {
  const out: VmDirective[] = [];
  for await (const d of gen) {
    out.push(d);
    if (d.type === "speak" && d.textStream) {
      for await (const _c of d.textStream) {
        /* discard */
      }
    }
  }
  return out;
}

function spoken(directives: VmDirective[]): string[] {
  return directives
    .filter((d): d is Extract<VmDirective, { type: "speak" }> => d.type === "speak")
    .map((d) => d.text ?? "")
    .filter(Boolean);
}

const fakeLlm = {
  async generate() {
    return "generated";
  },
  async *generateStream() {
    yield "generated";
  },
  async classify() {
    return 0;
  },
  async extract() {
    return {};
  },
};

describe("static node variable resolution", () => {
  it("1. speaks a static node with no variables unchanged", () => {
    expect(interpolateStaticSpeech("Thanks for taking my call.", {})).toBe(
      "Thanks for taking my call.",
    );
  });

  it("2. resolves a single variable", () => {
    expect(interpolateStaticSpeech("Hi {{customer_name}}.", { customer_name: "John" })).toBe(
      "Hi John.",
    );
  });

  it("3. resolves multiple variables in one sentence", () => {
    const out = interpolateStaticSpeech(
      "Hi {{customer_name}}, I'm calling about your property at {{property_address}}.",
      { customer_name: "John", property_address: "25 London Road" },
    );
    expect(out).toBe("Hi John, I'm calling about your property at 25 London Road.");
  });

  it("6. does not crash or speak braces when a variable is missing", () => {
    const out = interpolateStaticSpeech("Hi {{customer_name}}, about {{missing_thing}}.", {
      customer_name: "John",
    });
    expect(out).not.toContain("{{");
    expect(out).toContain("John");
  });
});

describe("prompt node variable resolution", () => {
  it("4. resolves variables before the prompt reaches the LLM", () => {
    const out = interpolate(
      "You are speaking with {{customer_name}}. The property is {{property_address}}.",
      { customer_name: "John", property_address: "25 London Road" },
    );
    expect(out).toContain("John");
    expect(out).toContain("25 London Road");
    expect(out).not.toContain("{{");
  });
});

describe("5. nested variables", () => {
  it("resolves dotted paths for speech and prompts alike", () => {
    const vars = { customer: { name: "John", phone: "0700 900 123" } } as never;
    expect(interpolateStaticSpeech("Hi {{customer.name}}.", vars)).toBe("Hi John.");
    expect(interpolate("Call {{customer.phone}}.", vars)).toContain("0700 900 123");
  });
});

describe("8. API/workflow variables that are not scalars", () => {
  const slots = [
    { date: "Monday", time: "2 PM" },
    { date: "Tuesday", time: "3 PM" },
  ] as never;

  it("renders an array of objects readably for speech instead of [object Object]", () => {
    const out = interpolateStaticSpeech("We have {{available_slots}}.", {
      available_slots: slots,
    });
    expect(out).not.toContain("[object Object]");
    expect(out).toContain("Monday 2 PM");
    expect(out).toContain("Tuesday 3 PM");
  });

  it("gives the LLM the structure as JSON so it can reason over it", () => {
    const out = interpolate("Slots: {{available_slots}}", { available_slots: slots });
    expect(out).toContain('"date":"Monday"');
    expect(out).not.toContain("[object Object]");
  });

  it("joins a scalar array into natural speech", () => {
    expect(renderVariableValue(["Monday", "Tuesday", "Friday"], "speech")).toBe(
      "Monday, Tuesday and Friday",
    );
  });
});

describe("14. edge cases never crash the session", () => {
  it("handles null, empty, zero, false and special characters", () => {
    const vars = {
      nothing: null,
      blank: "",
      count: 0,
      flag: false,
      odd: "R&D <quotes> 100%",
    } as never;
    expect(() => resolveVariables("{{nothing}}{{blank}}{{count}}{{flag}}{{odd}}", vars)).not.toThrow();
    // Zero and false are real values, not "missing".
    expect(resolveVariables("{{count}}", vars, { stripUnresolved: true })).toBe("0");
    expect(resolveVariables("{{flag}}", vars, { stripUnresolved: true })).toBe("false");
    expect(resolveVariables("{{odd}}", vars, { stripUnresolved: true })).toBe("R&D <quotes> 100%");
  });

  it("leaves an empty string rather than throwing on a deep missing path", () => {
    expect(resolveVariables("{{a.b.c.d}}", {}, { stripUnresolved: true })).toBe("");
  });
});

describe("7 & 10. runtime updates across nodes", () => {
  const template = "Perfect, I'll book you for {{appointment_date}} at {{appointment_time}}.";

  function twoNodeFlow() {
    return {
      start_node_id: "greet",
      nodes: [
        {
          id: "greet",
          type: "conversation",
          instruction: { type: "static_text", text: "Hi {{customer_name}}." },
          edges: [
            {
              id: "to-confirm",
              destination_node_id: "confirm",
              transition_condition: { type: "prompt", prompt: "always" },
            },
          ],
        },
        {
          id: "confirm",
          type: "conversation",
          instruction: { type: "static_text", text: template },
        },
      ],
    };
  }

  it("resolves each node against the latest context, and never mutates the template", async () => {
    const flow = twoNodeFlow();
    const vm = new ConversationVm({
      flow: flow as never,
      llm: fakeLlm as never,
      variables: { customer_name: "John" },
    });

    expect(spoken(await drain(vm.run({ type: "begin" })))[0]).toBe("Hi John.");

    // A tool result / extraction lands mid-call, from outside the graph.
    vm.setVariables({ appointment_date: "tomorrow", appointment_time: "3 PM" });

    const next = spoken(await drain(vm.run({ type: "user_utterance", text: "Tomorrow at 3 PM." })));
    expect(next.join(" ")).toContain("Perfect, I'll book you for tomorrow at 3 PM.");

    // 11/15. The stored template is untouched — only the spoken text resolved.
    expect(flow.nodes[1]!.instruction!.text).toBe(template);
    expect(vm.getVariables().appointment_time).toBe("3 PM");
  });

  it("9. uses the same variable correctly in more than one node", async () => {
    const flow = twoNodeFlow();
    flow.nodes[1]!.instruction!.text = "Thanks {{customer_name}}, all done.";
    const vm = new ConversationVm({
      flow: flow as never,
      llm: fakeLlm as never,
      variables: { customer_name: "John" },
    });

    expect(spoken(await drain(vm.run({ type: "begin" })))[0]).toBe("Hi John.");
    const next = spoken(await drain(vm.run({ type: "user_utterance", text: "ok" })));
    expect(next.join(" ")).toContain("Thanks John, all done.");
  });

  it("a later write wins for the same variable name", async () => {
    const vm = new ConversationVm({
      flow: twoNodeFlow() as never,
      llm: fakeLlm as never,
      variables: { customer_name: "John" },
    });
    vm.setVariables({ appointment_time: "2 PM" });
    vm.setVariables({ appointment_time: "3 PM" });
    expect(vm.getVariables().appointment_time).toBe("3 PM");
  });
});
