import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { rescheduleBooking } from "@/lib/calendar/calcom.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Body = z.object({
  agent_id: z.string().min(1).max(128),
  booking_id: z.string().min(1).max(128),
  new_start: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/hyperstream/reschedule")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        const args = (body?.args ?? body ?? {}) as Record<string, unknown>;

        const parsed = Body.safeParse(args);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ ok: false, error: "invalid body" }),
            { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
        const d = parsed.data;

        const { data: bookingRow } = await supabaseAdmin
          .from("calendar_bookings")
          .select("id, workspace_id")
          .eq("external_id", d.booking_id)
          .maybeSingle();

        if (!bookingRow?.workspace_id) {
          return new Response(
            JSON.stringify({ ok: false, error: "booking not found" }),
            { status: 404, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key")
          .eq("workspace_id", bookingRow.workspace_id)
          .maybeSingle();

        const apiKey = ws?.calcom_api_key;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ ok: false, error: "calendar not configured" }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        try {
          const updated = await rescheduleBooking(apiKey, d.booking_id, d.new_start, d.reason);
          await supabaseAdmin
            .from("calendar_bookings")
            .update({ start_at: updated.startTime, end_at: updated.endTime, status: "accepted" as const, external_id: updated.uid ?? d.booking_id })
            .eq("id", bookingRow.id);

          console.log("[hyperstream/reschedule]", { booking_id: d.booking_id, new_start: updated.startTime, agent_id: d.agent_id });
          return new Response(
            JSON.stringify({ ok: true, booking_id: updated.uid ?? d.booking_id, start: updated.startTime, end: updated.endTime, confirmation_message: `Rescheduled to ${updated.startTime}.` }),
            { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
          );
        } catch (e) {
          console.error("[hyperstream/reschedule]", e);
          const message = e instanceof Error ? e.message : "reschedule failed";
          return new Response(JSON.stringify({ ok: false, error: "reschedule failed", message }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
        }
      },
    },
  },
});
