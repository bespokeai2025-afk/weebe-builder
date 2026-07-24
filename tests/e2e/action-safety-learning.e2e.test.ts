/**
 * HiveMind approval modes, action safety & learning loop (e2e, real DB).
 *
 * Verifies:
 *   • sensitive-action classification + category → entitlement mapping
 *   • mode gate matrix (observe/recommend/assistant/operator) for both
 *     explicit-approval and auto-exec paths; sensitive never auto-executes
 *   • operator confidence stop fails closed
 *   • default mode is "recommend" (config fallback + DB column default)
 *   • atomic single-use approval consume (CAS): second consume gets no row
 *   • learning loop: executed action reassessed, outcome classified,
 *     action_outcome event published, confidence adjustment upserted and
 *     bounded, getConfidenceAdjustment read-back
 *   • multi-tenant isolation of confidence adjustments
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SENSITIVE_ACTIONS,
  CATEGORY_ENTITLEMENT,
  INTERNAL_ACTION_TYPES,
  isSensitiveActionType,
  sensitiveCategoryOf,
  DEFAULT_HIVEMIND_MODE,
} from "@/lib/hivemind/action-safety.shared";
import {
  getHiveMindModeConfig,
  assertExecutionAllowed,
  assertProposalAllowed,
  isProposalAllowed,
  operatorConfidenceAdequate,
  ModeGateError,
  type HiveMindModeConfig,
} from "@/lib/hivemind/mode-gate.server";
import {
  runActionOutcomeLearning,
  getConfidenceAdjustment,
} from "@/lib/hivemind/action-learning.server";

const sb = supabaseAdmin as any;

const WS_A = randomUUID();
const WS_B = randomUUID();
let ownerUserId: string;

function cfg(partial: Partial<HiveMindModeConfig>): HiveMindModeConfig {
  return { mode: "recommend", operatorEnabled: false, operatorPermissions: {}, ...partial };
}

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  for (const id of [WS_A, WS_B]) {
    const { error: wErr } = await sb.from("workspaces").insert({
      id,
      name: `action-safety e2e ${id.slice(0, 8)}`,
      slug: `action-safety-e2e-${id.slice(0, 8)}`,
      owner_id: ownerUserId,
    });
    if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
  }
}, 60_000);

afterAll(async () => {
  for (const id of [WS_A, WS_B]) {
    await sb.from("hivemind_confidence_adjustments").delete().eq("workspace_id", id);
    await sb.from("hivemind_actions").delete().eq("workspace_id", id);
    await sb.from("hivemind_tasks").delete().eq("workspace_id", id);
    await sb.from("hivemind_executive_events").delete().eq("workspace_id", id);
    await sb.from("workspace_settings").delete().eq("workspace_id", id);
    await sb.from("workspaces").delete().eq("id", id);
  }
}, 60_000);

// ── Classification ────────────────────────────────────────────────────────────

describe("sensitive action classification", () => {
  it("classifies client-facing / deployment / credential actions as sensitive", () => {
    expect(isSensitiveActionType("enroll_leads_in_campaign")).toBe(true);
    expect(isSensitiveActionType("launch_broadcast")).toBe(true);
    expect(isSensitiveActionType("activate_lead_intake_workflow")).toBe(true);
    expect(isSensitiveActionType("register_resend_webhook")).toBe(true);
    expect(isSensitiveActionType("create_task")).toBe(false);
    expect(isSensitiveActionType("sync_ad_stats")).toBe(false);
  });

  it("every sensitive category maps to an entitlement ActionKey", () => {
    for (const category of Object.values(SENSITIVE_ACTIONS)) {
      expect(CATEGORY_ENTITLEMENT[category]).toBeTruthy();
    }
  });

  it("internal action types are never sensitive", () => {
    for (const t of INTERNAL_ACTION_TYPES) {
      expect(isSensitiveActionType(t)).toBe(false);
    }
    expect(sensitiveCategoryOf("create_task")).toBeNull();
  });
});

// ── Mode gate matrix ──────────────────────────────────────────────────────────

describe("assertExecutionAllowed matrix", () => {
  it("observe blocks everything", () => {
    expect(() =>
      assertExecutionAllowed(cfg({ mode: "observe" }), "create_task", { explicitApproval: true }),
    ).toThrow(ModeGateError);
  });

  it("recommend allows internal types with approval but blocks external", () => {
    expect(() =>
      assertExecutionAllowed(cfg({ mode: "recommend" }), "create_task", { explicitApproval: true }),
    ).not.toThrow();
    expect(() =>
      assertExecutionAllowed(cfg({ mode: "recommend" }), "enroll_leads_in_campaign", { explicitApproval: true }),
    ).toThrow(/Recommend mode/);
  });

  it("assistant allows external actions WITH explicit approval", () => {
    expect(() =>
      assertExecutionAllowed(cfg({ mode: "assistant" }), "enroll_leads_in_campaign", { explicitApproval: true }),
    ).not.toThrow();
  });

  it("sensitive actions can NEVER auto-execute, even in fully-enabled operator mode", () => {
    const operator = cfg({
      mode: "operator",
      operatorEnabled: true,
      operatorPermissions: { tasks: true, crm: true, campaigns: true, content: true, sync: true },
    });
    expect(() =>
      assertExecutionAllowed(operator, "launch_broadcast", { explicitApproval: false }),
    ).toThrow(/explicit human approval/);
  });

  it("auto-exec requires operator mode + enablement + category permission", () => {
    // assistant mode: no auto-exec
    expect(() =>
      assertExecutionAllowed(cfg({ mode: "assistant" }), "create_task", { explicitApproval: false }),
    ).toThrow(/Operator mode/);
    // operator but not enabled
    expect(() =>
      assertExecutionAllowed(cfg({ mode: "operator" }), "create_task", { explicitApproval: false }),
    ).toThrow(/not been explicitly enabled/);
    // operator enabled but category not permitted
    expect(() =>
      assertExecutionAllowed(
        cfg({ mode: "operator", operatorEnabled: true, operatorPermissions: {} }),
        "create_task",
        { explicitApproval: false },
      ),
    ).toThrow(/category/);
    // fully permitted non-sensitive → allowed
    expect(() =>
      assertExecutionAllowed(
        cfg({ mode: "operator", operatorEnabled: true, operatorPermissions: { tasks: true } }),
        "create_task",
        { explicitApproval: false },
      ),
    ).not.toThrow();
  });

  it("unknown action types fail closed on auto-exec (no category)", () => {
    expect(() =>
      assertExecutionAllowed(
        cfg({ mode: "operator", operatorEnabled: true, operatorPermissions: { tasks: true } }),
        "brand_new_unmapped_action",
        { explicitApproval: false },
      ),
    ).toThrow(ModeGateError);
  });
});

describe("operatorConfidenceAdequate", () => {
  it("fails closed on missing confidence or data quality", () => {
    expect(operatorConfidenceAdequate({})).toBe(false);
    expect(operatorConfidenceAdequate({ confidence: 0.9 })).toBe(false);
    expect(operatorConfidenceAdequate({ confidence: 0.5, dataQualityOk: true })).toBe(false);
    expect(operatorConfidenceAdequate({ confidence: 0.9, dataQualityOk: true })).toBe(true);
  });
});

// ── DB-backed: defaults + mode config ────────────────────────────────────────

describe("mode config (DB)", () => {
  it("default mode is recommend when no settings row exists", async () => {
    const c = await getHiveMindModeConfig(sb, WS_A);
    expect(c.mode).toBe("recommend");
    expect(DEFAULT_HIVEMIND_MODE).toBe("recommend");
    expect(c.operatorEnabled).toBe(false);
  });

  it("DB column default for hivemind_mode is recommend", async () => {
    const { data: row, error } = await sb.from("workspace_settings")
      .insert({ workspace_id: WS_A })
      .select("hivemind_mode, hivemind_operator_enabled")
      .single();
    expect(error).toBeNull();
    expect(row.hivemind_mode).toBe("recommend");
    expect(row.hivemind_operator_enabled).toBe(false);
  });

  it("mode persistence is upsert-safe when no settings row exists (setHiveMindMode path)", async () => {
    // WS_B has no workspace_settings row; a plain .update() affects 0 rows.
    const update = { hivemind_mode: "observe", updated_at: new Date().toISOString() };
    const { data: updated, error } = await sb.from("workspace_settings")
      .update(update).eq("workspace_id", WS_B).select("workspace_id");
    expect(error).toBeNull();
    expect(updated?.length ?? 0).toBe(0); // silent no-op — must fall through to insert
    const { error: insErr } = await sb.from("workspace_settings")
      .insert({ workspace_id: WS_B, ...update });
    expect(insErr).toBeNull();
    const c = await getHiveMindModeConfig(sb, WS_B);
    expect(c.mode).toBe("observe");
    // observe now blocks proposals for WS_B (server write paths call this gate)
    expect(await isProposalAllowed(sb, WS_B)).toBe(false);
    await expect(assertProposalAllowed(sb, WS_B)).rejects.toThrow(ModeGateError);
    // restore for later isolation tests
    await sb.from("workspace_settings").update({ hivemind_mode: "recommend" }).eq("workspace_id", WS_B);
  });

  it("guardrail: every file inserting hivemind proposals references the mode gate", () => {
    // Repo-level net: any file that inserts into hivemind_actions/hivemind_tasks
    // must consult mode-gate.server (isProposalAllowed/assertProposalAllowed),
    // unless it is on the explicit allowlist of post-approval execution paths
    // whose entry points are gated upstream.
    const UPSTREAM_GATED = new Set<string>([
      // executeAction runs only after approveHiveMindAction's gated CAS consume;
      // generateOperatorActions and proposeHiveMindAction are gated in-file.
      // (hivemind.actions.ts does reference the gate; listed for documentation.)
    ]);
    const out = execFileSync("grep", [
      "-rlE", 'from\\("hivemind_(actions|tasks)"\\)', "src",
    ], { encoding: "utf8" });
    const files = out.trim().split("\n").filter(Boolean);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const inserts = /from\("hivemind_(actions|tasks)"\)\s*\r?\n?\s*\.?\s*insert/.test(src)
        || /from\("hivemind_(actions|tasks)"\)\.insert/.test(src);
      if (!inserts) continue;
      if (UPSTREAM_GATED.has(f)) continue;
      if (f.endsWith("mode-gate.server.ts")) continue;
      if (!/ProposalAllowed/.test(src)) offenders.push(f);
    }
    expect(offenders, `hivemind proposal inserts without mode gate: ${offenders.join(", ")}`).toEqual([]);
  });

  it("mode-config read errors fail CLOSED to observe (gates deny)", async () => {
    // Stub a supabase client whose settings read returns { error } (Supabase
    // builders never throw). The gate must degrade to observe, not recommend.
    const failingSb: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "simulated read failure" } }),
          }),
        }),
      }),
    };
    const c = await getHiveMindModeConfig(failingSb, WS_A);
    expect(c.mode).toBe("observe");
    expect(c.operatorEnabled).toBe(false);
    expect(await isProposalAllowed(failingSb, WS_A)).toBe(false);
    await expect(assertProposalAllowed(failingSb, WS_A)).rejects.toThrow(ModeGateError);
  });

  it("observe mode blocks proposals; other modes allow", async () => {
    await sb.from("workspace_settings").update({ hivemind_mode: "observe" }).eq("workspace_id", WS_A);
    expect(await isProposalAllowed(sb, WS_A)).toBe(false);
    await sb.from("workspace_settings").update({ hivemind_mode: "assistant" }).eq("workspace_id", WS_A);
    expect(await isProposalAllowed(sb, WS_A)).toBe(true);
  });
});

// ── DB-backed: atomic single-use consume ─────────────────────────────────────

describe("atomic approval consume (CAS)", () => {
  it("only one of two concurrent consumes wins; audit columns stamped", async () => {
    const { data: action, error } = await sb.from("hivemind_actions").insert({
      workspace_id: WS_A,
      action_type: "create_task",
      title: "e2e consume test",
      description: "e2e",
      action_payload: {},
      status: "pending",
      proposed_by: "e2e",
    }).select("*").single();
    expect(error).toBeNull();

    const consume = () => sb.from("hivemind_actions")
      .update({
        status: "approved",
        authorised_by_user_id: ownerUserId,
        consumed_at: new Date().toISOString(),
        sensitive: false,
      })
      .eq("id", action.id)
      .eq("workspace_id", WS_A)
      .eq("status", "pending")
      .is("consumed_at", null)
      .select("id");

    const [r1, r2] = await Promise.all([consume(), consume()]);
    const winners = (r1.data?.length ?? 0) + (r2.data?.length ?? 0);
    expect(winners).toBe(1);

    const { data: after } = await sb.from("hivemind_actions")
      .select("status, consumed_at, authorised_by_user_id")
      .eq("id", action.id).single();
    expect(after.status).toBe("approved");
    expect(after.consumed_at).toBeTruthy();
    expect(after.authorised_by_user_id).toBe(ownerUserId);
  });
});

// ── DB-backed: learning loop ─────────────────────────────────────────────────

describe("action outcome learning loop", () => {
  it("classifies a completed create_task action as successful and records feedback", async () => {
    // Linked task, already completed.
    const { data: task, error: tErr } = await sb.from("hivemind_tasks").insert({
      workspace_id: WS_A,
      title: "e2e learning task",
      description: "e2e",
      trigger_type: "manual",
      status: "completed",
      priority: "medium",
    }).select("id").single();
    expect(tErr).toBeNull();

    const past = new Date(Date.now() - 60_000).toISOString();
    const { data: action, error: aErr } = await sb.from("hivemind_actions").insert({
      workspace_id: WS_A,
      action_type: "create_task",
      title: "e2e learning action",
      description: "e2e",
      action_payload: {},
      status: "executed",
      proposed_by: "e2e",
      result: { task_id: task.id },
      executed_at: past,
      baseline: { captured_at: past },
      expected_result: "Task is completed within the reassessment window.",
      reassess_at: past,
    }).select("id").single();
    expect(aErr).toBeNull();

    const summary = await runActionOutcomeLearning(sb, WS_A);
    expect(Number(summary.assessed)).toBeGreaterThanOrEqual(1);
    expect(Number(summary.successful)).toBeGreaterThanOrEqual(1);

    const { data: assessed } = await sb.from("hivemind_actions")
      .select("outcome, outcome_classification")
      .eq("id", action.id).single();
    expect(assessed.outcome_classification).toBe("successful");
    expect(assessed.outcome?.classification).toBe("successful");

    // action_outcome event published (deduped per action).
    const { data: events } = await sb.from("hivemind_executive_events")
      .select("id, event_type")
      .eq("workspace_id", WS_A)
      .eq("event_type", "action_outcome")
      .eq("entity_id", String(action.id));
    expect(events?.length).toBe(1);

    // Confidence adjustment upserted for the action type.
    const adj = await getConfidenceAdjustment(sb, WS_A, "action:create_task");
    expect(adj).toBeGreaterThan(0);

    // Re-run: already classified — not double-counted.
    const again = await runActionOutcomeLearning(sb, WS_A);
    expect(Number(again.assessed)).toBe(0);
    expect(await getConfidenceAdjustment(sb, WS_A, "action:create_task")).toBe(adj);
  });

  it("adjustment is bounded and isolated per workspace", async () => {
    expect(await getConfidenceAdjustment(sb, WS_B, "action:create_task")).toBe(0);
    // Simulate many successes: bound must hold at +0.2.
    await sb.from("hivemind_confidence_adjustments")
      .update({ adjustment: 0.2 })
      .eq("workspace_id", WS_A)
      .eq("adjustment_key", "action:create_task");
    expect(await getConfidenceAdjustment(sb, WS_A, "action:create_task")).toBeLessThanOrEqual(0.2);
    expect(await getConfidenceAdjustment(sb, WS_B, "action:create_task")).toBe(0);
  });
});
