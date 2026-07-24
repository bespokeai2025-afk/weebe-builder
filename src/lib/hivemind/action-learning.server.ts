// ── HiveMind learning loop — SERVER ONLY ─────────────────────────────────────
// Reassesses executed actions after their reassess_at window, classifies the
// outcome against the baseline/expected result captured at execution time,
// publishes an `action_outcome` executive event, feeds outcome back to the
// linked recommendation, and maintains per-key confidence adjustments used to
// temper future recommendation scores.
//
// Runs from the reconciliation tick with a SERVICE-ROLE client (the
// hivemind_confidence_adjustments table is server-write-only).

import { publishExecutiveEvent } from "./executive-events.shared";

type Sb = any;

export type OutcomeClassification =
  | "successful"
  | "partial"
  | "no_change"
  | "unsuccessful"
  | "inconclusive";

interface ClassifiedOutcome {
  classification: OutcomeClassification;
  detail: Record<string, unknown>;
}

// ── Per-type outcome checks ───────────────────────────────────────────────────

async function classifyOutcome(sb: Sb, workspaceId: string, action: any): Promise<ClassifiedOutcome> {
  const p = action.action_payload ?? {};
  const baseline = action.baseline ?? {};
  try {
    switch (action.action_type) {
      case "create_task": {
        const taskId = action.result?.task_id ?? action.result?.taskId ?? null;
        if (!taskId) return { classification: "inconclusive", detail: { reason: "no linked task id" } };
        const { data: task } = await sb.from("hivemind_tasks")
          .select("id,status")
          .eq("id", taskId).eq("workspace_id", workspaceId).maybeSingle();
        if (!task) return { classification: "inconclusive", detail: { reason: "task not found" } };
        if (task.status === "completed")   return { classification: "successful", detail: { taskStatus: task.status } };
        if (task.status === "in_progress" || task.status === "approved")
          return { classification: "partial", detail: { taskStatus: task.status } };
        if (task.status === "dismissed")   return { classification: "unsuccessful", detail: { taskStatus: task.status } };
        return { classification: "no_change", detail: { taskStatus: task.status } };
      }

      case "create_followup_campaign":
      case "enroll_leads_in_campaign": {
        const before = typeof baseline.active_enrollments === "number" ? baseline.active_enrollments : null;
        const { count } = await sb.from("hexmail_campaign_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId).eq("status", "active");
        const after = count ?? 0;
        if (before === null) return { classification: "inconclusive", detail: { after } };
        if (after > before)   return { classification: "successful", detail: { before, after } };
        if (after === before) return { classification: "no_change", detail: { before, after } };
        return { classification: "partial", detail: { before, after, note: "enrollments dropped — sequence may have completed" } };
      }

      case "move_pipeline_stage": {
        const leadIds: string[] = (p.lead_ids as string[]) ?? [];
        const target = p.new_status ?? baseline.target_status ?? null;
        if (leadIds.length === 0 || !target) return { classification: "inconclusive", detail: { reason: "no leads/target recorded" } };
        const { data: rows } = await sb.from("leads")
          .select("id,status")
          .in("id", leadIds.slice(0, 500))
          .eq("workspace_id", workspaceId);
        const still = (rows ?? []).filter((l: any) => l.status === target).length;
        const total = (rows ?? []).length;
        if (total === 0) return { classification: "inconclusive", detail: { reason: "leads not found" } };
        const ratio = still / total;
        const detail = { target, held: still, total };
        if (ratio >= 0.8) return { classification: "successful", detail };
        if (ratio >= 0.4) return { classification: "partial", detail };
        return { classification: "no_change", detail };
      }

      case "activate_lead_intake_workflow": {
        const before = typeof baseline.need_to_call_leads === "number" ? baseline.need_to_call_leads : null;
        const { count } = await sb.from("leads")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId).eq("status", "need_to_call");
        const after = count ?? 0;
        const { data: cfgRow } = await sb.from("workspace_settings")
          .select("lead_auto_call_enabled")
          .eq("workspace_id", workspaceId).maybeSingle();
        if (cfgRow?.lead_auto_call_enabled !== true)
          return { classification: "unsuccessful", detail: { reason: "auto-call switched off again", before, after } };
        if (before === null) return { classification: "inconclusive", detail: { after } };
        if (after < before)  return { classification: "successful", detail: { before, after } };
        return { classification: "no_change", detail: { before, after } };
      }

      case "assign_knowledge_base": {
        if (!p.agent_id) return { classification: "inconclusive", detail: { reason: "no agent recorded" } };
        const { data: agent } = await sb.from("agents")
          .select("id,settings")
          .eq("id", p.agent_id).eq("workspace_id", workspaceId).maybeSingle();
        if (!agent) return { classification: "inconclusive", detail: { reason: "agent not found" } };
        const kept = agent.settings?.knowledgeBase === (p.knowledge_base ?? agent.settings?.knowledgeBase);
        return kept
          ? { classification: "successful", detail: { agentId: p.agent_id } }
          : { classification: "unsuccessful", detail: { agentId: p.agent_id, reason: "knowledge base was changed away" } };
      }

      default:
        return { classification: "inconclusive", detail: { reason: `no outcome check for ${action.action_type}` } };
    }
  } catch (err: any) {
    return { classification: "inconclusive", detail: { error: String(err?.message ?? err).slice(0, 300) } };
  }
}

// ── Confidence adjustment feedback ────────────────────────────────────────────

const OUTCOME_DELTA: Record<OutcomeClassification, number> = {
  successful:   +0.02,
  partial:      +0.005,
  no_change:    -0.01,
  unsuccessful: -0.03,
  inconclusive: 0,
};

async function upsertConfidenceAdjustment(
  sb: Sb,
  workspaceId: string,
  adjustmentKey: string,
  classification: OutcomeClassification,
): Promise<void> {
  try {
    const { data: existing } = await sb.from("hivemind_confidence_adjustments")
      .select("id, successes, partials, failures, inconclusive, adjustment")
      .eq("workspace_id", workspaceId)
      .eq("adjustment_key", adjustmentKey)
      .maybeSingle();

    const counters = {
      successes:    (existing?.successes ?? 0)    + (classification === "successful" ? 1 : 0),
      partials:     (existing?.partials ?? 0)     + (classification === "partial" ? 1 : 0),
      failures:     (existing?.failures ?? 0)     + (classification === "unsuccessful" || classification === "no_change" ? 1 : 0),
      inconclusive: (existing?.inconclusive ?? 0) + (classification === "inconclusive" ? 1 : 0),
    };
    // Bounded cumulative adjustment in [-0.2, +0.2].
    const raw = Number(existing?.adjustment ?? 0) + OUTCOME_DELTA[classification];
    const adjustment = Math.max(-0.2, Math.min(0.2, Number(raw.toFixed(3))));
    const nowIso = new Date().toISOString();

    if (existing?.id) {
      await sb.from("hivemind_confidence_adjustments")
        .update({ ...counters, adjustment, last_outcome: classification, updated_at: nowIso })
        .eq("id", existing.id);
    } else {
      await sb.from("hivemind_confidence_adjustments")
        .insert({ workspace_id: workspaceId, adjustment_key: adjustmentKey, ...counters, adjustment, last_outcome: classification });
    }
  } catch { /* best-effort */ }
}

/** Read the confidence adjustment for a key (0 when absent). Server-only. */
export async function getConfidenceAdjustment(sb: Sb, workspaceId: string, adjustmentKey: string): Promise<number> {
  try {
    const { data } = await sb.from("hivemind_confidence_adjustments")
      .select("adjustment")
      .eq("workspace_id", workspaceId)
      .eq("adjustment_key", adjustmentKey)
      .maybeSingle();
    const n = Number(data?.adjustment ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch { return 0; }
}

// ── Recon job body ────────────────────────────────────────────────────────────

export async function runActionOutcomeLearning(sb: Sb, workspaceId: string): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  let assessed = 0, successful = 0, unsuccessful = 0, other = 0;

  const { data: due } = await sb.from("hivemind_actions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "executed")
    .is("outcome_classification", null)
    .not("reassess_at", "is", null)
    .lt("reassess_at", nowIso)
    .limit(50);

  for (const action of due ?? []) {
    const { classification, detail } = await classifyOutcome(sb, workspaceId, action);
    assessed++;
    if (classification === "successful") successful++;
    else if (classification === "unsuccessful") unsuccessful++;
    else other++;

    const outcome = {
      classification,
      detail,
      expected_result: action.expected_result ?? null,
      assessed_at: nowIso,
    };
    const { data: claimed, error: updErr } = await sb.from("hivemind_actions")
      .update({ outcome, outcome_classification: classification, updated_at: nowIso })
      .eq("id", action.id)
      .eq("workspace_id", workspaceId)
      .is("outcome_classification", null)
      .select("id");
    // CAS: only the runner that actually claimed the row (exactly one row
    // updated) may publish feedback — otherwise a concurrent runner that lost
    // the race would double-count the confidence adjustment.
    if (updErr || (claimed?.length ?? 0) !== 1) continue;

    // Executive event (deduped one per action).
    await publishExecutiveEvent(sb, {
      workspaceId,
      eventType: "action_outcome",
      sourceSystem: "hivemind",
      severity: classification === "unsuccessful" ? "warning" : "info",
      title: `Action outcome: ${String(action.title ?? action.action_type).slice(0, 100)} — ${classification}`,
      summary: `Executed action "${String(action.title ?? action.action_type).slice(0, 120)}" was reassessed: ${classification}.`,
      entityType: "hivemind_action",
      entityId: String(action.id),
      dedupKey: `action_outcome:${action.id}`,
      evidence: { actionType: action.action_type, classification, ...detail },
    });

    // Bridge feedback: mark the source recommendation's outcome.
    if (action.source_recommendation_id) {
      try {
        await sb.from("hivemind_recommendations")
          .update({ outcome_note: `Linked action ${classification} (${nowIso.slice(0, 10)})`, updated_at: nowIso })
          .eq("id", action.source_recommendation_id)
          .eq("workspace_id", workspaceId);
      } catch { /* column optional — best-effort */ }
    }

    // Confidence learning: per action type, and per department when linked.
    await upsertConfidenceAdjustment(sb, workspaceId, `action:${action.action_type}`, classification);
    if (action.source_recommendation_id) {
      const { data: rec } = await sb.from("hivemind_recommendations")
        .select("department")
        .eq("id", action.source_recommendation_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (rec?.department) {
        await upsertConfidenceAdjustment(sb, workspaceId, `rec:${rec.department}`, classification);
      }
    }
  }

  return { assessed, successful, unsuccessful, other };
}
