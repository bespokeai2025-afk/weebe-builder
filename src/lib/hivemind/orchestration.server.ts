/**
 * Cross-Mind orchestration coordinator (Executive Operator mode).
 *
 * A playbook run chains analyses across the AI executives (HiveMind COO,
 * GrowthMind CMO, SystemMind CTO, AccountsMind) via the executive bridge,
 * composes ONE coordinated recommendation, creates linked hivemind_tasks
 * (with dependencies + evidence) and publishes escalation events routed to
 * the right Mind (cost → AccountsMind, technical → SystemMind,
 * conversion → GrowthMind).
 *
 * Safety model:
 *  - Playbooks only ever CREATE suggested tasks, a recommendation and
 *    executive events. They never execute actions directly, so the
 *    sensitive / mandatory-approval pipeline is never bypassed.
 *  - Manual runs are allowed in any non-observe mode (proposal gate).
 *  - Automatic (chained) runs require the executive_operator mode.
 *  - hivemind_orchestration_runs is server-write-only (service role);
 *    members read via RLS.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Sb = any;

export type OrchestrationPlaybook =
  | "campaign_underperforming"
  | "invoice_missing"
  | "lead_not_followed_up";

export const ORCHESTRATION_PLAYBOOKS: Record<OrchestrationPlaybook, {
  title: string;
  description: string;
}> = {
  campaign_underperforming: {
    title: "Campaign underperforming",
    description:
      "Detects stalled/low-completion call campaigns, chains GrowthMind (conversion), AccountsMind (cost) and SystemMind (technical) analyses, and produces a coordinated fix plan.",
  },
  invoice_missing: {
    title: "Recurring invoice missing",
    description:
      "Detects active recurring invoice schedules that have not generated this month's invoice and coordinates AccountsMind follow-up tasks.",
  },
  lead_not_followed_up: {
    title: "Qualified lead not followed up",
    description:
      "Detects interested/qualified leads with no recent activity and coordinates HiveMind follow-up tasks with GrowthMind messaging input.",
  },
};

interface Finding {
  entityType: string;
  entityId: string;
  entityName: string;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface OrchestrationRunResult {
  ok: boolean;
  runId?: string;
  playbook: OrchestrationPlaybook;
  status: "completed" | "no_findings" | "failed";
  findings: number;
  taskIds: string[];
  escalations: string[];
  recommendation?: string | null;
  error?: string;
}

// ── Detection ────────────────────────────────────────────────────────────────

async function detectCampaignUnderperforming(sb: Sb, workspaceId: string): Promise<Finding[]> {
  const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data } = await sb
    .from("call_campaigns")
    .select("id,name,status,total_leads,completed_calls,created_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "running", "in_progress"])
    .lte("created_at", twoDaysAgo)
    .limit(50);
  const out: Finding[] = [];
  for (const c of data ?? []) {
    const total = Number(c.total_leads ?? 0);
    const done  = Number(c.completed_calls ?? 0);
    if (total > 0 && done / total < 0.2) {
      out.push({
        entityType: "call_campaign",
        entityId: String(c.id),
        entityName: String(c.name ?? "Campaign"),
        detail: `Only ${done}/${total} calls completed (${Math.round((done / total) * 100)}%) since ${String(c.created_at).slice(0, 10)}.`,
        evidence: { total_leads: total, completed_calls: done, status: c.status, created_at: c.created_at },
      });
    }
  }
  return out;
}

async function detectInvoiceMissing(sb: Sb, workspaceId: string): Promise<Finding[]> {
  const now = new Date();
  const monthStr = now.toISOString().slice(0, 7); // YYYY-MM
  const { data } = await sb
    .from("accountsmind_recurring_invoices")
    .select("id,name,day_of_month,last_generated_month,currency,active")
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .limit(100);
  const out: Finding[] = [];
  for (const r of data ?? []) {
    const due = Number(r.day_of_month ?? 1) <= now.getUTCDate();
    const generated = String(r.last_generated_month ?? "") >= monthStr;
    if (due && !generated) {
      out.push({
        entityType: "recurring_invoice",
        entityId: String(r.id),
        entityName: String(r.name ?? "Recurring invoice"),
        detail: `Recurring schedule "${r.name}" was due on day ${r.day_of_month} but no invoice has been generated for ${monthStr}.`,
        evidence: { day_of_month: r.day_of_month, last_generated_month: r.last_generated_month, month: monthStr },
      });
    }
  }
  return out;
}

async function detectLeadNotFollowedUp(sb: Sb, workspaceId: string): Promise<Finding[]> {
  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data } = await sb
    .from("leads")
    .select("id,full_name,status,updated_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["interested", "qualified"])
    .lte("updated_at", threeDaysAgo)
    .order("updated_at", { ascending: true })
    .limit(20);
  return (data ?? []).map((l: any): Finding => ({
    entityType: "lead",
    entityId: String(l.id),
    entityName: String(l.full_name ?? "Lead"),
    detail: `Lead is ${l.status} but has had no activity since ${String(l.updated_at).slice(0, 10)}.`,
    evidence: { status: l.status, last_activity_at: l.updated_at },
  }));
}

// ── Per-Mind analyses (executive bridge) ─────────────────────────────────────

async function gatherAnalyses(
  sb: Sb,
  workspaceId: string,
  playbook: OrchestrationPlaybook,
): Promise<Record<string, unknown>> {
  const analyses: Record<string, unknown> = {};
  // String-literal dynamic imports (prod Rollup requirement).
  const bridge = await import("@/lib/executives/executive-bridge.server");
  const settle = async (key: string, p: Promise<unknown>) => {
    try { analyses[key] = await p; } catch (e: any) { analyses[key] = { unavailable: true, reason: e?.message ?? "failed" }; }
  };
  const wants = {
    hivemind:    true, // always — COO context
    growthmind:  playbook === "campaign_underperforming" || playbook === "lead_not_followed_up",
    systemmind:  playbook === "campaign_underperforming",
    accountsmind: playbook === "campaign_underperforming" || playbook === "invoice_missing",
  };
  await Promise.all([
    settle("hivemind", bridge.buildHiveMindExecutiveSummary(sb, workspaceId)),
    wants.growthmind ? settle("growthmind", bridge.buildGrowthMindExecutiveSummary(sb, workspaceId)) : Promise.resolve(),
    wants.systemmind ? settle("systemmind", bridge.buildSystemMindExecutiveSummary(sb, workspaceId)) : Promise.resolve(),
    wants.accountsmind
      ? settle("accountsmind", (async () => {
          const { getInvoiceSalesSummary } = await import("@/lib/accountsmind/invoice-sales.server");
          return getInvoiceSalesSummary(workspaceId);
        })())
      : Promise.resolve(),
  ]);
  return analyses;
}

// ── Recommendation + tasks + escalations per playbook ────────────────────────

interface TaskSpec {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  department: string | null;
  entityType: string;
  entityId: string;
  entityName: string;
  evidence: Record<string, unknown>;
  /** Index into the task list this task depends on (created earlier in the same run). */
  dependsOnIndex?: number;
}

interface Escalation {
  eventType: "growthmind_recommendation" | "systemmind_incident" | "accountsmind_warning";
  sourceMind: "growthmind" | "systemmind" | "accountsmind";
  reason: string;
  title: string;
  summary: string;
  entityType: string;
  entityId: string;
}

function composePlan(
  playbook: OrchestrationPlaybook,
  findings: Finding[],
  analyses: Record<string, unknown>,
): { recommendation: string; tasks: TaskSpec[]; escalations: Escalation[] } {
  const tasks: TaskSpec[] = [];
  const escalations: Escalation[] = [];
  const first = findings[0];

  if (playbook === "campaign_underperforming") {
    for (const f of findings.slice(0, 5)) {
      const reviewIdx = tasks.length;
      tasks.push({
        title: `Review underperforming campaign: ${f.entityName}`,
        description: `${f.detail} Review agent assignment, schedule and phone-number health before making changes.`,
        priority: "high", department: "operations",
        entityType: f.entityType, entityId: f.entityId, entityName: f.entityName,
        evidence: f.evidence,
      });
      tasks.push({
        title: `Improve conversion for campaign: ${f.entityName}`,
        description: "After the operational review, apply GrowthMind script/targeting recommendations (draft only — production agents are never changed silently).",
        priority: "medium", department: "growth",
        entityType: f.entityType, entityId: f.entityId, entityName: f.entityName,
        evidence: f.evidence, dependsOnIndex: reviewIdx,
      });
      escalations.push(
        { eventType: "growthmind_recommendation", sourceMind: "growthmind", reason: "conversion",
          title: `Poor conversion: ${f.entityName}`, summary: f.detail, entityType: f.entityType, entityId: f.entityId },
        { eventType: "systemmind_incident", sourceMind: "systemmind", reason: "technical",
          title: `Check technical health of campaign: ${f.entityName}`, summary: `Low completion rate may indicate agent, telephony or integration faults. ${f.detail}`, entityType: f.entityType, entityId: f.entityId },
        { eventType: "accountsmind_warning", sourceMind: "accountsmind", reason: "cost",
          title: `Review spend on campaign: ${f.entityName}`, summary: `Campaign is consuming call budget with low completion. ${f.detail}`, entityType: f.entityType, entityId: f.entityId },
      );
    }
    return {
      recommendation:
        `${findings.length} campaign(s) are underperforming (completion below 20% after 48h). ` +
        `Coordinated plan: (1) operational review of agent/schedule/number health, (2) GrowthMind conversion improvements after review, ` +
        `(3) escalations raised to SystemMind (technical), AccountsMind (cost) and GrowthMind (conversion). ` +
        `All changes remain proposal-only until approved.`,
      tasks, escalations,
    };
  }

  if (playbook === "invoice_missing") {
    for (const f of findings.slice(0, 10)) {
      const verifyIdx = tasks.length;
      tasks.push({
        title: `Verify missed recurring invoice: ${f.entityName}`,
        description: `${f.detail} Confirm the client is still active and the schedule is correct before issuing.`,
        priority: "high", department: "accounts",
        entityType: f.entityType, entityId: f.entityId, entityName: f.entityName,
        evidence: f.evidence,
      });
      tasks.push({
        title: `Issue invoice for: ${f.entityName}`,
        description: "Once verified, create and send this month's invoice through AccountsMind. Never mark paid without evidence.",
        priority: "high", department: "accounts",
        entityType: f.entityType, entityId: f.entityId, entityName: f.entityName,
        evidence: f.evidence, dependsOnIndex: verifyIdx,
      });
      escalations.push({
        eventType: "accountsmind_warning", sourceMind: "accountsmind", reason: "cost",
        title: `Missing recurring invoice: ${f.entityName}`, summary: f.detail,
        entityType: f.entityType, entityId: f.entityId,
      });
    }
    return {
      recommendation:
        `${findings.length} active recurring invoice schedule(s) have not generated this month's invoice. ` +
        `Coordinated plan: verify each schedule/client, then issue the invoice. AccountsMind has been alerted.`,
      tasks, escalations,
    };
  }

  // lead_not_followed_up
  for (const f of findings.slice(0, 10)) {
    const contactIdx = tasks.length;
    tasks.push({
      title: `Follow up lead: ${f.entityName}`,
      description: `${f.detail} Contact via the lead's preferred channel and log the outcome.`,
      priority: "high", department: "sales",
      entityType: f.entityType, entityId: f.entityId, entityName: f.entityName,
      evidence: f.evidence,
    });
    tasks.push({
      title: `Enroll in follow-up sequence if unreachable: ${f.entityName}`,
      description: "If direct contact fails, enroll the lead in an approved follow-up campaign (requires approval if sensitive).",
      priority: "medium", department: "sales",
      entityType: f.entityType, entityId: f.entityId, entityName: f.entityName,
      evidence: f.evidence, dependsOnIndex: contactIdx,
    });
  }
  if (first) {
    escalations.push({
      eventType: "growthmind_recommendation", sourceMind: "growthmind", reason: "conversion",
      title: `Qualified leads going cold (${findings.length})`,
      summary: "Multiple qualified/interested leads have no recent follow-up. GrowthMind should review follow-up messaging and cadence.",
      entityType: "lead", entityId: first.entityId,
    });
  }
  return {
    recommendation:
      `${findings.length} interested/qualified lead(s) have had no activity for 3+ days. ` +
      `Coordinated plan: direct follow-up first, then sequence enrollment for unreachable leads. ` +
      `GrowthMind alerted to review messaging cadence.`,
    tasks, escalations,
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runOrchestrationPlaybook(
  sb: Sb,
  workspaceId: string,
  playbook: OrchestrationPlaybook,
  opts: { triggerSource?: "manual" | "auto"; userId?: string | null } = {},
): Promise<OrchestrationRunResult> {
  const triggerSource = opts.triggerSource ?? "manual";
  const base: OrchestrationRunResult = { ok: false, playbook, status: "failed", findings: 0, taskIds: [], escalations: [] };
  try {
    // Mode gates. Manual: any non-observe mode (proposal-only output).
    // Auto chaining: executive_operator only.
    const { getHiveMindModeConfig, assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    await assertProposalAllowed(sb, workspaceId);
    if (triggerSource === "auto") {
      const cfg = await getHiveMindModeConfig(sb, workspaceId);
      if (cfg.mode !== "executive_operator") {
        return { ...base, error: "Automatic orchestration requires Executive Operator mode." };
      }
    }

    const findings =
      playbook === "campaign_underperforming" ? await detectCampaignUnderperforming(sb, workspaceId)
      : playbook === "invoice_missing"        ? await detectInvoiceMissing(sb, workspaceId)
      : await detectLeadNotFollowedUp(sb, workspaceId);

    if (findings.length === 0) {
      const { data } = await supabaseAdmin
        .from("hivemind_orchestration_runs")
        .insert({
          workspace_id: workspaceId, playbook, trigger_source: triggerSource,
          status: "no_findings", created_by: opts.userId ?? null,
        })
        .select("id")
        .maybeSingle();
      return { ...base, ok: true, status: "no_findings", runId: data?.id };
    }

    const analyses = await gatherAnalyses(sb, workspaceId, playbook);
    const plan = composePlan(playbook, findings, analyses);

    // Create linked tasks (dedup against open tasks with same trigger+entity,
    // mirroring the scanner pattern).
    const { data: openTasks } = await sb
      .from("hivemind_tasks")
      .select("trigger_type,entity_id")
      .eq("workspace_id", workspaceId)
      .neq("status", "completed");
    const open = openTasks ?? [];
    const triggerType = `orchestration_${playbook}`;

    const taskIds: string[] = [];
    const indexToId: Record<number, string> = {};
    for (let i = 0; i < plan.tasks.length; i++) {
      const t = plan.tasks[i];
      const dedupKey = `${t.entityId}:${i % 2}`; // two tasks per entity, distinct slots
      if (open.some((o: any) => o.trigger_type === triggerType && o.entity_id === dedupKey)) continue;
      const dependencies =
        t.dependsOnIndex != null && indexToId[t.dependsOnIndex]
          ? [indexToId[t.dependsOnIndex]]
          : [];
      const { data: row, error } = await sb
        .from("hivemind_tasks")
        .insert({
          workspace_id: workspaceId,
          title: t.title,
          description: t.description,
          status: "suggested",
          priority: t.priority,
          source: "ai_scan",
          department: t.department,
          trigger_type: triggerType,
          entity_type: t.entityType,
          entity_id: dedupKey,
          entity_name: t.entityName,
          evidence: t.evidence,
          dependencies,
          metadata: { orchestration_playbook: playbook, real_entity_id: t.entityId },
        })
        .select("id")
        .maybeSingle();
      if (error || !row?.id) continue;
      indexToId[i] = String(row.id);
      taskIds.push(String(row.id));
    }

    // Escalation events routed to each Mind (never-throw publisher, deduped).
    const { publishExecutiveEvent } = await import("@/lib/hivemind/executive-events.shared");
    const escalated: string[] = [];
    for (const e of plan.escalations) {
      const r = await publishExecutiveEvent(sb, {
        workspaceId,
        eventType: e.eventType,
        sourceSystem: "hivemind_orchestration",
        title: e.title,
        summary: e.summary,
        entityType: e.entityType,
        entityId: e.entityId,
        dedupKey: `orch:${playbook}:${e.reason}:${e.entityId}`,
        evidence: { playbook, reason: e.reason, routed_to: e.sourceMind },
      });
      if (r.ok && !r.deduped) escalated.push(`${e.sourceMind}:${e.reason}`);
    }

    const { data: runRow, error: runErr } = await supabaseAdmin
      .from("hivemind_orchestration_runs")
      .insert({
        workspace_id: workspaceId,
        playbook,
        trigger_source: triggerSource,
        status: "completed",
        entity_type: findings[0]?.entityType ?? null,
        entity_id: findings[0]?.entityId ?? null,
        recommendation: plan.recommendation,
        analyses,
        task_ids: taskIds,
        escalations: plan.escalations.map((e) => ({ mind: e.sourceMind, reason: e.reason, event_type: e.eventType, title: e.title })),
        created_by: opts.userId ?? null,
      })
      .select("id")
      .maybeSingle();
    if (runErr) console.warn("[orchestration] run insert failed:", runErr.message);

    return {
      ok: true,
      runId: runRow?.id,
      playbook,
      status: "completed",
      findings: findings.length,
      taskIds,
      escalations: escalated,
      recommendation: plan.recommendation,
    };
  } catch (err: any) {
    try {
      await supabaseAdmin.from("hivemind_orchestration_runs").insert({
        workspace_id: workspaceId, playbook, trigger_source: triggerSource,
        status: "failed", error: String(err?.message ?? err).slice(0, 1000),
        created_by: opts.userId ?? null,
      });
    } catch { /* best-effort */ }
    return { ...base, error: err?.message ?? "Orchestration failed" };
  }
}

export async function listOrchestrationRuns(sb: Sb, workspaceId: string, limit = 20) {
  const { data, error } = await sb
    .from("hivemind_orchestration_runs")
    .select("id,playbook,trigger_source,status,recommendation,task_ids,escalations,error,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { runs: [], error: error.message };
  return { runs: data ?? [], error: null };
}
