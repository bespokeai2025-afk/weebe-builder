import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignature } from "@/lib/calendar/retell-signature";
import { createBooking } from "@/lib/calendar/calcom.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
  start: z.string().min(1),
  name: z.string().min(1).max(200),
  email: z.string().email().max(255),
  phone: z.string().max(40).optional(),
  notes: z.string().max(1000).optional(),
  timezone: z.string().min(1).max(64).optional(),
  retell_call_id: z.string().max(128).optional(),
});

export const Route = createFileRoute("/api/public/retell/book")({
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
          return new Response(
            JSON.stringify({ error: "invalid body", details: parsed.error.flatten() }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
        const d = parsed.data;


        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("id, user_id, settings")
          .or(`retell_agent_id.eq.${d.agent_id},settings->>deployedRetellAgentId.eq.${d.agent_id}`)
          .maybeSingle();
        if (!agentRow) {
          return new Response(JSON.stringify({ error: "agent not found" }), {
            status: 404,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const { data: settings } = await supabaseAdmin
          .from("workspace_calendar_settings")
          .select("calcom_api_key, default_event_type_id, timezone")
          .eq("user_id", agentRow.user_id)
          .maybeSingle();

        const agentSettings = (agentRow.settings ?? {}) as {
          calcom?: { apiKey?: string; eventTypeId?: string | number };
          booking?: { enabled?: boolean; eventTypeId?: string | number };
        };
        if (agentSettings.booking?.enabled === false) {
          return new Response(JSON.stringify({ error: "booking disabled for this agent" }), {
            status: 403,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
        const apiKey = agentSettings.calcom?.apiKey ?? settings?.calcom_api_key ?? null;
        let eventTypeId =
          Number(
            agentSettings.booking?.eventTypeId ||
              agentSettings.calcom?.eventTypeId ||
              settings?.default_event_type_id ||
              0,
          ) || 0;
        const timezone = d.timezone ?? settings?.timezone ?? "UTC";

        if (!eventTypeId) {
          const { data: et } = await supabaseAdmin
            .from("calcom_event_types")
            .select("calcom_event_type_id")
            .eq("user_id", agentRow.user_id)
            .eq("active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          eventTypeId = Number(et?.calcom_event_type_id ?? 0) || 0;
        }

        if (!apiKey || !eventTypeId) {
          return new Response(
            JSON.stringify({ error: "calendar not configured" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        try {
          const booking = await createBooking(apiKey, {
            eventTypeId,
            start: d.start,
            name: d.name,
            email: d.email,
            phone: d.phone,
            notes: d.notes,
            timeZone: timezone,
          });

          await supabaseAdmin.from("bookings").insert({
            user_id: agentRow.user_id,
            agent_id: agentRow.id,
            calcom_booking_id: booking.id,
            calcom_booking_uid: booking.uid,
            event_type_id: eventTypeId,
            attendee_name: d.name,
            attendee_email: d.email,
            attendee_phone: d.phone ?? null,
            start_at: booking.startTime,
            end_at: booking.endTime,
            status: "confirmed",
            retell_call_id: d.retell_call_id ?? null,
            notes: d.notes ?? null,
            raw: booking as unknown as never,
          });

          return new Response(
            JSON.stringify({
              ok: true,
              booking_id: booking.uid,
              start: booking.startTime,
              end: booking.endTime,
              confirmation_message: `Booked ${d.name} for ${booking.startTime}.`,
            }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[retell/book]", e);
          const message = e instanceof Error ? e.message : "booking failed";
          return new Response(
            JSON.stringify({ ok: false, error: "booking failed", message }),
            { status: 502, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
