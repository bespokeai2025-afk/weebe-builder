/**
 * WEBEE Mind API — Tool Catalog
 * GET /api/v1/minds/tools — full shared Mind tool inventory with allowance flags.
 *
 * Auth: Supabase user token (per-user allowed/deniedReason flags, identical
 * to the web catalog) OR workspace API key with `minds:read` (entitlement-
 * gated tools are marked not-allowed — execution needs a user token).
 */
import { createFileRoute } from "@tanstack/react-router";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";
import { jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

export const Route = createFileRoute("/api/v1/minds/tools")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateMindApiRequest(request, "minds:read");
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;
        try {
          const { buildMindToolCatalog } = await import("@/lib/minds/tool-catalog.functions");
          const { tools } = await buildMindToolCatalog(workspaceId, userId);
          return jsonOk({ object: "list", tools, total: tools.length });
        } catch (err: any) {
          return jsonErr(err?.message ?? "Failed to load tool catalog", 500);
        }
      },
    },
  },
});
