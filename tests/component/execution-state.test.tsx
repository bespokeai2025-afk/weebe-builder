import { describe, it, expect } from "vitest";
import {
  EXECUTION_TRANSITIONS,
  EXECUTION_STATUS_LABELS,
  TERMINAL_EXECUTION_STATES,
  canTransition,
  assertTransition,
  stepUpdate,
  executableKindMeta,
  type ExecutionStatus,
  type ExecutionStep,
} from "@/lib/hivemind/execution-state.shared";

describe("execution state machine", () => {
  it("terminal states have no outgoing transitions", () => {
    for (const s of TERMINAL_EXECUTION_STATES) {
      expect(EXECUTION_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("every state and transition target is a known state with a label", () => {
    const states = Object.keys(EXECUTION_TRANSITIONS) as ExecutionStatus[];
    for (const from of states) {
      expect(EXECUTION_STATUS_LABELS[from]).toBeTruthy();
      for (const to of EXECUTION_TRANSITIONS[from]) {
        expect(states).toContain(to);
      }
    }
    expect(EXECUTION_STATUS_LABELS.draft).toBe("Draft");
    expect(EXECUTION_STATUS_LABELS.awaiting_approval).toBe("Awaiting Approval");
  });

  it("allows the happy path queued → executing → verifying → completed", () => {
    expect(canTransition("queued", "executing")).toBe(true);
    expect(canTransition("executing", "verifying")).toBe(true);
    expect(canTransition("verifying", "completed")).toBe(true);
  });

  it("allows the approval-pause path and partial completion", () => {
    expect(canTransition("executing", "awaiting_action_approval")).toBe(true);
    expect(canTransition("awaiting_action_approval", "partially_completed")).toBe(true);
  });

  it("rejects illegal transitions (no resurrection of terminal states)", () => {
    expect(canTransition("completed", "executing")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(() => assertTransition("completed", "queued")).toThrow(/Illegal execution transition/);
  });

  it("blocked is retryable back to queued", () => {
    expect(canTransition("blocked", "queued")).toBe(true);
  });
});

describe("stepUpdate", () => {
  const steps: ExecutionStep[] = [
    { key: "a", label: "A", status: "pending" },
    { key: "b", label: "B", status: "pending" },
  ];

  it("stamps started_at when a step starts running", () => {
    const next = stepUpdate(steps, "a", { status: "running" });
    expect(next[0].status).toBe("running");
    expect(next[0].started_at).toBeTruthy();
    expect(next[1]).toEqual(steps[1]);
  });

  it("stamps finished_at on terminal step statuses and preserves detail", () => {
    const running = stepUpdate(steps, "a", { status: "running" });
    const done = stepUpdate(running, "a", { status: "done", detail: "ok" });
    expect(done[0].finished_at).toBeTruthy();
    expect(done[0].detail).toBe("ok");
    const blocked = stepUpdate(steps, "b", { status: "blocked" });
    expect(blocked[1].finished_at).toBeTruthy();
  });

  it("does not mutate the input array", () => {
    const copy = JSON.parse(JSON.stringify(steps));
    stepUpdate(steps, "a", { status: "done" });
    expect(steps).toEqual(copy);
  });
});

describe("executableKindMeta", () => {
  it("returns registered kind meta", () => {
    const meta = executableKindMeta("growthmind.gads_campaign_analysis");
    expect(meta?.mind).toBe("growthmind");
    expect(meta?.requiredActionKey).toBe("growthmind.view");
  });

  it("returns null for unknown or empty kinds", () => {
    expect(executableKindMeta("nope.kind")).toBeNull();
    expect(executableKindMeta(null)).toBeNull();
    expect(executableKindMeta(undefined)).toBeNull();
  });
});
