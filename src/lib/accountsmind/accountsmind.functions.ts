import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeClientMonthlyCost,
  upsertClientMonthlyCost,
  generateAccountsMindAlerts,
} from "./client-costing.server";

// ── Billing profile CRUD ──────────────────────────────────────────────────────

export const getBillingProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    const { data: profile, error } = await supabaseAdmin
      .from("client_billing_profiles")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return profile ?? null;
  });

export const upsertBillingProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(
    (input: {
      workspaceId:          string;
      monthlyChargeCents:   number;
      currency:             string;
      billingCycle:         string;
      includedMinutes:      number;
      includedMessages:     number;
      includedVideoSeconds: number;
      includedEmailSends:   number;
      includedStorageMb:    number;
      overageRates:         Record<string, number>;
      contractStartDate:    string | null;
      contractEndDate:      string | null;
      status:               string;
      notes:                string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("client_billing_profiles")
      .upsert(
        {
          workspace_id:            data.workspaceId,
          monthly_charge_cents:    data.monthlyChargeCents,
          currency:                data.currency,
          billing_cycle:           data.billingCycle,
          included_minutes:        data.includedMinutes,
          included_messages:       data.includedMessages,
          included_video_seconds:  data.includedVideoSeconds,
          included_email_sends:    data.includedEmailSends,
          included_storage_mb:     data.includedStorageMb,
          overage_rates_json:      data.overageRates,
          contract_start_date:     data.contractStartDate,
          contract_end_date:       data.contractEndDate,
          status:                  data.status,
          notes:                   data.notes,
          updated_at:              new Date().toISOString(),
        },
        { onConflict: "workspace_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Monthly cost compute + store ──────────────────────────────────────────────

export const computeAndStoreClientCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { workspaceId: string; month?: string }) => input)
  .handler(async ({ data }) => {
    const monthDate = data.month ? new Date(data.month) : new Date();
    const breakdown = await computeClientMonthlyCost(data.workspaceId, monthDate);
    await upsertClientMonthlyCost(breakdown);

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("name")
      .eq("id", data.workspaceId)
      .maybeSingle();

    await generateAccountsMindAlerts(data.workspaceId, breakdown, ws?.name ?? "Unknown");

    return { ok: true, breakdown };
  });

export const getClientMonthlyCosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { workspaceId: string; limit?: number }) => input)
  .handler(async ({ data }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("client_monthly_costs")
      .select("*")
      .eq("workspace_id", data.workspaceId)
      .order("month", { ascending: false })
      .limit(data.limit ?? 12);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Admin dashboard ───────────────────────────────────────────────────────────

export const getAccountsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const now = new Date();
    const monthStr = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    const [monthCostsRes, alertsRes, rechargesRes, workspacesRes] = await Promise.all([
      supabaseAdmin
        .from("client_monthly_costs")
        .select("workspace_id,monthly_charge_cents,total_cost_cents,gross_profit_cents,gross_margin_percent,voice_cost_cents,llm_cost_cents,telephony_cost_cents,whatsapp_cost_cents,email_cost_cents,video_cost_cents,image_cost_cents")
        .eq("month", monthStr),

      supabaseAdmin
        .from("accountsmind_alerts")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(10),

      supabaseAdmin
        .from("provider_recharge_events")
        .select("*")
        .order("detected_at", { ascending: false })
        .limit(5),

      supabaseAdmin
        .from("workspaces")
        .select("id,name"),
    ]);

    const costs      = monthCostsRes.data  ?? [];
    const workspaces = workspacesRes.data  ?? [];
    const wsMap      = Object.fromEntries(workspaces.map((w: any) => [w.id, w.name]));

    const totalRevenue    = costs.reduce((s: number, c: any) => s + (c.monthly_charge_cents ?? 0), 0);
    const totalCost       = costs.reduce((s: number, c: any) => s + (c.total_cost_cents     ?? 0), 0);
    const totalProfit     = totalRevenue - totalCost;
    const avgMargin       = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 10000) / 100 : 0;

    const costsWithNames  = costs.map((c: any) => ({ ...c, workspace_name: wsMap[c.workspace_id] ?? "Unknown" }));
    const sorted          = [...costsWithNames].sort((a: any, b: any) => b.gross_margin_percent - a.gross_margin_percent);
    const mostProfitable  = sorted[0]  ?? null;
    const leastProfitable = sorted[sorted.length - 1] ?? null;

    const providerTotals: Record<string, number> = {};
    for (const c of costs) {
      const add = (key: string, val: number) => { providerTotals[key] = (providerTotals[key] ?? 0) + val; };
      add("Voice",     c.voice_cost_cents      ?? 0);
      add("LLM/AI",    c.llm_cost_cents        ?? 0);
      add("Telephony", c.telephony_cost_cents  ?? 0);
      add("WhatsApp",  c.whatsapp_cost_cents   ?? 0);
      add("Email",     c.email_cost_cents      ?? 0);
      add("Video",     c.video_cost_cents      ?? 0);
      add("Image",     c.image_cost_cents      ?? 0);
    }
    const mostExpensiveProvider = Object.entries(providerTotals).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "—";

    return {
      totalRevenueCents:    totalRevenue,
      totalCostCents:       totalCost,
      grossProfitCents:     totalProfit,
      avgMarginPercent:     avgMargin,
      mostExpensiveProvider,
      mostProfitableClient: mostProfitable,
      leastProfitableClient:leastProfitable,
      clientCount:          costs.length,
      alerts:               alertsRes.data  ?? [],
      recentRecharges:      rechargesRes.data ?? [],
      clients:              costsWithNames,
      providerTotals,
    };
  });

// ── Profitability list ────────────────────────────────────────────────────────

export const listClientProfitability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const now = new Date();
    const monthStr = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    const [costsRes, profilesRes, workspacesRes] = await Promise.all([
      supabaseAdmin
        .from("client_monthly_costs")
        .select("*")
        .eq("month", monthStr)
        .order("gross_margin_percent", { ascending: true }),
      supabaseAdmin
        .from("client_billing_profiles")
        .select("workspace_id,monthly_charge_cents,currency,status,contract_end_date"),
      supabaseAdmin
        .from("workspaces")
        .select("id,name"),
    ]);

    const wsMap = Object.fromEntries((workspacesRes.data ?? []).map((w: any) => [w.id, w.name]));
    const profMap = Object.fromEntries((profilesRes.data ?? []).map((p: any) => [p.workspace_id, p]));

    return (costsRes.data ?? []).map((c: any) => ({
      ...c,
      workspace_name: wsMap[c.workspace_id] ?? "Unknown",
      billing_profile: profMap[c.workspace_id] ?? null,
    }));
  });

// ── Clients list ──────────────────────────────────────────────────────────────

export const listAccountsClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const [workspacesRes, profilesRes, settingsRes] = await Promise.all([
      supabaseAdmin.from("workspaces").select("id,name,created_at"),
      supabaseAdmin.from("client_billing_profiles").select("*"),
      supabaseAdmin.from("workspace_settings").select("workspace_id,industry"),
    ]);

    const profMap = Object.fromEntries(
      (profilesRes.data ?? []).map((p: any) => [p.workspace_id, p]),
    );
    const industryMap = Object.fromEntries(
      ((settingsRes.data ?? []) as any[]).map((s: any) => [s.workspace_id, s.industry ?? null]),
    );

    return (workspacesRes.data ?? []).map((w: any) => ({
      ...w,
      billing_profile: profMap[w.id] ?? null,
      industry: industryMap[w.id] ?? null,
    }));
  });

// ── Admin: set a client's industry ───────────────────────────────────────────

export const setClientIndustry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { workspaceId: string; industryKey: string }) => input)
  .handler(async ({ data }) => {
    const { setWorkspaceIndustryServer } = await import("@/lib/accountsmind/industry.server");
    await setWorkspaceIndustryServer(data.workspaceId, data.industryKey);
    return { ok: true };
  });

// ── Client detail ─────────────────────────────────────────────────────────────

export const getClientDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { workspaceId: string }) => input)
  .handler(async ({ data }) => {
    const now = new Date();
    const monthStr = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    const [wsRes, profileRes, currentCostRes, historyRes, alertsRes] = await Promise.all([
      supabaseAdmin.from("workspaces").select("id,name,created_at").eq("id", data.workspaceId).maybeSingle(),
      supabaseAdmin.from("client_billing_profiles").select("*").eq("workspace_id", data.workspaceId).maybeSingle(),
      supabaseAdmin.from("client_monthly_costs").select("*").eq("workspace_id", data.workspaceId).eq("month", monthStr).maybeSingle(),
      supabaseAdmin.from("client_monthly_costs").select("*").eq("workspace_id", data.workspaceId).order("month", { ascending: false }).limit(12),
      supabaseAdmin.from("accountsmind_alerts").select("*").eq("workspace_id", data.workspaceId).eq("status", "open").order("created_at", { ascending: false }).limit(5),
    ]);

    return {
      workspace:      wsRes.data,
      billingProfile: profileRes.data,
      currentMonth:   currentCostRes.data,
      history:        historyRes.data ?? [],
      alerts:         alertsRes.data  ?? [],
    };
  });

// ── Provider recharge events ──────────────────────────────────────────────────

export const listProviderRecharges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input?: { limit?: number; workspaceId?: string }) => input ?? {})
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("provider_recharge_events")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(data?.limit ?? 50);
    if (data?.workspaceId) q = q.eq("workspace_id", data.workspaceId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordProviderRecharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(
    (input: {
      providerCategory: string;
      providerName:     string;
      workspaceId?:     string | null;
      amountCents:      number;
      currency:         string;
      eventType:        string;
      description:      string;
      detectedAt:       string;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("provider_recharge_events").insert({
      provider_category: data.providerCategory,
      provider_name:     data.providerName,
      workspace_id:      data.workspaceId ?? null,
      amount_cents:      data.amountCents,
      currency:          data.currency,
      event_type:        data.eventType,
      description:       data.description,
      source:            "manual",
      detected_at:       data.detectedAt,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Alerts ────────────────────────────────────────────────────────────────────

export const listAccountsAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input?: { status?: string; severity?: string }) => input ?? {})
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("accountsmind_alerts")
      .select("*, workspaces(name)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data?.status)   q = q.eq("status", data.status);
    if (data?.severity) q = q.eq("severity", data.severity);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const resolveAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: { alertId: string }) => input)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("accountsmind_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", data.alertId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── AccountsMind scan (compute all workspaces this month) ─────────────────────

export const runAccountsMindScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { data: workspaces } = await supabaseAdmin
      .from("workspaces")
      .select("id,name");

    const results: Array<{ workspaceId: string; ok: boolean; error?: string }> = [];

    for (const ws of workspaces ?? []) {
      try {
        const breakdown = await computeClientMonthlyCost(ws.id);
        await upsertClientMonthlyCost(breakdown);
        await generateAccountsMindAlerts(ws.id, breakdown, ws.name);
        results.push({ workspaceId: ws.id, ok: true });
      } catch (err: any) {
        results.push({ workspaceId: ws.id, ok: false, error: err.message });
      }
    }

    return { results, scanned: workspaces?.length ?? 0 };
  });

// ── Costs page — aggregate provider usage ────────────────────────────────────

export const getProviderCostSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [{ data: rows }, { data: buildRows }] = await Promise.all([
      supabaseAdmin
        .from("provider_usage_log")
        .select("provider_category,provider_name,cost_usd")
        .gte("created_at", start),
      // SystemMind Build Workspace prompt generations (AI model spend)
      supabaseAdmin
        .from("growthmind_generation_logs")
        .select("task_type,provider,model,estimated_cost_usd")
        .eq("task_type", "systemmind_build_workspace")
        .gte("created_at", start),
    ]);

    const totals: Record<string, number> = {};
    for (const r of rows ?? []) {
      const key = `${r.provider_category}::${r.provider_name}`;
      totals[key] = (totals[key] ?? 0) + Math.round((r.cost_usd ?? 0) * 100);
    }
    for (const r of (buildRows ?? []) as any[]) {
      const key = `systemmind build::${r.provider ?? "ai"}/${r.model ?? "model"}`;
      totals[key] = (totals[key] ?? 0) + Math.round((r.estimated_cost_usd ?? 0) * 100);
    }

    return Object.entries(totals)
      .map(([key, cents]) => {
        const [category, provider] = key.split("::");
        return { category, provider, costCents: cents };
      })
      .sort((a, b) => b.costCents - a.costCents);
  });
