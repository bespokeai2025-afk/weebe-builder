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
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch {
          return jsonOk({ ok: false });
        }

        const callSid = (formData.get("CallSid") as string) ?? "";
        const twilioStatus = (formData.get("CallStatus") as string) ?? "";
        const duration = formData.get("CallDuration") as string | null;

        if (!callSid) return jsonOk({ ok: false, reason: "no callSid" });

        const status = mapTwilioStatus(twilioStatus);

        const { data: callRow } = await supabaseAdmin
          .from("telephony_calls")
          .select("id, workspace_id, status")
          .eq("call_sid", callSid)
          .maybeSingle();

        if (!callRow) {
          console.log("[telephony/status] call not found for sid:", callSid);
          return jsonOk({ ok: false, reason: "call not found" });
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

        console.log(`[telephony/status] ${callSid}: ${callRow.status} → ${status}`);
        return jsonOk({ ok: true });
      },

      GET: async () =>
        new Response("Twilio status callback — POST only", { status: 405 }),
    },
  },
});
