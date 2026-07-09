/**
 * "Call Ava Now" — step 1: create a call request + email a 6-digit OTP.
 * POST /api/public/ava-call/request
 * No auth. Rate-limited per IP and per email. Honeypot spam check.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, isSpam } from "@/lib/lead-gen/webforms.server";
import { createAvaCallRequest } from "@/lib/lead-gen/ava-call.server";

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

        const allowedIp = await checkRateLimit(`avacall:req:${ip ?? "global"}`, 3);
        const allowedEmail = await checkRateLimit(
          `avacall:email:${String(fields.email ?? "").trim().toLowerCase() || "none"}`,
          3,
        );
        if (!allowedIp || !allowedEmail) {
          return Response.json(
            { error: "Too many requests. Please wait a minute and try again." },
            { status: 429, headers: CORS },
          );
        }

        const result = await createAvaCallRequest({
          name: fields.name as string | undefined,
          email: fields.email as string | undefined,
          phone: fields.phone as string | undefined,
          website: fields.website as string | undefined,
          ip,
          userAgent: request.headers.get("user-agent"),
        });

        if (!result.ok) {
          return Response.json({ error: result.error }, { status: result.status, headers: CORS });
        }
        return Response.json({ ok: true, requestId: result.requestId }, { headers: CORS });
      },
    },
  },
});
