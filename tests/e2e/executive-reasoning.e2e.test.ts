/**
 * Executive reasoning, prioritisation & evidence-backed recommendations (e2e, real DB).
 *
 * Verifies against the live schema:
 *   • deterministic multi-factor scoring bands (routine noise can never be critical)
 *   • the quality gate (vague drafts rejected, evidence-backed drafts pass)
 *   • volume caps (3 critical / 5 high / 12 total)
 *   • cross-department correlation rules fire on seeded signals
 *   • stale/disconnected sources reduce confidence deterministically
 *   • runExecutiveReasoning persists recommendations + tasks, dedupes on re-run
 *   • task accountability: completed task reopened when the signal persists
 *   • multi-tenant isolation (workspace B never sees workspace A's output)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computePriorityScore,
  compareToBaseline,
  timeWaitingFactor,
  buildEvidencePackage,
  adjustConfidenceForFreshness,
  validateExecRecDraft,
  capExecRecDrafts,
  runCorrelationRules,
  OPEN_REC_STATES,
  type ExecRecDraft,
} from "@/lib/hivemind/executive-reasoning.shared";
import { runExecutiveReasoning } from "@/lib/hivemind/executive-reasoning.server";
import { publishExecutiveEvent, classifyPendingExecutiveEvents } from "@/lib/hivemind/executive-events.shared";

const sb = supabaseAdmin as any;

const WS_A = randomUUID();
const WS_B = randomUUID();
let ownerUserId: string;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function mkDraft(overrides: Partial<ExecRecDraft> = {}): ExecRecDraft {
  return {
    title: "Recover 12 stale leads before intent decays",
    department: "crm",
    priority: "high",
    business_issue: "12 leads have waited more than 7 days without any first contact attempt.",
    evidence: buildEvidencePackage({
      workspaceId: WS_A,
      metrics: { staleLeads: 12, daysWaiting: 9 },
      sourceSystems: ["leads"],
      freshness: [{ source: "leads", status: "healthy", lastActivityAt: new Date().toISOString() }],
    }),
    commercial_impact: null,
    risk_of_inaction: "Conversion probability drops sharply after the first week.",
    recommended_action: "Assign the 12 untouched leads to an owner today and run the recovery call sequence, oldest first.",
    next_step: "Open the leads list filtered to need-to-call.",
    suggested_owner: null,
    due_date: null,
    approval_required: true,
    confidence: 0.8,
    correlation_key: null,
    dedupe_key: `test:${randomUUID()}`,
    reassess_at: null,
    source_event_ids: [],
    ...overrides,
  };
}

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  for (const id of [WS_A, WS_B]) {
    const { error: wErr } = await sb.from("workspaces").insert({
      id,
      name: `exec-reason e2e ${id.slice(0, 8)}`,
      slug: `exec-reason-e2e-${id.slice(0, 8)}`,
      owner_id: ownerUserId,
    });
    if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
  }
}, 60_000);

afterAll(async () => {
  for (const id of [WS_A, WS_B]) {
    await sb.from("workspaces").delete().eq("id", id);
  }
}, 60_000);

// ── Deterministic scoring ─────────────────────────────────────────────────────

describe("computePriorityScore", () => {
  it("routine noise can never be critical, even at high urgency", () => {
    const r = computePriorityScore({ operationalImpact: 1, urgency: 1, timeWaiting: 1, confidence: 1 });
    expect(r.criticalEligible).toBe(false);
    expect(r.priority).not.toBe("critical");
  });

  it("severe revenue impact with confidence reaches critical", () => {
    const r = computePriorityScore({
      revenueImpact: 0.9, customerImpact: 0.9, urgency: 0.9,
      riskOfInaction: 0.9, securityImpact: 0.8, complianceImpact: 0.7,
      operationalImpact: 0.8, pipelineImpact: 0.8, costImpact: 0.7,
      profitImpact: 0.7, strategicImportance: 0.8, confidence: 0.95,
    });
    expect(r.criticalEligible).toBe(true);
    expect(r.priority).toBe("critical");
  });

  it("low confidence dampens the score", () => {
    const hi = computePriorityScore({ revenueImpact: 0.6, urgency: 0.6, confidence: 1 });
    const lo = computePriorityScore({ revenueImpact: 0.6, urgency: 0.6, confidence: 0.1 });
    expect(lo.score).toBeLessThan(hi.score);
  });

  it("empty factors score low", () => {
    expect(computePriorityScore({}).priority).toBe("low");
  });
});

describe("baseline + waiting maths", () => {
  it("flags anomalies only with a material baseline", () => {
    expect(compareToBaseline(20, 10).anomalous).toBe(true);
    expect(compareToBaseline(4, 1).anomalous).toBe(false); // baseline below minBaseline
    expect(compareToBaseline(10, 0).deltaPct).toBeNull();
  });
  it("timeWaitingFactor caps at 1 and handles null", () => {
    expect(timeWaitingFactor(null)).toBe(0);
    expect(timeWaitingFactor(new Date(Date.now() - 100 * DAY).toISOString())).toBe(1);
  });
});

// ── Quality gate ──────────────────────────────────────────────────────────────

describe("validateExecRecDraft", () => {
  it("accepts a specific, evidence-backed draft", () => {
    expect(validateExecRecDraft(mkDraft())).toBe(true);
  });

  it("rejects vague advice", () => {
    expect(validateExecRecDraft(mkDraft({ recommended_action: "Follow up with your leads" }))).toBe(false);
    expect(validateExecRecDraft(mkDraft({ recommended_action: "Improve performance." }))).toBe(false);
  });

  it("rejects drafts without at least two numeric evidence metrics", () => {
    const d = mkDraft();
    d.evidence = { ...d.evidence, metrics: { staleLeads: 12 } };
    expect(validateExecRecDraft(d)).toBe(false);
  });

  it("rejects out-of-bounds confidence and short issues", () => {
    expect(validateExecRecDraft(mkDraft({ confidence: 0 }))).toBe(false);
    expect(validateExecRecDraft(mkDraft({ confidence: 1.2 }))).toBe(false);
    expect(validateExecRecDraft(mkDraft({ business_issue: "too short" }))).toBe(false);
  });
});

describe("capExecRecDrafts", () => {
  it("enforces 3 critical / 5 high / 12 total", () => {
    const recs = [
      ...Array.from({ length: 6 }, () => mkDraft({ priority: "critical" })),
      ...Array.from({ length: 8 }, () => mkDraft({ priority: "high" })),
      ...Array.from({ length: 10 }, () => mkDraft({ priority: "medium" })),
    ];
    const capped = capExecRecDrafts(recs);
    expect(capped.length).toBe(12);
    expect(capped.filter((r) => r.priority === "critical").length).toBe(3);
    expect(capped.filter((r) => r.priority === "high").length).toBe(5);
  });
});

// ── Freshness → confidence ────────────────────────────────────────────────────

describe("adjustConfidenceForFreshness", () => {
  it("stale sources reduce confidence; disconnected reduces further", () => {
    const healthy = buildEvidencePackage({
      workspaceId: WS_A, metrics: { a: 1, b: 2 }, sourceSystems: ["leads"],
      freshness: [{ source: "leads", status: "healthy", lastActivityAt: null }],
    });
    const stale = buildEvidencePackage({
      workspaceId: WS_A, metrics: { a: 1, b: 2 }, sourceSystems: ["leads"],
      freshness: [{ source: "leads", status: "stale", lastActivityAt: null }],
    });
    const disconnected = buildEvidencePackage({
      workspaceId: WS_A, metrics: { a: 1, b: 2 }, sourceSystems: ["leads"],
      freshness: [{ source: "leads", status: "disconnected", lastActivityAt: null }],
    });
    expect(adjustConfidenceForFreshness(0.9, healthy)).toBeCloseTo(0.9);
    expect(adjustConfidenceForFreshness(0.9, stale)).toBeCloseTo(0.63);
    expect(adjustConfidenceForFreshness(0.9, disconnected)).toBeCloseTo(0.504);
  });
});

// ── Correlation rules ─────────────────────────────────────────────────────────

describe("runCorrelationRules", () => {
  it("fires volume-up/quality-down and blocks budget increase", () => {
    const out = runCorrelationRules({
      growth: {
        leadVolumeCurrent: 60, leadVolumeBaseline: 30,
        qualifiedRateCurrentPct: 8, qualifiedRateBaselinePct: 20,
        costPerQualifiedCurrent: 90, costPerQualifiedBaseline: 50,
      },
    });
    const rule = out.find((c) => c.ruleKey === "volume_up_quality_down");
    expect(rule).toBeTruthy();
    expect(rule!.recommended_action).toMatch(/not increase/i);
    expect(Object.keys(rule!.metrics).length).toBeGreaterThanOrEqual(2);
  });

  it("fires integration-down + unbooked-leads as a revenue incident", () => {
    const out = runCorrelationRules({
      crm: { qualifiedLeadsNoBooking: 5 },
      system: { failedIntegrations: [{ id: "calendar:google", name: "calendar:google" }], bookingIntegrationDown: true },
    });
    const rule = out.find((c) => c.ruleKey === "integration_down_unbooked_leads");
    expect(rule).toBeTruthy();
    expect(rule!.factors.revenueImpact).toBeGreaterThanOrEqual(0.8);
  });

  it("fires retention risk on complaint + repeated failures + imminent renewal", () => {
    const out = runCorrelationRules({
      system: { failedWorkflows: [{ id: "wf1", name: "Follow-up", failures: 4 }] },
      accounts: { openComplaints: 1, renewalInDays: 7 },
    });
    expect(out.find((c) => c.ruleKey === "retention_risk_complaint_failures_renewal")).toBeTruthy();
  });

  it("stays silent when preconditions do not hold", () => {
    expect(runCorrelationRules({})).toHaveLength(0);
    expect(runCorrelationRules({ growth: { leadVolumeCurrent: 10, leadVolumeBaseline: 10 } })).toHaveLength(0);
  });
});

// ── Full reasoning run against the real DB ────────────────────────────────────

describe("runExecutiveReasoning (real DB)", () => {
  it("persists a recommendation from a classified critical event, then dedupes on re-run", async () => {
    const pub = await publishExecutiveEvent(sb, {
      workspaceId: WS_A,
      eventType: "campaign_failed",
      sourceSystem: "campaigns",
      title: "Campaign send failed for 42 recipients",
      summary: "The outbound campaign batch failed with provider errors on 42 of 50 recipients.",
      dedupKey: `e2e-campaign-fail:${WS_A}`,
      evidence: { failedRecipients: 42, totalRecipients: 50 },
    });
    expect(pub.ok).toBe(true);
    await classifyPendingExecutiveEvents(sb, 500);

    const first = await runExecutiveReasoning(sb, WS_A, false);
    expect(first.ok).toBe(true);
    expect(first.insertedRecs).toBeGreaterThanOrEqual(1);

    const { data: recs } = await sb
      .from("hivemind_recommendations")
      .select("*")
      .eq("workspace_id", WS_A);
    expect(recs!.length).toBeGreaterThanOrEqual(1);
    const rec = recs!.find((r: any) => String(r.dedupe_key).startsWith("event:campaign_failed"));
    expect(rec).toBeTruthy();
    expect(rec.status).toBe("new");
    expect(rec.confidence).toBeGreaterThan(0);
    expect(Object.keys(rec.evidence?.metrics ?? {}).length).toBeGreaterThanOrEqual(2);
    expect(rec.recommended_action.length).toBeGreaterThanOrEqual(30);

    // The consumed event must not produce a duplicate on a second run.
    const before = recs!.length;
    const second = await runExecutiveReasoning(sb, WS_A, false);
    expect(second.ok).toBe(true);
    const { data: recsAfter } = await sb
      .from("hivemind_recommendations")
      .select("id")
      .eq("workspace_id", WS_A);
    expect(recsAfter!.length).toBe(before);

    // Source event marked consumed.
    const { data: ev } = await sb
      .from("hivemind_executive_events")
      .select("processing_status")
      .eq("workspace_id", WS_A)
      .eq("dedup_key", `e2e-campaign-fail:${WS_A}`)
      .single();
    expect(ev!.processing_status).toBe("consumed");
  }, 120_000);

  it("creates an accountability-shaped task from a task_candidate event, deduped", async () => {
    await publishExecutiveEvent(sb, {
      workspaceId: WS_A,
      eventType: "workflow_failed",
      sourceSystem: "workflow-engine",
      title: "Workflow run failed (e2e)",
      entityType: "workflow_run",
      entityId: "e2e-run-1",
      dedupKey: `e2e-wf-fail:${WS_A}`,
      evidence: { failures: 3 },
    });
    await classifyPendingExecutiveEvents(sb, 500);
    const res = await runExecutiveReasoning(sb, WS_A, false);
    expect(res.ok).toBe(true);
    expect(res.insertedTasks).toBeGreaterThanOrEqual(1);

    const { data: tasks } = await sb
      .from("hivemind_tasks")
      .select("*")
      .eq("workspace_id", WS_A)
      .eq("trigger_type", "workflow_failed")
      .eq("entity_id", "e2e-run-1");
    expect(tasks!.length).toBe(1);
    expect(tasks![0].status).toBe("suggested");
    expect(tasks![0].department).toBe("system");
    expect(tasks![0].reason).toBeTruthy();
    expect(tasks![0].reassess_at).toBeTruthy();

    // Re-publishing + re-running must not duplicate the open task.
    await publishExecutiveEvent(sb, {
      workspaceId: WS_A,
      eventType: "workflow_failed",
      sourceSystem: "workflow-engine",
      title: "Workflow run failed again (e2e)",
      entityType: "workflow_run",
      entityId: "e2e-run-1",
      dedupKey: `e2e-wf-fail-2:${WS_A}`,
      evidence: { failures: 4 },
    });
    await classifyPendingExecutiveEvents(sb, 500);
    const res2 = await runExecutiveReasoning(sb, WS_A, false);
    expect(res2.ok).toBe(true);
    expect(res2.dedupedTasks).toBeGreaterThanOrEqual(1);
    const { data: tasks2 } = await sb
      .from("hivemind_tasks")
      .select("id")
      .eq("workspace_id", WS_A)
      .eq("trigger_type", "workflow_failed")
      .eq("entity_id", "e2e-run-1");
    expect(tasks2!.length).toBe(1);
  }, 120_000);

  it("multi-tenant isolation: workspace B sees none of A's output", async () => {
    const resB = await runExecutiveReasoning(sb, WS_B, false);
    expect(resB.ok).toBe(true);
    const { data: recsB } = await sb
      .from("hivemind_recommendations").select("id").eq("workspace_id", WS_B);
    const { data: tasksB } = await sb
      .from("hivemind_tasks").select("id").eq("workspace_id", WS_B)
      .eq("trigger_type", "workflow_failed");
    // B has no seeded events, so no event-driven recs/tasks leak across.
    expect((recsB ?? []).length).toBe(0);
    expect((tasksB ?? []).length).toBe(0);
  }, 120_000);
});

// ── Task accountability lifecycle (reopen when the signal persists) ──────────

describe("task accountability", () => {
  it("reopens a completed task whose underlying signal persists", async () => {
    // Seed a workflow + a fresh failed run so the recheck sees a live signal.
    const { data: wf, error: wfErr } = await sb.from("workspace_workflows").insert({
      workspace_id: WS_A,
      name: "e2e accountability wf",
      status: "active",
      trigger_type: "manual",
      flow_definition: { nodes: [], edges: [] },
    }).select("id").single();
    if (wfErr) throw new Error(wfErr.message);
    const { data: run, error: runErr } = await sb.from("workflow_runs").insert({
      workspace_id: WS_A,
      workflow_id: wf.id,
      status: "failed",
      error: "e2e failure",
      completed_at: new Date().toISOString(),
    }).select("id").single();
    if (runErr) throw new Error(runErr.message);

    const { data: task, error: tErr } = await sb.from("hivemind_tasks").insert({
      workspace_id: WS_A,
      title: "e2e completed-but-broken task",
      status: "completed",
      priority: "high",
      source: "executive_reasoning",
      trigger_type: "workflow_failed",
      entity_type: "workflow_run",
      entity_id: String(run.id),
      reassess_at: new Date(Date.now() - HOUR).toISOString(),
    }).select("id").single();
    if (tErr) throw new Error(tErr.message);

    const { RECON_JOBS_FOR_TEST } = await import("@/lib/hivemind/executive-reconciliation.server");
    const job = RECON_JOBS_FOR_TEST.find((j: any) => j.key === "task_accountability");
    expect(job).toBeTruthy();
    const detail = await job!.run(sb, WS_A);
    expect((detail as any).reopened).toBeGreaterThanOrEqual(1);

    const { data: after } = await sb.from("hivemind_tasks")
      .select("status, reopened_count").eq("id", task.id).single();
    expect(after!.status).toBe("suggested");
    expect(after!.reopened_count).toBe(1);
  }, 120_000);

  it("expires untouched recommendations past their reassess time", async () => {
    const { error: insErr } = await sb.from("hivemind_recommendations").insert({
      workspace_id: WS_B,
      title: "e2e expiring recommendation",
      department: "crm",
      priority: "low",
      business_issue: "e2e — this recommendation should expire on reassessment.",
      recommended_action: "This is a specific placeholder action long enough for the gate.",
      evidence: { metrics: { a: 1, b: 2 } },
      confidence: 0.5,
      dedupe_key: `e2e-expire:${WS_B}`,
      status: "new",
      reassess_at: new Date(Date.now() - HOUR).toISOString(),
    });
    if (insErr) throw new Error(insErr.message);

    const { RECON_JOBS_FOR_TEST } = await import("@/lib/hivemind/executive-reconciliation.server");
    const job = RECON_JOBS_FOR_TEST.find((j: any) => j.key === "task_accountability");
    const detail = await job!.run(sb, WS_B);
    expect((detail as any).expiredRecs).toBeGreaterThanOrEqual(1);

    const { data: rec } = await sb.from("hivemind_recommendations")
      .select("status").eq("workspace_id", WS_B).eq("dedupe_key", `e2e-expire:${WS_B}`).single();
    expect(rec!.status).toBe("expired");
  }, 120_000);
});

describe("open-task dedup is atomic at the DB level", () => {
  it("the partial unique index rejects a second open task for the same trigger/entity", async () => {
    const entity = `e2e-atomic-${randomUUID().slice(0, 8)}`;
    const base = {
      workspace_id: WS_B,
      title: "e2e atomic dedup task",
      status: "suggested",
      priority: "medium",
      source: "executive_reasoning",
      trigger_type: "workflow_failed",
      entity_type: "workflow_run",
      entity_id: entity,
    };
    const first = await sb.from("hivemind_tasks").insert(base);
    expect(first.error).toBeNull();
    const second = await sb.from("hivemind_tasks").insert(base);
    expect(second.error?.code).toBe("23505");
  });

  it("parallel reasoning runs create only one task for the same event", async () => {
    const entity = `e2e-parallel-${randomUUID().slice(0, 8)}`;
    await publishExecutiveEvent(sb, {
      workspaceId: WS_B,
      eventType: "workflow_failed",
      sourceSystem: "workflow-engine",
      title: "Parallel-run workflow failure (e2e)",
      entityType: "workflow_run",
      entityId: entity,
      dedupKey: `e2e-parallel:${entity}`,
      evidence: { failures: 2 },
    });
    await classifyPendingExecutiveEvents(sb, 500);
    const [r1, r2] = await Promise.all([
      runExecutiveReasoning(sb, WS_B, false),
      runExecutiveReasoning(sb, WS_B, false),
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    const { data: tasks } = await sb
      .from("hivemind_tasks")
      .select("id")
      .eq("workspace_id", WS_B)
      .eq("trigger_type", "workflow_failed")
      .eq("entity_id", entity);
    expect(tasks!.length).toBe(1);
  }, 120_000);
});

describe("shared constants", () => {
  it("OPEN_REC_STATES excludes terminal states", () => {
    for (const s of ["completed", "failed", "dismissed", "expired", "rejected"]) {
      expect(OPEN_REC_STATES).not.toContain(s);
    }
  });
});
