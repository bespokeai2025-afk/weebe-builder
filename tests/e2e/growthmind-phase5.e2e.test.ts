/**
 * GrowthMind Phase 5 — performance snapshots + learning engine (e2e, real DB).
 *
 * Verifies:
 *   • computeDueCheckpoints — elapsed/captured/future/invalid handling
 *   • categoriseMetrics — five-bucket sort, non-numeric filtering
 *   • computeLearningMultiplier — clamped adjustments, [0.7,1.3] bound, matching
 *   • extractPatterns — deterministic winning/losing/views-no-leads/window rules
 *   • runLearningAnalysis — proposes rows, dedup on second run (partial unique idx)
 *   • resolveLearnedPattern CAS semantics via direct DB (accepted patterns feed scoring)
 *   • getAcceptedPatterns fail-open + multi-tenant isolation
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SNAPSHOT_CHECKPOINTS,
  computeDueCheckpoints,
  categoriseMetrics,
} from "@/lib/growthmind/performance-snapshots.server";
import {
  computeLearningMultiplier,
  extractPatterns,
  getAcceptedPatterns,
  runLearningAnalysis,
} from "@/lib/growthmind/learning-engine.server";

const sb = supabaseAdmin as any;

const WS_A = randomUUID();
const WS_B = randomUUID();
let ownerUserId: string;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  for (const id of [WS_A, WS_B]) {
    const { error: wErr } = await sb.from("workspaces").insert({
      id, name: `GM Phase5 test ${id.slice(0, 8)}`, slug: `gm-p5-${id.slice(0, 8)}`, owner_id: ownerUserId,
    });
    if (wErr) throw new Error(`workspace fixture failed: ${wErr.message}`);
  }
});

afterAll(async () => {
  for (const id of [WS_A, WS_B]) {
    await sb.from("growthmind_performance_snapshots").delete().eq("workspace_id", id);
    await sb.from("growthmind_learned_patterns").delete().eq("workspace_id", id);
    await sb.from("growthmind_publishing_jobs").delete().eq("workspace_id", id);
    await sb.from("workspaces").delete().eq("id", id);
  }
});

describe("computeDueCheckpoints (pure)", () => {
  it("returns nothing for a just-published post", () => {
    expect(computeDueCheckpoints(new Date().toISOString(), [])).toEqual([]);
  });
  it("returns all elapsed, uncaptured checkpoints", () => {
    const due = computeDueCheckpoints(hoursAgo(25), ["1h"]);
    expect(due.map((c) => c.key)).toEqual(["6h", "24h"]);
  });
  it("skips already-captured keys", () => {
    const due = computeDueCheckpoints(hoursAgo(7 * 24 + 1), ["1h", "6h", "24h", "72h", "7d"]);
    expect(due).toEqual([]);
  });
  it("handles future publish times and garbage input", () => {
    expect(computeDueCheckpoints(new Date(Date.now() + 3600_000).toISOString(), [])).toEqual([]);
    expect(computeDueCheckpoints("not-a-date", [])).toEqual([]);
  });
  it("checkpoint ladder is 1h→30d ascending", () => {
    const mins = SNAPSHOT_CHECKPOINTS.map((c) => c.minutes);
    expect(mins).toEqual([...mins].sort((a, b) => a - b));
    expect(SNAPSHOT_CHECKPOINTS[0].key).toBe("1h");
    expect(SNAPSHOT_CHECKPOINTS.at(-1)!.key).toBe("30d");
  });
});

describe("categoriseMetrics (pure)", () => {
  it("sorts known keys into the five buckets and drops non-numerics", () => {
    const cats = categoriseMetrics({
      reach: 1200, impressions: "1500", likes: 40, comments: 5, saved: 3,
      website_clicks: 7, attributed_leads: 2, attributed_bookings: 1, attributed_sales: 0,
      bogus_metric: 999, shares: null, views: "not-a-number",
    });
    expect(cats.attention).toEqual({ impressions: 1500, reach: 1200 });
    expect(cats.engagement).toEqual({ likes: 40, comments: 5, saved: 3 });
    expect(cats.intent).toEqual({ website_clicks: 7 });
    expect(cats.conversion).toEqual({ attributed_leads: 2, attributed_bookings: 1 });
    expect(cats.revenue).toEqual({ attributed_sales: 0 });
  });
});

describe("computeLearningMultiplier (pure)", () => {
  it("applies only matching patterns and reports what applied", () => {
    const r = computeLearningMultiplier(
      [
        { pattern_kind: "winning_format", pattern_key: "format:reel", adjustment: 0.1 },
        { pattern_kind: "losing_format",  pattern_key: "format:story", adjustment: -0.1 },
        { pattern_kind: "winning_format", pattern_key: "platform:instagram", adjustment: 0.05 },
      ],
      { format: "Reel", platform: "instagram", topics: [] },
    );
    expect(r.multiplier).toBeCloseTo(1.15, 5);
    expect(r.applied).toEqual(["winning_format/format:reel", "winning_format/platform:instagram"]);
  });
  it("clamps each adjustment to ±0.2 and the total to [0.7, 1.3]", () => {
    const huge = Array.from({ length: 5 }, () => ({
      pattern_kind: "winning_format", pattern_key: "format:reel", adjustment: 5,
    }));
    expect(computeLearningMultiplier(huge, { format: "reel" }).multiplier).toBe(1.3);
    const neg = huge.map((p) => ({ ...p, adjustment: -5 }));
    expect(computeLearningMultiplier(neg, { format: "reel" }).multiplier).toBe(0.7);
  });
  it("no patterns → neutral 1.0", () => {
    expect(computeLearningMultiplier([], { format: "reel" }).multiplier).toBe(1);
  });
});

describe("extractPatterns (pure, deterministic)", () => {
  const mk = (over: Partial<any>) => ({
    jobId: randomUUID(), format: "feed", platform: "instagram", publishedHour: 10,
    attention: 100, engagement: 10, leads: 0, bookings: 0, ...over,
  });
  it("needs a minimum sample", () => {
    expect(extractPatterns([mk({}), mk({})])).toEqual([]);
  });
  it("flags a winning format (leads + above-average engagement)", () => {
    const perf = [
      mk({ format: "reel", engagement: 100, leads: 2 }),
      mk({ format: "reel", engagement: 90,  leads: 1 }),
      mk({ format: "reel", engagement: 110, leads: 0 }),
      mk({ format: "feed", engagement: 5 }),
      mk({ format: "feed", engagement: 5 }),
      mk({ format: "feed", engagement: 5 }),
    ];
    const kinds = extractPatterns(perf).map((p) => `${p.pattern_kind}|${p.pattern_key}`);
    expect(kinds).toContain("winning_format|format:reel");
    expect(kinds).toContain("losing_format|format:feed");
  });
  it("flags views-without-leads when other formats convert", () => {
    const perf = [
      mk({ format: "story", attention: 1000, engagement: 20 }),
      mk({ format: "story", attention: 900,  engagement: 25 }),
      mk({ format: "story", attention: 800,  engagement: 22 }),
      mk({ format: "reel",  leads: 3, engagement: 30 }),
      mk({ format: "reel",  leads: 1, engagement: 28 }),
      mk({ format: "reel",  leads: 2, engagement: 32 }),
    ];
    const found = extractPatterns(perf).find((p) => p.pattern_kind === "views_no_leads");
    expect(found?.pattern_key).toBe("format:story");
    expect(found?.adjustment).toBeLessThan(0);
  });
  it("best publish window is informational (adjustment 0)", () => {
    const perf = [
      ...Array.from({ length: 3 }, () => mk({ publishedHour: 18, engagement: 100 })),
      ...Array.from({ length: 3 }, () => mk({ publishedHour: 6,  engagement: 10 })),
    ];
    const win = extractPatterns(perf).find((p) => p.pattern_kind === "best_publish_window");
    expect(win?.pattern_key).toBe("hour:16");
    expect(win?.adjustment).toBe(0);
  });
});

describe("learning analysis + learned patterns table (real DB)", () => {
  it("proposes rows from real snapshots and dedups on re-run", async () => {
    // Seed 6 published jobs + latest snapshots that trigger winning/losing rules.
    const jobs: any[] = [];
    for (let i = 0; i < 6; i++) {
      const isReel = i < 3;
      jobs.push({
        id: randomUUID(),
        workspace_id: WS_A,
        project_id: null,
        platform: "instagram",
        target_type: isReel ? "reel" : "feed",
        status: "published",
        published_at: hoursAgo(30 + i),
        external_post_id: `post_${i}`,
      });
    }
    const { error: jErr } = await sb.from("growthmind_publishing_jobs").insert(jobs);
    if (jErr) throw new Error(`job fixture failed: ${jErr.message}`);

    const snaps = jobs.map((j, i) => ({
      workspace_id: WS_A,
      publishing_job_id: j.id,
      captured_at: hoursAgo(1),
      metrics: {
        checkpoint: "24h",
        raw: j.target_type === "reel"
          ? { reach: 1000, total_interactions: 100 }
          : { reach: 100, total_interactions: 2 },
        attribution: j.target_type === "reel" ? { attributed_leads: 1 } : {},
        categories: {},
      },
    }));
    const { error: sErr } = await sb.from("growthmind_performance_snapshots").insert(snaps);
    if (sErr) throw new Error(`snapshot fixture failed: ${sErr.message}`);

    const first = await runLearningAnalysis(WS_A);
    expect(first.proposed).toBeGreaterThan(0);

    const second = await runLearningAnalysis(WS_A);
    expect(second.proposed).toBe(0);
    expect(second.deduped).toBeGreaterThan(0);

    const { data: rows } = await sb.from("growthmind_learned_patterns")
      .select("id, status, pattern_kind, pattern_key").eq("workspace_id", WS_A);
    expect(rows!.length).toBe(first.proposed);
    expect(rows!.every((r: any) => r.status === "proposed")).toBe(true);
  });

  it("accepted patterns are readable for scoring; other tenants isolated; never silent", async () => {
    const { data: rows } = await sb.from("growthmind_learned_patterns")
      .select("id").eq("workspace_id", WS_A).limit(1);
    expect(rows!.length).toBe(1);

    // Accept via the same CAS the server fn uses (status must still be proposed)
    const { data: updated, error: upErr } = await sb.from("growthmind_learned_patterns")
      .update({ status: "accepted", resolved_by_user_id: ownerUserId, resolved_at: new Date().toISOString() })
      .eq("id", rows![0].id).eq("workspace_id", WS_A).eq("status", "proposed")
      .select("id");
    expect(upErr).toBeNull();
    expect(updated!.length).toBe(1);

    // Second CAS attempt gets no row (no double-resolve)
    const { data: again } = await sb.from("growthmind_learned_patterns")
      .update({ status: "rejected" })
      .eq("id", rows![0].id).eq("status", "proposed")
      .select("id");
    expect(again ?? []).toHaveLength(0);

    // Scoring only sees ACCEPTED patterns (never silently applies proposed ones)
    const accepted = await getAcceptedPatterns(sb, WS_A);
    expect(accepted.length).toBe(1);

    // Tenant isolation
    const other = await getAcceptedPatterns(sb, WS_B);
    expect(other).toEqual([]);
  });
});
