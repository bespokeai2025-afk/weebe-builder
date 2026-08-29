import { describe, expect, it } from "vitest";
import { defaultNodeData } from "@/lib/builder/node-registry";
import {
  collectFlowVariables,
  collectTestCallFields,
  filterFlowVariables,
  incompleteVariableToken,
  insertVariableToken,
  suggestTestCallValue,
  unknownTemplateVars,
} from "@/lib/builder/flow-variables";
import { validateFlow } from "@/lib/builder/validate";
import type { FlowNode } from "@/lib/builder/types";

function node(kind: FlowNode["data"]["kind"], id: string, extra: Partial<FlowNode["data"]> = {}): FlowNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: defaultNodeData(kind, extra),
  };
}

describe("flow variables", () => {
  it("always includes system vars", () => {
    const vars = collectFlowVariables([]);
    expect(vars.map((v) => v.name)).toEqual(
      expect.arrayContaining(["user_number", "agent_number", "current_time", "current_date", "call_id"]),
    );
  });

  it("collects extract, HTTP mapping, and post-call names without duplicating system", () => {
    const vars = collectFlowVariables(
      [
        node("extract_variable", "x", {
          extractVariables: [{ id: "1", name: "email", description: "Caller email", type: "string" }],
        }),
        node("http_request", "h", {
          httpUrl: "https://api.example.com",
          httpResponseMapping: "response.status -> {{booking_status}}",
        }),
      ],
      [{ name: "sentiment", description: "Call sentiment", defaultValue: "" }],
    );
    const names = vars.map((v) => v.name);
    expect(names).toContain("email");
    expect(names).toContain("booking_status");
    expect(names).toContain("sentiment");
    expect(names.filter((n) => n === "email")).toHaveLength(1);
    expect(vars.find((v) => v.name === "email")?.source).toBe("extract");
    expect(vars.find((v) => v.name === "booking_status")?.source).toBe("http");
    expect(vars.find((v) => v.name === "sentiment")?.source).toBe("post_call");
  });

  it("detects an incomplete {{token at the cursor", () => {
    expect(incompleteVariableToken("Hi {{em", 7)).toEqual({ start: 3, query: "em" });
    expect(incompleteVariableToken("Hi {{email}} there", 12)).toBeNull();
    expect(incompleteVariableToken("no braces", 3)).toBeNull();
  });

  it("inserts or completes a {{name}} token", () => {
    expect(insertVariableToken("Hi {{em", 7, "email")).toEqual({
      text: "Hi {{email}}",
      cursor: 12,
    });
    expect(insertVariableToken("Hello ", 6, "name")).toEqual({
      text: "Hello {{name}}",
      cursor: 14,
    });
  });

  it("filters by name and description", () => {
    const vars = collectFlowVariables([
      node("extract_variable", "x", {
        extractVariables: [{ id: "1", name: "email", description: "Caller inbox", type: "string" }],
      }),
    ]);
    expect(filterFlowVariables(vars, "emai").map((v) => v.name)).toContain("email");
    expect(filterFlowVariables(vars, "inbox").map((v) => v.name)).toContain("email");
    expect(filterFlowVariables(vars, "zzzz")).toEqual([]);
  });

  it("warns on unknown {{placeholders}} but not on defined ones", () => {
    const nodes = [
      node("begin", "b", { isStart: true, dialogue: "Hi {{email}}" }),
      node("conversation", "c", { dialogue: "Unknown {{mystery}}" }),
      node("extract_variable", "x", {
        extractVariables: [{ id: "1", name: "email", description: "Email", type: "string" }],
      }),
    ];
    const unknown = unknownTemplateVars(nodes);
    expect(unknown.some((u) => u.name === "mystery" && u.nodeId === "c")).toBe(true);
    expect(unknown.some((u) => u.name === "email")).toBe(false);

    const issues = validateFlow(nodes, [{ id: "e1", source: "b", target: "c" }]);
    expect(issues.some((i) => i.nodeId === "c" && i.message.includes("{{mystery}}"))).toBe(true);
    expect(issues.some((i) => i.message.includes("{{email}}"))).toBe(false);
  });

  it("builds a test-call form from declared, extracted, and template vars", () => {
    const now = new Date("2026-08-29T12:00:00Z");
    const fields = collectTestCallFields(
      [
        node("begin", "b", { isStart: true, dialogue: "Hi {{first_name}} at {{current_date}}" }),
        node("extract_variable", "x", {
          extractVariables: [{ id: "1", name: "email", description: "Inbox", type: "string" }],
        }),
      ],
      [
        { name: "first_name", description: "Lead first name", defaultValue: "Sarah" },
        {
          name: "structured_json_output",
          description: "You are an expert call-analysis engine. Output ONLY valid JSON.",
          defaultValue: "",
        },
      ],
      now,
    );
    expect(fields.find((f) => f.name === "first_name")?.suggested).toBe("Sarah");
    expect(fields.find((f) => f.name === "email")?.source).toBe("extract");
    expect(fields.find((f) => f.name === "current_date")?.suggested).toBe(
      suggestTestCallValue("current_date", now),
    );
    expect(fields.some((f) => f.name === "call_id")).toBe(false);
    expect(fields.some((f) => f.name === "structured_json_output")).toBe(false);
    expect(fields.find((f) => f.name === "first_name")?.description).not.toMatch(/expert call-analysis/i);
  });
});
