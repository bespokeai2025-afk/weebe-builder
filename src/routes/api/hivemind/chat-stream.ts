/**
 * Streaming HiveMind chat endpoint (Task #523).
 *
 * POST /api/hivemind/chat-stream  { query, history?, personality?, userName? }
 * Auth: `Authorization: Bearer <supabase JWT>` header + wb_workspace_id cookie
 * (same resolution as requireSupabaseAuth — an RLS-scoped user client, NEVER
 * the admin client, so workspace isolation is identical to the server fn).
 *
 * Response: text/event-stream frames
 *   data: {"type":"token","text":"..."}      — incremental assistant text
 *   data: {"type":"status","label":"..."}    — progress ("Checking your live data…")
 *   data: {"type":"done", response, actionsTaken, workOrderProposals }
 *   data: {"type":"error","message":"..."}   — honest human failure message
 *
 * The non-streaming server fn getHiveMindAIResponse remains as the fallback
 * path; both share prepareHiveMindChat + runHiveMindToolLoop so behavior,
 * tone, tools, approvals and isolation can never drift.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { resolveWorkspaceIdForUser } from "@/lib/workspace/resolve-workspace.server";
import {
  prepareHiveMindChat,
  runHiveMindToolLoop,
} from "@/lib/hivemind/hivemind.ai";
import { buildHiveMindFailureMessage } from "@/lib/hivemind/hivemind-style.shared";

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

async function authenticate(request: Request): Promise<
  | { ok: true; sb: any; userId: string; workspaceId: string }
  | { ok: false; status: number; message: string }
> {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, status: 500, message: "Supabase environment not configured" };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, message: "Unauthorized" };

  const sb = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  let userId: string | undefined;
  try {
    const { data, error } = await sb.auth.getClaims(token);
    if (error || !data?.claims?.sub) return { ok: false, status: 401, message: "Unauthorized" };
    userId = data.claims.sub as string;
  } catch {
    return { ok: false, status: 401, message: "Unauthorized" };
  }

  const workspaceId = await resolveWorkspaceIdForUser(
    sb,
    userId,
    readCookie(request, "wb_workspace_id"),
  );
  if (!workspaceId) return { ok: false, status: 403, message: "No workspace" };

  return { ok: true, sb, userId, workspaceId };
}

export const Route = createFileRoute("/api/hivemind/chat-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if (!auth.ok) {
          return new Response(auth.message, { status: auth.status });
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        const query = typeof body?.query === "string" ? body.query.trim() : "";
        if (!query || query.length > 2000) {
          return new Response("query required (max 2000 chars)", { status: 400 });
        }
        const history = Array.isArray(body?.history)
          ? body.history
              .filter(
                (m: any) =>
                  m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
              )
              .slice(-10)
              .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
          : [];
        const personality =
          typeof body?.personality === "string" ? body.personality.slice(0, 40) : undefined;
        const userName =
          typeof body?.userName === "string" ? body.userName.slice(0, 80) : undefined;

        const { sb, userId, workspaceId } = auth;
        const enc = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            let closed = false;
            const send = (payload: unknown) => {
              if (closed) return;
              try {
                controller.enqueue(enc.encode(sse(payload)));
              } catch {
                closed = true;
              }
            };
            try {
              send({ type: "status", label: "Checking your live data…" });
              const prep = await prepareHiveMindChat(sb, workspaceId, {
                query,
                personality,
                userName,
                history,
              });

              let streamed = "";
              const result = await runHiveMindToolLoop({
                sb,
                workspaceId,
                userId,
                messages: prep.messages,
                tools: prep.tools,
                apiKey: prep.apiKey,
                maxTokens: prep.maxTokens,
                signal: request.signal,
                onToken: (text) => {
                  streamed += text;
                  send({ type: "token", text });
                },
              });

              send({
                type: "done",
                response: result.response,
                actionsTaken: result.actionsTaken,
                workOrderProposals: result.workOrderProposals,
              });
            } catch (e: any) {
              const raw = String(e?.message ?? "");
              if (e?.name !== "AbortError") {
                console.error("[HiveMind stream] failed:", raw);
                send({
                  type: "error",
                  message: /OpenAI API key/i.test(raw)
                    ? raw
                    : buildHiveMindFailureMessage({
                        what: raw.includes("OpenAI")
                          ? "reach the AI service"
                          : "load your live platform data",
                        staleNote: "so I can't give you a reliable answer right now",
                      }),
                });
              }
            } finally {
              closed = true;
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
