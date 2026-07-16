/**
 * Analytics Hub — report email delivery (server-only).
 *
 * `sendAnalyticsReportEmail` delivers a stored analytics_reports row to a set of
 * recipients using the strict provider priority (spec §16):
 *   1. Workspace custom email provider — only when ACTIVE and the package
 *      includes `custom_email_provider`.
 *   2. Reseller parent custom provider — when the child inherits and the
 *      package allows (handled inside sendWorkspaceEmail).
 *   3. WEBEE admin Resend default fallback.
 *
 * Gated on the `automated_report_emails` feature. NEVER throws — failures are
 * recorded on the report row (delivery_status/delivery_error) and audited.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendWorkspaceEmail } from "@/lib/email/email-dispatch.server";
import { sendResendEmail, escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";
import { canAccessFeature } from "@/lib/packages/entitlements.server";
import { writeAccessAudit } from "@/lib/permissions/permissions.server";

export interface SendAnalyticsReportEmailResult {
  ok: boolean;
  sent: number;
  failed: number;
  providerUsed?: string;
  error?: string;
}

function renderReportHtml(report: any): string {
  const name = escapeHtml(String(report.report_name ?? "Analytics Report"));
  const summary = escapeHtml(String(report.report_summary ?? ""));
  const range =
    report.date_range_start && report.date_range_end
      ? `${escapeHtml(String(report.date_range_start).slice(0, 10))} → ${escapeHtml(
          String(report.date_range_end).slice(0, 10),
        )}`
      : "";

  const metrics = (report.metrics_json ?? {}) as Record<string, unknown>;
  const metricRows = Object.entries(metrics)
    .filter(([, v]) => typeof v === "number" || typeof v === "string")
    .slice(0, 30)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555;">${escapeHtml(k)}</td>` +
        `<td style="padding:4px 0;font-weight:600;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join("");

  const insights = Array.isArray(report.insights_json) ? report.insights_json : [];
  const insightItems = insights
    .slice(0, 20)
    .map(
      (i: any) =>
        `<li><strong>${escapeHtml(String(i?.title ?? ""))}</strong>: ${escapeHtml(
          String(i?.detail ?? ""),
        )}</li>`,
    )
    .join("");

  const recs = Array.isArray(report.recommendations_json) ? report.recommendations_json : [];
  const recItems = recs
    .slice(0, 20)
    .map(
      (r: any) =>
        `<li><strong>${escapeHtml(String(r?.action ?? ""))}</strong>${
          r?.detail ? `: ${escapeHtml(String(r.detail))}` : ""
        }</li>`,
    )
    .join("");

  const bodyHtml =
    `${summary ? `<p>${summary}</p>` : ""}` +
    `${range ? `<p style="color:#777;font-size:13px;">Period: ${range}</p>` : ""}` +
    `${metricRows ? `<h3>Key metrics</h3><table style="border-collapse:collapse;">${metricRows}</table>` : ""}` +
    `${insightItems ? `<h3>Insights</h3><ul>${insightItems}</ul>` : ""}` +
    `${recItems ? `<h3>Recommended actions</h3><ul>${recItems}</ul>` : ""}`;

  return renderBasicEmail({ heading: name, bodyHtml });
}

/**
 * Send a stored analytics report to `recipients`. NEVER throws.
 */
export async function sendAnalyticsReportEmail(
  reportId: string,
  recipients: string[],
  opts?: { actingUserId?: string | null },
): Promise<SendAnalyticsReportEmailResult> {
  const sb = supabaseAdmin as any;
  try {
    const { data: report, error } = await sb
      .from("analytics_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();
    if (error || !report) {
      return { ok: false, sent: 0, failed: 0, error: "report_not_found" };
    }
    const workspaceId = report.workspace_id as string;

    // Feature gate: automated report emails.
    const canEmail = await canAccessFeature(workspaceId, opts?.actingUserId ?? "", "automated_report_emails");
    if (!canEmail) {
      writeAccessAudit({
        workspaceId,
        actingUserId: opts?.actingUserId ?? null,
        objectType: "analytics_report",
        objectId: reportId,
        actionType: "report_email_denied",
        afterState: { featureKey: "automated_report_emails" },
        riskLevel: "low",
      });
      return { ok: false, sent: 0, failed: 0, error: "feature_locked" };
    }

    const clean = Array.from(
      new Set(
        (recipients ?? [])
          .map((r) => String(r ?? "").trim().toLowerCase())
          .filter((r) => r.includes("@")),
      ),
    );
    if (clean.length === 0) {
      await sb
        .from("analytics_reports")
        .update({ delivery_status: "failed", delivery_error: "no_recipients", updated_at: new Date().toISOString() })
        .eq("id", reportId);
      return { ok: false, sent: 0, failed: 0, error: "no_recipients" };
    }

    // Provider gate: only use custom provider when the package allows it,
    // otherwise force the WEBEE platform default.
    const allowCustom = await canAccessFeature(workspaceId, opts?.actingUserId ?? "", "custom_email_provider");

    const subject = `WEBEE Report: ${String(report.report_name ?? "Analytics Report")}`.slice(0, 180);
    const html = renderReportHtml(report);

    let sent = 0;
    let failed = 0;
    let providerUsed = "platform_default";

    for (const to of clean) {
      try {
        if (allowCustom) {
          const res = await sendWorkspaceEmail(sb, { workspaceId, to, subject, html });
          if (res.success) {
            sent++;
            providerUsed = res.providerUsed;
          } else {
            failed++;
          }
        } else {
          const res = await sendResendEmail({ to, subject, html });
          if (res.success) sent++;
          else failed++;
        }
      } catch {
        failed++;
      }
    }

    const deliveryStatus = failed === 0 ? "sent" : sent > 0 ? "sent" : "failed";
    const nowIso = new Date().toISOString();
    await sb
      .from("analytics_reports")
      .update({
        report_status: sent > 0 ? "sent" : "failed",
        delivery_status: deliveryStatus,
        delivery_error: failed > 0 ? `failed_${failed}_of_${clean.length}` : null,
        sent_to_json: clean,
        updated_at: nowIso,
      })
      .eq("id", reportId);

    writeAccessAudit({
      workspaceId,
      actingUserId: opts?.actingUserId ?? null,
      objectType: "analytics_report",
      objectId: reportId,
      actionType: sent > 0 ? "report_sent" : "report_send_failed",
      afterState: { sent, failed, recipients: clean.length, providerUsed },
      riskLevel: "low",
    });

    return { ok: sent > 0, sent, failed, providerUsed };
  } catch (err: any) {
    console.error("[analytics-hub] sendAnalyticsReportEmail failed (non-fatal):", err?.message ?? err);
    try {
      await sb
        .from("analytics_reports")
        .update({
          delivery_status: "failed",
          delivery_error: String(err?.message ?? "send_error").slice(0, 400),
          updated_at: new Date().toISOString(),
        })
        .eq("id", reportId);
    } catch {
      /* ignore */
    }
    return { ok: false, sent: 0, failed: 0, error: "send_error" };
  }
}
