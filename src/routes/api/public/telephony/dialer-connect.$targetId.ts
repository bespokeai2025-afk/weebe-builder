/**
 * Auto Dialer — TwiML fetched the instant the dialled target answers.
 *
 * Twilio requests this once the outbound leg to the target is picked up.
 * The response rings both route numbers simultaneously and bridges the call
 * to whichever answers first — `<Dial>` with multiple `<Number>` nouns is
 * Twilio's native behaviour for this, no conference needed.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveTwilioCredentialsForWorkspace } from "@/lib/telephony/twilio-credentials.server";
import { resolvePublicHost } from "@/lib/telephony/twilio-env";
import {
  IN_FLIGHT_TARGET_STATUSES,
  buildSimulRingTwiml,
  chooseRouteNumbers,
  isMachineAnswer,
} from "@/lib/telephony/auto-dialer.shared";
import { recordTargetOutcome } from "@/lib/telephony/auto-dialer-engine.server";

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
  return new Response(xml, { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

const HANGUP_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be connected.</Say><Hangup/></Response>`;

/** Every person is already on (or being rung for) another call — should not happen, see engine. */
const ALL_BUSY_TWIML =
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, everyone is on another call. We will call you back shortly.</Say><Hangup/></Response>`;

export const Route = createFileRoute("/api/public/telephony/dialer-connect/$targetId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const targetId = params.targetId;
        const rawBody = await request.text().catch(() => "");
        const twilioParams: Record<string, string> = {};
        try { new URLSearchParams(rawBody).forEach((v, k) => { twilioParams[k] = v; }); } catch {}

        const { data: target } = await (supabaseAdmin as any)
          .from("dialer_targets")
          .select("id, session_id, workspace_id")
          .eq("id", targetId)
          .maybeSingle();
        if (!target) return twimlResponse(HANGUP_TWIML);

        const { data: session } = await (supabaseAdmin as any)
          .from("dialer_sessions")
          .select("id, workspace_id, route_numbers, ring_timeout_secs, from_number, status")
          .eq("id", target.session_id as string)
          .maybeSingle();
        if (!session || session.status !== "running") return twimlResponse(HANGUP_TWIML);

        const credentials = await resolveTwilioCredentialsForWorkspace(
          supabaseAdmin,
          session.workspace_id as string,
        );

        if (credentials.authToken) {
          const sigHeader = request.headers.get("X-Twilio-Signature");
          const proto = request.headers.get("x-forwarded-proto") ?? "https";
          const host = request.headers.get("host") ?? "";
          const fullUrl = `${proto}://${host}/api/public/telephony/dialer-connect/${targetId}`;
          if (!verifyTwilioSignature(credentials.authToken, sigHeader, fullUrl, twilioParams)) {
            console.warn("[dialer-connect] Invalid Twilio signature — rejected");
            return new Response("Forbidden", { status: 403 });
          }
        }

        // Answering-machine screening (AUTO_DIALER_AMD=on): never ring our people for a voicemail.
        // Recorded as a no-answer; the lead's own "completed" callback then moves the queue on.
        const answeredBy = twilioParams["AnsweredBy"];
        if (isMachineAnswer(answeredBy)) {
          console.log(`[dialer-connect] target=${targetId} answered by ${answeredBy} — hanging up`);
          await recordTargetOutcome(supabaseAdmin as any, targetId, "no_answer", {
            error_message: `Voicemail detected (${answeredBy})`,
          });
          return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
        }

        // 1 route number is a plain bridge, 2 is the simul-ring race — see validateRouteNumbers.
        const routeNumbers = (session.route_numbers ?? []) as string[];
        if (routeNumbers.length < 1 || routeNumbers.length > 2) return twimlResponse(HANGUP_TWIML);

        // Ring only people who are free: never someone already on, or being rung for, another
        // lead of this run.
        const { data: others } = await (supabaseAdmin as any)
          .from("dialer_targets")
          .select("id, status, bridged_number")
          .eq("session_id", target.session_id as string)
          .neq("id", targetId)
          .in("status", IN_FLIGHT_TARGET_STATUSES);
        const chosen = chooseRouteNumbers({ routeNumbers, otherLive: others ?? [] });
        if (chosen.length === 0) {
          await (supabaseAdmin as any)
            .from("dialer_targets")
            .update({
              status: "failed",
              error_message: "Answered while every person was on another call",
              updated_at: new Date().toISOString(),
            })
            .eq("id", targetId);
          return twimlResponse(ALL_BUSY_TWIML);
        }

        await (supabaseAdmin as any)
          .from("dialer_targets")
          .update({
            status: "connecting",
            bridged_number: chosen.map((c) => c.number).join(","),
            updated_at: new Date().toISOString(),
          })
          .eq("id", targetId);

        const publicHost = resolvePublicHost();
        const twiml = buildSimulRingTwiml({
          routeNumbers: chosen.map((c) => c.number),
          timeoutSecs: (session.ring_timeout_secs as number) ?? 20,
          actionUrl: `${publicHost}/api/public/telephony/dialer-result/${targetId}`,
          // Keyed by the person's position in the session, so "answered by" stays right.
          legAnsweredUrls: chosen.map(
            (c) => `${publicHost}/api/public/telephony/dialer-leg-answered/${targetId}/${c.index}`,
          ),
          callerId: (session.from_number as string) ?? "",
        });

        return twimlResponse(twiml);
      },

      GET: async () => new Response("Twilio dialer-connect webhook — POST only", { status: 405 }),
    },
  },
});
