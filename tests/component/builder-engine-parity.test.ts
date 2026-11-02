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

describe("nativeEngineIssues — gated extract steps", () => {
  const gate = {
    id: "t1",
    target: "end",
    conditionType: "equation",
    equationJoin: "&&",
    equations: [{ left: "{{email}}", operator: "exists", right: "" }],
  };
  const flowWith = (transitions: unknown[]) => [
    node("conversation", "start", { isStart: true, dialogue: "What's your email?" }),
    node("extract_variable", "grab", { label: "Grab email", transitions } as Partial<FlowNode["data"]>),
    node("ending", "end"),
    node("ending", "other"),
  ];
  const e: Edge[] = [{ id: "e1", source: "start", target: "grab" }];

  it("explains what happens when an extract step gates on variables with no else exit", () => {
    const issues = nativeEngineIssues(flowWith([gate]), e, native, []);
    expect(issues).toContainEqual(
      expect.objectContaining({
        level: "warn",
        nodeId: "grab",
        message: expect.stringMatching(/checks email but has no else exit.*up to 3 times/),
      }),
    );
  });

  it("is quiet once the step has an else exit", () => {
    const withElse = [gate, { id: "t2", target: "other", conditionType: "prompt", condition: "Else" }];
    const issues = nativeEngineIssues(flowWith(withElse), e, native, []);
    expect(issues.some((i) => /no else exit/.test(i.message))).toBe(false);
  });
});
