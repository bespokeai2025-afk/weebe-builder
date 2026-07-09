/**
 * "Call Ava Now" — step 2: verify the OTP and trigger the outbound Ava call.
 * POST /api/public/ava-call/verify
 * No auth. Rate-limited per IP. Max 5 OTP attempts per request row.
 */
import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit } from "@/lib/lead-gen/webforms.server";
import { verifyAvaCallOtpAndTrigger } from "@/lib/lead-gen/ava-call.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export const Route = createFileRoute("/api/public/ava-call/verify")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }: { request: Request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        const allowed = await checkRateLimit(`avacall:verify:${ip ?? "global"}`, 10);
        if (!allowed) {
          return Response.json(
            { error: "Too many attempts. Please wait a minute and try again." },
            { status: 429, headers: CORS },
          );
        }

        let fields: Record<string, unknown> = {};
        try {
          fields = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "Invalid body" }, { status: 400, headers: CORS });
        }

        const result = await verifyAvaCallOtpAndTrigger({
          requestId: fields.requestId as string | undefined,
          otp: fields.otp as string | undefined,
        });

        if (!result.ok) {
          return Response.json({ error: result.error }, { status: result.status, headers: CORS });
        }
        return Response.json(
          { ok: true, message: "Ava is calling you now." },
          { headers: CORS },
        );
      },
    },
  },
});
