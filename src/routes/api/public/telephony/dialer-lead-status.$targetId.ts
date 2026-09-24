/**
 * Auto Dialer — call-level status callback for the leg to the dialled target.
 *
 * Fires before the call ever reaches dialer-connect's TwiML — this is what
 * catches "no-answer" / "busy" / "failed" on the target's own phone, which
 * `<Dial>`'s action callback never sees because `<Dial>` never ran. It also
 * fires "completed" on the normal path (the target answered, `<Dial>` ran and
 * finished) — that case is a duplicate of what dialer-result already recorded,
 * and `claimDialerAdvance`'s `advanced_at` guard is what stops it double-firing
 * the next dial.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveTwilioCredentialsForWorkspace } from "@/lib/telephony/twilio-credentials.server";
import { mapLeadCallStatus, isTerminalTargetStatus } from "@/lib/telephony/auto-dialer.shared";
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

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

export const Route = createFileRoute("/api/public/telephony/dialer-lead-status/$targetId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const targetId = params.targetId;
        const rawBody = await request.text().catch(() => "");
        const twilioParams: Record<string, string> = {};
        try { new URLSearchParams(rawBody).forEach((v, k) => { twilioParams[k] = v; }); } catch {}

        const { data: target } = await (supabaseAdmin as any)
          .from("dialer_targets")
          .select("id, session_id, workspace_id, status")
          .eq("id", targetId)
          .maybeSingle();
        if (!target) return jsonOk({ ok: false, reason: "target not found" });

        try {
          const credentials = await resolveTwilioCredentialsForWorkspace(
            supabaseAdmin,
            target.workspace_id as string,
          );
          if (credentials.authToken) {
            const sigHeader = request.headers.get("X-Twilio-Signature");
            const proto = request.headers.get("x-forwarded-proto") ?? "https";
            const host = request.headers.get("host") ?? "";
            const fullUrl = `${proto}://${host}/api/public/telephony/dialer-lead-status/${targetId}`;
            if (!verifyTwilioSignature(credentials.authToken, sigHeader, fullUrl, twilioParams)) {
              console.warn("[dialer-lead-status] Invalid Twilio signature — rejected");
              return new Response("Forbidden", { status: 403 });
            }
          }
        } catch {
          // Fall through — still worth recording so the row doesn't hang.
        }

        const twilioStatus = twilioParams["CallStatus"] ?? "";
        const mapped = mapLeadCallStatus(twilioStatus);

        if (mapped === "ringing") {
          if (!isTerminalTargetStatus(target.status as string)) {
            await (supabaseAdmin as any)
              .from("dialer_targets")
              .update({ status: "ringing", updated_at: new Date().toISOString() })
              .eq("id", targetId);
          }
          return jsonOk({ ok: true });
        }

        if (!mapped) return jsonOk({ ok: true }); // queued/initiated/in-progress — nothing to record

        // "completed" fires on the normal path too (the target answered, <Dial> ran
        // and finished) — dialer-result already recorded the real outcome
        // (bridged/no_answer/busy/failed) in that case, and overwriting it with the
        // generic "completed" here would throw that detail away. Only record it when
        // this is genuinely the first word we've heard about this leg.
        const alreadyTerminal = isTerminalTargetStatus(target.status as string);
        if (!(mapped === "completed" && alreadyTerminal)) {
          await recordTargetOutcome(supabaseAdmin, targetId, mapped);
        }

        const claimed = await claimDialerAdvance(supabaseAdmin, targetId);
        if (claimed) {
          await dialNextDialerTarget(supabaseAdmin, target.session_id as string);
        }

        console.log(`[dialer-lead-status] target=${targetId} CallStatus=${twilioStatus} → ${mapped}`);
        return jsonOk({ ok: true });
      },

      GET: async () => new Response("Twilio dialer-lead-status webhook — POST only", { status: 405 }),
    },
  },
});
