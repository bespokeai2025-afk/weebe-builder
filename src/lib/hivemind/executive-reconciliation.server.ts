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

const RECON_JOBS: ReconJob[] = [
  failedWorkflowsJob,
  missedAppointmentsJob,
  integrationFailuresJob,
  staleLeadsJob,
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
