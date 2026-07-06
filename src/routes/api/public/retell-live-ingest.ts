/**
 * Live-monitoring ingest for externally-hosted Retell agents.
 *
 * Some Retell agents were NOT deployed through WEBEE — they keep their Retell
 * `webhook_url` pointing at an external automation (n8n) that feeds a legacy
 * dashboard. WEBEE normally learns about those calls only later, via the WBAH
 * API sync. To surface a LIVE transcript for such an agent without changing its
 * Retell config, n8n forwards a COPY of each Retell event to this endpoint.
 *
 * This path is DISPLAY-ONLY. It writes solely to `live_call_sessions` (the live
 * transcript panel) and NEVER to the `calls` table, analytics, leads, CRM, or
 * the WBAH API sync — so it can never create duplicate call logs or disturb any
 * existing pipeline. Authenticated with a shared secret header (not a Retell
 * signature): the payload is relayed by n8n, so the original Retell signature
 * may be absent or unverifiable here.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  markLiveCallSessionEnded,
  mergeWebhookTranscript,
  upsertLiveCallSession,
} from "@/lib/retell/live-call-sessions.server";

/** Header n8n must send, carrying the shared WEBEE_LIVE_INGEST_SECRET value. */
const SECRET_HEADER = "x-webee-live-ingest-secret";

/**
 * Explicit allow-map of externally-hosted Retell agents → the WEBEE workspace
 * that should see their live calls. ONLY agents listed here are accepted; every
 * other agent_id is ignored. Live-monitoring / display use only — this mapping
 * never influences the calls table, analytics, leads, CRM, or the WBAH sync.
 */
const LIVE_INGEST_AGENTS: Record<string, { workspaceId: string; agentName: string }> = {
  // Platform-account (RETELL_API_KEY) copy of the outbound qualification agent.
  agent_0440750bb59597eef7352901bf: {
    workspaceId: "5cb750b6-fabf-4e84-9b92-740df1cd8d53",
    agentName: "WBAH Client qualification agent outbound",
  },
  // WBAH workspace-account copy (same call runs here when the workspace Retell
  // key is used). Same n8n webhook forwards its events; mapping it ensures a
  // live transcript is stored regardless of which account dialled the call.
  // Display-only: never touches calls/leads/CRM/analytics or the WBAH sync.
  agent_50598858538a69272a4bf04bf8: {
    workspaceId: "5cb750b6-fabf-4e84-9b92-740df1cd8d53",
    agentName: "WBAH Client qualification agent",
  },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": `Content-Type, Authorization, ${SECRET_HEADER}`,
  "Access-Control-Max-Age": "86400",
} as const;

/** Minimal Retell call shape needed here (mirrors live-call-sessions.server). */
type IngestCall = {
  call_id?: string;
  agent_id?: string;
  call_type?: string;
  call_status?: string;
  direction?: string;
  from_number?: string | null;
  to_number?: string | null;
  start_timestamp?: number | null;
  transcript?: string | null;
  transcript_object?: Array<{ role?: string; content?: string }>;
  transcript_with_tool_calls?: Array<{ role?: string; content?: string }>;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function stripAgentPrefix(value: string): string {
  return value.replace(/^agents\//, "").trim();
}

/** Length-aware, non-short-circuiting secret comparison. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export const Route = createFileRoute("/api/public/retell-live-ingest")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }),

      GET: async () => json({ status: "ok", success: true }, 200),

      POST: async ({ request }) => {
        const expected = process.env.WEBEE_LIVE_INGEST_SECRET?.trim() || "";
        if (!expected) {
          console.error("[LIVE INGEST] WEBEE_LIVE_INGEST_SECRET not configured");
          return json({ ok: false, error: "ingest not configured" }, 503);
        }

        const provided = request.headers.get(SECRET_HEADER);
        if (!secretMatches(provided, expected)) {
          console.warn("[LIVE INGEST] Rejected: missing/invalid secret header");
          return json({ ok: false, error: "unauthorized" }, 401);
        }

        const rawBody = await request.text();
        if (!rawBody.trim()) return json({ ok: true, validation: true }, 200);

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return json({ ok: true, ignored: "invalid json" }, 200);
        }

        // Everything below is best-effort and display-only: never throw back to
        // n8n (a WEBEE hiccup must not fail the forwarding step of the workflow).
        try {
          const event = String(payload.event ?? payload.event_type ?? "unknown");
          const call = ((payload.call ?? payload) as unknown) as IngestCall;
          // Retell's transcript_updated delivers the transcript at the TOP LEVEL
          // of the body (sibling of `call`), so merge it onto `call` — otherwise
          // every live row stores an empty transcript ("Waiting for transcript").
          mergeWebhookTranscript(call, payload);
          const callId = call.call_id;
          const incomingAgentId = call.agent_id ? stripAgentPrefix(String(call.agent_id)) : "";

          const mapped = incomingAgentId ? LIVE_INGEST_AGENTS[incomingAgentId] : undefined;
          if (!mapped) {
            console.log("[LIVE INGEST] Ignored unmapped agent", { agentId: incomingAgentId, event });
            return json({ ok: true, ignored: "unmapped agent" }, 200);
          }

          const isWebCall = call.call_type === "web_call" || call.call_type === "webcall";
          if (!callId || isWebCall) {
            return json({ ok: true, ignored: !callId ? "missing call_id" : "web call" }, 200);
          }

          const { workspaceId, agentName } = mapped;
          switch (event) {
            case "call_started":
            case "transcript_updated":
              await upsertLiveCallSession({ workspaceId, agentName, event, call });
              break;
            case "call_ended":
            case "call_analyzed":
            case "call_transferred":
              await markLiveCallSessionEnded(workspaceId, callId, "ended");
              break;
            case "call_failed":
              await markLiveCallSessionEnded(workspaceId, callId, "failed");
              break;
            default:
              return json({ ok: true, ignored: `unsupported event: ${event}` }, 200);
          }

          console.log("[LIVE INGEST] Processed", { event, callId, workspaceId });
          return json({ ok: true, event, callId }, 200);
        } catch (err) {
          console.warn("[LIVE INGEST] Processing failed (non-fatal)", err);
          return json({ ok: true, error: "processing error" }, 200);
        }
      },
    },
  },
});
