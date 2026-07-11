/**
 * E2E tests for the AccountsMind metric-history backfill: past daily values
 * are computed retroactively from row timestamps and upserted into
 * accountsmind_metric_snapshots so trend/progress sparklines render
 * immediately for existing workspaces.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random workspace id and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/accountsmind-history-backfill.e2e.test.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  METRIC_REGISTRY,
  ensureMetricHistoryBackfillServer,
  getMetricSeriesServer,
} from "@/lib/accountsmind/accountsmind-config.server";

const sb = supabaseAdmin as any;
const WS = randomUUID(); // throw-away workspace — no rows exist for it

function dayAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

afterAll(async () => {
  await sb.from("accountsmind_metric_snapshots").delete().eq("workspace_id", WS);
});

describe("metric registry backfill coverage", () => {
  it("timestamp-derivable metrics have a backfill resolver", () => {
    for (const key of [
      "leads_total", "leads_new_this_month", "calls_total", "calls_this_month",
      "call_minutes_this_month", "successful_calls_this_month",
      "positive_sentiment_calls_this_month", "agents_total",
      "ai_cost_this_month_usd", "provider_requests_this_month",
      "provider_error_rate_this_month", "call_cost_this_month",
    ]) {
      expect(METRIC_REGISTRY[key]?.backfill, key).toBeTypeOf("function");
    }
  });

  it("current-state metrics stay non-backfillable", () => {
    for (const key of [
      "leads_qualified", "leads_callback_requested", "meetings_requested", "campaigns_active",
    ]) {
      expect(METRIC_REGISTRY[key]?.backfill, key).toBeUndefined();
    }
  });
});

describe("ensureMetricHistoryBackfillServer", () => {
  it("skips when no backfillable keys are requested", async () => {
    const res = await ensureMetricHistoryBackfillServer(WS, ["leads_qualified", "campaigns_active"]);
    expect(res.skipped).toBe(true);
    expect(res.backfilled).toBe(0);
  });

  it("backfills past days but never overwrites an existing snapshot", async () => {
    // Pre-seed one "real" snapshot 5 days ago — backfill must leave it alone.
    const seededDay = dayAgo(5);
    const { error: seedErr } = await sb.from("accountsmind_metric_snapshots").insert({
      workspace_id: WS,
      metric_key:   "calls_total",
      captured_on:  seededDay,
      value:        42,
    });
    expect(seedErr).toBeNull();

    const res = await ensureMetricHistoryBackfillServer(WS, ["calls_total", "leads_qualified"], 14);
    expect(res.skipped).toBe(false);
    // 14 days minus the seeded one
    expect(res.backfilled).toBe(13);

    const { data: rows } = await sb.from("accountsmind_metric_snapshots")
      .select("metric_key, captured_on, value")
      .eq("workspace_id", WS)
      .order("captured_on", { ascending: true });

    const callRows = (rows ?? []).filter((r: any) => r.metric_key === "calls_total");
    expect(callRows.length).toBe(14);
    // Seeded row untouched; backfilled days are 0 for an empty workspace.
    const seeded = callRows.find((r: any) => r.captured_on === seededDay);
    expect(Number(seeded.value)).toBe(42);
    for (const r of callRows) {
      if (r.captured_on !== seededDay) expect(Number(r.value)).toBe(0);
    }
    // Non-backfillable key got no rows.
    expect((rows ?? []).filter((r: any) => r.metric_key === "leads_qualified").length).toBe(0);
  });

  it("is a no-op once the window is full", async () => {
    const res = await ensureMetricHistoryBackfillServer(WS, ["calls_total"], 14);
    expect(res.skipped).toBe(true);
    expect(res.backfilled).toBe(0);
  });

  it("series read now returns enough points for a sparkline", async () => {
    const series = await getMetricSeriesServer(WS, ["calls_total"], 14);
    expect(series.calls_total.length).toBeGreaterThanOrEqual(2);
  });
});
