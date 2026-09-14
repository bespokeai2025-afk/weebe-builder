import { describe, expect, it } from "vitest";
import { ConversationVm } from "@/lib/voice/graph/vm";
import type { VmDirective } from "@/lib/voice/graph/types";

/**
 * End-to-end check of the Extract Variable node on WEBEE Native: the declared
 * variables must reach the extractor, the extracted values must land in the
 * VM's variable bag (so later {{interpolation}} sees them), and they must be
 * emitted as a `variables` directive so the session can report them on the
 * webhook as collected_dynamic_variables.
 */
async function drain(gen: AsyncGenerator<VmDirective>): Promise<VmDirective[]> {
  const out: VmDirective[] = [];
  for await (const d of gen) {
    out.push(d);
    if (d.type === "speak" && d.textStream) {
      for await (const _chunk of d.textStream) {
        /* discard */
      }
    }
  }
  return out;
}

function llmWith(extracted: Record<string, unknown>) {
  const seen: Array<Array<{ name: string }>> = [];
  return {
    seen,
    llm: {
      async generate() {
        return "ok";
      },
      async *generateStream() {
        yield "ok";
      },
      async classify() {
        return 0;
      },
      async extract(_messages: unknown, fields: Array<{ name: string }>) {
        seen.push(fields);
        return extracted;
      },
    },
  };
}

const FLOW = {
  start_node_id: "grab",
  nodes: [
    {
      id: "grab",
      type: "extract_dynamic_variables",
      instruction: {
        type: "prompt",
        text: "The caller has confirmed their contact address matches the property. Set it to true.",
      },
      variables: [
        {
          name: "contact_same_as_property",
          description: "Whether the contact address matches the property address.",
          type: "boolean",
        },
      ],
      edges: [],
    },
    {
      id: "after",
      type: "conversation",
      instruction: { type: "static_text", text: "Recorded {{contact_same_as_property}}." },
    },
  ],
};

describe("extract_dynamic_variables node", () => {
  it("passes the declared variables to the extractor", async () => {
    const { seen, llm } = llmWith({ contact_same_as_property: true });
    const vm = new ConversationVm({ flow: FLOW as never, llm: llm as never });
    await drain(vm.run({ type: "begin" }));

    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((f) => f.name)).toEqual(["contact_same_as_property"]);
  });

  it("emits extracted values as a variables directive", async () => {
    const { llm } = llmWith({ contact_same_as_property: true });
    const vm = new ConversationVm({ flow: FLOW as never, llm: llm as never });
    const directives = await drain(vm.run({ type: "begin" }));

    const varsDirective = directives.find((d) => d.type === "variables");
    expect(varsDirective).toBeDefined();
    expect((varsDirective as { values: Record<string, unknown> }).values).toMatchObject({
      contact_same_as_property: true,
    });
  });

  it("stores extracted values so later nodes can interpolate them", async () => {
    const { llm } = llmWith({ contact_same_as_property: true });
    const vm = new ConversationVm({ flow: FLOW as never, llm: llm as never });
    await drain(vm.run({ type: "begin" }));

    expect(vm.getVariables()).toMatchObject({ contact_same_as_property: true });
  });

  it("does not fail the call when extraction returns nothing", async () => {
    const { llm } = llmWith({});
    const vm = new ConversationVm({ flow: FLOW as never, llm: llm as never });
    const directives = await drain(vm.run({ type: "begin" }));

    expect(directives.find((d) => d.type === "variables")).toBeUndefined();
    expect(vm.getVariables().contact_same_as_property).toBeUndefined();
  });
});
