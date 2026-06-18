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
      limit:  z.number().int().min(1).max(100).default(10),
      search: z.string().optional(),
      filter: z.enum(["all", "inbound", "outbound", "lead", "opportunity"]).optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetUserCallLeadPaged(data.page, data.limit, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to fetch leads");

    const raw = res.data as any;
    const records: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(raw?.leads)
          ? raw.leads
          : Array.isArray(raw?.records)
            ? raw.records
            : [];

    const total: number =
      raw?.total ?? raw?.totalCount ?? raw?.count ?? raw?.pagination?.total ?? records.length;

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
      total,
      page:  data.page,
      limit: data.limit,
      pages: Math.max(1, Math.ceil(total / data.limit)),
    };
  });

// ── Call Logs — live from WeeBespoke API with server-side pagination ──────────

export const getWbahCallLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      page:  z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(10),
    }).parse(i ?? {}),
  )
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetAllCallDataPaged(data.page, data.limit, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to fetch call logs");

    // Normalise the API response — field names vary between environments
    const raw = res.data as any;
    const records: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(raw?.calls)
          ? raw.calls
          : Array.isArray(raw?.records)
            ? raw.records
            : [];

    const total: number =
      raw?.total ?? raw?.totalCount ?? raw?.count ?? raw?.pagination?.total ?? records.length;

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
      records: normalised,
      total,
      page:  data.page,
      limit: data.limit,
      pages: Math.max(1, Math.ceil(total / data.limit)),
    };
  });
