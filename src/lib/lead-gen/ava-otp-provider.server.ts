/**
 * OTP provider detection + sending for the "Call Ava Now" flow.
 *
 * Provider priority (spec):
 *   1. Twilio Verify SMS  — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_VERIFY_SERVICE_SID
 *   2. Twilio SMS         — TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER
 *   3. Resend email OTP   — RESEND_API_KEY
 *   4. none               — caller must return a clear "not configured" error
 *
 * If an SMS send fails at runtime and Resend is configured, we fall back to
 * email and report `fallback: true` so the UI can explain the switch.
 *
 * Dev test mode: AVA_OTP_DEV_MODE=true (+ optional AVA_OTP_DEV_CODE, default
 * 123456) skips real sending so the flow can be tested before providers are
 * live. Hard-disabled when NODE_ENV === "production".
 */
import { sendResendEmail, escapeHtml, renderBasicEmail } from "@/lib/email/resend.server";

export type OtpChannel = "twilio_verify" | "sms" | "email" | "dev" | "none";

export interface OtpProviderInfo {
  channel: OtpChannel;
  /** true when the OTP check must be delegated to Twilio Verify. */
  managedByTwilioVerify: boolean;
}

function hasTwilioCore(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim());
}

export function isOtpDevMode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AVA_OTP_DEV_MODE === "true";
}

export function getOtpDevCode(): string {
  const code = (process.env.AVA_OTP_DEV_CODE ?? "").trim();
  return /^\d{6}$/.test(code) ? code : "123456";
}

/** Detect the best available OTP provider from the environment. */
export function detectOtpProvider(): OtpProviderInfo {
  if (isOtpDevMode()) {
    return { channel: "dev", managedByTwilioVerify: false };
  }
  if (hasTwilioCore() && process.env.TWILIO_VERIFY_SERVICE_SID?.trim()) {
    return { channel: "twilio_verify", managedByTwilioVerify: true };
  }
  if (hasTwilioCore() && process.env.TWILIO_PHONE_NUMBER?.trim()) {
    return { channel: "sms", managedByTwilioVerify: false };
  }
  if (process.env.RESEND_API_KEY?.trim()) {
    return { channel: "email", managedByTwilioVerify: false };
  }
  return { channel: "none", managedByTwilioVerify: false };
}

function twilioAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

/** Start a Twilio Verify verification (Twilio generates + sends the code). */
async function startTwilioVerify(phone: string): Promise<{ success: boolean; error?: string }> {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  try {
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, Channel: "sms" }).toString(),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[AVA-OTP] Twilio Verify start failed (${res.status}): ${body.slice(0, 300)}`);
      return { success: false, error: `twilio_verify_${res.status}` };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AVA-OTP] Twilio Verify start threw:", message);
    return { success: false, error: message };
  }
}

/** Check a Twilio Verify code. Only used when channel is twilio_verify. */
export async function checkTwilioVerifyCode(
  phone: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!serviceSid || !hasTwilioCore()) return { success: false, error: "twilio_verify_not_configured" };
  try {
    const res = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, Code: code }).toString(),
      },
    );
    if (!res.ok) return { success: false, error: `twilio_verify_check_${res.status}` };
    const data = (await res.json()) as { status?: string };
    return { success: data.status === "approved" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AVA-OTP] Twilio Verify check threw:", message);
    return { success: false, error: message };
  }
}

/** Send the OTP as a plain Twilio SMS (we generate + store the code locally). */
async function sendTwilioSms(phone: string, otp: string): Promise<{ success: boolean; error?: string }> {
  const from = process.env.TWILIO_PHONE_NUMBER?.trim();
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: twilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: phone,
          From: from ?? "",
          Body: `Your verification code for speaking with Ava is: ${otp}\n\nThis code expires in 10 minutes.`,
        }).toString(),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[AVA-OTP] Twilio SMS failed (${res.status}): ${body.slice(0, 300)}`);
      return { success: false, error: `twilio_sms_${res.status}` };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[AVA-OTP] Twilio SMS threw:", message);
    return { success: false, error: message };
  }
}

/** Send the OTP by email through Resend. */
async function sendOtpEmail(
  email: string,
  name: string | null,
  otp: string,
  expiryMinutes: number,
): Promise<{ success: boolean; error?: string }> {
  const from = process.env.AVA_OTP_FROM_EMAIL?.trim() || undefined;
  const result = await sendResendEmail({
    to: email,
    from,
    subject: "Your Ava verification code",
    html: renderBasicEmail({
      heading: "Your Ava verification code",
      bodyHtml: `
        <p style="font-size:14px;color:#c8c8d8">Hi${name ? ` ${escapeHtml(name)}` : ""},</p>
        <p style="font-size:14px;color:#c8c8d8">Your verification code for speaking with Ava is:</p>
        <p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#ffffff;margin:18px 0">${escapeHtml(otp)}</p>
        <p style="font-size:12px;color:#8a8aa0">This code expires in ${expiryMinutes} minutes. If you did not request this, you can ignore this email.</p>`,
    }),
  });
  return { success: result.success, error: result.error };
}

export interface SendOtpResult {
  success: boolean;
  /** Channel actually used (may differ from detected if fallback kicked in). */
  channel: OtpChannel;
  /** true when SMS failed and the code was delivered by email instead. */
  fallback: boolean;
  error?: string;
}

/**
 * Send the OTP using the detected provider, with SMS → email runtime fallback.
 * For `twilio_verify` the code is generated/checked by Twilio, so `otp` is
 * ignored — the caller must NOT store a local hash in that case.
 * For `dev` nothing is sent; the caller stores the hash of the dev code.
 */
export async function sendOtp(input: {
  provider: OtpProviderInfo;
  phone: string;
  email: string;
  name: string | null;
  otp: string;
  expiryMinutes: number;
}): Promise<SendOtpResult> {
  const { provider, phone, email, name, otp, expiryMinutes } = input;

  switch (provider.channel) {
    case "dev": {
      console.warn("[AVA-OTP] DEV OTP MODE ACTIVE — no real OTP sent (never enabled in production)");
      return { success: true, channel: "dev", fallback: false };
    }
    case "twilio_verify": {
      const sms = await startTwilioVerify(phone);
      if (sms.success) return { success: true, channel: "twilio_verify", fallback: false };
      break; // fall through to email fallback below
    }
    case "sms": {
      const sms = await sendTwilioSms(phone, otp);
      if (sms.success) return { success: true, channel: "sms", fallback: false };
      break; // fall through to email fallback below
    }
    case "email": {
      const mail = await sendOtpEmail(email, name, otp, expiryMinutes);
      return { success: mail.success, channel: "email", fallback: false, error: mail.error };
    }
    case "none":
      return { success: false, channel: "none", fallback: false, error: "no_provider" };
  }

  // SMS path failed — try email fallback if Resend is configured.
  if (process.env.RESEND_API_KEY?.trim()) {
    console.warn("[AVA-OTP] SMS send failed — falling back to email OTP");
    const mail = await sendOtpEmail(email, name, otp, expiryMinutes);
    if (mail.success) return { success: true, channel: "email", fallback: true };
    return { success: false, channel: "email", fallback: true, error: mail.error };
  }
  return { success: false, channel: provider.channel, fallback: false, error: "sms_send_failed" };
}
