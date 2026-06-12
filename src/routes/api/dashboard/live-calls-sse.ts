/**
 * Server-Sent Events endpoint for live call transcription.
 * Client connects once; server pushes transcript diffs every 1.5s.
 * Auth: JWT passed as ?token= query param (EventSource doesn't support headers).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
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

async function getWorkspaceRetellKey(token: string, cookieHeader: string): Promise<{ apiKey: string | null; workspaceId: string | null }> {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return { apiKey: null, workspaceId: null };

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { apiKey: null, workspaceId: null };

  const userId = data.claims.sub;

  const wsMatch = cookieHeader.match(/(?:^|;\s*)wb_workspace_id=([^;]+)/);
  let workspaceId: string | null = null;
  if (wsMatch) {
    try { workspaceId = decodeURIComponent(wsMatch[1]); } catch { /* ignore */ }
  }

  if (!workspaceId) {
    const { data: wm } = await (supabase as any)
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    workspaceId = wm?.workspace_id ?? null;
  }

  if (!workspaceId) return { apiKey: null, workspaceId: null };

  const { data: ws } = await (supabase as any)
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const apiKey =
    (ws?.retell_workspace_id as string | undefined)?.trim() ||
    process.env.RETELL_API_KEY ||
    null;

  return { apiKey, workspaceId };
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
  } catch { return []; }

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
      } catch { return stub; }
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
        const cookieHeader = request.headers.get("cookie") ?? "";

        const { apiKey, workspaceId } = await getWorkspaceRetellKey(token, cookieHeader);

        if (!apiKey || !workspaceId) {
          return new Response("Unauthorized", { status: 401 });
        }

        let closed = false;
        let agentNames: Record<string, string> = {};
        let agentNamesLastFetched = 0;

        const stream = new ReadableStream({
          async start(controller) {
            const enc = new TextEncoder();
            const send = (chunk: string) => {
              try { controller.enqueue(enc.encode(chunk)); } catch { closed = true; }
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

                const calls = detailed.map((c: any) => {
                  const structured: { role: "agent" | "user"; content: string }[] =
                    Array.isArray(c.transcript_object) && c.transcript_object.length > 0
                      ? c.transcript_object.map((t: any) => ({
                          role: (t.role ?? "agent") as "agent" | "user",
                          content: t.content ?? "",
                        }))
                      : parseTranscriptString(c.transcript ?? "");

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
                  };
                });

                const callIds = calls.map((c) => c.call_id).join(",");
                const hasNewTranscript = detailed.some((c: any) => {
                  const t = c.transcript_object ?? [];
                  return t.length > 0 || (c.transcript ?? "").length > 0;
                });

                if (callIds !== lastCallIds || hasNewTranscript) {
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

            try { controller.close(); } catch { /* already closed */ }
          },
          cancel() { closed = true; },
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
