/**
 * Adding a node kind starts in the registry. This suite is the checklist that keeps the rest of the
 * builder honest about it: every registered kind must export to a typed flow node, come back as
 * the same kind on re-import, and own its import type names without clashing with another kind.
 */
import { describe, expect, it } from "vitest";
import { NODE_REGISTRY, allNodeKinds, defaultNodeData, importTypeMap } from "@/lib/builder/node-registry";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import type { BuilderSettings, FlowNode } from "@/lib/builder/types";

const settings = {
  agentName: "Registry test",
  globalPrompt: "",
  beginMessage: "",
  model: "gpt-4.1",
  voiceId: "11labs-Adrian",
  language: "en-US",
  temperature: 0.3,
} as BuilderSettings;

/** Minimal fields a kind needs to export at all. */
const FILL: Partial<Record<string, Record<string, unknown>>> = {
  call_transfer: { transferNumber: "+14155550100" },
  extract_variable: { extractVariables: [{ id: "v1", name: "x", description: "x", type: "string" }] },
  http_request: { httpUrl: "https://example.com" },
  mcp: { mcpServerUrl: "https://example.com", mcpToolName: "t" },
  function: { toolId: "tool_x" },
};

describe("node registry", () => {
  it("registers each kind once", () => {
    const kinds = allNodeKinds();
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("gives every import type name to exactly one kind", () => {
    const seen = new Map<string, string>();
    for (const def of NODE_REGISTRY) {
      for (const t of def.importTypes ?? []) {
        expect(seen.get(t), `"${t}" claimed by ${seen.get(t)} and ${def.kind}`).toBeUndefined();
        seen.set(t, def.kind);
      }
    }
    expect(Object.keys(importTypeMap()).length).toBe(seen.size);
  });

  for (const def of NODE_REGISTRY) {
    if (def.kind === "note") continue; // annotations are not exported
    it(`${def.kind}: exports to a typed node and re-imports as the same kind`, () => {
      const node: FlowNode = {
        id: `n_${def.kind}`,
        type: "flowNode",
        position: { x: 0, y: 0 },
        data: { ...defaultNodeData(def.kind), isStart: true, ...(FILL[def.kind] ?? {}) },
      };
      const exported = exportAgentJson([node], [], settings) as {
        conversationFlow: { nodes: Array<Record<string, unknown>> };
      };
      const out = exported.conversationFlow.nodes.find((n) => n.id === node.id);
      expect(out, `${def.kind} was dropped on export`).toBeDefined();
      expect(typeof out!.type).toBe("string");

      const back = importAgentJson(JSON.stringify(exported));
      expect(back.nodes.find((n) => n.id === node.id)?.data.kind).toBe(def.kind);
    });
  }
});

describe("unknown imported node types", () => {
  it("keep their original type through import and export instead of becoming conversation nodes", () => {
    const flow = {
      conversationFlow: {
        start_node_id: "a",
        nodes: [
          { id: "a", type: "conversation", name: "Start", instruction: { type: "prompt", text: "Hi" }, edges: [{ id: "e1", destination_node_id: "b", transition_condition: { type: "prompt", prompt: "ok" } }] },
          { id: "b", type: "future_widget", name: "Mystery", widget_config: { level: 3 } },
        ],
      },
    };
    const imported = importAgentJson(JSON.stringify(flow));
    expect(imported.warnings.some((w) => w.includes("future_widget"))).toBe(true);
    const mystery = imported.nodes.find((n) => n.id === "b")!;
    expect(mystery.data.unsupportedType).toBe("future_widget");

    const exported = exportAgentJson(imported.nodes, imported.edges, settings) as {
      conversationFlow: { nodes: Array<Record<string, unknown>> };
    };
    const out = exported.conversationFlow.nodes.find((n) => n.id === "b")!;
    expect(out.type).toBe("future_widget");
    expect(out.widget_config).toEqual({ level: 3 });
  });
});

describe("registry-declared fields", () => {
  it("validates required fields from the registry, not hand-written checks", async () => {
    const { validateFlow } = await import("@/lib/builder/validate");
    const node: FlowNode = {
      id: "m",
      type: "flowNode",
      position: { x: 0, y: 0 },
      data: { ...defaultNodeData("mcp"), isStart: true },
    };
    const issues = validateFlow([node], []);
    expect(issues).toContainEqual(expect.objectContaining({ level: "error", message: 'MCP "MCP" has no server URL.' }));
    expect(issues).toContainEqual(expect.objectContaining({ level: "warn", message: 'MCP "MCP" has no tool name selected.' }));
  });

  it("gives every declared field a key the node data can hold, with no duplicates per kind", () => {
    for (const def of NODE_REGISTRY) {
      const keys = (def.fields ?? []).flatMap((f) => ("key" in f ? [f.key] : []));
      expect(new Set(keys).size, def.kind).toBe(keys.length);
    }
  });
});
