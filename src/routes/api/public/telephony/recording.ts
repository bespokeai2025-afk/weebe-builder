/**
 * Twilio recording-status callback.
 *
 * Twilio posts here when a recording is created or its status changes.
 * We store the recording URL and update call outcome metadata.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/telephony/recording")({
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
        const recordingSid = (formData.get("RecordingSid") as string) ?? "";
        const recordingUrl = (formData.get("RecordingUrl") as string) ?? "";
        const recordingStatus = (formData.get("RecordingStatus") as string) ?? "";
        const durationRaw = formData.get("RecordingDuration") as string | null;

        if (!callSid) return jsonOk({ ok: false, reason: "no callSid" });

        const { data: callRow } = await supabaseAdmin
          .from("telephony_calls")
          .select("id, workspace_id")
          .eq("call_sid", callSid)
          .maybeSingle();

        if (!callRow) {
          console.log("[telephony/recording] call not found for sid:", callSid);
          return jsonOk({ ok: false, reason: "call not found" });
        }

        const patch: Record<string, unknown> = {
          recording_sid: recordingSid,
          recording_status: recordingStatus,
          updated_at: new Date().toISOString(),
        };

        if (recordingUrl) {
          patch.recording_url = recordingUrl.endsWith(".mp3")
            ? recordingUrl
            : `${recordingUrl}.mp3`;
        }

        if (durationRaw) patch.duration_seconds = parseInt(durationRaw);

        const { error } = await supabaseAdmin
          .from("telephony_calls")
          .update(patch)
          .eq("id", callRow.id);

        if (error) {
          console.error("[telephony/recording] update error:", error.message);
        }

        await supabaseAdmin.from("call_events").insert({
          call_id: callRow.id,
          workspace_id: callRow.workspace_id,
          event_type:
            recordingStatus === "completed" ? "recording_stopped" : "recording_started",
          event_data: { recordingSid, recordingUrl, recordingStatus },
        });

        console.log(
          `[telephony/recording] ${callSid}: ${recordingStatus} sid=${recordingSid}`,
        );
        return jsonOk({ ok: true });
      },

      GET: async () =>
        new Response("Twilio recording callback — POST only", { status: 405 }),
    },
  },
});
