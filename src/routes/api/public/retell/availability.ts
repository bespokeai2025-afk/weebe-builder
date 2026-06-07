import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignature } from "@/lib/calendar/retell-signature";
import { getAvailableSlots } from "@/lib/calendar/calcom.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  timezone: z.string().min(1).max(64).optional(),
});

export const Route = createFileRoute("/api/public/retell/availability")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const rawBody = await request.text();
        if (!verifyRetellSignature(rawBody, request.headers.get("x-retell-signature"))) {
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 401,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const parsed = Body.safeParse(normalizeRetellPayload(rawBody));
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid body" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const { agent_id, start_date, end_date, timezone } = parsed.data;

        // agent_id here is the Retell agent id — find the owning workspace.
        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("user_id, workspace_id, settings")
          .or(`retell_agent_id.eq.${agent_id},settings->>deployedRetellAgentId.eq.${agent_id}`)
          .maybeSingle();

        if (!agentRow) {
          return new Response(JSON.stringify({ error: "agent not found" }), {
            status: 404,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const wsId = agentRow.workspace_id;
        const uid = agentRow.user_id;
        if (!wsId) {
          return new Response(JSON.stringify({ error: "agent has no workspace" }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const { data: settings } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key, default_event_type_id, calcom_event_type_id, timezone")
          .eq("workspace_id", wsId)
          .maybeSingle();

        // Per-agent override on settings.booking (preferred) or settings.calcom
        const agentSettings = (agentRow.settings ?? {}) as {
          calcom?: { apiKey?: string; eventTypeId?: string | number };
          booking?: { enabled?: boolean; eventTypeId?: string | number };
        };
        if (agentSettings.booking?.enabled === false) {
          return new Response(
            JSON.stringify({ error: "booking disabled for this agent", slots: [] }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
        const apiKey = agentSettings.calcom?.apiKey ?? settings?.calcom_api_key ?? null;
        let eventTypeId =
          Number(
            agentSettings.booking?.eventTypeId ||
              agentSettings.calcom?.eventTypeId ||
              settings?.default_event_type_id ||
              settings?.calcom_event_type_id ||
              0,
          ) || 0;

        // Fall back to the first active synced event type if no default set.
        if (!eventTypeId) {
          const { data: et } = await supabaseAdmin
            .from("calcom_event_types")
            .select("calcom_event_type_id")
            .eq("user_id", uid)
            .eq("active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          eventTypeId = Number(et?.calcom_event_type_id ?? 0) || 0;
        }

        if (!apiKey || !eventTypeId) {
          return new Response(JSON.stringify({ error: "calendar not configured", slots: [] }), {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        try {
          const slots = await getAvailableSlots(apiKey, {
            eventTypeId,
            startTime: start_date,
            endTime: end_date,
            timeZone: timezone ?? settings?.timezone ?? "UTC",
          });
          return new Response(
            JSON.stringify({
              slots: slots.map((s) => ({ start: s.time })),
              timezone: timezone ?? settings?.timezone ?? "UTC",
            }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[retell/availability]", e);
          return new Response(JSON.stringify({ error: "availability lookup failed", slots: [] }), {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
