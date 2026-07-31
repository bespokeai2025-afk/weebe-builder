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
    email,
    phone_number: phone,
    ip: input.ip,
  };
  // Drop nulls to keep the payload lean.
  for (const k of Object.keys(metadata)) if (metadata[k] == null) delete metadata[k];

  const res = await fetch("https://api.retellai.com/v2/create-web-call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${retellKey}` },
    body: JSON.stringify({
      agent_id: AVA_LIVE_AGENT_ID,
      metadata,
      retell_llm_dynamic_variables: {
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
  transcript?: string;
  recording_url?: string;
  disconnection_reason?: string;
  metadata?: Record<string, unknown>;
  call_analysis?: {
    call_summary?: string;
    user_sentiment?: string;
    custom_analysis_data?: Record<string, unknown>;
  };
};

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
  const bookingStatus = str(custom.booking_status);
  const bookingSlot = str(custom.booking_slot);
  const bookingUid =
    str(custom.booking_uid) ?? str(custom.cal_booking_uid) ?? str(custom.booking_id) ?? null;
  const booked = bookingStatus === "booked" || truthy(custom.appointment_booked) || !!bookingUid;
  const explicitRequest =
    truthy(custom.requested_follow_up) ||
    truthy(custom.follow_up_requested) ||
    truthy(custom.requested_demo) ||
    truthy(custom.wants_demo) ||
    truthy(custom.requested_quote) ||
    truthy(custom.requested_trial) ||
    truthy(custom.requested_human) ||
    truthy(custom.callback_requested);
  const qualifiedFlag =
    truthy(custom.qualified) ||
    truthy(custom.lead_qualified) ||
    str(custom.qualification_status)?.toLowerCase() === "qualified" ||
    str(custom.qualification)?.toLowerCase() === "qualified";

  const shouldCreateLead =
    (booked || sentiment === "positive" || explicitRequest || qualifiedFlag) &&
    sentiment !== "negative";
  if (!shouldCreateLead) {
    console.log("[AVA-WEB-CALL] call not qualified — no lead", { callId, sentiment, booked });
    return;
  }

  // ── Contact details: post-call analysis first, session metadata fallback ──
  const email =
    (str(custom.email, 200) ?? str(meta.email, 200))?.toLowerCase() ?? null;
  const rawPhone = str(custom.phone_number, 40) ?? str(custom.phone, 40) ?? str(meta.phone_number, 40);
  const phone = rawPhone ? normalizePhoneE164(rawPhone) ?? rawPhone : null;
  const fullName = str(custom.customer_name, 120) ?? str(custom.name, 120) ?? null;

  if (!email && !phone) {
    console.warn("[AVA-WEB-CALL] Qualified call but no contact details — recording for review", { callId });
    try {
      await supabaseAdmin.from("retell_webhook_events").insert({
        event_type: "integration_error",
        retell_call_id: callId,
        workspace_id: workspaceId,
        processing_status: "error",
        error_message: "website_ava web call qualified but no email/phone captured — no lead created",
        payload: { source: "website_ava", call_id: callId, sentiment, booked },
        processed_at: new Date().toISOString(),
      } as never);
    } catch { /* best-effort */ }
    return;
  }

  const now = new Date().toISOString();
  const clickIds = extractClickIds(meta);
  const metaPatch: Record<string, unknown> = {
    retell_call_id: callId,
    cta_source: "website_ava",
    channel: "web_call",
    enquiry_type: "ava_live_demo",
    appointment_booked: booked,
    booking_status: bookingStatus,
    booking_slot: bookingSlot,
    cal_booking_uid: bookingUid,
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
        qualification_status: "qualified",
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

  // Conversion event + note + admin email — best-effort only.
  try {
    await recordConversionEvent({
      workspaceId,
      conversionName: "ava_qualified_lead",
      source: "ava_web_call",
      leadId,
      recordRef: { retell_call_id: callId, booking_slot: bookingSlot, cal_booking_uid: bookingUid },
      clickIds,
      landingUrl: sanitizeLandingUrl(meta.landing_page),
      dedupKey: `ava_web_call:${callId}`,
    });
  } catch { /* best-effort */ }
  try {
    await supabaseAdmin.from("entity_notes").insert({
      workspace_id: workspaceId,
      entity_type: "lead",
      entity_id: leadId,
      body: `Spoke to Ava live on the website (web call).${booked ? " Booked an appointment." : ""}${bookingSlot ? ` Slot: ${bookingSlot}.` : ""}${bookingUid ? ` Booking ref: ${bookingUid}.` : ""}`,
      created_at: now,
    } as never);
  } catch { /* best-effort */ }
  try {
    await sendResendEmail({
      to: WEBEE_ADMIN_EMAIL,
      subject: `Website Ava lead: ${fullName ?? email ?? phone}`,
      html: renderBasicEmail({
        heading: booked ? "Ava booked an appointment on the website" : "New lead from the website Ava live chat",
        bodyHtml: `
          <p style="font-size:14px;color:#c8c8d8">${escapeHtml(fullName ?? "A visitor")} spoke to Ava live on the website.</p>
          <p style="font-size:13px;color:#c8c8d8">${email ? `Email: ${escapeHtml(email)}<br/>` : ""}${phone ? `Phone: ${escapeHtml(phone)}<br/>` : ""}${bookingSlot ? `Slot: ${escapeHtml(bookingSlot)}<br/>` : ""}Sentiment: ${escapeHtml(sentiment ?? "unknown")}</p>`,
      }),
    });
  } catch { /* best-effort */ }

  console.log("[AVA-WEB-CALL] Lead recorded", { callId, leadId, booked, sentiment });
}
