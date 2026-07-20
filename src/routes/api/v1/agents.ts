/**
 * WEBEE Developer API v1 — Agents
 * GET /api/v1/agents — list workspace agents (agents:read)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/agents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "agents:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const { data, error } = await sb().from("agents")
          .select("id, name, inbound_phone_number, created_at, updated_at, settings")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false });

        if (error) return jsonErr(error.message, 500);

        const agents = (data ?? []).map(a => ({
          id:               a.id,
          name:             a.name,
          phone_number:     a.inbound_phone_number ?? null,
          is_deployed:      !!(a.settings?.deployedRetellAgentId || a.settings?.deployedElevenLabsAgentId),
          provider:         "webee_voice",
          created_at:       a.created_at,
          updated_at:       a.updated_at,
        }));

        return jsonOk({ object: "list", data: agents });
      },
    },
  },
});
