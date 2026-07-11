/**
 * "Call Ava Now" homepage flow.
 *
 * Visitors request a live call from Ava (the WEBEE booking agent). The request
 * is OTP-verified by email, recorded in `ava_call_requests` (audit table) and an
 * outbound Retell call is triggered. A WEBEE lead is created ONLY after the
 * post-call webhook confirms appointment_booked AND sentiment positive/neutral.
 * This flow NEVER creates `need_to_call` leads.
 */
import { createHash, randomInt } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendResendEmail, escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";
import { toLeadSourceEnum, WEBEE_ADMIN_EMAIL } from "@/lib/lead-gen/webforms.server";
import {
  detectOtpProvider,
  sendOtp,
  checkTwilioVerifyCode,
  isOtpDevMode,
  getOtpDevCode,
  type OtpChannel,
} from "@/lib/lead-gen/ava-otp-provider.server";

/** Retell live agent that answers "Call Ava Now" requests. */
export const AVA_LIVE_AGENT_ID = "agent_a7d436bf944aeae0c72a12d5d2";

const OTP_EXPIRY_MINUTES = (() => {
  const n = Number(process.env.OTP_EXPIRY_MINUTES);
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : 10;
})();
const OTP_TTL_MS = OTP_EXPIRY_MINUTES * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const PER_PHONE_DAILY_CAP = Number(process.env.AVA_CALL_PER_PHONE_DAILY_CAP ?? 2);
const PER_EMAIL_DAILY_CAP = Number(process.env.AVA_CALL_PER_EMAIL_DAILY_CAP ?? 2);
const GLOBAL_DAILY_CAP = Number(process.env.AVA_CALL_DAILY_CAP ?? 25);
/** Comma-separated dial-code prefixes allowed to receive Ava calls. */
const ALLOWED_PREFIXES = (process.env.AVA_CALL_ALLOWED_COUNTRY_CODES ?? "+1,+44")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

export type AvaCallRequestRow = {
  id: string;
  workspace_id: string;
  full_name: string | null;
  email: string;
  phone: string;
  website: string | null;
  status: string;
  otp_hash: string | null;
  otp_expires_at: string | null;
  otp_attempts: number;
  retell_call_id: string | null;
  from_number: string | null;
  call_outcome: Record<string, unknown> | null;
  lead_id: string | null;
  processed_at: string | null;
};

function hashOtp(requestId: string, otp: string): string {
  // OTP_SECRET (optional) hardens the hash; requestId already salts it.
  const secret = process.env.OTP_SECRET?.trim() ?? "";
  return createHash("sha256").update(`${secret}:${requestId}:${otp}`).digest("hex");
}

export function normalizePhoneE164(raw: string): string | null {
  const cleaned = raw.replace(/[\s().-]/g, "");
  const withPlus = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;
  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) return null;
  return withPlus;
}

function isAllowedCountry(phone: string): boolean {
  if (ALLOWED_PREFIXES.length === 0) return true;
  return ALLOWED_PREFIXES.some((p) => phone.startsWith(p));
}

export async function resolveAdminWorkspaceId(): Promise<string | null> {
  const fromEnv = process.env.WEBEE_ADMIN_WORKSPACE_ID?.trim();
  if (fromEnv) return fromEnv;
  try {
    // NOTE: workspace_members has no PostgREST relationship to a users table,
    // so resolve the admin user via the Auth admin API, then their membership.
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    const adminUser = users?.users?.find((u) => u.email === WEBEE_ADMIN_EMAIL);
    if (!adminUser) return null;
    const { data: memberships } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", adminUser.id);
    const rows = (memberships ?? []) as Array<{ workspace_id: string; role: string | null }>;
    return rows.find((m) => m.role === "owner")?.workspace_id ?? rows[0]?.workspace_id ?? null;
  } catch {
    return null;
  }
}

async function getRetellKeyForWorkspace(workspaceId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const wsKey = (data as { retell_workspace_id?: string | null } | null)?.retell_workspace_id?.trim();
  return wsKey || process.env.RETELL_API_KEY || null;
}

async function resolveFromNumber(retellKey: string): Promise<string | null> {
  const fromEnv = process.env.AVA_CALL_FROM_NUMBER?.trim();
  if (fromEnv) return fromEnv;
  try {
    const res = await fetch("https://api.retellai.com/list-phone-numbers", {
      headers: { Authorization: `Bearer ${retellKey}` },
    });
    if (!res.ok) return null;
    const numbers = (await res.json()) as Array<{ phone_number?: string; nickname?: string }>;
    const byNickname = (needle: string) =>
      numbers.find((n) => (n.nickname ?? "").toLowerCase().includes(needle))?.phone_number ?? null;
    return (
      byNickname("ava webee booking") ??
      byNickname("ava") ??
      numbers[0]?.phone_number ??
      null
    );
  } catch {
    return null;
  }
}

// ── Step 1: create request + send OTP ────────────────────────────────────────

export async function createAvaCallRequest(input: {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  consent?: unknown;
  ip: string | null;
  userAgent: string | null;
}): Promise<
  | { ok: true; requestId: string; channel: OtpChannel; fallback: boolean }
  | { ok: false; error: string; status: number; code?: string }
> {
  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim().slice(0, 120) || null;
  const website = String(input.website ?? "").trim().slice(0, 300) || null;

  if (input.consent !== true) {
    return { ok: false, error: "Please confirm you agree to receive a call from Ava.", status: 422 };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: "A valid email is required.", status: 422 };
  }
  const phone = normalizePhoneE164(String(input.phone ?? ""));
  if (!phone) {
    return { ok: false, error: "A valid phone number with country code is required (e.g. +44…).", status: 422 };
  }
  if (!isAllowedCountry(phone)) {
    return { ok: false, error: "Sorry, Ava can't call that region yet. Use the Talk to Us form instead.", status: 422 };
  }

  // Provider check happens BEFORE any row is created so an unconfigured
  // environment fails fast with a clear, user-actionable message.
  const provider = detectOtpProvider();
  if (provider.channel === "none") {
    console.error("[AVA-CALL] No OTP provider configured (Twilio Verify / Twilio SMS / Resend all missing)");
    return {
      ok: false,
      error: "Verification is not configured yet. Please book a demo instead.",
      status: 503,
      code: "no_provider",
    };
  }

  const workspaceId = await resolveAdminWorkspaceId();
  if (!workspaceId) {
    console.error("[AVA-CALL] Admin workspace not resolvable");
    return { ok: false, error: "Service temporarily unavailable.", status: 503 };
  }

  // Per-phone daily cap (calls actually triggered)
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: phoneCount } = await supabaseAdmin
    .from("ava_call_requests")
    .select("id", { count: "exact", head: true })
    .eq("phone", phone)
    .gte("created_at", dayAgo)
    .not("retell_call_id", "is", null);
  if ((phoneCount ?? 0) >= PER_PHONE_DAILY_CAP) {
    return { ok: false, error: "This number has already received Ava calls today. Please try again tomorrow.", status: 429 };
  }

  // Per-email daily cap (calls actually triggered)
  const { count: emailCount } = await supabaseAdmin
    .from("ava_call_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", dayAgo)
    .not("retell_call_id", "is", null);
  if ((emailCount ?? 0) >= PER_EMAIL_DAILY_CAP) {
    return { ok: false, error: "This email has already received Ava calls today. Please try again tomorrow.", status: 429 };
  }

  // Global daily cap on triggered calls
  const { count: globalCount } = await supabaseAdmin
    .from("ava_call_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", dayAgo)
    .not("retell_call_id", "is", null);
  if ((globalCount ?? 0) >= GLOBAL_DAILY_CAP) {
    return { ok: false, error: "Ava is fully booked with calls today. Please try again tomorrow.", status: 429 };
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("ava_call_requests")
    .insert({
      workspace_id: workspaceId,
      full_name: name,
      email,
      phone,
      website,
      status: "pending_verification",
      ip_address: input.ip,
      user_agent: input.userAgent?.slice(0, 300) ?? null,
    } as never)
    .select("id")
    .single();
  if (insertErr || !created) {
    console.error("[AVA-CALL] Request insert failed", insertErr?.message);
    return { ok: false, error: "Could not create request.", status: 500 };
  }

  const requestId = (created as { id: string }).id;
  // Dev test mode uses a fixed local code; Twilio Verify manages the code on
  // Twilio's side (no local hash); every other channel gets a random local OTP.
  const otp = isOtpDevMode() ? getOtpDevCode() : String(randomInt(100000, 1000000));

  const sendResult = await sendOtp({
    provider,
    phone,
    email,
    name,
    otp,
    expiryMinutes: OTP_EXPIRY_MINUTES,
  });
  if (!sendResult.success) {
    console.error("[AVA-CALL] OTP send failed", { channel: sendResult.channel, error: sendResult.error });
    await supabaseAdmin
      .from("ava_call_requests")
      .update({ status: "failed", call_outcome: { reason: "otp_send_failed" }, updated_at: new Date().toISOString() } as never)
      .eq("id", requestId);
    return { ok: false, error: "Could not send the verification code. Please try again.", status: 502 };
  }

  // Store the local OTP hash unless Twilio Verify holds the code.
  const usesTwilioVerify = sendResult.channel === "twilio_verify";
  await supabaseAdmin
    .from("ava_call_requests")
    .update({
      otp_hash: usesTwilioVerify ? null : hashOtp(requestId, otp),
      otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", requestId);

  console.log("[AVA-CALL] Request created, OTP sent", {
    requestId,
    channel: sendResult.channel,
    fallback: sendResult.fallback,
  });
  return { ok: true, requestId, channel: sendResult.channel, fallback: sendResult.fallback };
}

// ── Step 2: verify OTP + trigger the Retell call ─────────────────────────────

export async function verifyAvaCallOtpAndTrigger(input: {
  requestId?: string;
  otp?: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const requestId = String(input.requestId ?? "").trim();
  const otp = String(input.otp ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^\d{6}$/.test(otp)) {
    return { ok: false, error: "Invalid verification details.", status: 422 };
  }

  const { data: row } = await supabaseAdmin
    .from("ava_call_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  const request = row as AvaCallRequestRow | null;
  if (!request) return { ok: false, error: "Invalid verification details.", status: 422 };
  if (request.status !== "pending_verification") {
    return { ok: false, error: "This request has already been used.", status: 409 };
  }
  if (request.otp_attempts >= MAX_OTP_ATTEMPTS) {
    return { ok: false, error: "Too many attempts. Please request a new call.", status: 429 };
  }
  if (!request.otp_expires_at || Date.parse(request.otp_expires_at) < Date.now()) {
    return { ok: false, error: "This code has expired. Please request a new call.", status: 410 };
  }

  await supabaseAdmin
    .from("ava_call_requests")
    .update({ otp_attempts: request.otp_attempts + 1, updated_at: new Date().toISOString() } as never)
    .eq("id", requestId);

  if (request.otp_hash) {
    // Local OTP check (email / SMS / dev channels).
    if (hashOtp(requestId, otp) !== request.otp_hash) {
      return { ok: false, error: "That code doesn't match. Please check and try again.", status: 401 };
    }
  } else if (detectOtpProvider().managedByTwilioVerify) {
    // No local hash → the code lives in Twilio Verify; delegate the check.
    const check = await checkTwilioVerifyCode(request.phone, otp);
    if (!check.success) {
      return { ok: false, error: "That code doesn't match. Please check and try again.", status: 401 };
    }
  } else {
    // No local hash and no Twilio Verify (e.g. provider config changed
    // between request and verify) — treat as expired, ask for a new request.
    return { ok: false, error: "This code has expired. Please request a new call.", status: 410 };
  }

  // OTP verified — atomically claim the request so two concurrent verifies
  // can't both trigger a call (conditional transition away from pending).
  const { data: claimed } = await supabaseAdmin
    .from("ava_call_requests")
    .update({ status: "call_triggering", updated_at: new Date().toISOString() } as never)
    .eq("id", requestId)
    .eq("status", "pending_verification")
    .select("id");
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: "This request has already been used.", status: 409 };
  }

  const failClaim = async (reason: string) => {
    await supabaseAdmin
      .from("ava_call_requests")
      .update({ status: "failed", call_outcome: { reason }, updated_at: new Date().toISOString() } as never)
      .eq("id", requestId);
  };

  // Trigger the outbound Retell call.
  const retellKey = await getRetellKeyForWorkspace(request.workspace_id);
  if (!retellKey) {
    console.error("[AVA-CALL] No Retell key for workspace", request.workspace_id);
    await failClaim("no_retell_key");
    return { ok: false, error: "Calling is temporarily unavailable.", status: 503 };
  }
  const fromNumber = await resolveFromNumber(retellKey);
  if (!fromNumber) {
    console.error("[AVA-CALL] No from_number available");
    await failClaim("no_from_number");
    return { ok: false, error: "Calling is temporarily unavailable.", status: 503 };
  }

  const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${retellKey}` },
    body: JSON.stringify({
      from_number: fromNumber,
      to_number: request.phone,
      override_agent_id: AVA_LIVE_AGENT_ID,
      retell_llm_dynamic_variables: {
        lead_source: "homepage_ava_call",
        enquiry_type: "ava_live_demo",
        cta_source: "call_ava_now",
        customer_name: request.full_name ?? "",
        email: request.email,
        phone_number: request.phone,
        business_website: request.website ?? "",
      },
      metadata: { ava_call_request_id: requestId },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[AVA-CALL] create-phone-call failed", res.status, body.slice(0, 400));
    await supabaseAdmin
      .from("ava_call_requests")
      .update({ status: "failed", call_outcome: { reason: "call_trigger_failed" }, updated_at: new Date().toISOString() } as never)
      .eq("id", requestId);
    return { ok: false, error: "We couldn't start the call. Please try again shortly.", status: 502 };
  }
  const retellCall = (await res.json()) as { call_id?: string };

  await supabaseAdmin
    .from("ava_call_requests")
    .update({
      status: "ava_call_requested",
      retell_call_id: retellCall.call_id ?? null,
      from_number: fromNumber,
      otp_hash: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", requestId);

  console.log("[AVA-CALL] Call triggered", { requestId, callId: retellCall.call_id });
  return { ok: true };
}

/**
 * Verify variant for clients that don't hold a requestId (e.g. the main
 * Webespoke marketing site sends only { email, phone, otp }): resolve the most
 * recent pending request for that email+phone, then run the normal verify.
 */
export async function verifyAvaCallOtpByContact(input: {
  email?: string;
  phone?: string;
  otp?: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const email = String(input.email ?? "").trim().toLowerCase();
  const phone = normalizePhoneE164(String(input.phone ?? ""));
  const otp = String(input.otp ?? "").trim();
  if (!email || !phone || !/^\d{6}$/.test(otp)) {
    return { ok: false, error: "Invalid verification details.", status: 422 };
  }

  const { data } = await supabaseAdmin
    .from("ava_call_requests")
    .select("id")
    .eq("email", email)
    .eq("phone", phone)
    .eq("status", "pending_verification")
    .order("created_at", { ascending: false })
    .limit(1);
  const requestId = ((data ?? []) as Array<{ id: string }>)[0]?.id;
  if (!requestId) {
    return { ok: false, error: "This code has expired. Please request a new call.", status: 410 };
  }
  return verifyAvaCallOtpAndTrigger({ requestId, otp });
}

// ── Webhook integration ──────────────────────────────────────────────────────

/** Find the (unprocessed or processed) request behind a Retell call, if any. */
export async function findAvaCallRequestByCallId(callId: string): Promise<AvaCallRequestRow | null> {
  if (!callId) return null;
  const { data } = await supabaseAdmin
    .from("ava_call_requests")
    .select("*")
    .eq("retell_call_id", callId)
    .maybeSingle();
  return (data as AvaCallRequestRow | null) ?? null;
}

/**
 * Atomically claim the request for terminal processing. Returns the claimed row
 * or null if it was already processed (idempotency for webhook re-fires).
 */
async function claimAvaCallRequest(callId: string): Promise<AvaCallRequestRow | null> {
  const { data, error } = await supabaseAdmin
    .from("ava_call_requests")
    .update({ processed_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never)
    .eq("retell_call_id", callId)
    .is("processed_at", null)
    .select("*");
  if (error) {
    console.error("[AVA-CALL] Claim failed", error.message);
    return null;
  }
  const rows = (data ?? []) as AvaCallRequestRow[];
  return rows[0] ?? null;
}

function mapSentiment(value?: string | null): "positive" | "neutral" | "negative" | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("positive")) return "positive";
  if (lower.includes("negative")) return "negative";
  if (lower.includes("neutral")) return "neutral";
  return null;
}

type AvaAnalyzedCall = {
  call_id?: string;
  transcript?: string;
  recording_url?: string;
  disconnection_reason?: string;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    in_voicemail?: boolean;
    custom_analysis_data?: Record<string, unknown>;
  };
};

/**
 * Terminal processing on call_analyzed for a homepage Ava call.
 * Creates/updates a lead ONLY when appointment booked AND sentiment
 * positive/neutral. Idempotent via the atomic claim on processed_at.
 */
export async function processAvaCallAnalyzed(call: AvaAnalyzedCall, isNoAnswerCall: boolean): Promise<void> {
  const callId = call.call_id ?? "";
  const request = await claimAvaCallRequest(callId);
  if (!request) {
    console.log("[AVA-CALL] call_analyzed already processed or no request", { callId });
    return;
  }

  const custom = (call.call_analysis?.custom_analysis_data ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null;

  const bookingStatus = str(custom.booking_status);
  const bookingSlot = str(custom.booking_slot);
  const sentiment = mapSentiment(call.call_analysis?.user_sentiment);
  const booked = bookingStatus === "booked" || custom.appointment_booked === true;

  const outcome: Record<string, unknown> = {
    booking_status: bookingStatus,
    booking_slot: bookingSlot,
    sentiment,
    no_answer: isNoAnswerCall,
    call_summary: call.call_analysis?.call_summary ?? null,
    recording_url: call.recording_url ?? null,
    disconnection_reason: call.disconnection_reason ?? null,
    industry: str(custom.industry),
    interest: str(custom.interest),
    budget: str(custom.budget),
  };

  const finish = async (status: string, leadId: string | null = null) => {
    await supabaseAdmin
      .from("ava_call_requests")
      .update({ status, lead_id: leadId, call_outcome: outcome, updated_at: new Date().toISOString() } as never)
      .eq("id", request.id);
    console.log("[AVA-CALL] Request finalized", { requestId: request.id, status, leadId });
  };

  if (isNoAnswerCall) return finish("completed_no_lead");
  if (booked && !sentiment) return finish("needs_review");
  if (!booked || sentiment === "negative") return finish("completed_no_lead");

  // ── Booked + positive/neutral → create or promote the lead ────────────────
  const workspaceId = request.workspace_id;
  const now = new Date().toISOString();
  const email = (str(custom.email) ?? request.email).toLowerCase();
  const phone = str(custom.phone_number) ?? request.phone;
  const digits = (s: string) => s.replace(/\D/g, "");

  type ExistingLead = { id: string; full_name: string | null; status: string; meta: Record<string, unknown> | null; email: string | null; phone: string | null };
  let existing: ExistingLead | null = null;
  {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, status, meta, email, phone")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .maybeSingle();
    existing = data as ExistingLead | null;
  }
  if (!existing) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, status, meta, email, phone")
      .eq("workspace_id", workspaceId)
      .eq("phone", phone)
      .maybeSingle();
    existing = data as ExistingLead | null;
  }
  if (!existing) {
    const { data: candidates } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, status, meta, email, phone")
      .eq("workspace_id", workspaceId)
      .limit(500);
    existing =
      ((candidates ?? []) as ExistingLead[]).find(
        (l) => l.phone && digits(l.phone) === digits(phone),
      ) ?? null;
  }

  const metaPatch: Record<string, unknown> = {
    appointment_booked: true,
    booking_slot: bookingSlot,
    booking_status: bookingStatus,
    cta_source: "call_ava_now",
    preferred_contact: "phone",
    enquiry_type: "ava_live_demo",
    ava_call_request_id: request.id,
    retell_call_id: callId,
    recording_url: call.recording_url ?? null,
    website: request.website,
    industry: str(custom.industry),
    interest: str(custom.interest),
    budget: str(custom.budget),
  };

  let leadId: string | null = null;
  if (existing) {
    // Never override a Do-Not-Call flag — capture the booking details but keep
    // the compliance status untouched.
    const isDnc = existing.status === "do_not_call";
    const patch: Record<string, unknown> = {
      // Promote to qualified — never demote an already-qualified lead.
      ...(isDnc ? {} : { status: "qualified" }),
      source_type: "homepage_ava_call",
      source_detail: "call_ava_now",
      sentiment,
      call_summary: call.call_analysis?.call_summary ?? null,
      last_contacted_at: now,
      updated_at: now,
      meta: { ...(existing.meta ?? {}), ...metaPatch },
      ...(request.full_name && !existing.full_name ? { full_name: request.full_name } : {}),
      ...(email && !existing.email ? { email } : {}),
      ...(phone && !existing.phone ? { phone } : {}),
    };
    const { error } = await supabaseAdmin.from("leads").update(patch as never).eq("id", existing.id);
    if (error) {
      console.error("[AVA-CALL] Lead promote failed", error.message);
      return finish("needs_review");
    }
    leadId = existing.id;
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("leads")
      .insert({
        workspace_id: workspaceId,
        full_name: request.full_name ?? email,
        email,
        phone,
        status: "qualified",
        source: toLeadSourceEnum("webee_website_form"),
        source_type: "homepage_ava_call",
        source_detail: "call_ava_now",
        sentiment,
        call_summary: call.call_analysis?.call_summary ?? null,
        qualification_status: "qualified",
        last_contacted_at: now,
        created_at: now,
        updated_at: now,
        meta: metaPatch,
      } as never)
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("[AVA-CALL] Lead create failed", error?.message);
      return finish("needs_review");
    }
    leadId = (inserted as { id: string }).id;
  }

  // Best-effort note + admin notification — never fail processing over these.
  try {
    await supabaseAdmin.from("entity_notes").insert({
      workspace_id: workspaceId,
      entity_type: "lead",
      entity_id: leadId,
      body: `Booked an appointment through Ava live call from the homepage (Call Ava Now).${bookingSlot ? ` Slot: ${bookingSlot}.` : ""}`,
      created_at: now,
    } as never);
  } catch { /* best-effort */ }
  try {
    await sendResendEmail({
      to: WEBEE_ADMIN_EMAIL,
      subject: `Ava booked a demo: ${request.full_name ?? email}`,
      html: renderBasicEmail({
        heading: "New appointment booked by Ava",
        bodyHtml: `
          <p style="font-size:14px;color:#c8c8d8">${escapeHtml(request.full_name ?? "A visitor")} requested a call from the homepage and booked an appointment.</p>
          <p style="font-size:13px;color:#c8c8d8">Email: ${escapeHtml(email)}<br/>Phone: ${escapeHtml(phone)}${bookingSlot ? `<br/>Slot: ${escapeHtml(bookingSlot)}` : ""}</p>`,
      }),
    });
  } catch { /* best-effort */ }

  return finish("completed_lead_created", leadId);
}

/** Mark a homepage Ava call failed (call_failed webhook) — no lead is created. */
export async function markAvaCallFailed(callId: string, reason: string | null): Promise<void> {
  const request = await claimAvaCallRequest(callId);
  if (!request) return;
  await supabaseAdmin
    .from("ava_call_requests")
    .update({
      status: "failed",
      call_outcome: { reason: reason ?? "call_failed" },
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", request.id);
  console.log("[AVA-CALL] Request marked failed", { requestId: request.id, reason });
}
