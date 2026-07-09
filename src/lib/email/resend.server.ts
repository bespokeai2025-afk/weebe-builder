/**
 * Minimal Resend email sender (server-only).
 *
 * Uses the Resend REST API directly so we don't depend on the Lovable email
 * queue. Requires RESEND_API_KEY. The `from` address must use a domain that is
 * verified in your Resend account — set RESEND_FROM to that address. The
 * default (onboarding@resend.dev) only delivers to the email registered on the
 * Resend account and is meant for testing only.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM ?? "Webespoke AI <onboarding@resend.dev>";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Optional from override (must be a Resend-verified domain). Defaults to RESEND_FROM. */
  from?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

export async function sendResendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    console.error("[resend] RESEND_API_KEY is not set — email not sent");
    return { success: false, error: "resend_not_configured" };
  }
  if (!params.to) {
    return { success: false, error: "recipient_required" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from?.trim() || RESEND_FROM,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[resend] send failed (${res.status}): ${body}`);
      return { success: false, error: `resend_http_${res.status}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { success: true, id: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[resend] send threw:", message);
    return { success: false, error: message };
  }
}

/**
 * Escape user-controlled text before interpolating it into HTML email content.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap body content in a simple, branded HTML shell.
 */
export function renderBasicEmail(opts: { heading: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0b0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#15151c;border-radius:14px;overflow:hidden;border:1px solid #26262f;">
            <tr>
              <td style="padding:28px 32px 8px;">
                <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7c7c8a;">Webespoke AI</div>
                <h1 style="margin:8px 0 0;font-size:20px;line-height:1.3;color:#f4f4f6;font-weight:600;">${opts.heading}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px;color:#c7c7d1;font-size:15px;line-height:1.6;">
                ${opts.bodyHtml}
              </td>
            </tr>
          </table>
          <div style="color:#5a5a66;font-size:12px;margin-top:18px;">Webespoke AI Script Flow Builder</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
