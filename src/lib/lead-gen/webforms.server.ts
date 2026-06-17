// SERVER ONLY — webform lead capture processing engine.
// Handles field mapping, lead creation/deduplication, submission storage, notifications.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendResendEmail, escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";

export const WEBEE_ADMIN_EMAIL = "admin@webespokeai.com";

// ── Field mapping helpers ──────────────────────────────────────────────────────

const DEFAULT_FIELD_MAP: Record<string, string> = {
  name:           "full_name",
  full_name:      "full_name",
  first_name:     "full_name",
  email:          "email",
  email_address:  "email",
  phone:          "phone",
  mobile:         "phone",
  phone_number:   "phone",
  company:        "company_name",
  company_name:   "company_name",
  organisation:   "company_name",
  website:        "website",
  website_url:    "website",
  message:        "notes",
  notes:          "notes",
  enquiry:        "notes",
  comment:        "notes",
  source:         "source",
  source_page:    "source_page",
  interested_in:  "notes",
};

function mapPayload(
  raw: Record<string, unknown>,
  customMapping: Record<string, string> = {},
): Record<string, string> {
  const merged = { ...DEFAULT_FIELD_MAP, ...customMapping };
  const out: Record<string, string> = {};
  for (const [inKey, value] of Object.entries(raw)) {
    const target = merged[inKey.toLowerCase().replace(/[^a-z0-9_]/g, "_")] ?? null;
    if (target && value != null) {
      const existing = out[target];
      if (target === "full_name" && existing) {
        out[target] = `${existing} ${String(value)}`.trim();
      } else {
        out[target] = String(value).trim().slice(0, 1000);
      }
    }
  }
  return out;
}

function extractUtm(raw: Record<string, unknown>) {
  return {
    utm_source:   raw.utm_source   ? String(raw.utm_source)   : null,
    utm_medium:   raw.utm_medium   ? String(raw.utm_medium)   : null,
    utm_campaign: raw.utm_campaign ? String(raw.utm_campaign) : null,
    referrer:     raw.referrer     ? String(raw.referrer)     : null,
    source_page:  raw.source_page  ? String(raw.source_page)  : null,
  };
}

// ── Rate limiting ──────────────────────────────────────────────────────────────

export async function checkRateLimit(key: string, maxPerMinute = 10): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - 60_000).toISOString();
    const { data } = await supabaseAdmin
      .from("webform_rate_limits")
      .select("count, window_start")
      .eq("key", key)
      .maybeSingle();

    if (!data || data.window_start < windowStart) {
      await supabaseAdmin.from("webform_rate_limits").upsert({
        key, count: 1, window_start: new Date().toISOString(),
      });
      return true;
    }

    if (data.count >= maxPerMinute) return false;

    await supabaseAdmin
      .from("webform_rate_limits")
      .update({ count: data.count + 1 })
      .eq("key", key);
    return true;
  } catch {
    return true;
  }
}

// ── Honeypot check ────────────────────────────────────────────────────────────

export function isSpam(raw: Record<string, unknown>): boolean {
  const honeypot = raw.website_url ?? raw._hp ?? raw.fax ?? raw.url2 ?? raw.address2;
  return Boolean(honeypot && String(honeypot).trim() !== "");
}

// ── Domain validation ─────────────────────────────────────────────────────────

export function isDomainAllowed(
  origin: string | null,
  allowedDomains: string[],
): boolean {
  if (!allowedDomains.length) return true;
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname.replace(/^www\./, "");
    return allowedDomains.some((d) =>
      host === d.replace(/^www\./, "") || host.endsWith(`.${d.replace(/^www\./, "")}`),
    );
  } catch {
    return true;
  }
}

// ── Core submission processor ─────────────────────────────────────────────────

export interface ProcessSubmissionResult {
  ok: boolean;
  leadId?: string;
  submissionId?: string;
  status: "created" | "updated" | "duplicate" | "failed" | "spam";
  error?: string;
}

export async function processWebformSubmission(opts: {
  workspaceId: string;
  webformSourceId: string;
  formName: string;
  sourceType: string;
  sourceDetail: string | null;
  notifyEmail: string | null;
  fieldMapping: Record<string, string>;
  raw: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  origin: string | null;
}): Promise<ProcessSubmissionResult> {
  const {
    workspaceId, webformSourceId, formName, sourceType, sourceDetail,
    notifyEmail, fieldMapping, raw, ip, userAgent, origin,
  } = opts;

  // Spam check
  if (isSpam(raw)) {
    await supabaseAdmin.from("webform_submissions").insert({
      workspace_id: workspaceId,
      webform_source_id: webformSourceId,
      source_type: sourceType,
      source_detail: sourceDetail,
      raw_payload: raw,
      mapped_payload: {},
      ip_address: ip,
      user_agent: userAgent,
      status: "spam",
    }).catch(() => {});
    return { ok: false, status: "spam", error: "Spam detected" };
  }

  const mapped = mapPayload(raw, fieldMapping);
  const utm = extractUtm(raw);

  const email     = mapped.email ?? null;
  const phone     = mapped.phone ?? null;
  const full_name = mapped.full_name ?? null;

  if (!email && !phone) {
    return { ok: false, status: "failed", error: "email_or_phone_required" };
  }

  // Duplicate check by email or phone
  let existingLead: any = null;
  if (email) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, status")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .maybeSingle();
    existingLead = data;
  }
  if (!existingLead && phone) {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("id, full_name, status")
      .eq("workspace_id", workspaceId)
      .eq("phone", phone)
      .maybeSingle();
    existingLead = data;
  }

  let leadId: string;
  let leadStatus: "created" | "updated" | "duplicate" = "created";

  if (existingLead) {
    leadId = existingLead.id;
    leadStatus = "updated";
    await supabaseAdmin
      .from("leads")
      .update({
        ...(full_name && !existingLead.full_name ? { full_name } : {}),
        source_type:    sourceType,
        source_detail:  sourceDetail,
        source_page:    utm.source_page,
        utm_source:     utm.utm_source,
        utm_medium:     utm.utm_medium,
        utm_campaign:   utm.utm_campaign,
        referrer:       utm.referrer,
        updated_at:     new Date().toISOString(),
      })
      .eq("id", leadId);
  } else {
    const { data: newLead, error } = await supabaseAdmin
      .from("leads")
      .insert({
        workspace_id:   workspaceId,
        full_name:      full_name ?? email ?? phone ?? "Webform Lead",
        email:          email,
        phone:          phone ?? "",
        company_name:   mapped.company_name ?? null,
        notes:          mapped.notes ?? null,
        status:         "new",
        source:         sourceType,
        source_type:    sourceType,
        source_detail:  sourceDetail,
        source_page:    utm.source_page,
        utm_source:     utm.utm_source,
        utm_medium:     utm.utm_medium,
        utm_campaign:   utm.utm_campaign,
        referrer:       utm.referrer,
        meta:           {
          website:            mapped.website ?? null,
          preferred_contact:  raw.preferred_contact_method ?? raw.preferred_contact ?? null,
          interested_in:      raw.interested_in ?? null,
          webform_source:     formName,
          ...Object.fromEntries(
            Object.entries(raw)
              .filter(([k]) => !["name","full_name","first_name","last_name","email",
                "email_address","phone","mobile","phone_number","company","company_name",
                "message","notes","enquiry","website","website_url","utm_source",
                "utm_medium","utm_campaign","referrer","source_page","_hp","fax","url2","address2",
              ].includes(k.toLowerCase()))
              .map(([k, v]) => [k, String(v ?? "").slice(0, 500)])
          ),
        },
      })
      .select("id")
      .single();
    if (error) return { ok: false, status: "failed", error: error.message };
    leadId = newLead!.id;
  }

  // Add note to entity notes
  await supabaseAdmin.from("entity_notes").insert({
    workspace_id: workspaceId,
    entity_type:  "lead",
    entity_id:    leadId,
    content:      `Lead ${leadStatus === "created" ? "created" : "updated"} from webform: ${formName}${sourceDetail ? ` (${sourceDetail})` : ""}`,
    created_at:   new Date().toISOString(),
  }).catch(() => {});

  // Store submission record
  const { data: submission } = await supabaseAdmin
    .from("webform_submissions")
    .insert({
      workspace_id:     workspaceId,
      webform_source_id: webformSourceId,
      lead_id:          leadId,
      source_type:      sourceType,
      source_detail:    sourceDetail,
      raw_payload:      raw,
      mapped_payload:   { ...mapped, ...utm },
      utm_source:       utm.utm_source,
      utm_medium:       utm.utm_medium,
      utm_campaign:     utm.utm_campaign,
      referrer:         utm.referrer,
      ip_address:       ip,
      user_agent:       userAgent,
      status:           leadStatus === "updated" ? "duplicate" : "processed",
    })
    .select("id")
    .single()
    .catch(() => ({ data: null }));

  // Send notification email
  if (notifyEmail) {
    const rows = Object.entries(mapped)
      .filter(([, v]) => v)
      .map(([k, v]) => `<tr><td style="padding:4px 8px 4px 0;color:#9999aa;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(k.replace(/_/g," "))}</td><td style="padding:4px 0;font-size:13px;color:#e8e8f0">${escapeHtml(v)}</td></tr>`)
      .join("");
    const utmRows = [
      utm.utm_source   && `<tr><td style="padding:2px 8px 2px 0;color:#9999aa;font-size:12px">UTM Source</td><td style="font-size:12px;color:#c8c8d8">${escapeHtml(utm.utm_source)}</td></tr>`,
      utm.utm_campaign && `<tr><td style="padding:2px 8px 2px 0;color:#9999aa;font-size:12px">UTM Campaign</td><td style="font-size:12px;color:#c8c8d8">${escapeHtml(utm.utm_campaign)}</td></tr>`,
      utm.source_page  && `<tr><td style="padding:2px 8px 2px 0;color:#9999aa;font-size:12px">Page</td><td style="font-size:12px;color:#c8c8d8">${escapeHtml(utm.source_page)}</td></tr>`,
    ].filter(Boolean).join("");

    const html = renderBasicEmail({
      heading: `New webform lead — ${escapeHtml(formName)}`,
      bodyHtml: `
        <p style="margin:0 0 16px">A new lead was captured from <strong>${escapeHtml(formName)}</strong>.</p>
        <table style="border-collapse:collapse;width:100%">${rows}</table>
        ${utmRows ? `<hr style="border:none;border-top:1px solid #2a2a36;margin:16px 0"><table style="border-collapse:collapse;width:100%">${utmRows}</table>` : ""}
      `,
    });
    await sendResendEmail({
      to: notifyEmail,
      subject: `New webform lead: ${full_name ?? email ?? phone ?? "Unknown"} — ${formName}`,
      html,
    }).catch(() => {});
  }

  return { ok: true, leadId, submissionId: submission?.id, status: leadStatus };
}

// ── WEBEE "Talk to Us" internal contact form ──────────────────────────────────

export async function processContactForm(fields: {
  name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  website?: string;
  interested_in?: string;
  message?: string;
  preferred_contact_method?: string;
  source_page?: string;
  utm_source?: string;
  utm_campaign?: string;
  utm_medium?: string;
}, meta: { ip: string | null; userAgent: string | null }): Promise<{ ok: boolean; error?: string }> {
  // Find WEBEE admin workspace
  const adminWorkspaceId = process.env.WEBEE_ADMIN_WORKSPACE_ID ?? null;
  let workspaceId: string | null = adminWorkspaceId;

  if (!workspaceId) {
    const { data: ws } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id, users!inner(email)")
      .eq("users.email", WEBEE_ADMIN_EMAIL)
      .limit(1)
      .single()
      .catch(() => ({ data: null }));
    workspaceId = ws?.workspace_id ?? null;
  }

  if (!workspaceId) {
    // Fallback: just send the notification email without creating a lead
    const html = renderBasicEmail({
      heading: "New Talk to Us enquiry",
      bodyHtml: `<pre style="font-size:13px;color:#c8c8d8;white-space:pre-wrap">${escapeHtml(JSON.stringify(fields, null, 2))}</pre>`,
    });
    await sendResendEmail({
      to: WEBEE_ADMIN_EMAIL,
      subject: `Talk to Us: ${escapeHtml(fields.name ?? fields.email ?? "Unknown")}`,
      html,
    });
    return { ok: true };
  }

  // Find or create a "Talk to Us" webform source in admin workspace
  let { data: wfSource } = await supabaseAdmin
    .from("webform_sources")
    .select("id, form_token")
    .eq("workspace_id", workspaceId)
    .eq("default_source_type", "webee_website_form")
    .maybeSingle();

  if (!wfSource) {
    const { data: created } = await supabaseAdmin
      .from("webform_sources")
      .insert({
        workspace_id:         workspaceId,
        name:                 "WEBEE Talk to Us",
        status:               "active",
        default_source_type:  "webee_website_form",
        default_source_detail: "talk_to_us",
        notify_email:         WEBEE_ADMIN_EMAIL,
      })
      .select("id, form_token")
      .single();
    wfSource = created;
  }

  if (!wfSource) return { ok: false, error: "failed_to_init_form" };

  const result = await processWebformSubmission({
    workspaceId,
    webformSourceId: wfSource.id,
    formName: "WEBEE Talk to Us",
    sourceType: "webee_website_form",
    sourceDetail: "talk_to_us",
    notifyEmail: WEBEE_ADMIN_EMAIL,
    fieldMapping: {},
    raw: { ...fields },
    ip: meta.ip,
    userAgent: meta.userAgent,
    origin: null,
  });

  return { ok: result.ok, error: result.error };
}
