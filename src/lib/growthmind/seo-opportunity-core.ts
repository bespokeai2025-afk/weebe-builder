/**
 * SEO Opportunity Queue core — deterministic detection + scoring engine.
 *
 * ALIAS-FREE (no "@/" imports): this module is dynamically imported from
 * gsc-sync-core.ts, which is loaded from the campaign-scheduler Vite plugin
 * chain at config time. Keep every import relative or package-level.
 *
 * Rules:
 *  - Never invents metrics — every opportunity carries the raw GSC evidence
 *    that produced it.
 *  - Deterministic thresholds only; no AI calls in detection or scoring.
 *  - Table is server-write-only; all writes go through the service role.
 *  - Dedupe: one live row per (workspace, kind:dim_key). Re-detected open rows
 *    are refreshed in place; executing/handled/recently-dismissed rows are
 *    never re-proposed; stale open rows expire.
 *  - Cannibalisation detection requires a combined query+page dimension that
 *    the sync does not import yet — the kind exists in the schema but no
 *    detector emits it (recorded as a limitation, never guessed).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Aggregation (mirrors seo-intelligence aggregate; kept here alias-free) ───

export type PerfRow = { date: string; dim_key: string; clicks: number; impressions: number; position: number | null };

export type Agg = {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  trend: "growing" | "declining" | "stable";
  firstHalf: { impressions: number; clicks: number };
  secondHalf: { impressions: number; clicks: number };
};

export function aggregatePerf(rows: PerfRow[]): Agg[] {
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
  const out: Agg[] = [];
  for (const [key, a] of byKey) {
    const delta = a.i1 > 0 ? (a.i2 - a.i1) / a.i1 : a.i2 > 0 ? 1 : 0;
    out.push({
      key,
      clicks: a.c,
      impressions: a.i,
      ctr: a.i > 0 ? a.c / a.i : 0,
      position: a.posI > 0 ? a.posW / a.posI : null,
      trend: delta > 0.25 ? "growing" : delta < -0.25 ? "declining" : "stable",
      firstHalf: { impressions: a.i1, clicks: a.c1 },
      secondHalf: { impressions: a.i2, clicks: a.c2 },
    });
  }
  out.sort((x, y) => y.impressions - x.impressions);
  return out;
}

// ── Detection ────────────────────────────────────────────────────────────────

export type OpportunityExecution =
  | "create_article" | "refresh_content" | "metadata_change" | "page_change"
  | "internal_links" | "faq_section" | "sitemap_submit";

export type DetectedOpportunity = {
  kind: string;
  dimKey: string;
  title: string;
  rationale: string;
  recommendedExecution: OpportunityExecution;
  evidence: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
};

export type InspectionRow = { url: string; verdict: string | null; coverage_state: string | null };

const CONFIDENCE_VALUE: Record<DetectedOpportunity["confidence"], number> = { high: 0.9, medium: 0.6, low: 0.35 };

/** Relative effort per execution path (higher = more work). */
export const EXECUTION_EFFORT: Record<OpportunityExecution, number> = {
  sitemap_submit: 0.5,
  metadata_change: 1,
  internal_links: 1.5,
  faq_section: 1.5,
  page_change: 2,
  refresh_content: 2,
  create_article: 3,
};

/** Expected CTR by average position (rough industry curve; used only for value sizing, never reported as a metric). */
function expectedCtr(position: number | null): number {
  if (position == null) return 0.01;
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.15;
  if (position <= 5) return 0.08;
  if (position <= 10) return 0.03;
  if (position <= 20) return 0.01;
  return 0.005;
}

export function scoreOpportunity(op: DetectedOpportunity, agg: { impressions: number; ctr: number; position: number | null } | null): {
  businessValue: number; rankingOpportunity: number; confidence: number; effort: number; score: number;
} {
  const impressions = agg?.impressions ?? 0;
  // Business value: log-scaled search demand, 0..1. Site-level items with no
  // per-key metrics (e.g. sitemap missing) get a neutral baseline so cheap
  // foundational fixes don't rank as worthless.
  const businessValue = agg ? Math.min(1, Math.log10(1 + impressions) / 4) : 0.25;
  // Ranking opportunity: headroom between observed and achievable CTR at a better position.
  const currentCtr = agg?.ctr ?? 0;
  const headroom = Math.max(0, expectedCtr(Math.max(1, (agg?.position ?? 30) / 2)) - currentCtr);
  const rankingOpportunity = agg ? Math.min(1, headroom / 0.28) : 0.5;
  const confidence = CONFIDENCE_VALUE[op.confidence];
  const effort = EXECUTION_EFFORT[op.recommendedExecution];
  const score = Math.round((100 * businessValue * rankingOpportunity * confidence) / effort * 10) / 10;
  return { businessValue: round3(businessValue), rankingOpportunity: round3(rankingOpportunity), confidence, effort, score };
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

export function detectQueueOpportunities(input: {
  queries: Agg[];
  pages: Agg[];
  sitemaps: Array<{ path: string }>;
  inspections: InspectionRow[];
  siteUrl: string | null;
}): DetectedOpportunity[] {
  const ops: DetectedOpportunity[] = [];
  const { queries, pages, sitemaps, inspections } = input;

  for (const q of queries) {
    const ev = { impressions: q.impressions, clicks: q.clicks, ctr: round3(q.ctr), position: q.position != null ? Math.round(q.position * 10) / 10 : null, firstHalf: q.firstHalf, secondHalf: q.secondHalf };
    if (q.impressions >= 100 && q.clicks <= 2) {
      ops.push({
        kind: "high_impression_low_ctr", dimKey: q.key,
        title: `Capture demand for "${q.key}"`,
        rationale: `${q.impressions} impressions but only ${q.clicks} clicks in the window.`,
        recommendedExecution: q.position != null && q.position <= 10 ? "metadata_change" : "refresh_content",
        evidence: ev, confidence: "high",
      });
    } else if (q.position != null && q.position <= 10 && q.impressions >= 50 && q.ctr < 0.015) {
      ops.push({
        kind: "title_meta_weak", dimKey: q.key,
        title: `Weak snippet for "${q.key}"`,
        rationale: `Ranks in the top 10 (avg ${q.position.toFixed(1)}) but CTR is ${(q.ctr * 100).toFixed(2)}% — the title/meta is not earning the click.`,
        recommendedExecution: "metadata_change", evidence: ev, confidence: "high",
      });
    }
    if (q.position != null && q.position > 10 && q.position <= 20 && q.impressions >= 30) {
      ops.push({
        kind: "near_page_one", dimKey: q.key,
        title: `Push "${q.key}" onto page one`,
        rationale: `Ranks ${q.position.toFixed(1)} with ${q.impressions} impressions — content depth + internal links can cross onto page one.`,
        recommendedExecution: "internal_links", evidence: ev, confidence: "medium",
      });
    }
    if (q.trend === "declining" && q.firstHalf.impressions >= 30) {
      ops.push({
        kind: "declining_query", dimKey: q.key,
        title: `Reverse decline for "${q.key}"`,
        rationale: `Impressions dropped from ${q.firstHalf.impressions} to ${q.secondHalf.impressions} across the window.`,
        recommendedExecution: "refresh_content", evidence: ev, confidence: "medium",
      });
    }
    if (q.position != null && q.position > 20 && q.impressions >= 50) {
      ops.push({
        kind: "missing_content", dimKey: q.key,
        title: `Content gap: "${q.key}"`,
        rationale: `${q.impressions} impressions at avg position ${q.position.toFixed(1)} — ranks beyond page two, so no page is competing effectively for this query.`,
        recommendedExecution: "create_article", evidence: ev, confidence: "medium",
      });
    }
  }

  for (const p of pages) {
    const ev = { impressions: p.impressions, clicks: p.clicks, ctr: round3(p.ctr), position: p.position != null ? Math.round(p.position * 10) / 10 : null, firstHalf: p.firstHalf, secondHalf: p.secondHalf };
    if (p.trend === "declining" && p.firstHalf.impressions >= 30) {
      ops.push({
        kind: "declining_page", dimKey: p.key,
        title: `Refresh declining page ${shortUrl(p.key)}`,
        rationale: `Page impressions dropped from ${p.firstHalf.impressions} to ${p.secondHalf.impressions} across the window.`,
        recommendedExecution: "refresh_content", evidence: ev, confidence: "medium",
      });
    } else if (p.impressions >= 50 && p.ctr < 0.005 && p.position != null && p.position > 12) {
      ops.push({
        kind: "thin_or_outdated", dimKey: p.key,
        title: `Possible thin/outdated content: ${shortUrl(p.key)}`,
        rationale: `${p.impressions} impressions at avg position ${p.position.toFixed(1)} with CTR ${(p.ctr * 100).toFixed(2)}% — signals the page no longer satisfies the query set. (Signal-based; page content itself is not crawled.)`,
        recommendedExecution: "refresh_content", evidence: ev, confidence: "low",
      });
    }
  }

  for (const insp of inspections) {
    const verdict = (insp.verdict ?? "").toUpperCase();
    if (verdict && verdict !== "PASS" && verdict !== "VERDICT_UNSPECIFIED") {
      ops.push({
        kind: "indexing_issue", dimKey: insp.url,
        title: `Indexing issue on ${shortUrl(insp.url)}`,
        rationale: `URL Inspection verdict is ${verdict}${insp.coverage_state ? ` (${insp.coverage_state})` : ""}.`,
        recommendedExecution: "page_change",
        evidence: { verdict: insp.verdict, coverageState: insp.coverage_state, url: insp.url },
        confidence: "high",
      });
    }
  }

  if (sitemaps.length === 0 && input.siteUrl) {
    ops.push({
      kind: "sitemap_missing", dimKey: input.siteUrl,
      title: "No sitemap submitted to Search Console",
      rationale: "Search Console has no sitemap for this property — Google discovers new pages slower without one.",
      recommendedExecution: "sitemap_submit",
      evidence: { sitemapCount: 0 },
      confidence: "high",
    });
  }

  return ops;
}

function shortUrl(u: string): string {
  try { const p = new URL(u); return p.pathname === "/" ? p.hostname : p.pathname; } catch { return u.slice(0, 60); }
}

export function dedupeKeyFor(kind: string, dimKey: string): string {
  return `${kind}:${dimKey}`.slice(0, 500);
}

// ── Refresh (materialise queue rows) ─────────────────────────────────────────

/**
 * Reconcile stuck "executing" opportunities against their linked marketing
 * action. If the action reached a terminal failure state (failed/rolled_back)
 * — including approval rejection, guardrail refusal, or execution error — the
 * opportunity reopens with the failure recorded so the user can retry.
 * An opportunity claimed but never linked to an action (orphaned claim, e.g.
 * action creation crashed) reopens after a grace period.
 */
const ORPHAN_CLAIM_GRACE_MINUTES = 30;

export async function reconcileSeoOpportunities(
  workspaceId: string,
  sbOverride?: SupabaseClient,
): Promise<{ reopened: number }> {
  const admin = (sbOverride ?? adminClient()) as any;
  let reopened = 0;
  const { data: executing } = await admin
    .from("growthmind_seo_opportunities")
    .select("id, marketing_action_id, status_changed_at, measurement")
    .eq("workspace_id", workspaceId)
    .eq("status", "executing");
  for (const row of executing ?? []) {
    const now = new Date().toISOString();
    if (!row.marketing_action_id) {
      const claimedAt = row.status_changed_at ? new Date(row.status_changed_at).getTime() : 0;
      if (Date.now() - claimedAt < ORPHAN_CLAIM_GRACE_MINUTES * 60_000) continue;
      const { error } = await admin.from("growthmind_seo_opportunities").update({
        status: "open", status_changed_at: now, updated_at: now,
        measurement: { ...(row.measurement ?? {}), lastFailure: { at: now, detail: "Execution claim was never linked to a marketing action (orphaned) — reopened for retry." } },
      }).eq("id", row.id).eq("status", "executing");
      if (!error) reopened++;
      continue;
    }
    const { data: action } = await admin
      .from("marketing_actions")
      .select("id, status, status_history, approval_action_id")
      .eq("id", row.marketing_action_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!action) continue;
    // Recover records stranded before rejection→failure propagation existed:
    // an awaiting_approval action whose bound approval was rejected is dead —
    // fail it (legal transition, history appended) so it reopens below.
    if (action.status === "awaiting_approval" && action.approval_action_id) {
      const { data: approval } = await admin
        .from("hivemind_actions")
        .select("status")
        .eq("id", action.approval_action_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (approval?.status === "rejected") {
        const history = Array.isArray(action.status_history) ? action.status_history : [];
        const { data: failedRows } = await admin.from("marketing_actions").update({
          status: "failed",
          error_message: "Approval rejected by user.",
          status_history: [...history, { from: "awaiting_approval", to: "failed", at: now, note: "Approval rejected by user (reconciled)" }],
          updated_at: now,
        }).eq("id", action.id).eq("status", "awaiting_approval").select("id");
        if (failedRows?.length) { action.status = "failed"; action.status_history = [...history, { note: "Approval rejected by user (reconciled)" }]; }
      }
    }
    if (action.status === "failed" || action.status === "rolled_back") {
      const history = Array.isArray(action.status_history) ? action.status_history : [];
      const lastNote = history.length > 0 ? (history[history.length - 1] as any)?.note ?? null : null;
      const { error } = await admin.from("growthmind_seo_opportunities").update({
        status: "open", status_changed_at: now, updated_at: now,
        measurement: { ...(row.measurement ?? {}), lastFailure: { at: now, actionStatus: action.status, detail: lastNote ?? `Marketing action ended as ${action.status}.` } },
      }).eq("id", row.id).eq("status", "executing");
      if (!error) reopened++;
    }
  }
  return { reopened };
}

const DISMISS_BLOCK_DAYS = 30;
const HANDLED_BLOCK_DAYS = 30;
const OPEN_EXPIRE_DAYS = 14;
const MAX_QUEUE_INSERTS_PER_REFRESH = 40;

export async function refreshSeoOpportunityQueue(
  workspaceId: string,
  sbOverride?: SupabaseClient,
): Promise<{ ok: boolean; detected: number; inserted: number; updated: number; expired: number; error?: string }> {
  const admin = (sbOverride ?? adminClient()) as any;
  try {
    const { data: settings } = await admin
      .from("workspace_settings")
      .select("gsc_property_url")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const propertyUrl: string | null = settings?.gsc_property_url ?? null;
    if (!propertyUrl) return { ok: false, detected: 0, inserted: 0, updated: 0, expired: 0, error: "No GSC property connected" };

    // Reopen opportunities whose linked marketing action failed (best-effort).
    try { await reconcileSeoOpportunities(workspaceId, admin); } catch { /* non-fatal */ }

    const since = new Date(Date.now() - 90 * 86400_000).toISOString().split("T")[0];
    const loadDim = async (dimension: string): Promise<PerfRow[]> => {
      const out: PerfRow[] = [];
      for (let fromIdx = 0; ; fromIdx += 1000) {
        const { data, error } = await admin
          .from("growthmind_gsc_performance")
          .select("date, dim_key, clicks, impressions, position")
          .eq("workspace_id", workspaceId)
          .eq("property_url", propertyUrl)
          .eq("dimension", dimension)
          .gte("date", since)
          .range(fromIdx, fromIdx + 999);
        if (error) throw new Error(error.message);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return out;
    };

    const [queryRows, pageRows, sitemapsRes, inspectionsRes] = await Promise.all([
      loadDim("query"),
      loadDim("page"),
      admin.from("growthmind_gsc_sitemaps").select("path").eq("workspace_id", workspaceId).eq("property_url", propertyUrl),
      admin.from("growthmind_gsc_inspections").select("url, verdict, coverage_state").eq("workspace_id", workspaceId).eq("property_url", propertyUrl).order("inspected_at", { ascending: false }).limit(100),
    ]);

    const queries = aggregatePerf(queryRows);
    const pages = aggregatePerf(pageRows);
    const aggByKey = new Map<string, Agg>();
    for (const a of [...queries, ...pages]) if (!aggByKey.has(a.key)) aggByKey.set(a.key, a);

    // Latest inspection per URL only.
    const seenUrls = new Set<string>();
    const inspections: InspectionRow[] = [];
    for (const r of (inspectionsRes.data ?? []) as InspectionRow[]) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      inspections.push(r);
    }

    const detected = detectQueueOpportunities({
      queries, pages,
      sitemaps: sitemapsRes.data ?? [],
      inspections,
      siteUrl: propertyUrl.startsWith("sc-domain:") ? `https://${propertyUrl.slice("sc-domain:".length)}` : propertyUrl,
    });

    // Existing live + recently closed rows for dedupe decisions.
    const { data: existingRows, error: exErr } = await admin
      .from("growthmind_seo_opportunities")
      .select("id, kind, dedupe_key, status, status_changed_at, last_detected_at")
      .eq("workspace_id", workspaceId)
      .eq("property_url", propertyUrl);
    if (exErr) throw new Error(exErr.message);
    const byDedupe = new Map<string, any>();
    for (const row of existingRows ?? []) {
      const prev = byDedupe.get(row.dedupe_key);
      // Prefer live rows over closed ones for decision-making.
      if (!prev || ["open", "executing", "handled"].includes(row.status)) byDedupe.set(row.dedupe_key, row);
    }

    const now = new Date().toISOString();
    let inserted = 0, updated = 0, expired = 0;
    const detectedKeys = new Set<string>();

    // Highest-value first so the insert cap keeps the best candidates.
    const scored = detected
      .map((op) => ({ op, s: scoreOpportunity(op, aggByKey.get(op.dimKey) ?? null) }))
      .sort((a, b) => b.s.score - a.s.score);

    for (const { op, s } of scored) {
      const dk = dedupeKeyFor(op.kind, op.dimKey);
      if (detectedKeys.has(dk)) continue;
      detectedKeys.add(dk);
      const existing = byDedupe.get(dk);
      if (existing) {
        if (existing.status === "open") {
          const { error } = await admin.from("growthmind_seo_opportunities").update({
            title: op.title, rationale: op.rationale, recommended_execution: op.recommendedExecution,
            evidence: op.evidence, business_value: s.businessValue, ranking_opportunity: s.rankingOpportunity,
            confidence: s.confidence, effort: s.effort, score: s.score,
            last_detected_at: now, updated_at: now,
          }).eq("id", existing.id).eq("status", "open");
          if (!error) updated++;
          continue;
        }
        if (existing.status === "executing" || existing.status === "handled") continue; // never re-propose in-flight/done work
        const closedAt = existing.status_changed_at ? new Date(existing.status_changed_at).getTime() : 0;
        const blockDays = existing.status === "dismissed" ? DISMISS_BLOCK_DAYS : HANDLED_BLOCK_DAYS;
        if (closedAt && Date.now() - closedAt < blockDays * 86400_000) continue;
      }
      if (inserted >= MAX_QUEUE_INSERTS_PER_REFRESH) continue;
      const { error } = await admin.from("growthmind_seo_opportunities").insert({
        workspace_id: workspaceId, property_url: propertyUrl,
        kind: op.kind, dim_key: op.dimKey, title: op.title, rationale: op.rationale,
        recommended_execution: op.recommendedExecution, evidence: op.evidence,
        business_value: s.businessValue, ranking_opportunity: s.rankingOpportunity,
        confidence: s.confidence, effort: s.effort, score: s.score,
        status: "open", dedupe_key: dk, last_detected_at: now,
      });
      if (error) {
        if (String((error as any).code) === "23505") continue; // concurrent refresh — deduped
        throw new Error(error.message);
      }
      inserted++;
    }

    // Expire open rows the detectors no longer see (stale evidence).
    const cutoff = new Date(Date.now() - OPEN_EXPIRE_DAYS * 86400_000).toISOString();
    for (const row of existingRows ?? []) {
      if (row.status !== "open" || detectedKeys.has(row.dedupe_key)) continue;
      if (row.last_detected_at && row.last_detected_at > cutoff) continue;
      const { error } = await admin.from("growthmind_seo_opportunities").update({
        status: "expired", status_changed_at: now, updated_at: now,
      }).eq("id", row.id).eq("status", "open");
      if (!error) expired++;
    }

    return { ok: true, detected: detected.length, inserted, updated, expired };
  } catch (e: any) {
    return { ok: false, detected: 0, inserted: 0, updated: 0, expired: 0, error: e?.message ?? String(e) };
  }
}
