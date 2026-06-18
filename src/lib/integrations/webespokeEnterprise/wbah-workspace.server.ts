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

async function fetchWbahCount(
  countFn: () => Promise<any>,
  fallback: number,
): Promise<number> {
  try {
    const res = await countFn();
    if (!res.ok) return fallback;
    const d = res.data as any;

    // Handle plain number response
    if (typeof d === "number") return d > 0 ? d : fallback;

    // WeeBespoke get-call-count shape:
    // { data: { totalCall: { lead: N, opportunity: N }, ... } }
    const tc = d?.data?.totalCall;
    if (tc && typeof tc === "object") {
      const n = (tc.lead ?? 0) + (tc.opportunity ?? 0);
      if (n > 0) return n;
    }

    // Handle array response: [{ count: N }] or [N]
    if (Array.isArray(d)) {
      if (d.length > 0) {
        const first = d[0];
        if (typeof first === "number") return first > 0 ? first : fallback;
        const n = first?.count ?? first?.total ?? first?.totalCount ?? first?.callCount;
        if (typeof n === "number" && n > 0) return n;
      }
      return d.length > 0 ? d.length : fallback;
    }

    // Generic field name scan
    const candidates = [
      d?.count, d?.total, d?.totalCount, d?.totalCalls, d?.callCount,
      d?.callsCount, d?.total_count, d?.total_calls,
      d?.data?.count, d?.data?.total, d?.data?.totalCount,
      d?.data?.totalCalls, d?.data?.callCount,
      d?.result?.count, d?.result?.total,
      d?.metadata?.count, d?.metadata?.total,
      d?.pagination?.total, d?.pagination?.count,
      Array.isArray(d?.counts) ? d.counts[0]?.count : undefined,
    ];

    for (const n of candidates) {
      if (typeof n === "number" && n > 0) return n;
      if (typeof n === "string" && /^\d+$/.test(n)) {
        const parsed = parseInt(n, 10);
        if (parsed > 0) return parsed;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// ── Call Logs — live from WeeBespoke API with server-side pagination ──────────

export const getWbahCallLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      page:  z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(200).default(50),
    }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);

    const res = await api.wbahGetAllCallDataPaged(data.page, cbs.getTokens, cbs.saveNewAccessToken);

    if (!res.ok) throw new Error(res.error ?? "Failed to fetch call logs");

    const raw = res.data as any;
    const records = extractRecords(raw);

    // Try to get a total from the response itself (totalCount, total, totalPages*batch, etc.)
    const inlineTotal = (() => {
      if (Array.isArray(raw)) return 0;
      const direct = raw?.total ?? raw?.totalCount ?? raw?.totalDocuments
                  ?? raw?.pagination?.total ?? raw?.meta?.total;
      if (typeof direct === "number" && direct > 0) return direct;
      // If API returns totalPages, back-calculate
      const tp = raw?.totalPages ?? raw?.pagination?.totalPages ?? raw?.meta?.totalPages;
      if (typeof tp === "number" && tp > 0 && records.length > 0) {
        return tp * records.length;
      }
      return 0;
    })();

    // hasMore: if a full batch came back there are likely more pages
    const hasMore  = records.length >= 50;
    const pageSize = records.length || data.limit;
    const realTotal = inlineTotal > 0 ? inlineTotal : (hasMore ? (data.page * pageSize) + 1 : data.page * pageSize);

    const normalised = records.map((r: any, idx: number) => ({
      id:            String(r._id ?? r.id ?? idx),
      srNo:          r.srNo ?? r.sr_no ?? null,
      name:          r.name ?? r.fullName ?? r.full_name ?? r.contactName ?? null,
      contact:       r.toNumber ?? r.mobile_number ?? r.phone ?? r.contact ?? null,
      type:          r.type ?? r.leadType ?? "Lead",
      lastCalledAt:  r.lastCalledAt ?? r.last_called_at ?? r.calledAt ?? r.created_at ?? null,
      status:        r.callStatus ?? r.call_status ?? r.status ?? null,
      duration:      r.callDuration ?? r.call_duration ?? r.duration ?? null,
      recordingUrl:  r.recordingUrl ?? r.recording_url ?? r.recordingLink ?? null,
      transcript:    r.transcript ?? r.callTranscript ?? null,
      sentiment:     r.sentimentAnalysis ?? r.sentiment ?? null,
      appointmentDate: r.appointmentDate ?? r.appointment_date ?? null,
    }));

    return {
      records:    normalised,
      total:      realTotal,
      totalKnown: inlineTotal > 0,
      hasMore:    hasMore,
      page:       data.page,
      limit:      pageSize,
      pages:      inlineTotal > 0
                    ? Math.max(1, Math.ceil(inlineTotal / pageSize))
                    : hasMore ? data.page + 1 : data.page,
    };
  });
