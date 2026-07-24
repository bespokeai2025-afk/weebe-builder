// ── SystemMind call runtime: unified background tick + health monitor ────────
// Called from the campaign-executor tick (prod pg_cron endpoint + dev Vite
// plugin). Best-effort: each phase catches its own errors.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { evaluateTriggersTick } from "./triggers.server";
import { claimDueQueueEntries } from "./queue.server";
import { processQueueEntry, retryIntegrationErrorsTick } from "./pipeline.server";

const sb = supabaseAdmin as any;

export interface CallRuntimeTickResult {
  triggersEvaluated: number;
  enqueued: number;
  claimed: number;
  processed: Record<string, number>;
  integrationRetries: { retried: number; resolved: number; deadLettered: number };
  healthUpdated: number;
}

export async function runCallRuntimeTick(): Promise<CallRuntimeTickResult> {
  const result: CallRuntimeTickResult = {
    triggersEvaluated: 0,
    enqueued: 0,
    claimed: 0,
    processed: {},
    integrationRetries: { retried: 0, resolved: 0, deadLettered: 0 },
    healthUpdated: 0,
  };

  try {
    const t = await evaluateTriggersTick();
    result.triggersEvaluated = t.evaluated;
    result.enqueued = t.enqueued;
  } catch (e) {
    console.warn("[call-runtime-tick] trigger evaluation failed:", e instanceof Error ? e.message : e);
  }

  try {
    const claimed = await claimDueQueueEntries({ limit: 5 });
    result.claimed = claimed.length;
    for (const row of claimed) {
      const status = await processQueueEntry(row);
      result.processed[status] = (result.processed[status] ?? 0) + 1;
    }
  } catch (e) {
    console.warn("[call-runtime-tick] queue processing failed:", e instanceof Error ? e.message : e);
  }

  try {
    result.integrationRetries = await retryIntegrationErrorsTick();
  } catch (e) {
    console.warn("[call-runtime-tick] integration retry sweep failed:", e instanceof Error ? e.message : e);
  }

  try {
    result.healthUpdated = await runHealthSweep();
  } catch (e) {
    console.warn("[call-runtime-tick] health sweep failed:", e instanceof Error ? e.message : e);
  }

  return result;
}

// ── Health monitoring ─────────────────────────────────────────────────────────
// Health per ACTIVE activation, recomputed at most every 15 minutes:
//   healthy  — recent executions succeeding, no dead-letter errors
//   warning  — elevated failure rate OR pending integration errors
//   degraded — majority of recent executions failing OR dead-letter errors
//   failed   — every recent execution failed
//   paused   — activation paused

export interface HealthReport {
  status: "healthy" | "warning" | "degraded" | "failed" | "paused" | "unknown";
  checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  recommendedActions: string[];
  computedAt: string;
}

export async function computeActivationHealth(activation: {
  id: string;
  workspace_id: string;
  status: string;
}): Promise<HealthReport> {
  const checks: HealthReport["checks"] = [];
  const actions: string[] = [];
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  if (activation.status === "paused") {
    return {
      status: "paused",
      checks: [{ key: "paused", label: "Workflow paused", ok: false, detail: "The workflow is paused — no calls are being placed." }],
      recommendedActions: ["Resume the workflow from the setup wizard when ready."],
      computedAt: new Date().toISOString(),
    };
  }

  const { data: execs } = await sb
    .from("systemmind_workflow_executions")
    .select("status")
    .eq("workspace_id", activation.workspace_id)
    .eq("activation_id", activation.id)
    .gte("started_at", since)
    .limit(200);
  const total = execs?.length ?? 0;
  const failedCount = (execs ?? []).filter((e: any) => e.status === "failed").length;
  const failRate = total ? failedCount / total : 0;
  checks.push({
    key: "executions",
    label: "Recent executions (24h)",
    ok: failRate < 0.3,
    detail: total ? `${total} runs, ${failedCount} failed (${Math.round(failRate * 100)}%)` : "No executions in the last 24h",
  });
  if (failRate >= 0.3) actions.push("Open the execution log and review the failing step — most failures share a root cause.");

  // Scope error/queue signals to THIS workflow's agent so one workflow is
  // never marked degraded because of another workflow's failures.
  let pendingQ = sb
    .from("systemmind_integration_errors")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", activation.workspace_id)
    .in("status", ["pending", "retrying"]);
  let deadQ = sb
    .from("systemmind_integration_errors")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", activation.workspace_id)
    .eq("status", "dead_letter");
  if (activation.agent_id) {
    pendingQ = pendingQ.eq("agent_id", activation.agent_id);
    deadQ = deadQ.eq("agent_id", activation.agent_id);
  }
  const { count: pendingErrors } = await pendingQ;
  const { count: deadErrors } = await deadQ;
  checks.push({
    key: "integration_errors",
    label: "Integration errors",
    ok: (pendingErrors ?? 0) === 0 && (deadErrors ?? 0) === 0,
    detail: `${pendingErrors ?? 0} retrying, ${deadErrors ?? 0} dead-lettered`,
  });
  if ((deadErrors ?? 0) > 0) actions.push("Dead-lettered CRM write-backs need manual retry — check the CRM connection first.");

  let stuckQ = sb
    .from("systemmind_call_queue")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", activation.workspace_id)
    .eq("status", "waiting_for_data");
  if (activation.agent_id) stuckQ = stuckQ.eq("agent_id", activation.agent_id);
  const { count: stuck } = await stuckQ;
  checks.push({
    key: "waiting_for_data",
    label: "Queue entries waiting for data",
    ok: (stuck ?? 0) === 0,
    detail: `${stuck ?? 0} entries missing required fields`,
  });
  if ((stuck ?? 0) > 0) actions.push("Some calls are blocked on missing required data — review the field mappings.");

  let status: HealthReport["status"] = "healthy";
  if (total > 0 && failedCount === total) status = "failed";
  else if (failRate >= 0.5 || (deadErrors ?? 0) > 0) status = "degraded";
  else if (failRate >= 0.3 || (pendingErrors ?? 0) > 0 || (stuck ?? 0) > 0) status = "warning";

  return { status, checks, recommendedActions: actions, computedAt: new Date().toISOString() };
}

async function runHealthSweep(): Promise<number> {
  const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: activations } = await sb
    .from("systemmind_workflow_activations")
    .select("id, workspace_id, agent_id, status, health_checked_at")
    .in("status", ["active", "paused"])
    .or(`health_checked_at.is.null,health_checked_at.lt.${staleBefore}`)
    .limit(20);
  let updated = 0;
  for (const a of activations ?? []) {
    try {
      const report = await computeActivationHealth(a);
      await sb
        .from("systemmind_workflow_activations")
        .update({
          health_status: report.status,
          health: report,
          health_checked_at: report.computedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", a.id);
      updated++;
    } catch (e) {
      console.warn("[call-runtime-health] failed for activation", a.id, e instanceof Error ? e.message : e);
    }
  }
  return updated;
}
