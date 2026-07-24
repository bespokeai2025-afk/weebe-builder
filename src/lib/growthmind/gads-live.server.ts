/**
 * GrowthMind Google Ads — authenticated server functions (SERVER ONLY).
 * All heavy lifting lives in gads-live-core.server.ts (alias-free so the
 * vite-config-time sync tick can also use it). No tokens are ever returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  loadGadsCreds,
  gaqlSearch,
  discoverAccessibleCustomers,
  deriveConnectionState,
  runGadsSync,
  getGoogleAccountRow,
} from "./gads-live-core.server";

function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// ── Shared helpers for server fns ─────────────────────────────────────────────


async function requireAdmin(context: any): Promise<{ workspaceId: string; userId: string }> {
  const workspaceId = context.workspaceId;
  const userId = context.userId;
  if (!workspaceId) throw new Error("No workspace");
  const { data: member } = await (context.supabase as any)
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (member?.role !== "owner" && member?.role !== "admin") {
    throw new Error("Only workspace owners and admins can manage the Google Ads connection.");
  }
  return { workspaceId, userId };
}


// ── Server functions (no tokens ever returned) ────────────────────────────────

export const getGadsConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const acc = await getGoogleAccountRow(workspaceId);
    const state = await deriveConnectionState(workspaceId, acc);
    const creds = await loadGadsCreds(workspaceId);
    return {
      state,
      hasClientId: !!creds.clientId,
      hasClientSecret: !!creds.clientSecret,
      hasDeveloperToken: !!creds.developerToken,
      hasRefreshToken: !!creds.refreshToken,
      account: acc ? {
        id: acc.id, label: acc.label, customerId: acc.customer_id,
        loginCustomerId: acc.login_customer_id, descriptiveName: acc.descriptive_name,
        currencyCode: acc.currency_code, timeZone: acc.time_zone,
        lastSyncedAt: acc.last_synced_at, syncStatus: acc.sync_status, syncError: acc.sync_error,
        accessibleCustomers: acc.accessible_customers ?? null,
        syncConfig: {
          incrementalMinutes: Math.max(5, Number((acc.sync_config as any)?.incrementalMinutes ?? 15) || 15),
          historicalHours:    Math.max(1, Number((acc.sync_config as any)?.historicalHours ?? 24) || 24),
        },
      } : null,
    };
  });

export const discoverGadsAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await requireAdmin(context);
    const customers = await discoverAccessibleCustomers(workspaceId);
    const sb = supabaseAdmin as any;
    const acc = await getGoogleAccountRow(workspaceId);
    if (acc) {
      await sb.from("growthmind_ads_accounts")
        .update({ accessible_customers: customers, updated_at: new Date().toISOString() })
        .eq("id", acc.id);
    }
    const selectable = customers.filter(c => !c.isManager);
    return { customers, autoSelectable: selectable.length === 1 ? selectable[0] : null };
  });

export const selectGadsAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    customerId:      z.string().regex(/^[\d-]{5,20}$/, "Customer ID must be numeric (e.g. 123-456-7890)"),
    loginCustomerId: z.string().regex(/^[\d-]{5,20}$/).nullable().optional(),
    label:           z.string().max(120).optional(),
  }).parse(i))
  .handler(async ({ context, data }) => {
    const { workspaceId } = await requireAdmin(context);
    const sb = supabaseAdmin as any;
    const customerId = data.customerId.replace(/-/g, "");
    const loginCustomerId = data.loginCustomerId ? data.loginCustomerId.replace(/-/g, "") : null;

    // Verify we can actually query this account before persisting
    const rows = await gaqlSearch(
      { workspaceId, customerId, loginCustomerId },
      `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1`,
    );
    const cust = rows[0]?.customer ?? {};
    if (cust.manager) {
      throw new Error("That is a manager (MCC) account — select one of its client accounts instead.");
    }

    const now = new Date().toISOString();
    const acc = await getGoogleAccountRow(workspaceId);
    const patch = {
      customer_id:       customerId,
      login_customer_id: loginCustomerId,
      descriptive_name:  cust.descriptiveName ?? null,
      currency_code:     cust.currencyCode ?? null,
      time_zone:         cust.timeZone ?? null,
      connection_state:  "account_selected",
      account_id:        customerId, // repair legacy field (was an email in broken rows)
      status:            "active",
      sync_error:        null,
      updated_at:        now,
      ...(data.label ? { label: data.label } : {}),
    };
    let accountRowId: string;
    if (acc) {
      await sb.from("growthmind_ads_accounts").update(patch).eq("id", acc.id);
      accountRowId = acc.id;
    } else {
      const { data: ins, error } = await sb.from("growthmind_ads_accounts").insert({
        workspace_id: workspaceId, platform: "google",
        label: data.label || cust.descriptiveName || `Google Ads ${data.customerId}`,
        created_at: now, ...patch,
      }).select("id").single();
      if (error) throw new Error(error.message);
      accountRowId = ins.id;
    }

    // Also persist selection into provider_settings credentials (single source used by legacy paths)
    try {
      const { data: ps } = await sb.from("provider_settings").select("id, credentials")
        .eq("workspace_id", workspaceId).eq("provider_category", "advertising").eq("provider_name", "google_ads").maybeSingle();
      if (ps) {
        const creds = { ...(ps.credentials ?? {}), customerId, ...(loginCustomerId ? { managerId: loginCustomerId } : {}) };
        if (!loginCustomerId) delete (creds as any).managerId;
        await sb.from("provider_settings").update({ credentials: creds, status: "connected", updated_at: now }).eq("id", ps.id);
      }
    } catch { /* best-effort */ }

    // Kick the initial sync in the background
    runGadsSync(workspaceId, accountRowId, "initial").catch(() => {});

    return {
      ok: true,
      accountRowId,
      customerId,
      descriptiveName: cust.descriptiveName ?? null,
      currencyCode: cust.currencyCode ?? null,
    };
  });

export const runGadsRefreshNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const acc = await getGoogleAccountRow(workspaceId);
    if (!acc) throw new Error("No Google Ads account connected yet");
    const result = await runGadsSync(workspaceId, acc.id, "manual");
    return result;
  });

// ── Dashboard reads ───────────────────────────────────────────────────────────

const DashboardInput = z.object({
  days:    z.number().int().min(7).max(90).default(30),
  compare: z.boolean().default(true),
});

export const getGadsDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DashboardInput.parse(i ?? {}))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const acc = await getGoogleAccountRow(workspaceId);
    if (!acc?.customer_id) return { connected: false, campaigns: [], kpis: null, prevKpis: null, syncRuns: [], recommendations: [], changeRequests: [] };

    const since = daysAgo(data.days);
    const prevSince = daysAgo(data.days * 2);

    const [dailyRes, runsRes, recsRes, crsRes] = await Promise.all([
      sb.from("growthmind_gads_campaign_daily")
        .select("campaign_id, name, status, channel_type, date, cost_micros, impressions, clicks, conversions, conversions_value, budget_micros")
        .eq("workspace_id", workspaceId).eq("account_row_id", acc.id)
        .gte("date", prevSince).limit(20000),
      sb.from("growthmind_gads_sync_runs")
        .select("id, run_type, status, started_at, finished_at, campaigns_synced, spend_synced, error_message")
        .eq("workspace_id", workspaceId).eq("account_row_id", acc.id)
        .order("started_at", { ascending: false }).limit(10),
      sb.from("growthmind_gads_recommendations")
        .select("id, section, priority, confidence, title, campaign_id, campaign_name, evidence, expected_benefit, recommended_action, status, created_at, updated_at")
        .eq("workspace_id", workspaceId).eq("account_row_id", acc.id)
        .in("status", ["new", "under_review", "approved", "applied"])
        .order("created_at", { ascending: false }).limit(100),
      sb.from("growthmind_gads_change_requests")
        .select("id, recommendation_id, campaign_id, change_type, payload, status, approved_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }).limit(50),
    ]);

    interface CampAgg {
      campaignId: string; name: string; status: string | null; channelType: string | null;
      spend: number; impressions: number; clicks: number; conversions: number; conversionsValue: number;
      budget: number | null; series: Array<{ date: string; spend: number; clicks: number; conversions: number }>;
    }
    const campMap = new Map<string, CampAgg>();
    const kpis     = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0 };
    const prevKpis = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0 };

    for (const d of dailyRes.data ?? []) {
      const spend = Number(d.cost_micros ?? 0) / 1e6;
      const inWindow = d.date >= since;
      const tgt = inWindow ? kpis : prevKpis;
      tgt.spend += spend; tgt.impressions += Number(d.impressions ?? 0); tgt.clicks += Number(d.clicks ?? 0);
      tgt.conversions += Number(d.conversions ?? 0); tgt.conversionsValue += Number(d.conversions_value ?? 0);
      if (!inWindow) continue;
      const c: CampAgg = campMap.get(d.campaign_id) ?? {
        campaignId: d.campaign_id, name: d.name, status: d.status, channelType: d.channel_type,
        spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionsValue: 0,
        budget: null, series: [] as CampAgg["series"],
      };
      c.spend += spend; c.impressions += Number(d.impressions ?? 0); c.clicks += Number(d.clicks ?? 0);
      c.conversions += Number(d.conversions ?? 0); c.conversionsValue += Number(d.conversions_value ?? 0);
      c.name = d.name; c.status = d.status;
      if (d.budget_micros != null) c.budget = Number(d.budget_micros) / 1e6;
      c.series.push({ date: d.date, spend: +spend.toFixed(2), clicks: Number(d.clicks ?? 0), conversions: Number(d.conversions ?? 0) });
      campMap.set(d.campaign_id, c);
    }
    const campaigns = Array.from(campMap.values())
      .map(c => ({ ...c, series: c.series.sort((a, b) => a.date.localeCompare(b.date)) }))
      .sort((a, b) => b.spend - a.spend);

    return {
      connected: true,
      account: {
        id: acc.id, label: acc.label, customerId: acc.customer_id,
        descriptiveName: acc.descriptive_name, currencyCode: acc.currency_code,
        timeZone: acc.time_zone, lastSyncedAt: acc.last_synced_at,
        syncStatus: acc.sync_status, syncError: acc.sync_error,
      },
      kpis, prevKpis: data.compare ? prevKpis : null,
      campaigns,
      syncRuns: runsRes.data ?? [],
      recommendations: recsRes.data ?? [],
      changeRequests: crsRes.data ?? [],
    };
  });

export const getGadsCampaignDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ campaignId: z.string().min(1).max(40) }).parse(i))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabaseAdmin as any;
    const acc = await getGoogleAccountRow(workspaceId);
    if (!acc) throw new Error("No Google Ads account connected");

    const [dimsRes, recsRes] = await Promise.all([
      sb.from("growthmind_gads_dimension_stats")
        .select("entity_type, entity_key, label, cost_micros, impressions, clicks, conversions, conversions_value, meta, date_start, date_end")
        .eq("workspace_id", workspaceId).eq("account_row_id", acc.id)
        .eq("campaign_id", data.campaignId)
        .order("cost_micros", { ascending: false }).limit(500),
      sb.from("growthmind_gads_recommendations")
        .select("id, section, priority, title, expected_benefit, recommended_action, status")
        .eq("workspace_id", workspaceId).eq("campaign_id", data.campaignId)
        .in("status", ["new", "under_review", "approved"]).limit(20),
    ]);

    const grouped: Record<string, any[]> = {};
    for (const d of dimsRes.data ?? []) {
      (grouped[d.entity_type] ??= []).push({
        key: d.entity_key, label: d.label,
        spend: +(Number(d.cost_micros) / 1e6).toFixed(2),
        impressions: Number(d.impressions), clicks: Number(d.clicks),
        conversions: Number(d.conversions), conversionsValue: Number(d.conversions_value),
        meta: d.meta,
      });
    }
    return { dimensions: grouped, findings: recsRes.data ?? [] };
  });

// ── Recommendation lifecycle (approval creates a change request ONLY) ─────────

export const setGadsRecommendationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    id:     z.string().uuid(),
    status: z.enum(["under_review", "approved", "rejected", "dismissed"]),
  }).parse(i))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = await requireAdmin(context);
    const sb = supabaseAdmin as any;
    const now = new Date().toISOString();

    const { data: rec } = await sb
      .from("growthmind_gads_recommendations")
      .select("id, workspace_id, account_row_id, customer_id, campaign_id, section, title, recommended_action, evidence, status")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!rec) throw new Error("Recommendation not found");
    if (rec.status === "applied") throw new Error("This recommendation has already been applied");

    await sb.from("growthmind_gads_recommendations").update({
      status: data.status, reviewed_by: userId, reviewed_at: now, updated_at: now,
    }).eq("id", rec.id);

    // Approval creates a change-request row. It is NEVER executed automatically —
    // there is intentionally no executor for live Google Ads edits.
    let changeRequestId: string | null = null;
    if (data.status === "approved") {
      const { data: cr } = await sb.from("growthmind_gads_change_requests").insert({
        workspace_id: workspaceId,
        recommendation_id: rec.id,
        account_row_id: rec.account_row_id,
        customer_id: rec.customer_id,
        campaign_id: rec.campaign_id,
        change_type: rec.section,
        payload: { title: rec.title, recommendedAction: rec.recommended_action, evidence: rec.evidence },
        status: "approved",
        approved_by: userId,
      }).select("id").single();
      changeRequestId = cr?.id ?? null;
    }
    return { ok: true, changeRequestId };
  });

