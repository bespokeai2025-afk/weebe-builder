// ── SystemMind call runtime: queue engine ────────────────────────────────────
// systemmind_call_queue with a full status lifecycle, CAS-claimed workers
// (UPDATE … WHERE status/claim unchanged), open-entry dedup via a partial
// unique index (23505 = deduped), retry backoff, daily caps and calling
// windows. All writes server-only.

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isWithinCallingWindow, type CallingWindow } from "./triggers.server";

const sb = supabaseAdmin as any;

export const OPEN_QUEUE_STATUSES = [
  "pending", "preparing", "waiting_for_data", "ready", "calling", "connected",
  "retry_scheduled", "callback_scheduled", "paused",
] as const;

const CLAIMABLE_STATUSES = ["pending", "ready", "retry_scheduled", "callback_scheduled"];

// Valid manual/status transitions (state machine — invalid transitions rejected).
const QUEUE_TRANSITIONS: Record<string, string[]> = {
  pending: ["preparing", "paused", "cancelled", "suppressed"],
  preparing: ["waiting_for_data", "ready", "calling", "failed", "paused", "cancelled"],
  waiting_for_data: ["preparing", "ready", "paused", "cancelled", "failed"],
  ready: ["preparing", "calling", "paused", "cancelled"],
  calling: ["connected", "completed", "failed", "retry_scheduled"],
  connected: ["completed", "failed"],
  retry_scheduled: ["preparing", "paused", "cancelled", "failed"],
  callback_scheduled: ["preparing", "paused", "cancelled"],
  paused: ["pending", "cancelled"],
  completed: [],
  failed: ["pending"],
  cancelled: [],
  suppressed: [],
};

export function isValidQueueTransition(from: string, to: string): boolean {
  return QUEUE_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Enqueue with dedup ────────────────────────────────────────────────────────

export async function enqueueCall(args: {
  workspaceId: string;
  triggerId?: string | null;
  activationId?: string | null;
  agentId?: string | null;
  leadId: string;
  leadName?: string;
  phone: string;
  priority?: number;
  maxAttempts?: number;
  nextAttemptAt?: string;
  dedupKey?: string | null;
}): Promise<{ enqueued: boolean; queueId?: string; reason?: string }> {
  if (!args.phone?.trim()) return { enqueued: false, reason: "no_phone" };
  const { data, error } = await sb
    .from("systemmind_call_queue")
    .insert({
      workspace_id: args.workspaceId,
      trigger_id: args.triggerId ?? null,
      activation_id: args.activationId ?? null,
      agent_id: args.agentId ?? null,
      lead_id: args.leadId,
      lead_name: args.leadName ?? "",
      phone: args.phone,
      status: "pending",
      priority: args.priority ?? 100,
      max_attempts: args.maxAttempts ?? 3,
      next_attempt_at: args.nextAttemptAt ?? new Date().toISOString(),
      dedup_key: args.dedupKey ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (String(error.code) === "23505") return { enqueued: false, reason: "deduped" };
    return { enqueued: false, reason: error.message };
  }
  return { enqueued: true, queueId: data.id as string };
}

// ── CAS claim ─────────────────────────────────────────────────────────────────

/**
 * Claim up to `limit` due queue entries with a compare-and-swap: each row is
 * only ours if the conditional UPDATE (status unchanged since the SELECT)
 * returns it. Two concurrent workers can never claim the same row.
 */
export async function claimDueQueueEntries(opts?: {
  limit?: number;
  workerId?: string;
}): Promise<any[]> {
  const workerId = opts?.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const limit = opts?.limit ?? 5;
  const nowIso = new Date().toISOString();

  const { data: candidates } = await sb
    .from("systemmind_call_queue")
    .select("*")
    .in("status", CLAIMABLE_STATUSES)
    .lte("next_attempt_at", nowIso)
    .order("priority", { ascending: true })
    .order("next_attempt_at", { ascending: true })
    .limit(limit * 3);
  if (!candidates?.length) return [];

  const claimed: any[] = [];
  for (const row of candidates) {
    if (claimed.length >= limit) break;
    const { data: won } = await sb
      .from("systemmind_call_queue")
      .update({
        status: "preparing",
        claimed_at: nowIso,
        claimed_by: workerId,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("updated_at", row.updated_at)
      .select("*");
    if (won?.length) claimed.push(won[0]);
  }
  return claimed;
}

// ── Status updates ────────────────────────────────────────────────────────────

export async function setQueueStatus(
  queueId: string,
  workspaceId: string,
  status: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  await sb
    .from("systemmind_call_queue")
    .update({ status, updated_at: new Date().toISOString(), ...(extra ?? {}) })
    .eq("id", queueId)
    .eq("workspace_id", workspaceId);
}

/** Retry with exponential backoff, or fail permanently when attempts exhausted. */
export async function scheduleQueueRetry(row: {
  id: string;
  workspace_id: string;
  attempt_count: number;
  max_attempts: number;
}, reason: string): Promise<"retry_scheduled" | "failed"> {
  const attempts = (row.attempt_count ?? 0);
  if (attempts >= (row.max_attempts ?? 3)) {
    await setQueueStatus(row.id, row.workspace_id, "failed", {
      last_error: reason.slice(0, 500),
      status_reason: "max_attempts_reached",
    });
    return "failed";
  }
  const backoffMinutes = [30, 120, 480, 1440][Math.min(attempts, 3)];
  await setQueueStatus(row.id, row.workspace_id, "retry_scheduled", {
    last_error: reason.slice(0, 500),
    status_reason: `retry_in_${backoffMinutes}m`,
    next_attempt_at: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
    claimed_at: null,
    claimed_by: null,
  });
  return "retry_scheduled";
}

// ── Manual queue controls (used by server fns + mind tools) ──────────────────

export async function controlQueueEntryServer(args: {
  workspaceId: string;
  queueId: string;
  action: "pause" | "resume" | "cancel" | "prioritise" | "retry_now";
}): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await sb
    .from("systemmind_call_queue")
    .select("id, status, workspace_id")
    .eq("id", args.queueId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!row) return { ok: false, error: "queue_entry_not_found" };

  const target =
    args.action === "pause" ? "paused"
    : args.action === "resume" ? "pending"
    : args.action === "cancel" ? "cancelled"
    : args.action === "retry_now" ? "pending"
    : null;

  if (args.action === "prioritise") {
    await setQueueStatus(row.id, args.workspaceId, row.status, { priority: 1, next_attempt_at: new Date().toISOString() });
    return { ok: true };
  }
  if (!target) return { ok: false, error: "unknown_action" };
  if (!isValidQueueTransition(row.status, target)) {
    return { ok: false, error: `invalid_transition_${row.status}_to_${target}` };
  }
  await setQueueStatus(row.id, args.workspaceId, target, {
    status_reason: `manual_${args.action}`,
    ...(args.action === "retry_now" || args.action === "resume"
      ? { next_attempt_at: new Date().toISOString(), claimed_at: null, claimed_by: null }
      : {}),
  });
  return { ok: true };
}

// ── Guards used before dialling ───────────────────────────────────────────────

export async function checkDailyCap(workspaceId: string, triggerId: string | null, cap: number): Promise<boolean> {
  if (!cap) return true;
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  let q = sb
    .from("systemmind_call_attempts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", todayUtc.toISOString());
  const { count } = await q;
  return (count ?? 0) < cap;
}

export async function getTriggerWindow(triggerId: string | null): Promise<CallingWindow | null> {
  if (!triggerId) return null;
  const { data } = await sb
    .from("systemmind_call_triggers")
    .select("calling_window")
    .eq("id", triggerId)
    .maybeSingle();
  return (data?.calling_window as CallingWindow | null) ?? null;
}

export { isWithinCallingWindow };
