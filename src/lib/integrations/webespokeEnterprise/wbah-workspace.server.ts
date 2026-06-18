/**
 * Webuyanyhouse Workspace — campaign server functions.
 *
 * These are the only WeeBespoke API calls that still exist as separate
 * server functions. All other data (leads, CRM contacts) is synced into
 * the WEBEE database via wbah.functions.ts and served by standard WEBEE
 * page server functions.
 *
 * Campaigns from WeeBespoke cannot be stored in the WEBEE campaigns table
 * (different schema), so they are fetched live and displayed as an extra
 * tab in the existing Campaigns page — only for webuyanyhouse workspace users.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as api from "./client.server";

// ── Internal: require webuyanyhouse membership + get API token callbacks ───────

// Module-level cache: only proactively relogin once every 30 minutes
let _wbahReloginAt = 0;
const RELOGIN_TTL_MS = 30 * 60 * 1000;

async function requireWbahCbs(userId: string) {
  if (!userId) throw new Error("Unauthorized");

  const { data: memberships } = await (supabaseAdmin as any)
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .eq("user_id", userId);

  const wbahMembership = (memberships ?? []).find(
    (m: any) => m.workspaces?.slug === "webuyanyhouse",
  );

  if (!wbahMembership) {
    throw new Error("Access denied — not a member of the Webuyanyhouse workspace");
  }

  const { data: integration } = await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status, user_payload")
    .eq("integration_key", "webespoke_enterprise")
    .eq("client_name", "Webuyanyhouse")
    .maybeSingle();

  if (!integration?.access_token || integration.status !== "connected") {
    throw new Error("WeeBespoke API not connected — contact your administrator");
  }

  let currentAccessToken  = integration.access_token as string;
  let currentRefreshToken = (integration.refresh_token ?? "") as string;

  // Proactively relogin using stored credentials when cache has expired.
  // This prevents "token expired" errors without adding latency to every call.
  const password = process.env.WEBESPOKE_ADMIN_PASSWORD;
  const email    = (integration.user_payload as any)?.email
                ?? process.env.WEBESPOKE_ADMIN_EMAIL;

  if (password && email && Date.now() - _wbahReloginAt > RELOGIN_TTL_MS) {
    try {
      const loginRes = await api.loginWithPassword(email, password);
      if (loginRes.ok && loginRes.data) {
        const d = loginRes.data as any;
        const at = d.accessToken ?? d.token ?? d.data?.accessToken ?? d.data?.token;
        const rt = d.refreshToken ?? d.data?.refreshToken ?? currentRefreshToken;
        if (at) {
          await (supabaseAdmin as any)
            .from("enterprise_integrations")
            .update({ access_token: at, refresh_token: rt, status: "connected" })
            .eq("integration_key", "webespoke_enterprise")
            .eq("client_name", "Webuyanyhouse");
          currentAccessToken  = at;
          currentRefreshToken = rt;
          _wbahReloginAt = Date.now();
        }
      }
    } catch {
      // Ignore relogin errors — use existing token, will fall through to refresh on 401
    }
  }

  const getTokens = async () => ({
    accessToken:  currentAccessToken,
    refreshToken: currentRefreshToken,
  });

  const saveNewAccessToken = async (token: string) => {
    await (supabaseAdmin as any)
      .from("enterprise_integrations")
      .update({ access_token: token, status: "connected" })
      .eq("integration_key", "webespoke_enterprise")
      .eq("client_name", "Webuyanyhouse");
    currentAccessToken = token;
  };

  return { getTokens, saveNewAccessToken };
}

// ── Campaigns (live from WeeBespoke API — shown as a tab in /campaigns) ────────

export const getWbahCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetCampaigns(cbs.getTokens, cbs.saveNewAccessToken);
    return Array.isArray(res.data) ? res.data : [];
  });

export const createWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahCreateCampaign(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to create campaign");
    return res.data;
  });

export const pauseWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahPauseCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to pause campaign");
    return res.data;
  });

export const resumeWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahResumeCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to resume campaign");
    return res.data;
  });

export const deleteWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahDeleteCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete campaign");
    return res.data;
  });

// ── Leads (Positive/Neutral) — live from WeeBespoke API with pagination ───────

export const getWbahLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      page:   z.number().int().min(1).default(1),
      limit:  z.number().int().min(1).max(200).default(50),
      search: z.string().optional(),
      filter: z.enum(["all", "inbound", "outbound", "lead", "opportunity"]).optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);

    // Fetch data — count comes from within the response or falls back to records.length
    const res = await api.wbahGetUserCallLeadPaged(data.page, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to fetch leads");

    const raw = res.data as any;
    const records = extractRecords(raw);
    const realTotal = extractCountFromResponse(raw, records.length);
    const pageSize  = records.length || data.limit;

    const normalised = records.map((r: any, idx: number) => ({
      id:             String(r._id ?? r.id ?? idx),
      srNo:           r.srNo ?? r.sr_no ?? null,
      name:           r.name ?? r.fullName ?? r.full_name ?? r.contactName ?? null,
      contact:        r.toNumber ?? r.mobile_number ?? r.phone ?? r.contact ?? null,
      type:           r.type ?? r.leadType ?? "Lead",
      lastCalledAt:   r.lastCalledAt ?? r.last_called_at ?? r.calledAt ?? r.created_at ?? null,
      callStatus:     r.callStatus ?? r.call_status ?? r.status ?? null,
      callDuration:   r.callDuration ?? r.call_duration ?? r.duration ?? null,
      recordingUrl:   r.recordingUrl ?? r.recording_url ?? r.recordingLink ?? null,
      transcript:     r.transcript ?? r.callTranscript ?? null,
      sentiment:      r.sentimentAnalysis ?? r.sentiment ?? null,
      direction:      r.direction ?? r.callDirection ?? null,
      appointmentDate: r.appointmentDate ?? r.appointment_date ?? null,
    }));

    return {
      records: normalised,
      total:   realTotal,
      page:    data.page,
      limit:   pageSize,
      pages:   Math.max(1, Math.ceil(realTotal / pageSize)),
    };
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractRecords(raw: any): any[] {
  if (Array.isArray(raw))        return raw;
  if (Array.isArray(raw?.data))  return raw.data;
  if (Array.isArray(raw?.calls)) return raw.calls;
  if (Array.isArray(raw?.records)) return raw.records;
  if (Array.isArray(raw?.leads)) return raw.leads;
  return [];
}

function extractCountFromResponse(raw: any, fallback: number): number {
  return raw?.total ?? raw?.totalCount ?? raw?.count ?? raw?.pagination?.total ?? fallback;
}

function formatDurationMs(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m === 0) return `${sec}s`;
  return `${m}m ${sec}s`;
}

// ── Retell helper — get WBAH workspace's Retell API key ───────────────────────

const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

async function requireWbahRetellKey(userId: string): Promise<string> {
  if (!userId) throw new Error("Unauthorized");

  const { data: memberships } = await (supabaseAdmin as any)
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .eq("user_id", userId);

  const wbahMembership = (memberships ?? []).find(
    (m: any) => m.workspaces?.slug === "webuyanyhouse",
  );
  if (!wbahMembership) {
    throw new Error("Access denied — not a member of the Webuyanyhouse workspace");
  }

  const { data: ws } = await (supabaseAdmin as any)
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", WBAH_WORKSPACE_ID)
    .maybeSingle();

  const apiKey = (ws?.retell_workspace_id as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error("Retell not connected for WeeBespoke workspace — add API key in Settings → Providers");
  }
  return apiKey;
}

// ── Call Logs — live from Retell API with cursor pagination ──────────────────

export const getWbahRetellCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      paginationKey: z.string().nullable().default(null),
    }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { retellFetch } = await import("@/lib/providers/retell/client.server");
    const apiKey = await requireWbahRetellKey(context.userId);

    // Fetch agents + calls in parallel
    const [agentList, callRes] = await Promise.all([
      retellFetch<any[]>("/list-agents", null, "GET", apiKey).catch(() => []),
      retellFetch<any>(
        "/v2/list-calls",
        {
          limit: 50,
          sort_order: "descending",
          ...(data.paginationKey ? { pagination_key: data.paginationKey } : {}),
        },
        "POST",
        apiKey,
      ),
    ]);

    const agentNames: Record<string, string> = {};
    for (const a of agentList ?? []) {
      if (a.agent_id) agentNames[a.agent_id] = a.agent_name ?? a.agent_id;
    }

    const calls: any[] = Array.isArray(callRes) ? callRes : (callRes?.calls ?? []);
    const nextPaginationKey: string | null = callRes?.pagination_key ?? null;

    const records = calls.map((c: any) => ({
      id:           String(c.call_id ?? Math.random()),
      agentName:    agentNames[c.agent_id] ?? c.agent_id ?? null,
      from:         c.from_number ?? null,
      to:           c.to_number ?? null,
      type:         c.call_type ?? "phone_call",
      direction:    c.direction ?? (c.call_type === "phone_call" ? "outbound" : "web"),
      lastCalledAt: c.start_timestamp ? new Date(c.start_timestamp).toISOString() : null,
      status:       c.call_status ?? null,
      duration:     formatDurationMs(c.duration_ms),
      recordingUrl: c.recording_url ?? null,
      transcript:   typeof c.transcript === "string" ? c.transcript
                  : Array.isArray(c.transcript)
                    ? c.transcript.map((t: any) => `${t.role}: ${t.content}`).join("\n")
                    : null,
      sentiment:    c.call_analysis?.user_sentiment ?? null,
      callSummary:  c.call_analysis?.call_summary ?? null,
    }));

    return {
      records,
      hasMore:          !!nextPaginationKey,
      nextPaginationKey,
    };
  });

// ── Agents — list Retell agents for WBAH workspace with live status ───────────

export const getWbahRetellAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { retellFetch } = await import("@/lib/providers/retell/client.server");
    const apiKey = await requireWbahRetellKey(context.userId);

    const [agentList, liveRes] = await Promise.all([
      retellFetch<any[]>("/list-agents", null, "GET", apiKey).catch(() => []),
      retellFetch<any>(
        "/v2/list-calls",
        { filter_criteria: { call_status: ["ongoing"] }, limit: 20 },
        "POST",
        apiKey,
      ).catch(() => null),
    ]);

    const liveCallAgentIds = new Set<string>(
      (Array.isArray(liveRes) ? liveRes : (liveRes?.calls ?? []))
        .map((c: any) => c.agent_id)
        .filter(Boolean),
    );

    return (agentList ?? []).map((a: any) => ({
      id:        a.agent_id,
      name:      a.agent_name ?? a.agent_id,
      voiceId:   a.voice_id ?? null,
      isLive:    liveCallAgentIds.has(a.agent_id),
    }));
  });
