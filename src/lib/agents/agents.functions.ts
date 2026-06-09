import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { retellFetch } from "@/lib/providers/retell/client.server";

type Json = Database["public"]["Tables"]["agents"]["Row"]["flow_data"];

export type AgentGoLiveType = "receptionist" | "lead_generation" | "client_qualification";

export interface AgentRow {
  id: string;
  retell_agent_id: string | null;
  name: string;
  flow_data: Json;
  settings: Json;
  variables: Json;
  cost_seconds: number;
  updated_at: string;
  created_at: string;
}

/** List the signed-in user's saved agents. */
export const listMyAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("agents")
      .select("id, retell_agent_id, name, cost_seconds, settings, updated_at, created_at, inbound_phone_number")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      retell_agent_id: string | null;
      name: string;
      cost_seconds: number;
      settings: Json;
      updated_at: string;
      created_at: string;
      inbound_phone_number: string | null;
    }>;
  });

/**
 * Return every agent in the workspace with id, name, retell_agent_id and
 * settings — used on the Data page so all agents appear in dropdowns
 * regardless of live/draft status.
 */
export const listAllWorkspaceAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("agents")
      .select("id, retell_agent_id, name, settings")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      retell_agent_id: string | null;
      name: string;
      settings: Json;
    }>;
  });

/**
 * List only agents that have been pushed live via "Go Live" with
 * lead_generation or client_qualification flow type — used on the
 * Data / CSV page so only call-capable agents appear in selectors.
 */
export const listLiveAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("agents")
      .select("id, retell_agent_id, name, settings")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      id: string;
      retell_agent_id: string | null;
      name: string;
      settings: Json;
    }>;
    return rows.filter((r) => {
      const s = (r.settings ?? {}) as Record<string, unknown>;
      return s.isLive === true;
    });
  });

/** Return ALL live agents for the dashboard (all flow types). */
export const getDashboardLiveAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("agents")
      .select("id, name, settings, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      id: string;
      name: string;
      settings: Json;
      updated_at: string;
    }>;
    return rows
      .filter((r) => {
        const s = (r.settings ?? {}) as Record<string, unknown>;
        return s.isLive === true;
      })
      .map((r) => {
        const s = (r.settings ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          name: r.name,
          agentType: (s.dashboardAgentType as string | undefined) ?? "receptionist",
          phoneNumber: (s.phoneNumber as string | undefined) ?? null,
          liveAt: (s.liveAt as string | undefined) ?? null,
          deployedRetellAgentId: (s.deployedRetellAgentId as string | undefined) ?? null,
        };
      });
  });

/** Load a specific agent by row id. */
export const getMyAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row as AgentRow | null;
  });

/** Look up an existing row by Retell agent ID (so reloading by ID restores cost history). */
export const getMyAgentByRetellId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { retellAgentId: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("agents")
      .select("*")
      .eq("retell_agent_id", data.retellAgentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row as AgentRow | null;
  });

/**
 * Create or update an agent row. If `id` is supplied, update; otherwise insert.
 * Returns the persisted row id.
 */
// ---------------------------------------------------------------------------
// OpenAI Realtime schema compiler
// Converts canvas function nodes into the tool-calling format expected by
// the OpenAI Realtime API (gpt-realtime-2).  Only runs when voice_provider
// is explicitly "OPENAI_REALTIME" — the Retell path is completely untouched.
// ---------------------------------------------------------------------------

function toSnakeCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

interface OpenAITool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, never>;
    required: never[];
  };
}

interface OpenAISchema {
  tools: OpenAITool[];
  voice: string;
  reasoning_effort: string;
}

function compileOpenAISchema(
  nodes: Array<{ data?: Record<string, unknown> }>,
  settingsObj: Record<string, unknown>,
): OpenAISchema {
  const tools: OpenAITool[] = [];
  for (const node of nodes) {
    const d = node.data ?? {};
    if (d.kind !== "function") continue;
    const rawName = (d.toolName as string | undefined) || (d.label as string | undefined) || "tool";
    const rawDesc =
      (d.toolDescription as string | undefined) ||
      (d.dialogue as string | undefined) ||
      "";
    tools.push({
      type: "function",
      name: toSnakeCase(rawName) || "tool",
      description: rawDesc.length > 1024 ? `${rawDesc.slice(0, 1021)}…` : rawDesc,
      parameters: { type: "object", properties: {}, required: [] },
    });
  }
  return {
    tools,
    voice: (settingsObj.openaiVoice as string | undefined) ?? "alloy",
    reasoning_effort: (settingsObj.openaiReasoningEffort as string | undefined) ?? "low",
  };
}

export const upsertMyAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string;
      retellAgentId?: string | null;
      name: string;
      flowData: Json;
      settings: Json;
      variables: Json;
      costSeconds?: number;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    // If voice_provider is OPENAI_REALTIME, compile function nodes into the
    // OpenAI Realtime tool-calling schema and store it in settings.openaiSchema.
    // The Retell path (default) is completely unchanged.
    const settingsObj = (data.settings ?? {}) as Record<string, unknown>;
    const compiledSettings: Record<string, unknown> =
      settingsObj.voiceProvider === "OPENAI_REALTIME"
        ? {
            ...settingsObj,
            openaiSchema: compileOpenAISchema(
              ((data.flowData as Record<string, unknown>)?.nodes as Array<{
                data?: Record<string, unknown>;
              }>) ?? [],
              settingsObj,
            ),
          }
        : settingsObj;

    const base = {
      user_id: userId,
      workspace_id: workspaceId,
      retell_agent_id: data.retellAgentId ?? null,
      name: data.name,
      flow_data: data.flowData,
      settings: compiledSettings,
      variables: data.variables,
      ...(typeof data.costSeconds === "number" ? { cost_seconds: data.costSeconds } : {}),
    };

    let savedId: string;
    if (data.id) {
      const { data: row, error } = await supabase
        .from("agents")
        .update(base)
        .eq("id", data.id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      savedId = (row?.id as string) ?? data.id;
    } else {
      // Before inserting, check for an existing row with the same Retell agent ID
      // to prevent duplicate rows when the builder store loses its currentAgentRowId.
      let existingId: string | null = null;
      if (data.retellAgentId) {
        const { data: existing } = await supabase
          .from("agents")
          .select("id")
          .eq("retell_agent_id", data.retellAgentId)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        existingId = (existing?.id as string) ?? null;
      }
      if (existingId) {
        const { data: row, error } = await supabase
          .from("agents")
          .update(base)
          .eq("id", existingId)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        savedId = (row?.id as string) ?? existingId;
      } else {
        const { data: row, error } = await supabase
          .from("agents")
          .insert(base)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        savedId = row!.id as string;
      }
    }

    return { id: savedId };
  });

/** Add seconds to an agent's cost counter (atomic-ish increment via read-modify-write). */
export const addAgentCallSeconds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; seconds: number }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: cur, error: readErr } = await supabase
      .from("agents")
      .select("cost_seconds")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const next = (cur?.cost_seconds ?? 0) + Math.max(0, Math.floor(data.seconds));
    const { error } = await supabase
      .from("agents")
      .update({ cost_seconds: next })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { costSeconds: next };
  });

export const deleteMyAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase.from("agents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Save Cal.com credentials (API key) onto a specific agent's settings JSON.
 * Stored per-agent so each deployed agent can have its own calendar.
 */
export const saveAgentCalcom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; calcomApiKey: string | null; calcomEventTypeId?: string | null }) =>
      input,
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row, error: readErr } = await supabase
      .from("agents")
      .select("settings, workspace_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const settings = ((row?.settings ?? {}) as Record<string, unknown>) || {};
    const next = {
      ...settings,
      calcom: data.calcomApiKey
        ? {
            apiKey: data.calcomApiKey,
            eventTypeId: data.calcomEventTypeId ?? null,
            connectedAt: new Date().toISOString(),
          }
        : null,
    };
    const { error } = await supabase.from("agents").update({ settings: next }).eq("id", data.id);
    if (error) throw new Error(error.message);

    // Sync to workspace_settings so the builder deploy function can find the key
    // and automatically attach booking tools when the agent is deployed.
    if (row?.workspace_id) {
      if (data.calcomApiKey) {
        const wsData: Record<string, unknown> = {
          workspace_id: row.workspace_id,
          calcom_api_key: data.calcomApiKey,
        };
        if (data.calcomEventTypeId) {
          wsData.default_event_type_id = data.calcomEventTypeId;
        }
        await supabase
          .from("workspace_settings")
          .upsert(wsData, { onConflict: "workspace_id" });
      } else {
        // Disconnecting — clear workspace key too
        await supabase
          .from("workspace_settings")
          .update({ calcom_api_key: null, default_event_type_id: null })
          .eq("workspace_id", row.workspace_id);
      }
    }

    return { ok: true };
  });

/** Verify a Cal.com API key and return the user's event types for the dropdown. */
export const fetchCalcomEventTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apiKey: string }) => input)
  .handler(async ({ data }) => {
    const { listEventTypes } = await import("@/lib/calendar/calcom.server");
    try {
      const eventTypes = await listEventTypes(data.apiKey.trim());
      return {
        ok: true as const,
        eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title, length: e.length, slug: e.slug })),
        error: null as string | null,
      };
    } catch (e) {
      return {
        ok: false as const,
        eventTypes: [] as { id: number; title: string; length: number; slug: string }[],
        error: (e as Error).message,
      };
    }
  });

/** Save the deployed phone number onto an agent's settings JSON. */
export const saveAgentPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; phoneNumber: string | null }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row, error: readErr } = await supabase
      .from("agents")
      .select("settings")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const settings = ((row?.settings ?? {}) as Record<string, unknown>) || {};
    const next = { ...settings, phoneNumber: data.phoneNumber };
    const { error } = await supabase.from("agents").update({ settings: next }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Save the cloned/deployed Retell agent ID onto an agent's settings JSON so
 * phone numbers + production traffic point at the deployed copy, not the
 * dev/builder copy.
 */
export const saveAgentDeployedRetellId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; deployedRetellAgentId: string; deployedConversationFlowId?: string }) =>
      input,
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row, error: readErr } = await supabase
      .from("agents")
      .select("settings")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const settings = ((row?.settings ?? {}) as Record<string, unknown>) || {};
    const next = {
      ...settings,
      deployedRetellAgentId: data.deployedRetellAgentId,
      deployedConversationFlowId: data.deployedConversationFlowId ?? null,
      deployedAt: new Date().toISOString(),
    };
    const { error } = await supabase.from("agents").update({ settings: next }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Push an agent to the external Spark Orchestrate dashboard. Called from
 * the "Go Live" button — only fully deployed + phone-connected agents
 * should ever be synced. The agent_type is selected by the user.
 */
export const goLiveAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; agentType: AgentGoLiveType }) => input)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("agents")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Agent not found");
    const settings = ((row.settings ?? {}) as Record<string, unknown>) || {};
    const deployedRetellId = (settings.deployedRetellAgentId as string | undefined) ?? null;
    const deployedFlowId = (settings.deployedConversationFlowId as string | undefined) ?? null;
    const phoneNumber = (settings.phoneNumber as string | undefined) ?? null;
    const voiceProvider = (settings.voiceProvider as string | undefined) ?? null;
    const isOpenAiRealtime = voiceProvider === "OPENAI_REALTIME";
    // Allow Go Live when the agent has been deployed to Retell in any form
    // (dedicated production clone OR the builder agent itself).
    // OpenAI Realtime agents have no Retell ID — skip the guard for them.
    const activeRetellId = deployedRetellId ?? row.retell_agent_id;
    if (!activeRetellId && !isOpenAiRealtime) {
      throw new Error("Deploy this agent from the builder first.");
    }
    if (!phoneNumber) {
      throw new Error("Attach a phone number to the agent first.");
    }
    // Agent is live in the unified app — mark it so locally.
    await supabase
      .from("agents")
      .update({
        settings: {
          ...settings,
          dashboardAgentType: data.agentType,
          isLive: true,
          liveAt: new Date().toISOString(),
        },
      })
      .eq("id", data.id);

    // For lead generation agents: automatically patch the Retell agent's
    // webhook URL so every post-call event is delivered to this server and
    // lead intelligence / call records are populated without manual setup.
    if (data.agentType === "lead_generation") {
      const webhookBase =
        process.env.PUBLIC_BASE_URL ||
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
      if (webhookBase) {
        try {
          // Resolve the right API key: use the client workspace's Retell key
          // when the agent was cloned to a client workspace; fall back to the
          // platform key for builder-draft agents.
          let retellKey: string | undefined;
          if (deployedRetellId) {
            // 1. Try workspace-level key in workspace_settings
            if (context.workspaceId) {
              const { data: ws } = await supabaseAdmin
                .from("workspace_settings")
                .select("retell_workspace_id")
                .eq("workspace_id", context.workspaceId)
                .maybeSingle();
              const wsKey = (ws?.retell_workspace_id as string | undefined)?.trim();
              if (wsKey?.startsWith("key_")) retellKey = wsKey;
            }
            // 2. Fall back to per-agent production key stored during clone
            if (!retellKey && userId) {
              const { data: secret } = await (supabaseAdmin as any)
                .from("agent_retell_secrets")
                .select("production_api_key")
                .eq("agent_id", data.id)
                .eq("user_id", userId)
                .maybeSingle();
              const agentKey = (secret?.production_api_key as string | undefined)?.trim();
              if (agentKey?.startsWith("key_")) retellKey = agentKey;
            }
          }
          await retellFetch(
            `/update-agent/${activeRetellId}`,
            { webhook_url: `${webhookBase}/api/public/voice-webhook` },
            "PATCH",
            retellKey,
          );
          console.log("[go-live] Lead gen webhook URL configured on Retell agent", activeRetellId, webhookBase);
        } catch (whErr) {
          // Best-effort — don't block Go Live if the patch fails
          console.warn("[go-live] Failed to configure lead gen webhook URL", whErr);
        }
      }
    }

    return { ok: true, live: true };
  });

/**
 * Update an agent's voice engine provider and atomically flip the Twilio
 * inbound webhook URL on the attached phone number.
 */
export const setAgentVoiceProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; provider: "RETELL" | "OPENAI_REALTIME" }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const sb = supabase as any;

    const { data: agent, error: agentErr } = await sb
      .from("agents")
      .select("inbound_phone_number, settings, workspace_id")
      .eq("id", data.id)
      .maybeSingle();
    if (agentErr) throw new Error(agentErr.message);
    if (!agent) throw new Error("Agent not found");

    // Persist voice provider in the settings JSON (no schema migration required)
    const settings = ((agent.settings ?? {}) as Record<string, unknown>);
    const nextSettings = { ...settings, voiceProvider: data.provider };
    const { error: updateErr } = await sb
      .from("agents")
      .update({ settings: nextSettings })
      .eq("id", data.id);
    if (updateErr) throw new Error(updateErr.message);

    const phoneNumber =
      (agent.inbound_phone_number as string | null) ??
      (settings.phoneNumber as string | null) ??
      null;

    // Twilio webhook flip — wrapped in try-catch so telephony errors NEVER
    // crash the primary backend or affect other users (spec §2 isolation rule).
    let twilioWarning: string | null = null;
    if (phoneNumber && agent.workspace_id) {
      try {
        const { data: ws } = await sb
          .from("workspace_settings")
          .select("twilio_auth_token, retell_workspace_id")
          .eq("workspace_id", agent.workspace_id)
          .maybeSingle();

        const twilioSid = process.env.TWILIO_ACCOUNT_SID ?? null;
        const twilioToken =
          (ws?.twilio_auth_token as string | null) ??
          process.env.TWILIO_AUTH_TOKEN ??
          null;

        if (!twilioSid || !twilioToken) {
          throw new Error(
            "Twilio credentials not configured. Add TWILIO_ACCOUNT_SID and auth token in workspace settings.",
          );
        }

        const Twilio = (await import("twilio")).default;
        const client = Twilio(twilioSid, twilioToken);

        const numbers = await client.incomingPhoneNumbers.list({ phoneNumber });
        const numRecord = numbers[0];
        if (!numRecord) {
          throw new Error(
            `Phone number ${phoneNumber} was not found in your Twilio account.`,
          );
        }

        let voiceUrl: string;
        if (data.provider === "RETELL") {
          // Revert exactly to the production Retell webhook — no guessing
          const retellKey =
            (ws?.retell_workspace_id as string | null) ??
            process.env.RETELL_API_KEY ??
            "";
          if (!retellKey) {
            throw new Error(
              "Retell API key not configured — set it in workspace settings.",
            );
          }
          voiceUrl = `https://api.retellai.com/twilio-voice-webhook/${retellKey}`;
        } else {
          // OpenAI Realtime — only activated when explicitly chosen
          const baseUrl =
            process.env.OPENAI_REALTIME_INBOUND_URL ??
            (ws as any)?.openai_realtime_inbound_url ??
            "";
          if (!baseUrl) {
            throw new Error(
              "OpenAI Realtime inbound URL not configured. Set OPENAI_REALTIME_INBOUND_URL in your environment.",
            );
          }
          voiceUrl = `${baseUrl.replace(/\/$/, "")}/api/telephony/inbound-call`;
        }

        await client.incomingPhoneNumbers(numRecord.sid).update({ voiceUrl });
      } catch (twilioErr: unknown) {
        // Capture the error as a non-fatal warning — the DB record was already
        // saved successfully; the caller can surface this to the user.
        twilioWarning =
          twilioErr instanceof Error
            ? twilioErr.message
            : "Twilio webhook update failed for an unknown reason.";
        console.warn("[VoiceProvider] Twilio flip failed (non-fatal):", twilioWarning);
      }
    }

    return { ok: true, twilioWarning };
  });

// ---------------------------------------------------------------------------
// HyperStream Engine — browser test-call support via OpenAI Realtime WebRTC
// Creates an ephemeral session token that the browser exchanges directly with
// the OpenAI Realtime API (no server relay needed after this point).
// ---------------------------------------------------------------------------

export const createOpenAIRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agentRowId: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured on this server");

    // Load the agent row to get the compiled openaiSchema and flow.
    const { data: agent, error } = await supabase
      .from("agents")
      .select("flow_data, settings")
      .eq("id", data.agentRowId)
      .maybeSingle();
    if (error || !agent) throw new Error(error?.message ?? "Agent not found");

    const settings = (agent.settings ?? {}) as Record<string, unknown>;
    const schema = (settings.openaiSchema ?? {}) as {
      voice?: string;
      tools?: unknown[];
      reasoning_effort?: string;
    };

    // Build instruction from start conversation node dialogue (if present).
    const nodes = (
      ((agent.flow_data as Record<string, unknown>)?.nodes ?? []) as Array<{
        data?: { isStart?: boolean; kind?: string; dialogue?: string };
      }>
    );
    const startNode =
      nodes.find((n) => n.data?.isStart && n.data?.kind === "conversation") ??
      nodes.find((n) => n.data?.kind === "conversation");
    const instructions = startNode?.data?.dialogue?.trim()
      ? `You are an AI voice agent. ${startNode.data.dialogue.trim()}`
      : "You are a helpful AI voice agent. Assist callers professionally and efficiently.";

    const model = "gpt-4o-realtime-preview-2024-12-17";
    const voice = schema.voice ?? "alloy";

    // Use node:https directly to avoid any Vinxi/undici fetch interceptors
    // that can re-route absolute HTTPS URLs back through the app server.
    const sessionPayload = JSON.stringify({ model, voice, instructions });
    const { request: httpsRequest } = await import("node:https");
    const clientSecret = await new Promise<string>((resolve, reject) => {
      const req = httpsRequest(
        {
          hostname: "api.openai.com",
          port: 443,
          path: "/v1/realtime/sessions",
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "realtime=v1",
            "Content-Length": Buffer.byteLength(sessionPayload),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body) as {
                client_secret?: { value?: string };
                error?: { message?: string };
              };
              if (!res.statusCode || res.statusCode >= 400) {
                reject(new Error(parsed.error?.message ?? body));
              } else if (!parsed.client_secret?.value) {
                reject(new Error(`Unexpected response: ${body}`));
              } else {
                resolve(parsed.client_secret.value);
              }
            } catch {
              reject(new Error(`Non-JSON response: ${body}`));
            }
          });
        },
      );
      req.on("error", (e: Error) => reject(e));
      req.write(sessionPayload);
      req.end();
    });

    return { clientSecret, model, voice };
  });

/** Buy a Twilio phone number directly (used for OpenAI Realtime agents). */
export const buyTwilioPhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { areaCode?: number; tollFree?: boolean; nickname?: string; countryCode?: string }) => input,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ws } = await (supabase as any)
      .from("workspace_settings")
      .select("twilio_auth_token")
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();

    const sid = process.env.TWILIO_ACCOUNT_SID ?? null;
    const token =
      (ws?.twilio_auth_token as string | null) ??
      process.env.TWILIO_AUTH_TOKEN ??
      null;
    if (!sid || !token) {
      throw new Error(
        "Twilio not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (or set twilio_auth_token in workspace settings).",
      );
    }

    const Twilio = (await import("twilio")).default;
    const client = Twilio(sid, token);

    const countryCode = data.countryCode ?? "US";
    let available: Array<{ phoneNumber: string }>;
    if (data.tollFree) {
      available = (await client.availablePhoneNumbers(countryCode).tollFree.list({ limit: 1 })) as Array<{ phoneNumber: string }>;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listOpts: any = { limit: 1 };
      if (data.areaCode && countryCode === "US") listOpts.areaCode = data.areaCode;
      available = (await client.availablePhoneNumbers(countryCode).local.list(listOpts)) as Array<{ phoneNumber: string }>;
    }

    if (!available.length) {
      throw new Error(
        "No available numbers found. Try a different area code or switch to toll-free.",
      );
    }

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      ...(data.nickname ? { friendlyName: data.nickname } : {}),
    });

    return {
      phoneNumber: purchased.phoneNumber as string,
      nickname: (purchased.friendlyName ?? "") as string,
    };
  });

/** List Twilio phone numbers owned by this workspace (for OpenAI Realtime agents). */
export const listTwilioPhoneNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, never> | undefined) => input ?? {})
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: ws } = await (supabase as any)
      .from("workspace_settings")
      .select("twilio_auth_token")
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();

    const sid = process.env.TWILIO_ACCOUNT_SID ?? null;
    const token =
      (ws?.twilio_auth_token as string | null) ??
      process.env.TWILIO_AUTH_TOKEN ??
      null;
    if (!sid || !token) {
      return [] as Array<{ phoneNumber: string; nickname: string; inboundAgentId: string | null }>;
    }

    const Twilio = (await import("twilio")).default;
    const client = Twilio(sid, token);
    const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });
    return numbers.map((n) => ({
      phoneNumber: n.phoneNumber as string,
      nickname: (n.friendlyName ?? "") as string,
      inboundAgentId: null as string | null,
    }));
  });
