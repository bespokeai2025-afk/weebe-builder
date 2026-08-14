/**
 * WEBEE Mind API — Notification catalogue + workspace policy
 * GET /api/v1/notifications/catalogue
 *
 * The full notification event catalogue (labels, categories, severities,
 * capabilities), which events are applicable to this workspace, and the
 * workspace's effective per-event policy (defaults merged with saved rows).
 * Read-only; policy edits stay in the web Settings UI (admin-gated).
 *
 * Auth: dual (Supabase user JWT with X-Workspace-Id, or workspace API key).
 * Recipient configs / custom emails are NOT exposed here — they can name
 * other people and are settings-page (admin) material.
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/notifications/catalogue")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        try {
          const [shared, capsMod] = await Promise.all([
            import("@/lib/notifications/notification-engine.shared"),
            import("@/lib/notifications/notification-capabilities.server"),
          ]);
          const {
            NOTIFICATION_EVENT_KEYS,
            NOTIFICATION_EVENT_LABELS,
            NOTIFICATION_EVENT_DEFS,
            severityForEvent,
            defaultSettingsForEvent,
          } = shared as any;

          const caps = await capsMod.getWorkspaceNotificationCapabilities(workspaceId);
          const applicable = new Set(capsMod.applicableEventKeys(caps));

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: rows, error } = await (supabaseAdmin as any)
            .from("workspace_notification_settings")
            .select("event_key, enabled, email_enabled, in_app_enabled, frequency, lead_filter")
            .eq("workspace_id", workspaceId);
          if (error) return jsonErr(`Failed to load workspace policy: ${error.message}`, 500);
          const rowMap = new Map<string, any>((rows ?? []).map((r: any) => [r.event_key, r]));

          const events = NOTIFICATION_EVENT_KEYS.map((key: string) => {
            const def = NOTIFICATION_EVENT_DEFS[key];
            const saved = rowMap.get(key);
            const defaults = defaultSettingsForEvent(key);
            return {
              key,
              label: NOTIFICATION_EVENT_LABELS[key] ?? key,
              category: def?.category ?? "core",
              capability: def?.capability ?? "core",
              severity: severityForEvent(key),
              applicable: applicable.has(key),
              policy: {
                enabled: saved ? saved.enabled !== false : defaults.enabled,
                email_enabled: saved ? saved.email_enabled !== false : defaults.emailEnabled,
                in_app_enabled: saved ? saved.in_app_enabled !== false : defaults.inAppEnabled,
                frequency: saved?.frequency ?? defaults.frequency,
                has_lead_filter: saved?.lead_filter != null,
                source: saved ? "workspace" : "default",
              },
            };
          });

          return jsonOk({
            object: "notification_catalogue",
            workspace_id: workspaceId,
            capabilities: caps,
            events,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to load notification catalogue", 500);
        }
      },
    },
  },
});
