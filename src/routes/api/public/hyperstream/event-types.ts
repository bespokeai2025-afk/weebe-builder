import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { listEventTypes } from "@/lib/calendar/calcom.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
});

export const Route = createFileRoute("/api/public/hyperstream/event-types")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

        const parsed = Body.safeParse(args);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "agent_id required", event_types: [], summary: "No appointment types found." }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
        const { agent_id } = parsed.data;

        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("workspace_id")
          .eq("id", agent_id)
          .maybeSingle();

        if (!agentRow?.workspace_id) {
          return new Response(
            JSON.stringify({ error: "agent not found", event_types: [], summary: "No appointment types found." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key")
          .eq("workspace_id", agentRow.workspace_id)
          .maybeSingle();

        const apiKey = ws?.calcom_api_key;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "calendar not configured", event_types: [], summary: "No appointment types are configured yet." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        try {
          const types = await listEventTypes(apiKey);
          const event_types = types.map((t) => ({ id: t.id, title: t.title, duration_minutes: t.length, slug: t.slug }));
          let summary: string;
          if (event_types.length === 0) {
            summary = "There are no appointment types available at the moment.";
          } else if (event_types.length === 1) {
            summary = `I can book a ${event_types[0].title} (${event_types[0].duration_minutes} minutes) for you.`;
          } else {
            summary = `I can offer the following appointment types: ${event_types.map((t) => `${t.title} (${t.duration_minutes} min)`).join(", ")}. Which would you like?`;
          }
          console.log("[hyperstream/event-types]", { agent_id, count: event_types.length });
          return new Response(
            JSON.stringify({ event_types, event_type_count: event_types.length, summary }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[hyperstream/event-types]", e);
          return new Response(
            JSON.stringify({ error: "lookup failed", event_types: [], summary: "I'm having trouble loading appointment types. Please try again." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
