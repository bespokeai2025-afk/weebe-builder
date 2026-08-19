/**
 * WEBEE Mind API — Personal notification preferences
 * GET /api/v1/notifications/preferences        — the caller's muted events
 * PUT /api/v1/notifications/preferences        — replace muted event set
 *      body: { "muted_event_keys": ["campaign_completed", ...] }
 *
 * Auth: Supabase user JWT ONLY (preferences are per-person; an API key has
 * no person). Critical-severity events can never be muted.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/notifications/preferences")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;
        try {
          const { getUserNotificationPrefsCore } = await import(
            "@/lib/notifications/user-notification-prefs.server"
          );
          const prefs = await getUserNotificationPrefsCore(workspaceId, userId!);
          return jsonOk({
            object: "notification_preferences",
            workspace_id: workspaceId,
            muted_event_keys: prefs.mutedEventKeys,
            updated_at: prefs.updatedAt,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to load preferences", 500);
        }
      },

      PUT: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read", { requireUser: true });
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        let body: { muted_event_keys: string[] };
        try {
          body = z
            .object({ muted_event_keys: z.array(z.string()).max(200) })
            .parse(await request.json());
        } catch (err: any) {
          return jsonErr(`Invalid request body: ${err?.message ?? "expected { muted_event_keys: [...] }"}`, 400);
        }

        try {
          const { updateUserNotificationPrefsCore } = await import(
            "@/lib/notifications/user-notification-prefs.server"
          );
          const prefs = await updateUserNotificationPrefsCore(workspaceId, userId!, body.muted_event_keys);
          return jsonOk({
            object: "notification_preferences",
            workspace_id: workspaceId,
            muted_event_keys: prefs.mutedEventKeys,
            updated_at: prefs.updatedAt,
          });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to save preferences";
          const bad = /Unknown notification event key|Critical events|must be an array|Too many/.test(msg);
          return jsonErr(msg, bad ? 400 : 500);
        }
      },
    },
  },
});
