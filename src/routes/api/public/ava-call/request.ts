/**
 * "Call Ava Now" — step 1: create a call request + send a 6-digit OTP via the
 * best available provider (Twilio Verify → Twilio SMS → Resend email).
 * POST /api/public/ava-call/request
 * No auth. Rate-limited 3/hour per IP, per email and per phone. Honeypot spam check.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, isSpam } from "@/lib/lead-gen/webforms.server";
import { createAvaCallRequest, normalizePhoneE164 } from "@/lib/lead-gen/ava-call.server";

const HOUR_MS = 60 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export const Route = createFileRoute("/api/public/ava-call/request")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }: { request: Request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

        let fields: Record<string, unknown> = {};
        try {
          fields = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Invalid body" }, { status: 400, headers: CORS });
        }

        // Honeypot — pretend success
        if (isSpam(fields)) {
          return Response.json({ ok: true, requestId: crypto.randomUUID() }, { headers: CORS });
        }

        // 3 OTP requests per hour per IP, per email AND per phone.
        const normalizedPhone =
          normalizePhoneE164(String(fields.phone ?? "")) ?? String(fields.phone ?? "").trim() ?? "none";
        const allowedIp = await checkRateLimit(`avacall:req:${ip ?? "global"}`, 3, HOUR_MS);
        const allowedEmail = await checkRateLimit(
          `avacall:email:${String(fields.email ?? "").trim().toLowerCase() || "none"}`,
          3,
          HOUR_MS,
        );
        const allowedPhone = await checkRateLimit(`avacall:phone:${normalizedPhone || "none"}`, 3, HOUR_MS);
        if (!allowedIp || !allowedEmail || !allowedPhone) {
          return Response.json(
            { error: "Too many requests. Please wait an hour and try again." },
            { status: 429, headers: CORS },
          );
        }

        const result = await createAvaCallRequest({
          name: fields.name as string | undefined,
          email: fields.email as string | undefined,
          phone: fields.phone as string | undefined,
          website: fields.website as string | undefined,
          consent: fields.consent,
          ip,
          userAgent: request.headers.get("user-agent"),
        });

        if (!result.ok) {
          return Response.json(
            { error: result.error, ...(result.code ? { code: result.code } : {}) },
            { status: result.status, headers: CORS },
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
          { headers: CORS },
        );
      },
    },
  },
});
