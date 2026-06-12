/**
 * Public ElevenLabs Conversational AI webhook receiver.
 *
 * ElevenLabs posts a `post_call_transcript` event after each conversation
 * ends. We parse the transcript and store a call record in the `calls` table.
 *
 * This route is intentionally unauthenticated — ElevenLabs signs nothing
 * by default, so we accept all POSTs and ignore unknown payloads safely.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/elevenlabs-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },

      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          console.warn("[elevenlabs-webhook] Invalid JSON body");
          return json({ ok: false, error: "Invalid JSON" }, 400);
        }

        console.log(
          "[elevenlabs-webhook] Received",
          JSON.stringify(body).slice(0, 500),
        );

        try {
          const eventType = body.type as string | undefined;

          if (
            eventType === "post_call_transcript" ||
            eventType === "conversation_end"
          ) {
            const data = (body.data ?? body) as Record<string, unknown>;
            const elAgentId = data.agent_id as string | undefined;
            const conversationId = data.conversation_id as string | undefined;
            const transcriptRaw = data.transcript as
              | Array<{ role: string; message: string; time_in_call_secs?: number }>
              | undefined;
            const analysis = data.analysis as Record<string, unknown> | undefined;

            if (elAgentId && transcriptRaw && transcriptRaw.length > 0) {
              // Find the agent that owns this EL agent ID.
              const { data: agents, error: agentsErr } = await supabaseAdmin
                .from("agents")
                .select("id, user_id, settings")
                .limit(500);

              if (agentsErr) {
                console.error("[elevenlabs-webhook] DB lookup error:", agentsErr.message);
                return json({ ok: true });
              }

              const agentRow = agents?.find((a) => {
                const s = (a.settings ?? {}) as Record<string, unknown>;
                return (s.deployedElevenLabsAgentId as string | undefined) === elAgentId;
              });

              if (agentRow) {
                const callDurationSecs =
                  transcriptRaw[transcriptRaw.length - 1]?.time_in_call_secs ?? 0;
                const fullTranscript = transcriptRaw
                  .map((t) =>
                    `${t.role === "agent" ? "Assistant" : "User"}: ${t.message}`,
                  )
                  .join("\n");

                const { error: insertErr } = await supabaseAdmin
                  .from("calls")
                  .insert({
                    agent_id: agentRow.id,
                    user_id: agentRow.user_id,
                    call_id: conversationId ?? `el_${Date.now()}`,
                    transcript: fullTranscript,
                    duration_seconds: Math.round(callDurationSecs),
                    provider: "ELEVENLABS",
                    raw_payload: body as never,
                    summary:
                      (analysis?.transcript_summary as string | undefined) ?? null,
                    created_at: new Date().toISOString(),
                  } as never);

                if (insertErr) {
                  console.warn("[elevenlabs-webhook] Insert failed:", insertErr.message);
                } else {
                  console.log("[elevenlabs-webhook] Call stored", {
                    agentId: agentRow.id,
                    conversationId,
                    durationSecs: Math.round(callDurationSecs),
                  });
                }
              } else {
                console.warn("[elevenlabs-webhook] No agent found for EL agent ID:", elAgentId);
              }
            }
          }
        } catch (err) {
          console.error("[elevenlabs-webhook] Processing error:", err);
        }

        return json({ ok: true });
      },
    },
  },
});
