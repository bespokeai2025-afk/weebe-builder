/**
 * Automation engine reliability:
 * - a step that throws is recorded as a failed step and the run finishes as failed, instead of
 *   escaping the runner and leaving the execution "running" for ever;
 * - only temporary failures are worth a retry;
 * - a WBAH retry holds back unsafe steps an earlier attempt already completed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { runExecution } from "@/lib/automation-engine/runtime/execution-runner";
import { isTransientError } from "@/lib/automation-engine/runtime/node-runtime";
import { overrideNode } from "@/lib/automation-engine/registry/node-registry";
import { ensureAutomationEngineBootstrapped } from "@/lib/automation-engine/bootstrap";
import { wbahUnsafeStepsFromRows } from "@/lib/wbah/post-call/wbah-post-call-queue.server";

const ran: string[] = [];

beforeAll(() => {
  ensureAutomationEngineBootstrapped();
  overrideNode({
    type: "test.ok",
    execute: async (ctx) => {
      ran.push(ctx.nodeId);
      return { status: "success", output: { json: { ok: true } } };
    },
  } as any);
  overrideNode({
    type: "test.throws",
    execute: async (ctx) => {
      ran.push(ctx.nodeId);
      throw new Error("Dynamics PATCH lead failed (400): validation");
    },
  } as any);
});

function workflow(onError?: "continue") {
  return {
    name: "Reliability",
    nodes: [
      { id: "start", type: "core.start" },
      { id: "a", type: "test.ok" },
      { id: "b", type: "test.throws", ...(onError ? { onError } : {}) },
      { id: "c", type: "test.ok" },
      { id: "end", type: "core.end" },
    ],
    connections: [
      { from: { node: "start" }, to: { node: "a" } },
      { from: { node: "a" }, to: { node: "b" } },
      { from: { node: "b" }, to: { node: "c" } },
      { from: { node: "c" }, to: { node: "end" } },
    ],
  };
}

describe("a step that throws", () => {
  it("is recorded as a failed step and the run finishes as failed", async () => {
    ran.length = 0;
    const result = await runExecution({ workflow: workflow(), mode: "manual" });
    expect(result.status).toBe("failed");
    expect(result.lastError).toMatch(/Dynamics PATCH lead failed \(400\)/);
    const failed = result.log.find((e) => e.nodeId === "b");
    expect(failed?.status).toBe("error");
    expect(ran).toEqual(["a", "b"]);
  });

  it("is tried once, not retried in place", async () => {
    ran.length = 0;
    await runExecution({ workflow: workflow(), mode: "manual" });
    expect(ran.filter((id) => id === "b")).toHaveLength(1);
  });

  it("follows the node's error policy", async () => {
    ran.length = 0;
    const result = await runExecution({ workflow: workflow("continue"), mode: "manual" });
    expect(ran).toEqual(["a", "b"]);
    expect(result.log.find((e) => e.nodeId === "b")?.status).toBe("error");
    expect(result.status).not.toBe("running");
  });
});

describe("isTransientError", () => {
  it.each([
    "WeeBespoke call-output-data/create failed (0): fetch failed",
    "WeeBespoke call-output-data/create failed (502): <html>Bad Gateway",
    'Dynamics PATCH lead failed (429): {"error":{"code":"0x80072321"}}',
    "connect ECONNRESET 10.0.0.1:443",
    "The operation was aborted due to timeout",
  ])("retries %s", (msg) => {
    expect(isTransientError(msg)).toBe(true);
  });

  it.each([
    'Dynamics PATCH lead failed (400): {"error":{"code":"0x80044331","message":"A validation error occurred."}}',
    "Dynamics PATCH lead failed (400): You cannot re-open a qualified Lead.",
    "WeeBespoke callback request failed after 5 attempts: HTTP 404",
    "WBAH agent not found",
  ])("does not retry %s", (msg) => {
    expect(isTransientError(msg)).toBe(false);
  });
});

describe("wbahUnsafeStepsFromRows", () => {
  it("holds back unsafe steps that already ran", () => {
    expect(
      wbahUnsafeStepsFromRows([
        { step: "format_data", skipped: null },
        { step: "calendly_invitee", skipped: null },
        { step: "dynamics_allens", skipped: null },
      ]),
    ).toEqual(["calendly_invitee"]);
  });

  it("ignores skipped runs of those steps and steps that never ran", () => {
    expect(
      wbahUnsafeStepsFromRows([
        { step: "calendly_invitee", skipped: "true" },
        { step: null, skipped: null },
      ]),
    ).toEqual([]);
  });
});
