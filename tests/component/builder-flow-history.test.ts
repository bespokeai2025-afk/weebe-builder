/**
 * Version history rides along in agent settings on every save. Uncompressed it grew to ~2.9 MB on
 * a real agent and the server rejected saves with HTTP 413. History is now stored compressed and
 * capped by size.
 */
import { describe, expect, it } from "vitest";
import {
  appendFlowVersion,
  compactFlowHistory,
  expandFlowVersion,
  historyNeedsCompaction,
} from "@/lib/builder/flow-history";
import type { BuilderSettings, FlowNode, FlowVersionSnapshot } from "@/lib/builder/types";

function graph(n: number, text = "x"): { nodes: FlowNode[]; edges: [] } {
  return {
    nodes: Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      type: "flowNode",
      position: { x: i, y: i },
      data: { kind: "conversation", label: `Step ${i}`, dialogue: `${text} ${i} `.repeat(40), transitions: [] },
    })) as FlowNode[],
    edges: [],
  };
}

const legacy = (version: number, text: string): FlowVersionSnapshot => ({
  version,
  label: "Saved",
  createdAt: new Date(0).toISOString(),
  flowData: graph(60, text),
  variables: [],
});

describe("flow history compression", () => {
  it("compresses legacy entries and restores them exactly", async () => {
    const entry = legacy(1, "hello");
    const [compacted] = await compactFlowHistory([entry]);
    expect(compacted!.flowData).toBeUndefined();
    expect(compacted!.gz!.length).toBeLessThan(JSON.stringify(entry.flowData).length / 3);
    const restored = await expandFlowVersion(compacted!);
    expect(restored.flowData).toEqual(entry.flowData);
    expect(historyNeedsCompaction([compacted!])).toBe(false);
    expect(historyNeedsCompaction([entry])).toBe(true);
  });

  it("drops the oldest versions to stay under the size cap, always keeping the newest", async () => {
    const history = Array.from({ length: 10 }, (_, i) => legacy(i + 1, `version ${i}`));
    const one = (await compactFlowHistory([history[0]!]))[0]!.gz!.length;
    const kept = await compactFlowHistory(history, one * 3 + 700);
    expect(kept.map((e) => e.version)).toEqual([8, 9, 10]);
    const tiny = await compactFlowHistory(history, 10);
    expect(tiny.map((e) => e.version)).toEqual([10]);
  });

  it("skips a version identical to the newest, compressed or not", async () => {
    const g = graph(5, "same");
    const settings = { flowHistory: [] } as unknown as BuilderSettings;
    const first = await appendFlowVersion(settings, { label: "Saved", flowData: g, variables: [] });
    expect(first).toHaveLength(1);
    const again = await appendFlowVersion({ flowHistory: first } as unknown as BuilderSettings, {
      label: "Saved",
      flowData: structuredClone(g),
      variables: [],
    });
    expect(again).toBeNull();
    const changed = await appendFlowVersion({ flowHistory: first } as unknown as BuilderSettings, {
      label: "Saved",
      flowData: graph(5, "different"),
      variables: [],
    });
    expect(changed!.map((e) => e.version)).toEqual([1, 2]);
  });
});
