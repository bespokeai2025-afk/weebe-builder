/**
 * WEBEE Developer API v1 — Agent Archive
 * POST /api/v1/agents/archive — archive (soft-delete) an agent (agents:archive)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/agents/archive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "agents:archive");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); } catch { return jsonErr("Invalid JSON body"); }

        const { agent_id } = body ?? {};
        if (!agent_id) return jsonErr("agent_id is required");

        const { data: agent, error: fetchErr } = await sb().from("agents")
          .select("id, name, settings")
          .eq("id", agent_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (fetchErr) return jsonErr(fetchErr.message, 500);
        if (!agent) return jsonErr("Agent not found", 404);

        const updatedSettings = {
          ...(agent.settings as object ?? {}),
          archived: true,
          archived_at: new Date().toISOString(),
          archived_via: "api",
        };

        const { error: updateErr } = await sb().from("agents")
          .update({ settings: updatedSettings, updated_at: new Date().toISOString() })
          .eq("id", agent_id)
          .eq("workspace_id", workspaceId);

        if (updateErr) return jsonErr(updateErr.message, 500);

        return jsonOk({
          object:     "agent",
          id:         agent.id,
          name:       agent.name,
          status:     "archived",
          archived_at: updatedSettings.archived_at,
        });
      },
    },
  },
});
