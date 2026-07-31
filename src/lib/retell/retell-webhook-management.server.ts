/**
 * Retell webhook management layer (Task #458).
 *
 * Workspace-scoped webhook configs (generated secrets), event dedup + replay
 * protection, retry with backoff + dead-letter state, test-payload sending
 * and health reporting.
 *
 * Design constraints (preserved behavior):
 *  - transcript_updated live-ingest path in retell-webhook.processor.ts is
 *    untouched and NEVER runs through this layer.
 *  - Dedup is FAIL-OPEN: if this layer errors, the canonical processor still
 *    runs (an occasional double-process is handled by upsertCall/idempotent
 *    writes; dropping real events is worse).
 *  - Secrets live in retell_webhook_config (server-only table, no grants) and
 *    never reach the browser.
 */
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const WEBHOOK_MAX_ATTEMPTS = 5;

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

/**
 * Deterministic idempotency key for one Retell webhook delivery.
 */
export function computeWebhookDedupKey(eventType: string, callId: string | null, rawBody: string): string {
  // Canonical idempotency key is event_type + call_id: Retell retries (even
  // with slightly different payload bytes/timestamps) must not re-process the
  // same lifecycle event. Body hash is only used when there is no call id.
  if (callId) return `${eventType}:${callId}`;
  const bodyHash = createHash("sha256").update(rawBody).digest("hex").slice(0, 32);
  return `${eventType}:nocall:${bodyHash}`;
}

/** Replay protection: reject events whose call end/start timestamp is older than the window. */
export function isReplayedEvent(
  payload: { call?: { start_timestamp?: number; end_timestamp?: number } },
  replayWindowSeconds: number,
  nowMs = Date.now(),
): boolean {
  const ts = payload.call?.end_timestamp ?? payload.call?.start_timestamp;
  if (!ts || !Number.isFinite(ts)) return false; // no timestamp → cannot judge, allow
  return nowMs - ts > replayWindowSeconds * 1000;
}

/** Exponential backoff: 1m, 4m, 16m, 64m… capped at 6h. */
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(60_000 * 4 ** Math.max(0, attempts - 1), 6 * 3600_000);
}

// ── Config / secrets ──────────────────────────────────────────────────────────

export async function ensureWebhookConfig(workspaceId: string) {
  const { data } = await supabaseAdmin
    .from("retell_webhook_config")
    .select("workspace_id, verification_enabled, replay_window_seconds")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (data) return data as { workspace_id: string; verification_enabled: boolean; replay_window_seconds: number };
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const { error } = await supabaseAdmin.from("retell_webhook_config").insert({
    workspace_id: workspaceId,
    secret,
  } as never);
  if (error && !/duplicate|unique/i.test(error.message)) {
    console.warn("[retell-webhook-mgmt] config insert failed", error.message);
  }
  return { workspace_id: workspaceId, verification_enabled: false, replay_window_seconds: 300 };
}

/** Rotate the workspace webhook secret. Returns only a masked preview. */
export async function rotateWebhookSecret(workspaceId: string) {
  await ensureWebhookConfig(workspaceId);
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const { error } = await supabaseAdmin
    .from("retell_webhook_config")
    .update({ secret, updated_at: new Date().toISOString() } as never)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`Secret rotation failed: ${error.message}`);
  return { masked: `${secret.slice(0, 10)}…${secret.slice(-4)}` };
}

// ── Dedup / processing ledger ─────────────────────────────────────────────────

export type DedupResult =
  | { action: "process"; ledgerId: string | null }
  | { action: "duplicate" }
  | { action: "replay" };

/**
 * Claim a webhook delivery for processing. Insert-first: a unique-violation on
 * dedup_key means this exact delivery was already handled → skip. Fail-open on
 * any other error.
 */
export async function claimWebhookDelivery(args: {
  workspaceId: string | null;
  eventType: string;
  callId: string | null;
  rawBody: string;
  payload: Record<string, unknown>;
}): Promise<DedupResult> {
  try {
    const replayWindow = 24 * 3600; // generous default; config can tighten per-workspace
    let windowSeconds = replayWindow;
    if (args.workspaceId) {
      const { data: cfg } = await supabaseAdmin
        .from("retell_webhook_config")
        .select("replay_window_seconds")
        .eq("workspace_id", args.workspaceId)
        .maybeSingle();
      // Config value is a minimum-freshness knob for signature replay; for
      // call events we use max(config, 24h) so slow Retell retries still land.
      windowSeconds = Math.max((cfg?.replay_window_seconds as number | undefined) ?? 300, replayWindow);
    }
    if (isReplayedEvent(args.payload as never, windowSeconds)) return { action: "replay" };

    const dedupKey = computeWebhookDedupKey(args.eventType, args.callId, args.rawBody);
    const { data, error } = await supabaseAdmin
      .from("retell_webhook_processing")
      .insert({
        workspace_id: args.workspaceId,
        dedup_key: dedupKey,
        event_type: args.eventType,
        retell_call_id: args.callId,
        status: "processing",
        payload: args.payload as never,
      } as never)
      .select("id")
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return { action: "duplicate" };
      console.warn("[retell-webhook-mgmt] ledger insert failed (fail-open)", error.message);
      return { action: "process", ledgerId: null };
    }
    return { action: "process", ledgerId: (data?.id as string) ?? null };
  } catch (e) {
    console.warn("[retell-webhook-mgmt] claim threw (fail-open)", e);
    return { action: "process", ledgerId: null };
  }
}

export async function markWebhookProcessed(ledgerId: string | null, workspaceId: string | null) {
  const now = new Date().toISOString();
  try {
    if (ledgerId) {
      await supabaseAdmin
        .from("retell_webhook_processing")
        .update({ status: "processed", last_error: null, next_retry_at: null, updated_at: now } as never)
        .eq("id", ledgerId);
    }
    if (workspaceId) {
      await ensureWebhookConfig(workspaceId);
      await supabaseAdmin
        .from("retell_webhook_config")
        .update({ last_event_at: now, last_success_at: now, failure_count: 0, updated_at: now } as never)
        .eq("workspace_id", workspaceId);
    }
  } catch (e) {
    console.warn("[retell-webhook-mgmt] markWebhookProcessed failed", e);
  }
}

export async function markWebhookFailed(
  ledgerId: string | null,
  workspaceId: string | null,
  errorMessage: string,
) {
  const now = new Date().toISOString();
  try {
    if (ledgerId) {
      const { data: row } = await supabaseAdmin
        .from("retell_webhook_processing")
        .select("attempts")
        .eq("id", ledgerId)
        .maybeSingle();
      const attempts = ((row?.attempts as number | undefined) ?? 1);
      const dead = attempts >= WEBHOOK_MAX_ATTEMPTS;
      await supabaseAdmin
        .from("retell_webhook_processing")
        .update({
          status: dead ? "dead" : "failed",
          last_error: errorMessage.slice(0, 2000),
          next_retry_at: dead ? null : new Date(Date.now() + nextRetryDelayMs(attempts)).toISOString(),
          updated_at: now,
        } as never)
        .eq("id", ledgerId);
    }
    if (workspaceId) {
      await ensureWebhookConfig(workspaceId);
      const { data: cfg } = await supabaseAdmin
        .from("retell_webhook_config")
        .select("failure_count")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      await supabaseAdmin
        .from("retell_webhook_config")
        .update({
          last_event_at: now,
          last_failure_at: now,
          failure_count: ((cfg?.failure_count as number | undefined) ?? 0) + 1,
          updated_at: now,
        } as never)
        .eq("workspace_id", workspaceId);
    }
  } catch (e) {
    console.warn("[retell-webhook-mgmt] markWebhookFailed failed", e);
  }
}

// ── Retry of failed deliveries ────────────────────────────────────────────────

/**
 * Re-run failed/retryable deliveries through the canonical processor. Used by
 * the health panel's reprocess action and callable from a periodic tick.
 * Dynamic import avoids a circular dependency with the processor module.
 */
export async function retryFailedWebhookDeliveries(args: {
  workspaceId: string;
  ledgerId?: string;
  limit?: number;
}) {
  const { processRetellWebhook } = await import("@/lib/retell/retell-webhook.processor");
  let query = supabaseAdmin
    .from("retell_webhook_processing")
    .select("id, payload, attempts, status, workspace_id")
    .eq("workspace_id", args.workspaceId)
    .in("status", ["failed", "dead"])
    .order("created_at", { ascending: false })
    .limit(Math.min(args.limit ?? 10, 25));
  if (args.ledgerId) query = query.eq("id", args.ledgerId);
  const { data: rows, error } = await query;
  if (error) throw new Error(`Retry lookup failed: ${error.message}`);

  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const row of rows ?? []) {
    const id = row.id as string;
    const attempts = ((row.attempts as number | undefined) ?? 1) + 1;
    await supabaseAdmin
      .from("retell_webhook_processing")
      .update({ status: "retrying", attempts, updated_at: new Date().toISOString() } as never)
      .eq("id", id);
    try {
      const result = await processRetellWebhook(
        JSON.stringify(row.payload ?? {}),
        new Headers({ "content-type": "application/json" }),
        { skipSignature: true, source: "admin-test", skipDedup: true },
      );
      if (result.ok) {
        await markWebhookProcessed(id, args.workspaceId);
        results.push({ id, ok: true, message: result.message });
      } else {
        await markWebhookFailed(id, args.workspaceId, result.message);
        results.push({ id, ok: false, message: result.message });
      }
    } catch (e) {
      await markWebhookFailed(id, args.workspaceId, (e as Error).message);
      results.push({ id, ok: false, message: (e as Error).message });
    }
  }
  return results;
}

// ── Test payload sender ───────────────────────────────────────────────────────

/**
 * Send a synthetic call_ended test payload through the full processing
 * pipeline for this workspace (signature skipped, marked as test).
 */
export async function sendTestWebhookPayload(workspaceId: string, retellAgentId: string) {
  const { processRetellWebhook } = await import("@/lib/retell/retell-webhook.processor");
  const callId = `test_${randomBytes(8).toString("hex")}`;
  const now = Date.now();
  const payload = {
    event: "call_ended",
    call: {
      call_id: callId,
      agent_id: retellAgentId,
      call_status: "ended",
      call_type: "phone_call",
      direction: "inbound",
      from_number: "+15550100000",
      to_number: "+15550100001",
      start_timestamp: now - 60_000,
      end_timestamp: now,
      duration_ms: 60_000,
      disconnection_reason: "agent_hangup",
      transcript: "Agent: Hello, this is a WEBEE webhook test call.\nUser: Great, thanks.",
    },
  };
  const result = await processRetellWebhook(
    JSON.stringify(payload),
    new Headers({ "content-type": "application/json" }),
    { skipSignature: true, forcedWorkspaceId: workspaceId, source: "admin-test" },
  );
  return { callId, ok: result.ok, status: result.status, message: result.message };
}

// ── Health surface ────────────────────────────────────────────────────────────

export async function getWebhookHealthServer(workspaceId: string) {
  const cfg = await ensureWebhookConfig(workspaceId);
  const { data: cfgFull } = await supabaseAdmin
    .from("retell_webhook_config")
    .select("verification_enabled, replay_window_seconds, last_event_at, last_success_at, last_failure_at, failure_count")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const [{ count: total }, { count: failed }, { count: dead }, { count: duplicates }] = await Promise.all([
    supabaseAdmin.from("retell_webhook_events").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).gte("received_at", since),
    supabaseAdmin.from("retell_webhook_processing").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("status", "failed").gte("created_at", since),
    supabaseAdmin.from("retell_webhook_processing").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("status", "dead").gte("created_at", since),
    supabaseAdmin.from("retell_webhook_events").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId).eq("processing_status", "duplicate").gte("received_at", since),
  ]);

  const { data: recent } = await supabaseAdmin
    .from("retell_webhook_events")
    .select("id, event_type, retell_call_id, processing_status, error_message, received_at, processed_at")
    .eq("workspace_id", workspaceId)
    .order("received_at", { ascending: false })
    .limit(20);

  const { data: retryable } = await supabaseAdmin
    .from("retell_webhook_processing")
    .select("id, event_type, retell_call_id, status, attempts, last_error, next_retry_at, created_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["failed", "dead", "retrying"])
    .order("created_at", { ascending: false })
    .limit(20);

  const c = (cfgFull ?? {}) as Record<string, unknown>;
  return {
    config: {
      verificationEnabled: Boolean(c.verification_enabled ?? cfg.verification_enabled),
      replayWindowSeconds: (c.replay_window_seconds as number | undefined) ?? cfg.replay_window_seconds,
      lastEventAt: (c.last_event_at as string | null) ?? null,
      lastSuccessAt: (c.last_success_at as string | null) ?? null,
      lastFailureAt: (c.last_failure_at as string | null) ?? null,
      consecutiveFailures: (c.failure_count as number | undefined) ?? 0,
    },
    counts7d: {
      total: total ?? 0,
      failed: failed ?? 0,
      dead: dead ?? 0,
      duplicates: duplicates ?? 0,
    },
    recentEvents: (recent ?? []).map((r) => ({
      id: r.id as string,
      eventType: r.event_type as string,
      callId: (r.retell_call_id as string | null) ?? null,
      status: r.processing_status as string,
      error: (r.error_message as string | null) ?? null,
      receivedAt: r.received_at as string,
      processedAt: (r.processed_at as string | null) ?? null,
    })),
    retryable: (retryable ?? []).map((r) => ({
      id: r.id as string,
      eventType: r.event_type as string,
      callId: (r.retell_call_id as string | null) ?? null,
      status: r.status as string,
      attempts: r.attempts as number,
      lastError: (r.last_error as string | null) ?? null,
      nextRetryAt: (r.next_retry_at as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  };
}
