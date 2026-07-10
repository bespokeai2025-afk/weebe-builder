/**
 * Shared HTTP handlers for the "Call Ava Now" public endpoints.
 *
 * Served under two path pairs (same behavior):
 *   /api/public/ava-call/request      +  /api/public/ava-call/verify
 *   /api/public/ava-call/request-otp  +  /api/public/ava-call/verify-and-call
 * The second pair matches the contract used by the main Webespoke marketing
 * site (webespokeai.com), which sends `businessWebsite` instead of `website`
 * and verifies with { email, phone, otp } instead of { requestId, otp }.
 */
import { checkRateLimit, isRateLimitExempt, isSpam } from "@/lib/lead-gen/webforms.server";
import {
  createAvaCallRequest,
  normalizePhoneE164,
  verifyAvaCallOtpAndTrigger,
  verifyAvaCallOtpByContact,
} from "@/lib/lead-gen/ava-call.server";

const HOUR_MS = 60 * 60 * 1000;

export const AVA_CALL_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export const avaCallOptionsHandler = async () =>
  new Response(null, { status: 204, headers: AVA_CALL_CORS });

/** Step 1: create a call request + send the OTP. */
export async function handleAvaCallRequestPost(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  let fields: Record<string, unknown> = {};
  try {
    fields = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400, headers: AVA_CALL_CORS });
  }

  // Honeypot — pretend success
  if (isSpam(fields)) {
    return Response.json({ ok: true, requestId: crypto.randomUUID() }, { headers: AVA_CALL_CORS });
  }

  // 3 OTP requests per hour per IP, per email AND per phone.
  // Skipped for developer/testing traffic (dev env or allowlisted IP).
  const normalizedPhone =
    normalizePhoneE164(String(fields.phone ?? "")) ?? String(fields.phone ?? "").trim() ?? "none";
  if (!isRateLimitExempt(ip)) {
    const allowedIp = await checkRateLimit(`avacall:req:${ip ?? "global"}`, 3, HOUR_MS);
    const allowedEmail = await checkRateLimit(
      `avacall:email:${String(fields.email ?? "").trim().toLowerCase() || "none"}`,
      3,
      HOUR_MS,
    );
    const allowedPhone = await checkRateLimit(
      `avacall:phone:${normalizedPhone || "none"}`,
      3,
      HOUR_MS,
    );
    if (!allowedIp || !allowedEmail || !allowedPhone) {
      return Response.json(
        { error: "Too many requests. Please wait an hour and try again." },
        { status: 429, headers: AVA_CALL_CORS },
      );
    }
  }

  const result = await createAvaCallRequest({
    name: fields.name as string | undefined,
    email: fields.email as string | undefined,
    phone: fields.phone as string | undefined,
    // The marketing site sends `businessWebsite`; our own modal sends `website`.
    website: (fields.website ?? fields.businessWebsite) as string | undefined,
    consent: fields.consent,
    ip,
    userAgent: request.headers.get("user-agent"),
  });

  if (!result.ok) {
    return Response.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status, headers: AVA_CALL_CORS },
    );
  }
  return Response.json(
    {
      ok: true,
      success: true,
      requestId: result.requestId,
      channel: result.channel,
      fallback: result.fallback,
    },
    { headers: AVA_CALL_CORS },
  );
}

/** Step 2: verify the OTP and trigger the call. Accepts requestId OR email+phone. */
export async function handleAvaCallVerifyPost(request: Request): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!isRateLimitExempt(ip)) {
    const allowed = await checkRateLimit(`avacall:verify:${ip ?? "global"}`, 10);
    if (!allowed) {
      return Response.json(
        { error: "Too many attempts. Please wait a minute and try again." },
        { status: 429, headers: AVA_CALL_CORS },
      );
    }
  }

  let fields: Record<string, unknown> = {};
  try {
    fields = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400, headers: AVA_CALL_CORS });
  }

  const requestId = String(fields.requestId ?? "").trim();
  const result = requestId
    ? await verifyAvaCallOtpAndTrigger({
        requestId,
        otp: fields.otp as string | undefined,
      })
    : await verifyAvaCallOtpByContact({
        email: fields.email as string | undefined,
        phone: fields.phone as string | undefined,
        otp: fields.otp as string | undefined,
      });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status, headers: AVA_CALL_CORS });
  }
  return Response.json(
    { ok: true, success: true, message: "Ava is calling you now." },
    { headers: AVA_CALL_CORS },
  );
}
