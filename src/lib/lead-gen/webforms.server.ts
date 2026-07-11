// SERVER ONLY — webform lead capture processing engine.
// Handles field mapping, lead creation/deduplication, submission storage, notifications.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendResendEmail, escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";
import { sendTemplateEmailToLeadCore } from "@/lib/lead-gen/lead-email.server";
import { triggerAutoCallForNewLead } from "@/lib/qualification/auto-call.server";

export const WEBEE_ADMIN_EMAIL = "admin@webespokeai.com";

// Coerce an unknown webform value into a JSON-safe scalar (string or null).
function toJsonScalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 500);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v).slice(0, 500); } catch { return null; }
}

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

export async function checkRateLimit(
  key: string,
  maxPerWindow = 10,
  windowMs = 60_000,
): Promise<boolean> {
  try {
    const windowStart = new Date(Date.now() - windowMs).toISOString();
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

    if (data.count >= maxPerWindow) return false;

    await supabaseAdmin
      .from("webform_rate_limits")
      .update({ count: data.count + 1 })
      .eq("key", key);
    return true;
  } catch {
    return true;
  }
}

/** Parse an IPv4/IPv6 address into a fixed-width BigInt for comparison. */
function parseIpToBigInt(ip: string): { version: 4 | 6; value: bigint } | null {
  // Drop an IPv6 zone id (e.g. "fe80::1%eth0") and any surrounding brackets.
  const s = ip.trim().replace(/^\[/, "").replace(/\]$/, "").split("%")[0];
  if (!s) return null;

  if (s.includes(":")) {
    const value = parseIpv6(s);
    return value == null ? null : { version: 6, value };
  }
  if (s.includes(".")) {
    const value = parseIpv4(s);
    return value == null ? null : { version: 4, value };
  }
  return null;
}

function parseIpv4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIpv6(input: string): bigint | null {
  let s = input;

  // Expand an embedded IPv4 tail (e.g. "::ffff:1.2.3.4") into two hextets.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = parseIpv4(s.slice(lastColon + 1));
    if (v4 == null) return null;
    const h1 = (Number(v4 >> 16n) & 0xffff).toString(16);
    const h2 = Number(v4 & 0xffffn).toString(16);
    s = `${s.slice(0, lastColon + 1)}${h1}:${h2}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): string[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    }
    return groups;
  };

  const head = toGroups(halves[0]);
  if (head == null) return null;

  let groups: string[];
  if (halves.length === 2) {
    const tail = toGroups(halves[1]);
    if (tail == null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

/**
 * True when `ip` matches an allowlist `entry`. An entry may be:
 *  - an exact IPv4/IPv6 address (compared after normalization), or
 *  - a CIDR range like "2a02:c7c:6c17:f400::/64" (matches any address in range).
 * Non-IP entries fall back to a trimmed string compare.
 */
function ipMatchesAllowEntry(ip: string, entry: string): boolean {
  const slash = entry.indexOf("/");
  if (slash === -1) {
    const a = parseIpToBigInt(ip);
    const b = parseIpToBigInt(entry);
    if (a && b) return a.version === b.version && a.value === b.value;
    return ip.trim() === entry.trim();
  }

  const prefixStr = entry.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixStr)) return false;
  const prefix = Number(prefixStr);

  const addr = parseIpToBigInt(ip);
  const network = parseIpToBigInt(entry.slice(0, slash));
  if (!addr || !network || addr.version !== network.version) return false;

  const totalBits = addr.version === 4 ? 32 : 128;
  if (prefix > totalBits) return false;
  if (prefix === 0) return true;

  const shift = BigInt(totalBits - prefix);
  return addr.value >> shift === network.value >> shift;
}

/**
 * Developer/testing bypass for public rate limits.
 *
 * Returns true when rate limiting should be skipped for this caller:
 *  - always in the development environment (only the developer hits the dev
 *    server, so testing shouldn't be throttled), or
 *  - when the caller IP matches an entry in the RATE_LIMIT_ALLOWLIST_IPS env var
 *    (comma-separated) — use this to test against the live deployment. Each entry
 *    may be an exact IPv4/IPv6 address or a CIDR range (e.g.
 *    "2a02:c7c:6c17:f400::/64"). A /64 range is recommended for residential IPv6
 *    since ISPs rotate the address suffix.
 *
 * Never bypasses for normal visitors in production.
 */
export function isRateLimitExempt(ip: string | null): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const raw = process.env.RATE_LIMIT_ALLOWLIST_IPS;
  if (!raw || !ip) return false;

  const allowlist = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return allowlist.some((entry) => ipMatchesAllowEntry(ip, entry));
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

// leads.source is a Postgres enum (lead_source); source_type is free text.
// Never write an unvalidated value into the enum column — Postgres rejects
// the whole row with "invalid input value for enum lead_source".
const LEAD_SOURCE_ENUM_VALUES = new Set([
  "website", "inbound", "outbound", "referral", "import",
  "website_form", "landing_page", "facebook_lead_form", "google_ads_lead_form",
  "tiktok_lead_form", "linkedin_lead_form", "zapier", "make", "custom_form",
  "webee_website_form", "api",
]);
export function toLeadSourceEnum(sourceType: string, fallback = "website_form"): string {
  return LEAD_SOURCE_ENUM_VALUES.has(sourceType) ? sourceType : fallback;
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
    try {
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
      });
    } catch { /* best-effort */ }
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
        status:         "need_to_call",
        source:         toLeadSourceEnum(sourceType),
        source_type:    sourceType,
        source_detail:  sourceDetail,
        source_page:    utm.source_page,
        utm_source:     utm.utm_source,
        utm_medium:     utm.utm_medium,
        utm_campaign:   utm.utm_campaign,
        referrer:       utm.referrer,
        meta:           {
          website:            mapped.website ?? null,
          preferred_contact:  toJsonScalar(raw.preferred_contact_method ?? raw.preferred_contact),
          interested_in:      toJsonScalar(raw.interested_in),
          webform_source:     formName,
          ...Object.fromEntries(
            Object.entries(raw)
              .filter(([k]) => !["name","full_name","first_name","last_name","email",
                "email_address","phone","mobile","phone_number","company","company_name",
                "message","notes","enquiry","website","website_url","utm_source",
                "utm_medium","utm_campaign","referrer","source_page","_hp","fax","url2","address2",
              ].includes(k.toLowerCase()))
              .filter(([k]) => /^[a-zA-Z0-9_-]{1,64}$/.test(k))
              .slice(0, 20)
              .map(([k, v]) => [k, String(v ?? "").slice(0, 500)])
          ),
        },
      })
      .select("id")
      .single();
    if (error) return { ok: false, status: "failed", error: error.message };
    leadId = newLead!.id;
  }

  // Add note to entity notes (best-effort — never fail the submission over it)
  try {
    const { error: noteError } = await supabaseAdmin.from("entity_notes").insert({
      workspace_id: workspaceId,
      entity_type:  "lead",
      entity_id:    leadId,
      body:         `Lead ${leadStatus === "created" ? "created" : "updated"} from webform: ${formName}${sourceDetail ? ` (${sourceDetail})` : ""}`,
      created_at:   new Date().toISOString(),
    });
    if (noteError) console.error("[WEBFORM] entity_notes insert failed:", noteError.message);
  } catch { /* best-effort */ }

  // Store submission record
  let submission: { id: string } | null = null;
  try {
    const { data, error: submissionError } = await supabaseAdmin
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
      .single();
    if (submissionError) console.error("[WEBFORM] webform_submissions insert failed:", submissionError.message);
    submission = data;
  } catch { submission = null; }

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

  // Auto-email automation: if this is a brand-new lead whose preferred contact
  // method is "email" (set on creation only — never on update), and the
  // workspace has auto-email enabled with a template chosen, send it.
  // Best-effort — never fails the webform submission over an email problem.
  if (leadStatus === "created" && email) {
    const preferredContact = String(
      raw.preferred_contact_method ?? raw.preferred_contact ?? "",
    ).toLowerCase().trim();
    if (preferredContact === "email") {
      try {
        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("lead_auto_email_enabled, lead_auto_email_template_id")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (ws?.lead_auto_email_enabled && ws?.lead_auto_email_template_id) {
          await sendTemplateEmailToLeadCore(supabaseAdmin, {
            workspaceId,
            leadId,
            templateId: ws.lead_auto_email_template_id as string,
            lead: {
              full_name: full_name ?? null,
              email,
              phone: phone ?? null,
              company_name: mapped.company_name ?? null,
            },
            trigger: "auto_new_lead",
          });
        }
      } catch (e) {
        console.error("[WEBFORM] auto-email automation failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  // Auto-call automation: if this is a brand-new lead and the workspace has
  // lead auto-call enabled with a configured agent, place an outbound
  // qualification call. Best-effort — triggerAutoCallForNewLead never
  // throws, so this never fails the webform submission.
  if (leadStatus === "created") {
    await triggerAutoCallForNewLead(supabaseAdmin, { workspaceId, leadId });
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
    try {
      const { data: ws } = await supabaseAdmin
        .from("workspace_members")
        .select("workspace_id, users!inner(email)")
        .eq("users.email", WEBEE_ADMIN_EMAIL)
        .limit(1)
        .single();
      workspaceId = ws?.workspace_id ?? null;
    } catch { workspaceId = null; }
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
