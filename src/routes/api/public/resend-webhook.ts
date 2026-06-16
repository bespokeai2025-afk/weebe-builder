/**
 * POST /api/public/resend-webhook
 *
 * Resend event webhook — records bounces, complaints, and delivery failures
 * into email_reputation_events for the deliverability centre.
 *
 * Configure in Resend dashboard → Webhooks → POST https://<host>/api/public/resend-webhook
 * Optional: set RESEND_WEBHOOK_SECRET env var to verify svix signatures.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  if (!RESEND_WEBHOOK_SECRET) return true;
  const sig = req.headers.get("svix-signature") ?? req.headers.get("resend-signature") ?? "";
  if (!sig) return false;
  try {
    const encoder = new TextEncoder();
    const key     = await crypto.subtle.importKey("raw", encoder.encode(RESEND_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sigHex  = sig.replace(/^v1,/, "").split(",")[0];
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(rawBody));
  } catch { return false; }
}

export const Route = createFileRoute("/api/public/resend-webhook")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true, endpoint: "resend-webhook" }),

      POST: async ({ request }) => {
        const rawBody = await request.text();

        if (RESEND_WEBHOOK_SECRET) {
          const valid = await verifySignature(request, rawBody);
          if (!valid) return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let payload: any;
        try { payload = JSON.parse(rawBody); }
        catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }

        const type    = String(payload?.type ?? "");
        const toEmail = String(payload?.data?.to?.[0] ?? payload?.data?.to ?? "");
        const from    = String(payload?.data?.from ?? "");

        const BOUNCE_TYPES    = ["email.bounced", "email.delivery_delayed"];
        const COMPLAINT_TYPES = ["email.complained"];
        const FAILURE_TYPES   = ["email.delivery_failed"];

        let eventType: string | null = null;
        let severity = "info";

        if (BOUNCE_TYPES.includes(type)) {
          eventType = "bounce";
          severity  = type === "email.bounced" ? "warning" : "info";
        } else if (COMPLAINT_TYPES.includes(type)) {
          eventType = "complaint";
          severity  = "critical";
        } else if (FAILURE_TYPES.includes(type)) {
          eventType = "delivery_failure";
          severity  = "warning";
        }

        if (!eventType) return Response.json({ ok: true }, { status: 200 });

        try {
          const sb = supabaseAdmin as any;
          const fromDomain = from.split("@")[1]?.toLowerCase() ?? "";

          const [domRes, mbRes] = await Promise.all([
            fromDomain ? sb.from("email_sender_domains").select("id,workspace_id").eq("domain", fromDomain).maybeSingle() : Promise.resolve({ data: null }),
            from       ? sb.from("email_mailboxes").select("id,workspace_id").eq("email_address", from.toLowerCase()).maybeSingle() : Promise.resolve({ data: null }),
          ]);

          const workspaceId = domRes.data?.workspace_id ?? mbRes.data?.workspace_id;
          if (!workspaceId) return Response.json({ ok: true });

          await sb.from("email_reputation_events").insert({
            workspace_id: workspaceId,
            domain_id:    domRes.data?.id ?? null,
            mailbox_id:   mbRes.data?.id  ?? null,
            event_type:   eventType,
            severity,
            description:  `${type} → ${toEmail}`,
            source:       "resend_webhook",
            metadata:     { type, to: toEmail, from },
          });

          console.log(`[resend-webhook] ${eventType}/${severity} for workspace ${workspaceId}`);
        } catch (err: any) {
          console.error("[resend-webhook] DB error:", err?.message);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
