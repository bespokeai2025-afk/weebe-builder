/**
 * Cross-Mind orchestration (executive_operator) — e2e against real DB.
 *
 * Verifies:
 *   • executive_operator is a valid, operator-class mode
 *   • run_orchestration_playbook is internal (non-sensitive) + operator "tasks" category
 *   • mode gates: observe blocks; auto trigger requires executive_operator
 *   • lead_not_followed_up playbook detects a stale qualified lead, writes a
 *     completed run row, creates linked hivemind_tasks with dependencies +
 *     evidence, and raises escalation events
 *   • dedup: second run does not duplicate open tasks
 *   • no findings → "no_findings" run, no tasks
 *   • workspace isolation of runs
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  HIVEMIND_MODES,
  isOperatorClassMode,
  INTERNAL_ACTION_TYPES,
  ACTION_OPERATOR_CATEGORY,
  isSensitiveActionType,
} from "@/lib/hivemind/action-safety.shared";
import {
  runOrchestrationPlaybook,
  listOrchestrationRuns,
  ORCHESTRATION_PLAYBOOKS,
} from "@/lib/hivemind/orchestration.server";

const wsA = randomUUID();
const wsB = randomUUID();
const sb = supabaseAdmin;

async function setMode(ws: string, mode: string) {
  await sb.from("workspace_settings").upsert(
    { workspace_id: ws, hivemind_mode: mode },
    { onConflict: "workspace_id" },
  );
}

let leadId: string | null = null;

beforeAll(async () => {
  const { data: profiles, error: pErr } = await sb.from("profiles").select("user_id").limit(1);
  if (pErr || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  const ownerUserId = profiles[0].user_id;
  for (const ws of [wsA, wsB]) {
    const { error } = await sb.from("workspaces").insert({
      id: ws,
      name: `orch-e2e-${ws.slice(0, 8)}`,
      slug: `orch-e2e-${ws.slice(0, 8)}`,
      owner_id: ownerUserId,
    });
    if (error) throw new Error(`workspace fixture: ${error.message}`);
  }
  await setMode(wsA, "executive_operator");
  await setMode(wsB, "executive_operator");
  const old = new Date(Date.now() - 6 * 86400_000).toISOString();
  const { data, error } = await sb.from("leads").insert({
    workspace_id: wsA,
    full_name: "Orch E2E Stale Lead",
    phone: "+15550001234",
    status: "qualified",
    source: "website",
    created_at: old,
    updated_at: old,
  }).select("id").single();
  if (error) throw new Error(`lead fixture: ${error.message}`);
  leadId = data.id;
  // A DB trigger bumps leads.updated_at on every write, so PostgREST cannot
  // fabricate a stale timestamp — force it via the Management API SQL runner.
  const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const projectRef = new URL(url).hostname.split(".")[0];
  if (!mgmtToken) throw new Error("SUPABASE_ACCESS_TOKEN required to create stale-lead fixture");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${mgmtToken}` },
    body: JSON.stringify({ query: `SET session_replication_role = replica; UPDATE leads SET updated_at = '${old}' WHERE id = '${leadId}'; SET session_replication_role = DEFAULT;` }),
  });
  if (!res.ok) throw new Error(`stale-lead fixture SQL failed: ${res.status}`);
}, 60_000);

afterAll(async () => {
  for (const ws of [wsA, wsB]) {
    await sb.from("hivemind_tasks").delete().eq("workspace_id", ws);
    await sb.from("hivemind_executive_events").delete().eq("workspace_id", ws);
    await sb.from("hivemind_orchestration_runs").delete().eq("workspace_id", ws);
    await sb.from("leads").delete().eq("workspace_id", ws);
    await sb.from("workspace_settings").delete().eq("workspace_id", ws);
    await sb.from("workspaces").delete().eq("id", ws);
  }
});

describe("mode + classification", () => {
  it("executive_operator is a valid operator-class mode", () => {
    expect(HIVEMIND_MODES).toContain("executive_operator");
    expect(isOperatorClassMode("executive_operator")).toBe(true);
    expect(isOperatorClassMode("recommend")).toBe(false);
  });

  it("run_orchestration_playbook is internal, non-sensitive, tasks category", () => {
    expect(INTERNAL_ACTION_TYPES.has("run_orchestration_playbook")).toBe(true);
    expect(isSensitiveActionType("run_orchestration_playbook")).toBe(false);
    expect(ACTION_OPERATOR_CATEGORY["run_orchestration_playbook"]).toBe("tasks");
  });

  it("all 3 playbooks are defined", () => {
    expect(Object.keys(ORCHESTRATION_PLAYBOOKS).sort()).toEqual([
      "campaign_underperforming", "invoice_missing", "lead_not_followed_up",
    ]);
  });
});

describe("mode gates", () => {
  it("observe mode blocks manual runs", async () => {
    await setMode(wsA, "observe");
    const r = await runOrchestrationPlaybook(sb, wsA, "lead_not_followed_up", { triggerSource: "manual" });
    expect(r.ok).toBe(false);
    await setMode(wsA, "executive_operator");
  });

  it("recommend and assistant modes block manual runs", async () => {
    for (const m of ["recommend", "assistant"] as const) {
      await setMode(wsA, m);
      const r = await runOrchestrationPlaybook(sb, wsA, "lead_not_followed_up", { triggerSource: "manual" });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Operator/i);
    }
    await setMode(wsA, "executive_operator");
  });

  it("auto trigger requires executive_operator", async () => {
    await setMode(wsA, "operator");
    const r = await runOrchestrationPlaybook(sb, wsA, "lead_not_followed_up", { triggerSource: "auto" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Executive Operator/i);
    await setMode(wsA, "executive_operator");
  });
});

describe("lead_not_followed_up playbook", () => {
  it("detects stale lead, creates run + linked tasks + escalations", async () => {
    const r = await runOrchestrationPlaybook(sb, wsA, "lead_not_followed_up", { triggerSource: "auto" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("completed");
    expect(r.findings).toBeGreaterThanOrEqual(1);
    expect(r.taskIds.length).toBeGreaterThanOrEqual(1);
    expect(r.runId).toBeTruthy();

    const { data: run } = await sb.from("hivemind_orchestration_runs")
      .select("*").eq("id", r.runId!).single();
    expect(run.workspace_id).toBe(wsA);
    expect(run.playbook).toBe("lead_not_followed_up");
    expect(run.recommendation).toBeTruthy();

    const { data: tasks } = await sb.from("hivemind_tasks")
      .select("*").in("id", r.taskIds);
    expect((tasks ?? []).length).toBe(r.taskIds.length);
    for (const t of tasks ?? []) {
      expect(t.workspace_id).toBe(wsA);
      expect(t.status).toBe("suggested");
      expect(t.trigger_type).toBe("orchestration_lead_not_followed_up");
    }
    const withDeps = (tasks ?? []).filter(
      (t: any) => Array.isArray(t.dependencies) && t.dependencies.length > 0,
    );
    expect(withDeps.length).toBeGreaterThanOrEqual(1);

    const { data: events } = await sb.from("hivemind_executive_events")
      .select("event_type").eq("workspace_id", wsA);
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("second run dedups against open tasks", async () => {
    const { count: before } = await sb.from("hivemind_tasks")
      .select("id", { count: "exact", head: true }).eq("workspace_id", wsA);
    const r2 = await runOrchestrationPlaybook(sb, wsA, "lead_not_followed_up", { triggerSource: "manual" });
    expect(r2.ok).toBe(true);
    const { count: after } = await sb.from("hivemind_tasks")
      .select("id", { count: "exact", head: true }).eq("workspace_id", wsA);
    expect(after).toBe(before);
  });

  it("no findings in a clean workspace → no_findings, no tasks", async () => {
    const r = await runOrchestrationPlaybook(sb, wsB, "lead_not_followed_up", { triggerSource: "manual" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("no_findings");
    expect(r.taskIds.length).toBe(0);
  });

  it("runs are workspace-isolated", async () => {
    const a = await listOrchestrationRuns(sb, wsA);
    const b = await listOrchestrationRuns(sb, wsB);
    expect(a.runs.every((x: any) => x.playbook)).toBe(true);
    expect(a.runs.length).toBeGreaterThanOrEqual(1);
    expect(b.runs.length).toBeGreaterThanOrEqual(1);
    const idsA = new Set(a.runs.map((x: any) => x.id));
    for (const rb of b.runs) expect(idsA.has(rb.id)).toBe(false);
  });
});
