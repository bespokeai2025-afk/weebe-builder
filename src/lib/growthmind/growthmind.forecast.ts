import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ───────────────────────────────────────────────────────────────────────

export type WeekBucket = {
  label:     string;
  weekStart: string;
  leads:     number;
  bookings:  number;
  sales:     number;
};

export type ForecastPoint = {
  label:        string;
  weekStart:    string;
  isActual:     boolean;
  leads:        number | null;
  bookings:     number | null;
  sales:        number | null;
  leadsConserv: number | null;
  leadsBase:    number | null;
  leadsOpt:     number | null;
  booksConserv: number | null;
  booksBase:    number | null;
  booksOpt:     number | null;
  salesConserv: number | null;
  salesBase:    number | null;
  salesOpt:     number | null;
};

export type ForecastSummary = {
  leadsConserv:   number;
  leadsBase:      number;
  leadsOpt:       number;
  booksConserv:   number;
  booksBase:      number;
  booksOpt:       number;
  salesConserv:   number;
  salesBase:      number;
  salesOpt:       number;
  revConserv:     number;
  revBase:        number;
  revOpt:         number;
};

export type ForecastResult = {
  actuals:  WeekBucket[];
  forecast: ForecastPoint[];
  summary:  ForecastSummary;
};

export type SavedForecast = {
  id:          string;
  scenario:    "conservative" | "base" | "optimistic";
  periodWeeks: number;
  dealValue:   number;
  currency:    string;
  summary:     ForecastSummary;
  buckets:     ForecastPoint[];
  createdAt:   string;
};

// ── Pure computation helpers ────────────────────────────────────────────────────

function weekLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

/** Simple OLS linear regression — returns { slope, intercept } */
function linearRegression(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  const xs = ys.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope     = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return { slope, intercept };
}

function projectWeeks(
  reg: { slope: number; intercept: number },
  startIdx: number,
  weeks: number,
  multiplier: number,
): number[] {
  return Array.from({ length: weeks }, (_, i) => {
    const raw = reg.intercept + reg.slope * (startIdx + i);
    return Math.max(0, Math.round(raw * multiplier));
  });
}

/** Compute weekly buckets from raw CRM data (last 90 days = ~13 weeks) */
export function computeWeeklyBuckets(rawData: any): WeekBucket[] {
  if (!rawData) return [];

  const now       = Date.now();
  const MS_WEEK   = 7 * 24 * 60 * 60 * 1000;
  const since90   = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

  const leads    = (rawData.__rawLeads    ?? []) as any[];
  // __rawSales contains sale_done leads queried by updated_at (captures
  // conversions from leads created before the 90-day window).
  const sales    = (rawData.__rawSales    ?? []) as any[];
  const bookings = (rawData.__rawBookings ?? []) as any[];

  const NUM_WEEKS = 13;
  const buckets: WeekBucket[] = [];

  for (let i = NUM_WEEKS - 1; i >= 0; i--) {
    const end   = new Date(now - i * MS_WEEK);
    const start = new Date(end.getTime() - MS_WEEK);
    const s     = start.toISOString();
    const e     = end.toISOString();

    buckets.push({
      label:     weekLabel(start),
      weekStart: s,
      leads:     leads.filter((l: any)    => l.created_at  >= s && l.created_at  < e).length,
      bookings:  bookings.filter((b: any) => b.created_at  >= s && b.created_at  < e).length,
      // Sales bucketed by updated_at (conversion date), not created_at
      sales:     sales.filter((l: any)    => l.updated_at  >= s && l.updated_at  < e).length,
    });
  }

  return buckets;
}

/** Linear forecast — 12 weeks ahead, 3 scenarios */
export function linearForecast(buckets: WeekBucket[], dealValue: number): ForecastResult {
  const FORECAST_WEEKS = 12;
  const MULTIPLIERS    = { conservative: 0.8, base: 1.0, optimistic: 1.3 };
  const now            = Date.now();
  const MS_WEEK        = 7 * 24 * 60 * 60 * 1000;

  const leadsY    = buckets.map(b => b.leads);
  const bookingsY = buckets.map(b => b.bookings);
  const salesY    = buckets.map(b => b.sales);

  const leadsReg    = linearRegression(leadsY);
  const bookingsReg = linearRegression(bookingsY);
  const salesReg    = linearRegression(salesY);

  const startIdx = buckets.length;

  const forecast: ForecastPoint[] = Array.from({ length: FORECAST_WEEKS }, (_, i) => {
    const weekStart = new Date(now + (i + 1) * MS_WEEK);
    return {
      label:        weekLabel(weekStart),
      weekStart:    weekStart.toISOString(),
      isActual:     false,
      leads:        null,
      bookings:     null,
      sales:        null,
      leadsConserv: Math.max(0, Math.round((leadsReg.intercept    + leadsReg.slope    * (startIdx + i)) * MULTIPLIERS.conservative)),
      leadsBase:    Math.max(0, Math.round((leadsReg.intercept    + leadsReg.slope    * (startIdx + i)) * MULTIPLIERS.base)),
      leadsOpt:     Math.max(0, Math.round((leadsReg.intercept    + leadsReg.slope    * (startIdx + i)) * MULTIPLIERS.optimistic)),
      booksConserv: Math.max(0, Math.round((bookingsReg.intercept + bookingsReg.slope * (startIdx + i)) * MULTIPLIERS.conservative)),
      booksBase:    Math.max(0, Math.round((bookingsReg.intercept + bookingsReg.slope * (startIdx + i)) * MULTIPLIERS.base)),
      booksOpt:     Math.max(0, Math.round((bookingsReg.intercept + bookingsReg.slope * (startIdx + i)) * MULTIPLIERS.optimistic)),
      salesConserv: Math.max(0, Math.round((salesReg.intercept    + salesReg.slope    * (startIdx + i)) * MULTIPLIERS.conservative)),
      salesBase:    Math.max(0, Math.round((salesReg.intercept    + salesReg.slope    * (startIdx + i)) * MULTIPLIERS.base)),
      salesOpt:     Math.max(0, Math.round((salesReg.intercept    + salesReg.slope    * (startIdx + i)) * MULTIPLIERS.optimistic)),
    };
  });

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  const summary: ForecastSummary = {
    leadsConserv: sum(forecast.map(f => f.leadsConserv!)),
    leadsBase:    sum(forecast.map(f => f.leadsBase!)),
    leadsOpt:     sum(forecast.map(f => f.leadsOpt!)),
    booksConserv: sum(forecast.map(f => f.booksConserv!)),
    booksBase:    sum(forecast.map(f => f.booksBase!)),
    booksOpt:     sum(forecast.map(f => f.booksOpt!)),
    salesConserv: sum(forecast.map(f => f.salesConserv!)),
    salesBase:    sum(forecast.map(f => f.salesBase!)),
    salesOpt:     sum(forecast.map(f => f.salesOpt!)),
    revConserv:   sum(forecast.map(f => f.salesConserv!)) * dealValue,
    revBase:      sum(forecast.map(f => f.salesBase!))    * dealValue,
    revOpt:       sum(forecast.map(f => f.salesOpt!))     * dealValue,
  };

  return { actuals: buckets, forecast, summary };
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getForecastData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Leads by created_at for the new-lead metric.
    // Sales fetched separately by updated_at so conversions from pre-window
    // leads are captured correctly.
    const [leadsRes, salesRes, bookingsRes, settingsRes] = await Promise.all([
      sb.from("leads")
        .select("id, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since90)
        .limit(5000),
      sb.from("leads")
        .select("id, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "sale_done")
        .gte("updated_at", since90)
        .limit(5000),
      sb.from("calendar_bookings")
        .select("id, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since90)
        .limit(1000),
      sb.from("workspace_settings")
        .select("growthmind_settings")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    const rawLeads    = leadsRes.data    ?? [];
    const rawSales    = salesRes.data    ?? [];
    const rawBookings = bookingsRes.data ?? [];
    const gmSettings  = (settingsRes.data?.growthmind_settings ?? {}) as Record<string, any>;

    return {
      __rawLeads:    rawLeads,
      __rawSales:    rawSales,
      __rawBookings: rawBookings,
      dealValue:     Number(gmSettings.dealValue  ?? 0),
      currency:      String(gmSettings.currency   ?? "£"),
    };
  });

export const saveForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      scenario:    z.enum(["conservative", "base", "optimistic"]),
      periodWeeks: z.number().default(12),
      dealValue:   z.number().min(0),
      currency:    z.string().max(10).default("GBP"),
      buckets:     z.array(z.any()),
      summary:     z.any(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb.from("growthmind_forecasts").insert({
      workspace_id: workspaceId,
      scenario:     data.scenario,
      period_weeks: data.periodWeeks,
      deal_value:   data.dealValue,
      currency:     data.currency,
      buckets:      data.buckets,
      summary:      data.summary,
    });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getForecasts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_forecasts")
      .select("id, scenario, period_weeks, deal_value, currency, summary, buckets, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);

    const forecasts: SavedForecast[] = (data ?? []).map((r: any) => ({
      id:          r.id,
      scenario:    r.scenario,
      periodWeeks: r.period_weeks,
      dealValue:   Number(r.deal_value),
      currency:    r.currency,
      summary:     r.summary ?? {},
      buckets:     r.buckets ?? [],
      createdAt:   r.created_at,
    }));

    return { forecasts };
  });

export const saveForecastSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      dealValue: z.number().min(0),
      currency:  z.string().max(10),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: existing } = await sb
      .from("workspace_settings")
      .select("growthmind_settings")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const prev = existing?.growthmind_settings ?? {};
    const next = { ...prev, dealValue: data.dealValue, currency: data.currency };

    const { error } = await sb
      .from("workspace_settings")
      .upsert({ workspace_id: workspaceId, growthmind_settings: next }, { onConflict: "workspace_id" });

    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── AI executive briefing for Forecast ───────────────────────────────────────
export const generateForecastBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const settings = (context as any).settings ?? {};
    const apiKey   = process.env.OPENAI_API_KEY ?? settings.openai_api_key;

    const s14 = new Date(Date.now() - 14 * 86400000).toISOString();
    const s28 = new Date(Date.now() - 28 * 86400000).toISOString();
    const s42 = new Date(Date.now() - 42 * 86400000).toISOString();

    const [recentLeadsRes, prevLeadsRes, salesRes, latestFcRes] = await Promise.all([
      sb.from("leads").select("id").eq("workspace_id", workspaceId).gte("created_at", s14).limit(2000),
      sb.from("leads").select("id").eq("workspace_id", workspaceId).gte("created_at", s28).lt("created_at", s14).limit(2000),
      sb.from("leads").select("id").eq("workspace_id", workspaceId).eq("status", "sale_done").gte("updated_at", s42).limit(1000),
      sb.from("growthmind_forecasts").select("scenario, summary").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const recentLeads = (recentLeadsRes.data ?? []).length;
    const prevLeads   = (prevLeadsRes.data ?? []).length;
    const totalSales  = (salesRes.data ?? []).length;
    const latestFc    = latestFcRes.data;

    const trend    = recentLeads > prevLeads * 1.1 ? "up" : recentLeads < prevLeads * 0.9 ? "down" : "flat";
    const trendPct = prevLeads > 0 ? Math.abs(Math.round(((recentLeads - prevLeads) / prevLeads) * 100)) : 0;
    const allLeads = recentLeads + prevLeads;
    const convRate = allLeads > 0 ? totalSales / allLeads : 0;

    const score = Math.min(100, Math.max(10, Math.round(
      50 +
      (trend === "up" ? 20 : trend === "down" ? -15 : 0) +
      (convRate >= 0.1 ? 15 : convRate >= 0.05 ? 8 : 0) +
      (allLeads >= 50 ? 15 : allLeads >= 20 ? 8 : 0)
    )));

    const dir      = trend === "up" ? `up ${trendPct}%` : trend === "down" ? `down ${trendPct}%` : "steady";
    const fallback = `Lead volume is ${dir} vs the previous 14-day period (${recentLeads} vs ${prevLeads} leads). ${totalSales} sales recorded over 6 weeks at a ${(convRate * 100).toFixed(1)}% conversion rate.`;

    if (!apiKey) return { briefing: fallback, trend, score };

    const fcNote = latestFc?.summary
      ? `Saved forecast (${latestFc.scenario}): ${latestFc.summary.leadsBase ?? "N/A"} base leads and ${latestFc.summary.salesBase ?? "N/A"} base sales projected over 12 weeks.`
      : "No forecast snapshot saved yet.";

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model:    "gpt-4o-mini",
          messages: [{
            role:    "user",
            content: `You are GrowthMind, an AI Chief Marketing Officer. Write a 2-sentence executive briefing about this business's lead & sales forecast. Be specific with numbers and provide one concrete next action.\n\nData:\n- Last 14 days: ${recentLeads} leads\n- Previous 14 days: ${prevLeads} leads\n- Trend: ${trend} (${trendPct}%)\n- Sales (6-week): ${totalSales}\n- Conversion rate: ${(convRate * 100).toFixed(1)}%\n- ${fcNote}\n\nReturn ONLY the 2-sentence briefing — no preamble, no labels.`,
          }],
          max_tokens:  120,
          temperature: 0.4,
        }),
      });
      if (res.ok) {
        const json = await res.json() as any;
        const text = (json.choices?.[0]?.message?.content as string ?? "").trim();
        if (text) return { briefing: text, trend, score };
      }
    } catch {}

    return { briefing: fallback, trend, score };
  });
