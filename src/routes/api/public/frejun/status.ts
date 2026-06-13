/**
 * FreJun Teler — call status callback.
 *
 * FreJun POSTs JSON events here on each call status transition.
 * Event shape from the FreJun Teler webhook system matches the
 * WebhookEventResponse schema from their OpenAPI spec.
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

function mapFreJunState(state: string): CallState {
  const m: Record<string, CallState> = {
    initiated: "initiated",
    ringing: "ringing",
    answered: "active",
    completed: "completed",
    failed: "failed",
  };
  return m[state] ?? "failed";
}

export const Route = createFileRoute("/api/public/frejun/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return jsonOk({ ok: false, reason: "invalid JSON" });
        }

        const frejunCallId =
          (body.call_id as string | undefined) ??
          ((body.data as Record<string, unknown> | undefined)?.call_id as string | undefined) ??
          "";

        const rawState =
          (body.state as string | undefined) ??
          ((body.data as Record<string, unknown> | undefined)?.state as string | undefined) ??
          "";

        const duration =
          ((body.data as Record<string, unknown> | undefined)?.duration_seconds as number | undefined) ??
          null;

        if (!frejunCallId) {
          return jsonOk({ ok: false, reason: "no call_id" });
        }

        const status = mapFreJunState(rawState);

        const { data: callRow } = await supabaseAdmin
          .from("telephony_calls")
          .select("id, workspace_id, status")
          .eq("call_sid", frejunCallId)
          .maybeSingle();

        if (!callRow) {
          console.log("[frejun/status] call not found for sid:", frejunCallId);
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
          if (duration != null) patch.duration_seconds = duration;
        }

        const { error } = await supabaseAdmin
          .from("telephony_calls")
          .update(patch)
          .eq("id", callRow.id);

        if (error) {
          console.error("[frejun/status] update error:", error.message);
        }

        await supabaseAdmin.from("call_events").insert({
          call_id: callRow.id,
          workspace_id: callRow.workspace_id,
          event_type: "status_change",
          event_data: {
            from: callRow.status,
            to: status,
            frejunState: rawState,
            frejunCallId,
            duration: duration ?? null,
          },
        });

        if (body.type === "call.recording" && (body.data as Record<string, unknown>)?.recording_url) {
          await supabaseAdmin
            .from("telephony_calls")
            .update({
              recording_url: (body.data as Record<string, unknown>).recording_url as string,
              recording_status: "available",
              updated_at: new Date().toISOString(),
            })
            .eq("id", callRow.id);
        }

        console.log(`[frejun/status] ${frejunCallId}: ${callRow.status} → ${status}`);
        return jsonOk({ ok: true });
      },

      GET: async () =>
        new Response("FreJun status callback — POST only", { status: 405 }),
    },
  },
});
