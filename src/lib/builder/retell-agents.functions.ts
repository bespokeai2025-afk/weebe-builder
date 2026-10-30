/** Builder — Retell agents: web calls, fetching and listing agents, cloning for deploy. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildDocumentTools } from "@/lib/documents/document-tools.server";
import { getRetailWorkspaceId, isRetailDeployEnabled } from "@/lib/deploy/config.server";
import { registerCalcomWebhook } from "@/lib/providers/calcom/webhook-register.server";
import { RETELL_BASE, RetellApiError, rememberProductionRetellApiKey, retellFetch } from "@/lib/builder/retell-telephony.server";
import { createRetellWebCallV3 } from "@/lib/retell/web-call.server";
import { READONLY_KEYS, maybeBuildBookingToolsForWorkspace, resolveProductionApiKey, sanitizeRetellConversationFlow, stripKeys } from "./retell-deploy-helpers.server";

export const createRetellWebCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { agentId: string; dynamicVariables?: Record<string, string> }) => input)
  .handler(async ({ data, context }) => {
    const agentId = (data.agentId ?? "").trim();
    if (!agentId || !agentId.startsWith("agent_")) {
      throw new Error(
        `Invalid agent ID "${agentId}". Deploy the agent first to get a real ID (starts with "agent_").`,
      );
    }
    // Spend-cap gate: block the call if the user is already over their cap.
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("spend_limit_cents, spend_used_cents")
      .eq("user_id", context.userId)
      .maybeSingle();
    const limit = prof?.spend_limit_cents ?? 500;
    const used = prof?.spend_used_cents ?? 0;
    if (used >= limit) {
      throw new Error(
        `Test-call spend cap reached ($${(used / 100).toFixed(2)} of $${(limit / 100).toFixed(2)}). Ask an admin to add credits.`,
      );
    }

    // Use the same API key that was used to create the agent. The agent may
    // live in the workspace's own Retell account (retell_workspace_id), not
    // the platform account. Using the wrong key gives a 404.
    let webCallKey: string | undefined;
    const wsId = context.workspaceId;
    if (wsId) {
      const { data: wsSettings } = await supabaseAdmin
        .from("workspace_settings")
        .select("retell_workspace_id")
        .eq("workspace_id", wsId)
        .maybeSingle();
      const wk = wsSettings?.retell_workspace_id?.trim();
      if (wk && wk.startsWith("key_")) webCallKey = wk;
    }

    const dynamicVariables = data.dynamicVariables ?? {};
    const apiKey = webCallKey || process.env.RETELL_API_KEY;
    if (!apiKey) throw new Error("RETELL_API_KEY is not configured");
    // v3 (v2 create-web-call support ended 2026-10-18). transport / url / iceServers go to the
    // browser SDK with the token.
    return createRetellWebCallV3(apiKey, {
      agent_id: agentId,
      ...(Object.keys(dynamicVariables).length > 0
        ? { retell_llm_dynamic_variables: dynamicVariables }
        : {}),
    });
  });

/**
 * Fetch a Retell agent (and its conversation flow) by agent ID so the builder
 * can load an existing agent for editing.
 */
export const fetchRetellAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { agentId: string }) => input)
  .handler(async ({ data, context }) => {
    const agentId = (data.agentId ?? "").trim();
    if (!agentId.startsWith("agent_")) {
      return {
        ok: false as const,
        error: `Invalid agent ID "${agentId}". Must start with "agent_".`,
      };
    }
    // Verify the calling user owns this Retell agent before exposing config.
    const { data: ownedRows, error: ownErr } = await supabaseAdmin
      .from("agents")
      .select("id")
      .eq("user_id", context.userId)
      .eq("retell_agent_id", agentId)
      .limit(1);
    if (ownErr) {
      return { ok: false as const, error: ownErr.message };
    }
    if (!ownedRows || ownedRows.length === 0) {
      return { ok: false as const, error: "You do not have access to this agent." };
    }
    try {
      const agent = await retellFetch(`/get-agent/${agentId}`, undefined, "GET");
      const engine = (agent.response_engine ?? {}) as Record<string, unknown>;
      const cfId = String(engine.conversation_flow_id ?? "");
      if (!cfId) {
        return {
          ok: false as const,
          error: "This agent is not a conversation-flow agent and cannot be loaded.",
        };
      }
      const cf = await retellFetch(`/get-conversation-flow/${cfId}`, undefined, "GET");
      return {
        ok: true as const,
        agentJson: JSON.stringify({ ...agent, conversationFlow: cf }),
        agentId,
        conversationFlowId: cfId,
      };
    } catch (err) {
      // Expected failure (e.g. 404 "agent not found"): return a friendly
      // error instead of throwing so the dev runtime overlay doesn't blank
      // the screen on a recoverable user mistake.
      const status = err instanceof RetellApiError ? err.status : undefined;
      const message =
        status === 404
          ? `Agent ${agentId} was not found. It may have been deleted.`
          : (err as Error).message;
      return { ok: false as const, error: message };
    }
  });

/**
 * Resolve the workspace's OWN Retell API key (admin-provisioned, stored in
 * workspace_settings.retell_workspace_id). Returns undefined when the
 * workspace has no dedicated key — callers must fail closed in that case
 * (never fall back to the shared platform key, which would expose other
 * tenants' agents).
 */
async function getWorkspaceOwnRetellKey(workspaceId: string | null | undefined): Promise<string | undefined> {
  if (!workspaceId) return undefined;
  const { data: ws } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const key = ws?.retell_workspace_id?.trim();
  return key && key.startsWith("key_") ? key : undefined;
}

/**
 * List the agents that live in THIS workspace's own Retell account so the
 * builder can offer them for direct loading (Import dialog → "Load from your
 * voice workspace"). Only available for workspaces provisioned with their own
 * Retell key; fails closed otherwise (the shared platform key holds agents
 * from many tenants).
 */
export const listWorkspaceRetellAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = await getWorkspaceOwnRetellKey(context.workspaceId);
    if (!key) {
      return {
        ok: false as const,
        agents: [] as Array<{ agentId: string; name: string; isFlow: boolean; lastModified: number | null }>,
        error: "This workspace does not have its own voice workspace key configured.",
      };
    }
    try {
      const { listRetellAgents } = await import("@/lib/providers/retell/list.server");
      const rows = (await listRetellAgents(key)) as Array<Record<string, unknown>>;
      // Retell returns one row per published version — keep the newest per agent_id.
      const byId = new Map<string, Record<string, unknown>>();
      for (const a of rows) {
        const id = String(a.agent_id ?? "");
        if (!id) continue;
        const prev = byId.get(id);
        const ts = Number(a.last_modification_timestamp ?? 0);
        if (!prev || ts > Number(prev.last_modification_timestamp ?? 0)) byId.set(id, a);
      }
      const agents = Array.from(byId.values())
        .map((a) => {
          const engine = (a.response_engine ?? {}) as Record<string, unknown>;
          return {
            agentId: String(a.agent_id),
            name: String(a.agent_name ?? a.agent_id),
            isFlow: Boolean(engine.conversation_flow_id),
            lastModified: a.last_modification_timestamp != null ? Number(a.last_modification_timestamp) : null,
          };
        })
        .sort((x, y) => (y.lastModified ?? 0) - (x.lastModified ?? 0));
      return { ok: true as const, agents, error: null };
    } catch (err) {
      return {
        ok: false as const,
        agents: [] as Array<{ agentId: string; name: string; isFlow: boolean; lastModified: number | null }>,
        error: (err as Error).message,
      };
    }
  });

/**
 * Fetch an agent (and its conversation flow) from THIS workspace's own Retell
 * account so it can be loaded into the builder. Authorization comes from the
 * workspace key itself: only agents visible under that key can be read, and
 * there is deliberately NO platform-key fallback (fail closed).
 */
export const fetchWorkspaceRetellAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { agentId: string }) => input)
  .handler(async ({ data, context }) => {
    const agentId = (data.agentId ?? "").trim();
    if (!agentId.startsWith("agent_")) {
      return { ok: false as const, error: `Invalid agent ID "${agentId}".` };
    }
    const key = await getWorkspaceOwnRetellKey(context.workspaceId);
    if (!key) {
      return {
        ok: false as const,
        error: "This workspace does not have its own voice workspace key configured.",
      };
    }
    try {
      const agent = await retellFetch(`/get-agent/${agentId}`, undefined, "GET", key);
      const engine = (agent.response_engine ?? {}) as Record<string, unknown>;
      const cfId = String(engine.conversation_flow_id ?? "");
      if (!cfId) {
        return {
          ok: false as const,
          error: "This agent is not a conversation-flow agent and cannot be loaded into the builder.",
        };
      }
      const cf = await retellFetch(`/get-conversation-flow/${cfId}`, undefined, "GET", key);
      return {
        ok: true as const,
        agentJson: JSON.stringify({ ...agent, conversationFlow: cf }),
        agentId,
        conversationFlowId: cfId,
      };
    } catch (err) {
      const status = err instanceof RetellApiError ? err.status : undefined;
      const message =
        status === 404
          ? `Agent ${agentId} was not found in this workspace's voice account.`
          : (err as Error).message;
      return { ok: false as const, error: message };
    }
  });

/**
 * Clone a Retell agent + conversation flow into a separate Retell workspace
 * (a workspace = a distinct Retell API key). The client supplies a label so
 * the live/production copy is clearly identifiable in their Retell dashboard,
 * and optionally a separate production API key — when omitted, the clone is
 * created in the same workspace as the source.
 */
export const cloneRetellAgentForDeploy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      sourceAgentId: string;
      agentName?: string;
      productionApiKey?: string;
      agentRowId?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const src = (data.sourceAgentId ?? "").trim();
    if (!src.startsWith("agent_")) throw new Error("Invalid source agent ID");

    // Resolve the label: use explicit name, or fall back to the user's
    // approved workspace_request name (their company name).
    let label = (data.agentName ?? "").trim();
    if (!label && context.workspaceId) {
      const { data: wsReq } = await supabaseAdmin
        .from("workspace_requests")
        .select("workspace_name")
        .eq("user_id", context.userId)
        .eq("status", "approved")
        .order("decided_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      label = wsReq?.workspace_name ?? "";
    }
    if (!label) throw new Error("A company / workspace name is required to go live.");

    // Resolve the production API key: explicit > stored in agent_retell_secrets
    // > admin-provisioned key in workspace_settings.retell_workspace_id.
    let explicitKey = (data.productionApiKey ?? "").trim() || undefined;
    if (!explicitKey && context.workspaceId) {
      const { data: ws } = await supabaseAdmin
        .from("workspace_settings")
        .select("retell_workspace_id")
        .eq("workspace_id", context.workspaceId)
        .maybeSingle();
      // retell_workspace_id stores the admin-provisioned production API key.
      const storedKey = ws?.retell_workspace_id?.trim();
      if (storedKey && storedKey.startsWith("key_")) explicitKey = storedKey;
    }
    const prodKey = resolveProductionApiKey(explicitKey);

    // The source agent may have been created in either the platform workspace
    // (if no workspace key was configured at build time) or in the client's own
    // Retell workspace (if the workspace key was set before the first builder
    // deploy). Try the workspace key first; fall back to the platform key on 404
    // so agents created before the workspace key was provisioned can still clone.
    const srcReadKey = explicitKey || undefined;

    // Fetch the source agent, tracking which key actually worked so the CF
    // fetch can use the same one without an extra round-trip.
    let actualSrcKey: string | undefined = srcReadKey;
    let agent: Record<string, unknown>;
    try {
      agent = (await retellFetch(`/get-agent/${src}`, undefined, "GET", srcReadKey)) as Record<string, unknown>;
    } catch (e) {
      if (srcReadKey && e instanceof RetellApiError && e.status === 404) {
        // Agent was created before workspace key was provisioned — fall back to platform key.
        console.warn("[go-live] Agent not found with workspace key, retrying with platform key");
        agent = (await retellFetch(`/get-agent/${src}`, undefined, "GET", undefined)) as Record<string, unknown>;
        actualSrcKey = undefined;
      } else {
        throw e;
      }
    }

    const engine = (agent.response_engine ?? {}) as Record<string, unknown>;
    const srcCfId = String(engine.conversation_flow_id ?? "");
    if (!srcCfId) throw new Error("Source agent has no conversation flow");

    const cf = (await retellFetch(
      `/get-conversation-flow/${srcCfId}`,
      undefined,
      "GET",
      actualSrcKey,
    )) as Record<string, unknown>;

    const cfBody = sanitizeRetellConversationFlow(stripKeys(cf, READONLY_KEYS));

    // Absolutize relative tool URLs so Retell's production workspace doesn't
    // reject the CF with a URL validation error.
    const clonePubBase =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (Array.isArray(cfBody.tools) && clonePubBase) {
      cfBody.tools = (cfBody.tools as Array<Record<string, unknown>>).map((tool) => {
        if (tool.type === "custom" && typeof tool.url === "string" && tool.url.startsWith("/")) {
          console.log("[go-live] Absolutizing tool URL:", tool.name, tool.url);
          return { ...tool, url: `${clonePubBase}${tool.url}` };
        }
        return tool;
      });
    }

    console.log("[go-live] Creating production CF, tools:", (cfBody.tools as Array<Record<string,unknown>> | undefined)?.map((t) => ({ name: t.name, type: t.type, url: t.url })));
    let cfResp: Record<string, unknown>;
    try {
      cfResp = await retellFetch(`/create-conversation-flow`, cfBody, "POST", prodKey);
    } catch (cfErr) {
      console.error("[go-live] CF creation FAILED:", (cfErr as Error).message);
      throw cfErr;
    }
    const newCfId = String(cfResp.conversation_flow_id ?? "");
    if (!newCfId) throw new Error("Production workspace did not return a conversation_flow_id");

    const agentBody = stripKeys(agent, READONLY_KEYS);
    delete (agentBody as Record<string, unknown>).response_engine;
    agentBody.agent_name = label;
    agentBody.response_engine = {
      type: "conversation-flow",
      conversation_flow_id: newCfId,
    };

    // Use the builder's intended voice_id (stored in agent settings) rather
    // than the voice from the platform agent, which may have been silently
    // fallen back to 11labs-Adrian when the custom voice wasn't available in
    // the platform Retell workspace.
    if (data.agentRowId) {
      const { data: agentRow } = await supabaseAdmin
        .from("agents")
        .select("settings")
        .eq("id", data.agentRowId)
        .maybeSingle();
      const storedSettings = (agentRow?.settings as Record<string, unknown> | null) ?? {};
      const intendedVoiceId = (storedSettings.voiceId as string | undefined)?.trim();
      if (intendedVoiceId) {
        agentBody.voice_id = intendedVoiceId;
        // Preserve voice_model from stored settings for ElevenLabs voices.
        const intendedVoiceModel = (storedSettings.voiceModel as string | undefined)?.trim();
        if (intendedVoiceId.startsWith("11labs-")) {
          agentBody.voice_model =
            intendedVoiceModel ||
            (agent.voice_model as string | undefined) ||
            "eleven_turbo_v2";
        }
      }
    }

    // Auto-attach booking tools if this workspace has Cal.com connected.
    // In retail mode, use the shared retail workspace so all deployed agents
    // share the same Cal.com config (set up once in the retail workspace).
    const retailWs = isRetailDeployEnabled() ? getRetailWorkspaceId() : undefined;
    const bkWorkspaceId = retailWs || context.workspaceId;
    if (!bkWorkspaceId) throw new Error("No active workspace");
    const bookingTools = await maybeBuildBookingToolsForWorkspace(bkWorkspaceId);
    const calendarConnected = bookingTools !== null;
    if (bookingTools) {
      const existing = Array.isArray(agentBody.general_tools)
        ? (agentBody.general_tools as Array<Record<string, unknown>>)
        : [];
      const ourNames = new Set(bookingTools.map((t) => t.name));
      agentBody.general_tools = [
        ...existing.filter((t) => !ourNames.has(t.name as string)),
        ...bookingTools,
      ];
    }

    // Auto-attach document tools (check_documents + send_upload_link) to every
    // deployed agent — they degrade gracefully when unused.
    {
      const cloneDocTools = buildDocumentTools() as Array<Record<string, unknown>>;
      const existing = Array.isArray(agentBody.general_tools)
        ? (agentBody.general_tools as Array<Record<string, unknown>>)
        : [];
      const docNames = new Set(cloneDocTools.map((t) => t.name as string));
      agentBody.general_tools = [
        ...existing.filter((t) => !docNames.has(t.name as string)),
        ...cloneDocTools,
      ];
    }

    // Always inject webhook URL so call events are tracked automatically.
    // Unconditional — overwrite any stale URL the source agent may have had.
    const cloneWebhookBase =
      process.env.PUBLIC_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
    if (cloneWebhookBase) {
      agentBody.webhook_url = `${cloneWebhookBase}/api/public/voice-webhook`;
    }
    // Enable `transcript_updated` for LIVE dashboard transcripts, preserving the
    // default trio (call_started/ended/analyzed) the app relies on.
    {
      const LIVE_WEBHOOK_EVENTS = [
        "call_started",
        "call_ended",
        "call_analyzed",
        "transcript_updated",
      ];
      const existingEvents = Array.isArray(agentBody.webhook_events)
        ? (agentBody.webhook_events as string[])
        : [];
      agentBody.webhook_events = Array.from(
        new Set([...existingEvents, ...LIVE_WEBHOOK_EVENTS]),
      );
    }

    // Create the cloned agent in the production workspace.
    // ElevenLabs voices must be registered per-workspace — the voice ID that
    // worked in the platform workspace won't exist in the client's workspace.
    // Attempt auto-registration with prodKey before falling back to the default.
    let agentResp: Record<string, unknown>;
    try {
      agentResp = await retellFetch(`/create-agent`, agentBody, "POST", prodKey);
    } catch (e) {
      if (/voice.*not found|not found.*voice/i.test((e as Error).message)) {
        const failedVoiceId = agentBody.voice_id as string | undefined;
        const suffix = typeof failedVoiceId === "string" && failedVoiceId.startsWith("11labs-")
          ? failedVoiceId.slice(7)
          : null;
        let registered = false;
        if (suffix && suffix.length >= 12) {
          // Long suffix = a real ElevenLabs voice ID — register it in the production workspace.
          try {
            const regRes = await fetch(`${RETELL_BASE}/add-community-voice`, {
              method: "POST",
              headers: { Authorization: `Bearer ${prodKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ voice_name: suffix, voice_provider: "elevenlabs", provider_voice_id: suffix }),
            });
            if (regRes.ok) {
              const regJson = (await regRes.json()) as Record<string, unknown>;
              const newVoiceId = String(regJson.voice_id ?? "");
              if (newVoiceId) {
                agentBody.voice_id = newVoiceId;
                console.log("[go-live] Auto-registered ElevenLabs voice in production workspace", failedVoiceId, "→", newVoiceId);
                registered = true;
              }
            }
          } catch { /* fall through to default */ }
        }
        if (!registered) {
          // Built-in ElevenLabs short name (e.g. 11labs-Adrian) that's already in
          // the production workspace — just use it directly as the fallback.
          agentBody.voice_id = "11labs-Adrian";
          console.warn("[go-live] Voice not found in production workspace, falling back to 11labs-Adrian", failedVoiceId);
        }
        agentResp = await retellFetch(`/create-agent`, agentBody, "POST", prodKey);
      } else {
        throw e;
      }
    }
    const newAgentId = String(agentResp.agent_id ?? "");
    if (!newAgentId) throw new Error("Production workspace did not return an agent_id");
    await rememberProductionRetellApiKey(data.agentRowId, context.userId, prodKey);

    // Register Cal.com webhook when the CF has native cal tools.
    const goLiveHasCal =
      Array.isArray(cfBody.tools) &&
      (cfBody.tools as Array<Record<string, unknown>>).some(
        (t) => t.type === "check_availability_cal" || t.type === "book_appointment_cal",
      );
    if (goLiveHasCal && bkWorkspaceId) {
      const goLiveWebhookBase =
        process.env.PUBLIC_BASE_URL ||
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
      if (goLiveWebhookBase) {
        try {
          const wh = await registerCalcomWebhook({
            workspaceId: bkWorkspaceId,
            subscriberUrl: `${goLiveWebhookBase}/api/public/calcom-webhook`,
          });
          console.log("[go-live] Cal.com webhook registration:", wh.message);
        } catch (whErr) {
          console.warn("[go-live] Cal.com webhook registration failed:", whErr);
        }
      }
    }

    console.log("[go-live] Complete", { newAgentId, newCfId, calendarConnected });
    return {
      agentId: newAgentId,
      conversationFlowId: newCfId,
      agentName: String(agentResp.agent_name ?? label),
      separateWorkspace: true,
      calendarConnected,
      bookingToolsAttached: calendarConnected,
    };
  });

// ─── VoxStream (ElevenLabs Conversational AI) helpers ────────────────────────
