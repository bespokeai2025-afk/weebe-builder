import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { retellFetch } from "@/lib/providers/retell/client.server";

export const syncRetellReceptionist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: deps, error: depErr } = await sb
      .from("deployments")
      .select("provider_agent_id, deployed_at, agent_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "retell")
      .order("deployed_at", { ascending: false });
    if (depErr) throw new Error(depErr.message);

    const localAgentIds = new Set(
      (deps ?? []).map((d: any) => d.provider_agent_id).filter(Boolean),
    );

    let retellAgents: any[] = [];
    let phoneNumbers: any[] = [];
    try {
      retellAgents = await retellFetch<any[]>("/list-agents", null, "GET");
    } catch (e) {
      console.error("Retell list-agents failed:", e);
    }
    try {
      phoneNumbers = await retellFetch<any[]>("/list-phone-numbers", null, "GET");
    } catch (e) {
      console.error("Retell list-phone-numbers failed:", e);
    }

    const ours = (phoneNumbers ?? []).map((p: any) => ({
      phone_number: p.phone_number ?? p.phone_number_pretty ?? null,
      nickname: p.nickname ?? null,
      inbound_agent_id: p.inbound_agent_id ?? null,
      outbound_agent_id: p.outbound_agent_id ?? null,
      is_ours: localAgentIds.has(p.inbound_agent_id) || localAgentIds.has(p.outbound_agent_id),
    }));

    const liveAgents = (retellAgents ?? []).map((a: any) => ({
      agent_id: a.agent_id,
      agent_name: a.agent_name ?? null,
      is_ours: localAgentIds.has(a.agent_id),
      last_modification_timestamp: a.last_modification_timestamp ?? null,
    }));

    return {
      deployedCount: localAgentIds.size,
      agents: liveAgents.filter((a) => a.is_ours),
      phoneNumbers: ours.filter((p) => p.is_ours),
      allPhoneNumbersCount: ours.length,
    };
  });

export const getRetellAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: any) =>
    z
      .object({
        days: z.number().int().min(1).max(90).default(30),
        limit: z.number().int().min(1).max(1000).default(1000),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }: any) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    // Prefer the workspace's own Retell API key (Go Live agents live there).
    // Fall back to the platform key for builder/test agents.
    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const workspaceRetellKey = (wsSettings?.retell_workspace_id as string | undefined)?.trim() || undefined;

    const apiKey = workspaceRetellKey || process.env.RETELL_API_KEY;
    if (!apiKey) {
      return {
        configured: false,
        agentIds: [] as string[],
        calls: [] as any[],
        agentNames: {} as Record<string, string>,
        error: "No Retell API key configured",
      };
    }

    const sinceMs = Date.now() - data.days * 24 * 60 * 60 * 1000;
    let calls: any[] = [];
    let error: string | null = null;
    let agentNames: Record<string, string> = {};
    let agentIds: string[] = [];

    // Fetch agent list using the workspace key so we get all their agents
    try {
      const agentList = await retellFetch<any[]>("/list-agents", null, "GET", apiKey);
      for (const a of agentList ?? []) {
        if (a.agent_id) {
          agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
          agentIds.push(a.agent_id);
        }
      }
    } catch (e: any) {
      console.error("Retell list-agents failed:", e);
    }

    if (agentIds.length === 0) {
      return {
        configured: false,
        agentIds,
        calls,
        agentNames,
        error: error ?? "No deployed agents found in this workspace",
      };
    }

    // Fetch calls for all workspace agents
    try {
      const res = await retellFetch<any>(
        "/v2/list-calls",
        {
          filter_criteria: {
            agent_id: agentIds,
            start_timestamp: { lower_threshold: sinceMs },
          },
          limit: data.limit,
          sort_order: "descending",
        },
        "POST",
        apiKey,
      );
      calls = Array.isArray(res) ? res : (res?.calls ?? []);
    } catch (e: any) {
      error = e?.message || "Failed to load Retell analytics";
      console.error("Retell list-calls failed:", e);
    }

    return { configured: true, agentIds, calls, agentNames, error };
  });

/**
 * Parse Retell's plain-text transcript string into role/content pairs.
 * Format: "Agent: hello\nUser: hi there\nAgent: ...\n"
 */
function parseTranscriptString(text: string): { role: "agent" | "user"; content: string }[] {
  if (!text.trim()) return [];
  return text
    .split("\n")
    .map((line) => {
      const agentMatch = line.match(/^Agent:\s*(.*)/);
      if (agentMatch) return { role: "agent" as const, content: agentMatch[1].trim() };
      const userMatch = line.match(/^User:\s*(.*)/);
      if (userMatch) return { role: "user" as const, content: userMatch[1].trim() };
      return null;
    })
    .filter((x): x is { role: "agent" | "user"; content: string } => x !== null && x.content.length > 0);
}

/**
 * Fetch all currently-ongoing calls across the workspace's deployed agents.
 * Polls Retell /v2/list-calls filtered to call_status=ongoing.
 * Returns lightweight call objects with live transcript lines.
 */
export const getLiveCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { calls: [] as LiveCall[] };

    const sb = supabase as any;
    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const apiKey =
      (wsSettings?.retell_workspace_id as string | undefined)?.trim() ||
      process.env.RETELL_API_KEY;
    if (!apiKey) return { calls: [] as LiveCall[] };

    // Resolve agent names
    const agentNames: Record<string, string> = {};
    try {
      const agentList = await retellFetch<any[]>("/list-agents", null, "GET", apiKey);
      for (const a of agentList ?? []) {
        if (a.agent_id) agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
      }
    } catch { /* ignore */ }

    // Step 1: list ongoing call IDs
    let stubs: any[] = [];
    try {
      const res = await retellFetch<any>(
        "/v2/list-calls",
        { filter_criteria: { call_status: ["ongoing"] }, limit: 20, sort_order: "descending" },
        "POST",
        apiKey,
      );
      stubs = Array.isArray(res) ? res : (res?.calls ?? []);
    } catch { /* ignore — returns empty */ }

    // Step 2: fetch full call detail for each (transcript only lives on get-call)
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
          return stub; // fall back to stub if individual fetch fails
        }
      }),
    );

    const calls: LiveCall[] = detailed.map((c: any) => {
      // Prefer structured transcript_object; fall back to parsing the text string
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

    return { calls };
  });

export interface LiveCall {
  call_id: string;
  agent_id: string;
  agent_name: string;
  direction: string;
  call_type: string;
  from_number: string | null;
  to_number: string | null;
  start_timestamp: number | null;
  transcript: { role: "agent" | "user"; content: string }[];
}
