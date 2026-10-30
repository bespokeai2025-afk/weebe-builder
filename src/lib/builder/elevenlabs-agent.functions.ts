/** Builder — deploying an agent to ElevenLabs Conversational AI. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Resolve the ElevenLabs API key for the current workspace.
 * Falls back to the platform ELEVENLABS_API_KEY env var.
 */
async function resolveElevenLabsApiKey(workspaceId: string | null): Promise<string> {
  if (workspaceId) {
    try {
      const { data: ws } = await supabaseAdmin
        .from("workspace_settings")
        .select("elevenlabs_api_key" as never)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const wsKey = ((ws as Record<string, unknown> | null)?.elevenlabs_api_key as string | undefined)?.trim();
      if (wsKey) return wsKey;
    } catch { /* column may not exist yet — fall through */ }
  }
  const platformKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!platformKey) throw new Error("ElevenLabs API key not configured. Add it in Settings → Integrations.");
  return platformKey;
}

/**
 * Translate Retell-format tool definitions to ElevenLabs ConvAI tool schema.
 * Retell tools with a `url` field become ElevenLabs "webhook" server tools;
 * all others become "client" tools handled by the calling interface.
 */
function translateToElevenLabsTools(retellTools: unknown[]): unknown[] {
  const results: unknown[] = [];
  for (const t of retellTools) {
    const tool = t as Record<string, unknown>;
    const rawName = (tool.name as string | undefined) ?? "";
    const name = rawName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    if (!name) continue;
    const description = (tool.description as string | undefined) ?? "";
    const parameters = (tool.parameters as Record<string, unknown> | undefined) ?? {
      type: "object",
      properties: {},
      required: [],
    };
    const url = tool.url as string | undefined;
    if (url) {
      results.push({
        type: "webhook",
        name,
        description,
        api_schema: { url, method: "POST", request_body_schema: parameters },
      });
    } else {
      results.push({ type: "client", name, description, parameters });
    }
  }
  return results;
}

export const deployElevenLabsAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      agentId?: string | null;
      agentName: string;
      systemPrompt: string;
      firstMessage: string;
      voiceId: string;
      language: string;
      webhookUrl?: string;
      tools?: unknown[];
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const workspaceId = (context as Record<string, unknown>).workspaceId as string | null ?? null;
    const elKey = await resolveElevenLabsApiKey(workspaceId);

    // Read workspace-level OpenAI API key (for ElevenLabs' OpenAI integration
    // and post-call pipeline analysis). Falls back to platform OPENAI_API_KEY.
    let workspaceOpenAiKey: string | null = null;
    if (workspaceId) {
      try {
        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("openai_api_key" as never)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        workspaceOpenAiKey = ((ws as Record<string, unknown> | null)?.openai_api_key as string | undefined)?.trim() ?? null;
      } catch { /* column may not exist */ }
    }
    const effectiveOpenAiKey = workspaceOpenAiKey ?? process.env.OPENAI_API_KEY ?? null;

    const elTools = translateToElevenLabsTools(data.tools ?? []);

    const body = {
      name: data.agentName,
      conversation_config: {
        agent: {
          prompt: {
            prompt: data.systemPrompt,
            llm: "gpt-4o",
            ...(effectiveOpenAiKey ? { llm_extra_body: { api_key: effectiveOpenAiKey } } : {}),
            ...(elTools.length > 0 ? { tools: elTools } : {}),
          },
          first_message: data.firstMessage || "",
          language: (data.language || "en").slice(0, 2),
        },
        tts: {
          model_id: "eleven_turbo_v2_5",
          voice_id: data.voiceId || "",
          stability: 0.5,
          similarity_boost: 0.8,
          speed: 1.0,
          optimize_streaming_latency: 3,
        },
      },
      ...(data.webhookUrl
        ? {
            platform_settings: {
              webhook: {
                url: process.env.ELEVENLABS_WEBHOOK_SECRET
                  ? `${data.webhookUrl}?secret=${process.env.ELEVENLABS_WEBHOOK_SECRET}`
                  : data.webhookUrl,
              },
            },
          }
        : {}),
    };

    let res: Response;
    if (data.agentId) {
      res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${data.agentId}`, {
        method: "PATCH",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
        method: "POST",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* raw */ }
    if (!res.ok) {
      const msg = (parsed.detail as string | undefined) || text || res.statusText;
      throw new Error(`ElevenLabs agent API ${res.status}: ${msg}`);
    }
    const agentId = String((parsed.agent_id ?? parsed.id ?? "") as string);
    if (!agentId) throw new Error("ElevenLabs did not return an agent ID");
    return { agentId };
  });

/**
 * Get a signed WebSocket URL for an ElevenLabs Conversational AI agent.
 * The signed URL is a short-lived token — use it immediately in the browser.
 */
export const getElevenLabsSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { agentId: string }) => input)
  .handler(async ({ context, data }) => {
    const workspaceId = (context as Record<string, unknown>).workspaceId as string | null ?? null;
    const elKey = await resolveElevenLabsApiKey(workspaceId);

    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(data.agentId)}`,
      { headers: { "xi-api-key": elKey } },
    );
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* raw */ }
    if (!res.ok) {
      const msg = (parsed.detail as string | undefined) || text || res.statusText;
      throw new Error(`ElevenLabs signed URL ${res.status}: ${msg}`);
    }
    const signedUrl = String(parsed.signed_url ?? "");
    if (!signedUrl) throw new Error("ElevenLabs did not return a signed URL");
    return { signedUrl };
  });
