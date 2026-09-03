import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import {
  clearTransitionTargetForEdge,
  cloneGraphSlice,
  syncNodeEdges,
} from "@/lib/builder/graph-ops";
import { defaultNodeData } from "@/lib/builder/node-registry";
import type { FlowNode } from "@/lib/builder/types";

describe("cloneGraphSlice", () => {
  it("assigns new ids, remaps internal edges, and clears isStart", () => {
    let n = 0;
    const nextId = (prefix: string) => `${prefix}-${++n}`;
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "conversation",
        position: { x: 10, y: 20 },
        data: defaultNodeData("conversation", {
          isStart: true,
          dialogue: "Hi",
          transitions: [{ id: "t1", condition: "yes", target: "end" }],
        }),
      },
      {
        id: "end",
        type: "ending",
        position: { x: 200, y: 20 },
        data: defaultNodeData("ending", { endingPrompt: "Bye" }),
      },
    ];
    const edges: Edge[] = [{ id: "e1", source: "start", target: "end", sourceHandle: "t1" }];
    const cloned = cloneGraphSlice({ nodes, edges }, nextId);

    expect(cloned.nodes.map((node) => node.id)).not.toContain("start");
    expect(cloned.nodes.every((node) => node.data.isStart !== true)).toBe(true);
    expect(cloned.nodes[0]!.position).toEqual({ x: 58, y: 68 });
    expect(cloned.edges).toHaveLength(1);
    expect(cloned.edges[0]!.source).toBe(cloned.nodes[0]!.id);
    expect(cloned.edges[0]!.target).toBe(cloned.nodes[1]!.id);
    expect(cloned.nodes[0]!.data.transitions[0]!.target).toBe(cloned.nodes[1]!.id);
    expect(cloned.edges[0]!.sourceHandle).toBe(cloned.nodes[0]!.data.transitions[0]!.id);
  });

  it("drops edges that leave the selection", () => {
    let n = 0;
    const nodes: FlowNode[] = [
      {
        id: "a",
        type: "conversation",
        position: { x: 0, y: 0 },
        data: defaultNodeData("conversation", { dialogue: "A" }),
      },
    ];
    const edges: Edge[] = [{ id: "out", source: "a", target: "outside" }];
    const cloned = cloneGraphSlice({ nodes, edges }, (p) => `${p}-${++n}`);
    expect(cloned.edges).toEqual([]);
  });
});

describe("syncNodeEdges", () => {
  const start: FlowNode = {
    id: "start",
    type: "conversation",
    position: { x: 0, y: 0 },
    data: defaultNodeData("conversation", {
      isStart: true,
      dialogue: "Hi",
      transitions: [{ id: "t1", condition: "yes", target: "end" }],
    }),
  };

  it("creates an edge when a transition gains a target", () => {
    const edges = syncNodeEdges("start", start.data.transitions, [], "conversation");
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      source: "start",
      target: "end",
      sourceHandle: "t1",
      type: "flow",
      label: "yes",
    });
  });

  it("drops the edge when the transition target is cleared", () => {
    const existing: Edge[] = [{ id: "e1", source: "start", target: "end", sourceHandle: "t1" }];
    const edges = syncNodeEdges(
      "start",
      [{ id: "t1", condition: "yes", target: null }],
      existing,
      "conversation",
    );
    expect(edges).toEqual([]);
  });

  it("drops the edge when the transition is removed", () => {
    const existing: Edge[] = [{ id: "e1", source: "start", target: "end", sourceHandle: "t1" }];
    const edges = syncNodeEdges("start", [], existing, "conversation");
    expect(edges).toEqual([]);
  });

  it("retargets an existing handle without duplicating the edge", () => {
    const existing: Edge[] = [{ id: "e1", source: "start", target: "end", sourceHandle: "t1" }];
    const edges = syncNodeEdges(
      "start",
      [{ id: "t1", condition: "yes", target: "other" }],
      existing,
      "conversation",
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.id).toBe("e1");
    expect(edges[0]!.target).toBe("other");
  });
});

describe("clearTransitionTargetForEdge", () => {
  it("nulls the matching transition target", () => {
    const nodes: FlowNode[] = [
      {
        id: "start",
        type: "conversation",
        position: { x: 0, y: 0 },
        data: defaultNodeData("conversation", {
          transitions: [{ id: "t1", condition: "yes", target: "end" }],
        }),
      },
    ];
    const next = clearTransitionTargetForEdge(nodes, { source: "start", sourceHandle: "t1" });
    expect(next[0]!.data.transitions[0]!.target).toBeNull();
  });
});
