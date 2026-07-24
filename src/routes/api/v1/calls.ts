/**
 * WEBEE Developer API v1 — Calls
 * GET  /api/v1/calls          — list call logs (calls:read)
 * POST /api/v1/calls/trigger  — trigger outbound AI call (calls:trigger)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/calls")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "calls:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url   = new URL(request.url);
        const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        const since  = url.searchParams.get("since");

        let q = sb().from("calls")
          .select("id, agent_id, agent_name, call_status, call_successful, duration_seconds, sentiment, started_at, call_type")
          .eq("workspace_id", workspaceId)
          .order("started_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (since) q = q.gte("started_at", since);

        const { data, error } = await q;
        if (error) return jsonErr(error.message, 500);

        return jsonOk({ object: "list", data: data ?? [], limit, offset });
      },

      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "calls:trigger");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Invalid JSON body"); }

        const { agent_id, to_number, lead_id, metadata } = body ?? {};
        if (!agent_id) return jsonErr("agent_id is required");
        if (!to_number) return jsonErr("to_number is required");

        // Verify agent belongs to workspace
        const { data: agent } = await sb().from("agents")
          .select("id, name, retell_agent_id, settings, inbound_phone_number")
          .eq("id", agent_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (!agent) return jsonErr("Agent not found or does not belong to this workspace", 404);

        const retellAgentId = agent.retell_agent_id ?? agent.settings?.deployedRetellAgentId;
        const retellApiKey  = process.env.RETELL_API_KEY ?? "";

        if (!retellAgentId || !retellApiKey) {
          return jsonErr("Agent is not deployed to WEBEE Voice. Deploy the agent first.", 422);
        }

        // Trigger via Retell (internal — not exposed to customer as "Retell")
        const retellRes = await fetch("https://api.retellai.com/v2/create-phone-call", {
          method: "POST",
          headers: {
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${retellApiKey}`,
          },
          body: JSON.stringify({
            from_number:    agent.inbound_phone_number ?? "+15005550006",
            to_number,
            override_agent_id: retellAgentId,
            retell_llm_dynamic_variables: { api_trigger: "true", ...(metadata ?? {}) },
          }),
        });

        if (!retellRes.ok) {
          const errBody = await retellRes.text();
          console.error("[api/v1/calls] Retell error:", errBody);
          return jsonErr("Failed to initiate WEBEE Voice call. Check agent configuration.", 502);
        }

        const retellCall: any = await retellRes.json();

        return jsonOk({
          object:      "call",
          call_id:     retellCall.call_id,
          agent_id,
          to_number,
          status:      "initiated",
          provider:    "webee_voice",
          initiated_at: new Date().toISOString(),
        }, 201);
      },
    },
  },
});
