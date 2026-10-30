/**
 * Workflow Builder workflows run on the automation engine: a saved step list converts to an
 * engine workflow that walks the same way the old engine did.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ updates: [] as Array<{ table: string; patch: Record<string, unknown> }> }));

vi.mock("@/integrations/supabase/client.server", () => {
  const chain = (table: string) => {
    const q: any = {
      update: (patch: Record<string, unknown>) => {
        db.updates.push({ table, patch });
        return q;
      },
      insert: () => q,
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
    };
    return q;
  };
  return { supabaseAdmin: { from: chain } };
});
vi.mock("@/lib/crm/crm-dispatch.server", () => ({ dispatchCrmPostCall: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/notification-engine.shared", () => ({ emitCampaignNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/whatsapp/wati-campaign.server", () => ({ normalizeWhatsAppPhone: (p: string) => p }));

import { runExecution } from "@/lib/automation-engine/runtime/execution-runner";
import { validateWorkflowDocument } from "@/lib/automation-engine/parser/parse-workflow";
import { stepListToAutomationDocument } from "@/lib/automation-engine/plugins/workflow-steps/register-workflow-step-nodes";
import { pickBranchCondition } from "@/lib/automation-engine/plugins/workflow-steps/workflow-step-handlers.server";

const flow = {
  steps: [
    { id: "t", type: "trigger", next: "b" },
    {
      id: "b",
      type: "branch",
      conditions: [
        { field: "score", op: "greater_than", value: 50, next: "hot" },
        { field: "score", op: "less_than", value: 51, next: "cold" },
      ],
    },
    { id: "hot", type: "update_lead_status", status: "qualified", next: "done" },
    { id: "cold", type: "update_lead_status", status: "nurture" },
    { id: "done", type: "stop_workflow" },
    { id: "orphan", type: "send_email" },
  ],
};

const run = (trigger: Record<string, unknown>) =>
  runExecution({
    workflow: stepListToAutomationDocument(flow, "Score router"),
    mode: "manual",
    trigger: { ...trigger, _workflow: { workspaceId: "ws-1", leadId: "lead-1" } },
  });

describe("stepListToAutomationDocument", () => {
  it("produces a valid engine workflow and leaves out steps nothing reaches", () => {
    const doc = stepListToAutomationDocument(flow, "Score router");
    expect(validateWorkflowDocument(doc)).toEqual({ valid: true, errors: [] });
    expect(doc.nodes.map((n) => n.id)).not.toContain("orphan");
  });

  it("an empty or broken step list still converts to a runnable workflow", () => {
    expect(validateWorkflowDocument(stepListToAutomationDocument({}, "Empty")).valid).toBe(true);
    const dangling = stepListToAutomationDocument({ steps: [{ id: "a", type: "send_email", next: "missing" }] }, "x");
    expect(validateWorkflowDocument(dangling).valid).toBe(true);
  });
});

describe("running on the engine", () => {
  beforeEach(() => {
    db.updates = [];
  });

  it("follows the matching branch and passes state on", async () => {
    const result = await run({ score: 80 });
    expect(result.status).toBe("completed");
    expect(result.log.map((e) => e.nodeId)).toEqual(["__start", "t", "b", "hot", "done"]);
    expect(db.updates).toEqual([{ table: "leads", patch: expect.objectContaining({ status: "qualified" }) }]);
    expect(result.output).toMatchObject({ score: 80, branch_taken: 0, new_status: "qualified" });
  });

  it("takes the other branch, ending where the step list ends", async () => {
    const result = await run({ score: 10 });
    expect(result.log.map((e) => e.nodeId)).toEqual(["__start", "t", "b", "cold", "__end"]);
    expect(db.updates[0]?.patch.status).toBe("nurture");
  });

  it("a step that needs a lead is skipped without one, and the run carries on", async () => {
    const result = await runExecution({
      workflow: stepListToAutomationDocument(
        { steps: [{ id: "s", type: "update_lead_status", status: "x", next: "e" }, { id: "e", type: "send_email" }] },
        "No lead",
      ),
      mode: "manual",
      trigger: { _workflow: { workspaceId: "ws-1" } },
    });
    expect(result.status).toBe("completed");
    expect(result.nodeOutputs.s?.[0]).toMatchObject({ json: { _skipped: "No lead_id in context" } });
    expect(db.updates).toHaveLength(0);
  });

  it("an unknown step type is skipped, not fatal", async () => {
    const result = await runExecution({
      workflow: stepListToAutomationDocument({ steps: [{ id: "x", type: "teleport" }] }, "Unknown"),
      mode: "manual",
      trigger: { _workflow: { workspaceId: "ws-1" } },
    });
    expect(result.status).toBe("completed");
    expect(result.nodeOutputs.x?.[0]).toMatchObject({ json: { _skipped: "Unknown step type: teleport" } });
  });
});

describe("pickBranchCondition", () => {
  it("falls back to the last condition when none match, as before", () => {
    const conds = [
      { field: "a", op: "equals" as const, value: 1, next: "x" },
      { field: "a", op: "equals" as const, value: 2, next: "y" },
    ];
    expect(pickBranchCondition(conds, { a: 1 })).toBe(0);
    expect(pickBranchCondition(conds, { a: 9 })).toBe(1);
  });
});
