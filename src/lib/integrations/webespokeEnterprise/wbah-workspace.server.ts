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
//
// Uses userId (not workspaceId) so the guard works regardless of which workspace
// is currently "active" in the user's session cookie. A user who has a personal
// workspace set as their active workspace can still access WBAH pages as long as
// they are a member of any workspace with slug = "webuyanyhouse".

async function requireWbahCbs(userId: string) {
  if (!userId) throw new Error("Unauthorized");

  // Find the Webuyanyhouse workspace via membership, irrespective of active workspace
  const { data: memberships } = await (supabaseAdmin as any)
    .from("workspace_members")
    .select("workspace_id, workspaces(slug)")
    .eq("user_id", userId);

  const wbahMembership = (memberships ?? []).find(
    (m: any) => m.workspaces?.slug === "webuyanyhouse",
  );

  if (!wbahMembership) {
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
    // Check ALL workspace memberships for this user — not just the active workspace.
    // The active workspace (from cookie) may be a personal workspace; the user is
    // still a WBAH user as long as they are a member of any "webuyanyhouse" workspace.
    const { data: memberships } = await (supabaseAdmin as any)
      .from("workspace_members")
      .select("workspace_id, workspaces(id, name, slug)")
      .eq("user_id", context.userId);

    const wbahWs = (memberships ?? []).find(
      (m: any) => m.workspaces?.slug === "webuyanyhouse",
    );

    return {
      isWebuyanyhouse: !!wbahWs,
      slug: wbahWs?.workspaces?.slug ?? null,
      name: wbahWs?.workspaces?.name ?? null,
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
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetUserHistory(data, cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 3. CRM DATA
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahCrmData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetCrmData(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const createWbahCrmLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahCreateCrmLead(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to create lead");
    return res.data;
  });

export const startWbahBatchCalling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahStartBatchCalling(cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to start batch calling");
    return res.data;
  });

export const clearWbahCrmData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahClearAllCrmData(cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to clear CRM data");
    return res.data;
  });

export const deleteWbahCrmSelected = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ ids: z.array(z.string()) }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetCampaigns(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
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

export const updateWbahCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), payload: z.record(z.string(), z.unknown()) }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahUpdateCampaign(data.id, data.payload as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update campaign");
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

// ─────────────────────────────────────────────────────────────────────────────
// 5. AGENTS
// ─────────────────────────────────────────────────────────────────────────────

export const getWbahAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahRenameAgent(data.id, data.name, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to rename agent");
    return res.data;
  });

export const updateWbahAgentVoicemail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), enabled: z.boolean(), message: z.string().optional() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetAllCallOutput(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const getWbahFrequency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetFrequency(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const addWbahFrequency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahAddFrequency(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to add schedule");
    return res.data;
  });

export const updateWbahFrequency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahGetPhoneNumbers(cbs.getTokens, cbs.saveNewAccessToken);
    return res.data;
  });

export const saveWbahPhoneNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.record(z.string(), z.unknown()).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahUpdatePhoneNumbers(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to save phone numbers");
    return res.data;
  });

export const updateWbahPhoneVoicemail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), enabled: z.boolean(), message: z.string().optional() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahAllocateCredits(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to allocate credits");
    return res.data;
  });

export const deleteWbahAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
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
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahCreateUser(data as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to create user");
    return res.data;
  });

export const updateWbahUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), payload: z.record(z.string(), z.unknown()) }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahUpdateUser(data.id, data.payload as Record<string, unknown>, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update user");
    return res.data;
  });

export const toggleWbahUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string(), status: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahToggleUserStatus(data.id, { status: data.status }, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to update user status");
    return res.data;
  });

export const deleteWbahUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string() }).parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const cbs = await requireWbahCbs(context.userId);
    const res = await api.wbahDeleteUser(data.id, cbs.getTokens, cbs.saveNewAccessToken);
    if (!res.ok) throw new Error(res.error ?? "Failed to delete user");
    return res.data;
  });
