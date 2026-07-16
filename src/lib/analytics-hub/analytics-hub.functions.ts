/**
 * Analytics Hub server fns — thin wrappers around analytics-hub.server.ts.
 *
 * Each fn: requireSupabaseAuth → verify workspace membership → feature gate →
 * delegate to the plain aggregation helper. Aggregation helpers already fail
 * closed (errors → zeroed structures with `error`), so these fns never leak
 * cross-workspace data.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireFeatureAccess } from "@/lib/packages/entitlements.server";
import type { FeatureKey } from "@/lib/packages/packages.shared";
import {
  type AnalyticsFilters,
  getAnalyticsOverviewData,
  getCampaignAnalyticsData,
  getAgentAnalyticsData,
  getLeadSourceAnalyticsData,
  getCallAnalyticsDeepData,
  getSentimentAnalyticsData,
  getBookingAnalyticsData,
  getWorkflowAnalyticsData,
  getFollowUpAnalyticsData,
  getFinancialAnalyticsData,
  getLeadAnalyticsData,
  getAnalyticsFilterOptionsData,
} from "./analytics-hub.server";

interface AnalyticsInput extends AnalyticsFilters {
  /** Optional — defaults to the caller's active workspace (context.workspaceId). */
  workspaceId?: string;
}

/** Verify the caller is a member of the requested workspace (fail closed). */
async function assertMembership(
  userId: string,
  contextWorkspaceId: string | undefined,
  workspaceId: string,
): Promise<void> {
  if (!workspaceId) throw new Error("workspaceId required");
  if (contextWorkspaceId && contextWorkspaceId === workspaceId) return;
  const { data, error } = await (supabaseAdmin as any)
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("You are not a member of this workspace.");
}

/**
 * Resolve the effective workspace: caller-supplied workspaceId (verified against
 * membership) or the active workspace from the auth context. Enforces the
 * feature gate. Returns the resolved workspaceId for the aggregation helpers.
 */
async function guard(
  ctx: { userId: string; workspaceId?: string },
  input: AnalyticsInput,
  feature: FeatureKey,
): Promise<string> {
  const workspaceId = input.workspaceId ?? ctx.workspaceId;
  if (!workspaceId) throw new Error("No active workspace");
  await assertMembership(ctx.userId, ctx.workspaceId, workspaceId);
  await requireFeatureAccess(workspaceId, ctx.userId, feature);
  return workspaceId;
}

function filtersOf(input: AnalyticsInput): AnalyticsFilters {
  return {
    dateFilter: input.dateFilter,
    customStart: input.customStart ?? null,
    customEnd: input.customEnd ?? null,
    campaignId: input.campaignId ?? null,
    agentId: input.agentId ?? null,
    source: input.source ?? null,
  };
}

export const getAnalyticsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics");
    return getAnalyticsOverviewData(ws, filtersOf(data));
  });

export const getCampaignAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput & { compareIds?: string[] }) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getCampaignAnalyticsData(ws, filtersOf(data), { compareIds: data.compareIds });
  });

export const getAgentAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getAgentAnalyticsData(ws, filtersOf(data));
  });

export const getLeadSourceAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getLeadSourceAnalyticsData(ws, filtersOf(data));
  });

export const getCallAnalyticsDeep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getCallAnalyticsDeepData(ws, filtersOf(data));
  });

export const getSentimentAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getSentimentAnalyticsData(ws, filtersOf(data));
  });

export const getBookingAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getBookingAnalyticsData(ws, filtersOf(data));
  });

export const getWorkflowAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getWorkflowAnalyticsData(ws, filtersOf(data));
  });

export const getFollowUpAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getFollowUpAnalyticsData(ws, filtersOf(data));
  });

export const getFinancialAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_financial");
    return getFinancialAnalyticsData(ws, filtersOf(data));
  });

export const getLeadAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getLeadAnalyticsData(ws, filtersOf(data));
  });

export const getAnalyticsFilterOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AnalyticsInput) => input)
  .handler(async ({ data, context }) => {
    const ws = await guard(context, data, "analytics_advanced");
    return getAnalyticsFilterOptionsData(ws);
  });
