/**
 * Twilio call-status callback.
 *
 * Twilio posts here on every status transition:
 *   initiated → ringing → in-progress → completed | failed | busy | no-answer
 *
 * We map to our CallState enum and update telephony_calls + call_events.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CallState } from "@/lib/telephony/types";
import { verifyTwilioRequestForWorkspace } from "@/lib/telephony/inbound-routing.server";
import { reportUnansweredCall } from "@/lib/telephony/unanswered-call.server";

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mapTwilioStatus(s: string): CallState {
  const m: Record<string, CallState> = {
    queued: "initiated",
    initiated: "initiated",
    ringing: "ringing",
    "in-progress": "active",
    answered: "answered",
    completed: "completed",
    busy: "failed",
    "no-answer": "failed",
    canceled: "failed",
    failed: "failed",
  };
  return m[s] ?? "failed";
}

export const Route = createFileRoute("/api/public/telephony/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text().catch(() => "");
        const params: Record<string, string> = {};
        try { new URLSearchParams(rawBody).forEach((v, k) => { params[k] = v; }); } catch {}

        const callSid      = params["CallSid"]      ?? "";
        const twilioStatus = params["CallStatus"]   ?? "";
        const duration     = params["CallDuration"] ?? null;

        if (!callSid) return jsonOk({ ok: false, reason: "no callSid" });

        const status = mapTwilioStatus(twilioStatus);

        const { data: callRow } = await supabaseAdmin
          .from("telephony_calls")
          .select("id, workspace_id, status, agent_id, direction, from_number, to_number, campaign_id, started_at, metadata")
          .eq("call_sid", callSid)
          .maybeSingle();

        if (!callRow) {
          console.log("[telephony/status] call not found for sid:", callSid);
          return jsonOk({ ok: false, reason: "call not found" });
        }

        // Verified against the Twilio account that owns this call's workspace — the account that
        // placed or received it. Checking only the platform env token rejected every callback for
        // calls on a workspace's own Twilio account, so call outcomes were never recorded.
        const verified = await verifyTwilioRequestForWorkspace(
          supabaseAdmin,
          callRow.workspace_id as string,
          request,
          "/api/public/telephony/status",
          params,
        );
        if (!verified.ok) {
          console.warn(`[telephony/status] rejected (${verified.reason}) for sid:`, callSid);
          return new Response("Forbidden", { status: 403 });
        }

        const patch: Record<string, unknown> = {
          status,
          updated_at: new Date().toISOString(),
        };

        if (status === "active" || status === "answered") {
          patch.answered_at = new Date().toISOString();
        }

        if (status === "completed" || status === "failed") {
          patch.ended_at = new Date().toISOString();
          if (duration) patch.duration_seconds = parseInt(duration);
        }

        const { error } = await supabaseAdmin
          .from("telephony_calls")
          .update(patch)
          .eq("id", callRow.id);

        if (error) {
          console.error("[telephony/status] update error:", error.message);
        }

        await supabaseAdmin.from("call_events").insert({
          call_id: callRow.id,
          workspace_id: callRow.workspace_id,
          event_type: "status_change",
          event_data: {
            from: callRow.status,
            to: status,
            twilioStatus,
            callSid,
            duration: duration ?? null,
          },
        });

        // An outbound call that never connected has no voice-engine lifecycle to report it; send
        // the Retell-shaped no-answer / busy / failed events so leads and campaigns see the outcome.
        // Not awaited: Twilio only needs a quick 200 here.
        void reportUnansweredCall(callRow as never, twilioStatus).catch((err) =>
          console.warn("[telephony/status] unanswered-call report failed:", err instanceof Error ? err.message : err),
        );

        console.log(`[telephony/status] ${callSid}: ${callRow.status} → ${status}`);
        return jsonOk({ ok: true });
      },

      GET: async () =>
        new Response("Twilio status callback — POST only", { status: 405 }),
    },
  },
});
