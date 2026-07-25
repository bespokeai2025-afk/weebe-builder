/**
 * Trend Scout discovery guards (e2e, real DB).
 *
 * Verifies the two cost/correctness guards flagged in review:
 *   • Daily discovery limit applies to manual ("user") runs too — base limit
 *     for the scheduler, base limit + 2 allowance for manual runs, then blocked.
 *   • Duplicate content_hash collisions during a concurrent-insert race are
 *     retried row-by-row so non-duplicate items are never silently dropped.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  insertItems,
  runTrendDiscoveryForWorkspace,
  trendContentHash,
  type DiscoveredItem,
} from "@/lib/growthmind/trend-discovery.server";

const sb = supabaseAdmin as any;

const WS = randomUUID();
let ownerUserId: string;

const DAILY_LIMIT = 2;

function makeItem(externalId: string, platform = "reddit"): DiscoveredItem {
  return {
    platform,
    externalId,
    url: `https://example.com/${externalId}`,
    title: `Test item ${externalId}`,
    caption: null,
    mediaType: "text",
    metrics: { upvotes: 1 },
    raw: {},
  };
}

async function insertRunMarker(createdAt?: string) {
  const { error } = await sb.from("growthmind_discovery_runs").insert({
    workspace_id: WS,
    run_kind: "discovery",
    source: "internal",
    status: "success",
    triggered_by: "scheduler",
    ...(createdAt ? { created_at: createdAt } : {}),
  });
  if (error) throw new Error(`run marker insert failed: ${error.message}`);
}

async function markerCountToday(): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await sb
    .from("growthmind_discovery_runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", WS)
    .eq("run_kind", "discovery")
    .eq("source", "internal")
    .gte("created_at", dayStart.toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: `Trend guards test ${WS.slice(0, 8)}`,
    slug: `trend-guards-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (wErr) throw new Error(`workspace fixture failed: ${wErr.message}`);

  const { error: sErr } = await sb.from("workspace_settings").upsert(
    {
      workspace_id: WS,
      growthmind_discovery_daily_limit: DAILY_LIMIT,
      growthmind_trend_scout_enabled: true,
    },
    { onConflict: "workspace_id" },
  );
  if (sErr) throw new Error(`workspace_settings fixture failed: ${sErr.message}`);
});

afterAll(async () => {
  await sb.from("growthmind_trend_items").delete().eq("workspace_id", WS);
  await sb.from("growthmind_discovery_runs").delete().eq("workspace_id", WS);
  await sb.from("workspace_settings").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
});

describe("daily discovery limit (scheduler + manual)", () => {
  it("scheduler run is blocked once base limit is reached", async () => {
    // Fill the base quota with run markers (one 'internal' row per full run).
    await insertRunMarker();
    await insertRunMarker();
    expect(await markerCountToday()).toBe(DAILY_LIMIT);

    const s = await runTrendDiscoveryForWorkspace(WS, "scheduler");
    expect(s.ran).toBe(false);
    expect(s.skipReason).toBe("daily_limit_reached");
    // A blocked run must not log new run rows (no quota consumed).
    expect(await markerCountToday()).toBe(DAILY_LIMIT);
  });

  it("manual run still allowed within the +2 allowance, then blocked", async () => {
    // At base limit (2): manual run should be allowed (effective limit 4).
    const allowed = await runTrendDiscoveryForWorkspace(WS, "user");
    expect(allowed.ran).toBe(true);
    expect(allowed.skipReason).toBeUndefined();
    // The run logged its own 'internal' marker → 3 today.
    expect(await markerCountToday()).toBe(DAILY_LIMIT + 1);

    // Top up to the manual effective limit (base + 2 = 4).
    await insertRunMarker();
    expect(await markerCountToday()).toBe(DAILY_LIMIT + 2);

    const blocked = await runTrendDiscoveryForWorkspace(WS, "user");
    expect(blocked.ran).toBe(false);
    expect(blocked.skipReason).toBe("daily_limit_reached");
    expect(await markerCountToday()).toBe(DAILY_LIMIT + 2);
  });

  it("yesterday's runs don't count toward today's limit", async () => {
    // Wipe today's markers, add ones from yesterday only.
    await sb.from("growthmind_discovery_runs").delete().eq("workspace_id", WS);
    const yesterday = new Date(Date.now() - 26 * 3600_000).toISOString();
    await insertRunMarker(yesterday);
    await insertRunMarker(yesterday);
    await insertRunMarker(yesterday);
    await insertRunMarker(yesterday);
    expect(await markerCountToday()).toBe(0);

    const s = await runTrendDiscoveryForWorkspace(WS, "scheduler");
    expect(s.ran).toBe(true);
  });
});

describe("insertItems duplicate protection", () => {
  it("dedupes within a batch and against existing rows", async () => {
    const items = [makeItem("dup-a"), makeItem("dup-a"), makeItem("dup-b")];
    const first = await insertItems(sb, WS, items, [], []);
    expect(first).toBe(2); // in-batch duplicate collapsed

    const second = await insertItems(sb, WS, items, [], []);
    expect(second).toBe(0); // all already present
  });

  it("row-by-row retry on 23505 keeps non-duplicate rows", async () => {
    // Pre-insert a row whose hash collides with item "race-x".
    const collidingHash = trendContentHash("reddit", "race-x");
    const { error: preErr } = await sb.from("growthmind_trend_items").insert({
      workspace_id: WS,
      platform: "reddit",
      external_id: "race-x",
      title: "Pre-existing (simulates concurrent run)",
      metrics: {},
      content_hash: collidingHash,
      status: "discovered",
      raw: {},
    });
    if (preErr) throw new Error(preErr.message);

    // Stub admin: the dedupe SELECT on growthmind_trend_items pretends the
    // hash isn't there yet (simulating a concurrent run inserting between the
    // check and the batch insert), while all inserts hit the real DB — so the
    // batch insert fails with a genuine 23505 from the partial unique index.
    const stubAdmin = {
      from(table: string) {
        const real = sb.from(table);
        if (table !== "growthmind_trend_items") return real;
        return {
          select(...args: any[]) {
            // Dedupe check chain: select("content_hash").eq().in().limit()
            if (args[0] === "content_hash") {
              const chain: any = {
                eq: () => chain,
                in: () => chain,
                limit: async () => ({ data: [], error: null }),
              };
              return chain;
            }
            return real.select(...args);
          },
          insert: (rows: any) => sb.from(table).insert(rows),
        };
      },
    };

    const items = [makeItem("race-x"), makeItem("race-y"), makeItem("race-z")];
    const inserted = await insertItems(stubAdmin, WS, items, [], []);
    // The colliding row is skipped; the two fresh rows must survive the retry.
    expect(inserted).toBe(2);

    const { data: rows, error } = await sb
      .from("growthmind_trend_items")
      .select("content_hash")
      .eq("workspace_id", WS)
      .in("content_hash", [
        collidingHash,
        trendContentHash("reddit", "race-y"),
        trendContentHash("reddit", "race-z"),
      ]);
    if (error) throw new Error(error.message);
    expect(rows.length).toBe(3); // exactly one row per hash — no dup, no loss
  });

  it("exclusion filters still apply before insert", async () => {
    const item = { ...makeItem("excl-1"), authorHandle: "blockedguy" };
    const inserted = await insertItems(sb, WS, [item], ["blockedguy"], []);
    expect(inserted).toBe(0);
  });
});
