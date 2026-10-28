/**
 * WBAH live transcript — mirrors an in-progress call into the live session table.
 *
 * The one implementation, used by the webhook handler (every event, before the job is queued) and
 * by the automation engine's live_transcript node.
 */
import {
  markLiveCallSessionEnded,
  mergeWebhookTranscript,
  upsertLiveCallSession,
} from "@/lib/retell/live-call-sessions.server";
import type { WbahRetellAgentMapping } from "./wbah-retell-agents.shared";

export async function handleWbahLiveTranscript(
  event: string,
  call: { call_id?: string } & Record<string, unknown>,
  payload: Record<string, unknown>,
  agent: WbahRetellAgentMapping,
): Promise<void> {
  mergeWebhookTranscript(call as any, payload);
  const callId = call.call_id;
  if (!callId) return;

  switch (event) {
    case "call_started":
    case "transcript_updated":
      await upsertLiveCallSession({
        workspaceId: agent.workspaceId,
        agentName: agent.agentName,
        event,
        call: call as any,
      });
      break;
    case "call_ended":
    case "call_analyzed":
    case "call_transferred":
      await markLiveCallSessionEnded(agent.workspaceId, callId, "ended");
      break;
    case "call_failed":
      await markLiveCallSessionEnded(agent.workspaceId, callId, "failed");
      break;
    default:
      break;
  }
}
