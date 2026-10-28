/**
 * One WBAH post-call pipeline: the entry point decides whether and how a call is processed, and
 * every new-lead / TTC / DQ call then runs the workflow on the automation engine. The hand-written
 * second copy of the steps is gone, so a fix can no longer land in only one of them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  workflow: [] as Array<Record<string, unknown>>,
  rebook: 0,
  live: 0,
  config: { name: "WBAH", workflow_kind: "wbah_post_call", steps: [] as Array<Record<string, unknown>> },
}));

vi.mock("@/lib/automation-engine/plugins/wbah/wbah-automation-pipeline.server", () => ({
  runWbahPostCallWorkflow: vi.fn(async (input: Record<string, unknown>) => {
    seen.workflow.push(input);
    return { handled: true, message: "completed (automation engine)", branches: ["dynamics_allens"], errors: [] };
  }),
}));
vi.mock("@/lib/wbah/workflow/wbah-workflow-resolver.server", () => ({
  resolveWbahPostCallWorkflowConfig: vi.fn(async () => seen.config),
}));
vi.mock("@/lib/wbah/post-call/wbah-rebook-post-call.server", () => ({
  runWbahRebookPostCallPipeline: vi.fn(async () => {
    seen.rebook += 1;
    return { handled: true, message: "rebook", branches: [], errors: [] };
  }),
}));
vi.mock("@/lib/wbah/post-call/wbah-live-transcript.server", () => ({
  handleWbahLiveTranscript: vi.fn(async () => {
    seen.live += 1;
  }),
}));

import { runWbahPostCallPipelineCore } from "@/lib/wbah/post-call/wbah-post-call.server";

const agent = { workspaceId: "ws", agentName: "New Leads", role: "new_leads" } as any;

function input(over: Record<string, unknown> = {}) {
  return {
    event: "call_analyzed",
    call: { call_id: "call_1", agent_id: "agent_1", call_type: "phone_call" },
    payload: {},
    agent,
    ...over,
  } as any;
}

describe("WBAH post-call entry", () => {
  beforeEach(() => {
    vi.stubEnv("WBAH_POST_CALL_ENABLED", "true");
    seen.workflow = [];
    seen.rebook = 0;
    seen.live = 0;
    seen.config = {
      name: "WBAH",
      workflow_kind: "wbah_post_call",
      steps: [
        { id: "live_transcript", enabled: true },
        { id: "calendly_invitee", enabled: true },
      ],
    };
  });

  it("runs every new-lead call on the automation engine, with the job id and per-run steps off", async () => {
    const res = await runWbahPostCallPipelineCore(
      input({ wbahJobId: "job-1", skipLiveTranscript: true, disabledStepIds: ["calendly_invitee"] }),
    );
    expect(res.branches).toEqual(["dynamics_allens"]);
    expect(seen.workflow).toHaveLength(1);
    const ran = seen.workflow[0]!;
    expect(ran.wbahJobId).toBe("job-1");
    expect(ran.skipLiveTranscript).toBe(true);
    const steps = (ran.wfConfig as { steps: Array<{ id: string; enabled: boolean }> }).steps;
    expect(steps.find((s) => s.id === "calendly_invitee")?.enabled).toBe(false);
    expect(steps.find((s) => s.id === "live_transcript")?.enabled).toBe(true);
  });

  it("ignores web calls", async () => {
    const res = await runWbahPostCallPipelineCore(input({ call: { call_type: "web_call" } }));
    expect(res.message).toBe("ignored: web call");
    expect(seen.workflow).toHaveLength(0);
  });

  it("sends rebooking agents to their own pipeline", async () => {
    await runWbahPostCallPipelineCore(input({ agent: { ...agent, role: "rebooking" } }));
    expect(seen.rebook).toBe(1);
    expect(seen.workflow).toHaveLength(0);
  });

  it("only mirrors the live transcript when post-call execution is switched off", async () => {
    vi.stubEnv("WBAH_POST_CALL_ENABLED", "false");
    const res = await runWbahPostCallPipelineCore(input({ event: "call_started" }));
    expect(res.branches).toEqual(["live_transcript"]);
    expect(seen.live).toBe(1);
    expect(seen.workflow).toHaveLength(0);
  });
});
