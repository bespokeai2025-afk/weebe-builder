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
import { wbahCallsParamTest, wbahCallsPostPage, wbahLeadsParamTest } from "./client.server";

// ── Internal: require webuyanyhouse membership + get API token callbacks ───────

// Module-level cache: only proactively relogin once every 30 minutes
let _wbahReloginAt = 0;
const RELOGIN_TTL_MS = 30 * 60 * 1000;

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [profileRes, roleRes] = await Promise.all([
    (supabaseAdmin as any).from("profiles").select("user_type").eq("user_id", userId).maybeSingle(),
    (supabaseAdmin as any).from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);
  return profileRes.data?.user_type === "admin" || !!roleRes.data;
}

async function requireWbahCbs(userId: string) {
  if (!userId) throw new Error("Unauthorized");

  // Platform admins bypass workspace membership check
  const admin = await isPlatformAdmin(userId);
  if (!admin) {
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
        const at = d.accessToken ?? d.token ?? d.access_token ?? d.jwt ??
                   d.data?.accessToken ?? d.data?.token ?? d.data?.access_token ??
                   d.result?.accessToken ?? d.result?.token ??
                   d.auth?.accessToken ?? d.auth?.token ?? d.user?.token ?? null;
        const rt = d.refreshToken ?? d.refresh_token ?? d.data?.refreshToken ??
                   d.data?.refresh_token ?? d.result?.refreshToken ?? currentRefreshToken;
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

// ── Diagnostic probe — returns raw API count + page 1/2 responses ─────────────

export const wbahProbeApi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);

    // ── Round 1: baseline + CRM ────────────────────────────────────────────────
    const [
      countRes, callsP1Res, leadsP1Res, crmRes,
    ] = await Promise.all([
      api.wbahGetCallCount(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetAllCallDataPaged(1, cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetUserCallLeadPaged(1, cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetCrmData(cbs.getTokens, cbs.saveNewAccessToken),
    ]);

    // ── Round 2: page-param discovery — all variants for calls page 2 ─────────
    const PAGE_VARIANTS = [
      { param: "page",        value: 2 },
      { param: "currentPage", value: 2 },
      { param: "pageNumber",  value: 2 },
      { param: "pageNo",      value: 2 },
      { param: "p",           value: 2 },
      { param: "offset",      value: 50 },
      { param: "skip",        value: 50 },
    ];
    const [
      ...paramResults
    ] = await Promise.all([
      ...PAGE_VARIANTS.map(({ param, value }) =>
        wbahCallsParamTest(param, value, cbs.getTokens, cbs.saveNewAccessToken)
      ),
      wbahCallsPostPage({ page: 2 },        cbs.getTokens, cbs.saveNewAccessToken),
      wbahCallsPostPage({ currentPage: 2 }, cbs.getTokens, cbs.saveNewAccessToken),
      wbahLeadsParamTest("currentPage", 2,  cbs.getTokens, cbs.saveNewAccessToken),
      wbahLeadsParamTest("pageNumber",  2,  cbs.getTokens, cbs.saveNewAccessToken),
    ]);

    // Get first record ID from page 1 for comparison
    const p1Raw   = callsP1Res.data as any;
    const p1Recs  = Array.isArray(p1Raw?.data) ? p1Raw.data : [];
    const p1FirstId = p1Recs[0]?.id ?? p1Recs[0]?._id ?? null;

    function summarise(res: any, label: string) {
      const raw = res.data as any;
      const arr = Array.isArray(raw) ? raw
        : Array.isArray(raw?.data)       ? raw.data
        : Array.isArray(raw?.calls)      ? raw.calls
        : Array.isArray(raw?.leads)      ? raw.leads
        : Array.isArray(raw?.records)    ? raw.records
        : Array.isArray(raw?.result)     ? raw.result
        : Array.isArray(raw?.items)      ? raw.items
        : null;
      const firstId = arr?.[0]?.id ?? arr?.[0]?._id ?? null;
      return {
        label,
        ok:              res.ok,
        status:          res.status,
        recordCount:     arr ? arr.length : "N/A",
        pagination:      raw?.pagination ?? null,
        reportedPage:    raw?.pagination?.currentPage ?? null,
        firstRecordId:   firstId,
        differentToP1:   firstId !== null && p1FirstId !== null ? firstId !== p1FirstId : "unknown",
      };
    }

    // Build page-param discovery results
    const discoveryLabels = [
      ...PAGE_VARIANTS.map(({ param, value }) => `GET ?${param}=${value}`),
      "POST body {page:2}",
      "POST body {currentPage:2}",
      "GET leads ?currentPage=2",
      "GET leads ?pageNumber=2",
    ];
    const pageParamDiscovery = discoveryLabels.map((label, i) =>
      summarise(paramResults[i], label)
    );

    function fullSummarise(res: any, label: string) {
      const raw = res.data as any;
      const arr = Array.isArray(raw) ? raw
        : Array.isArray(raw?.data)       ? raw.data
        : Array.isArray(raw?.calls)      ? raw.calls
        : Array.isArray(raw?.leads)      ? raw.leads
        : Array.isArray(raw?.records)    ? raw.records
        : Array.isArray(raw?.result)     ? raw.result
        : Array.isArray(raw?.items)      ? raw.items
        : null;
      return {
        label,
        ok:           res.ok,
        status:       res.status,
        recordCount:  arr ? arr.length : "N/A — raw is not an array under any known key",
        topLevelKeys: raw && typeof raw === "object" && !Array.isArray(raw) ? Object.keys(raw) : (Array.isArray(raw) ? ["(bare array)"] : null),
        pagination:   raw?.pagination ?? null,
        sampleKeys:   arr?.[0] ? Object.keys(arr[0]).slice(0, 8) : null,
        rawWhenEmpty: (!arr || arr.length === 0) ? raw : undefined,
      };
    }

    return {
      count:              { ok: countRes.ok, status: countRes.status, raw: countRes.data },
      callsPage1:         fullSummarise(callsP1Res,  "GET /get-all-calldata?page=1"),
      leadsPage1:         fullSummarise(leadsP1Res,  "GET /get-userCall-lead?page=1"),
      crmData:            fullSummarise(crmRes,       "GET /crm-data/get-crm-data"),
      p1FirstId,
      pageParamDiscovery,
    };
  });

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

// ── Leads — fetch ALL pages using pagination metadata, return flat list ────────

export const listWbahLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);

    const firstRes = await api.wbahGetUserCallLeadPaged(1, cbs.getTokens, cbs.saveNewAccessToken);
    if (!firstRes.ok) throw new Error(firstRes.error ?? "Failed to fetch leads");

    const allRecs = await fetchAllPages(
      (p) => api.wbahGetUserCallLeadPaged(p, cbs.getTokens, cbs.saveNewAccessToken),
      firstRes.data,
    );

    const leads = allRecs.map((r: any, idx: number) => normaliseLeadRecord(r, idx));
    leads.sort((a, b) => {
      const ta = a.lastCalledAt ? new Date(a.lastCalledAt).getTime() : 0;
      const tb = b.lastCalledAt ? new Date(b.lastCalledAt).getTime() : 0;
      return tb - ta;
    });
    return leads;
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseLeadRecord(r: any, idx: number) {
  return {
    id:                 String(r._id ?? r.id ?? idx),
    srNo:               r.srNo ?? r.sr_no ?? null,
    name:               r.name ?? r.fullName ?? r.full_name ?? r.contactName ?? null,
    contact:            r.toNumber ?? r.mobile_number ?? r.phone ?? r.contact ?? null,
    type:               r.type ?? r.leadType ?? "Lead",
    lastCalledAt:       r.lastCalledAt ?? r.last_called_at ?? r.calledAt ?? r.created_at ?? null,
    callStatus:         r.callStatus ?? r.call_status ?? r.status ?? null,
    callDuration:       r.callDuration ?? r.call_duration ?? r.duration ?? null,
    recordingUrl:       r.recordingUrl ?? r.recording_url ?? r.recordingLink ?? null,
    transcript:         r.transcript ?? r.callTranscript ?? null,
    sentiment:          r.sentimentAnalysis ?? r.sentiment ?? null,
    direction:          r.direction ?? r.callDirection ?? null,
    appointmentDate:    r.appointmentDate ?? r.appointment_date ?? null,
    appointmentTime:    r.appointmentTime ?? r.appointment_time ?? null,
    bookingStatus:      r.bookingStatus ?? r.booking_status ?? null,
    calendlyBookingUrl: r.calendlyBookingUrl ?? r.calendly_booking_url ?? r.calendlyUrl ?? null,
    endReason:          r.endReason ?? r.end_reason ?? null,
    disconnectionReason:r.disconnectionReason ?? r.disconnection_reason ?? null,
    agentName:          r.agentName ?? r.agent_name ?? r.assignedAgent ?? r.agent ?? null,
  };
}

function extractRecords(raw: any): any[] {
  if (Array.isArray(raw))          return raw;
  if (Array.isArray(raw?.data))    return raw.data;
  if (Array.isArray(raw?.calls))   return raw.calls;
  if (Array.isArray(raw?.records)) return raw.records;
  if (Array.isArray(raw?.leads))   return raw.leads;
  if (Array.isArray(raw?.result))  return raw.result;
  if (Array.isArray(raw?.items))   return raw.items;
  return [];
}

/** Read totalPages from WeeBespoke pagination object. Returns null if unknown. */
function extractTotalPages(raw: any): number | null {
  const p = raw?.pagination;
  if (!p) return null;
  if (typeof p.totalPages  === "number") return p.totalPages;
  if (typeof p.total_pages === "number") return p.total_pages;
  if (typeof p.lastPage    === "number") return p.lastPage;
  if (typeof p.pages       === "number") return p.pages;
  // Calculate from totalRecords + limit
  const total = p.totalRecords ?? p.total_records ?? p.count ?? p.total;
  const limit = p.limit ?? p.perPage ?? p.per_page ?? 50;
  if (typeof total === "number" && typeof limit === "number" && limit > 0) {
    return Math.ceil(total / limit);
  }
  return null;
}

/** Fetch every page of a paginated WeeBespoke endpoint in parallel batches. */
async function fetchAllPages(
  fetchPage: (page: number) => Promise<any>,
  firstRaw: any,
): Promise<any[]> {
  const firstRecs  = extractRecords(firstRaw);
  const totalPages = extractTotalPages(firstRaw) ?? null;

  // If we know total pages, fetch all remaining in parallel batches of 20
  if (totalPages && totalPages > 1) {
    const remaining = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
    const BATCH = 20;
    const allRecs = [...firstRecs];
    for (let i = 0; i < remaining.length; i += BATCH) {
      const batch = remaining.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((p) => fetchPage(p)));
      for (const res of results) {
        if (res?.ok && res?.data) allRecs.push(...extractRecords(res.data));
      }
    }
    return allRecs;
  }

  // Fallback: fetch until we get an empty batch (unknown total pages)
  const BATCH   = 20;
  const allRecs = [...firstRecs];
  let   page    = 2;
  while (page <= 500) {
    const batch   = Array.from({ length: BATCH }, (_, i) => page + i);
    const results = await Promise.all(batch.map((p) => fetchPage(p)));
    let   found   = 0;
    for (const res of results) {
      if (res?.ok && res?.data) {
        const recs = extractRecords(res.data);
        allRecs.push(...recs);
        found += recs.length;
      }
    }
    if (found === 0) break;
    page += BATCH;
  }
  return allRecs;
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

// ── All WeeBespoke calls — fetches every page in parallel, returns WEBEE shape ─

export const listWbahCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);

    const firstRes = await api.wbahGetAllCallDataPaged(1, cbs.getTokens, cbs.saveNewAccessToken);
    if (!firstRes.ok) throw new Error(firstRes.error ?? "Failed to fetch calls from WeeBespoke");

    const allRecs = await fetchAllPages(
      (p) => api.wbahGetAllCallDataPaged(p, cbs.getTokens, cbs.saveNewAccessToken),
      firstRes.data,
    );

    const calls = allRecs.map((r: any, idx: number) => normaliseWbahCall(r, idx));
    calls.sort((a, b) => {
      const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
      return tb - ta;
    });
    return calls;
  });

// ── Calls — fetch only page 1 (newest 50) — used for incremental polling ──────

export const listWbahLatestCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetAllCallDataPaged(1, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) return [];
    const recs = extractRecords(res.data as any);
    const calls = recs.map((r: any, idx: number) => normaliseWbahCall(r, idx));
    calls.sort((a: any, b: any) => {
      const ta = a.started_at ? new Date(a.started_at as string).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at as string).getTime() : 0;
      return tb - ta;
    });
    return calls;
  });

// ── CRM Contacts — single call returns all 3,720 records (no pagination) ──────

export const listWbahCrmContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetCrmData(cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to fetch CRM contacts");
    const recs = extractRecords(res.data as any);
    return recs.map((r: any, idx: number) => ({
      id:        String(r._id ?? r.id ?? idx),
      name:      r.name ?? r.fullName ?? r.full_name ?? null,
      contact:   r.mobile_number ?? r.phone ?? r.toNumber ?? null,
      email:     r.email ?? null,
      type:      r.type ?? r.leadType ?? "Contact",
      status:    r.status ?? r.callStatus ?? null,
      srNo:      r.srNo ?? r.sr_no ?? null,
      agentName: r.agentName ?? r.agent_name ?? null,
      createdAt: r.createdAt ?? r.created_at ?? null,
    }));
  });

function normaliseWbahCall(r: any, idx: number): Record<string, unknown> {
  // ── Identity ──────────────────────────────────────────────────────────────
  const id    = String(r._id ?? r.id ?? `wbah-${idx}`);
  const name  = r.name ?? r.fullName ?? r.full_name ?? r.contactName ?? null;
  const phone = r.toNumber ?? r.mobile_number ?? r.phone ?? r.phoneNumber ?? null;
  const agentName = r.agentName ?? r.agent_name ?? r.assignedAgent ?? null;

  // ── Call status ───────────────────────────────────────────────────────────
  const rawStatus = (r.callStatus ?? r.status ?? "").toLowerCase();
  let callStatus: string;
  if (rawStatus === "ended" || rawStatus === "call_analyzed" || rawStatus === "completed") {
    callStatus = "completed";
  } else if (rawStatus === "not_connected" || rawStatus === "voicemail" || rawStatus === "no_answer") {
    callStatus = "no_answer";
  } else if (rawStatus === "failed") {
    callStatus = "failed";
  } else {
    callStatus = rawStatus || "completed";
  }

  // ── Sentiment ─────────────────────────────────────────────────────────────
  const rawSentiment = (r.sentimentAnalysis ?? r.sentiment ?? "").toLowerCase();
  let sentiment: string | null = null;
  if (/positive/.test(rawSentiment))       sentiment = "positive";
  else if (/neutral/.test(rawSentiment))   sentiment = "neutral";
  else if (/negative/.test(rawSentiment))  sentiment = "negative";

  // ── Duration ──────────────────────────────────────────────────────────────
  let durationSeconds: number | null = null;
  if (r.durationMs && Number(r.durationMs) > 0) {
    durationSeconds = Math.round(Number(r.durationMs) / 1000);
  } else if (r.callDuration) {
    durationSeconds = Number(r.callDuration) || null;
  } else if (r.duration) {
    durationSeconds = Number(r.duration) || null;
  }

  // ── Timestamps ────────────────────────────────────────────────────────────
  const startedAt = r.lastCalledAt ?? r.last_called_at ?? r.calledAt ?? r.createdAt ?? r.created_at ?? null;

  // ── Direction ─────────────────────────────────────────────────────────────
  const dir = (r.direction ?? r.callDirection ?? r.type ?? "outbound").toLowerCase();
  const callType = dir.includes("inbound") ? "inbound" : "outbound";

  return {
    id,
    agent_id:              null,
    agent_name:            agentName,
    call_status:           callStatus,
    call_type:             callType,
    duration_seconds:      durationSeconds,
    started_at:            startedAt,
    ended_at:              null,
    recording_url:         r.recordingUrl ?? r.recording_url ?? null,
    transcript:            r.transcript ?? r.callTranscript ?? null,
    call_summary:          r.transcript ?? r.callTranscript ?? r.callSummary ?? null,
    from_number:           callType === "inbound"  ? phone : null,
    to_number:             callType === "outbound" ? phone : null,
    sentiment,
    disconnection_reason:  r.disconnectionReason ?? r.disconnection_reason ?? null,
    cost_cents:            null,
    retell_call_id:        null,
    lead:                  name ? { id, full_name: name, phone: phone ?? "" } : null,
    // WeeBespoke-specific extras
    wbah_name:             name,
    wbah_contact:          phone,
    appointment_date:      r.appointmentDate ?? r.appointment_date ?? null,
    appointment_time:      r.appointmentTime ?? r.appointment_time ?? null,
    booking_status:        r.bookingStatus ?? r.booking_status ?? null,
    calendly_booking_url:  r.calendlyBookingUrl ?? r.calendly_booking_url ?? r.calendlyUrl ?? null,
    end_reason:            r.endReason ?? r.end_reason ?? null,
  };
}

// ── Retell helper — get WBAH workspace's Retell API key ───────────────────────

const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

async function requireWbahRetellKey(userId: string): Promise<string> {
  if (!userId) throw new Error("Unauthorized");

  // Platform admins bypass workspace membership check
  const admin = await isPlatformAdmin(userId);
  if (!admin) {
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
