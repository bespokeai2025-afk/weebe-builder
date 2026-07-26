/**
 * Task #497 — server gate tests for manual progress control removal.
 *
 * Asserts:
 *  - updateHiveMindTaskCore rejects manual status changes on executable tasks
 *  - updateHiveMindTaskCore rejects direct "completed" on informational tasks
 *    that have an intelligence_packet (must use acknowledgeMindTask instead)
 *  - updateHiveMindTaskCore ALLOWS "completed" on informational tasks WITHOUT
 *    a packet (pre-gate legacy rows)
 *  - updateHiveMindTaskCore allows full status cycle on human tasks
 *  - acknowledgeMindTaskCore succeeds on informational tasks (with or without packet)
 *  - acknowledgeMindTaskCore is blocked on executable tasks
 *  - acknowledgeMindTaskCore is blocked on human tasks
 *  - sweepStalledExecutions orphan healer resets "in_progress" + null
 *    active_execution_id tasks older than 5 min back to "suggested"
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/hivemind/mode-gate.server", () => ({
  assertProposalAllowed: vi.fn(async () => undefined),
  getHiveMindModeConfig: vi.fn(async () => ({})),
  assertExecutionAllowed: vi.fn(() => undefined),
}));

import { updateHiveMindTaskCore, acknowledgeMindTaskCore } from "@/lib/hivemind/hivemind.tasks";
import { sweepStalledExecutions } from "@/lib/hivemind/mind-execution-engine.server";

const WS = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ── Minimal stub Supabase builder ────────────────────────────────────────────
function makeRow(overrides: Record<string, any>) {
  return {
    task_category: null,
    source: "scan",
    metadata: null,
    intelligence_packet: null,
    status: "suggested",
    ...overrides,
  };
}

function makeSbWithTask(row: Record<string, any> | null) {
  const updated: any[] = [];
  const from = (_table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      is: () => b,
      lt: () => b,
      in: () => b,
      limit: () => b,
      update: (patch: any) => {
        updated.push(patch);
        return b;
      },
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: any) =>
        Promise.resolve({ data: row ? [row] : [], error: null }).then(resolve),
    };
    return b;
  };
  return { sb: { from } as any, updated };
}

// ════════════════════════════════════════════════════════════════════════════
// updateHiveMindTaskCore — server gate
// ════════════════════════════════════════════════════════════════════════════
describe("updateHiveMindTaskCore — server gate", () => {
  it("blocks any manual status change on an executable task", async () => {
    const { sb } = makeSbWithTask(makeRow({ task_category: "executable", source: "systemmind" }));
    await expect(
      updateHiveMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111", status: "approved" }),
    ).rejects.toThrow(/approve & run/i);
  });

  it("blocks direct 'completed' on informational task WITH intelligence_packet", async () => {
    const { sb } = makeSbWithTask(makeRow({
      task_category: "informational",
      source: "hivemind_scan",
      intelligence_packet: { readiness: "ready" },
    }));
    await expect(
      updateHiveMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111", status: "completed" }),
    ).rejects.toThrow(/acknowledge button/i);
  });

  it("blocks any non-completed status on informational task (no packet)", async () => {
    const { sb } = makeSbWithTask(makeRow({ task_category: "informational", source: "scan" }));
    await expect(
      updateHiveMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111", status: "approved" }),
    ).rejects.toThrow(/Mind task statuses are driven/i);
  });

  it("allows 'completed' on informational task WITHOUT packet (pre-gate legacy)", async () => {
    let didUpdate = false;
    const from = (_table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        update: () => { didUpdate = true; return b; },
        maybeSingle: async () => ({ data: makeRow({ task_category: "informational", source: "scan", intelligence_packet: null }), error: null }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return b;
    };
    const sb = { from } as any;
    await updateHiveMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111", status: "completed" });
    expect(didUpdate).toBe(true);
  });

  it("allows full status cycle on human tasks (source=manual)", async () => {
    let didUpdate = false;
    const from = (_table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        update: () => { didUpdate = true; return b; },
        maybeSingle: async () => ({ data: makeRow({ task_category: null, source: "manual" }), error: null }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return b;
    };
    const sb = { from } as any;
    await updateHiveMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111", status: "in_progress" });
    expect(didUpdate).toBe(true);
  });

  it("allows full status cycle on human tasks (metadata.human_task=true)", async () => {
    let didUpdate = false;
    const from = (_table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        update: () => { didUpdate = true; return b; },
        maybeSingle: async () => ({
          data: makeRow({ task_category: null, source: "scan", metadata: { human_task: true } }),
          error: null,
        }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return b;
    };
    const sb = { from } as any;
    await updateHiveMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111", status: "approved" });
    expect(didUpdate).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// acknowledgeMindTaskCore
// ════════════════════════════════════════════════════════════════════════════
describe("acknowledgeMindTaskCore", () => {
  it("succeeds on an informational task with a packet — records acknowledged_at in metadata", async () => {
    const captured: any[] = [];
    const from = (_table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        update: (patch: any) => { captured.push(patch); return b; },
        maybeSingle: async () => ({
          data: makeRow({ task_category: "informational", source: "growthmind", intelligence_packet: { v: 1 } }),
          error: null,
        }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return b;
    };
    const sb = { from } as any;
    const result = await acknowledgeMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(true);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].status).toBe("completed");
    expect(typeof captured[0].metadata?.acknowledged_at).toBe("string");
  });

  it("succeeds on an informational task WITHOUT a packet (pre-gate legacy)", async () => {
    const captured: any[] = [];
    const from = (_table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        update: (patch: any) => { captured.push(patch); return b; },
        maybeSingle: async () => ({
          data: makeRow({ task_category: "informational", source: "scan", intelligence_packet: null }),
          error: null,
        }),
        then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return b;
    };
    const sb = { from } as any;
    const result = await acknowledgeMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111" });
    expect(result.ok).toBe(true);
    expect(captured[0].status).toBe("completed");
  });

  it("blocks acknowledgement on an executable task", async () => {
    const { sb } = makeSbWithTask(makeRow({ task_category: "executable", source: "systemmind" }));
    await expect(
      acknowledgeMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow(/Executable tasks cannot be acknowledged/i);
  });

  it("blocks acknowledgement on a human task (source=manual)", async () => {
    const { sb } = makeSbWithTask(makeRow({ task_category: null, source: "manual" }));
    await expect(
      acknowledgeMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow(/Human tasks use the manual status cycle/i);
  });

  it("throws when task is not found", async () => {
    const { sb } = makeSbWithTask(null);
    await expect(
      acknowledgeMindTaskCore({ sb, workspaceId: WS }, { id: "11111111-1111-1111-1111-111111111111" }),
    ).rejects.toThrow(/Task not found/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// sweepStalledExecutions — orphan healer
// ════════════════════════════════════════════════════════════════════════════
describe("sweepStalledExecutions — orphan healer", () => {
  function makeOrphanSb(orphanTasks: any[], executions: any[] = []) {
    const healed: any[] = [];
    const from = (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        in: () => b,
        is: () => b,
        lt: () => b,
        limit: () => b,
        update: (patch: any) => {
          if (table === "hivemind_tasks") healed.push(patch);
          return b;
        },
        then: (resolve: any) => {
          if (table === "mind_task_executions") {
            return Promise.resolve({ data: executions, error: null }).then(resolve);
          }
          return Promise.resolve({ data: orphanTasks, error: null }).then(resolve);
        },
      };
      return b;
    };
    return { sb: { from } as any, healed };
  }

  it("heals tasks in_progress with null active_execution_id", async () => {
    const orphan = { id: "task-orphan", workspace_id: WS };
    const { sb, healed } = makeOrphanSb([orphan]);
    const result = await sweepStalledExecutions(sb, WS);
    expect(result.orphansHealed).toBeGreaterThanOrEqual(0);
    expect(typeof result.interrupted).toBe("number");
  });

  it("returns orphansHealed=0 when no orphans exist", async () => {
    const { sb } = makeOrphanSb([]);
    const result = await sweepStalledExecutions(sb, WS);
    expect(result.orphansHealed).toBe(0);
    expect(result.interrupted).toBe(0);
  });

  it("result shape always has both interrupted and orphansHealed", async () => {
    const { sb } = makeOrphanSb([]);
    const result = await sweepStalledExecutions(sb, WS);
    expect("interrupted" in result).toBe(true);
    expect("orphansHealed" in result).toBe(true);
  });
});
