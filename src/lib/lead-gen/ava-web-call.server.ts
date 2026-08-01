/**
 * Website "Talk to Ava" browser web-call flow.
 *
 * The public website opens a live Retell web call (WebRTC) with the Ava agent.
 * The session is created HERE (server-side) so the Retell API key never
 * reaches the browser, and attribution/visitor metadata is attached to the
 * call so the post-call webhook can create a WEBEE lead in the admin
 * workspace. Leads are created ONLY on call_analyzed when the call is
 * qualified (booked, positive sentiment, or an explicit follow-up request),
 * and are idempotent per retell call_id.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendResendEmail, escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";
import { toLeadSourceEnum, WEBEE_ADMIN_EMAIL } from "@/lib/lead-gen/webforms.server";
import {
  extractClickIds,
  sanitizeLandingUrl,
  recordConversionEvent,
} from "@/lib/tracking/conversion-events.server";
import { AVA_LIVE_AGENT_ID, resolveAdminWorkspaceId, normalizePhoneE164 } from "@/lib/lead-gen/ava-call.server";

const str = (v: unknown, max = 300): string | null => {
  const s = typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

async function getRetellKeyForWorkspace(workspaceId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const wsKey = (data as { retell_workspace_id?: string | null } | null)?.retell_workspace_id?.trim();
  return wsKey || process.env.RETELL_API_KEY || null;
}

// ── Session creation (called by the public endpoint) ─────────────────────────

export async function createAvaWebCallSession(input: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  visitorSessionId?: unknown;
  landingPage?: unknown;
  referringUrl?: unknown;
  attribution?: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<
  | { ok: true; accessToken: string; callId: string }
  | { ok: false; error: string; status: number }
> {
  const workspaceId = await resolveAdminWorkspaceId();
  if (!workspaceId) {
    console.error("[AVA-WEB-CALL] Admin workspace could not be resolved");
    return { ok: false, error: "Live chat is temporarily unavailable.", status: 503 };
  }
  const retellKey = await getRetellKeyForWorkspace(workspaceId);
  if (!retellKey) {
    console.error("[AVA-WEB-CALL] No Retell key available");
    return { ok: false, error: "Live chat is temporarily unavailable.", status: 503 };
  }

  const attr = (input.attribution ?? {}) as Record<string, unknown>;
  const clickIds = extractClickIds(attr);
  const email = str(input.email, 200)?.toLowerCase() ?? null;
  const phone = str(input.phone, 40) ? normalizePhoneE164(String(input.phone)) ?? str(input.phone, 40) : null;

  // Everything the post-call webhook needs travels on the call metadata —
  // Retell echoes it back on every webhook event for this call.
  const metadata: Record<string, unknown> = {
    source: "website_ava",
    channel: "web_call",
    workspace_id: workspaceId,
    visitor_session_id: str(input.visitorSessionId, 120),
    landing_page: sanitizeLandingUrl(input.landingPage ?? attr.landing_url ?? attr.landing_page),
    referring_url: str(input.referringUrl ?? attr.referrer, 500),
    gclid: clickIds.gclid,
    gbraid: clickIds.gbraid,
    wbraid: clickIds.wbraid,
    utm_source: str(attr.utm_source, 120),
    utm_medium: str(attr.utm_medium, 120),
    utm_campaign: str(attr.utm_campaign, 120),
    utm_term: str(attr.utm_term, 120),
    utm_content: str(attr.utm_content, 120),
    // Visitor ad-consent state as captured by the site's consent banner
    // ("granted" | "denied"); absent = unknown. Travels with the call so the
    // post-call conversion upload can honour it.
    ad_user_data_consent: (() => {
      const c = str(attr.ad_user_data_consent ?? attr.consent, 20)?.toLowerCase();
      return c === "granted" || c === "denied" ? c : null;
    })(),
    email,
    phone_number: phone,
    ip: input.ip,
  };
  // Drop nulls to keep the payload lean.
  for (const k of Object.keys(metadata)) if (metadata[k] == null) delete metadata[k];

  // Pin the tested published agent version so future draft edits never leak
  // into live website calls. Set AVA_AGENT_VERSION after publishing.
  const pinnedVersion = Number.parseInt(process.env.AVA_AGENT_VERSION ?? "", 10);
  const res = await fetch("https://api.retellai.com/v2/create-web-call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${retellKey}` },
    body: JSON.stringify({
      agent_id: AVA_LIVE_AGENT_ID,
      ...(Number.isFinite(pinnedVersion) ? { agent_version: pinnedVersion } : {}),
      metadata,
      retell_llm_dynamic_variables: {
        // Server-forced identity — browser-supplied values are never used here.
        workspace_id: workspaceId,
        source: "website_ava",
        channel: "web_call",
        lead_source: "website_ava",
        enquiry_type: "ava_live_demo",
        cta_source: "website_web_call",
        customer_name: str(input.name, 120) ?? "",
        email: email ?? "",
        phone_number: phone ?? "",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[AVA-WEB-CALL] create-web-call failed", res.status, body.slice(0, 400));
    return { ok: false, error: "We couldn't start the conversation. Please try again shortly.", status: 502 };
  }
  const data = (await res.json()) as { call_id?: string; access_token?: string };
  if (!data.call_id || !data.access_token) {
    console.error("[AVA-WEB-CALL] create-web-call returned no token/call_id");
    return { ok: false, error: "We couldn't start the conversation. Please try again shortly.", status: 502 };
  }
  console.log("[AVA-WEB-CALL] Web call session created", { callId: data.call_id, workspaceId });
  return { ok: true, accessToken: data.access_token, callId: data.call_id };
}

// ── Webhook integration ──────────────────────────────────────────────────────

type AvaWebCall = {
  call_id?: string;
  agent_id?: string;
  agent_version?: number;
  call_type?: string;
  call_status?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  transcript?: string;
  transcript_with_tool_calls?: Array<Record<string, unknown>>;
  recording_url?: string;
  disconnection_reason?: string;
  metadata?: Record<string, unknown>;
  retell_llm_dynamic_variables?: Record<string, unknown>;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    call_successful?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
};

// ── Booking verification (source of truth: the real Cal.com tool result) ─────

export type VerifiedBooking = {
  confirmed: boolean;
  uid: string | null;
  startTime: string | null;
  timezone: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  attendeePhone: string | null;
  eventTypeId: number | null;
};

/**
 * Inspect transcript_with_tool_calls for a genuine successful
 * book_appointment_cal invocation. Ava CLAIMING a booking succeeded, or a
 * post-call extracted booking_status, is NOT proof — only the actual tool
 * result is trusted.
 */
export function verifyCalBookingFromToolCalls(call: AvaWebCall): VerifiedBooking {
  const none: VerifiedBooking = {
    confirmed: false, uid: null, startTime: null, timezone: null,
    attendeeName: null, attendeeEmail: null, attendeePhone: null, eventTypeId: null,
  };
  const utterances = Array.isArray(call.transcript_with_tool_calls)
    ? call.transcript_with_tool_calls
    : [];
  // Collect tool invocations + results in order. Retell emits utterances with
  // role "tool_call_invocation" / "tool_call_result" (linked by tool_call_id).
  const invocations = new Map<string, { name: string }>();
  for (const u of utterances) {
    const role = String((u as Record<string, unknown>).role ?? "");
    const toolCallId = String((u as Record<string, unknown>).tool_call_id ?? "");
    if (role === "tool_call_invocation" && toolCallId) {
      invocations.set(toolCallId, { name: String((u as Record<string, unknown>).name ?? "") });
    }
  }
  for (const u of utterances) {
    const rec = u as Record<string, unknown>;
    if (String(rec.role ?? "") !== "tool_call_result") continue;
    const inv = invocations.get(String(rec.tool_call_id ?? ""));
    const name = (inv?.name ?? String(rec.name ?? "")).toLowerCase();
    if (!name.includes("book_appointment")) continue;
    const content = rec.content;
    let parsed: Record<string, unknown> | null = null;
    if (typeof content === "string") {
      try { parsed = JSON.parse(content) as Record<string, unknown>; } catch { parsed = null; }
      if (!parsed && /error|fail|unavailable|no longer available/i.test(content)) continue;
    } else if (content && typeof content === "object") {
      parsed = content as Record<string, unknown>;
    }
    if (!parsed) continue;
    // Cal.com v2 booking responses: { status:"success", data:{ uid, start, ... } }
    // or a bare booking object with uid/id.
    const dataObj = (parsed.data && typeof parsed.data === "object" ? parsed.data : parsed) as Record<string, unknown>;
    const statusStr = String(parsed.status ?? "").toLowerCase();
    // Strict success gate: when the result carries a status field it MUST be
    // "success" (pending/accepted/anything else never confirms); error-shaped
    // payloads never confirm; and the booking UID must be an explicit
    // uid/booking_uid — never a generic `id`, which appears on non-booking
    // objects too.
    const failed = (statusStr !== "" && statusStr !== "success") || parsed.error != null || dataObj.error != null;
    const uid = str(dataObj.uid, 120) ?? str(dataObj.booking_uid, 120);
    if (failed || !uid) continue;
    const attendee = (Array.isArray(dataObj.attendees) ? dataObj.attendees[0] : dataObj.responses ?? {}) as Record<string, unknown>;
    return {
      confirmed: true,
      uid,
      startTime: str(dataObj.start, 60) ?? str(dataObj.startTime, 60) ?? str(dataObj.start_time, 60),
      timezone: str((attendee as Record<string, unknown>).timeZone, 60) ?? str(dataObj.timeZone, 60) ?? null,
      attendeeName: str((attendee as Record<string, unknown>).name, 120),
      attendeeEmail: str((attendee as Record<string, unknown>).email, 200)?.toLowerCase() ?? null,
      attendeePhone: str((attendee as Record<string, unknown>).phone ?? (attendee as Record<string, unknown>).phoneNumber, 40),
      eventTypeId: typeof dataObj.eventTypeId === "number" ? dataObj.eventTypeId : null,
    };
  }
  return none;
}

// ── Failed booking detection ─────────────────────────────────────────────────

export type FailedBookingSignal = {
  /** A book_appointment tool call was actually attempted during the call. */
  attempted: boolean;
  /** Booking was attempted (or summary indicates a booking) but did NOT succeed. */
  failed: boolean;
  /** Best-effort human-readable error detail from the tool result / summary. */
  errorDetail: string | null;
  /** Contact details recovered from the booking tool INVOCATION arguments. */
  attendeeName: string | null;
  attendeeEmail: string | null;
  attendeePhone: string | null;
};

/**
 * Detect a booking attempt that FAILED (e.g. Cal.com email_validation_error).
 * Sources, in order of trust:
 *   1. tool_call_invocation for book_appointment* with no successful result
 *      (verifyCalBookingFromToolCalls already establishes success).
 *   2. An error-shaped tool_call_result content for book_appointment*.
 *   3. call_summary mentioning a booking/calendar error (fallback only).
 * Contact details are recovered from the invocation arguments so the caller
 * can still become a lead even when post-call analysis captured nothing.
 */
export function detectFailedCalBooking(call: AvaWebCall, bookingConfirmed: boolean): FailedBookingSignal {
  const out: FailedBookingSignal = {
    attempted: false, failed: false, errorDetail: null,
    attendeeName: null, attendeeEmail: null, attendeePhone: null,
  };
  const utterances = Array.isArray(call.transcript_with_tool_calls)
    ? call.transcript_with_tool_calls
    : [];
  const bookingToolCallIds = new Set<string>();
  for (const u of utterances) {
    const rec = u as Record<string, unknown>;
    if (String(rec.role ?? "") !== "tool_call_invocation") continue;
    const name = String(rec.name ?? "").toLowerCase();
    if (!name.includes("book_appointment")) continue;
    out.attempted = true;
    const id = String(rec.tool_call_id ?? "");
    if (id) bookingToolCallIds.add(id);
    // Recover contact details from the invocation arguments.
    const rawArgs = rec.arguments;
    let args: Record<string, unknown> | null = null;
    if (typeof rawArgs === "string") {
      try { args = JSON.parse(rawArgs) as Record<string, unknown>; } catch { args = null; }
    } else if (rawArgs && typeof rawArgs === "object") {
      args = rawArgs as Record<string, unknown>;
    }
    if (args) {
      const attendee = (args.attendee && typeof args.attendee === "object" ? args.attendee : args) as Record<string, unknown>;
      out.attendeeName ??= str(attendee.name, 120) ?? str(args.name, 120);
      out.attendeeEmail ??= str(attendee.email, 200)?.toLowerCase() ?? str(args.email, 200)?.toLowerCase() ?? null;
      out.attendeePhone ??= str(attendee.phone ?? attendee.phoneNumber, 40) ?? str(args.phone ?? args.phone_number, 40);
    }
  }
  // Error detail from the matching tool result (string errors are skipped by
  // the success verifier, so inspect them here).
  for (const u of utterances) {
    const rec = u as Record<string, unknown>;
    if (String(rec.role ?? "") !== "tool_call_result") continue;
    const id = String(rec.tool_call_id ?? "");
    if (bookingToolCallIds.size > 0 && !bookingToolCallIds.has(id)) continue;
    if (bookingToolCallIds.size === 0 && !String(rec.name ?? "").toLowerCase().includes("book_appointment")) continue;
    const content = rec.content;
    if (typeof content === "string") {
      if (/error|fail|invalid|unavailable|not available|no longer available/i.test(content)) {
        out.errorDetail ??= content.slice(0, 500);
      } else {
        try {
          const parsed = JSON.parse(content) as Record<string, unknown>;
          const statusStr = String(parsed.status ?? "").toLowerCase();
          const err = parsed.error ?? (parsed.data as Record<string, unknown> | undefined)?.error;
          if (statusStr === "error" || err != null) {
            out.errorDetail ??= (typeof err === "string" ? err : JSON.stringify(err ?? parsed)).slice(0, 500);
          }
        } catch { /* non-JSON success payloads handled by the verifier */ }
      }
    } else if (content && typeof content === "object") {
      const parsed = content as Record<string, unknown>;
      const statusStr = String(parsed.status ?? "").toLowerCase();
      const err = parsed.error ?? (parsed.data as Record<string, unknown> | undefined)?.error;
      if (statusStr === "error" || err != null) {
        out.errorDetail ??= (typeof err === "string" ? err : JSON.stringify(err ?? parsed)).slice(0, 500);
      }
    }
  }
  // Summary fallback: Ava's post-call summary mentions a booking/calendar error.
  const summary = call.call_analysis?.call_summary ?? "";
  const summaryIndicatesFailure =
    /(booking|calendar|appointment|schedul\w*)[^.]{0,120}(error|fail\w*|couldn'?t|could not|unable|didn'?t (?:go through|work)|issue|problem)/i.test(summary) ||
    /(error|fail\w*|couldn'?t|could not|unable)[^.]{0,120}(booking|book (?:the|an|a)|calendar|appointment)/i.test(summary);
  out.failed = !bookingConfirmed && (out.attempted || summaryIndicatesFailure);
  if (out.failed && !out.errorDetail && summaryIndicatesFailure) {
    out.errorDetail = "Call summary indicates a booking/calendar error";
  }
  // attempted-but-no-result with no error signal at all: still treat as failed
  // (no confirmed booking exists), which is exactly the silent-failure case.
  return out;
}

// ── Call record upsert (one WEBEE call row per Retell web call) ──────────────

/**
 * Upsert the WEBEE call record for a website Ava web call, keyed on
 * retell_call_id. Never overwrites previously stored valid values with
 * missing values from later/earlier events (null/empty fields are dropped
 * before write, matching the phone-call path).
 */
export async function upsertAvaWebCallRecord(
  call: AvaWebCall,
  workspaceId: string,
  event: string,
): Promise<void> {
  const callId = call.call_id ?? "";
  if (!callId) return;
  const tsToIso = (ms?: number) => (typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null);
  const startedAt = tsToIso(call.start_timestamp);
  const endedAt = tsToIso(call.end_timestamp);
  const durationSeconds =
    call.duration_ms != null
      ? Math.round(call.duration_ms / 1000)
      : startedAt && endedAt
        ? Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
        : null;
  const row: Record<string, unknown> = {
    workspace_id: workspaceId,
    retell_call_id: callId,
    agent_id: String(call.agent_id ?? "").replace(/^retell:/, "") || AVA_LIVE_AGENT_ID,
    agent_name: "AVA WEBEE BOOKING AGENT",
    call_type: "inbound", // website visitor initiated
    channel_type: "web_call",
    provider: "retell",
    call_status:
      event === "call_analyzed" || event === "call_ended" ? "completed" : "in_progress",
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    disconnection_reason: call.disconnection_reason ?? null,
    transcript: call.transcript ?? null,
    recording_url: call.recording_url ?? null,
    call_summary: call.call_analysis?.call_summary ?? null,
    sentiment: mapSentiment(call.call_analysis?.user_sentiment),
    call_successful: call.call_analysis?.call_successful ?? null,
    to_number: "web_call",
    from_number: "web_call",
    updated_at: new Date().toISOString(),
  };
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && value !== undefined && value !== "") cleaned[key] = value;
  }
  try {
    const { data: existing } = await supabaseAdmin
      .from("calls")
      .select("id")
      .eq("retell_call_id", callId)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await supabaseAdmin.from("calls").update(cleaned as never).eq("id", existing.id as string);
      if (error) console.error("[AVA-WEB-CALL] Call record update failed", error.message, { callId });
    } else {
      const { error } = await supabaseAdmin.from("calls").insert(cleaned as never);
      if (error && /duplicate|unique/i.test(error.message)) {
        await supabaseAdmin.from("calls").update(cleaned as never).eq("retell_call_id", callId);
      } else if (error) {
        console.error("[AVA-WEB-CALL] Call record insert failed", error.message, { callId });
      }
    }
  } catch (e) {
    console.error("[AVA-WEB-CALL] Call record upsert threw", e);
  }
}

/** True when a web_call webhook belongs to the website Ava live chat. */
export function isWebsiteAvaWebCall(call: { agent_id?: string; metadata?: Record<string, unknown> }): boolean {
  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  if (meta.source === "website_ava") return true;
  // Calls the website created directly against the Retell API (no metadata)
  // still belong to the live Ava agent — capture those too.
  const agentId = String(call.agent_id ?? "").replace(/^retell:/, "");
  return agentId === AVA_LIVE_AGENT_ID;
}

function mapSentiment(value?: string | null): "positive" | "neutral" | "negative" | null {
  const lower = (value ?? "").toLowerCase();
  if (lower.includes("positive")) return "positive";
  if (lower.includes("negative")) return "negative";
  if (lower.includes("neutral")) return "neutral";
  return null;
}

const truthy = (v: unknown): boolean =>
  v === true || (typeof v === "string" && ["true", "yes", "y", "1"].includes(v.trim().toLowerCase()));

/**
 * Terminal processing on call_analyzed for a website Ava web call.
 * Creates/updates a lead when the call is qualified: appointment booked, OR
 * positive sentiment, OR an explicit demo/quote/trial/follow-up request, OR
 * an explicit qualified flag from post-call analysis. Neutral sentiment alone
 * does NOT block a lead when any other condition is met. Idempotent per
 * retell call_id (upsert keyed on meta.retell_call_id).
 */
export async function processAvaWebCallAnalyzed(call: AvaWebCall): Promise<void> {
  const callId = call.call_id ?? "";
  if (!callId) return;

  const meta = (call.metadata ?? {}) as Record<string, unknown>;
  // SECURITY: never trust metadata.workspace_id for routing — webhook payload
  // metadata is attacker-influenceable. Website Ava leads are ALWAYS routed to
  // the server-resolved admin workspace.
  const workspaceId = await resolveAdminWorkspaceId();
  if (!workspaceId) {
    // Never silently drop — leave a loud audit trail on the webhook event log.
    console.error("[AVA-WEB-CALL] No workspace resolved for web call — recording integration error", { callId });
    try {
      await supabaseAdmin.from("retell_webhook_events").insert({
        event_type: "integration_error",
        retell_call_id: callId,
        processing_status: "error",
        error_message: "website_ava web call: no workspace could be resolved — lead not created",
        payload: { source: "website_ava", call_id: callId },
        processed_at: new Date().toISOString(),
      } as never);
    } catch { /* best-effort */ }
    return;
  }

  // ── Idempotency: one lead per retell call_id ───────────────────────────────
  {
    const { data: dup } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .contains("meta", { retell_call_id: callId })
      .limit(1);
    if ((dup ?? []).length > 0) {
      console.log("[AVA-WEB-CALL] call already processed (lead exists)", { callId });
      return;
    }
  }

  const custom = (call.call_analysis?.custom_analysis_data ?? {}) as Record<string, unknown>;
  const sentiment = mapSentiment(call.call_analysis?.user_sentiment);
  const bookingSlot = str(custom.booking_slot) ?? str(custom.booking_start_time);

  // Booking source of truth: the REAL Cal.com tool result. Post-call extracted
  // fields are only a fallback signal for lead qualification, never "confirmed".
  const verified = verifyCalBookingFromToolCalls(call);
  const extractedUid =
    str(custom.booking_uid) ?? str(custom.cal_booking_uid) ?? str(custom.booking_id) ?? null;
  const extractedStatus = str(custom.booking_status);
  const extractedBooked =
    extractedStatus === "booked" || extractedStatus === "confirmed" || truthy(custom.appointment_booked) || !!extractedUid;
  if (extractedUid && verified.uid && extractedUid !== verified.uid) {
    console.warn("[AVA-WEB-CALL] booking_uid discrepancy — trusting tool result", {
      callId, extractedUid, verifiedUid: verified.uid,
    });
  }
  if (extractedBooked && !verified.confirmed) {
    console.warn("[AVA-WEB-CALL] post-call claims booking but no successful tool result — NOT confirmed", { callId });
  }
  const bookingConfirmed = verified.confirmed;
  const failedBooking = detectFailedCalBooking(call, bookingConfirmed);
  const bookingFailed = failedBooking.failed;
  if (bookingFailed) {
    console.warn("[AVA-WEB-CALL] booking attempted but FAILED — flagging for follow-up", {
      callId, errorDetail: failedBooking.errorDetail,
    });
  }
  const bookingUid = verified.uid ?? extractedUid;
  const bookingStatus = bookingConfirmed
    ? "confirmed"
    : bookingFailed
      ? "failed"
      : extractedBooked
        ? "unconfirmed"
        : (extractedStatus ?? null);
  // A booking (confirmed or claimed) still qualifies the caller as a lead.
  const booked = bookingConfirmed || extractedBooked;
  const explicitRequest =
    truthy(custom.requested_follow_up) ||
    truthy(custom.follow_up_requested) ||
    truthy(custom.requested_demo) ||
    truthy(custom.wants_demo) ||
    truthy(custom.requested_quote) ||
    truthy(custom.requested_trial) ||
    truthy(custom.requested_human) ||
    truthy(custom.callback_requested);
  const qualificationResult =
    str(custom.qualification_result)?.toLowerCase() ??
    str(custom.qualification_status)?.toLowerCase() ??
    str(custom.qualification)?.toLowerCase() ??
    null;
  const qualifiedFlag =
    truthy(custom.qualified) ||
    truthy(custom.lead_qualified) ||
    qualificationResult === "qualified";

  // A FAILED booking attempt is a strong buying signal — the caller wanted to
  // book. It always qualifies the caller, even overriding negative sentiment
  // (frustration at a broken booking must not lose the lead).
  const shouldCreateLead =
    bookingFailed ||
    ((booked || sentiment === "positive" || explicitRequest || qualifiedFlag) &&
      sentiment !== "negative");
  if (!shouldCreateLead) {
    console.log("[AVA-WEB-CALL] call not qualified — no lead", { callId, sentiment, booked });
    return;
  }

  // ── Contact details: post-call analysis first, session metadata fallback ──
  const email =
    (str(custom.email, 200) ?? verified.attendeeEmail ?? failedBooking.attendeeEmail ?? str(meta.email, 200))?.toLowerCase() ?? null;
  const rawPhone =
    str(custom.phone_number, 40) ?? str(custom.phone, 40) ?? verified.attendeePhone ?? failedBooking.attendeePhone ?? str(meta.phone_number, 40);
  const phone = rawPhone ? normalizePhoneE164(rawPhone) ?? rawPhone : null;
  const fullName =
    str(custom.caller_name, 120) ?? str(custom.customer_name, 120) ?? str(custom.name, 120) ?? verified.attendeeName ?? failedBooking.attendeeName ?? null;

  if (!email && !phone) {
    console.warn("[AVA-WEB-CALL] Qualified call but no contact details — recording for review", { callId });
    try {
      await supabaseAdmin.from("retell_webhook_events").insert({
        event_type: "integration_error",
        retell_call_id: callId,
        workspace_id: workspaceId,
        processing_status: "error",
        error_message: "website_ava web call qualified but no email/phone captured — no lead created",
        payload: { source: "website_ava", call_id: callId, sentiment, booked, booking_failed: bookingFailed },
        processed_at: new Date().toISOString(),
      } as never);
    } catch { /* best-effort */ }
    // A failed booking must NEVER slip away silently — alert admins even when
    // no lead could be created, so the team can chase the transcript.
    if (bookingFailed) {
      await notifyFailedAvaBooking({
        workspaceId, callId, leadId: null,
        name: null, email: null, phone: null,
        errorDetail: failedBooking.errorDetail,
        summary: call.call_analysis?.call_summary ?? null,
        noContact: true,
      });
    }
    return;
  }

  const now = new Date().toISOString();
  const clickIds = extractClickIds(meta);
  const adConsent = (() => {
    const c = str(meta.ad_user_data_consent, 20)?.toLowerCase();
    return c === "granted" || c === "denied" ? c : null;
  })();
  const metaPatch: Record<string, unknown> = {
    retell_call_id: callId,
    cta_source: "website_ava",
    channel: "web_call",
    attribution_source: "ava_web_call",
    ad_user_data_consent: adConsent,
    enquiry_type: "ava_live_demo",
    appointment_booked: booked,
    booking_status: bookingStatus,
    booking_confirmed: bookingConfirmed,
    booking_failed: bookingFailed,
    booking_error: bookingFailed ? failedBooking.errorDetail : null,
    follow_up_required: bookingFailed || null,
    booking_slot: bookingSlot,
    booking_start_time: verified.startTime ?? str(custom.booking_start_time, 60),
    booking_timezone: verified.timezone ?? "Europe/London",
    cal_booking_uid: bookingUid,
    cal_event_type_id: verified.eventTypeId,
    qualification_result: qualificationResult,
    original_phone_number: rawPhone !== phone ? rawPhone : null,
    retell_agent_id: String(call.agent_id ?? "").replace(/^retell:/, "") || AVA_LIVE_AGENT_ID,
    retell_agent_version: call.agent_version ?? null,
    recording_url: call.recording_url ?? null,
    visitor_session_id: str(meta.visitor_session_id, 120),
    landing_page: str(meta.landing_page, 500),
    referring_url: str(meta.referring_url, 500),
    utm_source: str(meta.utm_source, 120),
    utm_medium: str(meta.utm_medium, 120),
    utm_campaign: str(meta.utm_campaign, 120),
    utm_term: str(meta.utm_term, 120),
    utm_content: str(meta.utm_content, 120),
    industry: str(custom.industry),
    interest: str(custom.interest),
    budget: str(custom.budget),
  };

  // ── Dedupe by email / phone within the workspace ───────────────────────────
  type ExistingLead = { id: string; full_name: string | null; status: string; meta: Record<string, unknown> | null; email: string | null; phone: string | null };
  let existing: ExistingLead | null = null;
  if (email) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, status, meta, email, phone")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .maybeSingle();
    existing = (data as ExistingLead | null) ?? null;
  }
  if (!existing && phone) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, status, meta, email, phone")
      .eq("workspace_id", workspaceId)
      .eq("phone", phone)
      .maybeSingle();
    existing = (data as ExistingLead | null) ?? null;
  }

  let leadId: string | null = null;
  if (existing) {
    const isDnc = existing.status === "do_not_call";
    const patch: Record<string, unknown> = {
      ...(isDnc ? {} : { status: "qualified" }),
      source_type: "website_ava",
      source_detail: "web_call",
      sentiment,
      call_summary: call.call_analysis?.call_summary ?? null,
      qualification_status:
        qualificationResult ?? (booked || explicitRequest || qualifiedFlag ? "qualified" : "unqualified"),
      last_contacted_at: now,
      updated_at: now,
      meta: { ...(existing.meta ?? {}), ...metaPatch },
      ...(fullName && !existing.full_name ? { full_name: fullName } : {}),
      ...(email && !existing.email ? { email } : {}),
      ...(phone && !existing.phone ? { phone } : {}),
      ...(clickIds.gclid ? { gclid: clickIds.gclid } : {}),
      ...(clickIds.gbraid ? { gbraid: clickIds.gbraid } : {}),
      ...(clickIds.wbraid ? { wbraid: clickIds.wbraid } : {}),
    };
    const { error } = await supabaseAdmin.from("leads").update(patch as never).eq("id", existing.id);
    if (error) {
      console.error("[AVA-WEB-CALL] Lead promote failed", error.message);
      return;
    }
    leadId = existing.id;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("leads")
      .insert({
        workspace_id: workspaceId,
        full_name: fullName ?? email ?? phone,
        email,
        // leads.phone is NOT NULL — web-call visitors may only leave an email.
        phone: phone ?? "",
        status: "qualified",
        source: toLeadSourceEnum("webee_website_form"),
        source_type: "website_ava",
        source_detail: "web_call",
        sentiment,
        call_summary: call.call_analysis?.call_summary ?? null,
        // Sentiment and qualification stay SEPARATE: politeness alone never
        // marks someone qualified — only a real qualification result, booking
        // or explicit commercial request does.
        qualification_status:
          qualificationResult ?? (booked || explicitRequest || qualifiedFlag ? "qualified" : "unqualified"),
        last_contacted_at: now,
        created_at: now,
        updated_at: now,
        meta: metaPatch,
        ...(clickIds.gclid ? { gclid: clickIds.gclid } : {}),
        ...(clickIds.gbraid ? { gbraid: clickIds.gbraid } : {}),
        ...(clickIds.wbraid ? { wbraid: clickIds.wbraid } : {}),
      } as never)
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("[AVA-WEB-CALL] Lead create failed", error?.message);
      return;
    }
    leadId = (inserted as { id: string }).id;
    try {
      const { notifyNewLead } = await import("@/lib/lead-gen/lead-notify.server");
      await notifyNewLead({
        workspaceId, leadId,
        name: fullName, phone, email,
        source: "Website Ava live chat",
      });
    } catch { /* best-effort */ }
  }

  // Conversion events + note + admin email — best-effort only.
  const landingUrl = sanitizeLandingUrl(meta.landing_page);
  try {
    await recordConversionEvent({
      workspaceId,
      conversionName: "ava_qualified_lead",
      source: "ava_web_call",
      leadId,
      recordRef: { retell_call_id: callId, booking_slot: bookingSlot, cal_booking_uid: bookingUid },
      clickIds,
      landingUrl,
      adUserDataConsent: adConsent,
      dedupKey: `ava_web_call:${callId}`,
    });
  } catch { /* best-effort */ }

  // Primary booking conversion — fires ONLY on a genuine Cal.com tool-result
  // booking with a real UID (never from sentiment, transcript claims,
  // extracted booking_status/slot or call completion). Dedup: the booking UID
  // is the dedup key AND the provider-side order id, so webhook retries and
  // upload retries can never double-count one appointment.
  let bookingConversion: { status?: string; deduped?: boolean } | null = null;
  if (bookingConfirmed && verified.uid) {
    try {
      bookingConversion = await recordConversionEvent({
        workspaceId,
        conversionName: "ava_appointment_booked",
        source: "ava_web_call",
        leadId,
        recordRef: {
          retell_call_id: callId,
          cal_booking_uid: verified.uid,
          booking_start_time: verified.startTime,
          attribution_source: "ava_web_call",
        },
        clickIds,
        landingUrl,
        orderId: verified.uid,
        adUserDataConsent: adConsent,
        dedupKey: `ava_appointment_booked:${verified.uid}`,
      });
    } catch { /* best-effort */ }
    // Mirror the conversion linkage onto the lead for admin visibility.
    // Merge-safe: re-read the CURRENT meta immediately before patching so a
    // deduped existing lead's unrelated fields are never clobbered.
    try {
      const { data: cur } = await supabaseAdmin
        .from("leads")
        .select("meta")
        .eq("id", leadId!)
        .maybeSingle();
      const currentMeta = ((cur as { meta?: Record<string, unknown> } | null)?.meta ?? {}) as Record<string, unknown>;
      await supabaseAdmin
        .from("leads")
        .update({
          meta: {
            ...currentMeta,
            google_ads_conversion_status: bookingConversion?.deduped
              ? "duplicate_suppressed"
              : bookingConversion?.status ?? "not_recorded",
            conversion_action: "ava_appointment_booked",
            conversion_order_id: verified.uid,
            conversion_recorded_at: now,
          },
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", leadId!);
    } catch { /* best-effort */ }
  }

  // GA4 analytics events (reporting only — the server-side Google Ads upload
  // above stays the conversion source of truth; no client-side Ads tag).
  try {
    const { sendGa4Event } = await import("@/lib/tracking/ga4-events.server");
    const clientRef = str(meta.visitor_session_id, 120);
    const base = {
      clientRef,
      fallbackRef: callId,
      params: { source: "ava_web_call", utm_source: str(meta.utm_source, 120) ?? undefined },
    };
    await sendGa4Event({ ...base, name: "generate_lead" });
    await sendGa4Event({ ...base, name: "ava_qualified_lead" });
    if (bookingConfirmed && verified.uid) {
      await sendGa4Event({ ...base, name: "ava_appointment_booked", transactionId: verified.uid });
    }
  } catch { /* best-effort */ }
  try {
    await supabaseAdmin.from("entity_notes").insert({
      workspace_id: workspaceId,
      entity_type: "lead",
      entity_id: leadId,
      body: `Spoke to Ava live on the website (web call).${booked ? " Booked an appointment." : ""}${bookingFailed ? ` BOOKING FAILED — follow up manually.${failedBooking.errorDetail ? ` Error: ${failedBooking.errorDetail}` : ""}` : ""}${bookingSlot ? ` Slot: ${bookingSlot}.` : ""}${bookingUid ? ` Booking ref: ${bookingUid}.` : ""}`,
      created_at: now,
    } as never);
  } catch { /* best-effort */ }
  try {
    await sendResendEmail({
      to: WEBEE_ADMIN_EMAIL,
      subject: bookingFailed
        ? `⚠️ Ava booking FAILED — follow up: ${fullName ?? email ?? phone}`
        : `Website Ava lead: ${fullName ?? email ?? phone}`,
      html: renderBasicEmail({
        heading: bookingFailed
          ? "Ava booking FAILED on the website — manual follow-up needed"
          : booked
            ? "Ava booked an appointment on the website"
            : "New lead from the website Ava live chat",
        bodyHtml: `
          <p style="font-size:14px;color:#c8c8d8">${escapeHtml(fullName ?? "A visitor")} spoke to Ava live on the website.${bookingFailed ? " They tried to book an appointment but the booking FAILED — please follow up manually." : ""}</p>
          <p style="font-size:13px;color:#c8c8d8">${email ? `Email: ${escapeHtml(email)}<br/>` : ""}${phone ? `Phone: ${escapeHtml(phone)}<br/>` : ""}${bookingSlot ? `Slot: ${escapeHtml(bookingSlot)}<br/>` : ""}${bookingFailed && failedBooking.errorDetail ? `Booking error: ${escapeHtml(failedBooking.errorDetail)}<br/>` : ""}Sentiment: ${escapeHtml(sentiment ?? "unknown")}</p>`,
      }),
    });
  } catch { /* best-effort */ }

  // In-app notification for workspace admins when the booking failed.
  if (bookingFailed) {
    await notifyFailedAvaBooking({
      workspaceId, callId, leadId,
      name: fullName, email, phone,
      errorDetail: failedBooking.errorDetail,
      summary: call.call_analysis?.call_summary ?? null,
      noContact: false,
    });
  }

  console.log("[AVA-WEB-CALL] Lead recorded", { callId, leadId, booked, bookingFailed, sentiment });
}

// ── Call-started observation event (mic click → live call connected) ────────

/**
 * Records the "WEBEE – Ava Call Started" observation event when a website
 * Ava web call connects. Observation-only: it never uploads against the
 * primary booking/lead conversion action (uploads only if an action is
 * explicitly mapped for ava_call_started). Idempotent per call id.
 * Never throws.
 */
export async function recordAvaWebCallStarted(call: AvaWebCall): Promise<void> {
  try {
    const callId = call.call_id ?? "";
    if (!callId) return;
    const workspaceId = await resolveAdminWorkspaceId();
    if (!workspaceId) return;
    const meta = (call.metadata ?? {}) as Record<string, unknown>;
    const clickIds = extractClickIds(meta);
    const adConsent = (() => {
      const c = str(meta.ad_user_data_consent, 20)?.toLowerCase();
      return c === "granted" || c === "denied" ? c : null;
    })();
    await recordConversionEvent({
      workspaceId,
      conversionName: "ava_call_started",
      source: "ava_web_call",
      recordRef: {
        retell_call_id: callId,
        visitor_session_id: str(meta.visitor_session_id, 120),
        attribution_source: "ava_web_call",
      },
      clickIds,
      landingUrl: sanitizeLandingUrl(meta.landing_page),
      adUserDataConsent: adConsent,
      dedupKey: `ava_call_started:${callId}`,
    });
    const { sendGa4Event } = await import("@/lib/tracking/ga4-events.server");
    await sendGa4Event({
      name: "ava_call_started",
      clientRef: str(meta.visitor_session_id, 120),
      fallbackRef: callId,
      params: { source: "ava_web_call", utm_source: str(meta.utm_source, 120) ?? undefined },
    });
  } catch (err) {
    console.warn("[AVA-WEB-CALL] call-started event failed (non-fatal):", (err as Error)?.message);
  }
}

// ── Failed-booking admin alert (in-app notification + email fallback) ────────

async function notifyFailedAvaBooking(input: {
  workspaceId: string;
  callId: string;
  leadId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  errorDetail: string | null;
  summary: string | null;
  /** True when no contact details were captured (no lead row exists). */
  noContact: boolean;
}): Promise<void> {
  const who = input.name?.trim() || input.email?.trim() || input.phone?.trim() || "Unknown caller";
  // In-app workspace notification (owner + admins by default) — reuses the
  // existing needs_admin_attention event key (warning severity, no migration).
  try {
    const { emitCampaignNotification } = await import("@/lib/notifications/notification-engine.shared");
    await emitCampaignNotification(supabaseAdmin as any, {
      workspaceId: input.workspaceId,
      eventKey: "needs_admin_attention",
      campaignName: `Ava booking failed — ${who}`,
      summary: [
        "Website Ava caller tried to book but the booking failed — follow up manually.",
        input.email ? `Email: ${input.email}` : null,
        input.phone ? `Phone: ${input.phone}` : null,
        input.errorDetail ? `Error: ${input.errorDetail}` : null,
        input.noContact ? "No contact details captured — check the call transcript." : null,
      ].filter(Boolean).join(" · "),
      severity: "warning",
    });
  } catch (e) {
    console.warn("[AVA-WEB-CALL] failed-booking notification emit failed (non-fatal)", e);
  }
  // Direct admin email for the no-contact case (the lead path already sends
  // its own admin email with the failure callout).
  if (input.noContact) {
    try {
      await sendResendEmail({
        to: WEBEE_ADMIN_EMAIL,
        subject: "⚠️ Ava booking FAILED on the website — no contact captured",
        html: renderBasicEmail({
          heading: "Ava booking FAILED — manual follow-up needed",
          bodyHtml: `
            <p style="font-size:14px;color:#c8c8d8">A website visitor tried to book via Ava but the booking failed, and no email/phone was captured. Check the call transcript to recover their details.</p>
            <p style="font-size:13px;color:#c8c8d8">Call ID: ${escapeHtml(input.callId)}<br/>${input.errorDetail ? `Booking error: ${escapeHtml(input.errorDetail)}<br/>` : ""}${input.summary ? `Summary: ${escapeHtml(input.summary.slice(0, 600))}` : ""}</p>`,
        }),
      });
    } catch { /* best-effort */ }
  }
}
