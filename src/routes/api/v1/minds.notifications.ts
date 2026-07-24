/**
 * WEBEE Mind API — In-app notifications
 * GET  /api/v1/minds/notifications[?unread_only=true&severity=critical&limit=50]
 * POST /api/v1/minds/notifications — body { "ids": [...] } or { "all": true }
 *      → mark the caller's notifications read.
 *
 * Auth: Supabase user token ONLY (notification visibility and read-state
 * are per-recipient).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/minds/notifications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        const url = new URL(request.url);
        const unreadOnly = url.searchParams.get("unread_only") === "true";
        const severity = url.searchParams.get("severity") ?? undefined;
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50") || 50, 1), 200);

        try {
          const { listWorkspaceNotificationsCore } = await import("@/lib/notifications/notifications.functions");
          const rows = await listWorkspaceNotificationsCore(workspaceId, userId!, {
            limit,
            unreadOnly,
            severity,
          });
          return jsonOk({ object: "list", notifications: rows, total: rows.length });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to load notifications";
          return jsonErr(msg, /not a member/i.test(msg) ? 403 : 500);
        }
      },

      POST: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        let body: { ids?: string[]; all?: boolean };
        try {
          body = z
            .object({
              ids: z.array(z.string().uuid()).max(200).optional(),
              all: z.boolean().optional(),
            })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { ids } or { all: true }"}`, 400);
        }
        if (!body.all && !(body.ids?.length)) {
          return jsonErr("Provide { ids: [...] } or { all: true }", 400);
        }

        try {
          const { markNotificationsReadCore } = await import("@/lib/notifications/notifications.functions");
          const out = await markNotificationsReadCore(workspaceId, userId!, body);
          return jsonOk(out);
        } catch (err: any) {
          const msg = err?.message ?? "Failed to mark notifications read";
          return jsonErr(msg, /not a member/i.test(msg) ? 403 : 500);
        }
      },
    },
  },
});
