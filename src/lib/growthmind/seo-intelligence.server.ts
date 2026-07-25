/**
 * SEO Intelligence cores — shared analysis over synced Search Console data.
 *
 * Consumed by: GrowthMind SEO server fns (Strategy Centre UI), Mind tool
 * registry typed actions, and the blog campaign engine. All functions read the
 * server-synced growthmind_gsc_* tables — they never invent metrics. When the
 * property is baseline-pending (Google still processing), every analysis
 * returns zero records plus an explicit limitation.
 *
 * Every core returns the standard SEO execution envelope (§3 master programme).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SeoEnvelope<T = Record<string, unknown>> = {
  success: boolean;
  property: string | null;
  dateRange: { start: string | null; end: string | null };
  recordsAnalysed: number;
  evidence: Record<string, unknown>;
  deliverables: T;
  limitations: string[];
  warnings: string[];
  requiredApprovals: string[];
  blockedReason: string | null;
  retryable: boolean;
  nextAction: string | null;
  cost: string;
};

export async function getSyncStateForWorkspace(workspaceId: string): Promise<{
  propertyUrl: string | null;
  state: any | null;
  connected: boolean;
}> {
  const admin = supabaseAdmin as any;
  const { data: settings } = await admin
    .from("workspace_settings")
    .select("gsc_property_url, gsc_access_token, gsc_refresh_token, gsc_token_expiry")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const propertyUrl = settings?.gsc_property_url ?? null;
  let state: any = null;
  if (propertyUrl) {
    const { data } = await admin
      .from("growthmind_gsc_sync_state")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("property_url", propertyUrl)
      .maybeSingle();
    state = data ?? null;
  }
  return { propertyUrl, state, connected: !!settings?.gsc_access_token };
}

function baseEnvelope(propertyUrl: string | null, state: any): Omit<SeoEnvelope, "deliverables"> {
  const limitations: string[] = [];
  if (!propertyUrl) limitations.push("No Search Console property selected.");
  if (state?.baseline_pending) {
    limitations.push(
      "Google is still processing performance data for this newly verified property — analyses run on zero rows until the baseline arrives. This is not a connection failure.",
    );
  }
  return {
    success: true,
    property: propertyUrl,
    dateRange: {
      start: state?.requested_start_date ?? null,
      end: state?.requested_end_date ?? null,
    },
    recordsAnalysed: 0,
    evidence: {
      lastSyncedAt: state?.last_synced_at ?? null,
      rowsImported: state?.rows_imported ?? 0,
      syncStatus: state?.status ?? "never_synced",
      lastCompleteGoogleDate: state?.last_complete_date ?? null,
    },
    limitations,
    warnings: (state?.warnings as string[]) ?? [],
    requiredApprovals: [],
    blockedReason: null,
    retryable: true,
    nextAction: state?.baseline_pending
      ? "Wait for Google to publish performance rows (incremental sync is scheduled daily)."
      : null,
    cost: "none",
  };
}

type PerfRow = {
  date: string;
  dimension: string;
  dim_key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

async function loadPerf(workspaceId: string, propertyUrl: string, dimension: string, days = 90): Promise<PerfRow[]> {
  const admin = supabaseAdmin as any;
  const since = new Date(Date.now() - days * 86400_000).toISOString().split("T")[0];
  const out: PerfRow[] = [];
  // page past PostgREST 1000-row cap
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("growthmind_gsc_performance")
      .select("date, dimension, dim_key, clicks, impressions, ctr, position")
      .eq("workspace_id", workspaceId)
      .eq("property_url", propertyUrl)
      .eq("dimension", dimension)
      .gte("date", since)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Agg = {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  trend: "growing" | "declining" | "flat" | "insufficient_data";
  firstHalf: { clicks: number; impressions: number };
  secondHalf: { clicks: number; impressions: number };
};

function aggregate(rows: PerfRow[]): Agg[] {
  if (rows.length === 0) return [];
  const dates = rows.map((r) => r.date).sort();
  const mid = dates[Math.floor(dates.length / 2)];
  const byKey = new Map<string, { c: number; i: number; posW: number; posI: number; c1: number; i1: number; c2: number; i2: number }>();
  for (const r of rows) {
    const a = byKey.get(r.dim_key) ?? { c: 0, i: 0, posW: 0, posI: 0, c1: 0, i1: 0, c2: 0, i2: 0 };
    a.c += r.clicks; a.i += r.impressions;
    if (r.position != null) { a.posW += r.position * r.impressions; a.posI += r.impressions; }
    if (r.date < mid) { a.c1 += r.clicks; a.i1 += r.impressions; } else { a.c2 += r.clicks; a.i2 += r.impressions; }
    byKey.set(r.dim_key, a);
  }
  return [...byKey.entries()].map(([key, a]) => {
    let trend: Agg["trend"] = "insufficient_data";
    if (a.i1 + a.i2 >= 20) {
      const delta = a.i1 > 0 ? (a.i2 - a.i1) / a.i1 : a.i2 > 0 ? 1 : 0;
      trend = delta > 0.25 ? "growing" : delta < -0.25 ? "declining" : "flat";
    }
    return {
      key,
      clicks: a.c,
      impressions: a.i,
      ctr: a.i > 0 ? a.c / a.i : 0,
      position: a.posI > 0 ? a.posW / a.posI : null,
      trend,
      firstHalf: { clicks: a.c1, impressions: a.i1 },
      secondHalf: { clicks: a.c2, impressions: a.i2 },
    };
  }).sort((x, y) => y.impressions - x.impressions);
}

export async function analyseDimension(
  workspaceId: string,
  dimension: "query" | "page" | "country" | "device" | "search_appearance",
  opts?: { days?: number; limit?: number },
): Promise<SeoEnvelope<{ items: Agg[] }>> {
  const { propertyUrl, state } = await getSyncStateForWorkspace(workspaceId);
  const env = baseEnvelope(propertyUrl, state);
  if (!propertyUrl) return { ...env, success: false, blockedReason: "No property selected", deliverables: { items: [] } };
  const rows = await loadPerf(workspaceId, propertyUrl, dimension, opts?.days ?? 90);
  const items = aggregate(rows).slice(0, opts?.limit ?? 200);
  return {
    ...env,
    recordsAnalysed: rows.length,
    evidence: { ...env.evidence, rawRows: rows.length, distinctKeys: items.length, dimension },
    deliverables: { items },
  };
}

// ── Opportunity detectors ─────────────────────────────────────────────────────

export type SeoOpportunity = {
  kind: string;
  key: string;
  metric: Record<string, number | string | null>;
  rationale: string;
  recommendedAction: string;
  confidence: "high" | "medium" | "low";
};

export async function detectOpportunities(
  workspaceId: string,
  kinds?: string[],
): Promise<SeoEnvelope<{ opportunities: SeoOpportunity[] }>> {
  const { propertyUrl, state } = await getSyncStateForWorkspace(workspaceId);
  const env = baseEnvelope(propertyUrl, state);
  if (!propertyUrl) return { ...env, success: false, blockedReason: "No property selected", deliverables: { opportunities: [] } };

  const [queryRows, pageRows] = await Promise.all([
    loadPerf(workspaceId, propertyUrl, "query"),
    loadPerf(workspaceId, propertyUrl, "page"),
  ]);
  const queries = aggregate(queryRows);
  const pages = aggregate(pageRows);
  const want = (k: string) => !kinds || kinds.length === 0 || kinds.includes(k);
  const ops: SeoOpportunity[] = [];

  for (const q of queries) {
    if (want("high_impression_low_click") && q.impressions >= 100 && q.clicks <= 2) {
      ops.push({ kind: "high_impression_low_click", key: q.key, metric: { impressions: q.impressions, clicks: q.clicks, position: q.position }, rationale: "Significant impressions but almost no clicks.", recommendedAction: "Improve title/meta description relevance or content match for this query.", confidence: "high" });
    }
    if (want("low_ctr") && q.impressions >= 50 && q.ctr < 0.01 && q.position != null && q.position <= 20) {
      ops.push({ kind: "low_ctr", key: q.key, metric: { ctr: +(q.ctr * 100).toFixed(2), impressions: q.impressions, position: q.position }, rationale: "CTR below 1% despite a visible ranking.", recommendedAction: "Rework metadata and snippet appeal (create_metadata_campaign).", confidence: "medium" });
    }
    if (want("near_page_one") && q.position != null && q.position > 10 && q.position <= 20 && q.impressions >= 30) {
      ops.push({ kind: "near_page_one", key: q.key, metric: { position: +q.position.toFixed(1), impressions: q.impressions }, rationale: "Ranking on page two with meaningful impressions.", recommendedAction: "Strengthen the ranking page (content depth + internal links) to cross onto page one.", confidence: "medium" });
    }
    if (want("declining_query") && q.trend === "declining") {
      ops.push({ kind: "declining_query", key: q.key, metric: { firstHalfImpressions: q.firstHalf.impressions, secondHalfImpressions: q.secondHalf.impressions }, rationale: "Impressions dropped >25% between the two halves of the window.", recommendedAction: "Refresh the target content (create_content_refresh_campaign).", confidence: "medium" });
    }
    if (want("growing_query") && q.trend === "growing") {
      ops.push({ kind: "growing_query", key: q.key, metric: { firstHalfImpressions: q.firstHalf.impressions, secondHalfImpressions: q.secondHalf.impressions }, rationale: "Impressions grew >25% between the two halves of the window.", recommendedAction: "Capitalise with expanded content targeting this query cluster.", confidence: "medium" });
    }
  }
  for (const p of pages) {
    if (want("declining_page") && p.trend === "declining") {
      ops.push({ kind: "declining_page", key: p.key, metric: { firstHalfImpressions: p.firstHalf.impressions, secondHalfImpressions: p.secondHalf.impressions }, rationale: "Page impressions dropped >25% across the window.", recommendedAction: "Run an existing-page improvement campaign.", confidence: "medium" });
    }
  }

  // Cannibalisation: pages sharing top queries — approximate via query aggregation
  // requires query+page combined dimension which GSC returns separately; flag as limitation.
  const limitations = [...env.limitations];
  if (want("keyword_cannibalisation")) {
    limitations.push("Cannibalisation detection compares campaign topics against page-level data; per-query page splits require a combined query+page sync which is scheduled with sufficient data volume.");
  }

  return {
    ...env,
    recordsAnalysed: queryRows.length + pageRows.length,
    evidence: { ...env.evidence, distinctQueries: queries.length, distinctPages: pages.length },
    deliverables: { opportunities: ops },
    limitations,
    nextAction: ops.length > 0 ? "Convert selected opportunities into SEO campaigns via create_seo_campaign." : env.nextAction,
  };
}

// ── Sitemap + inspection reads ────────────────────────────────────────────────

export async function auditSitemaps(workspaceId: string): Promise<SeoEnvelope<{ sitemaps: any[] }>> {
  const { propertyUrl, state } = await getSyncStateForWorkspace(workspaceId);
  const env = baseEnvelope(propertyUrl, state);
  if (!propertyUrl) return { ...env, success: false, blockedReason: "No property selected", deliverables: { sitemaps: [] } };
  const admin = supabaseAdmin as any;
  const { data } = await admin
    .from("growthmind_gsc_sitemaps")
    .select("path, last_submitted, last_downloaded, is_pending, is_index, errors, warnings, fetched_at")
    .eq("workspace_id", workspaceId)
    .eq("property_url", propertyUrl);
  const sitemaps = data ?? [];
  const limitations = [...env.limitations];
  if (sitemaps.length === 0) limitations.push("No sitemaps have been submitted to Search Console for this property. Submitting one requires approval (submit_approved_sitemap).");
  return {
    ...env,
    recordsAnalysed: sitemaps.length,
    deliverables: { sitemaps },
    limitations,
    requiredApprovals: sitemaps.length === 0 ? ["sitemap_submission"] : [],
    nextAction: sitemaps.length === 0 ? "Prepare and approve a sitemap submission." : null,
  };
}

export async function listStoredInspections(workspaceId: string): Promise<any[]> {
  const admin = supabaseAdmin as any;
  const { data } = await admin
    .from("growthmind_gsc_inspections")
    .select("url, verdict, coverage_state, robots_txt_state, indexing_state, last_crawl_time, google_canonical, user_canonical, inspected_at")
    .eq("workspace_id", workspaceId)
    .order("inspected_at", { ascending: false })
    .limit(100);
  return data ?? [];
}
