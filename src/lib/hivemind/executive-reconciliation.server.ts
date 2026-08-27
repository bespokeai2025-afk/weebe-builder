/**
 * HiveMind Executive OS — scheduled reconciliation (Stage 1).
 *
 * Runs on the 5-minute campaign-executor tick. Each job has a cadence and is
 * claimed per (workspace, job) via compare-and-swap on
 * hivemind_reconciliation_state.last_run_at (Analytics Hub CAS pattern), so
 * overlapping ticks or multiple instances can never double-process.
 *
 * Jobs are deterministic, workspace-scoped, and read LOCAL tables only —
 * never external APIs (WBAH rule: no background WeeBespoke calls).
 * Detected gaps are published as executive events (deduped), then the
 * deterministic classifier stamps pending events.
 *
 * NEVER throws — a reconciliation failure must never break the tick.
 */
import { createClient } from "@supabase/supabase-js";
import { publishExecutiveEvent, classifyPendingExecutiveEvents } from "./executive-events.shared";

type Sb = any;

const HOUR = 60 * 60 * 1000;
const WORKSPACE_PAGE_SIZE = 200;
const NOTIFICATION_GAP_SOURCE = "notification_gap_sweep";
const NOTIFICATION_GAP_OPEN_STATES = ["new", "acknowledged", "under_review", "reopened"];
// Respect an explicit owner decision not to see a recommendation again. Other
// terminal states came from automated resolution/expiry and can reopen if the
// detected condition returns.
const NOTIFICATION_GAP_USER_FINAL_STATES = ["dismissed", "rejected", "approved"];
const NOTIFICATION_GAP_REOPENABLE_STATES = ["expired", "completed"];

interface ReconJob {
  key: string;
  /** Minimum ms between runs per workspace. */
  intervalMs: number;
  run: (sb: Sb, workspaceId: string) => Promise<Record<string, unknown>>;
}

export interface ExecutiveEventsTick {
  workspacesScanned: number;
  jobsRun: number;
  eventsPublished: number;
  eventsClassified: number;
  errors: number;
}

let publishedThisRun = 0;

async function publish(sb: Sb, input: Parameters<typeof publishExecutiveEvent>[1]) {
  const res = await publishExecutiveEvent(sb, input);
  if (res.ok && !res.deduped) publishedThisRun++;
  return res;
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

/** Daily: leads still at entry status untouched for 7+ days (aggregate, noise-capped). */
const staleLeadsJob: ReconJob = {
  key: "stale_leads",
  intervalMs: 24 * HOUR,
  run: async (sb, workspaceId) => {
    const cutoff = new Date(Date.now() - 7 * 24 * HOUR).toISOString();
    const { count, error } = await sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "need_to_call")
      .lt("updated_at", cutoff);
    if (error) throw new Error(error.message);
    const stale = count ?? 0;
    if (stale > 0) {
      const day = new Date().toISOString().slice(0, 10);
      await publish(sb, {
        workspaceId,
        eventType: "lead_stale",
        sourceSystem: "reconciliation",
        title: `${stale} lead${stale === 1 ? "" : "s"} waiting 7+ days without a call`,
        summary: `${stale} lead(s) are still marked "need to call" and have not been touched for over 7 days.`,
        dedupKey: `lead_stale:aggregate:${day}`,
        evidence: { staleCount: stale, cutoff, statusChecked: "need_to_call" },
      });
    }
    return { staleCount: stale };
  },
};

/** 15 min: workflow runs that failed since the last reconciliation pass. */
const failedWorkflowsJob: ReconJob = {
  key: "failed_workflows",
  intervalMs: 15 * 60 * 1000,
  run: async (sb, workspaceId) => {
    const since = new Date(Date.now() - 24 * HOUR).toISOString();
    const { data: runs, error } = await sb
      .from("workflow_runs")
      .select("id, workflow_id, error, completed_at, workflow:workspace_workflows(name)")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    for (const run of runs ?? []) {
      await publish(sb, {
        workspaceId,
        eventType: "workflow_failed",
        sourceSystem: "workflow-engine",
        title: `Workflow ${run.workflow?.name ? `"${run.workflow.name}" ` : ""}run failed`,
        summary: run.error ? String(run.error).slice(0, 500) : null,
        entityType: "workflow_run",
        entityId: String(run.id),
        correlationKey: run.workflow_id ? `workflow:${run.workflow_id}` : null,
        evidence: { runId: run.id, workflowId: run.workflow_id, error: run.error ?? null },
      });
    }
    return { failedRuns: (runs ?? []).length };
  },
};

/** Hourly: confirmed/pending bookings whose start time passed without completion. */
const missedAppointmentsJob: ReconJob = {
  key: "missed_appointments",
  intervalMs: HOUR,
  run: async (sb, workspaceId) => {
    const now = new Date().toISOString();
    const windowStart = new Date(Date.now() - 3 * 24 * HOUR).toISOString();
    const { data: rows, error } = await sb
      .from("calendar_bookings")
      .select("id, title, start_at, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "accepted"])
      .gte("start_at", windowStart)
      .lt("start_at", now)
      .limit(20);
    if (error) throw new Error(error.message);
    for (const b of rows ?? []) {
      await publish(sb, {
        workspaceId,
        eventType: "booking_missed",
        sourceSystem: "reconciliation",
        title: `Appointment${b.title ? ` "${String(b.title).slice(0, 80)}"` : ""} passed while still ${b.status}`,
        summary: `Booking start time ${b.start_at} has passed but its status is still "${b.status}".`,
        entityType: "calendar_booking",
        entityId: String(b.id),
        evidence: { bookingId: b.id, startAt: b.start_at, status: b.status },
      });
    }
    return { missed: (rows ?? []).length };
  },
};

/** Hourly: providers whose last health check left them in error state. */
const integrationFailuresJob: ReconJob = {
  key: "integration_failures",
  intervalMs: HOUR,
  run: async (sb, workspaceId) => {
    const { data: rows, error } = await sb
      .from("provider_settings")
      .select("provider_category, provider_name, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["error", "disconnected"]);
    if (error) throw new Error(error.message);
    const day = new Date().toISOString().slice(0, 10);
    // Only surface providers the workspace actually configured before —
    // "disconnected" rows for never-configured providers are noise, so we
    // restrict to explicit error states plus disconnected rows that have
    // credentials recorded elsewhere is out of scope; error-only keeps it clean.
    const failing = (rows ?? []).filter((r: any) => r.status === "error");
    for (const p of failing) {
      await publish(sb, {
        workspaceId,
        eventType: "integration_disconnected",
        sourceSystem: "providers",
        title: `Integration ${p.provider_category}:${p.provider_name} is failing health checks`,
        entityType: "provider",
        entityId: `${p.provider_category}:${p.provider_name}`,
        dedupKey: `integration_disconnected:${p.provider_category}:${p.provider_name}:${day}`,
        evidence: { category: p.provider_category, provider: p.provider_name, status: p.status },
      });
    }
    return { failing: failing.length };
  },
};

/** 6-hourly: full executive reasoning run (Stage 2) — turns classified events
 * + department signals into evidence-backed recommendations and tasks. */
const executiveReasoningJob: ReconJob = {
  key: "executive_reasoning",
  intervalMs: 6 * HOUR,
  run: async (sb, workspaceId) => {
    const { runExecutiveReasoning } = await import("@/lib/hivemind/executive-reasoning.server");
    const { isWbahWorkspaceId } = await import("@/lib/wbah-exclusion.shared");
    const res = await runExecutiveReasoning(sb, workspaceId, isWbahWorkspaceId(workspaceId));
    if (!res.ok) throw new Error(res.error ?? "reasoning run failed");
    return { ...res } as unknown as Record<string, unknown>;
  },
};

function notificationGapDedupeKey(kind: string, eventKey: string | null): string {
  return `notification_gap:${kind}:${eventKey ?? "workspace"}`;
}

function notificationGapRecommendationDraft(
  finding: {
    kind: string;
    severity: "info" | "warning";
    event_key: string | null;
    summary: string;
    evidence: Record<string, unknown>;
  },
  checkedAt: string,
) {
  const actionByKind: Record<string, string> = {
    qualified_leads_notifications_off:
      "Open notification settings and enable Qualified leads generated with at least one delivery channel.",
    bookings_notifications_off:
      "Open notification settings and enable Appointments booked with at least one delivery channel.",
    buzzchat_replies_unnoticed:
      "Open notification settings and enable a WhatsApp reply notification so unread BuzzChat replies reach the team.",
    assignments_not_notifying_agents:
      "Open notification settings and enable Lead assigned so assigned agents are notified.",
  };
  const action =
    actionByKind[finding.kind] ??
    "Review notification settings and enable an appropriate delivery channel for this event.";

  return {
    workspace_id: "",
    title: `Notification gap: ${finding.summary}`.slice(0, 300),
    department: finding.kind === "buzzchat_replies_unnoticed" ? "operations" : "crm",
    priority: finding.severity === "warning" ? "high" : "medium",
    business_issue: finding.summary.slice(0, 2000),
    evidence: {
      source: "hivemind.detect_notification_gaps",
      finding_kind: finding.kind,
      event_key: finding.event_key,
      checked_at: checkedAt,
      ...finding.evidence,
    },
    related_entities: [],
    commercial_impact:
      "Important leads, bookings, assignments, or customer replies may be missed when the team is not notified.",
    risk_of_inaction:
      "The underlying conversations or sales activity can go unnoticed until the opportunity has cooled.",
    recommended_action: action,
    next_step: "Review the notification settings and choose at least one delivery channel.",
    suggested_owner: "workspace owner",
    due_date: null,
    approval_required: true,
    confidence: 0.95,
    data_freshness: { checkedAt, source: "notification_settings_and_local_activity" },
    source_systems: ["notifications"],
    source_event_ids: [],
    correlation_key: notificationGapDedupeKey(finding.kind, finding.event_key),
    dedupe_key: notificationGapDedupeKey(finding.kind, finding.event_key),
    status: "new",
    source: NOTIFICATION_GAP_SOURCE,
    reassess_at: new Date(Date.now() + 24 * HOUR).toISOString(),
  };
}

/**
 * Daily: turn current notification-gap findings into visible, actionable
 * recommendations. This job is claimed by the same reconciliation CAS as
 * the other executive jobs, so overlapping campaign-executor ticks cannot
 * duplicate recommendations or actions.
 */
const notificationGapRecommendationsJob: ReconJob = {
  key: "notification_gap_recommendations",
  intervalMs: 24 * HOUR,
  run: async (sb, workspaceId) => {
    const { detectNotificationGapsForWorkspace } =
      await import("@/lib/minds/notification-gap-detector.server");
    const detection = await detectNotificationGapsForWorkspace(sb, workspaceId, {
      lookback_days: 14,
    });
    if (!detection.complete) {
      return {
        findings: detection.findings.length,
        created: 0,
        resolved: 0,
        proposed: 0,
        skipped: "incomplete_detection",
      };
    }

    const { getHiveMindModeConfig } = await import("@/lib/hivemind/mode-gate.server");
    const mode = await getHiveMindModeConfig(sb, workspaceId);
    if (mode.mode === "observe") {
      return {
        findings: detection.findings.length,
        created: 0,
        resolved: 0,
        proposed: 0,
        skipped: "observe_mode",
      };
    }

    const { data: existing, error: existingError } = await sb
      .from("hivemind_recommendations")
      .select("id, dedupe_key, status")
      .eq("workspace_id", workspaceId)
      .eq("source", NOTIFICATION_GAP_SOURCE);
    if (existingError) throw new Error(existingError.message);

    const activeKeys = new Set(
      detection.findings.map((finding) =>
        notificationGapDedupeKey(finding.kind, finding.event_key),
      ),
    );
    let created = 0;
    let refreshed = 0;
    let reopened = 0;
    let proposed = 0;
    let inserted: any[] = [];
    const followThroughCandidates: any[] = [];
    const existingByKey = new Map(
      (existing ?? []).map((rec: any) => [String(rec.dedupe_key), rec]),
    );
    const rows: any[] = [];

    for (const finding of detection.findings) {
      const key = notificationGapDedupeKey(finding.kind, finding.event_key);
      const prior = existingByKey.get(key);
      const draft = {
        ...notificationGapRecommendationDraft(finding, detection.checked_at),
        workspace_id: workspaceId,
      };
      if (!prior) {
        rows.push(draft);
        continue;
      }
      if (NOTIFICATION_GAP_USER_FINAL_STATES.includes(String(prior.status))) {
        continue;
      }

      const isOpen = NOTIFICATION_GAP_OPEN_STATES.includes(String(prior.status));
      const isReopenable = NOTIFICATION_GAP_REOPENABLE_STATES.includes(String(prior.status));
      if (!isOpen && !isReopenable) {
        // Assigned/in-progress/waiting/failed lifecycle states are owned by
        // their respective workflows. Do not reset their status or result.
        continue;
      }
      const { workspace_id: _workspaceId, ...updates } = draft;
      const { data: refreshedRec, error: refreshError } = await sb
        .from("hivemind_recommendations")
        .update({
          ...updates,
          status: isOpen ? prior.status : "new",
          result: null,
          updated_at: detection.checked_at,
        })
        .eq("id", prior.id)
        .eq("workspace_id", workspaceId)
        .eq("source", NOTIFICATION_GAP_SOURCE)
        .select(
          "id, workspace_id, title, department, priority, business_issue, recommended_action, next_step, dedupe_key, correlation_key, status, confidence",
        )
        .single();
      if (refreshError) throw new Error(refreshError.message);
      if (isOpen) {
        refreshed++;
      } else {
        reopened++;
        followThroughCandidates.push(refreshedRec);
      }
    }

    if (rows.length) {
      const { data, error } = await sb
        .from("hivemind_recommendations")
        .upsert(rows, { onConflict: "workspace_id,dedupe_key", ignoreDuplicates: true })
        .select(
          "id, workspace_id, title, department, priority, business_issue, recommended_action, next_step, dedupe_key, correlation_key, status, confidence",
        );
      if (error) throw new Error(error.message);
      inserted = (data ?? []) as any[];
      created = inserted.length;
      followThroughCandidates.push(...inserted);
    }

    // A clean scan is allowed to close only this sweep's still-open
    // recommendations. If the gap later returns, the reconciliation above
    // reopens this same stable-dedupe recommendation rather than duplicating it.
    const resolvedIds = (existing ?? []).filter(
      (rec: any) =>
        NOTIFICATION_GAP_OPEN_STATES.includes(String(rec.status)) &&
        !activeKeys.has(String(rec.dedupe_key)),
      )
      .map((rec: any) => rec.id);
    if (resolvedIds.length) {
      const { error } = await sb
        .from("hivemind_recommendations")
        .update({
          status: "completed",
          result: "Notification gap is no longer present on the latest scheduled check.",
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId)
        .eq("source", NOTIFICATION_GAP_SOURCE)
        .in("id", resolvedIds)
        .in("status", NOTIFICATION_GAP_OPEN_STATES);
      if (error) throw new Error(error.message);
    }

    // Match executive reasoning: assistant/operator modes may place a
    // follow-through in the approval queue, but it is always pending and never
    // executes here. Recommend mode leaves the visible recommendation for the
    // owner to act on.
    if (
      followThroughCandidates.length &&
      ["assistant", "operator", "executive_operator"].includes(mode.mode)
    ) {
      const { proposeFollowThroughForRecommendation } =
        await import("@/lib/hivemind/executive-followthrough.server");
      const { isWbahWorkspaceId } = await import("@/lib/wbah-exclusion.shared");
      for (const rec of followThroughCandidates) {
        const result = await proposeFollowThroughForRecommendation(sb, workspaceId, rec, mode, {
          isWbah: isWbahWorkspaceId(workspaceId),
          proposedBy: "notification_gap_sweep",
        });
        if (result.ok) proposed++;
      }
    }

    return {
      findings: detection.findings.length,
      created,
      refreshed,
      reopened,
      resolved: resolvedIds.length,
      proposed,
    };
  },
};

// ── Task accountability (Stage 2) ─────────────────────────────────────────────
//
// Deterministic re-checks per trigger_type: has the underlying signal that
// created a task actually recovered? Used when a completed task's reassess_at
// arrives — if the signal persists, the task is reopened.
const TRIGGER_RECHECKS: Record<
  string,
  (sb: Sb, workspaceId: string, entityId: string) => Promise<boolean> // true = signal persists
> = {
  lead_stale: async (sb, workspaceId) => {
    // WBAH split: never query the oversized `leads` table for WBAH — skip
    // the recheck (signal treated as cleared; WBAH lead flows are manual).
    const { isWbahWorkspaceId } = await import("@/lib/wbah-exclusion.shared");
    if (isWbahWorkspaceId(workspaceId)) return false;
    const cutoff = new Date(Date.now() - 7 * 24 * HOUR).toISOString();
    const { count } = await sb.from("leads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "need_to_call")
      .lt("updated_at", cutoff);
    return (count ?? 0) >= 5;
  },
  workflow_failed: async (sb, workspaceId, entityId) => {
    // entityId is a workflow_run id; look up its workflow, then check for
    // fresh failures of the same workflow in the last 24h.
    const { data: run } = await sb.from("workflow_runs")
      .select("workflow_id").eq("id", entityId).eq("workspace_id", workspaceId).maybeSingle();
    if (!run?.workflow_id) return false;
    const { count } = await sb.from("workflow_runs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("workflow_id", run.workflow_id)
      .eq("status", "failed")
      .gte("completed_at", new Date(Date.now() - 24 * HOUR).toISOString());
    return (count ?? 0) > 0;
  },
  booking_missed: async (sb, workspaceId, entityId) => {
    const { data: b } = await sb.from("calendar_bookings")
      .select("status").eq("id", entityId).eq("workspace_id", workspaceId).maybeSingle();
    return !!b && ["pending", "accepted"].includes(String(b.status));
  },
  integration_disconnected: async (sb, workspaceId, entityId) => {
    const [category, ...rest] = entityId.split(":");
    const provider = rest.join(":");
    if (!category || !provider) return false;
    const { data: p } = await sb.from("provider_settings")
      .select("status")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", category)
      .eq("provider_name", provider)
      .maybeSingle();
    return p?.status === "error";
  },
};

/** 6-hourly: overdue-task escalation, completed-task reassessment (reopen if
 * the underlying signal persists), and expiry of untouched recommendations. */
const taskAccountabilityJob: ReconJob = {
  key: "task_accountability",
  intervalMs: 6 * HOUR,
  run: async (sb, workspaceId) => {
    const nowIso = new Date().toISOString();
    const day = nowIso.slice(0, 10);
    let escalated = 0, reopened = 0, closedReassess = 0, expiredRecs = 0;

    // 1. Overdue, not-completed tasks → escalation event (deduped per task/day).
    const { data: overdue } = await sb.from("hivemind_tasks")
      .select("id, title, status, due_date, escalated_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["suggested", "approved", "in_progress"])
      .not("due_date", "is", null)
      .lt("due_date", nowIso)
      .limit(50);
    for (const t of overdue ?? []) {
      // Escalate at most once per 24h per task.
      if (t.escalated_at && Date.now() - new Date(t.escalated_at).getTime() < 24 * HOUR) continue;
      await publish(sb, {
        workspaceId,
        eventType: "task_overdue",
        sourceSystem: "hivemind",
        severity: "warning",
        title: `Task overdue: ${String(t.title).slice(0, 120)}`,
        summary: `Task "${String(t.title).slice(0, 120)}" passed its due date (${String(t.due_date).slice(0, 10)}) and is still ${t.status}.`,
        entityType: "hivemind_task",
        entityId: String(t.id),
        dedupKey: `task_overdue:${t.id}:${day}`,
        evidence: { taskId: t.id, dueDate: t.due_date, status: t.status },
      });
      await sb.from("hivemind_tasks")
        .update({ escalated_at: nowIso })
        .eq("id", t.id).eq("workspace_id", workspaceId);
      escalated++;
    }

    // 2. Completed tasks whose reassess_at has arrived → recheck the signal.
    const { data: due } = await sb.from("hivemind_tasks")
      .select("id, title, trigger_type, entity_id, reopened_count")
      .eq("workspace_id", workspaceId)
      .eq("status", "completed")
      .not("reassess_at", "is", null)
      .lt("reassess_at", nowIso)
      .limit(50);
    for (const t of due ?? []) {
      const recheck = TRIGGER_RECHECKS[String(t.trigger_type)];
      let persists = false;
      if (recheck) {
        try { persists = await recheck(sb, workspaceId, String(t.entity_id ?? "")); }
        catch { persists = false; }
      }
      if (persists) {
        const { error: reopenErr } = await sb.from("hivemind_tasks")
          .update({
            status: "suggested",
            reopened_count: (t.reopened_count ?? 0) + 1,
            reassess_at: new Date(Date.now() + 7 * 24 * HOUR).toISOString(),
          })
          .eq("id", t.id).eq("workspace_id", workspaceId);
        if (reopenErr) {
          // Unique open-task index conflict: a fresh open task for the same
          // (trigger, entity) already exists — keep this one completed and
          // stop reassessing it.
          await sb.from("hivemind_tasks")
            .update({ reassess_at: null })
            .eq("id", t.id).eq("workspace_id", workspaceId);
          closedReassess++;
          continue;
        }
        await publish(sb, {
          workspaceId,
          eventType: "task_reopened",
          sourceSystem: "hivemind",
          severity: "warning",
          title: `Reopened: ${String(t.title).slice(0, 120)} — underlying signal persists`,
          summary: `Task was completed but the "${t.trigger_type}" condition still holds on re-check.`,
          entityType: "hivemind_task",
          entityId: String(t.id),
          dedupKey: `task_reopened:${t.id}:${day}`,
          evidence: { taskId: t.id, triggerType: t.trigger_type, reopenedCount: (t.reopened_count ?? 0) + 1 },
        });
        reopened++;
      } else {
        // Signal cleared (or no recheck exists) — stop reassessing.
        await sb.from("hivemind_tasks")
          .update({ reassess_at: null })
          .eq("id", t.id).eq("workspace_id", workspaceId);
        closedReassess++;
      }
    }

    // 3. Recommendations never touched by reassess time → expired.
    const { data: staleRecs } = await sb.from("hivemind_recommendations")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "new")
      .not("reassess_at", "is", null)
      .lt("reassess_at", nowIso)
      .limit(100);
    if (staleRecs?.length) {
      await sb.from("hivemind_recommendations")
        .update({ status: "expired", updated_at: nowIso })
        .eq("workspace_id", workspaceId)
        .in("id", staleRecs.map((r: any) => r.id))
        .eq("status", "new");
      expiredRecs = staleRecs.length;
    }

    return { escalated, reopened, closedReassess, expiredRecs };
  },
};

/** 6-hourly: reassess executed HiveMind actions, classify outcomes against
 * their baselines, publish action_outcome events, and feed confidence
 * adjustments back into the learning loop. */
const actionOutcomeLearningJob: ReconJob = {
  key: "action_outcome_learning",
  intervalMs: 6 * HOUR,
  run: async (sb, workspaceId) => {
    const { runActionOutcomeLearning } = await import("@/lib/hivemind/action-learning.server");
    return runActionOutcomeLearning(sb, workspaceId);
  },
};

const RECON_JOBS: ReconJob[] = [
  failedWorkflowsJob,
  missedAppointmentsJob,
  integrationFailuresJob,
  staleLeadsJob,
  executiveReasoningJob,
  notificationGapRecommendationsJob,
  taskAccountabilityJob,
  actionOutcomeLearningJob,
];

/** Exported for e2e tests only — validates jobs against the real schema. */
export const RECON_JOBS_FOR_TEST: ReconJob[] = RECON_JOBS;

// ── CAS claim ─────────────────────────────────────────────────────────────────

/**
 * Claim (workspace, job) if due. Returns true only for the winner: the update
 * compare-and-swaps on the previously observed last_run_at, so a concurrent
 * tick loses the race and skips.
 */
export async function claimReconJob(
  sb: Sb,
  workspaceId: string,
  jobKey: string,
  intervalMs: number,
  now = new Date(),
): Promise<boolean> {
  const { data: existing, error: selErr } = await sb
    .from("hivemind_reconciliation_state")
    .select("id, last_run_at")
    .eq("workspace_id", workspaceId)
    .eq("job_key", jobKey)
    .maybeSingle();
  if (selErr) return false;

  if (!existing) {
    // First run — unique index makes double-insert impossible; loser skips.
    const { data: inserted, error } = await sb
      .from("hivemind_reconciliation_state")
      .upsert(
        {
          workspace_id: workspaceId,
          job_key: jobKey,
          last_run_at: now.toISOString(),
          last_status: "running",
          updated_at: now.toISOString(),
        },
        { onConflict: "workspace_id,job_key", ignoreDuplicates: true },
      )
      .select("id");
    return !error && !!inserted?.length;
  }

  const lastRun = existing.last_run_at ? new Date(existing.last_run_at).getTime() : 0;
  if (now.getTime() - lastRun < intervalMs) return false;

  let claim = sb
    .from("hivemind_reconciliation_state")
    .update({ last_run_at: now.toISOString(), last_status: "running", updated_at: now.toISOString() })
    .eq("id", existing.id);
  claim = existing.last_run_at
    ? claim.eq("last_run_at", existing.last_run_at)
    : claim.is("last_run_at", null);
  const { data: claimed, error } = await claim.select("id");
  return !error && !!claimed?.length;
}

async function recordJobResult(
  sb: Sb,
  workspaceId: string,
  jobKey: string,
  status: "ok" | "error",
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await sb
      .from("hivemind_reconciliation_state")
      .update({ last_status: status, last_detail: detail, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("job_key", jobKey);
  } catch { /* best-effort */ }
}

/** Read every workspace deterministically so recurring jobs cannot starve
 * workspaces after a fixed PostgREST page limit. */
export async function listWorkspaceIdsForReconciliation(sb: Sb): Promise<string[]> {
  const ids: string[] = [];
  let afterId: string | null = null;

  for (;;) {
    let query = sb
      .from("workspaces")
      .select("id")
      .order("id", { ascending: true })
      .limit(WORKSPACE_PAGE_SIZE);
    if (afterId) query = query.gt("id", afterId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Array<{ id: string }>;
    if (!page.length) break;

    ids.push(...page.map((workspace) => workspace.id));
    if (page.length < WORKSPACE_PAGE_SIZE) break;
    afterId = page[page.length - 1]!.id;
  }

  return ids;
}

// ── Tick entry point ──────────────────────────────────────────────────────────

export async function runExecutiveEventsTick(): Promise<ExecutiveEventsTick> {
  const out: ExecutiveEventsTick = {
    workspacesScanned: 0,
    jobsRun: 0,
    eventsPublished: 0,
    eventsClassified: 0,
    errors: 0,
  };

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) return out;

  try {
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } }) as Sb;
    publishedThisRun = 0;

    const workspaceIds = await listWorkspaceIdsForReconciliation(sb);
    if (!workspaceIds.length) return out;

    for (const workspaceId of workspaceIds) {
      out.workspacesScanned++;
      for (const job of RECON_JOBS) {
        try {
          const claimed = await claimReconJob(sb, workspaceId, job.key, job.intervalMs);
          if (!claimed) continue;
          out.jobsRun++;
          try {
            const detail = await job.run(sb, workspaceId);
            await recordJobResult(sb, workspaceId, job.key, "ok", detail);
          } catch (jobErr: any) {
            out.errors++;
            await recordJobResult(sb, workspaceId, job.key, "error", {
              error: String(jobErr?.message ?? jobErr).slice(0, 500),
            });
          }
        } catch (claimErr: any) {
          out.errors++;
          console.warn(
            `[exec-events] recon ${job.key} failed for ws ${workspaceId}:`,
            claimErr?.message ?? claimErr,
          );
        }
      }
    }

    out.eventsPublished = publishedThisRun;

    const classify = await classifyPendingExecutiveEvents(sb, 500);
    out.eventsClassified = classify.classified;
    out.errors += classify.failed > 0 ? 1 : 0;
  } catch (err: any) {
    out.errors++;
    console.warn("[exec-events] tick failed (non-fatal):", err?.message ?? err);
  }
  return out;
}
