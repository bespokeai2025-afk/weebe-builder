import { describe, expect, it } from "vitest";

import { ConversationVm } from "@/lib/voice/graph/vm";
import type { ConversationFlow, LlmMessage, VmDirective, VmLlm } from "@/lib/voice/graph/types";
import { missingReadbackTask, withoutMissingReadbacks } from "@/lib/voice/graph/variables.shared";

// The WBAH "last name" step, as authored.
const LAST_NAME_STEP =
  "I have your last name as {{last_name}} is that correct? if last name is not detected please ask. do not as any other questions ";

describe("sentences that read a missing value", () => {
  it("come out of the step's text; everything else stays", () => {
    const { text, dropped } = withoutMissingReadbacks(LAST_NAME_STEP, ["last_name"]);
    expect(text).not.toContain("I have your last name as");
    expect(text).toContain("do not as any other questions");
    expect(dropped).toEqual(["last_name"]);
  });

  it("leave a step alone when nothing is missing", () => {
    expect(withoutMissingReadbacks(LAST_NAME_STEP, [])).toEqual({ text: LAST_NAME_STEP, dropped: [], lines: [] });
  });

  it("are replaced by a task that reads back or asks", () => {
    expect(missingReadbackTask(["last_name"])).toMatch(/confirms the caller's last name, but it is not known yet/);
    expect(missingReadbackTask([])).toBeNull();
  });

  it("keep the line's shape, with what is missing marked, and known values filled", () => {
    const step = "I have your property address as {{property_address_line2}} {{city}} post code {{postcode_property}} \nif variables are not detected please ask for them.";
    const { lines, dropped } = withoutMissingReadbacks(step, ["property_address_line2", "postcode_property"], { city: "Manchester" });
    expect(dropped).toEqual(["property_address_line2", "postcode_property"]);
    expect(lines).toEqual(["I have your property address as «property address line2» Manchester post code «postcode property»"]);
    const task = missingReadbackTask(dropped, lines)!;
    expect(task).toContain("«postcode property»");
    expect(task).toMatch(/never say this line now/);
  });
});

function flow(): ConversationFlow {
  return {
    start_node_id: "title",
    nodes: [
      {
        id: "title",
        type: "conversation",
        name: "Title",
        instruction: { type: "static_text", text: "And what's your preferred title?" },
        edges: [
          {
            id: "e1",
            destination_node_id: "last",
            transition_condition: { type: "prompt", prompt: "user gives title" },
          },
        ],
      },
      {
        id: "last",
        type: "conversation",
        name: "last name",
        instruction: { type: "prompt", text: LAST_NAME_STEP },
      },
    ],
  };
}

function capturingLlm() {
  const prompts: LlmMessage[][] = [];
  const llm: VmLlm = {
    generate: async () => "x",
    async *generateStream(messages) {
      prompts.push(messages);
      yield "Could I take your last name, please?";
    },
    classify: async () => 0,
    extract: async () => ({}),
  };
  return { llm, prompts };
}

async function drain(gen: AsyncGenerator<VmDirective>) {
  for await (const d of gen) {
    if (d.type === "speak" && d.textStream) for await (const _ of d.textStream) void _;
  }
}

describe("last-name readback with no last name (live call 1987c6e0)", () => {
  it("never shows the model the line with a gap in it", async () => {
    const { llm, prompts } = capturingLlm();
    const vm = new ConversationVm({ flow: flow(), llm, variables: { first_name: "Arjo" } });
    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "Mr." }));

    expect(vm.nodeId).toBe("last");
    const all = prompts.at(-1)!.map((m) => String(m.content)).join("\n");
    expect(all).not.toMatch(/last name as\s+is that correct/i);
    // Only ever with the missing value marked, inside the "never say this line now" task.
    expect(all).not.toMatch(/I have your last name as (?!«last name»)/);
    expect(all).not.toMatch(/Script:[^\n]*I have your last name/);
    expect(all).toContain("confirms the caller's last name, but it is not known yet");
  });

  it("still reads the line as written once the last name is known", async () => {
    const { llm, prompts } = capturingLlm();
    const vm = new ConversationVm({ flow: flow(), llm, variables: { first_name: "Arjo", last_name: "Virani" } });
    await drain(vm.run({ type: "begin" }));
    await drain(vm.run({ type: "user_utterance", text: "Mr." }));

    const all = prompts.at(-1)!.map((m) => String(m.content)).join("\n");
    expect(all).toContain("I have your last name as Virani is that correct?");
    expect(all).not.toContain("not known yet");
  });
});
