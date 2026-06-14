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
  const bookings = (rawData.__rawBookings ?? []) as any[];
  const sales    = leads.filter((l: any) => l.status === "sale_done");

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

    const [leadsRes, bookingsRes, settingsRes] = await Promise.all([
      sb.from("leads")
        .select("id, status, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since90)
        .limit(5000),
      sb.from("calendar_bookings")
        .select("id, status, created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since90)
        .limit(1000),
      sb.from("workspace_settings")
        .select("growthmind_settings")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    const rawLeads    = leadsRes.data    ?? [];
    const rawBookings = bookingsRes.data ?? [];
    const gmSettings  = (settingsRes.data?.growthmind_settings ?? {}) as Record<string, any>;

    return {
      __rawLeads:    rawLeads,
      __rawBookings: rawBookings,
      dealValue:     Number(gmSettings.dealValue  ?? 0),
      currency:      String(gmSettings.currency   ?? "GBP"),
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
