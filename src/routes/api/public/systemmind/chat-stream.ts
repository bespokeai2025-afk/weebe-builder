/**
 * POST /api/public/systemmind/chat-stream
 *
 * Streams OpenAI chat completions as Server-Sent Events so the SystemMind
 * Chat UI can render tokens as they arrive rather than waiting for the full reply.
 *
 * Auth: Supabase JWT as `Authorization: Bearer <access_token>`.
 *
 * Request body (JSON):
 *   {
 *     messages: Array<{ role: "user"|"assistant"; content: string }>,
 *     platformData?: unknown,
 *     personality?: "professional"|"friendly"|"concise"
 *   }
 *
 * SSE events:
 *   data: {"type":"token","content":"..."}   — one per streamed chunk
 *   data: {"type":"done"}                    — signals completion
 *   data: {"type":"error","message":"..."}   — signals a server error
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const HEALTH_LABELS: Record<string, string> = {
  openai: "OpenAI (AI runtime)",
  retell: "Retell (voice)",
  elevenlabs: "ElevenLabs (voice)",
  twilio: "Twilio (telephony)",
  whatsapp: "WhatsApp channel",
  calcom: "Cal.com (calendar)",
};

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function resolveWorkspace(token: string): Promise<{ workspaceId: string | null; apiKey: string | null }> {
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) return { workspaceId: null, apiKey: null };

    const { data: wm } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", data.user.id)
      .limit(1)
      .maybeSingle();
    const workspaceId = wm?.workspace_id ?? null;
    if (!workspaceId) return { workspaceId: null, apiKey: null };

    const { data: ws } = await supabaseAdmin
      .from("workspace_settings")
      .select("openai_api_key")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const apiKey =
      (ws as any)?.openai_api_key?.trim() ||
      process.env.OPENAI_API_KEY ||
      null;

    return { workspaceId, apiKey };
  } catch {
    return { workspaceId: null, apiKey: null };
  }
}

function buildSystemPrompt(platformData: any, personality: string): string {
  const tone =
    personality === "friendly" ? "warm, encouraging, and practical"
    : personality === "concise" ? "direct, bullet-pointed, and brief"
    : "professional, technical, and risk-aware";

  const health: Record<string, boolean> = platformData?.systemHealth ?? {};
  const integrations = platformData?.integrations ?? { connected: 0, total: 0 };
  const usage = platformData?.usage ?? { totalCostUsd: 0, requests: 0, errors: 0, errorRate: 0 };

  const healthLines = Object.entries(health)
    .map(([k, v]) => `- ${HEALTH_LABELS[k] ?? k}: ${v ? "✅ connected" : "❌ not connected"}`)
    .join("\n");

  return `You are SystemMind, an AI Chief Technology Officer (CTO) built into the Webee platform.

Your communication style is ${tone}.

You are a pure technical/operations strategist. You focus on: platform reliability, monitoring, observability, security, error tracking, infrastructure, API & telephony reliability, database operations, AI runtime monitoring, and runtime cost efficiency.

## Live Platform Telemetry

### Integrations (${integrations.connected}/${integrations.total} connected)
${healthLines || "- No health data available"}

### Runtime & Reliability
- Total provider requests: ${usage.requests ?? 0}
- Errors: ${usage.errors ?? 0} | Error rate: ${usage.errorRate ?? 0}%
- Runtime spend: $${Number(usage.totalCostUsd ?? 0).toFixed(2)}
- Agents deployed: ${platformData?.agents?.total ?? 0}

## Your Role as CTO
1. Surface highest-impact reliability, security and infrastructure risks
2. Recommend specific technical actions with clear operational impact
3. Flag cost-efficiency and error-rate problems before they escalate
4. Advise on monitoring, observability and resilience best practice
5. Always cite specific numbers from the telemetry above
6. Keep responses concise and actionable — every recommendation has a clear next step`;
}

export const Route = createFileRoute("/api/public/systemmind/chat-stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("Authorization") ?? "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (!token) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { workspaceId, apiKey } = await resolveWorkspace(token);
        if (!workspaceId) {
          return new Response("Unauthorized", { status: 401 });
        }
        if (!apiKey) {
          return new Response(
            sseChunk({ type: "error", message: "OpenAI API key not configured. Add it in Settings → Integrations." }),
            { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
          );
        }

        let body: any;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        const messages: Array<{ role: "user" | "assistant"; content: string }> = body.messages ?? [];
        const platformData = body.platformData ?? null;
        const personality = body.personality ?? "professional";

        // Optionally retrieve RAG context from the SystemMind KB
        let knowledgeBlock = "";
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        if (lastUser) {
          try {
            const { querySystemMindKnowledgeContext } = await import(
              "@/lib/systemmind/systemmind-workflow.server"
            );
            knowledgeBlock = await querySystemMindKnowledgeContext(workspaceId, lastUser, apiKey);
          } catch {
            try {
              const { getRetrievedKnowledgeBlock } = await import(
                "@/lib/executives/executive-knowledge.server"
              );
              knowledgeBlock = await getRetrievedKnowledgeBlock({
                workspaceId,
                mindType: "systemmind",
                query: lastUser,
                topK: 5,
              });
            } catch { /* best-effort */ }
          }
        }

        const systemPrompt = buildSystemPrompt(platformData, personality) +
          (knowledgeBlock ? `\n\n${knowledgeBlock}` : "");

        const openAiMessages = [
          { role: "system", content: systemPrompt },
          ...messages,
        ];

        const encoder = new TextEncoder();
        let streamClosed = false;

        const readable = new ReadableStream({
          async start(controller) {
            const enqueue = (chunk: string) => {
              if (!streamClosed) {
                try { controller.enqueue(encoder.encode(chunk)); } catch { streamClosed = true; }
              }
            };

            try {
              const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                  model: "gpt-4o",
                  messages: openAiMessages,
                  max_tokens: 900,
                  temperature: 0.6,
                  stream: true,
                }),
              });

              if (!res.ok) {
                const errText = await res.text().catch(() => res.statusText);
                enqueue(sseChunk({ type: "error", message: `OpenAI error: ${errText.slice(0, 200)}` }));
                controller.close();
                return;
              }

              const reader = res.body?.getReader();
              if (!reader) {
                enqueue(sseChunk({ type: "error", message: "No response stream" }));
                controller.close();
                return;
              }

              const dec = new TextDecoder();
              let buffer = "";

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += dec.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed || !trimmed.startsWith("data:")) continue;
                  const payload = trimmed.slice(5).trim();
                  if (payload === "[DONE]") continue;
                  try {
                    const chunk = JSON.parse(payload);
                    const content: string = chunk.choices?.[0]?.delta?.content ?? "";
                    if (content) {
                      enqueue(sseChunk({ type: "token", content }));
                    }
                  } catch { /* skip malformed chunk */ }
                }
              }

              enqueue(sseChunk({ type: "done" }));
            } catch (e: any) {
              enqueue(sseChunk({ type: "error", message: e?.message ?? "Stream failed" }));
            } finally {
              streamClosed = true;
              try { controller.close(); } catch { /* already closed */ }
            }
          },
          cancel() {
            streamClosed = true;
          },
        });

        return new Response(readable, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
