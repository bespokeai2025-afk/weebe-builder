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

/** Read a cookie value from the incoming request (EventSource sends same-origin cookies). */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
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
  cookieWorkspaceId?: string | null,
): Promise<{
  apiKey: string | null;
  workspaceId: string | null;
  /**
   * When the workspace has NO dedicated Retell key and falls back to the shared
   * PLATFORM key, this is the Set of provider_agent_ids deployed by THIS
   * workspace — live calls are filtered to these so one tenant can never see
   * another tenant's ongoing calls. `null` means a dedicated workspace key is
   * in use (the key itself is already tenant-isolated, no filter needed).
   */
  deployedAgentIds: Set<string> | null;
}> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id)
      return { apiKey: null, workspaceId: null, deployedAgentIds: null };
    const userId = data.user.id;

    let workspaceId: string | null = null;

    // Prefer the user's ACTIVE workspace (the wb_workspace_id cookie the rest of
    // the app uses), but only after verifying membership. This keeps live calls
    // scoped to the workspace the user is actually viewing and prevents a user
    // from monitoring a workspace they don't belong to.
    if (cookieWorkspaceId) {
      const { data: member } = await supabaseAdmin
        .from("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", cookieWorkspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (member?.workspace_id) workspaceId = member.workspace_id;
    }

    // Fall back to first membership if there is no valid active-workspace cookie.
    if (!workspaceId) {
      const { data: wm } = await supabaseAdmin
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();
      workspaceId = wm?.workspace_id ?? null;
    }

    if (!workspaceId)
      return { apiKey: null, workspaceId: null, deployedAgentIds: null };

    const { data: ws } = await supabaseAdmin
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const workspaceKey = (ws?.retell_workspace_id as string | undefined)?.trim() || undefined;
    const apiKey = workspaceKey || process.env.RETELL_API_KEY || null;

    // FAIL CLOSED: when this workspace has no dedicated key and falls back to the
    // shared platform key, Retell's /v2/list-calls returns EVERY tenant's ongoing
    // calls. Restrict to the agents THIS workspace has deployed. An empty set
    // (workspace has deployed nothing on the platform key) ⇒ zero live cards,
    // never an unfiltered (null) view. Mirrors resolveRetellContext in
    // analytics.functions.ts. Completed cards come from the workspace-scoped
    // `calls` table and are already isolated, so they need no filter.
    let deployedAgentIds: Set<string> | null = null;
    if (!workspaceKey && apiKey) {
      deployedAgentIds = new Set<string>();
      try {
        const { data: deps } = await supabaseAdmin
          .from("deployments")
          .select("provider_agent_id")
          .eq("workspace_id", workspaceId)
          .eq("provider", "retell")
          .not("provider_agent_id", "is", null);
        for (const d of (deps as any[]) ?? []) {
          if (d.provider_agent_id) deployedAgentIds.add(d.provider_agent_id as string);
        }
      } catch {
        // On error keep the empty set → fail closed (show nothing) rather than leak.
      }
    }

    return { apiKey, workspaceId, deployedAgentIds };
  } catch {
    return { apiKey: null, workspaceId: null, deployedAgentIds: null };
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

/**
 * Best-effort resolve caller names from the workspace's leads table by phone.
 * Called only for NEW call ids (results are cached per connection), so we never
 * hammer the (potentially very large) leads table on every poll tick.
 */
async function fetchLeadNames(
  workspaceId: string,
  phones: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(phones.filter((p): p is string => !!p)));
  if (!unique.length) return {};
  try {
    const { data } = await supabaseAdmin
      .from("leads")
      .select("phone, full_name")
      .eq("workspace_id", workspaceId)
      .in("phone", unique)
      // Fixed generous bound: WBAH's leads table has many duplicate rows per
      // phone, so limiting to unique.length could truncate before every phone
      // is represented. Still index-bounded via (workspace_id, phone).
      .limit(500);
    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      const phone = (row.phone as string | null)?.trim();
      const name = (row.full_name as string | null)?.trim();
      if (phone && name) map[phone] = name;
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
  call_status: "ended" | "failed";
  lead_name: string | null;
  current_node_id: string | null;
  current_node_label: string | null;
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
        "retell_call_id, agent_id, agent_name, call_type, from_number, to_number, started_at, transcript, call_status",
      )
      .eq("workspace_id", workspaceId)
      .in("call_status", ["completed", "no_answer", "failed"])
      .gte("ended_at", since)
      .not("transcript", "is", null)
      .order("started_at", { ascending: false })
      .limit(10);

    return (data ?? [])
      .filter((row) => row.retell_call_id && (row.transcript ?? "").trim())
      .map((row) => {
        const cs = String(row.call_status ?? "").toLowerCase();
        const callStatus: "ended" | "failed" =
          cs === "failed" || cs === "no_answer" ? "failed" : "ended";
        return {
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
          call_status: callStatus,
          lead_name: null as string | null,
          current_node_id: null as string | null,
          current_node_label: null as string | null,
        };
      });
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
        const cookieWorkspaceId = readCookie(request, "wb_workspace_id");

        const { apiKey, workspaceId, deployedAgentIds } = await getWorkspaceRetellKey(
          token,
          cookieWorkspaceId,
        );

        if (!apiKey || !workspaceId) {
          return new Response("Unauthorized", { status: 401 });
        }

        let closed = false;
        let agentNames: Record<string, string> = {};
        let agentNamesLastFetched = 0;

        // Per-call transcript fingerprint — tracks last sent transcript length
        // so we re-send whenever the transcript grows.
        const transcriptLengths: Record<string, number> = {};

        // Per-connection lead-name cache keyed by call_id. A call's caller is
        // resolved once (from the workspace's leads table) then reused, so we
        // never re-query on every 1.5s poll tick.
        const leadNameCache: Record<string, string | null> = {};

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

                const detailedRaw = await fetchLiveCalls(apiKey);

                // FAIL CLOSED: on the shared platform key, /v2/list-calls returns
                // every tenant's ongoing calls. Restrict to agents THIS workspace
                // deployed. deployedAgentIds is null only for dedicated workspace
                // keys (already isolated); an empty set correctly yields nothing.
                const detailed =
                  deployedAgentIds === null
                    ? detailedRaw
                    : detailedRaw.filter((c: any) => deployedAgentIds.has(c.agent_id));

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
                  // Retell call_status for ongoing calls: "registered" (dialing/
                  // ringing) or "ongoing" (connected & talking).
                  const rawStatus = String(c.call_status ?? "").toLowerCase();
                  const callStatus: "ringing" | "in_progress" | "ended" | "failed" =
                    rawStatus === "registered" ? "ringing" : "in_progress";
                  // Conversation flow position — Retell REST doesn't expose the
                  // active node mid-call, so this stays null unless present.
                  const nodeId =
                    c.current_node_id ?? c.node_id ?? c.current_node?.id ?? null;
                  const nodeLabel =
                    c.current_node_label ?? c.current_node?.name ?? c.current_node?.label ?? null;
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
                    call_status: callStatus,
                    lead_name: null as string | null,
                    current_node_id: (nodeId as string | null) ?? null,
                    current_node_label: (nodeLabel as string | null) ?? null,
                  };
                });

                // Build recently-completed cards (DB source), excluding any
                // call that is still showing as live on Retell.
                const recentCompleted = await fetchRecentCompletedCalls(workspaceId, agentNames);
                const completedCards = recentCompleted.filter(
                  (r) => !liveOngoingIds.has(r.call_id),
                );

                const calls = [...liveCalls, ...completedCards];

                // Enrich cards with caller/lead names. We only look up call ids
                // we haven't seen before (cached for the connection lifetime),
                // so a workspace's leads table is queried at most once per new
                // call rather than every 1.5s tick.
                const uncached = calls.filter((c) => !(c.call_id in leadNameCache));
                if (uncached.length > 0) {
                  const phones = uncached
                    .map((c) =>
                      c.direction === "outbound"
                        ? (c.to_number ?? c.from_number)
                        : (c.from_number ?? c.to_number),
                    )
                    .filter((p): p is string => !!p);
                  const nameMap = await fetchLeadNames(workspaceId, phones);
                  for (const c of uncached) {
                    const phone =
                      c.direction === "outbound"
                        ? (c.to_number ?? c.from_number)
                        : (c.from_number ?? c.to_number);
                    leadNameCache[c.call_id] = (phone && nameMap[phone]) || null;
                  }
                }
                for (const c of calls) {
                  c.lead_name = leadNameCache[c.call_id] ?? null;
                }

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
