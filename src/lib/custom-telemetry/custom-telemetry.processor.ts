/**
 * Custom Telemetry Processor
 *
 * Receives post-call data from Project B (OpenAI Realtime microservice) and
 * writes it to the same analytics tables used by the Retell webhook pipeline.
 * The Retell processor is NOT modified — all helpers are copied here.
 *
 * Error policy: all DB writes are wrapped in try-catch.  This function never
 * throws; it always returns a result object so the route can safely return 200.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---------------------------------------------------------------------------
// Payload type expected from Project B
// ---------------------------------------------------------------------------

export type CustomTelemetryPayload = {
  call_id?: string;
  agent_id?: string;
  call_status?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  duration_seconds?: number;
  transcript?: string;
  recording_url?: string;
  call_summary?: string;
  user_sentiment?: string;
};

export type CustomTelemetryResult = {
  ok: boolean;
  message: string;
  callId?: string;
  workspaceId?: string;
  signatureValid?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers — copied from retell-webhook.processor.ts (do NOT re-export)
// ---------------------------------------------------------------------------

function mapStatus(status?: string): string {
  switch (status) {
    case "registered":
    case "ongoing":
    case "in_progress":
      return "in_progress";
    case "ended":
    case "completed":
      return "completed";
    case "error":
    case "failed":
      return "failed";
    case "busy":
      return "busy";
    case "no_answer":
      return "no_answer";
    case "voicemail":
      return "voicemail";
    case "ringing":
      return "ringing";
    case "initiated":
      return "initiated";
    default:
      return "completed";
  }
}

function mapSentiment(value?: string): "positive" | "neutral" | "negative" | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("positive")) return "positive";
  if (lower.includes("negative")) return "negative";
  if (lower.includes("neutral")) return "neutral";
  return null;
}

function timestampToIso(value?: number): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function truncate(value: string, max = 4000): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

// ---------------------------------------------------------------------------
// Agent resolution
// ---------------------------------------------------------------------------

async function resolveAgent(agentId: string): Promise<{
  id?: string;
  workspace_id?: string;
} | null> {
  if (!agentId) return null;

  // 1. Try matching by retell_agent_id
  try {
    const { data } = await supabaseAdmin
      .from("agents")
      .select("id, workspace_id")
      .eq("retell_agent_id", agentId)
      .maybeSingle();
    if (data) return { id: data.id as string, workspace_id: data.workspace_id as string };
  } catch (e) {
    console.warn("[CUSTOM TELEMETRY] retell_agent_id lookup failed", e);
  }

  // 2. Try matching by UUID (internal agent id)
  try {
    const { data } = await supabaseAdmin
      .from("agents")
      .select("id, workspace_id")
      .eq("id", agentId)
      .maybeSingle();
    if (data) return { id: data.id as string, workspace_id: data.workspace_id as string };
  } catch (e) {
    console.warn("[CUSTOM TELEMETRY] UUID agent lookup failed", e);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

async function recordTelemetryEvent(input: {
  workspaceId?: string | null;
  callId?: string | null;
  agentId?: string | null;
  signatureValid?: boolean | null;
  status: string;
  payload: unknown;
  error?: string | null;
}): Promise<void> {
  try {
    await supabaseAdmin
      .from("retell_webhook_events")
      .insert({
        workspace_id: input.workspaceId ?? null,
        retell_call_id: input.callId ?? null,
        retell_agent_id: input.agentId ?? null,
        event_type: "custom_telemetry",
        signature_valid: input.signatureValid ?? null,
        processing_status: input.status,
        payload: input.payload as never,
        error_message: input.error ?? null,
        processed_at: new Date().toISOString(),
      } as never);
  } catch (e) {
    console.error("[CUSTOM TELEMETRY] Audit log insert failed", e);
  }
}

// ---------------------------------------------------------------------------
// Calls table upsert — propagates errors to caller
// ---------------------------------------------------------------------------

async function upsertCall(row: Record<string, unknown>): Promise<{ error: string | null }> {
  const callId = row.retell_call_id as string | undefined;

  try {
    if (!callId) {
      const { error } = await supabaseAdmin.from("calls").insert(row as never);
      return { error: error?.message ?? null };
    }

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("calls")
      .select("id")
      .eq("retell_call_id", callId)
      .maybeSingle();

    if (lookupError) return { error: lookupError.message };

    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("calls")
        .update(row as never)
        .eq("id", existing.id as string);
      return { error: error?.message ?? null };
    }

    const { error: insertError } = await supabaseAdmin.from("calls").insert(row as never);
    if (!insertError) return { error: null };

    const msg = insertError.message.toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      const { error: retryError } = await supabaseAdmin
        .from("calls")
        .update(row as never)
        .eq("retell_call_id", callId);
      return { error: retryError?.message ?? null };
    }

    return { error: insertError.message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[CUSTOM TELEMETRY] upsertCall threw", msg);
    return { error: msg };
  }
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processCustomTelemetry(
  payload: CustomTelemetryPayload,
  requestHeaders: Headers,
): Promise<CustomTelemetryResult> {
  const callId = payload.call_id ?? null;

  // Optional bearer token check — defensive only, never blocks processing
  const secret = process.env.CUSTOM_TELEMETRY_SECRET ?? null;
  let signatureValid: boolean | null = null;
  if (secret) {
    const authHeader = requestHeaders.get("authorization") ?? "";
    signatureValid = authHeader === `Bearer ${secret}`;
    if (!signatureValid) {
      console.warn("[CUSTOM TELEMETRY] Missing or invalid bearer token — processing anyway");
    }
  }

  // Resolve workspace from agent_id
  const agentResolution = payload.agent_id ? await resolveAgent(payload.agent_id) : null;
  const workspaceId = agentResolution?.workspace_id ?? null;
  const internalAgentId = agentResolution?.id ?? null;

  // Duration: prefer duration_ms, fall back to duration_seconds
  const durationSeconds =
    typeof payload.duration_ms === "number"
      ? Math.round(payload.duration_ms / 1000)
      : typeof payload.duration_seconds === "number"
        ? Math.round(payload.duration_seconds)
        : null;

  // Write audit row first (best-effort — never blocks)
  await recordTelemetryEvent({
    workspaceId,
    callId,
    agentId: payload.agent_id ?? null,
    signatureValid,
    status: "received",
    payload,
  });

  // workspace_id is required by the calls table — skip the insert if we
  // could not resolve it, but still return ok so the audit row stands.
  if (!workspaceId) {
    console.warn("[CUSTOM TELEMETRY] Could not resolve workspace_id — skipping calls insert", {
      agent_id: payload.agent_id,
      call_id: callId,
    });
    return {
      ok: true,
      message: "audit_only — workspace not resolved",
      callId: callId ?? undefined,
      signatureValid: signatureValid ?? undefined,
    };
  }

  // Build the calls row — match Retell column semantics exactly.
  // to_number and workspace_id are the only non-nullable required fields.
  const callRow: Record<string, unknown> = {
    workspace_id: workspaceId,
    agent_id: internalAgentId ?? null,
    retell_call_id: callId,
    call_status: mapStatus(payload.call_status),
    call_type: "inbound",                              // default for custom engine calls
    from_number: payload.from_number ?? null,
    to_number: payload.to_number ?? payload.from_number ?? "unknown",  // required non-null
    started_at: timestampToIso(payload.start_timestamp),
    ended_at: timestampToIso(payload.end_timestamp),
    duration_seconds: durationSeconds,
    transcript: payload.transcript ? truncate(payload.transcript) : null,
    recording_url: payload.recording_url ?? null,
    call_summary: payload.call_summary ?? null,
    sentiment: mapSentiment(payload.user_sentiment),
  };

  const { error: callsError } = await upsertCall(callRow);

  if (callsError) {
    console.error("[CUSTOM TELEMETRY] calls write failed", callsError);
    // Update audit row with error status (best-effort)
    await recordTelemetryEvent({
      workspaceId,
      callId,
      agentId: payload.agent_id ?? null,
      signatureValid,
      status: "error",
      payload,
      error: callsError,
    });
    return {
      ok: false,
      message: `calls write failed: ${callsError}`,
      callId: callId ?? undefined,
      workspaceId,
      signatureValid: signatureValid ?? undefined,
    };
  }

  // Update audit row to processed
  await recordTelemetryEvent({
    workspaceId,
    callId,
    agentId: payload.agent_id ?? null,
    signatureValid,
    status: "processed",
    payload,
  });

  console.log("[CUSTOM TELEMETRY] Processed successfully", {
    callId,
    workspaceId,
    status: mapStatus(payload.call_status),
  });

  return {
    ok: true,
    message: "processed",
    callId: callId ?? undefined,
    workspaceId,
    signatureValid: signatureValid ?? undefined,
  };
}
