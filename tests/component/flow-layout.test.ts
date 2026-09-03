import { describe, expect, it } from "vitest";
import { Position } from "@xyflow/react";

import { retellEdgePath } from "@/components/builder/FlowDeletableEdge";
import { autoLayoutNodes } from "@/lib/builder/auto-layout";
import type { FlowNode } from "@/lib/builder/store";
import type { Edge } from "@xyflow/react";

describe("retellEdgePath", () => {
  it("uses rounded orthogonal steps, not a cubic S", () => {
    const [path] = retellEdgePath(0, 40, 200, 120, Position.Right, Position.Left);
    expect(path).toMatch(/^M/);
    expect(path).toContain("Q");
    expect(path).not.toMatch(/ C /);
  });

  it("leaves the handle horizontally then drops on a rounded corner", () => {
    const [path] = retellEdgePath(0, 40, 400, 280, Position.Right, Position.Left);
    expect(path.startsWith("M0 40") || path.startsWith("M 0,40") || path.startsWith("M0,40")).toBe(true);
    expect(path).toContain("Q");
    // First bend sits near the source (short stub), not at mid-X.
    const firstQ = path.match(/Q\s+([\d.]+)/);
    expect(Number(firstQ?.[1])).toBeLessThan(200);
  });

  it("keeps same-row connections on a straight horizontal", () => {
    const [path] = retellEdgePath(0, 40, 200, 40, Position.Right, Position.Left);
    expect(path).not.toContain("Q");
  });

  it("detours loop-back edges instead of drawing through the spine", () => {
    const [path, , labelY] = retellEdgePath(400, 40, 80, 40, Position.Right, Position.Left);
    expect(path).toContain("Q");
    expect(labelY).not.toBe(40);
  });
});

describe("autoLayoutNodes", () => {
  it("places a child to the right of its parent", () => {
    const nodes = [
      {
        id: "a",
        type: "conversation",
        position: { x: 0, y: 0 },
        data: { kind: "conversation", label: "A", isStart: true, transitions: [{ id: "t1", target: "b" }] },
      },
      {
        id: "b",
        type: "conversation",
        position: { x: 10, y: 400 },
        data: { kind: "conversation", label: "B", transitions: [] },
      },
    ] as FlowNode[];
    const edges = [{ id: "e1", source: "a", target: "b", sourceHandle: "t1" }] as Edge[];
    const laid = autoLayoutNodes(nodes, edges);
    const a = laid.find((n) => n.id === "a")!;
    const b = laid.find((n) => n.id === "b")!;
    expect(b.position.x).toBeGreaterThan(a.position.x);
    expect(b.position.y).toBe(a.position.y);
  });
});
