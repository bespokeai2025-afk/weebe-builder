/**
 * Public webform submission endpoint.
 * POST /api/public/webforms/:formToken
 *
 * Accepts JSON, application/x-www-form-urlencoded, or multipart/form-data.
 * No auth required — validated by form_token lookup.
 * Includes: honeypot spam check, domain allowlist, rate limiting (10 req/min per IP).
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  processWebformSubmission,
  checkRateLimit,
  isDomainAllowed,
} from "@/lib/lead-gen/webforms.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
} as const;

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => new FormData());
    const obj: Record<string, unknown> = {};
    form.forEach((v, k) => { obj[k] = typeof v === "string" ? v : null; });
    return obj;
  }
  return {};
}

export const Route = createFileRoute("/api/public/webforms/$formToken")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request, params }) => {
        const { formToken } = params;

        if (!formToken || !/^[a-f0-9]{40,64}$/i.test(formToken)) {
          return Response.json({ error: "Invalid form token" }, { status: 400, headers: CORS });
        }

        // Rate limiting by IP
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          request.headers.get("x-real-ip") ??
          null;
        const rateLimitKey = `wf:${ip ?? formToken}`;
        const allowed = await checkRateLimit(rateLimitKey, 10);
        if (!allowed) {
          return Response.json({ error: "Too many submissions. Please wait." }, { status: 429, headers: CORS });
        }

        // Lookup form source
        const { data: source } = await supabaseAdmin
          .from("webform_sources")
          .select("id, workspace_id, name, status, allowed_domains, default_source_type, default_source_detail, notify_email, field_mapping_json")
          .eq("form_token", formToken)
          .maybeSingle();

        if (!source) return Response.json({ error: "Form not found" }, { status: 404, headers: CORS });
        if (source.status !== "active") return Response.json({ error: "Form is not active" }, { status: 403, headers: CORS });

        // Domain check
        const origin = request.headers.get("origin") ?? request.headers.get("referer");
        if (!isDomainAllowed(origin, (source.allowed_domains as string[]) ?? [])) {
          return Response.json({ error: "Domain not allowed" }, { status: 403, headers: CORS });
        }

        // Parse body
        const raw = await parseBody(request);

        const result = await processWebformSubmission({
          workspaceId:     source.workspace_id,
          webformSourceId: source.id,
          formName:        source.name,
          sourceType:      source.default_source_type,
          sourceDetail:    (source.default_source_detail as string | null) ?? null,
          notifyEmail:     (source.notify_email as string | null) ?? null,
          fieldMapping:    (source.field_mapping_json as Record<string, string>) ?? {},
          raw,
          ip,
          userAgent:       request.headers.get("user-agent"),
          origin,
        });

        if (!result.ok && result.status === "spam") {
          // Silent drop — don't reveal to spammers
          return Response.json({ ok: true, message: "Thank you!" }, { headers: CORS });
        }
        if (!result.ok) {
          return Response.json({ error: result.error ?? "Submission failed" }, { status: 422, headers: CORS });
        }

        return Response.json({ ok: true, message: "Thank you! We'll be in touch." }, { headers: CORS });
      },
    },
  },
});
