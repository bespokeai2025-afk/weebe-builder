import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { retellFetch } from "@/lib/providers/retell/client.server";
import { cacheWrap } from "@/lib/cache/redis.server";

const RETELL_ANALYTICS_TTL = 15 * 60; // 15 minutes
const RETELL_AGENTS_TTL = 5 * 60; // 5 minutes

function retellAnalyticsKey(workspaceId: string, days: number) {
  // v2: WBAH no longer merges the Retell API page (dedup + agent attribution fix).
  // v3: standard (platform-key) workspaces now fail closed to deployed agents
  // only. Bump so any previously-cached cross-workspace entries are not served
  // after deploy.
  // v4: the date window now floors to whole UTC days (00:00 UTC boundaries) —
  // different call sets than the old rolling `now - Nd` window, so v3 entries
  // must not be served.
  // v5: WBAH now reads from the Retell API on the analytics page (was wbah_calls
  // only) — different totals + real per-agent attribution, so v4 must not serve.
  return `webee:analytics:${workspaceId}:retell:v5:${days}d`;
}

function retellAgentsKey(workspaceId: string) {
  return `webee:analytics:${workspaceId}:retell-agents:v2`;
}

// Start of the given instant's UTC calendar day (00:00:00.000 UTC).
function startOfUtcDayMs(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Voicemail heuristic (server-side mirror of the client) ────────────────────
// MUST stay in sync with analytics.tsx (VOICEMAIL_KW / isCallVoicemail). We
// compute the voicemail flag HERE, on the RAW Retell call (which still carries
// the transcript + summary + outcome), so those heavy text fields can be dropped
// from the payload without changing any voicemail classification downstream.
const VOICEMAIL_KW = [
  "voicemail",
  "answering machine",
  "leave a message",
  "mailbox",
  "beep",
  "not available",
  "automated message",
];
function hasVoicemailKeyword(text?: string | null): boolean {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return VOICEMAIL_KW.some((kw) => lower.includes(kw));
}
function computeIsVoicemail(c: any): boolean {
  return (
    c?.call_analysis?.in_voicemail === true ||
    c?.call_status === "voicemail" ||
    hasVoicemailKeyword(c?.disconnection_reason) ||
    hasVoicemailKeyword(c?.call_analysis?.call_summary) ||
    hasVoicemailKeyword(c?.call_analysis?.call_outcome) ||
    hasVoicemailKeyword(c?.transcript)
  );
}

// Reduce a raw Retell call to only the fields computeAnalytics / isCallVoicemail
// actually read, with the voicemail flag pre-computed as `_isVoicemail`. Dropping
// the transcript and the long summary/outcome strings keeps the 60/90-day
// payloads small enough to serialize + transfer without changing any aggregate.
function trimRetellCall(c: any): any {
  return {
    call_id: c.call_id,
    agent_id: c.agent_id,
    call_status: c.call_status,
    call_type: c.call_type,
    direction: c.direction,
    call_direction: c.call_direction,
    disconnection_reason: c.disconnection_reason ?? null,
    disconnect_reason: c.disconnect_reason ?? null,
    transfer_destination: c.transfer_destination ?? null,
    start_timestamp: c.start_timestamp ?? null,
    end_timestamp: c.end_timestamp ?? null,
    duration_ms: c.duration_ms ?? null,
    call_cost:
      c.call_cost?.total_duration_seconds != null
        ? { total_duration_seconds: c.call_cost.total_duration_seconds }
        : undefined,
    call_analysis: {
      user_sentiment: c.call_analysis?.user_sentiment ?? null,
      call_successful: c.call_analysis?.call_successful ?? null,
      in_voicemail: c.call_analysis?.in_voicemail ?? false,
    },
    latency: c.latency
      ? {
          llm: c.latency.llm?.p50 != null ? { p50: c.latency.llm.p50 } : undefined,
          e2e: c.latency.e2e?.p50 != null ? { p50: c.latency.e2e.p50 } : undefined,
          tts: c.latency.tts?.p50 != null ? { p50: c.latency.tts.p50 } : undefined,
        }
      : undefined,
    _isVoicemail: computeIsVoicemail(c),
  };
}

// Paginate Retell /v2/list-calls for a single [lowerMs, upperMs] window,
// descending by start_timestamp, cursoring on the last returned call_id (Retell
// returns a plain array with no pagination_key field). Returns the raw calls
// plus page count and whether the window hit its page cap.
async function fetchCallsWindow(
  apiKey: string,
  agentIds: string[],
  lowerMs: number,
  upperMs: number | undefined,
  pageSize: number,
  maxPages: number,
): Promise<{ calls: any[]; pages: number; truncated: boolean }> {
  const out: any[] = [];
  let paginationKey: string | undefined;
  let page = 0;
  do {
    const startFilter: Record<string, number> = { lower_threshold: lowerMs };
    if (upperMs != null) startFilter.upper_threshold = upperMs;
    const body: Record<string, any> = {
      filter_criteria: { agent_id: agentIds, start_timestamp: startFilter },
      limit: pageSize,
      sort_order: "descending",
    };
    if (paginationKey) body.pagination_key = paginationKey;

    const res = await retellFetch<any>("/v2/list-calls", body, "POST", apiKey);
    const page_calls: any[] = Array.isArray(res) ? res : (res?.calls ?? []);
    out.push(...page_calls);
    paginationKey =
      res?.pagination_key ??
      (page_calls.length === pageSize ? page_calls[page_calls.length - 1]?.call_id : undefined);
    page++;
  } while (paginationKey && page < maxPages);

  return { calls: out, pages: page, truncated: !!paginationKey && page >= maxPages };
}

type RetellContext = {
  workspaceSlug: string | null;
  isWbah: boolean;
  workspaceKey: string | undefined;
  apiKey: string | undefined;
  keySource: "workspace" | "platform" | "none";
  /**
   * Allow-list of Retell agent_ids this workspace may see, or `null` when the
   * workspace uses its OWN Retell key (every agent on that key belongs to it).
   * When using the shared PLATFORM key this is a Set built from the deployments
   * table and MUST fail closed: an empty set ⇒ zero visible agents/calls rather
   * than leaking every other workspace's data.
   */
  deployedAgentIds: Set<string> | null;
};

// Resolve which Retell key + agent allow-list applies to a workspace. Shared by
// getRetellAnalytics and listVoiceAgents so the isolation rules stay identical.
// NEVER logs or returns the raw key value.
async function resolveRetellContext(sb: any, workspaceId: string): Promise<RetellContext> {
  const { data: wsSlugRow } = await sb
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();
  const workspaceSlug = (wsSlugRow?.slug as string | undefined) ?? null;
  const isWbah = workspaceSlug === "webuyanyhouse";

  const { data: wsSettings } = await sb
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const workspaceKey = (wsSettings?.retell_workspace_id as string | undefined)?.trim() || undefined;
  const apiKey = workspaceKey || process.env.RETELL_API_KEY || undefined;
  const keySource: RetellContext["keySource"] = workspaceKey ? "workspace" : apiKey ? "platform" : "none";

  let deployedAgentIds: Set<string> | null = null;
  if (!workspaceKey && apiKey) {
    deployedAgentIds = new Set<string>();
    try {
      const { data: deps } = await sb
        .from("deployments")
        .select("provider_agent_id")
        .eq("workspace_id", workspaceId)
        .eq("provider", "retell")
        .not("provider_agent_id", "is", null);
      for (const d of (deps as any[]) ?? []) {
        if (d.provider_agent_id) deployedAgentIds.add(d.provider_agent_id as string);
      }
    } catch (e) {
      console.warn("[analytics] Could not fetch workspace deployments:", e);
    }
  }

  return { workspaceSlug, isWbah, workspaceKey, apiKey, keySource, deployedAgentIds };
}

export interface VoiceAgentOption {
  agent_id: string;
  agent_name: string;
  raw_agent_name: string | null;
  last_modification_timestamp: number | null;
  is_active: boolean;
}

/**
 * List the voice agents visible to the current workspace, for the analytics
 * agent-filter dropdown. Uses the workspace's OWN Retell key when present (all
 * agents belong to it) and falls back to the platform key restricted to agents
 * deployed in this workspace (fail closed). WBAH uses its own Retell key, so its
 * five agents are returned here for the analytics-page filter.
 */
export const listVoiceAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const url = (context as any).request?.url ?? "";
    const fresh =
      process.env.NODE_ENV !== "production" &&
      (new URL(url, "http://x").searchParams.has("fresh") ||
        new URL(url, "http://x").searchParams.has("bust"));

    return cacheWrap(
      retellAgentsKey(workspaceId),
      RETELL_AGENTS_TTL,
      async () => {
        const ctx = await resolveRetellContext(sb, workspaceId);

        // No Retell key → no agent filter.
        if (!ctx.apiKey) {
          console.log(
            `[analytics] listVoiceAgents workspace=${workspaceId} slug=${ctx.workspaceSlug ?? "?"} keySource=${ctx.keySource} hasKey=${!!ctx.apiKey} agents=0 (skipped)`,
          );
          return {
            agents: [] as VoiceAgentOption[],
            workspaceSlug: ctx.workspaceSlug,
            keySource: ctx.keySource,
            error: ctx.apiKey ? null : "No Retell API key configured",
          };
        }

        let raw: any[] = [];
        let error: string | null = null;
        try {
          raw = await retellFetch<any[]>("/list-agents", null, "GET", ctx.apiKey);
        } catch (e: any) {
          error = e?.message || "Failed to load Retell agents";
          console.error("[analytics] listVoiceAgents /list-agents failed:", e?.message);
        }

        // Retell /list-agents returns one row per agent VERSION, so a workspace
        // with 5 agents can come back as dozens of rows. Sort newest-first, then
        // keep a single (latest) entry per agent_id for the dropdown.
        const seenAgentIds = new Set<string>();
        const agents: VoiceAgentOption[] = (raw ?? [])
          .filter((a: any) => a.agent_id)
          // Platform key: only agents actually deployed in this workspace.
          .filter((a: any) => ctx.deployedAgentIds === null || ctx.deployedAgentIds.has(a.agent_id))
          .map((a: any) => ({
            agent_id: a.agent_id as string,
            agent_name: (a.agent_name as string | undefined) ?? (a.agent_id as string),
            raw_agent_name: (a.agent_name as string | undefined) ?? null,
            last_modification_timestamp: (a.last_modification_timestamp as number | undefined) ?? null,
            is_active: a.is_published !== false,
          }))
          .sort(
            (x, y) => (y.last_modification_timestamp ?? 0) - (x.last_modification_timestamp ?? 0),
          )
          .filter((a) => {
            if (seenAgentIds.has(a.agent_id)) return false;
            seenAgentIds.add(a.agent_id);
            return true;
          });

        console.log(
          `[analytics] listVoiceAgents workspace=${workspaceId} slug=${ctx.workspaceSlug ?? "?"} keySource=${ctx.keySource} hasKey=${!!ctx.apiKey} agents=${agents.length}`,
        );
        return { agents, workspaceSlug: ctx.workspaceSlug, keySource: ctx.keySource, error };
      },
      fresh,
    );
  });

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
        // Debug-only cache bypass (?fresh=true). Honoured in non-prod only.
        fresh: z.boolean().default(false),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }: any) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const url = (context as any).request?.url ?? "";
    const bust =
      (process.env.NODE_ENV !== "production" && data.fresh) ||
      (process.env.NODE_ENV !== "production" &&
        (new URL(url, "http://x").searchParams.has("bust") ||
          new URL(url, "http://x").searchParams.has("fresh")));

    return cacheWrap(
      retellAnalyticsKey(workspaceId, data.days),
      RETELL_ANALYTICS_TTL,
      async () => {
    const startedAtMs = Date.now();
    // Whole-day window in UTC: 00:00:00 UTC of the day (days-1) days ago → now.
    // Charts, the byDay buckets and the client-side "Today" narrowing are all
    // UTC-based, so the window boundary must be UTC too — otherwise "Today" and
    // the trend buckets disagree. days=1 therefore means "since 00:00 UTC today".
    const sinceMs = startOfUtcDayMs(Date.now()) - (data.days - 1) * 24 * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    // Resolve the workspace's Retell key + agent allow-list. Prefers the
    // workspace's OWN key (all agents belong to it); falls back to the shared
    // platform key restricted to agents deployed in this workspace (fail closed,
    // so one workspace can never see another's calls).
    const { workspaceSlug, apiKey, keySource, deployedAgentIds } =
      await resolveRetellContext(sb, workspaceId);

    let calls: any[] = [];
    let error: string | null = null;
    let agentNames: Record<string, string> = {};
    let agentIds: string[] = [];
    let retellPages = 0;
    let retellTruncated = false;

    // WBAH note: this workspace's calls are ALSO synced into wbah_calls, but the
    // sync drops the agent name (agent_name is always null), so that feed can't
    // power a per-agent view.  The SAME calls live in WBAH's own Retell account
    // WITH agent attribution, and the volumes match closely (~7.4k vs ~7.2k in
    // 30d).  So on the analytics page ONLY, WBAH is treated like any other
    // Retell workspace: we read from the Retell API here (giving real per-agent
    // data) and DO NOT also read wbah_calls below (which would double-count).
    // Every other page still uses wbah_calls unchanged.
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
        // Fetch Retell calls in parallel 30-day chunks. For days ≤ 30 this is a
        // SINGLE window covering [sinceMs, now], which returns exactly the same
        // call set as the previous single-pass fetch (no call starts in the
        // future, so the upper bound excludes nothing) — the working 30d numbers
        // are unchanged.  Wider windows (60/90d) are split so they complete well
        // within the request budget instead of timing out, and each chunk gets
        // its own generous page cap so the full window is never truncated.
        const PAGE_SIZE = 1000;
        const CHUNK_MS = 30 * 24 * 60 * 60 * 1000;
        const MAX_PAGES_PER_CHUNK = 15; // 15k calls/chunk — far above real volumes
        const nowMs = Date.now();
        const windows: Array<[number, number]> = [];
        for (let lo = sinceMs; lo < nowMs; lo += CHUNK_MS) {
          windows.push([lo, Math.min(lo + CHUNK_MS, nowMs)]);
        }
        try {
          const results = await Promise.all(
            windows.map(([lo, hi]) =>
              fetchCallsWindow(apiKey, agentIds, lo, hi, PAGE_SIZE, MAX_PAGES_PER_CHUNK),
            ),
          );
          // Merge, dedupe by call_id (adjacent windows can share a boundary
          // call), and trim each record to the slim analytics shape.
          const seen = new Set<string>();
          for (const r of results) {
            retellPages += r.pages;
            if (r.truncated) retellTruncated = true;
            for (const c of r.calls) {
              const id = c?.call_id;
              if (id != null) {
                if (seen.has(id)) continue;
                seen.add(id);
              }
              calls.push(trimRetellCall(c));
            }
          }
          if (retellTruncated) {
            console.warn(
              `[analytics] Retell list-calls hit per-chunk page cap (${MAX_PAGES_PER_CHUNK} × ${PAGE_SIZE}) for workspace ${workspaceId}; results truncated`,
            );
          }
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
      // Exclude voicemails from ElevenLabs DB calls — same rule as dashboard
      const { data: elRows } = await sb
        .from("calls")
        .select(
          "retell_call_id, agent_id, agent_name, call_type, call_status, from_number, to_number, started_at, ended_at, duration_seconds, sentiment, call_summary, call_successful, in_voicemail",
        )
        .eq("workspace_id", workspaceId)
        .eq("provider" as never, "ELEVENLABS" as never)
        .eq("is_voicemail" as never, false as never)
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

    // WBAH no longer reads wbah_calls on the analytics page — it is served from
    // the Retell API above (real per-agent data) like any other Retell
    // workspace.  Every OTHER WBAH page still uses wbah_calls unchanged.  Kept
    // as an empty array so the merge / meta below stay untouched.
    const wbahCalls: any[] = [];

    const allCalls = [...calls, ...elCalls, ...wbahCalls];
    // configured = true when Retell agents, VoxStream calls, or WBAH calls exist
    const configured = agentIds.length > 0 || elCalls.length > 0 || wbahCalls.length > 0;

    // Debug log: voicemail calls that will be screened out by default in
    // computeAnalytics. `_isVoicemail` is pre-computed on the raw record (full
    // heuristic incl. transcript) before trimming, so this is the exact count.
    const vmFromApi = calls.filter((c: any) => c._isVoicemail === true).length;
    if (vmFromApi > 0) {
      console.debug(`[voicemail] getRetellAnalytics: ${vmFromApi} voicemail calls from Retell API will be excluded in computeAnalytics (${data.days}d window, workspace ${workspaceId})`);
    }

    // Reconciliation meta — counts per source so a mismatch between "All agents"
    // and the sum of per-agent totals can be diagnosed. Never includes the key.
    const meta = {
      keySource,
      hasKey: !!apiKey,
      pagesFetched: retellPages,
      truncated: retellTruncated,
      retellCount: calls.length,
      elCount: elCalls.length,
      wbahCount: wbahCalls.length,
      totalCount: allCalls.length,
      elapsedMs: Date.now() - startedAtMs,
    };
    console.log(
      `[analytics] getRetellAnalytics workspace=${workspaceId} slug=${workspaceSlug ?? "?"} keySource=${keySource} hasKey=${!!apiKey} days=${data.days} pages=${retellPages}${retellTruncated ? "(truncated)" : ""} retell=${calls.length} el=${elCalls.length} wbah=${wbahCalls.length} total=${allCalls.length} ${meta.elapsedMs}ms`,
    );

    if (!configured) {
      return {
        configured: false,
        agentIds,
        calls: allCalls,
        agentNames,
        workspaceSlug,
        meta,
        error: error ?? (!apiKey ? "No Retell API key configured" : "No deployed agents found in this workspace"),
      };
    }

    return { configured: true, agentIds, calls: allCalls, agentNames, error, workspaceSlug, meta };
      },
      bust,
      // Never cache a result produced by an upstream failure (error set) or one
      // with no agents/key (configured=false) — otherwise a transient Retell
      // outage would pin an all-zero window for the full 15-minute TTL. A valid
      // empty window (configured=true, error=null, calls=[]) IS cached.
      (r: any) => !r?.error && r?.configured !== false,
    );
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
  /** Best-effort caller/lead name resolved from the workspace's leads table. */
  lead_name?: string | null;
  /** Fine-grained call state used for the status badge. */
  call_status?: "ringing" | "in_progress" | "ended" | "failed";
  /**
   * True when this card is backed by a live_call_sessions row — i.e. the
   * transcript is streaming in real time via the `transcript_updated` webhook.
   * False = REST/DB-only (no live stream yet); drives the honest empty-state.
   */
  live_transcript?: boolean;
  /** Conversation flow position, when Retell exposes it (usually null mid-call). */
  current_node_id?: string | null;
  current_node_label?: string | null;
}
