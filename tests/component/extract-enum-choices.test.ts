import { describe, expect, it } from "vitest";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";

function extractNode(extractVariables: unknown[]) {
  return {
    id: "n1",
    type: "default",
    position: { x: 0, y: 0 },
    data: {
      kind: "extract_variable",
      label: "Extract",
      extractVariables,
      transitions: [],
      isStart: true,
    },
  };
}

/** Pull the exported variable list back out of the agent JSON. */
function exportedVars(extractVariables: unknown[]): Array<Record<string, unknown>> {
  const out = exportAgentJson(
    [extractNode(extractVariables)] as never,
    [] as never,
    {} as never,
    [] as never,
  );
  const found: Array<Record<string, unknown>> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.variables)) found.push(...(o.variables as Array<Record<string, unknown>>));
      Object.values(o).forEach(walk);
    }
  };
  walk(out);
  return found;
}

describe("enum extract variables carry their options", () => {
  it("exports choices for an enum", () => {
    const vars = exportedVars([
      { id: "v1", name: "intent", description: "why they called", type: "enum", choices: ["sell", "rent"] },
    ]);
    const v = vars.find((x) => x.name === "intent");
    expect(v?.type).toBe("enum");
    expect(v?.choices).toEqual(["sell", "rent"]);
  });

  it("drops blank options rather than exporting empty strings", () => {
    const vars = exportedVars([
      { id: "v1", name: "intent", description: "d", type: "enum", choices: ["sell", "  ", ""] },
    ]);
    expect(vars.find((x) => x.name === "intent")?.choices).toEqual(["sell"]);
  });

  it("degrades an enum with no options to string", () => {
    // An enum the model cannot satisfy is worse than plain text.
    const vars = exportedVars([
      { id: "v1", name: "intent", description: "d", type: "enum", choices: [] },
    ]);
    const v = vars.find((x) => x.name === "intent");
    expect(v?.type).toBe("string");
    expect(v?.choices).toBeUndefined();
  });

  it("leaves non-enum types alone", () => {
    const vars = exportedVars([
      { id: "v1", name: "age", description: "d", type: "number" },
    ]);
    const v = vars.find((x) => x.name === "age");
    expect(v?.type).toBe("number");
    expect(v?.choices).toBeUndefined();
  });
});
