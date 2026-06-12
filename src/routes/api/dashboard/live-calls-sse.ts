/**
 * Server-Sent Events endpoint for live call transcription.
 * Client connects once; server pushes transcript diffs every 1.5s.
 * Auth: JWT passed as ?token= query param (EventSource doesn't support headers).
 *
 * Transcript strategy (two-tier):
 *  1. Retell REST API  — /v2/get-call returns transcript progressively
 *     (some Retell plans/regions populate it during the call; others only
 *      after call_analyzed). We check transcript_object, transcript_with_tool_calls
 *      and transcript string in order.
 *  2. DB fallback — the retell webhook processor writes the full transcript to
 *     the `calls` table when call_ended fires.  We join by retell_call_id so
 *     the transcript appears the moment the webhook lands, even for calls that
 *     Retell's REST API didn't stream.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retellFetch } from "@/lib/providers/retell/client.server";

const SSE_INTERVAL_MS = 1500;
const SSE_KEEPALIVE_MS = 15_000;

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
function sseComment(msg: string): string {
  return `: ${msg}\n\n`;
}

function parseTranscriptString(raw: string): { role: "agent" | "user"; content: string }[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => {
      const agentMatch = line.match(/^Agent:\s*(.+)/i);
      if (agentMatch) return { role: "agent" as const, content: agentMatch[1].trim() };
      const userMatch = line.match(/^User:\s*(.+)/i);
      if (userMatch) return { role: "user" as const, content: userMatch[1].trim() };
      return null;
    })
    .filter((x): x is { role: "agent" | "user"; content: string } => x !== null && x.content.length > 0);
}

function extractTranscript(c: any): { role: "agent" | "user"; content: string }[] {
  // 1. transcript_object — standard Retell v2 array
  if (Array.isArray(c.transcript_object) && c.transcript_object.length > 0) {
    return c.transcript_object
      .filter((t: any) => t.role && t.content)
      .map((t: any) => ({ role: t.role as "agent" | "user", content: String(t.content) }));
  }
  // 2. transcript_with_tool_calls — Retell's extended format (tool calls interleaved)
  if (Array.isArray(c.transcript_with_tool_calls) && c.transcript_with_tool_calls.length > 0) {
    return c.transcript_with_tool_calls
      .filter((t: any) => t.role && t.content && typeof t.content === "string")
      .map((t: any) => ({ role: t.role as "agent" | "user", content: t.content }));
  }
  // 3. transcript string — "Agent: …\nUser: …" format
  if (typeof c.transcript === "string" && c.transcript.trim()) {
    return parseTranscriptString(c.transcript);
  }
  return [];
}

/** Verify the JWT and resolve workspace + Retell key using the admin client (bypasses RLS). */
async function getWorkspaceRetellKey(
  token: string,
): Promise<{ apiKey: string | null; workspaceId: string | null }> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) return { apiKey: null, workspaceId: null };
    const userId = data.user.id;

    const { data: wm } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const workspaceId = wm?.workspace_id ?? null;
    if (!workspaceId) return { apiKey: null, workspaceId: null };

    const { data: ws } = await supabaseAdmin
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const apiKey =
      (ws?.retell_workspace_id as string | undefined)?.trim() ||
      process.env.RETELL_API_KEY ||
      null;

    return { apiKey, workspaceId };
  } catch {
    return { apiKey: null, workspaceId: null };
  }
}

/** Fetch transcripts from our own DB for the given Retell call IDs (stored by webhook processor). */
async function fetchDbTranscripts(
  workspaceId: string,
  retellCallIds: string[],
): Promise<Record<string, string>> {
  if (!retellCallIds.length) return {};
  try {
    const { data } = await supabaseAdmin
      .from("calls")
      .select("retell_call_id, transcript")
      .eq("workspace_id", workspaceId)
      .in("retell_call_id", retellCallIds);
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row.retell_call_id && row.transcript) {
        map[row.retell_call_id] = row.transcript;
      }
    }
    return map;
  } catch {
    return {};
  }
}

interface RecentCall {
  call_id: string;
  agent_id: string;
  agent_name: string;
  direction: string;
  call_type: string;
  from_number: string | null;
  to_number: string | null;
  start_timestamp: number | null;
  transcript: { role: "agent" | "user"; content: string }[];
  status: "live" | "completed";
}

/**
 * Query DB for calls completed in the last 20 min that have a transcript.
 * These are shown in the panel as "ENDED" cards with the full transcript.
 */
async function fetchRecentCompletedCalls(
  workspaceId: string,
  agentNames: Record<string, string>,
): Promise<RecentCall[]> {
  try {
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("calls")
      .select(
        "retell_call_id, agent_id, agent_name, call_type, from_number, to_number, started_at, transcript",
      )
      .eq("workspace_id", workspaceId)
      .in("call_status", ["completed", "no_answer", "failed"])
      .gte("ended_at", since)
      .not("transcript", "is", null)
      .order("started_at", { ascending: false })
      .limit(10);

    return (data ?? [])
      .filter((row) => row.retell_call_id && (row.transcript ?? "").trim())
      .map((row) => ({
        call_id: row.retell_call_id!,
        agent_id: row.agent_id ?? "",
        agent_name: row.agent_name ?? agentNames[row.agent_id ?? ""] ?? "Unknown agent",
        direction: "inbound",
        call_type: row.call_type ?? "phone_call",
        from_number: row.from_number ?? null,
        to_number: row.to_number ?? null,
        start_timestamp: row.started_at ? new Date(row.started_at).getTime() : null,
        transcript: parseTranscriptString(row.transcript ?? ""),
        status: "completed" as const,
      }));
  } catch {
    return [];
  }
}

async function fetchLiveCalls(apiKey: string): Promise<any[]> {
  let stubs: any[] = [];
  try {
    const res = await retellFetch<any>(
      "/v2/list-calls",
      { filter_criteria: { call_status: ["ongoing"] }, limit: 20, sort_order: "descending" },
      "POST",
      apiKey,
    );
    stubs = Array.isArray(res) ? res : (res?.calls ?? []);
  } catch {
    return [];
  }

  const detailed = await Promise.all(
    stubs.map(async (stub: any) => {
      try {
        const detail = await retellFetch<any>(
          `/v2/get-call/${stub.call_id}`,
          undefined,
          "GET",
          apiKey,
        );
        return { ...stub, ...detail };
      } catch {
        return stub;
      }
    }),
  );
  return detailed;
}

async function resolveAgentNames(apiKey: string): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  try {
    const agents = await retellFetch<any[]>("/list-agents", null, "GET", apiKey);
    for (const a of agents ?? []) {
      if (a.agent_id) names[a.agent_id] = a.agent_name ?? a.agent_id;
    }
  } catch { /* ignore */ }
  return names;
}

export const Route = createFileRoute("/api/dashboard/live-calls-sse")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";

        const { apiKey, workspaceId } = await getWorkspaceRetellKey(token);

        if (!apiKey || !workspaceId) {
          return new Response("Unauthorized", { status: 401 });
        }

        let closed = false;
        let agentNames: Record<string, string> = {};
        let agentNamesLastFetched = 0;

        // Per-call transcript fingerprint — tracks last sent transcript length
        // so we re-send whenever the transcript grows.
        const transcriptLengths: Record<string, number> = {};

        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (chunk: string) => {
              try {
                controller.enqueue(enc.encode(chunk));
              } catch {
                closed = true;
              }
            };

            send(sseComment("connected"));

            let lastCallIds = "";
            let keepaliveAt = Date.now() + SSE_KEEPALIVE_MS;

            while (!closed) {
              try {
                const now = Date.now();

                if (now - agentNamesLastFetched > 60_000) {
                  agentNames = await resolveAgentNames(apiKey);
                  agentNamesLastFetched = now;
                }

                const detailed = await fetchLiveCalls(apiKey);

                // Fetch DB transcripts as a fallback for calls where Retell REST
                // doesn't yet have transcript data (common during the call; the
                // webhook processor writes the transcript on call_ended).
                const retellCallIds = detailed.map((c: any) => c.call_id).filter(Boolean);
                const dbTranscripts = await fetchDbTranscripts(workspaceId, retellCallIds);

                // Build live-call cards (Retell REST source).
                const liveOngoingIds = new Set(detailed.map((c: any) => c.call_id as string));

                const liveCalls = detailed.map((c: any) => {
                  const restTranscript = extractTranscript(c);
                  const dbRaw = dbTranscripts[c.call_id] ?? "";
                  const structured =
                    restTranscript.length > 0 ? restTranscript : parseTranscriptString(dbRaw);
                  return {
                    call_id: c.call_id ?? "",
                    agent_id: c.agent_id ?? "",
                    agent_name: agentNames[c.agent_id] ?? "Unknown agent",
                    direction: c.direction ?? c.call_direction ?? "inbound",
                    call_type: c.call_type ?? "phone_call",
                    from_number: c.from_number ?? c.caller_id ?? null,
                    to_number: c.to_number ?? null,
                    start_timestamp: c.start_timestamp ?? null,
                    transcript: structured,
                    status: "live" as const,
                  };
                });

                // Build recently-completed cards (DB source), excluding any
                // call that is still showing as live on Retell.
                const recentCompleted = await fetchRecentCompletedCalls(workspaceId, agentNames);
                const completedCards = recentCompleted.filter(
                  (r) => !liveOngoingIds.has(r.call_id),
                );

                const calls = [...liveCalls, ...completedCards];
                const callIds = calls.map((c) => c.call_id).join(",");

                // Detect transcript growth per call (to know when to re-send).
                let transcriptChanged = false;
                for (const c of calls) {
                  const prev = transcriptLengths[c.call_id] ?? -1;
                  if (c.transcript.length !== prev) {
                    transcriptLengths[c.call_id] = c.transcript.length;
                    transcriptChanged = true;
                  }
                }

                // Always push when call set changes, transcript grows, or
                // there are active/recent calls (so the client picks up
                // transcript the moment it lands in the DB).
                const shouldSend =
                  callIds !== lastCallIds ||
                  transcriptChanged ||
                  calls.length > 0;

                if (shouldSend) {
                  send(sseData({ calls }));
                  lastCallIds = callIds;
                  keepaliveAt = now + SSE_KEEPALIVE_MS;
                } else if (now >= keepaliveAt) {
                  send(sseComment("keepalive"));
                  keepaliveAt = now + SSE_KEEPALIVE_MS;
                }
              } catch {
                send(sseComment("error"));
              }

              await new Promise((r) => setTimeout(r, SSE_INTERVAL_MS));
            }

            try {
              controller.close();
            } catch { /* already closed */ }
          },
          cancel() {
            closed = true;
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
