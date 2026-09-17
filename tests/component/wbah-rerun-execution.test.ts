import { describe, expect, it } from "vitest";
import {
  applyDisabledStepIds,
  isStepEnabledInOrder,
} from "@/lib/wbah/workflow/wbah-workflow-graph.shared";
import { defaultWbahPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import { WBAH_RERUN_UNSAFE_STEP_IDS } from "@/lib/wbah/post-call/wbah-post-call-queue.server";

describe("WBAH_RERUN_UNSAFE_STEP_IDS", () => {
  it("holds back the steps a replay must not repeat", () => {
    // calendly_invitee calls createWbahCalendlyInvitee, which is not
    // idempotent — replaying it books the customer a second appointment.
    expect(WBAH_RERUN_UNSAFE_STEP_IDS).toContain("calendly_invitee");
    expect(WBAH_RERUN_UNSAFE_STEP_IDS).toContain("live_transcript");
  });

  it("does not hold back the CRM writes, which are the point of a rerun", () => {
    for (const step of ["dynamics_allens", "dynamics_agentic"]) {
      expect(WBAH_RERUN_UNSAFE_STEP_IDS).not.toContain(step);
    }
  });
});

describe("applyDisabledStepIds", () => {
  it("turns off exactly the named steps and leaves the rest alone", () => {
    const cfg = defaultWbahPostCallWorkflowConfig() as never as {
      steps: Array<{ id: string; type?: string; enabled?: boolean }>;
    };
    const enabledBefore = cfg.steps.filter((s) => s.enabled).map((s) => s.id);
    expect(enabledBefore).toContain("calendly_invitee");

    const gated = applyDisabledStepIds(cfg, ["calendly_invitee"]);
    expect(gated.steps.find((s) => s.id === "calendly_invitee")?.enabled).toBe(false);
    for (const id of enabledBefore.filter((i) => i !== "calendly_invitee")) {
      expect(gated.steps.find((s) => s.id === id)?.enabled).toBe(true);
    }
  });

  it("feeds through to the gate the pipeline actually reads", () => {
    const cfg = defaultWbahPostCallWorkflowConfig();
    expect(isStepEnabledInOrder(cfg, "calendly_invitee", "call_analyzed")).toBe(true);

    const gated = applyDisabledStepIds(cfg as never, [...WBAH_RERUN_UNSAFE_STEP_IDS]) as never;
    expect(isStepEnabledInOrder(gated, "calendly_invitee", "call_analyzed")).toBe(false);
    // The CRM branches are what a rerun exists to replay — still on.
    expect(isStepEnabledInOrder(gated, "dynamics_allens", "call_analyzed")).toBe(true);
    expect(isStepEnabledInOrder(gated, "dynamics_agentic", "call_analyzed")).toBe(true);
  });

  it("never mutates the config it was handed", () => {
    const cfg = defaultWbahPostCallWorkflowConfig();
    applyDisabledStepIds(cfg as never, ["calendly_invitee"]);
    expect(isStepEnabledInOrder(cfg, "calendly_invitee", "call_analyzed")).toBe(true);
  });

  it("is a no-op for an empty or missing list", () => {
    const cfg = defaultWbahPostCallWorkflowConfig() as never as {
      steps: Array<{ id: string; enabled?: boolean }>;
    };
    expect(applyDisabledStepIds(cfg, [])).toBe(cfg);
    expect(applyDisabledStepIds(cfg, undefined)).toBe(cfg);
  });

  it("matches on step type as well as id, so either spelling gates the step", () => {
    const cfg = {
      steps: [
        { id: "step-1", type: "calendly_invitee", enabled: true },
        { id: "step-2", type: "dynamics_allens", enabled: true },
      ],
    };
    const gated = applyDisabledStepIds(cfg, ["calendly_invitee"]);
    expect(gated.steps[0]!.enabled).toBe(false);
    expect(gated.steps[1]!.enabled).toBe(true);
  });
});
