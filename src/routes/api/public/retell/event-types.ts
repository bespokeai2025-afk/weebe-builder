import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignatureMultiKey } from "@/lib/calendar/retell-signature";
import { listEventTypes } from "@/lib/calendar/calcom.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

export const Route = createFileRoute("/api/public/retell/event-types")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const sig = request.headers.get("x-retell-signature");

        let bodyAgentId: string | undefined;
        try {
          const quick = JSON.parse(rawBody) as Record<string, unknown>;
          const args = (quick.args ?? {}) as Record<string, unknown>;
          const call = (quick.call ?? {}) as Record<string, unknown>;
          bodyAgentId =
            (args.agent_id as string) ??
            (call.agent_id as string) ??
            (quick.agent_id as string) ??
            undefined;
        } catch { /* ignore */ }

        const candidateKeys: string[] = [];
        if (bodyAgentId) {
          const { data: agentLookup } = await supabaseAdmin
            .from("agents")
            .select("workspace_id")
            .or(`retell_agent_id.eq.${bodyAgentId},settings->>deployedRetellAgentId.eq.${bodyAgentId}`)
            .maybeSingle();
          if (agentLookup?.workspace_id) {
            const { data: wsLookup } = await supabaseAdmin
              .from("workspace_settings")
              .select("retell_workspace_id")
              .eq("workspace_id", agentLookup.workspace_id)
              .maybeSingle();
            const wk = wsLookup?.retell_workspace_id?.trim();
            if (wk && wk.startsWith("key_")) candidateKeys.push(wk);
          }
        }

        if (!verifyRetellSignatureMultiKey(rawBody, sig, candidateKeys)) {
          console.warn("[retell/event-types] Signature verification failed", { agentId: bodyAgentId });
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 401,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const payload = normalizeRetellPayload(rawBody);
        const agent_id = (payload.agent_id as string | undefined) ?? bodyAgentId;
        if (!agent_id) {
          return new Response(JSON.stringify({ error: "agent_id required" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("workspace_id")
          .or(`retell_agent_id.eq.${agent_id},settings->>deployedRetellAgentId.eq.${agent_id}`)
          .maybeSingle();

        if (!agentRow?.workspace_id) {
          return new Response(
            JSON.stringify({ error: "agent not found", event_types: [], summary: "No appointment types found." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const { data: settings } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key")
          .eq("workspace_id", agentRow.workspace_id)
          .maybeSingle();

        const apiKey = settings?.calcom_api_key;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "calendar not configured", event_types: [], summary: "No appointment types are configured yet." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        try {
          const types = await listEventTypes(apiKey);
          const event_types = types.map((t) => ({
            id: t.id,
            title: t.title,
            duration_minutes: t.length,
            slug: t.slug,
          }));

          let summary: string;
          if (event_types.length === 0) {
            summary = "There are no appointment types available at the moment.";
          } else if (event_types.length === 1) {
            const t = event_types[0];
            summary = `I can book a ${t.title} (${t.duration_minutes} minutes) for you.`;
          } else {
            const list = event_types
              .map((t) => `${t.title} (${t.duration_minutes} min)`)
              .join(", ");
            summary = `I can offer the following appointment types: ${list}. Which would you like?`;
          }

          console.log("[retell/event-types]", { agent_id, count: event_types.length });
          return new Response(
            JSON.stringify({ event_types, event_type_count: event_types.length, summary }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[retell/event-types]", e);
          return new Response(
            JSON.stringify({ error: "lookup failed", event_types: [], summary: "I'm having trouble loading appointment types. Please try again." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
