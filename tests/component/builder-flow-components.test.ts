import { describe, expect, it } from "vitest";
import { cloneGraphSlice } from "@/lib/builder/graph-ops";
import {
  componentsFor,
  FLOW_COMPONENTS,
  flowComponentSlice,
} from "@/lib/builder/flow-components";
import type { SavedFlowComponent } from "@/lib/builder/types";

describe("flow components", () => {
  it("exposes booking, contact, handoff, wait, http, and end", () => {
    expect(FLOW_COMPONENTS.map((c) => c.id)).toEqual([
      "booking",
      "contact",
      "handoff",
      "wait",
      "http",
      "end",
    ]);
  });

  it("hides voice-only templates from the WhatsApp palette", () => {
    expect(componentsFor("whatsapp").map((c) => c.id)).toEqual(["contact", "end"]);
  });

  it("merges saved custom components into the palette", () => {
    const custom: SavedFlowComponent[] = [
      {
        id: "mine",
        label: "My snippet",
        description: "Saved",
        channel: "voice",
        icon: "custom",
        slice: flowComponentSlice("end")!,
        createdAt: "2026-01-01",
      },
    ];
    expect(componentsFor("voice", custom).map((c) => c.id)).toContain("mine");
    expect(flowComponentSlice("mine", custom)?.nodes).toHaveLength(1);
  });

  it("clones a connected mini-graph with fresh ids", () => {
    let n = 0;
    const slice = flowComponentSlice("contact");
    expect(slice).not.toBeNull();
    const cloned = cloneGraphSlice(slice!, (prefix) => `${prefix}-${++n}`, { x: 100, y: 40 });
    expect(cloned.nodes).toHaveLength(3);
    expect(cloned.edges).toHaveLength(2);
    expect(cloned.nodes.every((node) => node.data.isStart !== true)).toBe(true);
    expect(cloned.nodes[0]!.id).not.toBe("ask");
    expect(cloned.nodes[0]!.position).toEqual({ x: 100, y: 40 });
    expect(cloned.edges[0]!.source).toBe(cloned.nodes[0]!.id);
    expect(cloned.edges[0]!.target).toBe(cloned.nodes[1]!.id);
    expect(cloned.nodes[0]!.data.transitions[0]!.target).toBe(cloned.nodes[1]!.id);
  });
});
