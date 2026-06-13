/**
 * Core send-upload-link logic for voice AI tool calls.
 *
 * Finds the contact by phone, ensures they have an upload token,
 * builds their upload URL, and sends it via SMS using Twilio.
 *
 * Used by both the Retell and HyperStream endpoints — kept strictly
 * separate; this module is provider-agnostic.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normalizePhone(p: string) {
  return p.replace(/[\s\-().]/g, "");
}

export interface SendUploadLinkResult {
  ok: boolean;
  sms_sent: boolean;
  upload_url: string | null;
  /** Ready-to-speak sentence the AI can read aloud verbatim. */
  summary: string;
}

/**
 * Find the contact by phone, ensure they have an upload token, build the URL,
 * and fire an SMS via Twilio. Always resolves — never rejects.
 */
export async function sendUploadLinkByPhone(
  phone: string,
  workspaceId: string,
): Promise<SendUploadLinkResult> {
  const sb = supabaseAdmin as any;
  const normalized = normalizePhone(phone);

  const PUBLIC_BASE_URL =
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");

  // ── 1. Find the contact ────────────────────────────────────────────────────
  const { data: contact } = await sb
    .from("data_records")
    .select("id, name, upload_token")
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .or(`mobile_number.eq.${normalized},mobile_number.eq.${phone}`)
    .maybeSingle();

  if (!contact) {
    return {
      ok: false,
      sms_sent: false,
      upload_url: null,
      summary:
        "I'm sorry, I couldn't find a contact record for this number, so I'm unable to generate an upload link.",
    };
  }

  // ── 2. Ensure upload token exists ─────────────────────────────────────────
  let uploadToken = contact.upload_token as string | null;
  if (!uploadToken) {
    uploadToken = crypto.randomUUID();
    await sb
      .from("data_records")
      .update({ upload_token: uploadToken })
      .eq("id", contact.id);
  }

  const uploadUrl = `${PUBLIC_BASE_URL}/upload/${uploadToken}`;

  // ── 3. Check Twilio credentials ───────────────────────────────────────────
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return {
      ok: true,
      sms_sent: false,
      upload_url: uploadUrl,
      summary:
        "I have your upload link ready, but I'm unable to send it by text message at this time. " +
        "Please make a note of it — I'll also leave it on your file.",
    };
  }

  // ── 4. Get workspace SMS-capable phone number ─────────────────────────────
  const { data: phoneRow } = await sb
    .from("phone_numbers")
    .select("phone_number")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .eq("provider", "twilio")
    .maybeSingle();

  const fromNumber: string | undefined =
    (phoneRow?.phone_number as string | undefined) ?? process.env.TWILIO_FROM;

  if (!fromNumber) {
    return {
      ok: true,
      sms_sent: false,
      upload_url: uploadUrl,
      summary:
        "Your secure document upload link is ready, but I wasn't able to send it by text " +
        "as no sending number is configured on this account.",
    };
  }

  // ── 5. Send SMS via Twilio REST ───────────────────────────────────────────
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const toNumber = normalized.startsWith("+") ? normalized : phone;
    const body =
      `Hi, here is your secure document upload link:\n${uploadUrl}\n\n` +
      `Please use this link to send us your documents. This link is unique to you.`;

    const form = new URLSearchParams({ From: fromNumber, To: toNumber, Body: body });

    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );

    const result = await resp.json() as { error_code?: number; sid?: string; message?: string };

    if (!resp.ok || result.error_code) {
      console.warn("[send-upload-link] SMS send failed:", result);
      return {
        ok: true,
        sms_sent: false,
        upload_url: uploadUrl,
        summary:
          "I have your upload link ready but the text message couldn't be delivered at this time. " +
          "I've saved the link to your contact record.",
      };
    }

    return {
      ok: true,
      sms_sent: true,
      upload_url: uploadUrl,
      summary:
        "I've just sent a secure upload link to your mobile number. " +
        "Please check your text messages and follow the link to securely upload your documents. " +
        "It should arrive within the next minute.",
    };
  } catch (err) {
    console.error("[send-upload-link] Twilio error:", err);
    return {
      ok: true,
      sms_sent: false,
      upload_url: uploadUrl,
      summary:
        "I have your upload link ready but encountered an error sending the text message. " +
        "The link has been saved to your account.",
    };
  }
}
