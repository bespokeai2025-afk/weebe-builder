/**
 * Conversion diagnosis — combined Ads + SEO + Clarity + conversion evidence.
 *
 * Answers "why are visitors not converting?" from real data only:
 *  - Google Ads spend/clicks/conversions from synced growthmind_gads_campaign_daily
 *  - Search Console clicks/impressions from synced growthmind_gsc_performance
 *  - Microsoft Clarity behavioural signals from clarity_metrics_daily
 *  - Outcomes from the conversion_events ledger
 *
 * Every section is either populated from real rows or reported as an explicit
 * limitation ("not connected / no data") — never estimated or invented.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

export interface ConversionDiagnosis {
  windowDays: number;
  conversions: {
    available: boolean;
    total: number;
    recent: number;
    prior: number;
    trendPct: number | null;
    byLandingPath: Array<{ path: string; recent: number; prior: number }>;
    limitation?: string;
  };
  ads: {
    available: boolean;
    costMicros: number;
    clicks: number;
    impressions: number;
    reportedConversions: number;
    limitation?: string;
  };
  seo: {
    available: boolean;
    clicks: number;
    impressions: number;
    limitation?: string;
  };
  behaviour: {
    available: boolean;
    daysCovered: number;
    problemPages: Array<{ url: string; sessions: number; deadClicks: number; rageClicks: number; quickbackClicks: number; excessiveScroll: number; days: number }>;
    limitation?: string;
  };
  changeQueue: Array<{ id: string; title: string; page_url: string; change_type: string; status: string; score: number }>;
  findings: string[];
  limitations: string[];
}

function pathOf(url: string): string {
  try { return new URL(url).pathname.replace(/\/$/, "") || "/"; }
  catch { return url.startsWith("/") ? url.replace(/\/$/, "") || "/" : url; }
}

export async function buildConversionDiagnosis(workspaceId: string, days: number): Promise<ConversionDiagnosis> {
  const now = Date.now();
  const sinceIso = new Date(now - days * 86400_000).toISOString();
  const priorIso = new Date(now - 2 * days * 86400_000).toISOString();
  const sinceDate = sinceIso.slice(0, 10);
  const midIso = sinceIso;

  const [convRes, adsRes, seoRes, clarityRes, queueRes] = await Promise.all([
    sb.from("conversion_events")
      .select("landing_url, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", priorIso)
      .limit(5000),
    sb.from("growthmind_gads_campaign_daily")
      .select("cost_micros, clicks, impressions, conversions")
      .eq("workspace_id", workspaceId)
      .gte("date", sinceDate)
      .limit(2000),
    sb.from("growthmind_gsc_performance")
      .select("clicks, impressions")
      .eq("workspace_id", workspaceId)
      .eq("dimension", "page")
      .gte("date", sinceDate)
      .limit(5000),
    sb.from("clarity_metrics_daily")
      .select("metric_date, url, device, sessions, metrics")
      .eq("workspace_id", workspaceId)
      .gte("metric_date", sinceDate)
      .limit(5000),
    sb.from("website_change_queue")
      .select("id, title, page_url, change_type, status, score")
      .eq("workspace_id", workspaceId)
      .in("status", ["open", "executing", "handled"])
      .order("score", { ascending: false })
      .limit(10),
  ]);

  const limitations: string[] = [];
  const findings: string[] = [];

  // Conversions
  const convRows: any[] = convRes.data ?? [];
  const recent = convRows.filter((r) => r.created_at >= midIso);
  const prior = convRows.filter((r) => r.created_at < midIso);
  const byPath = new Map<string, { recent: number; prior: number }>();
  for (const r of convRows) {
    if (!r.landing_url) continue;
    const p = pathOf(String(r.landing_url));
    const b = byPath.get(p) ?? { recent: 0, prior: 0 };
    if (r.created_at >= midIso) b.recent++; else b.prior++;
    byPath.set(p, b);
  }
  const trendPct = prior.length > 0 ? Math.round(((recent.length - prior.length) / prior.length) * 100) : null;
  const conversions = {
    available: convRows.length > 0,
    total: convRows.length,
    recent: recent.length,
    prior: prior.length,
    trendPct,
    byLandingPath: [...byPath.entries()].map(([path, v]) => ({ path, ...v })).sort((a, b) => b.recent + b.prior - (a.recent + a.prior)).slice(0, 20),
    ...(convRows.length === 0 ? { limitation: "No conversion events recorded in the window — conversion tracking may not be receiving events." } : {}),
  };
  if (convRows.length === 0) limitations.push("No conversion_events rows in the window.");
  else if (trendPct != null && trendPct < -10) findings.push(`Conversions are down ${Math.abs(trendPct)}% vs the prior ${days}-day period (${recent.length} vs ${prior.length}).`);

  // Ads
  const adsRows: any[] = adsRes.data ?? [];
  const ads = {
    available: adsRows.length > 0,
    costMicros: adsRows.reduce((s, r) => s + Number(r.cost_micros || 0), 0),
    clicks: adsRows.reduce((s, r) => s + Number(r.clicks || 0), 0),
    impressions: adsRows.reduce((s, r) => s + Number(r.impressions || 0), 0),
    reportedConversions: adsRows.reduce((s, r) => s + Number(r.conversions || 0), 0),
    ...(adsRows.length === 0 ? { limitation: "No synced Google Ads daily rows — Google Ads may not be connected or synced." } : {}),
  };
  if (adsRows.length === 0) limitations.push("Google Ads data unavailable (not connected or not synced).");
  else if (ads.clicks > 0 && conversions.recent === 0) findings.push(`Google Ads delivered ${ads.clicks} clicks in the window but zero conversions were recorded — check landing pages and tracking.`);

  // SEO
  const seoRows: any[] = seoRes.data ?? [];
  const seo = {
    available: seoRows.length > 0,
    clicks: seoRows.reduce((s, r) => s + Number(r.clicks || 0), 0),
    impressions: seoRows.reduce((s, r) => s + Number(r.impressions || 0), 0),
    ...(seoRows.length === 0 ? { limitation: "No synced Search Console rows — GSC may not be connected, or data is still processing." } : {}),
  };
  if (seoRows.length === 0) limitations.push("Search Console data unavailable.");

  // Behaviour (Clarity)
  const clarityRows: any[] = clarityRes.data ?? [];
  let behaviour: ConversionDiagnosis["behaviour"];
  if (clarityRows.length === 0) {
    behaviour = { available: false, daysCovered: 0, problemPages: [], limitation: "Microsoft Clarity not connected or no behavioural data synced yet (Clarity's API exposes only the last 1-3 days per request; history accumulates daily)." };
    limitations.push("Clarity behavioural data unavailable.");
  } else {
    const { aggregateClaritySignals } = await import("@/lib/growthmind/clarity-sync-core");
    const signals = aggregateClaritySignals(clarityRows);
    const daysCovered = new Set(clarityRows.map((r) => r.metric_date)).size;
    const problemPages = signals
      .map((s) => ({ url: s.url, sessions: s.sessions, deadClicks: s.deadClicks, rageClicks: s.rageClicks, quickbackClicks: s.quickbackClicks, excessiveScroll: s.excessiveScroll, days: s.days }))
      .sort((a, b) => (b.deadClicks + b.rageClicks + b.quickbackClicks) - (a.deadClicks + a.rageClicks + a.quickbackClicks))
      .slice(0, 15);
    behaviour = { available: true, daysCovered, problemPages };
    const worst = problemPages[0];
    if (worst && worst.deadClicks + worst.rageClicks >= 10) {
      findings.push(`Highest-friction page: ${worst.url} (${worst.deadClicks} dead clicks, ${worst.rageClicks} rage clicks, ${worst.quickbackClicks} quick-backs across ${worst.sessions} sessions on ${worst.days} days).`);
    }
  }

  const changeQueue = (queueRes.data ?? []) as ConversionDiagnosis["changeQueue"];
  if (changeQueue.length > 0) findings.push(`${changeQueue.length} evidence-backed website change recommendation(s) are in the Website Change Queue (approval-first, manual deployment).`);
  if (findings.length === 0) findings.push("No strong conversion-blocking signal found in the available data — see limitations for missing sources.");

  return { windowDays: days, conversions, ads, seo, behaviour, changeQueue, findings, limitations };
}
