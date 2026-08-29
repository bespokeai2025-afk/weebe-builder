import { describe, expect, it } from "vitest";
import { appendFlowVersion, graphFingerprint, makePublishedSnapshot } from "@/lib/builder/flow-history";
import { defaultNodeData } from "@/lib/builder/node-registry";
import type { BuilderSettings, FlowNode } from "@/lib/builder/types";
import type { Edge } from "@xyflow/react";

const node = (id: string, dialogue: string): FlowNode => ({
  id,
  type: "conversation",
  position: { x: 0, y: 0 },
  data: defaultNodeData("conversation", { dialogue, isStart: id === "a" }),
});

describe("flow history", () => {
  it("skips a duplicate snapshot with the same fingerprint", () => {
    const nodes = [node("a", "Hi")];
    const edges: Edge[] = [];
    const variables = [{ name: "x", description: "x", defaultValue: "" }];
    const settings = { flowHistory: [] } as unknown as BuilderSettings;
    const first = appendFlowVersion(settings, {
      label: "Saved",
      flowData: { nodes, edges },
      variables,
    });
    const second = appendFlowVersion({ ...settings, flowHistory: first }, {
      label: "Autosave",
      flowData: { nodes, edges },
      variables,
    });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(graphFingerprint(nodes, edges, variables)).toBeTruthy();
  });

  it("builds a published snapshot", () => {
    const nodes = [node("a", "Hi")];
    const published = makePublishedSnapshot(3, nodes, [], []);
    expect(published.version).toBe(3);
    expect(published.flowData.nodes).toHaveLength(1);
  });
});
