/**
 * Website "Talk to Ava" — secure web-call session creation.
 * POST /api/public/ava-web-call
 *
 * The public website calls this instead of hitting the Retell API directly so
 * the Retell API key never reaches the browser. Returns { accessToken, callId }
 * for the Retell web SDK (`retellWebClient.startCall({ accessToken })`).
 */
import { createFileRoute } from "@tanstack/react-router";
import { AVA_CALL_CORS, avaCallOptionsHandler } from "@/lib/lead-gen/ava-call-http.server";
import { checkRateLimit, isRateLimitExempt, isSpam } from "@/lib/lead-gen/webforms.server";

const HOUR_MS = 60 * 60 * 1000;

export const Route = createFileRoute("/api/public/ava-web-call")({
  server: {
    handlers: {
      OPTIONS: avaCallOptionsHandler,
      POST: async ({ request }: { request: Request }) => {
        const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

        let fields: Record<string, unknown> = {};
        try {
          fields = (await request.json()) as Record<string, unknown>;
        } catch {
          // Allow empty bodies — anonymous visitors can start a call with no details.
          fields = {};
        }

        if (isSpam(fields)) {
          return Response.json({ error: "Unavailable" }, { status: 503, headers: AVA_CALL_CORS });
        }

        // 6 web-call sessions per hour per IP (browser calls are cheap to spam).
        if (!isRateLimitExempt(ip)) {
          const allowed = await checkRateLimit(`avawebcall:ip:${ip ?? "global"}`, 6, HOUR_MS);
          if (!allowed) {
            return Response.json(
              { error: "Too many requests. Please wait and try again." },
              { status: 429, headers: AVA_CALL_CORS },
            );
          }
        }

        const { createAvaWebCallSession } = await import("@/lib/lead-gen/ava-web-call.server");
        const result = await createAvaWebCallSession({
          name: fields.name,
          email: fields.email,
          phone: fields.phone,
          visitorSessionId: fields.visitorSessionId ?? fields.visitor_session_id,
          landingPage: fields.landingPage ?? fields.landing_page ?? fields.landing_url,
          referringUrl: fields.referringUrl ?? fields.referring_url ?? fields.referrer,
          attribution: {
            gclid: fields.gclid,
            gbraid: fields.gbraid,
            wbraid: fields.wbraid,
            landing_url: fields.landingPage ?? fields.landing_page ?? fields.landing_url,
            referrer: fields.referringUrl ?? fields.referring_url ?? fields.referrer,
            utm_source: fields.utm_source ?? fields.utmSource,
            utm_medium: fields.utm_medium ?? fields.utmMedium,
            utm_campaign: fields.utm_campaign ?? fields.utmCampaign,
            utm_term: fields.utm_term ?? fields.utmTerm,
            utm_content: fields.utm_content ?? fields.utmContent,
          },
          ip,
          userAgent: request.headers.get("user-agent"),
        });

        if (!result.ok) {
          return Response.json({ error: result.error }, { status: result.status, headers: AVA_CALL_CORS });
        }
        return Response.json(
          { accessToken: result.accessToken, callId: result.callId },
          { headers: AVA_CALL_CORS },
        );
      },
    },
  },
});
