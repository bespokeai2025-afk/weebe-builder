import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { validateComponentSlice, validateFlow } from "@/lib/builder/validate";
import { defaultNodeData } from "@/lib/builder/node-registry";
import type { FlowNode } from "@/lib/builder/types";

function node(kind: FlowNode["data"]["kind"], id: string, extra: Partial<FlowNode["data"]> = {}): FlowNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: defaultNodeData(kind, extra),
  };
}

describe("builder validateFlow", () => {
  it("errors when the flow has no start node", () => {
    const nodes = [node("conversation", "a", { dialogue: "Hello" })];
    const issues = validateFlow(nodes, []);
    expect(issues.some((i) => i.level === "error" && i.message.includes("no start node"))).toBe(true);
  });

  it("errors on HTTP nodes without a URL", () => {
    const nodes = [
      node("conversation", "start", { isStart: true, dialogue: "Hi" }),
      node("http_request", "api", { httpUrl: "" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "start", target: "api" }];
    const issues = validateFlow(nodes, edges);
    expect(issues.some((i) => i.nodeId === "api" && i.level === "error" && i.message.includes("no URL"))).toBe(
      true,
    );
  });

  it("warns about nodes unreachable from start", () => {
    const nodes = [
      node("conversation", "start", { isStart: true, dialogue: "Hi" }),
      node("ending", "end", { endingPrompt: "Bye" }),
      node("conversation", "orphan", { dialogue: "Lost" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" }];
    const issues = validateFlow(nodes, edges);
    expect(issues.some((i) => i.nodeId === "orphan" && i.message.includes("not connected"))).toBe(true);
  });

  it("accepts a start node with a valid entry path", () => {
    const nodes = [
      node("conversation", "start", { isStart: true, dialogue: "Hi" }),
      node("ending", "end", { endingPrompt: "Bye" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" }];
    const issues = validateFlow(nodes, edges);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("collapses duplicate post-call name/description warnings", () => {
    const nodes = [
      node("conversation", "start", { isStart: true, dialogue: "Hi" }),
      node("ending", "end", { endingPrompt: "Bye" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" }];
    const issues = validateFlow(nodes, edges, [
      { name: "", description: "", defaultValue: "" },
      { name: "", description: "", defaultValue: "" },
    ]);
    const post = issues.filter((i) => i.message.toLowerCase().includes("post-call"));
    expect(post).toHaveLength(1);
    expect(post[0]!.message).toMatch(/2 post-call/);
  });

  it("groups unknown template vars per node and dedupes identical issues", () => {
    const nodes = [
      node("conversation", "start", {
        isStart: true,
        dialogue: "Hi {{one}} {{two}} {{one}}",
      }),
      node("ending", "end", { endingPrompt: "Bye" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" }];
    const issues = validateFlow(nodes, edges, []);
    const unknown = issues.filter(
      (i) => i.message.includes("undefined variables") || i.message.includes("is not defined"),
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.nodeId).toBe("start");
    expect(unknown[0]!.message).toContain("{{one}}");
    expect(unknown[0]!.message).toContain("{{two}}");
    expect(new Set(issues.map((i) => `${i.level}|${i.nodeId ?? ""}|${i.message}`)).size).toBe(
      issues.length,
    );
  });

  it("warns on a circular path", () => {
    const nodes = [
      node("conversation", "a", {
        isStart: true,
        dialogue: "Hi",
        transitions: [{ id: "t1", condition: "loop", target: "b" }],
      }),
      node("conversation", "b", {
        dialogue: "Again",
        transitions: [{ id: "t2", condition: "back", target: "a" }],
      }),
    ];
    const edges: Edge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "a" },
    ];
    const issues = validateFlow(nodes, edges);
    expect(issues.some((i) => i.message.includes("Circular path"))).toBe(true);
  });

  it("errors on a broken equation condition", () => {
    const nodes = [
      node("conversation", "start", {
        isStart: true,
        dialogue: "Hi",
        transitions: [{ id: "t1", condition: "{{foo}} ==", target: "end", conditionType: "equation" }],
      }),
      node("ending", "end", { endingPrompt: "Bye" }),
    ];
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end" }];
    const issues = validateFlow(nodes, edges);
    expect(issues.some((i) => i.level === "error" && i.message.includes("Equation"))).toBe(true);
  });

  it("validates a component slice without requiring a start node", () => {
    const slice = {
      nodes: [node("ending", "bye", { endingPrompt: "Bye" })],
      edges: [] as Edge[],
    };
    const issues = validateComponentSlice(slice);
    expect(issues.some((i) => i.message.includes("no start node"))).toBe(false);
  });
});
