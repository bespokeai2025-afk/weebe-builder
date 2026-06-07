import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignature } from "@/lib/calendar/retell-signature";
import { cancelBooking } from "@/lib/calendar/calcom.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

const Body = z.object({
  booking_id: z.string().min(1).max(128), // Cal.com booking UID
  reason: z.string().max(500).optional(),
});

export const Route = createFileRoute("/api/public/retell/cancel")({
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

        const { data: bookingRow } = await supabaseAdmin
          .from("bookings")
          .select("id, user_id, workspace_id, agent_id")
          .eq("calcom_booking_uid", parsed.data.booking_id)
          .maybeSingle();
        if (!bookingRow) {
          return new Response(JSON.stringify({ error: "booking not found" }), {
            status: 404,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const bkWsId = bookingRow.workspace_id;
        if (!bkWsId) {
          return new Response(JSON.stringify({ error: "booking has no workspace" }), {
            status: 500,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const { data: settings } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_api_key")
          .eq("workspace_id", bkWsId)
          .maybeSingle();
        const apiKey = settings?.calcom_api_key;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "calendar not configured" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        try {
          await cancelBooking(apiKey, parsed.data.booking_id, parsed.data.reason);
          await supabaseAdmin
            .from("bookings")
            .update({ status: "cancelled" })
            .eq("id", bookingRow.id);
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("[retell/cancel]", e);
          return new Response(JSON.stringify({ ok: false, error: "cancel failed" }), {
            status: 502,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
