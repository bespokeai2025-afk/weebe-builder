import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { compileFlow } from "@/lib/voice/graph/flow";
import { ConversationVm } from "@/lib/voice/graph/vm";
import { tryHeuristicEdgeIndex } from "@/lib/voice/graph/router";

const templateLibrary = JSON.parse(
  readFileSync("attached_assets/global_templates_1780815063937.json", "utf8"),
) as Array<{
  name?: string;
  settings: Record<string, unknown>;
  flow_data: { nodes: unknown[]; edges: unknown[] };
  variables?: unknown[];
}>;

const leadGenTemplate = templateLibrary.find(
  (template) => template.name === "Real Estate - Lead Generation",
);
if (!leadGenTemplate) throw new Error("Lead Gen Seller template is missing from the template library");

function loadLeadGenFlow() {
  const agent = exportAgentJson(
    leadGenTemplate.flow_data.nodes as never[],
    leadGenTemplate.flow_data.edges as never[],
    leadGenTemplate.settings as never,
    (leadGenTemplate.variables ?? []) as never[],
  );
  return agent.conversationFlow;
}

describe("Lead Gen Seller routing", () => {
  it("does not send a plain name to the wrong-name edge on the start node", () => {
    const cf = loadLeadGenFlow();
    const start = cf.nodes.find((n) => n.id === cf.start_node_id)!;
    const conditions = start.edges!.map((e) => e.transition_condition.prompt.trim());
    const idx = tryHeuristicEdgeIndex(conditions, "aarajava");
    expect(conditions[idx!]).toBe("user answers");
  });

  it("advances the start node when the caller gives a spelled-out phone number", () => {
    const cf = loadLeadGenFlow();
    const start = cf.nodes.find((n) => n.id === cf.start_node_id)!;
    const conditions = start.edges!.map((e) => e.transition_condition.prompt.trim());
    const idx = tryHeuristicEdgeIndex(
      conditions,
      "Double nine six four nine one nine triple zero.",
    );
    expect(conditions[idx!]).toBe("user answers");
  });

  it("ignores placeholder global node conditions from the Retell template", () => {
    const cf = loadLeadGenFlow();
    const compiled = compileFlow(cf);
    expect(
      compiled.globalNodes.some((g) => g.condition.includes("Describe the condition")),
    ).toBe(false);
  });

  it("routes to Nathan node and speaks the pitch script without waiting on the LLM", async () => {
    const cf = loadLeadGenFlow();
    const llm = {
      async generate() {
        return "Hi, this is Nathan from Mister G Realty — got thirty seconds?";
      },
      async *generateStream() {
        yield "Hi, this is Nathan from Mister G Realty — got thirty seconds?";
      },
      async classify(_messages: unknown[], choices: string[]) {
        const answers = choices.findIndex((c) => /\buser answers?\b/i.test(c));
        return answers >= 0 ? answers : 0;
      },
      async extract() {
        return {};
      },
    };

    const vm = new ConversationVm({ flow: cf, llm, variables: {} });
    const spoken: string[] = [];
    async function drain(input: Parameters<ConversationVm["run"]>[0]) {
      for await (const d of vm.run(input)) {
        if (d.type !== "speak") continue;
        if (d.text) spoken.push(d.text);
        if (d.textStream) {
          let full = "";
          for await (const chunk of d.textStream) {
            full += chunk;
          }
          if (full.trim()) spoken.push(full.trim());
        }
      }
    }

    await drain({ type: "begin" });
    await drain({ type: "user_utterance", text: "aarajo" });

    expect(vm.nodeId).toBe("node-1754206861810");
    const line = spoken.join(" ");
    expect(line).toMatch(/nathan/i);
    expect(line).toMatch(/Mister G realty/i);
  });

  it("runs start → name → phone without stalling", async () => {
    const cf = loadLeadGenFlow();
    const llm = {
      async generate() {
        return "May I know your contact number?";
      },
      async *generateStream() {
        yield "May I know your contact number?";
      },
      async classify(_messages: unknown[], choices: string[]) {
        const answers = choices.findIndex((c) => /\buser answers?\b/i.test(c));
        return answers >= 0 ? answers : 0;
      },
      async extract() {
        return {};
      },
    };

    const vm = new ConversationVm({ flow: cf, llm, variables: {} });

    async function speech(input: Parameters<ConversationVm["run"]>[0]) {
      const texts: string[] = [];
      for await (const d of vm.run(input)) {
        if (d.type !== "speak") continue;
        if (d.text) texts.push(d.text);
        else if (d.textStream) {
          let full = "";
          for await (const chunk of d.textStream) full += chunk;
          texts.push(full.trim());
        }
      }
      return texts;
    }

    await speech({ type: "begin" });
    expect(vm.nodeId).toBe(cf.start_node_id);

    await speech({ type: "user_utterance", text: "aarajava" });
    expect(vm.nodeId).not.toBe(cf.start_node_id);

    const afterPhone = await speech({
      type: "user_utterance",
      text: "Double nine six four nine one nine triple zero.",
    });
    expect(afterPhone.length).toBeGreaterThan(0);
    expect(vm.isEnded).toBe(false);
  });
});
