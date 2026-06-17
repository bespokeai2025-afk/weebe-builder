/**
 * Public Twilio inbound-call webhook.
 *
 * Twilio hits this URL when a call comes in to one of our registered numbers.
 * Validates the Twilio signature when TWILIO_AUTH_TOKEN is set.
 *
 * Flow:
 *  1. Verify Twilio signature (when auth token present)
 *  2. Parse To / From / CallSid from form body
 *  3. Look up workspace + agent from phone_numbers table
 *  4. Create telephony_calls row
 *  5. Respond with TwiML  <Connect><Stream …/>  to open the audio bridge
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Verify a Twilio request signature.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function verifyTwilioSignature(
  authToken: string,
  twilioSignature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!twilioSignature) return false;
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(twilioSignature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

function twimlResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function rejectTwiml(message = "Sorry, this number is not currently active.") {
  return twimlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say><Hangup/></Response>`,
  );
}

export const Route = createFileRoute("/api/public/telephony/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Read raw body for Twilio signature verification
        const rawBody = await request.text().catch(() => "");
        const params: Record<string, string> = {};
        try {
          new URLSearchParams(rawBody).forEach((v, k) => { params[k] = v; });
        } catch {}

        const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN ?? "";
        if (twilioAuthToken) {
          const sigHeader  = request.headers.get("X-Twilio-Signature");
          const proto      = request.headers.get("x-forwarded-proto") ?? "https";
          const host       = request.headers.get("host") ?? "";
          const fullUrl    = `${proto}://${host}/api/public/telephony/inbound`;
          if (!verifyTwilioSignature(twilioAuthToken, sigHeader, fullUrl, params)) {
            console.warn("[telephony/inbound] Invalid Twilio signature — rejected");
            return new Response("Forbidden", { status: 403 });
          }
        }

        const callSid = params["CallSid"] ?? "";
        const to      = params["To"]      ?? "";
        const from    = params["From"]    ?? "";

        if (!callSid || !to) return rejectTwiml();

        // Find the phone number → workspace → agent
        const { data: numberRow } = await supabaseAdmin
          .from("phone_numbers")
          .select("id, workspace_id, agent_id, is_active")
          .eq("phone_number", to)
          .eq("is_active", true)
          .maybeSingle();

        if (!numberRow) {
          console.log("[telephony/inbound] unknown number:", to);
          return rejectTwiml();
        }

        // Insert telephony_calls row
        const { data: callRow, error: insertErr } = await supabaseAdmin
          .from("telephony_calls")
          .insert({
            workspace_id: numberRow.workspace_id,
            phone_number_id: numberRow.id,
            agent_id: numberRow.agent_id,
            call_sid: callSid,
            direction: "inbound",
            from_number: from,
            to_number: to,
            status: "ringing",
            provider: "twilio",
          })
          .select("id")
          .single();

        if (insertErr) {
          console.error("[telephony/inbound] DB insert error:", insertErr.message);
          return rejectTwiml("Sorry, we could not connect your call.");
        }

        await supabaseAdmin.from("call_events").insert({
          call_id: callRow.id,
          workspace_id: numberRow.workspace_id,
          event_type: "status_change",
          event_data: { from: "initiated", to: "ringing", callSid },
        });

        // Build stream URL for the audio bridge
        const host = request.headers.get("host") ?? "";
        const streamUrl = `wss://${host}/api/telephony/stream/${callRow.id}`;

        const twiml =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<Response>\n` +
          `  <Connect>\n` +
          `    <Stream url="${streamUrl}" />\n` +
          `  </Connect>\n` +
          `</Response>`;

        console.log(`[telephony/inbound] callSid=${callSid} callId=${callRow.id} from=${from}`);
        return twimlResponse(twiml);
      },

      GET: async () =>
        new Response("Twilio inbound webhook — POST only", { status: 405 }),
    },
  },
});
