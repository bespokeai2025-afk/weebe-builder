/**
 * GrowthMind Phase 5 — performance learning engine.
 *
 * Deterministic pattern extraction over THIS workspace's own results
 * (performance snapshots + publishing jobs + recommendations). Patterns land
 * in growthmind_learned_patterns as PROPOSED accept/reject recommendations —
 * nothing affects future scoring until a human accepts it, and Business DNA
 * is never rewritten here (DNA-affecting learnings go through the existing
 * growthmind_dna_proposals table).
 *
 * Accepted patterns feed a bounded multiplier applied to future trend /
 * opportunity scoring (see computeLearningMultiplier + trend-scoring.server).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const nowIso = () => new Date().toISOString();

// ── Bounded scoring multiplier ────────────────────────────────────────────────

export interface AcceptedPattern {
  pattern_kind: string;
  pattern_key:  string;
  adjustment:   number;
}

/**
 * Combine accepted pattern adjustments relevant to an item into one bounded
 * multiplier. Each adjustment is clamped to ±0.2 and the combined multiplier
 * is clamped to [0.7, 1.3] so learning can steer but never dominate scoring.
 * Pure — tested.
 */
export function computeLearningMultiplier(
  patterns: AcceptedPattern[],
  item: { format?: string | null; platform?: string | null; topics?: string[] },
): { multiplier: number; applied: string[] } {
  const applied: string[] = [];
  let delta = 0;
  const fmt = (item.format ?? "").toLowerCase();
  const plat = (item.platform ?? "").toLowerCase();
  const topics = (item.topics ?? []).map((t) => t.toLowerCase());

  for (const p of patterns) {
    const adj = Math.max(-0.2, Math.min(0.2, Number(p.adjustment) || 0));
    if (adj === 0) continue;
    const [dim, val] = String(p.pattern_key).split(":");
    const v = (val ?? "").toLowerCase();
    let matches = false;
    if (dim === "format" && fmt && v === fmt) matches = true;
    else if (dim === "platform" && plat && v === plat) matches = true;
    else if (dim === "topic" && topics.some((t) => t.includes(v))) matches = true;
    if (matches) {
      delta += adj;
      applied.push(`${p.pattern_kind}/${p.pattern_key}`);
    }
  }
  const multiplier = Math.max(0.7, Math.min(1.3, 1 + delta));
  return { multiplier, applied };
}

/** Load accepted patterns for scoring. Fails open to [] (no adjustment). */
export async function getAcceptedPatterns(admin: Sb, workspaceId: string): Promise<AcceptedPattern[]> {
  try {
    const { data, error } = await admin
      .from("growthmind_learned_patterns")
      .select("pattern_kind, pattern_key, adjustment")
      .eq("workspace_id", workspaceId)
      .eq("status", "accepted")
      .limit(100);
    if (error) return [];
    return (data ?? []) as AcceptedPattern[];
  } catch { return []; }
}

// ── Pattern extraction ────────────────────────────────────────────────────────

interface PatternCandidate {
  pattern_kind: string;
  pattern_key:  string;
  insight:      string;
  evidence:     Record<string, unknown>;
  adjustment:   number;
  sample_size:  number;
  confidence:   number;
}

interface JobPerf {
  jobId: string;
  format: string;      // target_type as proxy: reel/feed/story/page_post
  platform: string;
  publishedHour: number;
  attention: number;   // best reach/impressions seen
  engagement: number;  // total interactions proxy
  leads: number;       // attributed leads at latest checkpoint
  bookings: number;
}

const MIN_SAMPLE = 3;

/** Latest snapshot per job → per-job performance summary. */
function summariseJobs(jobs: any[], snaps: any[]): JobPerf[] {
  const latestByJob = new Map<string, any>();
  for (const s of snaps) {
    const prev = latestByJob.get(s.publishing_job_id);
    if (!prev || String(s.captured_at) > String(prev.captured_at)) latestByJob.set(s.publishing_job_id, s);
  }
  const out: JobPerf[] = [];
  for (const j of jobs) {
    const snap = latestByJob.get(j.id);
    if (!snap) continue;
    const m = (snap.metrics ?? {}) as any;
    const raw = (m.raw ?? {}) as Record<string, number>;
    const att = (m.attribution ?? {}) as Record<string, number>;
    const attention = Math.max(raw.reach ?? 0, raw.impressions ?? 0, raw.views ?? 0, raw.post_impressions ?? 0);
    const engagement = (raw.total_interactions ?? 0) ||
      (raw.likes ?? raw.like_count ?? 0) + (raw.comments ?? raw.comments_count ?? 0) + (raw.shares ?? 0) + (raw.saved ?? 0);
    out.push({
      jobId: j.id,
      format: String(j.target_type ?? "feed"),
      platform: String(j.platform ?? "instagram"),
      publishedHour: new Date(j.published_at).getUTCHours(),
      attention,
      engagement,
      leads: Number(att.attributed_leads ?? 0),
      bookings: Number(att.attributed_bookings ?? 0),
    });
  }
  return out;
}

/** Deterministic pattern extraction. Pure — tested. */
export function extractPatterns(perf: JobPerf[]): PatternCandidate[] {
  const out: PatternCandidate[] = [];
  if (perf.length < MIN_SAMPLE) return out;

  // Group by format
  const byFormat = new Map<string, JobPerf[]>();
  for (const p of perf) {
    const arr = byFormat.get(p.format) ?? [];
    arr.push(p);
    byFormat.set(p.format, arr);
  }

  const totalLeads = perf.reduce((s, p) => s + p.leads, 0);
  const avgEngagement = perf.reduce((s, p) => s + p.engagement, 0) / perf.length;

  for (const [format, items] of byFormat.entries()) {
    if (items.length < MIN_SAMPLE) continue;
    const leads = items.reduce((s, p) => s + p.leads, 0);
    const attention = items.reduce((s, p) => s + p.attention, 0);
    const engagement = items.reduce((s, p) => s + p.engagement, 0) / items.length;
    const confidence = Math.min(1, items.length / 10);

    // Views but no leads — attention without conversion
    if (attention > 500 && leads === 0 && totalLeads > 0) {
      out.push({
        pattern_kind: "views_no_leads",
        pattern_key:  `format:${format}`,
        insight:      `"${format}" content gets attention (${attention.toLocaleString()} reach across ${items.length} posts) but has produced no attributable leads while other formats have. Consider stronger CTAs or deprioritising it for lead goals.`,
        evidence:     { posts: items.length, attention, leads, totalWorkspaceLeads: totalLeads },
        adjustment:   -0.1,
        sample_size:  items.length,
        confidence,
      });
    }
    // Winning format — above-average engagement AND leads
    if (leads > 0 && engagement > avgEngagement * 1.25) {
      out.push({
        pattern_kind: "winning_format",
        pattern_key:  `format:${format}`,
        insight:      `"${format}" posts outperform: ${Math.round(engagement)} avg interactions (workspace avg ${Math.round(avgEngagement)}) and ${leads} attributed lead${leads === 1 ? "" : "s"} from ${items.length} posts.`,
        evidence:     { posts: items.length, avgEngagement: Math.round(engagement), workspaceAvg: Math.round(avgEngagement), leads },
        adjustment:   0.1,
        sample_size:  items.length,
        confidence,
      });
    }
    // Losing format — clearly below-average engagement, no leads
    if (leads === 0 && engagement < avgEngagement * 0.5 && avgEngagement > 0) {
      out.push({
        pattern_kind: "losing_format",
        pattern_key:  `format:${format}`,
        insight:      `"${format}" posts underperform: ${Math.round(engagement)} avg interactions vs workspace avg ${Math.round(avgEngagement)}, with no attributed leads from ${items.length} posts.`,
        evidence:     { posts: items.length, avgEngagement: Math.round(engagement), workspaceAvg: Math.round(avgEngagement) },
        adjustment:   -0.1,
        sample_size:  items.length,
        confidence,
      });
    }
  }

  // Best publish window (UTC hour bucket with the highest engagement, ≥ MIN_SAMPLE posts)
  const byHour = new Map<number, JobPerf[]>();
  for (const p of perf) {
    const bucket = Math.floor(p.publishedHour / 4) * 4; // 4-hour windows
    const arr = byHour.get(bucket) ?? [];
    arr.push(p);
    byHour.set(bucket, arr);
  }
  let bestBucket: number | null = null, bestAvg = 0;
  for (const [bucket, items] of byHour.entries()) {
    if (items.length < MIN_SAMPLE) continue;
    const avg = items.reduce((s, p) => s + p.engagement, 0) / items.length;
    if (avg > bestAvg) { bestAvg = avg; bestBucket = bucket; }
  }
  if (bestBucket !== null && bestAvg > avgEngagement * 1.2) {
    const items = byHour.get(bestBucket)!;
    out.push({
      pattern_kind: "best_publish_window",
      pattern_key:  `hour:${bestBucket}`,
      insight:      `Posts published between ${bestBucket}:00–${bestBucket + 4}:00 UTC average ${Math.round(bestAvg)} interactions vs ${Math.round(avgEngagement)} overall — schedule more content in this window.`,
      evidence:     { windowStartUtc: bestBucket, posts: items.length, avgEngagement: Math.round(bestAvg), workspaceAvg: Math.round(avgEngagement) },
      adjustment:   0, // informational — affects scheduling advice, not item scoring
      sample_size:  items.length,
      confidence:   Math.min(1, items.length / 10),
    });
  }

  return out;
}

// ── Analysis run (called from the snapshot tick, per workspace) ───────────────

export async function runLearningAnalysis(workspaceId: string): Promise<{ proposed: number; deduped: number }> {
  const admin = await getAdmin();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const [jobsRes, snapsRes] = await Promise.all([
    admin.from("growthmind_publishing_jobs")
      .select("id, platform, target_type, published_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "published")
      .gte("published_at", since)
      .limit(200),
    admin.from("growthmind_performance_snapshots")
      .select("publishing_job_id, captured_at, metrics")
      .eq("workspace_id", workspaceId)
      .gte("captured_at", since)
      .limit(1000),
  ]);
  const jobs = jobsRes.data ?? [];
  const snaps = snapsRes.data ?? [];
  if (jobs.length < MIN_SAMPLE) return { proposed: 0, deduped: 0 };

  const candidates = extractPatterns(summariseJobs(jobs, snaps));
  let proposed = 0, deduped = 0;

  // Row-by-row insert — partial unique index makes 23505 mean "already live".
  for (const c of candidates) {
    const { error } = await admin.from("growthmind_learned_patterns").insert({
      workspace_id: workspaceId,
      pattern_kind: c.pattern_kind,
      pattern_key:  c.pattern_key,
      insight:      c.insight,
      evidence:     c.evidence,
      adjustment:   c.adjustment,
      sample_size:  c.sample_size,
      confidence:   c.confidence,
      status:       "proposed",
    });
    if (!error) { proposed++; continue; }
    if (error.code === "23505") { deduped++; continue; }
    console.warn("[learning-engine] insert failed:", error.message);
  }

  if (proposed > 0) {
    try {
      const { logGrowthMindActivity } = await import("./growthmind.activity.server");
      await logGrowthMindActivity({
        workspaceId, actor: "growthmind", category: "recommendations",
        action: "learning.patterns_proposed",
        summary: `Learning engine proposed ${proposed} new pattern${proposed === 1 ? "" : "s"} from your published-content results — review them in the Performance Lab.`,
      } as any);
    } catch { /* best-effort */ }
  }
  return { proposed, deduped };
}

// ── Server functions (UI) ─────────────────────────────────────────────────────

export const listLearnedPatterns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const { data, error } = await admin
      .from("growthmind_learned_patterns")
      .select("*")
      .eq("workspace_id", context.workspaceId!)
      .in("status", ["proposed", "accepted", "rejected"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { patterns: data ?? [] };
  });

const ResolveInput = z.object({
  patternId: z.string().uuid(),
  decision:  z.enum(["accepted", "rejected"]),
});

export const resolveLearnedPattern = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof ResolveInput>) => ResolveInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId!;
    const userId = (context as any).userId as string;
    const admin = await getAdmin();

    // CAS: only a proposed pattern can be resolved (single decision).
    const { data: updated, error } = await admin
      .from("growthmind_learned_patterns")
      .update({
        status: data.decision,
        resolved_by_user_id: userId,
        resolved_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", data.patternId)
      .eq("workspace_id", workspaceId)
      .eq("status", "proposed")
      .select("id, pattern_kind, pattern_key");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new Error("Pattern already resolved — reload the list.");

    try {
      const { logGrowthMindActivity } = await import("./growthmind.activity.server");
      await logGrowthMindActivity({
        workspaceId, actor: "user", actorUserId: userId, category: "recommendations",
        action: `learning.pattern_${data.decision}`,
        summary: `Learning pattern ${updated[0].pattern_kind} (${updated[0].pattern_key}) ${data.decision}.`,
        entityType: "growthmind_learned_patterns", entityId: data.patternId,
      } as any);
    } catch { /* best-effort */ }
    return { ok: true, status: data.decision };
  });
