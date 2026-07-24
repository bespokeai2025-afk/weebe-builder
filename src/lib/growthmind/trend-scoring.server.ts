// ── Trend Scout Scoring Engine ────────────────────────────────────────────────
// SERVER ONLY. Two stages, cheap-first:
//   1. screenTrendItems  — deterministic, free. Computes momentum / freshness /
//      saturation / lifespan and prunes obvious noise (status → screened, or
//      dismissed with a rejection reason).
//   2. scoreTrendItemsWithAI — AI-assisted, gated on Business DNA and only ever
//      user-triggered. Adds relevance / commercial intent / brand fit /
//      originality / risk components + total opportunity score. Cost of every
//      AI run is logged to growthmind_discovery_runs (run_kind = 'scoring').

import { getTrendAdminClient } from "./trend-discovery.server";

// ── Deterministic components ───────────────────────────────────────────────────

type TrendRow = {
  id: string; platform: string; title: string | null; caption: string | null;
  media_type: string | null; author_handle: string | null; author_name: string | null;
  published_at: string | null; discovered_at: string; metrics: any; scores: any; status: string;
  url: string | null; raw: any;
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// Momentum: engagement normalised per platform (0-100).
function momentumScore(row: TrendRow): number {
  const m = row.metrics ?? {};
  switch (row.platform) {
    case "instagram": {
      if (m.engagementRate != null) return clamp(Number(m.engagementRate) * 20); // 5% ER = 100
      const eng = (Number(m.likes) || 0) + (Number(m.comments) || 0) * 3;
      return clamp(Math.log10(eng + 1) * 25);
    }
    case "facebook": {
      const eng = (Number(m.reactions) || 0) + (Number(m.comments) || 0) * 2 + (Number(m.shares) || 0) * 4;
      return clamp(Math.log10(eng + 1) * 25);
    }
    case "youtube":
      return m.views != null ? clamp(Math.log10(Number(m.views) + 1) * 16) : 40;
    case "reddit": {
      const eng = (Number(m.upvotes) || 0) + (Number(m.comments) || 0) * 2;
      return clamp(Math.log10(eng + 1) * 22);
    }
    case "google_trends": {
      const t = String(m.approxTraffic ?? "").replace(/[+,.]/g, "");
      const n = Number(t.replace(/K/i, "000").replace(/M/i, "000000")) || 0;
      return clamp(Math.log10(n + 1) * 15 + (m.matchesWatchedTopic ? 20 : 0));
    }
    case "internal": {
      const pct = Math.abs(Number(m.changePercent) || 0);
      return clamp(30 + pct / 2);
    }
    case "meta_ad_library": return 55; // active competitor ad = meaningful signal
    case "news":            return 45;
    default:                return 30;
  }
}

// Freshness: exponential decay by age (platform half-lives differ).
const HALF_LIFE_DAYS: Record<string, number> = {
  google_trends: 1.5, news: 2, reddit: 3, instagram: 5, facebook: 5,
  meta_ad_library: 10, youtube: 10, internal: 7,
};
function freshnessScore(row: TrendRow): number {
  const ref = row.published_at ?? row.discovered_at;
  const ageDays = Math.max(0, (Date.now() - new Date(ref).getTime()) / 86400000);
  const hl = HALF_LIFE_DAYS[row.platform] ?? 5;
  return clamp(100 * Math.pow(0.5, ageDays / hl));
}

// Saturation: how many other items in this workspace share dominant keywords —
// crowded = lower originality headroom (returned as 0-100 where high = saturated).
function keywordsOf(row: TrendRow): string[] {
  const text = `${row.title ?? ""} ${row.caption ?? ""}`.toLowerCase();
  return [...new Set(text.split(/[^a-z0-9#]+/).filter(w => w.length > 4))].slice(0, 12);
}
function saturationScore(row: TrendRow, all: TrendRow[]): number {
  const kws = keywordsOf(row);
  if (kws.length === 0) return 20;
  let overlaps = 0;
  for (const other of all) {
    if (other.id === row.id) continue;
    const otherText = `${other.title ?? ""} ${other.caption ?? ""}`.toLowerCase();
    if (kws.filter(k => otherText.includes(k)).length >= 3) overlaps++;
  }
  return clamp(overlaps * 12);
}

// Estimated useful lifespan in days (how long the trend is actionable).
function lifespanDays(row: TrendRow): number {
  const base: Record<string, number> = {
    google_trends: 3, news: 5, reddit: 7, instagram: 14, facebook: 14,
    meta_ad_library: 30, youtube: 45, internal: 30,
  };
  return base[row.platform] ?? 14;
}

export type DeterministicScores = {
  momentum: number; freshness: number; saturation: number; lifespanDays: number; prescreen: number;
};

export function computeDeterministicScores(row: TrendRow, all: TrendRow[]): DeterministicScores {
  const momentum  = momentumScore(row);
  const freshness = freshnessScore(row);
  const saturation = saturationScore(row, all);
  // Prescreen: is this worth AI budget at all?
  const prescreen = clamp(momentum * 0.55 + freshness * 0.35 + (100 - saturation) * 0.10);
  return { momentum, freshness, saturation, lifespanDays: lifespanDays(row), prescreen };
}

// ── Stage 1: deterministic screening ──────────────────────────────────────────

const PRESCREEN_MIN = 25;

export async function screenTrendItems(workspaceId: string): Promise<{ screened: number; rejected: number }> {
  const admin = getTrendAdminClient() as any;
  const { data, error } = await admin
    .from("growthmind_trend_items")
    .select("id, platform, title, caption, media_type, author_handle, author_name, published_at, discovered_at, metrics, scores, status, url, raw")
    .eq("workspace_id", workspaceId)
    .in("status", ["discovered", "screened"])
    .order("discovered_at", { ascending: false })
    .limit(400);
  if (error) throw new Error(`Load items for screening failed: ${error.message}`);
  const rows: TrendRow[] = data ?? [];

  let screened = 0, rejected = 0;
  for (const row of rows) {
    const det = computeDeterministicScores(row, rows);
    const passes = det.prescreen >= PRESCREEN_MIN;
    const scores = {
      ...(row.scores ?? {}),
      momentum:     det.momentum,
      freshness:    det.freshness,
      saturation:   det.saturation,
      lifespanDays: det.lifespanDays,
      prescreen:    det.prescreen,
      ...(passes ? {} : { rejectionReason: `Prescreen ${det.prescreen}/100 below minimum ${PRESCREEN_MIN} — weak momentum or too old.` }),
    };
    const { error: upErr } = await admin
      .from("growthmind_trend_items")
      .update({
        scores,
        status: passes ? "screened" : "dismissed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (upErr) throw new Error(`Screening update failed: ${upErr.message}`);
    if (passes) screened++; else rejected++;
  }
  return { screened, rejected };
}

// ── Stage 2: AI-assisted scoring (gated, user-triggered only) ─────────────────

const AI_BATCH_LIMIT = 12;
const DNA_FIELDS = [
  "company_name", "industry", "products", "services", "ideal_customer_profiles",
  "target_markets", "unique_selling_points", "brand_voice", "offers",
  "locations", "main_growth_objective",
] as const;

export type AiScoreOutcome = {
  scored: number;
  rejected: number;
  costUsd: number;
  errors: string[];
};

export async function scoreTrendItemsWithAI(
  workspaceId: string,
  triggeredBy: "scheduler" | "user" = "user",
  itemIds?: string[],
): Promise<AiScoreOutcome> {
  const admin = getTrendAdminClient() as any;
  const t0 = Date.now();

  // Gate 1: Business DNA must exist and be meaningfully filled.
  const { data: dna, error: dnaErr } = await admin
    .from("growthmind_business_dna")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (dnaErr) throw new Error(`Business DNA load failed: ${dnaErr.message}`);
  const filled = dna ? DNA_FIELDS.filter(f => typeof dna[f] === "string" && dna[f].trim().length > 0) : [];
  if (filled.length < 3) {
    throw new Error("Business DNA is too empty for relevance scoring — fill in at least your industry, products/services and ideal customers first (GrowthMind → Business DNA).");
  }

  // Threshold from workspace settings
  const { data: settings } = await admin
    .from("workspace_settings")
    .select("growthmind_min_opportunity_score")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const minScore = Math.max(0, Math.min(100, settings?.growthmind_min_opportunity_score ?? 55));

  // Screened items only (or an explicit "analyse deeply" selection), best prescreen first.
  let itemQuery = admin
    .from("growthmind_trend_items")
    .select("id, platform, title, caption, media_type, author_handle, author_name, published_at, discovered_at, metrics, scores, status, url, raw")
    .eq("workspace_id", workspaceId);
  if (itemIds && itemIds.length > 0) {
    // Deep-analyse specific items — allow re-scoring from any non-archived status.
    itemQuery = itemQuery.in("id", itemIds).neq("status", "archived");
  } else {
    itemQuery = itemQuery.eq("status", "screened");
  }
  const { data: items, error: itErr } = await itemQuery
    .order("discovered_at", { ascending: false })
    .limit(60);
  if (itErr) throw new Error(`Load screened items failed: ${itErr.message}`);
  const batch: TrendRow[] = (items ?? [])
    .sort((a: TrendRow, b: TrendRow) => (b.scores?.prescreen ?? 0) - (a.scores?.prescreen ?? 0))
    .slice(0, AI_BATCH_LIMIT);
  if (batch.length === 0) return { scored: 0, rejected: 0, costUsd: 0, errors: [] };

  const dnaSummary = DNA_FIELDS
    .filter(f => dna[f]?.trim())
    .map(f => `${f.replace(/_/g, " ")}: ${String(dna[f]).slice(0, 300)}`)
    .join("\n");

  const itemList = batch.map((r, i) =>
    `#${i + 1} [${r.platform}${r.media_type ? "/" + r.media_type : ""}] by ${r.author_handle ?? r.author_name ?? "unknown"}\n` +
    `Title: ${(r.title ?? "").slice(0, 200)}\nText: ${(r.caption ?? "").slice(0, 400)}\n` +
    `Signals: momentum=${r.scores?.momentum ?? "?"} freshness=${r.scores?.freshness ?? "?"} metrics=${JSON.stringify(r.metrics).slice(0, 200)}`,
  ).join("\n\n");

  const system =
    "You are GrowthMind, an elite CMO scoring content trends for ONE specific business. " +
    "Score each item 0-100 on: businessRelevance (fits what they sell), buyerRelevance (their buyers care), " +
    "productRelevance (maps to a concrete product/service), commercialIntent (can drive revenue, not just views), " +
    "brandFit (matches tone/positioning), originalityOpportunity (room to do an original take), " +
    "risk (0=safe, 100=dangerous: copyright, compliance, reputation, controversy). " +
    "Add a one-sentence whySelected and a suggestedAngle (specific content idea for THIS business), and riskFlags array (e.g. copyright, controversial, competitor_claim, none). " +
    "Irrelevant viral content must score low on relevance regardless of popularity. " +
    'Respond with ONLY valid JSON: {"items":[{"index":1,"businessRelevance":..,"buyerRelevance":..,"productRelevance":..,"commercialIntent":..,"brandFit":..,"originalityOpportunity":..,"risk":..,"whySelected":"..","suggestedAngle":"..","riskFlags":[]}]}';

  const user = `BUSINESS DNA:\n${dnaSummary}\n\nTREND ITEMS TO SCORE:\n${itemList}`;

  // Accepted learning patterns steer future scoring (bounded ±30%) — fails
  // open to no adjustment if the table is missing or unreadable.
  const { getAcceptedPatterns, computeLearningMultiplier } = await import("./learning-engine.server");
  const acceptedPatterns = await getAcceptedPatterns(admin, workspaceId);

  const { routeGenerate } = await import("./model-router.server");
  const result = await routeGenerate({
    system, user,
    contentType: "analysis",
    maxTokens:   3500,
    mode:        "smart",
    settings:    {},
    workspaceId,
    sb:          admin,
  });

  let parsed: any;
  try {
    const jsonText = result.text.match(/\{[\s\S]*\}/)?.[0] ?? result.text;
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI scoring returned unparseable output — try again.");
  }
  const aiItems: any[] = Array.isArray(parsed?.items) ? parsed.items : [];

  let scored = 0, rejected = 0;
  const errors: string[] = [];

  for (const ai of aiItems) {
    const idx = Number(ai?.index) - 1;
    const row = batch[idx];
    if (!row) continue;

    const c = (v: any) => clamp(Number(v) || 0);
    const comp = {
      businessRelevance:      c(ai.businessRelevance),
      buyerRelevance:         c(ai.buyerRelevance),
      productRelevance:       c(ai.productRelevance),
      commercialIntent:       c(ai.commercialIntent),
      brandFit:               c(ai.brandFit),
      originalityOpportunity: c(ai.originalityOpportunity),
      risk:                   c(ai.risk),
    };
    const det = {
      momentum:   row.scores?.momentum ?? 0,
      freshness:  row.scores?.freshness ?? 0,
      saturation: row.scores?.saturation ?? 0,
    };
    // Weighted total opportunity score
    const baseTotal = clamp(
      comp.businessRelevance * 0.16 + comp.buyerRelevance * 0.14 + comp.productRelevance * 0.10 +
      comp.commercialIntent * 0.14 + comp.brandFit * 0.08 + comp.originalityOpportunity * 0.08 +
      det.momentum * 0.12 + det.freshness * 0.08 + (100 - det.saturation) * 0.05 +
      (100 - comp.risk) * 0.05,
    );
    // Apply ACCEPTED learning patterns (bounded multiplier, recorded for audit)
    const learning = computeLearningMultiplier(acceptedPatterns, {
      format:   row.media_type ?? null,
      platform: row.platform ?? null,
      topics:   [String(row.title ?? ""), String(row.caption ?? "")].filter(Boolean),
    });
    const total = clamp(Math.round(baseTotal * learning.multiplier));

    const passes = total >= minScore && comp.risk < 75;
    const scores = {
      ...(row.scores ?? {}),
      ...comp,
      total,
      whySelected:    String(ai.whySelected ?? "").slice(0, 500),
      suggestedAngle: String(ai.suggestedAngle ?? "").slice(0, 500),
      riskFlags:      Array.isArray(ai.riskFlags) ? ai.riskFlags.slice(0, 6).map(String) : [],
      scoredAt:       new Date().toISOString(),
      ...(learning.applied.length ? { learningMultiplier: learning.multiplier, learningApplied: learning.applied } : {}),
      ...(passes ? {} : {
        rejectionReason: comp.risk >= 75
          ? `Risk score ${comp.risk}/100 too high (${(ai.riskFlags ?? []).join(", ") || "unspecified"}).`
          : `Total opportunity score ${total}/100 below your minimum of ${minScore}.`,
      }),
    };

    const { error: upErr } = await admin
      .from("growthmind_trend_items")
      .update({
        scores,
        status:     passes ? "recommended" : "dismissed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
    if (upErr) { errors.push(`item ${row.id}: ${upErr.message}`); continue; }
    if (passes) scored++; else rejected++;
  }

  // Log the scoring run + its real cost
  const { error: logErr } = await admin.from("growthmind_discovery_runs").insert({
    workspace_id:  workspaceId,
    run_kind:      "scoring",
    source:        "scoring_ai",
    status:        errors.length > 0 && scored === 0 && rejected === 0 ? "error" : "success",
    items_found:   batch.length,
    items_new:     scored,
    error_message: errors.length ? errors.join("; ").slice(0, 500) : null,
    cost_estimate: result.costUsd ?? 0,
    duration_ms:   Date.now() - t0,
    triggered_by:  triggeredBy,
  });
  if (logErr) console.error("[trend-scout] failed to log scoring run:", logErr.message);

  // Activity log (best-effort)
  try {
    const { logGrowthMindActivity } = await import("./growthmind.activity.server");
    await logGrowthMindActivity({
      workspaceId,
      category: "trends",
      action: "trends.ai_scoring",
      summary: `Scored ${batch.length} trend items with AI — ${scored} recommended, ${rejected} rejected. Est. cost $${(result.costUsd ?? 0).toFixed(4)}.`,
    } as any);
  } catch { /* non-fatal */ }

  return { scored, rejected, costUsd: result.costUsd ?? 0, errors };
}
