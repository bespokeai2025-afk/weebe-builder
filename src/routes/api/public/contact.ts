/**
 * WEBEE "Talk to Us" internal contact form endpoint.
 * POST /api/public/contact
 *
 * Creates a lead in the WEBEE admin workspace and notifies admin@webespokeai.com.
 * No auth required. Rate-limited (5 req/min per IP). Honeypot spam check.
 */
import { createFileRoute } from "@tanstack/react-router";
import { processContactForm, checkRateLimit } from "@/lib/lead-gen/webforms.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      POST: async ({ request }: { request: Request }) => {
        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        const allowed = await checkRateLimit(`contact:${ip ?? "global"}`, 5);
        if (!allowed) {
          return Response.json({ error: "Too many submissions" }, { status: 429, headers: CORS });
        }

        let fields: any = {};
        try {
          const ct = request.headers.get("content-type") ?? "";
          if (ct.includes("application/json")) {
            fields = await request.json();
          } else {
            const form = await request.formData();
            form.forEach((v, k) => { fields[k] = String(v); });
          }
        } catch {
          return Response.json({ error: "Invalid body" }, { status: 400, headers: CORS });
        }

        // Honeypot
        if (fields.website_url || fields._hp || fields.fax) {
          return Response.json({ ok: true, message: "Thank you!" }, { headers: CORS });
        }

        if (!fields.email && !fields.phone) {
          return Response.json({ error: "email_or_phone_required" }, { status: 422, headers: CORS });
        }

        const result = await processContactForm(
          {
            name:                     fields.name,
            email:                    fields.email,
            phone:                    fields.phone,
            company_name:             fields.company_name,
            website:                  fields.website,
            interested_in:            fields.interested_in,
            message:                  fields.message,
            preferred_contact_method: fields.preferred_contact_method,
            source_page:              fields.source_page,
            utm_source:               fields.utm_source,
            utm_campaign:             fields.utm_campaign,
            utm_medium:               fields.utm_medium,
          },
          { ip, userAgent: request.headers.get("user-agent") },
        );

        if (!result.ok) {
          return Response.json({ error: result.error }, { status: 422, headers: CORS });
        }
        return Response.json({ ok: true, message: "Thank you! We'll be in touch shortly." }, { headers: CORS });
      },
    },
  },
});
