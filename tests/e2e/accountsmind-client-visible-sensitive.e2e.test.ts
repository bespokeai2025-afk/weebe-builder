/**
 * E2E guard: the client-visible AccountsMind path (getClientVisibleConfig →
 * getClientVisibleDashboardServer) must NEVER return admin-only financial
 * (sensitive) metric values or history series — even when widget/stat rows in
 * the DB were tampered to client_visible=true for a sensitive metric.
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random workspace id and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/accountsmind-client-visible-sensitive.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  METRIC_REGISTRY,
  sanitizeGeneratedConfig,
  listActiveConfigServer,
  getClientVisibleDashboardServer,
} from "@/lib/accountsmind/accountsmind-config.server";

const sb = supabaseAdmin as any;
const WS = randomUUID(); // throw-away workspace — no real rows exist for it

const SENSITIVE_KEYS = Object.values(METRIC_REGISTRY)
  .filter((m) => m.sensitive)
  .map((m) => m.key);
const SAFE_TREND_KEY = "calls_total";
const SENSITIVE_KEY = "ai_cost_this_month_usd";
const SENSITIVE_KEY_2 = "call_cost_this_month";

function dayAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  // Widgets: one safe client-visible trend widget, one TAMPERED sensitive
  // trend widget marked client_visible=true (should be impossible via the
  // sanitiser — this simulates the regression), and one normal sensitive
  // widget with client_visible=false.
  const { error: wErr } = await sb.from("accountsmind_widget_defs").insert([
    {
      workspace_id: WS, widget_key: "safe_calls_trend", title: "Calls trend",
      widget_type: "trend", metric_key: SAFE_TREND_KEY, format: "count",
      client_visible: true, risk_level: "low", status: "active",
    },
    {
      workspace_id: WS, widget_key: "tampered_cost_trend", title: "AI cost trend",
      widget_type: "trend", metric_key: SENSITIVE_KEY, format: "currency",
      client_visible: true, risk_level: "high", status: "active",
    },
    {
      workspace_id: WS, widget_key: "internal_call_cost", title: "Call cost",
      widget_type: "progress", metric_key: SENSITIVE_KEY_2, format: "currency",
      client_visible: false, risk_level: "high", status: "active",
    },
  ]);
  expect(wErr).toBeNull();

  // Stats: one safe client-visible, one TAMPERED sensitive client-visible.
  const { error: sErr } = await sb.from("accountsmind_stat_defs").insert([
    {
      workspace_id: WS, stat_key: "safe_leads_stat", label: "Total leads",
      metric_key: "leads_total", format: "count",
      client_visible: true, risk_level: "low", status: "active",
    },
    {
      workspace_id: WS, stat_key: "tampered_cost_stat", label: "AI cost",
      metric_key: SENSITIVE_KEY, format: "currency",
      client_visible: true, risk_level: "high", status: "active",
    },
  ]);
  expect(sErr).toBeNull();

  // Seed history snapshots for BOTH sensitive metrics and the safe one, so a
  // leak would be observable in the returned series.
  const rows: any[] = [];
  for (const key of [SAFE_TREND_KEY, SENSITIVE_KEY, SENSITIVE_KEY_2]) {
    for (let d = 1; d <= 5; d++) {
      rows.push({
        workspace_id: WS, metric_key: key, captured_on: dayAgo(d), value: 100 + d,
      });
    }
  }
  const { error: snapErr } = await sb.from("accountsmind_metric_snapshots").insert(rows);
  expect(snapErr).toBeNull();
});

afterAll(async () => {
  await sb.from("accountsmind_widget_defs").delete().eq("workspace_id", WS);
  await sb.from("accountsmind_stat_defs").delete().eq("workspace_id", WS);
  await sb.from("accountsmind_metric_snapshots").delete().eq("workspace_id", WS);
});

describe("metric registry sensitivity flags", () => {
  it("billing/cost metrics stay marked sensitive", () => {
    expect(METRIC_REGISTRY[SENSITIVE_KEY]?.sensitive).toBe(true);
    expect(METRIC_REGISTRY[SENSITIVE_KEY_2]?.sensitive).toBe(true);
    expect(SENSITIVE_KEYS.length).toBeGreaterThanOrEqual(2);
  });
});

describe("sanitizeGeneratedConfig", () => {
  it("force-strips client_visible from sensitive stats and widgets", () => {
    const cfg = sanitizeGeneratedConfig({
      name: "t", purpose: "t",
      fields: [{
        field_key: "budget", label: "Budget", field_type: "currency",
        entity_type: "client", appears_in: "client_section", required: false,
        options: [], client_visible: true, description: "",
      }],
      stats: [{
        stat_key: "cost", label: "Cost", metric_key: SENSITIVE_KEY,
        format: "currency", client_visible: true, description: "",
      }],
      widgets: [{
        widget_key: "cost_w", title: "Cost", widget_type: "trend",
        metric_key: SENSITIVE_KEY_2, format: "currency",
        client_visible: true, description: "",
      }],
      risks: [], test_plan: [],
    } as any);
    expect(cfg.stats[0].client_visible).toBe(false);
    expect(cfg.widgets[0].client_visible).toBe(false);
    expect(cfg.fields[0].client_visible).toBe(false);
  });
});

describe("getClientVisibleDashboardServer (client path)", () => {
  it("never returns sensitive metric values or series, even for tampered client_visible rows", async () => {
    const res = await getClientVisibleDashboardServer(WS);

    // Tampered sensitive defs are dropped from the returned config.
    const widgetKeys = res.widgets.map((w: any) => w.metric_key);
    const statKeys = res.stats.map((s: any) => s.metric_key);
    for (const k of SENSITIVE_KEYS) {
      expect(widgetKeys, `widget metric ${k}`).not.toContain(k);
      expect(statKeys, `stat metric ${k}`).not.toContain(k);
    }
    // Safe defs still come through.
    expect(widgetKeys).toContain(SAFE_TREND_KEY);
    expect(statKeys).toContain("leads_total");

    // No sensitive metric value is computed/returned.
    for (const k of SENSITIVE_KEYS) {
      expect(Object.keys(res.metrics), `metrics ${k}`).not.toContain(k);
    }
    expect(res.metrics[SAFE_TREND_KEY]).toBeTypeOf("number");

    // No sensitive series is returned — despite seeded snapshot history and a
    // tampered client_visible trend widget referencing it.
    for (const k of SENSITIVE_KEYS) {
      expect(Object.keys(res.series), `series ${k}`).not.toContain(k);
    }
    // Safe sparkline series still works.
    expect(res.series[SAFE_TREND_KEY]?.length).toBeGreaterThanOrEqual(2);
  });

  it("internal (non-client) config read still sees the sensitive rows", async () => {
    // Admin dashboard path is unaffected — sensitive widgets stay visible
    // internally; only the client path strips them.
    const cfg = await listActiveConfigServer(WS, { includeNonActive: true });
    const keys = cfg.widgets.map((w: any) => w.metric_key);
    expect(keys).toContain(SENSITIVE_KEY);
    expect(keys).toContain(SENSITIVE_KEY_2);
  });
});
