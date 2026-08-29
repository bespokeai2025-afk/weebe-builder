import { describe, expect, it } from "vitest";
import { compileFlow } from "@/lib/voice/graph/flow";
import {
  evaluateEquationGroup,
  parseEquationGroup,
  serializeEquationPrompt,
  toRetellEquationCondition,
} from "@/lib/voice/graph/equations.shared";
import { tryEquationEdge } from "@/lib/voice/graph/transition-engine.shared";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";

const SAMPLE = JSON.stringify({
  agent_name: "Eq import",
  voice_id: "custom_voice_abc",
  conversation_flow: {
    start_node_id: "start",
    start_speaker: "user",
    nodes: [
      {
        id: "start",
        type: "conversation",
        name: "Ask market",
        instruction: { type: "prompt", text: "Ask if on the market" },
        edges: [
          {
            id: "e-yes",
            destination_node_id: "fn",
            transition_condition: {
              type: "equation",
              operator: "||",
              equations: [{ left: "{{on_market_answer}}", operator: "==", right: "Yes" }],
            },
          },
          {
            id: "e-no",
            destination_node_id: "end",
            transition_condition: {
              type: "equation",
              operator: "||",
              equations: [{ left: "{{on_market_answer}}", operator: "!=", right: "Yes" }],
            },
          },
        ],
      },
      {
        id: "fn",
        type: "function",
        name: "Get Available Slots",
        tool_type: "local",
        tool_id: "tool-slots",
        wait_for_result: true,
        edges: [
          {
            id: "e-slots",
            destination_node_id: "end",
            transition_condition: {
              type: "equation",
              operator: "&&",
              equations: [
                { left: "{{slot_message}}", operator: "not_contains", right: "No appointment slots" },
                { left: "{{slot_message}}", operator: "contains", right: "Booked" },
              ],
            },
          },
        ],
      },
      {
        id: "end",
        type: "end",
        name: "Done",
        instruction: { type: "prompt", text: "Bye" },
      },
    ],
    tools: [
      {
        tool_id: "tool-slots",
        type: "custom",
        name: "get_available_slots",
        method: "POST",
        url: "https://example.test/slots",
        description: "Fetch live slots",
        timeout_ms: 30000,
        headers: { "Content-Type": "application/json" },
        response_variables: { slot_message: "message" },
        parameters: { type: "object", properties: { requested_day: { type: "string" } } },
      },
    ],
  },
});

describe("Retell equations", () => {
  it("evaluates if-any / if-all and not_contains", () => {
    const any = parseEquationGroup({
      operator: "||",
      equations: [
        { left: "{{fallback_action}}", operator: "==", right: "callback" },
        { left: "{{match_status}}", operator: "==", right: "no_availability" },
      ],
    });
    expect(evaluateEquationGroup(any, { fallback_action: "callback" })).toBe(true);
    expect(evaluateEquationGroup(any, { match_status: "ok" })).toBe(false);

    const all = parseEquationGroup({
      operator: "&&",
      equations: [
        { left: "{{slot_message}}", operator: "not_contains", right: "No appointment slots" },
        { left: "{{email}}", operator: "exists" },
      ],
    });
    expect(evaluateEquationGroup(all, { slot_message: "Tuesday 11am", email: "a@b.com" })).toBe(true);
    expect(evaluateEquationGroup(all, { slot_message: "No appointment slots", email: "a@b.com" })).toBe(
      false,
    );
  });

  it("round-trips structured equations through import and export", () => {
    const imported = importAgentJson(SAMPLE);
    const start = imported.nodes.find((n) => n.id === "start")!;
    const yes = start.data.transitions.find((t) => t.id === "e-yes")!;
    expect(yes.conditionType).toBe("equation");
    expect(yes.equationJoin).toBe("||");
    expect(yes.equations).toEqual([
      { left: "{{on_market_answer}}", operator: "==", right: "Yes" },
    ]);
    expect(yes.condition).toContain("on_market_answer");

    const fn = imported.nodes.find((n) => n.id === "fn")!;
    expect(fn.data.kind).toBe("function");
    expect(fn.data.toolName).toBe("get_available_slots");
    expect(fn.data.httpUrl).toBe("https://example.test/slots");
    expect(fn.data.httpMethod).toBe("POST");
    expect(fn.data.toolDescription).toBe("Fetch live slots");
    expect(imported.settings.flowTools).toHaveLength(1);

    const exported = exportAgentJson(
      imported.nodes,
      imported.edges,
      {
        agentName: "Eq import",
        companyName: "",
        globalPrompt: "",
        beginMessage: "",
        model: "gpt-4.1",
        voiceId: "",
        language: "en-GB",
        temperature: 0.3,
        ...imported.settings,
      },
      imported.variables ?? [],
    );
    const cf = exported.conversationFlow as {
      tools: Array<{ url?: string; tool_id?: string }>;
      nodes: Array<{
        id: string;
        edges?: Array<{
          id: string;
          transition_condition?: {
            type?: string;
            operator?: string;
            equations?: Array<{ left: string; operator: string; right?: string }>;
          };
        }>;
      }>;
    };
    expect(cf.tools.some((t) => t.tool_id === "tool-slots" && t.url === "https://example.test/slots")).toBe(
      true,
    );
    const startOut = cf.nodes.find((n) => n.id === "start")!;
    const yesOut = startOut.edges?.find((e) => e.id === "e-yes")?.transition_condition;
    expect(yesOut?.type).toBe("equation");
    expect(yesOut?.operator).toBe("||");
    expect(yesOut?.equations?.[0]).toMatchObject({
      left: "{{on_market_answer}}",
      operator: "==",
      right: "Yes",
    });
  });

  it("compiles Retell equations onto the VM graph", () => {
    const imported = importAgentJson(SAMPLE);
    const exported = exportAgentJson(
      imported.nodes,
      imported.edges,
      {
        agentName: "Eq import",
        companyName: "",
        globalPrompt: "",
        beginMessage: "",
        model: "gpt-4.1",
        voiceId: "",
        language: "en-GB",
        temperature: 0.3,
        ...imported.settings,
      },
      imported.variables ?? [],
    );
    const compiled = compileFlow(exported.conversationFlow);
    const start = compiled.nodes.get("start")!;
    const eqEdges = (start.edges ?? []).filter((e) => e.transition_condition.type === "equation");
    expect(eqEdges.length).toBe(2);
    expect(eqEdges[0]?.transition_condition.equations?.length).toBe(1);
    expect(
      tryEquationEdge(start.edges ?? [], { on_market_answer: "Yes" })?.destination_node_id,
    ).toBe("fn");
  });

  it("serializes a prompt fallback for older edges", () => {
    const group = parseEquationGroup({
      operator: "||",
      equations: [{ left: "{{status}}", operator: "!=", right: "done" }],
    });
    expect(serializeEquationPrompt(group)).toBe('{{status}} != "done"');
    expect(toRetellEquationCondition(group)?.equations[0]?.operator).toBe("!=");
  });
});
