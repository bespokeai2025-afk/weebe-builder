/** WEBEE Native parity check on the flow on screen. */
import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { nativeEngineIssues } from "@/lib/builder/engine-parity";
import { defaultNodeData } from "@/lib/builder/node-registry";
import type { BuilderSettings, FlowNode } from "@/lib/builder/types";

function node(kind: FlowNode["data"]["kind"], id: string, extra: Partial<FlowNode["data"]> = {}): FlowNode {
  return { id, type: kind, position: { x: 0, y: 0 }, data: defaultNodeData(kind, extra) };
}

const native = { deploymentMode: "WEBEE_NATIVE" } as unknown as BuilderSettings;
const flow = [node("conversation", "start", { isStart: true, dialogue: "Hi" }), node("ending", "end")];
const edges: Edge[] = [{ id: "e1", source: "start", target: "end" }];

describe("nativeEngineIssues", () => {
  it("is empty for a clean flow, and for agents not on WEBEE Native", () => {
    expect(nativeEngineIssues(flow, edges, native, [])).toEqual([]);
    expect(nativeEngineIssues(flow, edges, { webeeTtsProvider: "cartesia", voiceEmotion: "happy" } as any, [])).toEqual([]);
  });

  it("flags settings WEBEE Native ignores with the chosen voice", () => {
    const issues = nativeEngineIssues(
      flow,
      edges,
      { ...native, webeeTtsProvider: "cartesia", voiceEmotion: "happy" } as BuilderSettings,
      [],
    );
    expect(issues).toEqual([
      expect.objectContaining({ level: "warn", message: expect.stringMatching(/^Voice emotion: .*Fish Audio/) }),
    ]);
  });

  it("does not flag a setting that is left off", () => {
    const issues = nativeEngineIssues(flow, edges, { ...native, ambientSound: "none" } as BuilderSettings, []);
    expect(issues).toEqual([]);
  });
});
