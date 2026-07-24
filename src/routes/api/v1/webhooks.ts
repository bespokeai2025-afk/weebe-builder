/**
 * WEBEE Developer API v1 — Webhooks management
 * GET    /api/v1/webhooks       — list webhook subscriptions
 * POST   /api/v1/webhooks       — create webhook subscription
 * DELETE /api/v1/webhooks       — delete a webhook (id in body)
 * POST   /api/v1/webhooks/test  — send a test event to a webhook
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";
import { fireWebhookEvent } from "@/lib/developer-api/webhook-delivery.server";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const VALID_EVENTS = [
  "lead.created","lead.updated","call.started","call.completed","call.failed",
  "booking.created","campaign.completed","document.uploaded","agent.deployed",
];

export const Route = createFileRoute("/api/v1/webhooks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "webhooks:manage");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const { data, error } = await sb().from("workspace_webhooks")
          .select("id, name, event_type, target_url, active, created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        if (error) return jsonErr(error.message, 500);
        return jsonOk({ object: "list", data: data ?? [] });
      },

      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "webhooks:manage");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Invalid JSON body"); }

        // Test mode
        if (body?.action === "test") {
          const { webhook_id } = body;
          if (!webhook_id) return jsonErr("webhook_id required for test action");

          const { data: hook } = await sb().from("workspace_webhooks")
            .select("id, target_url, secret, event_type, workspace_id")
            .eq("id", webhook_id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();

          if (!hook) return jsonErr("Webhook not found", 404);

          await fireWebhookEvent(workspaceId, hook.event_type as any, {
            test: true,
            message: "This is a WEBEE webhook test event",
          });

          return jsonOk({ ok: true, message: "Test event sent" });
        }

        // Create mode
        const { name, event_type, target_url } = body ?? {};
        if (!name) return jsonErr("name is required");
        if (!event_type || !VALID_EVENTS.includes(event_type)) {
          return jsonErr(`event_type must be one of: ${VALID_EVENTS.join(", ")}`);
        }
        if (!target_url) return jsonErr("target_url is required");

        let parsedUrl: URL;
        try { parsedUrl = new URL(target_url); }
        catch { return jsonErr("target_url is not a valid URL"); }

        if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
          return jsonErr("target_url must use HTTPS in production");
        }
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
          return jsonErr("target_url must be an http(s) URL");
        }
        // SSRF guard: refuse loopback/private/link-local/internal targets so a
        // webhook can't be pointed at internal services or cloud metadata.
        {
          const host = parsedUrl.hostname.toLowerCase();
          const privateHost =
            host === "localhost" || host === "0.0.0.0" || host === "[::1]" || host === "::1" ||
            host.endsWith(".local") || host.endsWith(".internal") ||
            /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) ||
            /^fe80:/i.test(host) || /^f[cd][0-9a-f]{2}:/i.test(host);
          if (privateHost) return jsonErr("target_url must be a public internet address");
        }

        const { data, error } = await sb().from("workspace_webhooks").insert({
          workspace_id: workspaceId,
          name,
          event_type,
          target_url,
          active: true,
        }).select("id, name, event_type, target_url, secret, active, created_at").single();

        if (error) return jsonErr(error.message, 500);

        return jsonOk({
          object: "webhook",
          ...data,
          note: "Store the secret now — it will not be shown again.",
        }, 201);
      },

      DELETE: async ({ request }) => {
        const auth = await authenticateV1Request(request, "webhooks:manage");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Invalid JSON body"); }

        const { id } = body ?? {};
        if (!id) return jsonErr("id is required");

        const { error } = await sb().from("workspace_webhooks")
          .delete()
          .eq("id", id)
          .eq("workspace_id", workspaceId);

        if (error) return jsonErr(error.message, 500);
        return jsonOk({ object: "webhook", id, deleted: true });
      },
    },
  },
});
