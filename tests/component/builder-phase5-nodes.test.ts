import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { defaultNodeData } from "@/lib/builder/node-registry";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import { validateFlow } from "@/lib/builder/validate";
import type { BuilderSettings, FlowNode } from "@/lib/builder/types";

function node(kind: FlowNode["data"]["kind"], id: string, extra: Partial<FlowNode["data"]> = {}): FlowNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: defaultNodeData(kind, extra),
  };
}

const settings = {
  agentName: "Phase 5",
  globalPrompt: "Be brief.",
  beginMessage: "",
  model: "gpt-4.1",
  voiceId: "11labs-Adrian",
  language: "en-US",
  temperature: 0.3,
} as BuilderSettings;

function exportedNodes(nodes: FlowNode[], edges: Edge[] = []) {
  const agent = exportAgentJson(nodes, edges, settings) as {
    conversationFlow: { start_node_id: string; nodes: Array<Record<string, unknown>> };
  };
  return { agent, flow: agent.conversationFlow, nodes: agent.conversationFlow.nodes };
}

describe("phase 5 node kinds", () => {
  it("defaults begin as the start node", () => {
    const begin = defaultNodeData("begin");
    expect(begin.kind).toBe("begin");
    expect(begin.isStart).toBe(true);
    expect(begin.startSpeaker).toBe("agent");
  });

  it("defaults wait with a timeout transition", () => {
    const wait = defaultNodeData("wait");
    expect(wait.waitTimeoutMs).toBe(8000);
    expect(wait.transitions.some((t) => t.condition === "timeout")).toBe(true);
  });

  it("treats a begin node as a valid start without isStart", () => {
    const nodes = [node("begin", "b", { isStart: false, dialogue: "Hi" }), node("ending", "e")];
    const edges: Edge[] = [{ id: "e1", source: "b", target: "e" }];
    const issues = validateFlow(nodes, edges);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("errors when MCP has no server URL", () => {
    const nodes = [node("begin", "b"), node("mcp", "m", { mcpServerUrl: "", mcpToolName: "lookup" })];
    const edges: Edge[] = [{ id: "e1", source: "b", target: "m" }];
    const issues = validateFlow(nodes, edges);
    expect(issues.some((i) => i.nodeId === "m" && i.level === "error" && i.message.includes("server URL"))).toBe(
      true,
    );
  });

  it("warns when subagent prompt is empty", () => {
    const nodes = [node("begin", "b"), node("subagent", "s", { dialogue: "" })];
    const edges: Edge[] = [{ id: "e1", source: "b", target: "s" }];
    const issues = validateFlow(nodes, edges);
    expect(issues.some((i) => i.nodeId === "s" && i.message.includes("empty prompt"))).toBe(true);
  });

  it("exports begin/wait/subagent as conversation with builder_kind", () => {
    const nodes = [
      node("begin", "b", { dialogue: "Hello", isStart: true }),
      node("wait", "w", { waitTimeoutMs: 4000, waitRetryCount: 2 }),
      node("subagent", "s", {
        dialogue: "Handle booking",
        subagentToolIds: "check_availability, book_appointment",
        subagentKbIds: "kb-1",
      }),
      node("ending", "e"),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "b", target: "w", sourceHandle: "tr-timeout" },
      { id: "e2", source: "w", target: "s" },
      { id: "e3", source: "s", target: "e" },
    ];
    const { flow, nodes: exported } = exportedNodes(nodes, edges);
    expect(flow.start_node_id).toBe("b");
    const begin = exported.find((n) => n.id === "b")!;
    const wait = exported.find((n) => n.id === "w")!;
    const sub = exported.find((n) => n.id === "s")!;
    expect(begin.type).toBe("conversation");
    expect(begin.builder_kind).toBe("begin");
    expect(wait.type).toBe("conversation");
    expect(wait.builder_kind).toBe("wait");
    expect(wait.silence_timeout_ms).toBe(4000);
    expect(wait.retry_count).toBe(2);
    expect(wait.start_speaker).toBe("user");
    expect(sub.builder_kind).toBe("subagent");
    expect(sub.subagent_tools).toEqual(["check_availability", "book_appointment"]);
    expect(sub.knowledge_base_ids).toEqual(["kb-1"]);
  });

  it("exports MCP as a function node with tool_type mcp", () => {
    const nodes = [
      node("begin", "b"),
      node("mcp", "m", {
        mcpServerUrl: "https://mcp.example.com/rpc",
        mcpToolName: "search",
        mcpTimeoutMs: 12000,
        mcpHeaders: '{"Authorization":"Bearer {{token}}"}',
      }),
    ];
    const { nodes: exported } = exportedNodes(nodes, [{ id: "e1", source: "b", target: "m" }]);
    const mcp = exported.find((n) => n.id === "m")!;
    expect(mcp.type).toBe("function");
    expect(mcp.tool_type).toBe("mcp");
    expect(mcp.builder_kind).toBe("mcp");
    expect(mcp.url).toBe("https://mcp.example.com/rpc");
    expect(mcp.mcp_tool).toBe("search");
    expect(mcp.timeout).toBe(12000);
    expect(mcp.headers).toEqual({ Authorization: "Bearer {{token}}" });
  });

  it("applies HTTP path, query, and bearer auth at export", () => {
    const nodes = [
      node("begin", "b"),
      node("http_request", "h", {
        httpUrl: "https://api.example.com/contacts/{id}",
        httpMethod: "GET",
        httpPathParams: "id={{contact_id}}",
        httpQuery: "status={{status}}",
        httpAuthType: "bearer",
        httpAuthValue: "{{token}}",
      }),
    ];
    const { nodes: exported } = exportedNodes(nodes, [{ id: "e1", source: "b", target: "h" }]);
    const http = exported.find((n) => n.id === "h")!;
    expect(http.builder_kind).toBe("http_request");
    expect(http.tool_type).toBe("webhook");
    expect(http.method).toBe("GET");
    expect(http.url).toBe(
      `https://api.example.com/contacts/${encodeURIComponent("{{contact_id}}")}?status=${encodeURIComponent("{{status}}")}`,
    );
    expect(http.headers).toEqual({ Authorization: "Bearer {{token}}" });
  });

  it("exports extract json as string with a JSON hint and required flag", () => {
    const nodes = [
      node("begin", "b"),
      node("extract_variable", "x", {
        extractVariables: [
          {
            id: "v1",
            name: "address",
            description: "Full address",
            type: "json",
            required: true,
          },
        ],
      }),
    ];
    const { nodes: exported } = exportedNodes(nodes, [{ id: "e1", source: "b", target: "x" }]);
    const extract = exported.find((n) => n.id === "x")!;
    const vars = extract.variables as Array<{ type: string; required?: boolean; description: string }>;
    expect(vars[0]?.type).toBe("string");
    expect(vars[0]?.required).toBe(true);
    expect(vars[0]?.description).toMatch(/JSON object/);
  });

  it("round-trips begin, wait, mcp, and http through import", () => {
    const nodes = [
      node("begin", "b", { dialogue: "Hi", beginSilenceMs: 250 }),
      node("wait", "w", { waitTimeoutMs: 6000 }),
      node("mcp", "m", { mcpServerUrl: "https://mcp.example.com", mcpToolName: "ping" }),
      node("http_request", "h", { httpUrl: "https://api.example.com", httpMethod: "PUT" }),
      node("ending", "e"),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "b", target: "w" },
      { id: "e2", source: "w", target: "m" },
      { id: "e3", source: "m", target: "h" },
      { id: "e4", source: "h", target: "e" },
    ];
    const { agent } = exportedNodes(nodes, edges);
    const imported = importAgentJson(JSON.stringify(agent));
    const byId = Object.fromEntries(imported.nodes.map((n) => [n.id, n]));
    expect(byId.b?.data.kind).toBe("begin");
    expect(byId.b?.data.beginSilenceMs).toBe(250);
    expect(byId.w?.data.kind).toBe("wait");
    expect(byId.w?.data.waitTimeoutMs).toBe(6000);
    expect(byId.m?.data.kind).toBe("mcp");
    expect(byId.m?.data.mcpServerUrl).toBe("https://mcp.example.com");
    expect(byId.m?.data.mcpToolName).toBe("ping");
    expect(byId.h?.data.kind).toBe("http_request");
    expect(byId.h?.data.httpUrl).toBe("https://api.example.com");
    expect(byId.h?.data.httpMethod).toBe("PUT");
  });

  it("imports webhook functions without builder_kind as http_request", () => {
    const raw = JSON.stringify({
      conversationFlow: {
        start_node_id: "b",
        nodes: [
          {
            id: "b",
            type: "conversation",
            name: "Begin",
            instruction: { type: "static_text", text: "Hi" },
            edges: [{ id: "e1", destination_node_id: "h", transition_condition: { type: "prompt", prompt: "" } }],
          },
          {
            id: "h",
            type: "function",
            tool_type: "webhook",
            name: "lookup",
            url: "https://api.example.com/x",
            method: "POST",
            edges: [],
          },
        ],
      },
    });
    const imported = importAgentJson(raw);
    expect(imported.nodes.find((n) => n.id === "h")?.data.kind).toBe("http_request");
    expect(imported.nodes.find((n) => n.id === "h")?.data.httpUrl).toBe("https://api.example.com/x");
  });

  it("aligns imported sourceHandle with the transition id when Retell omits edge id", () => {
    const imported = importAgentJson(
      JSON.stringify({
        conversationFlow: {
          start_node_id: "a",
          nodes: [
            {
              id: "a",
              type: "conversation",
              name: "A",
              instruction: { type: "static_text", text: "Hi" },
              edges: [{ destination_node_id: "b", transition_condition: { type: "prompt", prompt: "next" } }],
            },
            {
              id: "b",
              type: "end",
              name: "Bye",
              instruction: { type: "prompt", text: "Bye" },
            },
          ],
        },
      }),
    );
    const transition = imported.nodes.find((n) => n.id === "a")?.data.transitions[0];
    expect(transition?.id).toBe("t-a-0");
    expect(imported.edges[0]?.sourceHandle).toBe(transition?.id);
  });

  it("infers wait and begin from Retell fields when builder_kind is absent", () => {
    const imported = importAgentJson(
      JSON.stringify({
        conversationFlow: {
          start_node_id: "b",
          nodes: [
            {
              id: "b",
              type: "conversation",
              name: "Begin",
              instruction: { type: "static_text", text: "…" },
              begin_after_user_silence_ms: 400,
              edges: [{ id: "e1", destination_node_id: "w", transition_condition: { type: "prompt", prompt: "" } }],
            },
            {
              id: "w",
              type: "conversation",
              name: "Wait",
              start_speaker: "user",
              silence_timeout_ms: 5000,
              edges: [],
            },
          ],
        },
      }),
    );
    expect(imported.nodes.find((n) => n.id === "b")?.data.kind).toBe("begin");
    expect(imported.nodes.find((n) => n.id === "w")?.data.kind).toBe("wait");
  });
});
