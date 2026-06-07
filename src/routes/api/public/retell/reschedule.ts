import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignature } from "@/lib/calendar/retell-signature";
import { rescheduleBooking } from "@/lib/calendar/calcom.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

const Body = z.object({
  booking_id: z.string().min(1).max(128),
  new_start: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/retell/reschedule")({
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

        const { data: bookingRow } = await supabaseAdmin
          .from("bookings")
          .select("id, user_id, workspace_id, agent_id")
          .eq("calcom_booking_uid", d.booking_id)
          .maybeSingle();
        if (!bookingRow) {
          return new Response(JSON.stringify({ error: "booking not found" }), {
            status: 404,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const rswsId = bookingRow.workspace_id;
        if (!rswsId) {
          return new Response(JSON.stringify({ error: "booking has no workspace" }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const { data: settings } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key")
          .eq("workspace_id", rswsId)
          .maybeSingle();
        const apiKey = settings?.calcom_api_key;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "calendar not configured" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        try {
          const updated = await rescheduleBooking(apiKey, d.booking_id, d.new_start, d.reason);
          await supabaseAdmin
            .from("bookings")
            .update({
              start_at: updated.startTime,
              end_at: updated.endTime,
              status: "confirmed",
              calcom_booking_uid: updated.uid ?? d.booking_id,
            })
            .eq("id", bookingRow.id);

          console.log("[retell/reschedule]", {
            booking_id: d.booking_id,
            new_start: updated.startTime,
          });

          return new Response(
            JSON.stringify({
              ok: true,
              booking_id: updated.uid ?? d.booking_id,
              start: updated.startTime,
              end: updated.endTime,
              confirmation_message: `Rescheduled to ${updated.startTime}.`,
            }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[retell/reschedule]", e);
          const message = e instanceof Error ? e.message : "reschedule failed";
          return new Response(JSON.stringify({ ok: false, error: "reschedule failed", message }), {
            status: 502,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
