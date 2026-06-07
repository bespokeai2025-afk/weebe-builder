import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SUPPORTED_RETELL_EVENTS = new Set([
  "call_started",
  "call_ended",
  "call_analyzed",
  "call_transferred",
  "call_failed",
]);

const RETELL_SIGNATURE_VERIFICATION_DISABLED =
  process.env.RETELL_SIGNATURE_VERIFICATION_ENABLED !== "true";

export const RETELL_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Retell-Signature, x-retell-signature, Authorization, User-Agent, Accept, Origin",
  "Access-Control-Max-Age": "86400",
} as const;

type RetellWebhookDebugSnapshot = {
  lastMethod: string;
  lastHeaders: Record<string, string>;
  lastBody: unknown;
  lastStatus: number;
};

let retellWebhookDebugSnapshot: RetellWebhookDebugSnapshot = {
  lastMethod: "",
  lastHeaders: {},
  lastBody: {},
  lastStatus: 200,
};

type RetellCall = {
  call_id?: string;
  agent_id?: string;
  call_status?: string;
  call_type?: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  transcript?: string;
  recording_url?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    call_successful?: boolean;
    in_voicemail?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
};

type ProcessOptions = {
  skipSignature?: boolean;
  forcedWorkspaceId?: string;
  source?: "retell" | "admin-test";
};

type ProcessResult = {
  ok: boolean;
  status: number;
  message: string;
  event?: string;
  callId?: string;
  workspaceId?: string;
  signatureValid?: boolean;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...RETELL_CORS_HEADERS },
  });
}

export function retellJson(body: unknown, status = 200): Response {
  return jsonResponse(body, status);
}

function stripPrefix(value: string): string {
  return value.replace(/^agents\//, "").trim();
}

function truncate(value: string, max = 4000): string {
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

function headersForLog(headers: Headers): Record<string, string | null> {
  const signature = headers.get("x-retell-signature");
  return {
    "content-type": headers.get("content-type"),
    "user-agent": headers.get("user-agent"),
    "x-retell-signature": signature ? `[present:${signature.length}]` : null,
    "x-forwarded-for": headers.get("x-forwarded-for"),
    "cf-connecting-ip": headers.get("cf-connecting-ip"),
  };
}

export function headersToDebugObject(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    output[key] =
      lower.includes("authorization") || lower.includes("cookie") || lower.includes("signature")
        ? `[present:${value.length}]`
        : value;
  });
  return output;
}

export function updateRetellWebhookDebugSnapshot(snapshot: RetellWebhookDebugSnapshot) {
  retellWebhookDebugSnapshot = snapshot;
}

export function getRetellWebhookDebugSnapshot(): RetellWebhookDebugSnapshot {
  return retellWebhookDebugSnapshot;
}

export async function saveRetellWebhookDebugSnapshot(snapshot: RetellWebhookDebugSnapshot) {
  updateRetellWebhookDebugSnapshot(snapshot);
  try {
    await supabaseAdmin.from("retell_webhook_events").insert({
      event_type: "debug_snapshot",
      signature_valid: null,
      processing_status: "debug",
      payload: snapshot as never,
      processed_at: new Date().toISOString(),
    } as never);
  } catch (error) {
    console.error("[RETELL WEBHOOK] Debug snapshot save failed", error);
  }
}

export async function getDurableRetellWebhookDebugSnapshot(): Promise<RetellWebhookDebugSnapshot> {
  try {
    const { data, error } = await supabaseAdmin
      .from("retell_webhook_events")
      .select("payload")
      .eq("event_type", "debug_snapshot")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.payload) return retellWebhookDebugSnapshot;
    return data.payload as RetellWebhookDebugSnapshot;
  } catch (error) {
    console.error("[RETELL WEBHOOK] Debug snapshot lookup failed", error);
    return retellWebhookDebugSnapshot;
  }
}

function safeCompareHex(aHex: string, bHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(aHex) || !/^[a-f0-9]+$/i.test(bHex)) return false;
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyRetellSignature(rawBody: string, header: string | null, apiKey: string) {
  if (!header) return { valid: false, reason: "missing x-retell-signature header" };

  const parsed = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = parsed.v;
  const digest = parsed.d;

  if (timestamp && digest) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return { valid: false, reason: "invalid signature timestamp" };
    const ageMs = Math.abs(Date.now() - ts);
    if (ageMs > 5 * 60 * 1000) {
      return { valid: false, reason: "signature timestamp outside 5 minute window" };
    }
    const expected = createHmac("sha256", apiKey).update(`${rawBody}${timestamp}`).digest("hex");
    const valid = safeCompareHex(digest, expected);
    return {
      valid,
      reason: valid ? "valid" : "digest mismatch",
      mode: "retell-v-d",
    };
  }

  const expectedLegacy = createHmac("sha256", apiKey).update(rawBody).digest("hex");
  const valid = safeCompareHex(header.trim(), expectedLegacy);
  return {
    valid,
    reason: valid ? "valid" : "unsupported signature format",
    mode: "legacy-hex",
  };
}

function mapStatus(event?: string, status?: string): string {
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
      break;
  }

  switch (event) {
    case "call_started":
      return "in_progress";
    case "call_ended":
    case "call_analyzed":
    case "call_transferred":
      return "completed";
    case "call_failed":
      return "failed";
    default:
      return "initiated";
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

async function recordWebhookEvent(input: {
  workspaceId?: string | null;
  eventType: string;
  callId?: string | null;
  agentId?: string | null;
  signatureValid?: boolean | null;
  status: string;
  payload: unknown;
  error?: string | null;
}): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("retell_webhook_events")
      .insert({
        workspace_id: input.workspaceId ?? null,
        retell_call_id: input.callId ?? null,
        retell_agent_id: input.agentId ?? null,
        event_type: input.eventType,
        signature_valid: input.signatureValid ?? null,
        processing_status: input.status,
        payload: input.payload as never,
        error_message: input.error ?? null,
        processed_at:
          input.status === "processed" || input.status === "error"
            ? new Date().toISOString()
            : null,
      } as never)
      .select("id")
      .single();
    if (error) {
      console.error("[RETELL WEBHOOK] Event log insert failed", error.message);
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch (error) {
    console.error("[RETELL WEBHOOK] Event log insert threw", error);
    return null;
  }
}

async function updateWebhookEvent(id: string | null, status: string, error?: string | null) {
  if (!id) return;
  try {
    await supabaseAdmin
      .from("retell_webhook_events")
      .update({
        processing_status: status,
        error_message: error ?? null,
        processed_at: new Date().toISOString(),
      } as never)
      .eq("id", id);
  } catch (e) {
    console.error("[RETELL WEBHOOK] Event log update threw", e);
  }
}

async function resolveAgent(incomingAgentId: string, forcedWorkspaceId?: string) {
  if (forcedWorkspaceId) {
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("id, workspace_id, name, agent_type, retell_agent_id")
      .eq("workspace_id", forcedWorkspaceId)
      .maybeSingle();
    return {
      id: (agent?.id as string | undefined) ?? undefined,
      workspace_id: forcedWorkspaceId,
      name: (agent?.name as string | undefined) ?? "Test agent",
      agent_type: (agent?.agent_type as string | undefined) ?? "lead_gen",
    };
  }

  const { data: agentMatches } = await supabaseAdmin
    .from("agents")
    .select("id, workspace_id, name, agent_type, retell_agent_id");
  const matched = (agentMatches ?? []).find(
    (agent) => stripPrefix((agent.retell_agent_id as string) ?? "") === incomingAgentId,
  );
  if (matched) {
    return {
      id: matched.id as string,
      workspace_id: matched.workspace_id as string,
      name: matched.name as string,
      agent_type: matched.agent_type as string,
    };
  }

  const { data: settingsMatches } = await supabaseAdmin
    .from("workspace_settings")
    .select("workspace_id, retell_default_agent_id");
  const workspace = (settingsMatches ?? []).find(
    (settings) =>
      stripPrefix((settings.retell_default_agent_id as string) ?? "") === incomingAgentId,
  );
  if (!workspace) return null;
  return {
    workspace_id: workspace.workspace_id as string,
    name: "Default agent",
    agent_type: "lead_gen",
  };
}

async function upsertCall(row: Record<string, unknown>) {
  const retellCallId = row.retell_call_id as string;
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("calls")
    .select("id")
    .eq("retell_call_id", retellCallId)
    .maybeSingle();
  if (lookupError) return { error: lookupError };

  if (existing?.id) {
    return supabaseAdmin
      .from("calls")
      .update(row as never)
      .eq("id", existing.id as string);
  }

  const inserted = await supabaseAdmin.from("calls").insert(row as never);
  if (!inserted.error) return inserted;

  const message = inserted.error.message.toLowerCase();
  if (!message.includes("duplicate") && !message.includes("unique")) return inserted;
  return supabaseAdmin
    .from("calls")
    .update(row as never)
    .eq("retell_call_id", retellCallId);
}

export async function processRetellWebhook(
  rawBody: string,
  headers: Headers,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  console.log("[RETELL WEBHOOK] Request received", {
    source: options.source ?? "retell",
    method: "POST",
    headers: headersForLog(headers),
    body: truncate(rawBody),
  });

  if (!rawBody.trim()) {
    console.log("[RETELL WEBHOOK] Empty validation request accepted");
    return { ok: true, status: 200, message: "ok" };
  }

  const platformKey = process.env.RETELL_API_KEY;
  let signatureValid: boolean | null = null;
  if (!options.skipSignature && !RETELL_SIGNATURE_VERIFICATION_DISABLED) {
    const sigHeader = headers.get("x-retell-signature");

    // Try platform key first, then fall back to each workspace's own Retell key.
    // Go Live agents live in the workspace's own Retell account so webhooks are
    // signed with workspace_settings.retell_workspace_id, not the platform key.
    let sigResult = platformKey
      ? verifyRetellSignature(rawBody, sigHeader, platformKey)
      : { valid: false, reason: "RETELL_API_KEY not configured", mode: "none" };

    if (!sigResult.valid) {
      // Fetch all per-workspace keys and try each one.
      try {
        const { data: wsRows } = await supabaseAdmin
          .from("workspace_settings")
          .select("retell_workspace_id");
        for (const ws of wsRows ?? []) {
          const wsKey = (ws as any)?.retell_workspace_id?.trim();
          if (!wsKey) continue;
          const wsResult = verifyRetellSignature(rawBody, sigHeader, wsKey);
          if (wsResult.valid) {
            sigResult = wsResult;
            break;
          }
        }
      } catch (e) {
        console.warn("[RETELL WEBHOOK] Workspace key lookup failed", e);
      }
    }

    signatureValid = sigResult.valid;
    console.log("[RETELL WEBHOOK] Signature validation result", sigResult);
    if (!sigResult.valid) {
      await recordWebhookEvent({
        eventType: "signature_failed",
        signatureValid: false,
        status: "rejected",
        payload: { rawBody: truncate(rawBody), headers: headersForLog(headers) },
        error: sigResult.reason,
      });
      return { ok: false, status: 403, message: "Invalid signature", signatureValid: false };
    }
  } else {
    signatureValid = true;
    console.log("[RETELL WEBHOOK] Signature validation skipped", {
      source: options.source ?? "retell",
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    console.warn(
      "[RETELL WEBHOOK] Former 400 path reached: invalid JSON body in processRetellWebhook",
    );
    return { ok: true, status: 200, message: "validation", signatureValid: !!signatureValid };
  }

  const event = String(payload.event ?? payload.event_type ?? "unknown");
  const call = ((payload.call as RetellCall | undefined) ?? payload) as RetellCall;
  const callId = call.call_id;
  const incomingAgentId = call.agent_id ? stripPrefix(call.agent_id) : "";
  console.log("[RETELL WEBHOOK] Received event", { event, callId, agentId: incomingAgentId });

  const eventLogId = await recordWebhookEvent({
    eventType: event,
    callId: callId ?? null,
    agentId: incomingAgentId || null,
    signatureValid,
    status: "received",
    payload,
  });

  if (!SUPPORTED_RETELL_EVENTS.has(event)) {
    console.log("[RETELL WEBHOOK] Unsupported event ignored", { event });
    await updateWebhookEvent(eventLogId, "ignored", `Unsupported event: ${event}`);
    return { ok: true, status: 200, message: "ignored", event, callId };
  }

  // Ignore test/builder calls (web_call type). These are calls initiated from
  // the builder preview — they should never appear in the client dashboard.
  if (call.call_type === "web_call" || call.call_type === "webcall") {
    console.log("[RETELL WEBHOOK] Ignoring web/test call (not a live call)", { event, callId });
    await updateWebhookEvent(eventLogId, "ignored", "web_call type — builder test call");
    return { ok: true, status: 200, message: "ignored: test call", event, callId };
  }

  if (!callId || !incomingAgentId) {
    console.warn("[RETELL WEBHOOK] Missing call_id or agent_id", {
      event,
      callId,
      agentId: incomingAgentId,
    });
    await updateWebhookEvent(eventLogId, "ignored", "Missing call_id or agent_id");
    return { ok: true, status: 200, message: "missing call metadata", event, callId };
  }

  const agentRow = await resolveAgent(incomingAgentId, options.forcedWorkspaceId);
  if (!agentRow) {
    console.warn("[RETELL WEBHOOK] Unknown agent_id", incomingAgentId);
    await updateWebhookEvent(eventLogId, "ignored", `Unknown agent_id: ${incomingAgentId}`);
    return { ok: true, status: 200, message: "unknown agent", event, callId };
  }

  const workspaceId = agentRow.workspace_id as string;
  await supabaseAdmin
    .from("retell_webhook_events")
    .update({ workspace_id: workspaceId } as never)
    .eq("id", eventLogId ?? "00000000-0000-0000-0000-000000000000");

  const startedAt = timestampToIso(call.start_timestamp);
  const endedAt = timestampToIso(call.end_timestamp);
  const durationSeconds =
    call.duration_ms != null
      ? Math.round(call.duration_ms / 1000)
      : startedAt && endedAt
        ? Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
        : null;
  const callType =
    call.direction === "inbound" || call.call_type === "inbound" ? "inbound" : "outbound";
  const contactPhone = (callType === "inbound" ? call.from_number : call.to_number) ?? null;

  let leadId: string | null = null;
  if (contactPhone) {
    const { data: leadMatch } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("phone", contactPhone)
      .maybeSingle();
    leadId = (leadMatch?.id as string | undefined) ?? null;
  }

  const row = {
    workspace_id: workspaceId,
    lead_id: leadId,
    retell_call_id: callId,
    agent_id: incomingAgentId,
    agent_name: agentRow.name as string,
    call_type: callType,
    call_status: mapStatus(event, call.call_status),
    from_number: call.from_number ?? null,
    to_number: call.to_number ?? "unknown",
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    disconnection_reason: call.disconnection_reason ?? null,
    transcript: call.transcript ?? null,
    recording_url: call.recording_url ?? null,
    call_summary: call.call_analysis?.call_summary ?? null,
    call_outcome: call.call_analysis?.call_summary ?? null,
    sentiment: mapSentiment(call.call_analysis?.user_sentiment),
    call_successful: call.call_analysis?.call_successful ?? null,
    in_voicemail: call.call_analysis?.in_voicemail ?? null,
  } as Record<string, unknown>;

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined && value !== "") cleaned[key] = value;
  }
  cleaned.workspace_id = workspaceId;
  cleaned.retell_call_id = callId;
  cleaned.to_number = row.to_number || "unknown";
  cleaned.call_type = row.call_type;
  cleaned.call_status = row.call_status;

  const { error: callError } = await upsertCall(cleaned);
  if (callError) {
    console.error("[RETELL WEBHOOK] Call upsert failed", callError.message, { event, callId });
    await updateWebhookEvent(eventLogId, "error", callError.message);
    return {
      ok: false,
      status: 500,
      message: "db error",
      event,
      callId,
      workspaceId,
      signatureValid: !!signatureValid,
    };
  }

  if (
    contactPhone &&
    ["call_ended", "call_analyzed", "call_failed"].includes(event) &&
    callType === "outbound"
  ) {
    const successful = call.call_analysis?.call_successful;
    await supabaseAdmin
      .from("data_records")
      .update({
        last_call_at: endedAt ?? startedAt ?? new Date().toISOString(),
        last_call_outcome: call.call_analysis?.call_summary ?? null,
        last_call_sentiment: mapSentiment(call.call_analysis?.user_sentiment),
        call_status: successful === false || event === "call_failed" ? "failed" : "completed",
        need_to_call: false,
      } as never)
      .eq("workspace_id", workspaceId)
      .eq("mobile_number", contactPhone);
  }

  // Auto-create a calendar entry for every inbound call so the Calendar tab
  // reflects who called and when — independent of agent_type/custom analysis.
  if (
    callType === "inbound" &&
    ["call_started", "call_ended", "call_analyzed"].includes(event) &&
    startedAt
  ) {
    const externalId = `retell-call:${callId}`;
    const { data: existingCallBooking } = await supabaseAdmin
      .from("calendar_bookings")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("external_id", externalId)
      .maybeSingle();
    const callerName = call.call_analysis?.call_summary?.split(/[.\n]/)[0]?.slice(0, 80) ?? null;
    const bookingRow = {
      workspace_id: workspaceId,
      lead_id: leadId,
      external_id: externalId,
      source: "retell",
      title: `Inbound call · ${call.from_number ?? "Unknown caller"}`,
      description: call.call_analysis?.call_summary ?? call.transcript?.slice(0, 500) ?? null,
      start_at: startedAt,
      end_at:
        endedAt ??
        new Date(Date.parse(startedAt) + Math.max(durationSeconds ?? 60, 60) * 1000).toISOString(),
      attendee_name: callerName,
      attendee_phone: call.from_number ?? null,
      status: "accepted",
    } as Record<string, unknown>;
    if (existingCallBooking?.id) {
      await supabaseAdmin
        .from("calendar_bookings")
        .update(bookingRow as never)
        .eq("id", existingCallBooking.id as string);
    } else {
      const { error: callBookingErr } = await supabaseAdmin
        .from("calendar_bookings")
        .insert(bookingRow as never);
      if (callBookingErr)
        console.error(
          "[RETELL WEBHOOK] Inbound call booking insert failed",
          callBookingErr.message,
        );
    }
  }

  if (
    event === "call_analyzed" &&
    ((agentRow as { agent_type?: string }).agent_type === "receptionist" || callType === "inbound")
  ) {
    const custom = call.call_analysis?.custom_analysis_data ?? {};
    const pick = (...keys: string[]): string | null => {
      for (const key of keys) {
        const value = (custom as Record<string, unknown>)[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return null;
    };
    const startRaw = pick(
      "booking_start",
      "appointment_start",
      "start_time",
      "appointment_time",
      "booking_time",
    );
    const startMs = startRaw ? Date.parse(startRaw) : NaN;
    if (!Number.isNaN(startMs)) {
      const endRaw = pick("booking_end", "appointment_end", "end_time");
      const endMs = endRaw ? Date.parse(endRaw) : NaN;
      const attendeeName = pick("attendee_name", "name", "caller_name", "full_name");
      const externalId = `retell:${callId}`;
      const { data: existingBooking } = await supabaseAdmin
        .from("calendar_bookings")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("external_id", externalId)
        .maybeSingle();
      if (!existingBooking) {
        const { error: bookingError } = await supabaseAdmin.from("calendar_bookings").insert({
          workspace_id: workspaceId,
          lead_id: leadId,
          external_id: externalId,
          source: "retell",
          title:
            pick("title", "appointment_title", "subject") ??
            `Appointment with ${attendeeName ?? "caller"}`,
          description: pick("notes", "description", "reason"),
          start_at: new Date(startMs).toISOString(),
          end_at: !Number.isNaN(endMs)
            ? new Date(endMs).toISOString()
            : new Date(startMs + 30 * 60 * 1000).toISOString(),
          attendee_name: attendeeName,
          attendee_email: pick("attendee_email", "email"),
          attendee_phone: pick("attendee_phone", "phone") ?? contactPhone,
          status: "accepted",
        } as never);
        if (bookingError)
          console.error("[RETELL WEBHOOK] Booking insert failed", bookingError.message);
      }
    }
  }

  // Upsert booking_summaries from post-call analysis data.
  if (event === "call_analyzed") {
    const custom = call.call_analysis?.custom_analysis_data ?? {};
    const summaryText =
      (custom.booking_summary as string | undefined) ??
      call.call_analysis?.call_summary ??
      null;
    const agentId = agentRow.id ?? null;
    let userId: string | null = null;
    if (agentId) {
      const { data: agentRecord } = await supabaseAdmin
        .from("agents")
        .select("user_id")
        .eq("id", agentId)
        .maybeSingle();
      userId = (agentRecord?.user_id as string | undefined) ?? null;
    }
    if (!userId) {
      const { data: ws } = await supabaseAdmin
        .from("workspaces")
        .select("owner_id")
        .eq("id", workspaceId)
        .maybeSingle();
      userId = (ws?.owner_id as string | undefined) ?? null;
    }
    // Best-effort link to a booking created during this call.
    const { data: bookingRow } = await supabaseAdmin
      .from("bookings")
      .select("id, calcom_booking_uid")
      .eq("retell_call_id", callId)
      .maybeSingle();
    if (!userId) {
      console.warn("[RETELL WEBHOOK] No user_id for booking_summaries upsert, skipping", { callId, workspaceId });
    } else {
      await supabaseAdmin.from("booking_summaries").upsert(
        {
          user_id: userId,
          agent_id: agentId,
          retell_agent_id: incomingAgentId,
          call_id: callId,
          booking_id: bookingRow?.id ?? null,
          calcom_booking_uid: bookingRow?.calcom_booking_uid ?? null,
          summary: summaryText,
          appointment_reason: (custom.appointment_reason as string | undefined) ?? null,
          customer_name: (custom.customer_name as string | undefined) ?? null,
          customer_phone: (custom.customer_phone as string | undefined) ?? null,
          appointment_date: (custom.appointment_date as string | undefined) ?? null,
          appointment_booked: Boolean(custom.appointment_booked ?? bookingRow?.id),
          raw: call as never,
        },
        { onConflict: "call_id" },
      );
    }
  }

  await updateWebhookEvent(eventLogId, "processed");
  console.log("[RETELL WEBHOOK] Processing complete", { event, callId, workspaceId });
  return {
    ok: true,
    status: 200,
    message: "ok",
    event,
    callId,
    workspaceId,
    signatureValid: !!signatureValid,
  };
}
