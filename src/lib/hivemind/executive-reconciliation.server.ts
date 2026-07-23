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
import {
  publishExecutiveEvent,
  classifyPendingExecutiveEvents,
} from "./executive-events.shared";

type Sb = any;

const HOUR = 60 * 60 * 1000;

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

    const { data: workspaces, error } = await sb
      .from("workspaces")
      .select("id")
      .limit(500);
    if (error || !workspaces?.length) return out;

    for (const ws of workspaces) {
      out.workspacesScanned++;
      for (const job of RECON_JOBS) {
        try {
          const claimed = await claimReconJob(sb, ws.id, job.key, job.intervalMs);
          if (!claimed) continue;
          out.jobsRun++;
          try {
            const detail = await job.run(sb, ws.id);
            await recordJobResult(sb, ws.id, job.key, "ok", detail);
          } catch (jobErr: any) {
            out.errors++;
            await recordJobResult(sb, ws.id, job.key, "error", {
              error: String(jobErr?.message ?? jobErr).slice(0, 500),
            });
          }
        } catch (claimErr: any) {
          out.errors++;
          console.warn(
            `[exec-events] recon ${job.key} failed for ws ${ws.id}:`,
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
