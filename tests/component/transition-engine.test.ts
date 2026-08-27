import { describe, expect, it } from "vitest";
import {
  buildCompactRoutingMessages,
  evaluateEquationCondition,
  isEquationCondition,
  tryEquationEdge,
  tryHeuristicGlobalIndex,
} from "@/lib/voice/graph/transition-engine.shared";

describe("transition-engine", () => {
  describe("isEquationCondition", () => {
    it("detects variable comparisons", () => {
      expect(isEquationCondition('{{appointment_type}} == "botox"')).toBe(true);
      expect(isEquationCondition("{{user_age}} < 18")).toBe(true);
      expect(isEquationCondition("{{available}}")).toBe(true);
      expect(isEquationCondition("user wants botox")).toBe(false);
    });
  });

  describe("evaluateEquationCondition", () => {
    it("matches string equality", () => {
      expect(
        evaluateEquationCondition('{{treatment}} == "botox"', { treatment: "botox" }),
      ).toBe(true);
      expect(
        evaluateEquationCondition('{{treatment}} == "botox"', { treatment: "filler" }),
      ).toBe(false);
    });

    it("matches numeric comparisons", () => {
      expect(evaluateEquationCondition("{{user_age}} < 18", { user_age: 16 })).toBe(true);
      expect(evaluateEquationCondition("{{user_age}} < 18", { user_age: 21 })).toBe(false);
    });

    it("treats bare {{var}} as truthy", () => {
      expect(evaluateEquationCondition("{{phone}}", { phone: "9876543210" })).toBe(true);
      expect(evaluateEquationCondition("{{phone}}", { phone: "" })).toBe(false);
      expect(evaluateEquationCondition("{{phone}}", {})).toBe(false);
    });
  });

  describe("tryEquationEdge", () => {
    it("picks the first matching equation edge", () => {
      const edges = [
        {
          id: "e1",
          destination_node_id: "botox",
          transition_condition: { type: "equation" as const, prompt: '{{type}} == "botox"' },
        },
        {
          id: "e2",
          destination_node_id: "other",
          transition_condition: { type: "equation" as const, prompt: '{{type}} == "filler"' },
        },
      ];
      expect(tryEquationEdge(edges, { type: "filler" })?.destination_node_id).toBe("other");
    });
  });

  describe("buildCompactRoutingMessages", () => {
    it("sends only the latest exchange, not full history", () => {
      const messages = buildCompactRoutingMessages({
        currentNodeHint: "collect_phone",
        variables: { name: "John" },
        latestUserText: "9876543210",
        lastAgentText: "What's your phone number?",
        collectedFacts: "name=John",
      });
      expect(messages).toHaveLength(3);
      expect(messages[0]?.role).toBe("system");
      expect(messages[1]?.content).toContain("phone number");
      expect(messages[2]?.content).toBe("9876543210");
      expect(JSON.stringify(messages)).not.toContain("turn 1");
    });
  });

  describe("tryHeuristicGlobalIndex", () => {
    it("matches human transfer without LLM", () => {
      const conditions = ["caller asks for a human", "caller wants to book"];
      expect(tryHeuristicGlobalIndex(conditions, "I need to speak to a human")).toBe(0);
    });
  });
});

describe("nodeClassifierModel", () => {
  it("uses fast model for simple nodes", async () => {
    const { nodeClassifierModel } = await import("@/lib/voice/graph/flow");
    const edges = [
      {
        id: "e1",
        destination_node_id: "next",
        transition_condition: { type: "prompt" as const, prompt: "user says yes" },
      },
    ];
    const node = {
      id: "greet",
      type: "conversation" as const,
      instruction: { type: "prompt" as const, text: "Say hello" },
      edges,
    };
    expect(
      nodeClassifierModel(node, edges, {
        fast: "gpt-4.1-nano",
        strong: "gpt-4.1-mini",
      }),
    ).toBe("gpt-4.1-nano");
  });

  it("uses strong model for multi-branch qualification nodes", async () => {
    const { nodeClassifierModel } = await import("@/lib/voice/graph/flow");
    const edges = [
      { id: "e1", destination_node_id: "a", transition_condition: { type: "prompt" as const, prompt: "wants botox" } },
      { id: "e2", destination_node_id: "b", transition_condition: { type: "prompt" as const, prompt: "wants filler" } },
      { id: "e3", destination_node_id: "c", transition_condition: { type: "prompt" as const, prompt: "wants consultation" } },
    ];
    const node = {
      id: "qual",
      type: "conversation" as const,
      instruction: { type: "prompt" as const, text: "Qualify the lead with several questions" },
      edges,
    };
    expect(
      nodeClassifierModel(node, edges, {
        fast: "gpt-4.1-nano",
        strong: "gpt-4.1-mini",
      }),
    ).toBe("gpt-4.1-mini");
  });
});

describe("CallTurnTrace route telemetry", () => {
  it("records edge and global route methods in flush summary", async () => {
    const { CallTurnTrace } = await import("@/lib/voice/graph/latency-trace");
    const trace = new CallTurnTrace(1, Date.now());
    trace.setSttFinal(Date.now());
    trace.recordRoute("global", "global_heuristic");
    trace.recordRoute("edge", "equation");
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(String(args[0]));
    trace.flushSummary();
    console.log = orig;
    expect(logs[0]).toContain("route_global_method=global_heuristic");
    expect(logs[0]).toContain("route_edge_method=equation");
  });
});
