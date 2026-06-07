import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyRetellSignature } from "@/lib/calendar/retell-signature";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

/**
 * Retell post-call webhook. Listens for `call_analyzed` events and writes
 * the extracted booking analysis fields into `booking_summaries`, linking the
 * record to the matching agent (and booking row when present).
 */
export const Route = createFileRoute("/api/public/retell/call-analyzed")({
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
        let payload: Record<string, unknown> = {};
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          return new Response(JSON.stringify({ error: "invalid json" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const event = String(payload.event ?? "");
        if (event && event !== "call_analyzed") {
          // Accept and ignore non-analysis events (call_started, call_ended, etc).
          return new Response(JSON.stringify({ ok: true, ignored: event }), {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const call = (payload.call ?? payload) as Record<string, unknown>;
        const callId = String(call.call_id ?? "");
        const retellAgentId = String(call.agent_id ?? "");
        if (!callId) {
          return new Response(JSON.stringify({ error: "missing call_id" }), {
            status: 400,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        const analysis = (call.call_analysis ?? {}) as Record<string, unknown>;
        const custom = (analysis.custom_analysis_data ?? {}) as Record<string, unknown>;

        // Resolve workspace agent row.
        const { data: agentRow } = await supabaseAdmin
          .from("agents")
          .select("id, user_id")
          .or(
            `retell_agent_id.eq.${retellAgentId},settings->>deployedRetellAgentId.eq.${retellAgentId}`,
          )
          .maybeSingle();

        if (!agentRow) {
          console.warn("[retell/call-analyzed] no agent match", { retellAgentId, callId });
          return new Response(JSON.stringify({ ok: true, matched: false }), {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }

        // Best-effort link to a booking created during this call.
        const { data: bookingRow } = await supabaseAdmin
          .from("bookings")
          .select("id, calcom_booking_uid")
          .eq("retell_call_id", callId)
          .maybeSingle();

        const summaryText =
          (custom.booking_summary as string | undefined) ??
          (analysis.call_summary as string | undefined) ??
          null;

        await supabaseAdmin
          .from("booking_summaries")
          .upsert(
            {
              user_id: agentRow.user_id,
              agent_id: agentRow.id,
              retell_agent_id: retellAgentId,
              call_id: callId,
              booking_id: bookingRow?.id ?? null,
              calcom_booking_uid: bookingRow?.calcom_booking_uid ?? null,
              summary: summaryText,
              appointment_reason: (custom.appointment_reason as string | undefined) ?? null,
              customer_name: (custom.customer_name as string | undefined) ?? null,
              customer_phone: (custom.customer_phone as string | undefined) ?? null,
              appointment_date: (custom.appointment_date as string | undefined) ?? null,
              appointment_booked: Boolean(custom.appointment_booked ?? bookingRow?.id),
              raw: call as never,
            },
            { onConflict: "call_id" },
          );

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      },
    },
  },
});
