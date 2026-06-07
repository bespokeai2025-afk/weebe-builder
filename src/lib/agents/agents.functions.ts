import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

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
      .select("id, retell_agent_id, name, cost_seconds, settings, updated_at, created_at")
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
      const type = s.dashboardAgentType as string | undefined;
      return (
        s.isLive === true &&
        (type === "lead_generation" || type === "client_qualification")
      );
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
    const base = {
      user_id: userId,
      workspace_id: workspaceId,
      retell_agent_id: data.retellAgentId ?? null,
      name: data.name,
      flow_data: data.flowData,
      settings: data.settings,
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
      const { data: row, error } = await supabase
        .from("agents")
        .insert(base)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      savedId = row!.id as string;
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
      .select("settings")
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
    return { ok: true };
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
    // Allow Go Live when the agent has been deployed to Retell in any form
    // (dedicated production clone OR the builder agent itself).
    const activeRetellId = deployedRetellId ?? row.retell_agent_id;
    if (!activeRetellId) {
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

    return { ok: true, live: true };
  });
