import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createBooking, getCalcomUserTimezone } from "@/lib/calendar/calcom.server";
import { cacheDel } from "@/lib/cache/redis.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
  start: z.string().min(1),
  name: z.string().min(1).max(200),
  email: z.string().email().max(255),
  phone: z.string().min(1).max(40),
  notes: z.string().max(1000).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

function formatBookingTime(isoTime: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: timezone, timeZoneName: "short",
  }).format(new Date(isoTime));
}

export const Route = createFileRoute("/api/public/hyperstream/book")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

        const parsed = Body.safeParse(args);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid body", confirmation_message: "I couldn't complete the booking due to a request error." }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
        const d = parsed.data;

        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("user_id, workspace_id, settings")
          .eq("id", d.agent_id)
          .maybeSingle();

        if (!agentRow?.workspace_id) {
          return new Response(
            JSON.stringify({ ok: false, error: "agent not found", confirmation_message: "I wasn't able to complete the booking. Please try again." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const agentSettings = (agentRow.settings ?? {}) as { booking?: { enabled?: boolean; eventTypeId?: string | number } };
        if (agentSettings.booking?.enabled === false) {
          return new Response(
            JSON.stringify({ ok: false, error: "booking disabled", confirmation_message: "Booking is currently disabled. Please contact us directly." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key, default_event_type_id, calcom_event_type_id, timezone")
          .eq("workspace_id", agentRow.workspace_id)
          .maybeSingle();

        const apiKey = ws?.calcom_api_key ?? null;
        let eventTypeId = Number(agentSettings.booking?.eventTypeId || ws?.default_event_type_id || ws?.calcom_event_type_id || 0) || 0;

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
            JSON.stringify({ ok: false, error: "calendar not configured", confirmation_message: "The calendar isn't set up yet. Please contact us directly to book." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        let timezone = d.timezone ?? ws?.timezone ?? null;
        if (!timezone) timezone = await getCalcomUserTimezone(apiKey);
        timezone = timezone ?? "UTC";

        try {
          const booking = await createBooking(apiKey, {
            eventTypeId, start: d.start,
            name: d.name, email: d.email, phone: d.phone,
            notes: d.notes, timeZone: timezone,
          });

          await supabaseAdmin.from("calendar_bookings").insert({
            workspace_id: agentRow.workspace_id,
            external_id: booking.uid ?? String(booking.id),
            source: "hyperstream",
            title: `Consultation with ${d.name}`,
            attendee_name: d.name,
            attendee_email: d.email,
            attendee_phone: d.phone ?? null,
            start_at: booking.startTime,
            end_at: booking.endTime,
            status: "accepted" as const,
            meeting_url: booking.meetingUrl ?? null,
            notes: d.notes ?? null,
          });
          try {
            const { publishExecutiveEvent } = await import("@/lib/hivemind/executive-events.shared");
            await publishExecutiveEvent(supabaseAdmin, {
              workspaceId: agentRow.workspace_id,
              eventType: "booking_created",
              sourceSystem: "hyperstream",
              title: `Appointment booked with ${d.name}`,
              summary: `Booked for ${booking.startTime} via voice agent.`,
              entityType: "booking",
              entityId: String(booking.uid ?? booking.id),
              evidence: { source: "hyperstream", start: booking.startTime, attendee: d.name },
            });
          } catch { /* best-effort */ }
          cacheDel(
            `webee:hivemind:${agentRow.workspace_id}:platform`,
            `webee:growthmind:${agentRow.workspace_id}:platform`,
            `webee:dashboard:${agentRow.workspace_id}:overview`,
          ).catch(() => {});

          const displayTime = formatBookingTime(booking.startTime, timezone);
          let confirmationMessage = `Your appointment has been confirmed for ${displayTime}. A confirmation email has been sent to ${d.email}.`;
          if (booking.meetingUrl) confirmationMessage += ` Your meeting link is ${booking.meetingUrl}`;

          console.log("[hyperstream/book] Booking created", { uid: booking.uid, agent_id: d.agent_id, name: d.name, timezone });

          return new Response(
            JSON.stringify({ ok: true, booking_id: booking.uid, start: booking.startTime, end: booking.endTime, display_start: displayTime, meeting_url: booking.meetingUrl ?? null, confirmation_message: confirmationMessage }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[hyperstream/book]", e);
          const message = e instanceof Error ? e.message : "booking failed";
          return new Response(
            JSON.stringify({ ok: false, error: "booking failed", message, confirmation_message: `I'm sorry, I wasn't able to complete the booking. ${message}. Please try again or contact us directly.` }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
