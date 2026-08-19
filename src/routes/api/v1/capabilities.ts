/**
 * WEBEE Mind API — Workspace capabilities
 * GET /api/v1/capabilities
 *
 * Which product capabilities are active for the workspace (package
 * entitlements ∩ real configuration) plus the notification capability map —
 * so a mobile client can decide which surfaces/notification categories to
 * show without hardcoding package logic.
 *
 * Auth: dual (Supabase user JWT with X-Workspace-Id, or workspace API key).
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/capabilities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read");
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        try {
          const [{ getWorkspaceNotificationCapabilities, applicableEventKeys }, { getWorkspaceEntitlements }] =
            await Promise.all([
              import("@/lib/notifications/notification-capabilities.server"),
              import("@/lib/packages/entitlements.server"),
            ]);
          const [caps, ent] = await Promise.all([
            getWorkspaceNotificationCapabilities(workspaceId),
            getWorkspaceEntitlements(workspaceId),
          ]);

          // Per-user effective access only when we know WHO is calling
          // (JWT path). API-key callers get workspace-level data only.
          let access: any = null;
          if (userId) {
            const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
            const perms = await resolvePermissions(workspaceId, userId);
            access = {
              role_key: perms.roleKey ?? null,
              assigned_records_only: perms.assignedRecordsOnly === true,
              actions: perms.actionAccess ?? {},
            };
          }

          return jsonOk({
            object: "capabilities",
            workspace_id: workspaceId,
            features: ent.features ?? {},
            notification_capabilities: caps,
            applicable_notification_events: applicableEventKeys(caps),
            user_access: access,
          });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to resolve capabilities", 500);
        }
      },
    },
  },
});
