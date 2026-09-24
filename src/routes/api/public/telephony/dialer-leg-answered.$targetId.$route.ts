/**
 * Auto Dialer — records which of the 2 route numbers actually answered.
 *
 * Twilio's `<Dial>` action callback only reports that a bridge happened, not
 * which `<Number>` picked up. Each `<Number>` in dialer-connect carries its
 * own `statusCallbackEvent="answered"` pointing here, tagged with its index
 * (0 or 1), so the run can show which of the two people took the call.
 *
 * Best-effort: nothing in the dialer's queue-advancement depends on this
 * route succeeding.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/public/telephony/dialer-leg-answered/$targetId/$route")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const targetId = params.targetId;
        const routeIndex = params.route === "1" ? 1 : 0;

        const { data: target } = await (supabaseAdmin as any)
          .from("dialer_targets")
          .select("id, session_id")
          .eq("id", targetId)
          .maybeSingle();
        if (!target) return jsonOk({ ok: false });

        const { data: session } = await (supabaseAdmin as any)
          .from("dialer_sessions")
          .select("route_numbers")
          .eq("id", target.session_id as string)
          .maybeSingle();
        const routeNumbers = (session?.route_numbers ?? []) as string[];
        const answeredNumber = routeNumbers[routeIndex] ?? null;

        if (answeredNumber) {
          await (supabaseAdmin as any)
            .from("dialer_targets")
            .update({ bridged_number: answeredNumber, updated_at: new Date().toISOString() })
            .eq("id", targetId);
        }

        return jsonOk({ ok: true });
      },

      GET: async () => new Response("Twilio dialer-leg-answered webhook — POST only", { status: 405 }),
    },
  },
});
