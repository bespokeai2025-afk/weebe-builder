/**
 * WBAH post-call job queue — enqueue webhook work, process with retries (campaign scale).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";
import {
  deriveWbahExecutionDisplayStatus,
  matchesWbahExecutionFilter,
  wbahExecutionDbStatusForFilter,
  type WbahExecutionDisplayStatus,
  type WbahExecutionListFilter,
} from "./wbah-execution-status.shared";

const BASE_BACKOFF_MS = 2000;
const MAX_BATCH = 25;
const STALE_PROCESSING_MS = 5 * 60_000;

/**
 * How long after it was queued a job is still retried automatically.
 *
 * The retry poller was never scheduled, so jobs that failed from August to October 2026 sat
 * "pending" with their original payloads. Replaying a call from weeks ago would write its
 * then-current status over whatever the lead has become since, so old jobs are marked failed
 * instead and left to a deliberate rerun. Override with WBAH_POST_CALL_RETRY_WINDOW_HOURS.
 */
const DEFAULT_RETRY_WINDOW_HOURS = 6;

export function wbahPostCallRetryWindowMs(): number {
  const hours = Number(process.env.WBAH_POST_CALL_RETRY_WINDOW_HOURS ?? "");
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_RETRY_WINDOW_HOURS) * 3600_000;
}

export const WBAH_RETRY_WINDOW_EXPIRED_NOTE =
  "Not retried automatically: older than the retry window. Rerun it from the executions list.";

export function isWbahPostCallQueueEnabled(): boolean {
  const v = process.env.WBAH_POST_CALL_QUEUE ?? "true";
  return v === "true" || v === "1";
}

function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, 120_000);
}

export async function enqueueWbahPostCallJob(input: {
  workspaceId: string;
  retellCallId: string | null;
  leadId: string | null;
  event: string;
  agentId: string | null;
  payload: Record<string, unknown>;
}): Promise<{ jobId: string | null; deduped: boolean }> {
  if (input.workspaceId !== WBAH_WORKSPACE_ID) {
    return { jobId: null, deduped: false };
  }

  const sb = supabaseAdmin as any;

  if (input.retellCallId) {
    const { data: existing } = await sb
      .from("wbah_post_call_jobs")
      .select("id, status")
      .eq("workspace_id", input.workspaceId)
      .eq("retell_call_id", input.retellCallId)
      .eq("event", input.event)
      .in("status", ["pending", "processing"])
      .maybeSingle();
    if (existing?.id) return { jobId: existing.id, deduped: true };
  }

  const { data, error } = await sb
    .from("wbah_post_call_jobs")
    .insert({
      workspace_id: input.workspaceId,
      retell_call_id: input.retellCallId,
      lead_id: input.leadId,
      event: input.event,
      agent_id: input.agentId,
      payload: input.payload,
      status: "pending",
      next_retry_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[WBAH QUEUE] enqueue failed:", error.message);
    return { jobId: null, deduped: false };
  }
  return { jobId: data.id as string, deduped: false };
}

export async function processWbahPostCallJobById(
  jobId: string,
  opts?: { disabledStepIds?: string[] },
): Promise<{
  ok: boolean;
  branches: string[];
  errors: string[];
}> {
  const sb = supabaseAdmin as any;
  const { data: row } = await sb.from("wbah_post_call_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!row) return { ok: false, branches: [], errors: ["job not found"] };
  if (row.status === "completed") {
    return { ok: true, branches: row.branches ?? [], errors: row.errors ?? [] };
  }

  const attempt = (row.attempt_count ?? 0) + 1;
  // Claim atomically: the update only succeeds if the row is still "pending"
  // (or has been stuck "processing" long enough to assume a crashed worker).
  // Without this WHERE guard, the immediate post-enqueue drain and the
  // scheduled poller can both read "pending" before either write lands and
  // both run the full pipeline concurrently — this is exactly what produced
  // 8x duplicate Dynamics PATCHes for a single call.
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: claimed } = await sb
    .from("wbah_post_call_jobs")
    .update({
      status: "processing",
      attempt_count: attempt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .or(`status.eq.pending,and(status.eq.processing,updated_at.lt.${staleThreshold})`)
    .select("id");

  if (!claimed || claimed.length === 0) {
    // Another worker already claimed (or is actively processing) this job —
    // bail without re-running the pipeline.
    console.warn("[WBAH QUEUE] job already claimed elsewhere, skipping", { jobId });
    return { ok: true, branches: row.branches ?? [], errors: row.errors ?? [] };
  }

  // A retry replays the whole pipeline. Steps that cannot safely run twice and already succeeded
  // on an earlier attempt are held back — otherwise a Dynamics failure after the Calendly step
  // would book the customer a second appointment on every retry.
  const alreadyDone = attempt > 1 ? await unsafeStepsAlreadyDone(sb, jobId) : [];
  const disabledStepIds = [...new Set([...(opts?.disabledStepIds ?? []), ...alreadyDone])];

  try {
    const { runWbahPostCallPipelineCore } = await import("./wbah-post-call.server");
    const { resolveWbahRetellAgent } = await import("./wbah-retell-agents.shared");
    const payload = row.payload as Record<string, unknown>;
    const call = (payload.call ?? {}) as Record<string, unknown>;
    const agentId = String(row.agent_id ?? call.agent_id ?? "");
    const agent = resolveWbahRetellAgent(agentId);
    if (!agent) throw new Error("WBAH agent not found");

    const result = await runWbahPostCallPipelineCore({
      event: row.event,
      call: call as any,
      payload,
      agent,
      skipLiveTranscript: true,
      wbahJobId: jobId,
      disabledStepIds,
    });

    await sb
      .from("wbah_post_call_jobs")
      .update({
        status: "completed",
        branches: result.branches,
        errors: result.errors,
        last_error: result.errors[0] ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return { ok: true, branches: result.branches, errors: result.errors };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const max = row.max_attempts ?? 5;
    const terminal = attempt >= max;
    await sb
      .from("wbah_post_call_jobs")
      .update({
        status: terminal ? "failed" : "pending",
        last_error: msg,
        errors: terminal ? [msg] : [],
        branches: [],
        next_retry_at: terminal
          ? new Date().toISOString()
          : new Date(Date.now() + backoffMs(attempt)).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { ok: false, branches: [], errors: [msg] };
  }
}

/** Unsafe steps that succeeded in any earlier execution of this job. */
async function unsafeStepsAlreadyDone(sb: any, jobId: string): Promise<string[]> {
  try {
    const { data: execs } = await sb
      .from("automation_workflow_executions")
      .select("id")
      .eq("wbah_job_id", jobId);
    const ids = ((execs ?? []) as { id: string }[]).map((e) => e.id);
    if (!ids.length) return [];
    const { data: steps } = await sb
      .from("automation_execution_steps")
      .select("step:output_masked->>_wbahStep, skipped:output_masked->>_wbahSkipped")
      .in("execution_id", ids)
      .eq("status", "success");
    return wbahUnsafeStepsFromRows((steps ?? []) as Array<{ step: string | null; skipped: string | null }>);
  } catch (e) {
    console.warn("[WBAH QUEUE] could not read earlier attempts; holding back unsafe steps", e);
    // Unknown is treated as done: a missing booking can be rerun, a duplicate cannot be undone.
    return [...WBAH_RERUN_UNSAFE_STEP_IDS];
  }
}

export function wbahUnsafeStepsFromRows(
  rows: Array<{ step: string | null; skipped: string | null }>,
): string[] {
  const unsafe = new Set<string>(WBAH_RERUN_UNSAFE_STEP_IDS);
  const done = new Set<string>();
  for (const r of rows) {
    if (r.step && unsafe.has(r.step) && r.skipped !== "true") done.add(r.step);
  }
  return [...done];
}

export async function runWbahPostCallQueuePoller(limit = MAX_BATCH): Promise<{
  checked: number;
  processed: number;
  failed: number;
  expired: number;
  errors: string[];
}> {
  const sb = supabaseAdmin as any;
  const now = new Date().toISOString();
  const windowStart = new Date(Date.now() - wbahPostCallRetryWindowMs()).toISOString();
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();

  // Jobs past the retry window are closed, not replayed — see DEFAULT_RETRY_WINDOW_HOURS.
  // last_error keeps the original failure; the note says why it stopped.
  const { data: expiredRows, error: expireErr } = await sb
    .from("wbah_post_call_jobs")
    .update({ status: "failed", errors: [WBAH_RETRY_WINDOW_EXPIRED_NOTE], updated_at: now })
    .in("status", ["pending", "processing"])
    .lt("created_at", windowStart)
    .lt("updated_at", staleThreshold)
    .select("id");
  if (expireErr) console.warn("[WBAH QUEUE] expiring old jobs failed:", expireErr.message);
  const expired = (expiredRows ?? []).length;

  // Due retries, plus jobs a crashed worker left "processing" (the claim allows those too).
  const { data: jobs } = await sb
    .from("wbah_post_call_jobs")
    .select("id")
    .or(`status.eq.pending,and(status.eq.processing,updated_at.lt.${staleThreshold})`)
    .lte("next_retry_at", now)
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true })
    .limit(limit);

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const j of (jobs ?? []) as { id: string }[]) {
    const res = await processWbahPostCallJobById(j.id);
    if (res.ok && !res.errors.length) processed++;
    else {
      failed++;
      if (res.errors[0]) errors.push(res.errors[0]);
    }
  }

  return { checked: (jobs ?? []).length, processed, failed, expired, errors };
}

/** A separate automation worker process runs queued jobs (src/lib/automation-engine/worker). */
export function isAutomationWorkerEnabled(): boolean {
  return /^(on|true|1|yes)$/i.test(String(process.env.AUTOMATION_WORKER ?? "").trim());
}

export function drainWbahPostCallQueueAsync(jobId: string | null): void {
  if (!jobId) return;
  // With the worker running, the webhook only enqueues; the worker picks the job up within seconds.
  if (isAutomationWorkerEnabled()) return;
  void processWbahPostCallJobById(jobId).catch((e) => {
    console.warn("[WBAH QUEUE] async drain failed:", e);
  });
}

export type WbahPostCallExecutionRow = {
  id: string;
  retellCallId: string | null;
  leadId: string | null;
  event: string;
  agentId: string | null;
  status: string;
  displayStatus: WbahExecutionDisplayStatus;
  branches: string[];
  errors: string[];
  lastError: string | null;
  attemptCount: number;
  maxAttempts: number;
  automationExecutionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WbahPostCallNodeStepRow = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: string;
  branch: string | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  outputMasked: Record<string, unknown>;
};

function mapExecutionRow(row: Record<string, unknown>): WbahPostCallExecutionRow {
  const mapped = {
    id: String(row.id),
    retellCallId: row.retell_call_id ? String(row.retell_call_id) : null,
    leadId: row.lead_id ? String(row.lead_id) : null,
    event: String(row.event ?? ""),
    agentId: row.agent_id ? String(row.agent_id) : null,
    status: String(row.status ?? "pending"),
    branches: Array.isArray(row.branches) ? (row.branches as string[]) : [],
    errors: Array.isArray(row.errors) ? (row.errors as string[]) : [],
    lastError: row.last_error ? String(row.last_error) : null,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    automationExecutionId: row.automation_execution_id
      ? String(row.automation_execution_id)
      : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
  return {
    ...mapped,
    displayStatus: deriveWbahExecutionDisplayStatus(mapped),
  };
}

export async function listWbahPostCallExecutions(
  workspaceId: string,
  opts?: {
    status?: WbahExecutionListFilter | "all" | "pending" | "processing" | "completed" | "failed" | "with_errors";
    limit?: number;
  },
): Promise<WbahPostCallExecutionRow[]> {
  const sb = supabaseAdmin as any;
  const limit = opts?.limit ?? 50;
  const rawFilter = opts?.status ?? "all";

  // Back-compat: map legacy filter names from older clients.
  const filter: WbahExecutionListFilter | "all" =
    rawFilter === "completed"
      ? "success"
      : rawFilter === "with_errors"
        ? "warning"
        : rawFilter === "pending" || rawFilter === "processing"
          ? "queued"
          : rawFilter;

  let q = sb
    .from("wbah_post_call_jobs")
    .select(
      "id, retell_call_id, lead_id, event, agent_id, status, branches, errors, last_error, attempt_count, max_attempts, automation_execution_id, created_at, updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (filter !== "all") {
    if (filter === "queued") {
      q = q.in("status", ["pending", "processing"]);
    } else {
      const dbStatus = wbahExecutionDbStatusForFilter(filter);
      if (dbStatus !== "all") {
        q = q.eq("status", dbStatus);
      }
    }
  }

  // Fetch extra rows when post-filtering success vs warning on completed jobs.
  const fetchLimit =
    filter === "success" || filter === "warning" ? Math.min(limit * 4, 400) : limit;
  q = q.limit(fetchLimit);

  const { data, error } = await q;
  if (error) {
    console.warn("[WBAH QUEUE] list executions failed:", error.message);
    return [];
  }

  let rows = ((data ?? []) as Record<string, unknown>[]).map(mapExecutionRow);
  if (filter !== "all") {
    rows = rows.filter((r) => matchesWbahExecutionFilter(r, filter));
  }
  return rows.slice(0, limit);
}

export async function getWbahPostCallExecution(
  workspaceId: string,
  jobId: string,
): Promise<
  (WbahPostCallExecutionRow & {
    payload: Record<string, unknown>;
    nodeSteps: WbahPostCallNodeStepRow[];
  }) | null
> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb
    .from("wbah_post_call_jobs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;

  let nodeSteps: WbahPostCallNodeStepRow[] = [];
  try {
    const { getAutomationStepsForWbahJob } = await import(
      "@/lib/automation-engine/persistence/execution-persistence.server"
    );
    const steps = await getAutomationStepsForWbahJob(workspaceId, jobId);
    nodeSteps = steps.map((s) => ({
      nodeId: s.nodeId,
      nodeName: s.nodeName,
      nodeType: s.nodeType,
      status: s.status,
      branch: s.branch,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      error: s.error,
      outputMasked: s.outputMasked,
    }));
  } catch {
    /* table may not exist until migration applied */
  }

  return {
    ...mapExecutionRow(data as Record<string, unknown>),
    payload: (data.payload ?? {}) as Record<string, unknown>,
    nodeSteps,
  };
}

export async function getWbahPostCallQueueStats(workspaceId: string): Promise<{
  pending: number;
  processing: number;
  failed: number;
  completed24h: number;
}> {
  const sb = supabaseAdmin as any;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [pending, processing, failed, completed] = await Promise.all([
    sb.from("wbah_post_call_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending"),
    sb.from("wbah_post_call_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "processing"),
    sb.from("wbah_post_call_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "failed"),
    sb.from("wbah_post_call_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "completed").gte("updated_at", since),
  ]);
  return {
    pending: pending.count ?? 0,
    processing: processing.count ?? 0,
    failed: failed.count ?? 0,
    completed24h: completed.count ?? 0,
  };
}

/**
 * Steps a manual rerun holds back unless the operator explicitly opts in.
 *
 * `calendly_invitee` calls createWbahCalendlyInvitee, which is not idempotent —
 * replaying it books the customer a second appointment for the same slot.
 * `live_transcript` only mirrors an in-progress call into the live session
 * table and means nothing once the call has ended.
 */
/** How long the retry poller leaves a manually rerun job alone. */
const RERUN_POLLER_HOLD_MS = 10 * 60_000;

export const WBAH_RERUN_UNSAFE_STEP_IDS = ["calendly_invitee", "live_transcript"] as const;

/**
 * Re-run one finished execution from its stored webhook payload.
 *
 * The job row keeps the original payload, so a rerun is a genuine replay rather
 * than a reconstruction: the same event goes through the same pipeline against
 * whatever the code and the CRM now look like. That is the point — it is how a
 * call that landed before a fix gets the fix applied.
 *
 * Two things this deliberately does NOT do. It does not reset attempt_count,
 * because that number records how hard the queue tried automatically and is
 * worth keeping; the rerun counts as one more attempt. And it does not bypass
 * `processWbahPostCallJobById`'s atomic claim — a rerun races the poller like
 * anything else, and the claim is what stops both running at once.
 */
export async function rerunWbahPostCallJob(
  workspaceId: string,
  jobId: string,
  opts?: { includeUnsafeSteps?: boolean },
): Promise<{
  ok: boolean;
  branches: string[];
  errors: string[];
  skippedSteps: string[];
}> {
  const sb = supabaseAdmin as any;
  const { data: row, error } = await sb
    .from("wbah_post_call_jobs")
    .select("id, workspace_id, payload, status")
    .eq("workspace_id", workspaceId)
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Execution not found");
  if (!row.payload || !(row.payload as Record<string, unknown>).call) {
    throw new Error("This execution has no stored payload to replay");
  }
  if (row.status === "processing") {
    throw new Error("This execution is already running");
  }

  const skippedSteps = opts?.includeUnsafeSteps ? [] : [...WBAH_RERUN_UNSAFE_STEP_IDS];

  // Back to pending so the claim in processWbahPostCallJobById can take it;
  // the completed-status early return would otherwise turn a rerun into a
  // no-op that reported the previous run's branches as if they were fresh.
  const { error: resetErr } = await sb
    .from("wbah_post_call_jobs")
    .update({
      status: "pending",
      branches: [],
      errors: [],
      last_error: null,
      // NOT NULL in the table. Set ahead, not now: the rerun processes the job itself just below,
      // and a due time of "now" would let the retry poller race it for the claim — and run it
      // without the steps this rerun holds back.
      next_retry_at: new Date(Date.now() + RERUN_POLLER_HOLD_MS).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", jobId);
  if (resetErr) throw new Error(resetErr.message);

  console.log("[WBAH QUEUE] manual rerun requested", { jobId, workspaceId, skippedSteps });
  const result = await processWbahPostCallJobById(jobId, { disabledStepIds: skippedSteps });
  return { ...result, skippedSteps };
}
