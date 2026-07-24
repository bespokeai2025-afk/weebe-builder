// ── SystemMind call runtime: execution logging + masking ─────────────────────
// Every workflow execution gets a systemmind_workflow_executions row plus
// per-step systemmind_execution_steps rows (timestamps, masked inputs/outputs,
// errors with resolution hints). Server-only writes; members read via RLS.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

// ── Masking ───────────────────────────────────────────────────────────────────

const SECRET_KEY_RE = /token|secret|password|api_?key|authorization|credential|bearer/i;
const SENSITIVE_KEY_RE = /dob|date_of_birth|birth_?date|ssn|national_insurance|card|iban|sort_code|account_number/i;

/** Mask secrets fully and sensitive personal values partially. Non-recursive keys pass through. */
export function maskRecord(rec: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!rec || typeof rec !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (SECRET_KEY_RE.test(k)) { out[k] = "•••"; continue; }
    if (v != null && typeof v === "object") { out[k] = maskRecord(v as Record<string, unknown>); continue; }
    const s = v == null ? "" : String(v);
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = s.length <= 2 ? "••" : `${s.slice(0, 2)}•••`;
    } else {
      out[k] = s.length > 500 ? `${s.slice(0, 500)}…` : v;
    }
  }
  return out;
}

// ── Execution state machine ───────────────────────────────────────────────────

const EXEC_TRANSITIONS: Record<string, string[]> = {
  running: ["completed", "failed", "partial", "cancelled"],
  completed: [],
  failed: [],
  partial: [],
  cancelled: [],
};

export interface ExecutionHandle {
  id: string;
  workspaceId: string;
  step: (
    key: string,
    label: string,
    fn: () => Promise<{ output?: Record<string, unknown>; externalResponse?: Record<string, unknown> } | void>,
    opts?: { retryable?: boolean; resolutionHint?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  skipStep: (key: string, label: string, reason: string) => Promise<void>;
  finish: (status: "completed" | "failed" | "partial" | "cancelled", opts?: { error?: string; summary?: Record<string, unknown> }) => Promise<void>;
}

export async function startExecution(args: {
  workspaceId: string;
  kind?: string;
  activationId?: string | null;
  triggerId?: string | null;
  queueId?: string | null;
  agentId?: string | null;
  leadId?: string | null;
  triggerSource?: string;
  idempotencyKey?: string | null;
}): Promise<ExecutionHandle | null> {
  const insert: Record<string, unknown> = {
    workspace_id: args.workspaceId,
    kind: args.kind ?? "call_run",
    activation_id: args.activationId ?? null,
    trigger_id: args.triggerId ?? null,
    queue_id: args.queueId ?? null,
    agent_id: args.agentId ?? null,
    lead_id: args.leadId ?? null,
    trigger_source: args.triggerSource ?? "",
    idempotency_key: args.idempotencyKey ?? null,
    status: "running",
  };
  const { data, error } = await sb
    .from("systemmind_workflow_executions")
    .insert(insert)
    .select("id")
    .single();
  if (error) {
    // 23505 on the idempotency partial unique index = this execution already
    // ran (webhook replay / double tick). Caller must treat null as "skip".
    if (String(error.code) === "23505") return null;
    throw new Error(`startExecution failed: ${error.message}`);
  }

  const executionId = data.id as string;
  let currentStatus = "running";

  return {
    id: executionId,
    workspaceId: args.workspaceId,

    async step(key, label, fn, opts) {
      const { data: stepRow } = await sb
        .from("systemmind_execution_steps")
        .insert({
          execution_id: executionId,
          workspace_id: args.workspaceId,
          step_key: key,
          step_label: label,
          status: "running",
          retryable: opts?.retryable ?? false,
        })
        .select("id")
        .single();
      const stepId = stepRow?.id as string | undefined;
      try {
        const res = (await fn()) ?? {};
        if (stepId) {
          await sb
            .from("systemmind_execution_steps")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              output_masked: maskRecord(res.output ?? {}),
              external_response_masked: res.externalResponse ? maskRecord(res.externalResponse) : null,
            })
            .eq("id", stepId);
        }
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (stepId) {
          await sb
            .from("systemmind_execution_steps")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              error: msg.slice(0, 1000),
              resolution_hint: opts?.resolutionHint ?? null,
            })
            .eq("id", stepId);
        }
        return { ok: false, error: msg };
      }
    },

    async skipStep(key, label, reason) {
      await sb.from("systemmind_execution_steps").insert({
        execution_id: executionId,
        workspace_id: args.workspaceId,
        step_key: key,
        step_label: label,
        status: "skipped",
        completed_at: new Date().toISOString(),
        output_masked: { reason },
      });
    },

    async finish(status, opts) {
      if (!EXEC_TRANSITIONS[currentStatus]?.includes(status)) return;
      currentStatus = status;
      await sb
        .from("systemmind_workflow_executions")
        .update({
          status,
          completed_at: new Date().toISOString(),
          error: opts?.error?.slice(0, 1000) ?? null,
          summary: opts?.summary ?? {},
        })
        .eq("id", executionId);
    },
  };
}

// ── Integration errors (never silent) ────────────────────────────────────────

const RETRY_BACKOFF_MINUTES = [1, 5, 15, 60, 240];

export async function recordIntegrationError(args: {
  workspaceId: string;
  executionId?: string | null;
  queueId?: string | null;
  kind: string;
  operation: Record<string, unknown>;
  error: string;
}): Promise<string | null> {
  const { data } = await sb
    .from("systemmind_integration_errors")
    .insert({
      workspace_id: args.workspaceId,
      execution_id: args.executionId ?? null,
      queue_id: args.queueId ?? null,
      kind: args.kind,
      operation: maskRecord(args.operation),
      error: args.error.slice(0, 1000),
      status: "pending",
      next_retry_at: new Date(Date.now() + RETRY_BACKOFF_MINUTES[0] * 60_000).toISOString(),
    })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}

export async function scheduleIntegrationRetry(errorId: string): Promise<void> {
  const { data: row } = await sb
    .from("systemmind_integration_errors")
    .select("retry_count, max_retries")
    .eq("id", errorId)
    .maybeSingle();
  if (!row) return;
  const nextCount = (row.retry_count ?? 0) + 1;
  if (nextCount >= (row.max_retries ?? 5)) {
    await sb
      .from("systemmind_integration_errors")
      .update({ status: "dead_letter", retry_count: nextCount, next_retry_at: null, updated_at: new Date().toISOString() })
      .eq("id", errorId);
    return;
  }
  const backoff = RETRY_BACKOFF_MINUTES[Math.min(nextCount, RETRY_BACKOFF_MINUTES.length - 1)];
  await sb
    .from("systemmind_integration_errors")
    .update({
      status: "retrying",
      retry_count: nextCount,
      next_retry_at: new Date(Date.now() + backoff * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", errorId);
}

export async function resolveIntegrationError(errorId: string): Promise<void> {
  await sb
    .from("systemmind_integration_errors")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", errorId);
}
