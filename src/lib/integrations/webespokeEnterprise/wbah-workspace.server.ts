/**
 * Webuyanyhouse Workspace — TanStack Start server functions.
 *
 * All functions:
 * 1. Require authenticated WEBEE session (requireSupabaseAuth)
 * 2. Verify the current workspace is "webuyanyhouse" (workspace isolation)
 * 3. Retrieve WeeBespoke token server-side (never sent to browser)
 * 4. Call WeeBespoke API and return data
 *
 * Super Admin users see NONE of this data — only workspace users do.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import * as api from "./client.server";

// ── Shared: require Webuyanyhouse workspace + get token callbacks ──────────────

async function requireWbahCbs(workspaceId: string | null | undefined) {
  if (!workspaceId) throw new Error("No active workspace");

  const { data: ws } = await (supabaseAdmin as any)
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (ws?.slug !== "webuyanyhouse") {
    throw new Error("Access denied — this page is only available in the Webuyanyhouse workspace");
  }

  const { data: integration } = await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status")
    .eq("integration_key", "webespoke_enterprise")
    .eq("client_name", "Webuyanyhouse")
    .maybeSingle();

  if (!integration?.access_token || integration.status !== "connected") {
    throw new Error("WeeBespoke API not connected — contact your administrator");
  }

  const getTokens = async () => ({
    accessToken: integration.access_token as string,
    refreshToken: (integration.refresh_token ?? "") as string,
  });

  const saveNewAccessToken = async (token: string) => {
    await (supabaseAdmin as any)
      .from("enterprise_integrations")
      .update({ access_token: token })
      .eq("integration_key", "webespoke_enterprise")
      .eq("client_name", "Webuyanyhouse");
  };

  return { getTokens, saveNewAccessToken };
}

// ── Workspace check (used by layout guard) ────────────────────────────────────

export const checkWbahWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await (supabaseAdmin as any)
      .from("workspaces")
      .select("slug, name")
      .eq("id", context.workspaceId)
      .maybeSingle();
    return {
      isWebuyanyhouse: data?.slug === "webuyanyhouse",
      slug: data?.slug ?? null,
      name: data?.name ?? null,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// 1. DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

const DateRangeSchema = z.object({ startDate: z.string(), endDate: z.string() });

export const getWbahDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => DateRangeSchema.parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const dr = { startDate: data.startDate, endDate: data.endDate };
    const [minutes, calls, leads, perf, drops] = await Promise.allSettled([
      api.wbahDashboardTotalMinutes(dr, cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahDashboardCalls(dr, cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahDashboardLeads(dr, cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahDashboardPerformance(dr, cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahDashboardDrops(dr, cbs.getTokens, cbs.saveNewAccessToken),
    ]);
    const val = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value.data : null;
    return {
      totalMinutes:    val(minutes),
      numberOfCalls:   val(calls),
      leads:           val(leads),
      callPerformance: val(perf),
      callDrops:       val(drops),
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// 2. PEOPLE
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahPeople = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const [callData, callCount, callbacks] = await Promise.allSettled([
      api.wbahGetAllCallData(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetCallCount(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetPendingCallbacks(cbs.getTokens, cbs.saveNewAccessToken),
    ]);
    const val = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value.data : null;
    return {
      callData:  val(callData),
      callCount: val(callCount),
      callbacks: val(callbacks),
    };
  });

export const getWbahUserHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ userId: z.string(), phone: z.string().optional() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahGetUserHistory(data, cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 3. CRM DATA
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahCrmData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahGetCrmData(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const createWbahCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahCreateCrmLead(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to create lead");
    return res.data;
  });

export const startWbahBatchCalling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahStartBatchCalling(cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to start batch calling");
    return res.data;
  });

export const clearWbahCrmData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahClearAllCrmData(cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to clear CRM data");
    return res.data;
  });

export const deleteWbahCrmSelected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ ids: z.array(z.string()) }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahDeleteSelectedCrmData(data.ids, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete records");
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 4. CAMPAIGNS
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahGetCampaigns(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const createWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahCreateCampaign(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to create campaign");
    return res.data;
  });

export const updateWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), payload: z.record(z.string(), z.unknown()) }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahUpdateCampaign(data.id, data.payload as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update campaign");
    return res.data;
  });

export const pauseWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahPauseCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to pause campaign");
    return res.data;
  });

export const resumeWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahResumeCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to resume campaign");
    return res.data;
  });

export const deleteWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahDeleteCampaign(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete campaign");
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 5. AGENTS
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const [agents, voicemail] = await Promise.allSettled([
      api.wbahGetAgents(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetAgentsWithVoicemail(cbs.getTokens, cbs.saveNewAccessToken),
    ]);
    const val = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value.data : null;
    return { agents: val(agents), voicemailAgents: val(voicemail) };
  });

export const renameWbahAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), name: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahRenameAgent(data.id, data.name, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to rename agent");
    return res.data;
  });

export const updateWbahAgentVoicemail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), enabled: z.boolean(), message: z.string().optional() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahAgentVoicemailSetting(data.id, { enabled: data.enabled, message: data.message }, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update voicemail");
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 6. CALLS & SCHEDULING
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahCallOutput = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahGetAllCallOutput(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const getWbahFrequency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahGetFrequency(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const addWbahFrequency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahAddFrequency(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to add schedule");
    return res.data;
  });

export const updateWbahFrequency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahUpdateFrequency(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update schedule");
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 7. PHONE NUMBERS
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahPhoneNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahGetPhoneNumbers(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const saveWbahPhoneNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahUpdatePhoneNumbers(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to save phone numbers");
    return res.data;
  });

export const updateWbahPhoneVoicemail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), enabled: z.boolean(), message: z.string().optional() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahPhoneVoicemailSetting(data.id, { enabled: data.enabled, message: data.message }, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update voicemail");
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 8. CREDITS
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahCredits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const [summary, history, monthly, retell] = await Promise.allSettled([
      api.wbahGetCreditSummary(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetCreditHistory(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetMonthlyUsage(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetRetellUsage(cbs.getTokens, cbs.saveNewAccessToken),
    ]);
    const val = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value.data : null;
    return {
      summary:      val(summary),
      history:      val(history),
      monthlyUsage: val(monthly),
      retellUsage:  val(retell),
    };
  });

export const allocateWbahCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahAllocateCredits(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to allocate credits");
    return res.data;
  });

export const deleteWbahAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahDeleteAllocation(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete allocation");
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 9. USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahUsersAndPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const [perms, users] = await Promise.allSettled([
      api.wbahGetPermissions(cbs.getTokens, cbs.saveNewAccessToken),
      api.wbahGetUsers(cbs.getTokens, cbs.saveNewAccessToken),
    ]);
    const val = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value.data : null;
    return {
      permissionCatalog: val(perms),
      users:             val(users),
    };
  });

export const createWbahUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahCreateUser(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to create user");
    return res.data;
  });

export const updateWbahUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), payload: z.record(z.string(), z.unknown()) }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahUpdateUser(data.id, data.payload as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update user");
    return res.data;
  });

export const toggleWbahUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), status: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahToggleUserStatus(data.id, { status: data.status }, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update user status");
    return res.data;
  });

export const deleteWbahUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.workspaceId);
    const res = await api.wbahDeleteUser(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete user");
    return res.data;
  });
