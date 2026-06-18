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
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }: any) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const sinceMs = Date.now() - data.days * 24 * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    let calls: any[] = [];
    let error: string | null = null;
    let agentNames: Record<string, string> = {};
    let agentIds: string[] = [];

    // ── Retell calls (from Retell API) ───────────────────────────────────────
    // Prefer the workspace's own Retell API key (Go Live agents live there).
    // Fall back to the platform key for builder/test agents.
    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const workspaceRetellKey = (wsSettings?.retell_workspace_id as string | undefined)?.trim() || undefined;
    const apiKey = workspaceRetellKey || process.env.RETELL_API_KEY;

    // When using the platform key (shared account), limit to only agents
    // that have been deployed in this workspace so we don't mix data across
    // all workspaces on the account.
    let deployedAgentIds: Set<string> | null = null;
    if (!workspaceRetellKey && apiKey) {
      try {
        const { data: deps } = await sb
          .from("deployments")
          .select("provider_agent_id")
          .eq("workspace_id", workspaceId)
          .eq("provider", "retell")
          .not("provider_agent_id", "is", null);
        if (deps && deps.length > 0) {
          deployedAgentIds = new Set((deps as any[]).map((d: any) => d.provider_agent_id as string));
        }
      } catch (e) {
        console.warn("[analytics] Could not fetch workspace deployments:", e);
      }
    }

    if (apiKey) {
      // Fetch agent list — when using a workspace-specific key every agent
      // belongs to that workspace; when using the platform key restrict to
      // agents that are actually deployed in this workspace.
      try {
        const agentList = await retellFetch<any[]>("/list-agents", null, "GET", apiKey);
        for (const a of agentList ?? []) {
          if (!a.agent_id) continue;
          // Platform key: skip agents not deployed in this workspace
          if (deployedAgentIds !== null && !deployedAgentIds.has(a.agent_id)) continue;
          agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
          agentIds.push(a.agent_id);
        }
        // If deployedAgentIds has entries but none matched agent list (e.g.
        // agents deployed via a workspace key not the platform key), seed
        // agentIds directly from the DB deployments so calls can still be
        // fetched by agent_id filter even without a name match.
        if (deployedAgentIds !== null && agentIds.length === 0 && deployedAgentIds.size > 0) {
          for (const id of deployedAgentIds) {
            agentIds.push(id);
            agentNames[id] = id;
          }
        }
      } catch (e: any) {
        console.error("Retell list-agents failed:", e);
      }

      if (agentIds.length > 0) {
        // Paginate through Retell /v2/list-calls using pagination_key.
        // Each page returns up to 1000 records. Cap at 20 pages (20 000
        // calls) so a single request can never run indefinitely.
        const PAGE_SIZE = 1000;
        const MAX_PAGES = 20;
        let paginationKey: string | undefined;
        let page = 0;
        try {
          do {
            const body: Record<string, any> = {
              filter_criteria: {
                agent_id: agentIds,
                start_timestamp: { lower_threshold: sinceMs },
              },
              limit: PAGE_SIZE,
              sort_order: "descending",
            };
            if (paginationKey) body.pagination_key = paginationKey;

            const res = await retellFetch<any>("/v2/list-calls", body, "POST", apiKey);
            const page_calls: any[] = Array.isArray(res) ? res : (res?.calls ?? []);
            calls.push(...page_calls);
            paginationKey = res?.pagination_key ?? undefined;
            page++;
          } while (paginationKey && page < MAX_PAGES);
        } catch (e: any) {
          error = e?.message || "Failed to load Retell analytics";
          console.error("Retell list-calls failed:", e);
        }
      }
    }

    // ── VoxStream / ElevenLabs calls (from local DB) ─────────────────────────
    // ElevenLabs post-call webhooks store rows with provider = "ELEVENLABS".
    // Normalize them to match the Retell call shape so computeAnalytics can
    // process both sources identically.
    let elCalls: any[] = [];
    try {
      const { data: elRows } = await sb
        .from("calls")
        .select(
          "retell_call_id, agent_id, agent_name, call_type, call_status, from_number, to_number, started_at, ended_at, duration_seconds, sentiment, call_summary, call_successful, in_voicemail",
        )
        .eq("workspace_id", workspaceId)
        .eq("provider" as never, "ELEVENLABS" as never)
        .gte("started_at", sinceIso)
        .order("started_at", { ascending: false })
        .limit(10000);

      elCalls = (elRows ?? []).map((c: any) => {
        // Populate agentNames / agentIds from DB rows so the per-agent
        // breakdown on the analytics page resolves names correctly.
        if (c.agent_id && !agentNames[c.agent_id]) {
          agentNames[c.agent_id] = c.agent_name ?? c.agent_id;
        }
        if (c.agent_id && !agentIds.includes(c.agent_id)) {
          agentIds.push(c.agent_id);
        }

        // Normalize to the Retell call shape used by computeAnalytics
        return {
          call_id: c.retell_call_id,
          agent_id: c.agent_id,
          call_status: c.call_status,
          // Web/browser sessions are stored with a "web:" prefix sentinel
          call_type: (c.to_number as string | null)?.startsWith("web:") ? "web_call" : "phone_call",
          direction: c.call_type === "inbound" ? "inbound" : "outbound",
          from_number: c.from_number,
          to_number: c.to_number,
          start_timestamp: c.started_at ? new Date(c.started_at).getTime() : null,
          end_timestamp: c.ended_at ? new Date(c.ended_at).getTime() : null,
          duration_ms: c.duration_seconds != null ? (c.duration_seconds as number) * 1000 : null,
          call_analysis: {
            // Retell uses Title Case sentiments; normalise from lowercase DB values
            user_sentiment: c.sentiment
              ? (c.sentiment as string).charAt(0).toUpperCase() + (c.sentiment as string).slice(1)
              : null,
            call_successful: c.call_successful ?? null,
            in_voicemail: c.in_voicemail ?? false,
            call_summary: c.call_summary ?? null,
          },
          _provider: "ELEVENLABS",
        };
      });
    } catch (e: any) {
      console.warn("[analytics] ElevenLabs DB call fetch failed:", e?.message);
    }

    const allCalls = [...calls, ...elCalls];
    // configured = true when either Retell agents exist OR VoxStream calls exist
    const configured = agentIds.length > 0 || elCalls.length > 0;

    if (!configured) {
      return {
        configured: false,
        agentIds,
        calls: allCalls,
        agentNames,
        error: error ?? (!apiKey ? "No Retell API key configured" : "No deployed agents found in this workspace"),
      };
    }

    return { configured: true, agentIds, calls: allCalls, agentNames, error };
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
        status: "live" as const,
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
  /** "live" = still ringing/in-progress on Retell; "completed" = ended, transcript from DB */
  status: "live" | "completed";
}
