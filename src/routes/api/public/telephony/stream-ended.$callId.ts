/**
 * <Connect action> callback — Twilio asks what to do once a call's audio stream ends.
 *
 * Only numbers with a fallback number get this callback (see the inbound route). If the voice
 * engine could not take the call — the gateway marks `metadata.engine_failed` when it fails to
 * start — the caller is forwarded to the fallback number instead of being dropped. A call that
 * ended normally (the agent or caller hung up) is simply hung up.
 *
 * Every error path answers <Hangup/>: Twilio would otherwise read an "application error" message to
 * a caller who may still be on the line.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { escapeXml, verifyTwilioRequestForWorkspace } from "@/lib/telephony/inbound-routing.server";

const HANGUP = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

function twiml(xml: string) {
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export const Route = createFileRoute("/api/public/telephony/stream-ended/$callId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const callId = params.callId;
          const rawBody = await request.text().catch(() => "");
          const twilioParams: Record<string, string> = {};
          try {
            new URLSearchParams(rawBody).forEach((v, k) => {
              twilioParams[k] = v;
            });
          } catch {
            /* malformed body */
          }

          const { data: call } = await (supabaseAdmin as any)
            .from("telephony_calls")
            .select("id, workspace_id, phone_number_id, metadata")
            .eq("id", callId)
            .maybeSingle();
          if (!call) return twiml(HANGUP);

          const verified = await verifyTwilioRequestForWorkspace(
            supabaseAdmin,
            call.workspace_id as string,
            request,
            `/api/public/telephony/stream-ended/${callId}`,
            twilioParams,
          );
          if (!verified.ok) return new Response("Forbidden", { status: 403 });

          const metadata = (call.metadata ?? {}) as Record<string, unknown>;
          if (metadata.engine_failed !== true || !call.phone_number_id) return twiml(HANGUP);

          const { data: number } = await (supabaseAdmin as any)
            .from("phone_numbers")
            .select("fallback_number")
            .eq("id", call.phone_number_id)
            .maybeSingle();
          const fallback = String(number?.fallback_number ?? "").trim();
          if (!fallback) return twiml(HANGUP);

          console.log(`[telephony/stream-ended] call=${callId} engine failed → fallback ${fallback}`);
          return twiml(
            `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${escapeXml(fallback)}</Dial></Response>`,
          );
        } catch (err) {
          console.error("[telephony/stream-ended] error:", err instanceof Error ? err.message : err);
          return twiml(HANGUP);
        }
      },

      GET: async () => new Response("Twilio stream-ended webhook — POST only", { status: 405 }),
    },
  },
});
