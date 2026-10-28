/**
 * Automation engine runtime — the graph executor every workflow runs on (WBAH post-call today,
 * other clients' workflows next). Covers validation, routing, merges, waits, limits, expressions
 * and conditions with core nodes only, so no network or database is involved.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runExecution } from "@/lib/automation-engine/runtime/execution-runner";
import { validateWorkflowDocument } from "@/lib/automation-engine/parser/parse-workflow";
import { overrideNode } from "@/lib/automation-engine/registry/node-registry";
import { ensureAutomationEngineBootstrapped } from "@/lib/automation-engine/bootstrap";
import {
  evaluateConditionExpression,
  resolveExpressionValue,
} from "@/lib/automation-engine/expressions/resolve-expression";
import { evaluateN8nConditionRule } from "@/lib/automation-engine/expressions/n8n-conditions";
import type { ExecutionSnapshot } from "@/lib/automation-engine/types/execution.schema";

type Doc = {
  name: string;
  nodes: Array<Record<string, unknown>>;
  connections: Array<{ from: { node: string; port?: string }; to: { node: string } }>;
  settings?: Record<string, unknown>;
};

const visits: string[] = [];

beforeAll(() => {
  ensureAutomationEngineBootstrapped();
  // A step that records it ran and adds its id to the item, so tests can see path and data flow.
  overrideNode({
    type: "test.step",
    execute: async (ctx) => {
      visits.push(ctx.nodeId);
      return { status: "success", output: { json: { ...ctx.input.json, [ctx.nodeId]: true } } };
    },
  } as any);
});

afterEach(() => {
  visits.length = 0;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function edge(from: string, to: string, port?: string) {
  return { from: { node: from, ...(port ? { port } : {}) }, to: { node: to } };
}

function linear(...middle: Array<Record<string, unknown>>): Doc {
  const nodes = [{ id: "start", type: "core.start" }, ...middle, { id: "end", type: "core.end" }];
  const connections = nodes.slice(1).map((n, i) => edge(String(nodes[i]!.id), String(n.id)));
  return { name: "Test", nodes, connections };
}

const run = (workflow: Doc, extra: Record<string, unknown> = {}) =>
  runExecution({ workflow, mode: "manual", ...extra });

describe("validation", () => {
  it("accepts a well-formed workflow", () => {
    expect(validateWorkflowDocument(linear({ id: "a", type: "test.step" }))).toEqual({ valid: true, errors: [] });
  });

  it("names every structural problem", () => {
    const { valid, errors } = validateWorkflowDocument({
      name: "Broken",
      nodes: [
        { id: "a", type: "test.step" },
        { id: "a", type: "test.step" },
        { id: "b", type: "no.such.type" },
      ],
      connections: [],
    });
    expect(valid).toBe(false);
    expect(errors.join("\n")).toMatch(/Duplicate node id "a"/);
    expect(errors.join("\n")).toMatch(/unknown type "no.such.type"/);
  });

  it("requires an entry, an end, and every node reachable", () => {
    const { errors } = validateWorkflowDocument({
      name: "Islands",
      nodes: [
        { id: "start", type: "core.start" },
        { id: "end", type: "core.end" },
        { id: "orphan", type: "test.step" },
      ],
      connections: [edge("start", "end"), edge("start", "ghost")],
    });
    expect(errors.join("\n")).toMatch(/unknown target node "ghost"/);
    expect(errors.join("\n")).toMatch(/"orphan".*unreachable/);
  });

  it("an invalid workflow fails the run with the reasons, not a crash", async () => {
    const result = await run({ name: "x", nodes: [{ id: "a", type: "test.step" }], connections: [] });
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/no entry node/);
  });
});

describe("routing", () => {
  it("runs a linear workflow in order and passes the trigger through", async () => {
    const result = await run(linear({ id: "a", type: "test.step" }, { id: "b", type: "test.step" }), {
      trigger: { lead: "L1" },
    });
    expect(result.status).toBe("completed");
    expect(visits).toEqual(["a", "b"]);
    expect(result.output).toMatchObject({ lead: "L1", a: true, b: true, _ended: true });
  });

  function ifWorkflow(expression: string): Doc {
    return {
      name: "If",
      nodes: [
        { id: "start", type: "core.start" },
        { id: "if", type: "core.condition", config: { expression } },
        { id: "yes", type: "test.step" },
        { id: "no", type: "test.step" },
        { id: "end", type: "core.end" },
      ],
      connections: [
        edge("start", "if"),
        edge("if", "yes", "true"),
        edge("if", "no", "false"),
        edge("yes", "end"),
        edge("no", "end"),
      ],
    };
  }

  it("a condition follows only the matching branch", async () => {
    await run(ifWorkflow("{{ $json.event }} equals call_analyzed"), { trigger: { event: "call_analyzed" } });
    expect(visits).toEqual(["yes"]);
    visits.length = 0;
    await run(ifWorkflow("{{ $json.event }} equals call_analyzed"), { trigger: { event: "call_ended" } });
    expect(visits).toEqual(["no"]);
  });

  it("a false branch with nothing connected ends that path", async () => {
    const doc = ifWorkflow("{{ $json.ok }} equals yes");
    doc.connections = doc.connections.filter((c) => c.to.node !== "no" && c.from.node !== "no");
    doc.nodes = doc.nodes.filter((n) => n.id !== "no");
    const result = await run(doc, { trigger: { ok: "no" } });
    expect(visits).toEqual([]);
    expect(result.status).toBe("completed");
  });

  it("a switch routes to the matching output, or default", async () => {
    const doc: Doc = {
      name: "Switch",
      nodes: [
        { id: "start", type: "core.start" },
        {
          id: "sw",
          type: "core.switch",
          config: {
            field: "{{ $json.kind }}",
            rules: [
              { value: "booked", output: "booked" },
              { value: "callback", output: "callback" },
            ],
          },
        },
        { id: "b", type: "test.step" },
        { id: "c", type: "test.step" },
        { id: "d", type: "test.step" },
        { id: "end", type: "core.end" },
      ],
      connections: [
        edge("start", "sw"),
        edge("sw", "b", "booked"),
        edge("sw", "c", "callback"),
        edge("sw", "d", "default"),
        edge("b", "end"),
        edge("c", "end"),
        edge("d", "end"),
      ],
    };
    await run(doc, { trigger: { kind: "callback" } });
    expect(visits).toEqual(["c"]);
    visits.length = 0;
    await run(doc, { trigger: { kind: "something else" } });
    expect(visits).toEqual(["d"]);
  });

  it("a disabled node is passed through", async () => {
    await run(linear({ id: "a", type: "test.step", disabled: true }, { id: "b", type: "test.step" }));
    expect(visits).toEqual(["b"]);
  });
});

describe("merge", () => {
  function parallel(): Doc {
    return {
      name: "Parallel",
      nodes: [
        { id: "start", type: "core.start" },
        { id: "a", type: "test.step" },
        { id: "b", type: "test.step" },
        { id: "m", type: "core.merge" },
        { id: "after", type: "test.step" },
        { id: "end", type: "core.end" },
      ],
      connections: [
        edge("start", "a"),
        edge("start", "b"),
        edge("a", "m"),
        edge("b", "m"),
        edge("m", "after"),
        edge("after", "end"),
      ],
    };
  }

  it("waits for both branches, then continues once with both results", async () => {
    const result = await run(parallel());
    expect(visits.filter((v) => v === "after")).toHaveLength(1);
    expect(result.output).toMatchObject({ a: true, b: true, after: true });
  });

  it("continues after an if/else rejoins at a merge — only one branch ever arrives", async () => {
    const doc: Doc = {
      name: "Rejoin",
      nodes: [
        { id: "start", type: "core.start" },
        { id: "if", type: "core.condition", config: { expression: "{{ $json.ok }} equals yes" } },
        { id: "yes", type: "test.step" },
        { id: "no", type: "test.step" },
        { id: "m", type: "core.merge" },
        { id: "after", type: "test.step" },
        { id: "end", type: "core.end" },
      ],
      connections: [
        edge("start", "if"),
        edge("if", "yes", "true"),
        edge("if", "no", "false"),
        edge("yes", "m"),
        edge("no", "m"),
        edge("m", "after"),
        edge("after", "end"),
      ],
    };
    const result = await run(doc, { trigger: { ok: "yes" } });
    expect(visits).toEqual(["yes", "after"]);
    expect(result.output).toMatchObject({ yes: true, after: true });
  });
});

describe("waits", () => {
  it("pauses at a wait and, on resume, carries on with the steps after it", async () => {
    const doc = linear(
      { id: "a", type: "test.step" },
      { id: "wait", type: "core.wait", config: { mode: "webhook", token: "tok-1" } },
      { id: "b", type: "test.step" },
    );
    let snapshot: ExecutionSnapshot | undefined;
    const paused = await run(doc, {
      workspaceId: "ws",
      onWaiting: async ({ snapshot: s }: { snapshot: ExecutionSnapshot }) => {
        snapshot = s;
      },
    });
    expect(paused.status).toBe("waiting");
    expect(paused.waitingOn).toMatchObject({ type: "webhook", token: "tok-1" });
    expect(visits).toEqual(["a"]);

    const resumed = await run(doc, { resumeSnapshot: snapshot, resumePayload: { reply: "yes" } });
    expect(visits).toEqual(["a", "b"]);
    expect(resumed.status).toBe("completed");
    expect(resumed.output).toMatchObject({ a: true, reply: "yes", b: true });
  });
});

describe("limits and errors", () => {
  it("stops at the node limit and says so", async () => {
    const result = await run(
      linear({ id: "a", type: "test.step" }, { id: "b", type: "test.step" }, { id: "c", type: "test.step" }),
      { maxNodes: 2 },
    );
    expect(visits).toEqual(["a"]);
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/node limit/i);
  });

  it("an error stops the run by default", async () => {
    const result = await run(
      linear({ id: "f", type: "core.http.request", config: { url: "" } }, { id: "b", type: "test.step" }),
    );
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/missing url/);
    expect(visits).toEqual([]);
  });

  it("test mode never sends HTTP requests", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await runExecution({
      workflow: linear({ id: "h", type: "core.http.request", config: { url: "https://example.com", method: "POST" } }),
      mode: "test",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.nodeOutputs.h?.[0]?.json).toMatchObject({ _dryRunHttp: true, _url: "https://example.com" });
  });

  it("can start from a chosen step", async () => {
    await run(linear({ id: "a", type: "test.step" }, { id: "b", type: "test.step" }), {
      startNodeId: "b",
      startInput: { from: "canvas" },
    });
    expect(visits).toEqual(["b"]);
  });
});

describe("code nodes", () => {
  it("do not run JavaScript inside the server unless explicitly enabled", async () => {
    const result = await run(
      linear({ id: "fn", type: "core.function", config: { code: "return { json: { leaked: typeof process } };" } }),
    );
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/code nodes are turned off/i);
  });

  it("run when the server enables them", async () => {
    vi.stubEnv("AUTOMATION_CODE_NODES", "on");
    const result = await run(
      linear({ id: "fn", type: "core.function", config: { code: "return { json: { total: $json.a + 1 } };" } }),
      { trigger: { a: 1 } },
    );
    expect(result.status).toBe("completed");
    expect(result.nodeOutputs.fn?.[0]?.json).toEqual({ total: 2 });
  });

  it("imported n8n code with only a description is skipped, not run", async () => {
    const result = await run(linear({ id: "fn", type: "core.function", config: { codeHint: "Formats the date" } }));
    expect(result.status).toBe("completed");
    expect(result.nodeOutputs.fn?.[0]?.json).toMatchObject({ _functionSkipped: true });
  });
});

describe("expressions", () => {
  const ctx = {
    nodeOutputs: { fmt: [{ json: { date: "2026-10-28", nested: { n: 3 } } }] },
    nodeIdByLabel: { "format data": "fmt" },
    variables: { region: "UK" },
    globalVariables: {},
    env: { STAGE: "prod" },
    execution: { id: "e", workflowId: "w" },
  } as any;
  const input = { body: { event: "call_analyzed" }, count: 2 };

  it.each([
    ["={{ $json.body.event }}", "call_analyzed"],
    ["={{ $json.count }}", 2],
    ["={{ $node[\"fmt\"].json.nested.n }}", 3],
    ["={{ $('Format Data').item.json.date }}", "2026-10-28"],
    ["={{ $vars.region }}", "UK"],
    ["={{ $env.STAGE }}", "prod"],
    ["Event: {{ $json.body.event }} x{{ $json.count }}", "Event: call_analyzed x2"],
    ["plain text", "plain text"],
  ])("%s → %j", (raw, expected) => {
    expect(resolveExpressionValue(raw, ctx, input).resolved).toEqual(expected);
  });

  it.each([
    ["{{ $json.body.event }} equals call_analyzed", true],
    ["{{ $json.body.event }} not_equals call_analyzed", false],
    ["{{ $json.body.event }} contains analyzed", true],
    ["{{ $json.body.missing }} exists", false],
    ["{{ $json.body.missing }} not_exists", true],
  ])("condition %s → %s", (cond, expected) => {
    expect(evaluateConditionExpression(cond, ctx, input)).toBe(expected);
  });
});

describe("condition rules", () => {
  const ctx = { nodeOutputs: {}, variables: {}, globalVariables: {}, env: {}, execution: { id: "e", workflowId: "w" } } as any;
  const input = { status: "booked", score: 7, empty: "" };

  it.each([
    [{ field: "status", operator: "equals", value: "booked" }, true],
    [{ field: "status", operator: "not equals", value: "booked" }, false],
    [{ field: "status", operator: "not_equals", value: "booked" }, false],
    [{ field: "status", operator: "not_equals", value: "callback" }, true],
    [{ field: "status", operator: "not_contains", value: "book" }, false],
    [{ field: "empty", operator: "is_empty" }, true],
    [{ field: "status", operator: "is_not_empty" }, true],
    [{ field: "score", operator: "greater_than", value: "5" }, true],
    [{ field: "score", operator: "less than", value: "5" }, false],
    [{ field: "score", operator: "gt", value: "10" }, false],
  ])("%j → %s", (rule, expected) => {
    expect(evaluateN8nConditionRule(rule as any, ctx, input)).toBe(expected);
  });

  it("an operator it does not know fails closed instead of testing whether the field is set", () => {
    expect(evaluateN8nConditionRule({ field: "status", operator: "matches regex", value: "x" }, ctx, input)).toBe(
      false,
    );
  });
});
