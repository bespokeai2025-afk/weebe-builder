/**
 * Shared "send an email to a lead" path — used by the leads UI (compose /
 * send-template) and by the auto-email-on-new-lead automation.
 *
 * Sender resolution: per-workspace HexMail Resend credentials
 * (workspace_settings.hexmail_resend_*) take priority, falling back to the
 * global RESEND_API_KEY / RESEND_FROM env vars. This mirrors the fallback
 * pattern already used in hexmail/deliverability.server.ts.
 */
import { escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";
import { sendWorkspaceEmail } from "@/lib/email/email-dispatch.server";
import { splitEmailContent } from "@/lib/hexmail/vars-helpers";

export type LeadEmailTrigger = "manual_compose" | "manual_template" | "auto_new_lead";

interface ResolvedSender {
  apiKey: string;
  from: string;
  provider: "resend";
}

interface SendResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * HexMail per-workspace creds only (highest priority for lead emails).
 * All other sending goes through the Task #370 dispatch layer
 * (sendWorkspaceEmail: workspace custom → reseller parent → platform default)
 * so failure bookkeeping/fallback/alerts stay consistent.
 */
async function resolveHexmailSender(
  sb: any,
  workspaceId: string,
): Promise<ResolvedSender | null> {
  const { data } = await sb
    .from("workspace_settings")
    .select("hexmail_resend_api_key, hexmail_resend_from_email, hexmail_resend_from_name")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  // 1) HexMail per-workspace creds (existing behavior, highest priority here).
  if (data?.hexmail_resend_api_key) {
    const fromEmail = data?.hexmail_resend_from_email as string | null | undefined;
    const fromName = data?.hexmail_resend_from_name as string | null | undefined;
    const from = fromEmail
      ? (fromName ? `${fromName} <${fromEmail}>` : fromEmail)
      : (process.env.RESEND_FROM ?? "Webespoke AI <onboarding@resend.dev>");
    return { apiKey: data.hexmail_resend_api_key, from, provider: "resend" };
  }
  return null;
}

async function sendViaResend(
  sender: ResolvedSender,
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<SendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sender.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sender.from,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { success: false, error: `resend_http_${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { success: true, id: data.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function logLeadEmail(
  sb: any,
  params: {
    workspaceId: string;
    leadId: string;
    templateId?: string | null;
    trigger: LeadEmailTrigger;
    provider: string | null;
    toEmail: string;
    subject: string | null;
    status: "sent" | "failed";
    messageId?: string | null;
    error?: string | null;
    createdBy?: string | null;
  },
) {
  await sb.from("lead_email_log").insert({
    workspace_id: params.workspaceId,
    lead_id: params.leadId,
    template_id: params.templateId ?? null,
    trigger: params.trigger,
    provider: params.provider,
    to_email: params.toEmail,
    subject: params.subject,
    status: params.status,
    message_id: params.messageId ?? null,
    error: params.error ?? null,
    created_by: params.createdBy ?? null,
  });
}

/**
 * Core send routine, callable from server code (e.g. the webform automation
 * hook) without going through a TanStack server-fn / auth boundary. Always
 * resolves the sender per-workspace and logs the outcome — never throws.
 */
export async function sendEmailToLeadCore(
  sb: any,
  params: {
    workspaceId: string;
    leadId: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    trigger: LeadEmailTrigger;
    templateId?: string | null;
    createdBy?: string | null;
  },
): Promise<SendResult> {
  const html = renderBasicEmail({
    heading: params.subject,
    bodyHtml: escapeHtml(params.bodyText).replace(/\n/g, "<br/>"),
  });

  // HexMail per-workspace creds keep highest priority (existing behavior);
  // everything else goes through the dispatch layer so custom-provider
  // failure bookkeeping / fallback / admin alerts apply to lead emails too.
  const hexmail = await resolveHexmailSender(sb, params.workspaceId);
  let result: SendResult;
  let providerLabel: string;
  if (hexmail) {
    result = await sendViaResend(hexmail, params.toEmail, params.subject, html, params.bodyText);
    providerLabel = "resend";
  } else {
    const dispatched = await sendWorkspaceEmail(sb, {
      workspaceId: params.workspaceId,
      to: params.toEmail,
      subject: params.subject,
      html,
      text: params.bodyText,
    });
    result = { success: dispatched.success, id: dispatched.id, error: dispatched.error };
    providerLabel = `resend:${dispatched.providerUsed}${dispatched.fellBack ? ":fallback" : ""}`;
  }

  await logLeadEmail(sb, {
    workspaceId: params.workspaceId,
    leadId: params.leadId,
    templateId: params.templateId,
    trigger: params.trigger,
    provider: providerLabel,
    toEmail: params.toEmail,
    subject: params.subject,
    status: result.success ? "sent" : "failed",
    messageId: result.id,
    error: result.error,
    createdBy: params.createdBy,
  });

  return result;
}
export async function fetchLead(sb: any, workspaceId: string, leadId: string) {
  const { data: lead, error } = await sb
    .from("leads")
    .select("id, full_name, email, phone, company_name")
    .eq("id", leadId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !lead) throw new Error("Lead not found");
  if (!lead.email) throw new Error("This lead has no email address on file");
  return lead as { id: string; full_name: string | null; email: string; phone: string | null; company_name: string | null };
}

export interface LeadForTemplate {
  full_name: string | null;
  email: string;
  phone: string | null;
  company_name: string | null;
}

/** Render a HexMail email template's {{vars}} against a lead's own fields. */
export function renderLeadTemplateEmail(
  template: { subject: string | null; content: string },
  lead: LeadForTemplate,
): { subject: string; body: string } {
  const { body } = splitEmailContent(template.content);
  const fills: Record<string, string> = {
    full_name: lead.full_name ?? "",
    name: lead.full_name ?? "",
    email: lead.email,
    phone: lead.phone ?? "",
    company_name: lead.company_name ?? "",
  };
  const rendered = body.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_m, key) =>
    fills[key] !== undefined ? fills[key] : `{{${key}}}`,
  );
  return { subject: template.subject || "A message from us", body: rendered };
}

/**
 * Send a HexMail template to a lead, given a resolved template id + lead
 * record. Shared by the manual "send template" server fn and the auto-email
 * automation triggered from the webform pipeline. Never throws.
 */
export async function sendTemplateEmailToLeadCore(
  sb: any,
  params: {
    workspaceId: string;
    leadId: string;
    templateId: string;
    lead: LeadForTemplate;
    trigger: LeadEmailTrigger;
    createdBy?: string | null;
  },
): Promise<SendResult> {
  const { data: template, error } = await sb
    .from("hexmail_templates")
    .select("*")
    .eq("id", params.templateId)
    .eq("workspace_id", params.workspaceId)
    .eq("type", "email")
    .maybeSingle();
  if (error || !template) return { success: false, error: "Email template not found" };

  const { subject, body } = renderLeadTemplateEmail(template, params.lead);
  const result = await sendEmailToLeadCore(sb, {
    workspaceId: params.workspaceId,
    leadId: params.leadId,
    toEmail: params.lead.email,
    subject,
    bodyText: body,
    trigger: params.trigger,
    templateId: params.templateId,
    createdBy: params.createdBy,
  });

  if (result.success) {
    await sb
      .from("hexmail_templates")
      .update({ usage_count: (template.usage_count ?? 0) + 1 })
      .eq("id", params.templateId)
      .catch(() => {});
  }

  return result;
}
