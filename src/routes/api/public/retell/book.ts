import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignatureMultiKey } from "@/lib/calendar/retell-signature";
import { resolveRetellCandidateKeysByAgent } from "@/lib/calendar/retell-key-lookup";
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

function formatBookingTime(isoTime: string, timezone: string): string {
  const d = new Date(isoTime);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
    timeZoneName: "short",
  }).format(d);
}

export const Route = createFileRoute("/api/public/retell/book")({
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

        const candidateKeys = await resolveRetellCandidateKeysByAgent(bodyAgentId);

        if (!verifyRetellSignatureMultiKey(rawBody, sig, candidateKeys)) {
          console.warn("[retell/book] Signature verification failed", { agentId: bodyAgentId });
          return new Response(JSON.stringify({ error: "invalid signature" }), {
            status: 401,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const parsed = Body.safeParse(normalizeRetellPayload(rawBody));
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid body", details: parsed.error.flatten() }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
        const d = parsed.data;

        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("id, user_id, workspace_id, settings")
          .or(`retell_agent_id.eq.${d.agent_id},settings->>deployedRetellAgentId.eq.${d.agent_id}`)
          .maybeSingle();
        if (!agentRow?.workspace_id) {
          return new Response(
            JSON.stringify({ ok: false, error: "agent not found", confirmation_message: "I wasn't able to complete the booking. Please try again." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const wsId = agentRow.workspace_id;
        const uid = agentRow.user_id;

        const { data: settings } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key, default_event_type_id, calcom_event_type_id, timezone")
          .eq("workspace_id", wsId)
          .maybeSingle();

        const agentSettings = (agentRow.settings ?? {}) as {
          calcom?: { apiKey?: string; eventTypeId?: string | number };
          booking?: { enabled?: boolean; eventTypeId?: string | number };
        };
        if (agentSettings.booking?.enabled === false) {
          return new Response(
            JSON.stringify({ ok: false, error: "booking disabled", confirmation_message: "Booking is currently disabled. Please contact us directly." }),
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
        const timezone = d.timezone ?? settings?.timezone ?? "UTC";

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
          return new Response(
            JSON.stringify({ ok: false, error: "calendar not configured", confirmation_message: "The calendar isn't set up yet. Please contact us directly to book." }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
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
            workspace_id: wsId,
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

          const displayTime = formatBookingTime(booking.startTime, timezone);
          let confirmationMessage = `Your appointment has been confirmed for ${displayTime}. A confirmation email has been sent to ${d.email}.`;
          if (booking.meetingUrl) {
            confirmationMessage += ` Your meeting link is ${booking.meetingUrl}`;
          }

          console.log("[retell/book] Booking created", { uid: booking.uid, agent_id: d.agent_id, name: d.name });

          return new Response(
            JSON.stringify({
              ok: true,
              booking_id: booking.uid,
              start: booking.startTime,
              end: booking.endTime,
              display_start: displayTime,
              meeting_url: booking.meetingUrl ?? null,
              confirmation_message: confirmationMessage,
            }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[retell/book]", e);
          const message = e instanceof Error ? e.message : "booking failed";
          return new Response(
            JSON.stringify({
              ok: false,
              error: "booking failed",
              message,
              confirmation_message: `I'm sorry, I wasn't able to complete the booking. ${message}. Please try again or contact us directly.`,
            }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
