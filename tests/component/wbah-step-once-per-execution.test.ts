import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  allens: [] as Array<string | null>,
  agentic: [] as Array<{ narrativeOwnedByAllens?: boolean } | undefined>,
  link: 0,
  invitee: 0,
  dashboard: [] as Array<string | null>,
}));

vi.mock("@/lib/automation-engine/plugins/wbah/wbah-step-handlers.server", () => ({
  wbahStepFormatData: () => ({ hasBookingSlot: true, structuredJsonOutput: { verified_details: {} } }),
  wbahStepLiveTranscript: vi.fn(async () => {}),
  wbahStepDashboardRaw: vi.fn(async () => {}),
  wbahStepCalendlyLink: vi.fn(async () => {
    calls.link += 1;
    return `https://calendly.example/link-${calls.link}`;
  }),
  wbahStepCalendlyInvitee: vi.fn(async () => {
    calls.invitee += 1;
  }),
  wbahStepDashboardAnalyzed: vi.fn(async (_b: unknown, _f: unknown, url: string | null) => {
    calls.dashboard.push(url);
  }),
  wbahStepCallsUpsert: vi.fn(async () => {}),
  wbahStepDynamicsAllens: vi.fn(async (_b: unknown, _f: unknown, url: string | null) => {
    calls.allens.push(url);
  }),
  wbahStepDynamicsAgentic: vi.fn(async (_b: unknown, _f: unknown, opts?: { narrativeOwnedByAllens?: boolean }) => {
    calls.agentic.push(opts);
  }),
}));

import {
  executeWbahCalendlyInvitee,
  executeWbahCalendlyLink,
  executeWbahDashboardAnalyzed,
  executeWbahDynamicsAgentic,
  executeWbahDynamicsAllens,
} from "@/lib/automation-engine/plugins/wbah/wbah-node-executors.server";
import type { NodeContext } from "@/lib/automation-engine/types/node.types";

function ctx(executionId: string, nodeId: string, json: Record<string, unknown> = {}): NodeContext {
  return {
    workflowId: "wf",
    executionId,
    nodeId,
    nodeType: "wbah.test",
    config: {},
    input: {
      json: {
        event: "call_analyzed",
        call: {
          call_id: "call_1",
          agent_id: "agent_0440750bb59597eef7352901bf",
          retell_llm_dynamic_variables: { lead_id: "lead-1" },
        },
        ...json,
      },
    },
    variables: {},
    globalVariables: {},
    nodeOutputs: {},
    env: {},
    secrets: {},
  } as unknown as NodeContext;
}

describe("WBAH steps run once per automation execution", () => {
  beforeEach(() => {
    vi.stubEnv("WBAH_POST_CALL_ENABLED", "true");
    calls.allens = [];
    calls.agentic = [];
    calls.link = 0;
    calls.invitee = 0;
    calls.dashboard = [];
  });

  it("runs Allen's Logic, the agentic PATCH and the invitee booking once however many nodes carry them", async () => {
    const run = "exec-once";
    for (const node of ["get-d365-token", "merge-token", "apply-allens-logic", "patch-dynamics-allen"]) {
      await executeWbahDynamicsAllens(ctx(run, node));
    }
    for (const node of ["get-structured-json", "get-all-valid-fields", "patch-dynamics-agentic"]) {
      await executeWbahDynamicsAgentic(ctx(run, node));
    }
    for (const node of ["wait-random-delay", "post-calendly-invitees"]) {
      await executeWbahCalendlyInvitee(ctx(run, node));
    }
    expect(calls.allens).toHaveLength(1);
    expect(calls.agentic).toEqual([{ narrativeOwnedByAllens: true }]);
    expect(calls.invitee).toBe(1);
  });

  it("creates one Calendly link per call, shared by Allen's, the link node and the dashboard", async () => {
    const run = "exec-link";
    await executeWbahDynamicsAllens(ctx(run, "get-d365-token"));
    const linkNode = await executeWbahCalendlyLink(ctx(run, "create-booking-link"));
    await executeWbahCalendlyLink(ctx(run, "build-slot-url"));
    await executeWbahDashboardAnalyzed(ctx(run, "post-dashboard-analyzed"));

    expect(calls.link).toBe(1);
    expect(calls.allens).toEqual(["https://calendly.example/link-1"]);
    expect(calls.dashboard).toEqual(["https://calendly.example/link-1"]);
    const out = linkNode.output as { json: { _wbah: { calendlyBookingUrl: string } } };
    expect(out.json._wbah.calendlyBookingUrl).toBe("https://calendly.example/link-1");
  });

  it("runs the steps again for a different execution (a manual rerun)", async () => {
    await executeWbahDynamicsAllens(ctx("exec-a", "get-d365-token"));
    await executeWbahDynamicsAllens(ctx("exec-b", "get-d365-token"));
    expect(calls.allens).toHaveLength(2);
  });
});
