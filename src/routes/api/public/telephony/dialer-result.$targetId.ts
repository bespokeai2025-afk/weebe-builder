/**
 * Auto Dialer — `<Dial>` action callback for the lead leg.
 *
 * Twilio posts here once the simul-ring `<Dial>` in dialer-connect finishes,
 * whether it bridged to one of the 2 route numbers or nobody picked up.
 * This is the primary point that advances the queue to the next target.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveTwilioCredentialsForWorkspace } from "@/lib/telephony/twilio-credentials.server";
import { mapDialResultStatus } from "@/lib/telephony/auto-dialer.shared";
import {
  claimDialerAdvance,
  dialNextDialerTarget,
  recordTargetOutcome,
} from "@/lib/telephony/auto-dialer-engine.server";

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

const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

export const Route = createFileRoute("/api/public/telephony/dialer-result/$targetId")({
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
        if (!target) return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });

        try {
          const credentials = await resolveTwilioCredentialsForWorkspace(
            supabaseAdmin,
            target.workspace_id as string,
          );
          if (credentials.authToken) {
            const sigHeader = request.headers.get("X-Twilio-Signature");
            const proto = request.headers.get("x-forwarded-proto") ?? "https";
            const host = request.headers.get("host") ?? "";
            const fullUrl = `${proto}://${host}/api/public/telephony/dialer-result/${targetId}`;
            if (!verifyTwilioSignature(credentials.authToken, sigHeader, fullUrl, twilioParams)) {
              console.warn("[dialer-result] Invalid Twilio signature — rejected");
              return new Response("Forbidden", { status: 403 });
            }
          }
        } catch {
          // Credentials no longer resolvable (e.g. session mid-cleanup) — fall through
          // and still record the outcome so the row doesn't hang forever.
        }

        const dialCallStatus = twilioParams["DialCallStatus"] ?? "failed";
        const duration = twilioParams["DialCallDuration"];
        const status = mapDialResultStatus(dialCallStatus);

        await recordTargetOutcome(supabaseAdmin, targetId, status, {
          duration_secs: duration ? parseInt(duration, 10) : null,
        });

        const claimed = await claimDialerAdvance(supabaseAdmin, targetId);
        if (claimed) {
          await dialNextDialerTarget(supabaseAdmin, target.session_id as string);
        }

        console.log(`[dialer-result] target=${targetId} DialCallStatus=${dialCallStatus} → ${status}`);
        return new Response(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });
      },

      GET: async () => new Response("Twilio dialer-result webhook — POST only", { status: 405 }),
    },
  },
});
