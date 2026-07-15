// ── AccountsMind Config Builder — server-only core ─────────────────────────────
// SystemMind drafts WORKSPACE-SCOPED AccountsMind configuration (custom fields,
// stat definitions, dashboard widgets, client-safe section) in natural language.
// Drafts ride the SystemMind Automation Layer hub (systemmind_generated_actions,
// action_kind = "accountsmind_config") and NOTHING becomes live config until the
// draft is approved through the HiveMind approval pipeline; activation inserts
// versioned ACTIVE rows into accountsmind_field_defs / _stat_defs / _widget_defs.
//
// Safety invariants (same as the automation layer — do not weaken):
//   • workspace_id comes ONLY from server context — never client input or model
//     output.
//   • No formulas / arbitrary expressions: stats & widgets may ONLY reference a
//     metric_key from the deterministic METRIC_REGISTRY whitelist below.
//   • Billing / revenue / cost related config is classified high-risk and is
//     never client-visible unless a human approves a draft that says so — and
//     high-risk items are force-stripped of client visibility at sanitise time.
//   • Every generation, activation, status change and rollback writes a
//     systemmind_audit_logs row.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  writeSystemMindAudit,
  isClaudeEnabled,
} from "@/lib/systemmind/systemmind-automation.server";
import { assertNoCredentialValues } from "@/lib/systemmind/systemmind-generators.server";

type Sb = any;

// ═══════════════════════════════════════════════════════════════════════════
// Metric registry — the ONLY metrics stats/widgets may reference. Every value
// is computed live from real workspace data; there are no formula fields.
// ═══════════════════════════════════════════════════════════════════════════

export interface MetricMeta {
  key:         string;
  label:       string;
  description: string;
  format:      "number" | "currency" | "percentage" | "duration" | "count";
  /** billing/revenue/cost metrics are high-risk (never client-visible by default) */
  sensitive:   boolean;
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function count(sb: Sb, table: string, build: (q: any) => any): Promise<number> {
  const { count: c, error } = await build(
    sb.from(table).select("id", { count: "exact", head: true }),
  );
  if (error) return 0;
  return c ?? 0;
}

/**
 * Historical ("as of day D") resolver used by the one-off sparkline backfill.
 * dayEndIso = exclusive upper bound (start of D+1 UTC); monthStartIso = start
 * of the month CONTAINING day D. Only metrics whose historical value can be
 * derived from row timestamps get one — current-state metrics (qualified
 * leads, active campaigns, callbacks…) cannot be backfilled and keep the
 * "Collecting daily history" note until real snapshots accumulate.
 */
type BackfillResolve = (sb: Sb, workspaceId: string, dayEndIso: string, monthStartIso: string) => Promise<number>;

export const METRIC_REGISTRY: Record<string, MetricMeta & {
  resolve: (sb: Sb, workspaceId: string) => Promise<number>;
  backfill?: BackfillResolve;
}> = {
  leads_total: {
    key: "leads_total", label: "Total leads", format: "count", sensitive: false,
    description: "All leads in the workspace CRM.",
    resolve: (sb, ws) => count(sb, "leads", (q) => q.eq("workspace_id", ws)),
    backfill: (sb, ws, dayEnd) => count(sb, "leads", (q) => q.eq("workspace_id", ws).lt("created_at", dayEnd)),
  },
  leads_new_this_month: {
    key: "leads_new_this_month", label: "New leads this month", format: "count", sensitive: false,
    description: "Leads created since the start of the current month.",
    resolve: (sb, ws) => count(sb, "leads", (q) => q.eq("workspace_id", ws).gte("created_at", monthStartIso())),
    backfill: (sb, ws, dayEnd, monthStart) => count(sb, "leads", (q) => q.eq("workspace_id", ws).gte("created_at", monthStart).lt("created_at", dayEnd)),
  },
  leads_qualified: {
    key: "leads_qualified", label: "Qualified leads", format: "count", sensitive: false,
    description: "Leads currently in interested/qualified status.",
    resolve: (sb, ws) => count(sb, "leads", (q) => q.eq("workspace_id", ws).in("status", ["interested", "qualified"])),
  },
  leads_callback_requested: {
    key: "leads_callback_requested", label: "Callbacks requested", format: "count", sensitive: false,
    description: "Leads that have requested a callback.",
    resolve: (sb, ws) => count(sb, "leads", (q) => q.eq("workspace_id", ws).eq("callback_requested", true)),
  },
  meetings_requested: {
    key: "meetings_requested", label: "Meetings requested", format: "count", sensitive: false,
    description: "Leads that asked for a meeting/appointment.",
    resolve: (sb, ws) => count(sb, "leads", (q) => q.eq("workspace_id", ws).eq("meeting_requested", true)),
  },
  calls_total: {
    key: "calls_total", label: "Total calls", format: "count", sensitive: false,
    description: "All AI agent calls recorded for this workspace.",
    resolve: (sb, ws) => count(sb, "calls", (q) => q.eq("workspace_id", ws)),
    backfill: (sb, ws, dayEnd) => count(sb, "calls", (q) => q.eq("workspace_id", ws).lt("created_at", dayEnd)),
  },
  calls_this_month: {
    key: "calls_this_month", label: "Calls this month", format: "count", sensitive: false,
    description: "AI agent calls since the start of the current month.",
    resolve: (sb, ws) => count(sb, "calls", (q) => q.eq("workspace_id", ws).gte("created_at", monthStartIso())),
    backfill: (sb, ws, dayEnd, monthStart) => count(sb, "calls", (q) => q.eq("workspace_id", ws).gte("created_at", monthStart).lt("created_at", dayEnd)),
  },
  call_minutes_this_month: {
    key: "call_minutes_this_month", label: "Call minutes this month", format: "duration", sensitive: false,
    description: "Total minutes of AI calls since the start of the month.",
    resolve: async (sb, ws) => {
      const { data } = await sb.from("calls").select("duration_seconds")
        .eq("workspace_id", ws).gte("created_at", monthStartIso()).limit(5000);
      const secs = (data ?? []).reduce((a: number, r: any) => a + (r.duration_seconds ?? 0), 0);
      return Math.round(secs / 60);
    },
    backfill: async (sb, ws, dayEnd, monthStart) => {
      const { data } = await sb.from("calls").select("duration_seconds")
        .eq("workspace_id", ws).gte("created_at", monthStart).lt("created_at", dayEnd).limit(5000);
      const secs = (data ?? []).reduce((a: number, r: any) => a + (r.duration_seconds ?? 0), 0);
      return Math.round(secs / 60);
    },
  },
  successful_calls_this_month: {
    key: "successful_calls_this_month", label: "Successful calls this month", format: "count", sensitive: false,
    description: "Calls flagged successful since the start of the month.",
    resolve: (sb, ws) => count(sb, "calls", (q) => q.eq("workspace_id", ws).eq("call_successful", true).gte("created_at", monthStartIso())),
    backfill: (sb, ws, dayEnd, monthStart) => count(sb, "calls", (q) => q.eq("workspace_id", ws).eq("call_successful", true).gte("created_at", monthStart).lt("created_at", dayEnd)),
  },
  positive_sentiment_calls_this_month: {
    key: "positive_sentiment_calls_this_month", label: "Positive calls this month", format: "count", sensitive: false,
    description: "Calls with positive sentiment since the start of the month.",
    resolve: (sb, ws) => count(sb, "calls", (q) => q.eq("workspace_id", ws).ilike("sentiment", "%positive%").gte("created_at", monthStartIso())),
    backfill: (sb, ws, dayEnd, monthStart) => count(sb, "calls", (q) => q.eq("workspace_id", ws).ilike("sentiment", "%positive%").gte("created_at", monthStart).lt("created_at", dayEnd)),
  },
  agents_total: {
    key: "agents_total", label: "AI agents", format: "count", sensitive: false,
    description: "AI agents built in this workspace.",
    resolve: (sb, ws) => count(sb, "agents", (q) => q.eq("workspace_id", ws)),
    backfill: (sb, ws, dayEnd) => count(sb, "agents", (q) => q.eq("workspace_id", ws).lt("created_at", dayEnd)),
  },
  campaigns_active: {
    key: "campaigns_active", label: "Active campaigns", format: "count", sensitive: false,
    description: "Email/follow-up campaigns currently active.",
    resolve: (sb, ws) => count(sb, "hexmail_campaigns", (q) => q.eq("workspace_id", ws).eq("status", "active")),
  },
  ai_cost_this_month_usd: {
    key: "ai_cost_this_month_usd", label: "AI provider cost this month", format: "currency", sensitive: true,
    description: "Sum of logged provider usage cost (USD) since the start of the month.",
    resolve: async (sb, ws) => {
      const { data } = await sb.from("provider_usage_log").select("cost_usd")
        .eq("workspace_id", ws).gte("created_at", monthStartIso()).limit(5000);
      const total = (data ?? []).reduce((a: number, r: any) => a + Number(r.cost_usd ?? 0), 0);
      return Math.round(total * 100) / 100;
    },
    backfill: async (sb, ws, dayEnd, monthStart) => {
      const { data } = await sb.from("provider_usage_log").select("cost_usd")
        .eq("workspace_id", ws).gte("created_at", monthStart).lt("created_at", dayEnd).limit(5000);
      const total = (data ?? []).reduce((a: number, r: any) => a + Number(r.cost_usd ?? 0), 0);
      return Math.round(total * 100) / 100;
    },
  },
  provider_requests_this_month: {
    key: "provider_requests_this_month", label: "Provider requests this month", format: "count", sensitive: false,
    description: "Total logged provider API requests since the start of the month.",
    resolve: async (sb, ws) => {
      const { data } = await sb.from("provider_usage_log").select("requests")
        .eq("workspace_id", ws).gte("created_at", monthStartIso()).limit(5000);
      return (data ?? []).reduce((a: number, r: any) => a + (r.requests ?? 0), 0);
    },
    backfill: async (sb, ws, dayEnd, monthStart) => {
      const { data } = await sb.from("provider_usage_log").select("requests")
        .eq("workspace_id", ws).gte("created_at", monthStart).lt("created_at", dayEnd).limit(5000);
      return (data ?? []).reduce((a: number, r: any) => a + (r.requests ?? 0), 0);
    },
  },
  provider_error_rate_this_month: {
    key: "provider_error_rate_this_month", label: "Provider error rate this month", format: "percentage", sensitive: false,
    description: "Errors ÷ requests across all logged provider usage since the start of the month.",
    resolve: async (sb, ws) => {
      const { data } = await sb.from("provider_usage_log").select("requests, errors")
        .eq("workspace_id", ws).gte("created_at", monthStartIso()).limit(5000);
      const rows = data ?? [];
      const req = rows.reduce((a: number, r: any) => a + (r.requests ?? 0), 0);
      const err = rows.reduce((a: number, r: any) => a + (r.errors ?? 0), 0);
      return req > 0 ? Math.round((err / req) * 1000) / 10 : 0;
    },
    backfill: async (sb, ws, dayEnd, monthStart) => {
      const { data } = await sb.from("provider_usage_log").select("requests, errors")
        .eq("workspace_id", ws).gte("created_at", monthStart).lt("created_at", dayEnd).limit(5000);
      const rows = data ?? [];
      const req = rows.reduce((a: number, r: any) => a + (r.requests ?? 0), 0);
      const err = rows.reduce((a: number, r: any) => a + (r.errors ?? 0), 0);
      return req > 0 ? Math.round((err / req) * 1000) / 10 : 0;
    },
  },
  call_cost_this_month: {
    key: "call_cost_this_month", label: "Call cost this month", format: "currency", sensitive: true,
    description: "Sum of per-call cost since the start of the month (major units).",
    resolve: async (sb, ws) => {
      const { data } = await sb.from("calls").select("cost_cents")
        .eq("workspace_id", ws).gte("created_at", monthStartIso()).limit(5000);
      const cents = (data ?? []).reduce((a: number, r: any) => a + (r.cost_cents ?? 0), 0);
      return Math.round(cents) / 100;
    },
    backfill: async (sb, ws, dayEnd, monthStart) => {
      const { data } = await sb.from("calls").select("cost_cents")
        .eq("workspace_id", ws).gte("created_at", monthStart).lt("created_at", dayEnd).limit(5000);
      const cents = (data ?? []).reduce((a: number, r: any) => a + (r.cost_cents ?? 0), 0);
      return Math.round(cents) / 100;
    },
  },
};

export const METRIC_KEYS = Object.keys(METRIC_REGISTRY);

export async function computeMetricsServer(
  workspaceId: string,
  keys: string[],
): Promise<Record<string, number | null>> {
  const sb = supabaseAdmin as any;
  const out: Record<string, number | null> = {};
  const unique = [...new Set(keys)].filter((k) => METRIC_REGISTRY[k]);
  await Promise.all(unique.map(async (k) => {
    try {
      out[k] = await METRIC_REGISTRY[k].resolve(sb, workspaceId);
    } catch {
      out[k] = null;
    }
  }));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Metric snapshots — one row per (workspace, metric, UTC day) so trend /
// progress widgets can render real historical series. Server-write-only
// table (accountsmind_metric_snapshots); populated opportunistically from
// every metric computation plus SystemMind health-check runs. Best-effort:
// never throws (a snapshot failure must not break a dashboard read).
// ═══════════════════════════════════════════════════════════════════════════

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Retention window for metric snapshots. Reads cap at 90 days
// (getMetricSeriesServer), so anything older than 180 days is dead weight —
// prune it during the daily sweep to keep the table from bloating forever
// (this project has a history of unbounded tables causing query timeouts).
const SNAPSHOT_RETENTION_DAYS = 180;

/**
 * Best-effort prune of snapshot rows older than the retention window.
 * Never throws; a prune failure must not block the tick.
 */
async function pruneOldMetricSnapshotsServer(): Promise<number> {
  try {
    const sb = supabaseAdmin as any;
    const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const { data, error } = await sb.from("accountsmind_metric_snapshots")
      .delete()
      .lt("captured_on", cutoff)
      .select("id");
    if (error) {
      console.warn("[accountsmind] snapshot retention prune failed:", error.message);
      return 0;
    }
    const pruned = (data ?? []).length;
    if (pruned > 0) {
      console.log(`[accountsmind] pruned ${pruned} metric snapshot rows older than ${cutoff}`);
    }
    return pruned;
  } catch (err: any) {
    console.warn("[accountsmind] snapshot retention prune failed:", err?.message ?? err);
    return 0;
  }
}

export async function snapshotMetricsServer(
  workspaceId: string,
  metrics: Record<string, number | null>,
): Promise<void> {
  try {
    const sb = supabaseAdmin as any;
    const day = todayUtcDate();
    const rows = Object.entries(metrics)
      .filter(([k, v]) => v != null && Number.isFinite(v) && METRIC_REGISTRY[k])
      .map(([metric_key, value]) => ({
        workspace_id: workspaceId,
        metric_key,
        captured_on:  day,
        value,
        updated_at:   new Date().toISOString(),
      }));
    if (rows.length === 0) return;
    const { error } = await sb.from("accountsmind_metric_snapshots")
      .upsert(rows, { onConflict: "workspace_id,metric_key,captured_on" });
    if (error) console.warn("[accountsmind] metric snapshot upsert failed:", error.message);
  } catch (err: any) {
    console.warn("[accountsmind] metric snapshot failed:", err?.message ?? err);
  }
}

/** Compute + snapshot every metric referenced by this workspace's ACTIVE config. */
export async function snapshotActiveConfigMetricsServer(workspaceId: string): Promise<void> {
  try {
    const config = await listActiveConfigServer(workspaceId);
    const keys = [
      ...config.stats.map((s: any) => s.metric_key),
      ...config.widgets.map((w: any) => w.metric_key),
    ].filter(Boolean);
    if (keys.length === 0) return;
    const metrics = await computeMetricsServer(workspaceId, keys);
    await snapshotMetricsServer(workspaceId, metrics);
  } catch (err: any) {
    console.warn("[accountsmind] active-config snapshot failed:", err?.message ?? err);
  }
}

/**
 * Daily sweep for the background tick: snapshot every workspace that has
 * active stat/widget defs, but only once per UTC day per workspace (the tick
 * runs every 5 minutes — skip workspaces already captured today).
 */
export async function runMetricSnapshotSweepServer(): Promise<{
  workspaces: number;
  snapshotted: number;
  skipped: number;
  pruned: number;
}> {
  const out = { workspaces: 0, snapshotted: 0, skipped: 0, pruned: 0 };
  try {
    const sb = supabaseAdmin as any;
    const day = todayUtcDate();

    const [statsRes, widgetsRes] = await Promise.all([
      sb.from("accountsmind_stat_defs").select("workspace_id")
        .eq("status", "active").eq("is_deleted", false).limit(2000),
      sb.from("accountsmind_widget_defs").select("workspace_id")
        .eq("status", "active").eq("is_deleted", false).limit(2000),
    ]);
    const wsIds = [...new Set([
      ...(statsRes.data ?? []).map((r: any) => r.workspace_id),
      ...(widgetsRes.data ?? []).map((r: any) => r.workspace_id),
    ])].filter(Boolean) as string[];
    out.workspaces = wsIds.length;
    if (wsIds.length === 0) return out;

    const { data: doneToday } = await sb.from("accountsmind_metric_snapshots")
      .select("workspace_id")
      .in("workspace_id", wsIds)
      .eq("captured_on", day)
      .limit(2000);
    const doneSet = new Set((doneToday ?? []).map((r: any) => r.workspace_id));

    for (const ws of wsIds) {
      if (doneSet.has(ws)) { out.skipped++; continue; }
      await snapshotActiveConfigMetricsServer(ws);
      out.snapshotted++;
    }

    // Retention prune: only when this tick actually snapshotted something
    // (i.e. roughly once per UTC day, at the first tick of a new day) so the
    // 5-minute tick doesn't issue a delete scan every run. Best-effort.
    if (out.snapshotted > 0) {
      out.pruned = await pruneOldMetricSnapshotsServer();
    }
  } catch (err: any) {
    console.warn("[accountsmind] snapshot sweep failed:", err?.message ?? err);
  }
  return out;
}

export interface MetricSeriesPoint { date: string; value: number }

export async function getMetricSeriesServer(
  workspaceId: string,
  keys: string[],
  days = 30,
): Promise<Record<string, MetricSeriesPoint[]>> {
  const sb = supabaseAdmin as any;
  const unique = [...new Set(keys)].filter((k) => METRIC_REGISTRY[k]);
  const out: Record<string, MetricSeriesPoint[]> = {};
  for (const k of unique) out[k] = [];
  if (unique.length === 0) return out;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await sb.from("accountsmind_metric_snapshots")
    .select("metric_key, captured_on, value")
    .eq("workspace_id", workspaceId)
    .in("metric_key", unique)
    .gte("captured_on", since)
    .order("captured_on", { ascending: true })
    .limit(unique.length * (days + 1));
  if (error) {
    console.warn("[accountsmind] metric series read failed:", error.message);
    return out;
  }
  for (const row of data ?? []) {
    if (!out[row.metric_key]) continue;
    out[row.metric_key].push({ date: row.captured_on, value: Number(row.value) });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// History backfill — compute past daily values retroactively from row
// timestamps so trend/progress sparklines render immediately for existing
// workspaces instead of waiting days for real snapshots to accumulate.
//
// Rules:
//   • Only metrics with a `backfill` resolver participate; current-state
//     metrics (qualified leads, active campaigns…) can't be reconstructed
//     and keep the "Collecting daily history" note.
//   • Only days STRICTLY BEFORE today (UTC) are backfilled — today's value
//     comes from the normal snapshot path.
//   • Existing snapshot rows are NEVER overwritten (insert with
//     ignoreDuplicates), so real captured history always wins.
//   • Best-effort: never throws; a backfill failure must not break a
//     dashboard read. Self-limiting: once every day in the window has a
//     row, the guard is a single cheap SELECT.
// ═══════════════════════════════════════════════════════════════════════════

const BACKFILL_DAYS = 30;
const backfillInFlight = new Set<string>();

/** Start of D+1 UTC (exclusive upper bound for "as of end of day D"). */
function dayEndIsoOf(day: string): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

/** Start of the UTC month containing day D. */
function monthStartIsoOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function ensureMetricHistoryBackfillServer(
  workspaceId: string,
  keys: string[],
  days = BACKFILL_DAYS,
): Promise<{ backfilled: number; skipped: boolean }> {
  const out = { backfilled: 0, skipped: false };
  try {
    const backfillable = [...new Set(keys)].filter((k) => METRIC_REGISTRY[k]?.backfill);
    if (backfillable.length === 0) { out.skipped = true; return out; }
    if (backfillInFlight.has(workspaceId)) { out.skipped = true; return out; }
    backfillInFlight.add(workspaceId);
    try {
      const sb = supabaseAdmin as any;
      const today = todayUtcDate();
      const dayList: string[] = [];
      for (let i = days; i >= 1; i--) {
        dayList.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      }

      const { data: existing, error: readErr } = await sb.from("accountsmind_metric_snapshots")
        .select("metric_key, captured_on")
        .eq("workspace_id", workspaceId)
        .in("metric_key", backfillable)
        .gte("captured_on", dayList[0])
        .lt("captured_on", today)
        .limit(backfillable.length * (days + 1));
      if (readErr) {
        console.warn("[accountsmind] backfill guard read failed:", readErr.message);
        return out;
      }
      const have = new Set((existing ?? []).map((r: any) => `${r.metric_key}|${r.captured_on}`));

      const missing: Array<{ key: string; day: string }> = [];
      for (const key of backfillable) {
        for (const day of dayList) {
          if (!have.has(`${key}|${day}`)) missing.push({ key, day });
        }
      }
      if (missing.length === 0) { out.skipped = true; return out; }

      const now = new Date().toISOString();
      const rows: Array<Record<string, unknown>> = [];
      const CHUNK = 8;
      for (let i = 0; i < missing.length; i += CHUNK) {
        await Promise.all(missing.slice(i, i + CHUNK).map(async ({ key, day }) => {
          try {
            const v = await METRIC_REGISTRY[key].backfill!(
              sb, workspaceId, dayEndIsoOf(day), monthStartIsoOf(day),
            );
            if (v != null && Number.isFinite(v)) {
              rows.push({
                workspace_id: workspaceId,
                metric_key:   key,
                captured_on:  day,
                value:        v,
                updated_at:   now,
              });
            }
          } catch { /* skip this day — best-effort */ }
        }));
      }
      if (rows.length === 0) return out;

      // ignoreDuplicates: never overwrite a real captured snapshot.
      const { error: insErr } = await sb.from("accountsmind_metric_snapshots")
        .upsert(rows, { onConflict: "workspace_id,metric_key,captured_on", ignoreDuplicates: true });
      if (insErr) {
        console.warn("[accountsmind] backfill insert failed:", insErr.message);
        return out;
      }
      out.backfilled = rows.length;
    } finally {
      backfillInFlight.delete(workspaceId);
    }
  } catch (err: any) {
    console.warn("[accountsmind] metric history backfill failed:", err?.message ?? err);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Draft schema (strict validation of model output)
// ═══════════════════════════════════════════════════════════════════════════

const FIELD_TYPES = ["text","number","currency","percentage","date","boolean","single_select","multi_select","status"] as const;
const ENTITY_TYPES = ["client","lead","contact","campaign","agent","account"] as const;
const WIDGET_TYPES = ["stat_card","breakdown_list","progress","trend"] as const;
const FORMATS = ["number","currency","percentage","duration","count"] as const;

const keyRe = /^[a-z][a-z0-9_]{1,60}$/;

const FieldDefSchema = z.object({
  field_key:      z.string().regex(keyRe),
  label:          z.string().min(1).max(120),
  field_type:     z.enum(FIELD_TYPES),
  entity_type:    z.enum(ENTITY_TYPES).default("client"),
  appears_in:     z.enum(["client_section","dashboard","both"]).default("client_section"),
  required:       z.boolean().default(false),
  options:        z.array(z.string().max(80)).max(30).default([]),
  client_visible: z.boolean().default(false),
  description:    z.string().max(400).optional(),
});

const StatDefSchema = z.object({
  stat_key:       z.string().regex(keyRe),
  label:          z.string().min(1).max(120),
  metric_key:     z.string().max(80),
  format:         z.enum(FORMATS).default("number"),
  description:    z.string().max(400).optional(),
  client_visible: z.boolean().default(false),
});

const WidgetDefSchema = z.object({
  widget_key:     z.string().regex(keyRe),
  title:          z.string().min(1).max(120),
  widget_type:    z.enum(WIDGET_TYPES).default("stat_card"),
  metric_key:     z.string().max(80),
  format:         z.enum(FORMATS).default("number"),
  description:    z.string().max(400).optional(),
  client_visible: z.boolean().default(false),
});

const GeneratedConfigSchema = z.object({
  name:      z.string().min(1).max(200),
  purpose:   z.string().min(1).max(2000),
  fields:    z.array(FieldDefSchema).max(20).default([]),
  stats:     z.array(StatDefSchema).max(20).default([]),
  widgets:   z.array(WidgetDefSchema).max(20).default([]),
  risks:     z.array(z.string().max(300)).max(20).default([]),
  test_plan: z.array(z.string().max(400)).max(20).default([]),
});

export type GeneratedAccountsConfig = z.infer<typeof GeneratedConfigSchema>;

// ── Risk classification ────────────────────────────────────────────────────────
const SENSITIVE_WORDS = [
  "billing", "invoice", "revenue", "price", "pricing", "payment", "cost",
  "margin", "profit", "recharge", "charge", "fee",
];

export function classifyConfigRisk(cfg: GeneratedAccountsConfig): {
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
} {
  const reasons: string[] = [];

  const sensitiveMetric = [...cfg.stats, ...cfg.widgets]
    .find((s) => METRIC_REGISTRY[s.metric_key]?.sensitive);
  if (sensitiveMetric) reasons.push("References billing/cost metrics");

  const blob = JSON.stringify(cfg).toLowerCase();
  const hit = SENSITIVE_WORDS.find((w) => blob.includes(w));
  if (hit) reasons.push(`Touches financial configuration ("${hit}")`);

  const clientVisibleSensitive = [...cfg.stats, ...cfg.widgets]
    .find((s) => s.client_visible && METRIC_REGISTRY[s.metric_key]?.sensitive);
  if (clientVisibleSensitive) reasons.push("Attempts to expose a billing/cost metric to clients");

  const currencyField = cfg.fields.find((f) => f.field_type === "currency");
  const mediumReasons: string[] = [];
  if (currencyField) mediumReasons.push("Defines currency-valued custom fields");
  if (cfg.fields.length + cfg.stats.length + cfg.widgets.length > 15) {
    mediumReasons.push("Large configuration change (many items at once)");
  }

  if (reasons.length > 0) return { riskLevel: "high", riskReasons: [...reasons, ...mediumReasons] };
  if (mediumReasons.length > 0) return { riskLevel: "medium", riskReasons: mediumReasons };
  return { riskLevel: "low", riskReasons: [] };
}

// ── Sanitiser (defence-in-depth after zod parse) ───────────────────────────────
export function sanitizeGeneratedConfig(cfg: GeneratedAccountsConfig): GeneratedAccountsConfig {
  const seen = new Set<string>();
  const dedupe = <T extends { [k: string]: any }>(items: T[], keyProp: string): T[] =>
    items.filter((i) => {
      const k = `${keyProp}:${i[keyProp]}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  // Stats/widgets must reference whitelisted metrics only.
  const stats = dedupe(cfg.stats, "stat_key").filter((s) => !!METRIC_REGISTRY[s.metric_key]);
  const widgets = dedupe(cfg.widgets, "widget_key").filter((w) => !!METRIC_REGISTRY[w.metric_key]);
  const fields = dedupe(cfg.fields, "field_key");

  // Sensitive metrics are NEVER client-visible, regardless of what the model
  // (or a tampered draft) says.
  for (const s of stats)   if (METRIC_REGISTRY[s.metric_key].sensitive) s.client_visible = false;
  for (const w of widgets) if (METRIC_REGISTRY[w.metric_key].sensitive) w.client_visible = false;
  // Currency custom fields are internal-only by default too.
  for (const f of fields)  if (f.field_type === "currency") f.client_visible = false;

  return { ...cfg, fields, stats, widgets };
}

// ═══════════════════════════════════════════════════════════════════════════
// Generation
// ═══════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(): string {
  const metricList = Object.values(METRIC_REGISTRY)
    .map((m) => `- ${m.key} (${m.format}${m.sensitive ? ", SENSITIVE-INTERNAL-ONLY" : ""}) — ${m.description}`)
    .join("\n");
  return `You are SystemMind, the AI CTO of the WEBEE platform. You design WORKSPACE-SCOPED AccountsMind configuration DRAFTS: custom fields, stat definitions, and dashboard widgets, including which items are safe to show in the client-facing section. You NEVER apply anything — a human approves the draft first.

AVAILABLE METRICS (stats and widgets may ONLY use these metric_key values — no formulas, no custom expressions):
${metricList}

RULES:
- field_key / stat_key / widget_key: lowercase snake_case, unique, descriptive.
- field_type ∈ text|number|currency|percentage|date|boolean|single_select|multi_select|status. single_select/multi_select/status need "options".
- entity_type ∈ client|lead|contact|campaign|agent|account.
- client_visible: true ONLY for items that are unambiguously safe for the workspace's own clients to see. Metrics marked SENSITIVE-INTERNAL-ONLY must have client_visible=false.
- NEVER include API keys, credentials, or secrets anywhere.
- Keep it focused: at most ~6 fields, ~6 stats, ~6 widgets per draft.
- List real risks in "risks" and 3–6 manual test steps in "test_plan".

Return ONLY valid JSON:
{
  "name": "...",
  "purpose": "...",
  "fields":  [ { "field_key": "...", "label": "...", "field_type": "text", "entity_type": "client", "appears_in": "client_section", "required": false, "options": [], "client_visible": false, "description": "..." } ],
  "stats":   [ { "stat_key": "...", "label": "...", "metric_key": "leads_total", "format": "count", "client_visible": false, "description": "..." } ],
  "widgets": [ { "widget_key": "...", "title": "...", "widget_type": "stat_card", "metric_key": "calls_this_month", "format": "count", "client_visible": true, "description": "..." } ],
  "risks": ["..."],
  "test_plan": ["..."]
}`;
}

export interface GenerateConfigArgs {
  workspaceId:   string;
  userId:        string | null;
  description:   string;
  instructedBy?: "user" | "hivemind" | "admin";
}

export async function generateAccountsMindConfigDraftServer(args: GenerateConfigArgs): Promise<{
  runId: string;
  draftId: string;
  draft: Record<string, any>;
  modelUsed: string;
  provider: string;
  usedFallback: boolean;
  claudeEnabled: boolean;
  riskLevel: "low" | "medium" | "high";
}> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, description } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to generate.");

  const { data: run, error: runErr } = await sb.from("systemmind_runs").insert({
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    instructed_by:      instructedBy,
    run_type:           "accountsmind_config_generation",
    input_description:  description.slice(0, 4000),
    status:             "running",
  }).select("id").single();
  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  const runId = run.id as string;

  const claudeEnabled = isClaudeEnabled();

  // Industry seed: if the workspace has recorded its industry, start the
  // assistant from that industry's preset (labels/KPIs) instead of a blank page.
  let industrySeed = "";
  try {
    const { getWorkspaceIndustryServer } = await import("@/lib/accountsmind/industry.server");
    const { INDUSTRY_PRESETS } = await import("@/lib/accountsmind/industry-presets.shared");
    const industry = await getWorkspaceIndustryServer(workspaceId);
    const preset = industry ? INDUSTRY_PRESETS[industry] : null;
    if (preset) {
      const statLines = preset.stats.map((s) => `  - ${s.label} (${s.metric_key})`).join("\n");
      const widgetLines = preset.widgets.map((w) => `  - ${w.title} (${w.widget_type}, ${w.metric_key})`).join("\n");
      industrySeed = `\n\nWORKSPACE INDUSTRY: ${preset.label}. ${preset.assistantSeed}\nUse this industry preset as the STARTING POINT — keep its terminology and adapt it to the request:\nPreset stats:\n${statLines}\nPreset widgets:\n${widgetLines}`;
    }
  } catch { /* best-effort seed — never block generation */ }

  try {
    const routed = await routeGenerate({
      system:      buildSystemPrompt(),
      user:        `Design AccountsMind configuration for this request:\n\n"${description.slice(0, 3000)}"${industrySeed}\n\nRemember: draft only, strict JSON, whitelisted metric keys only.`,
      contentType: "systemmind_accountsmind_config",
      maxTokens:   4000,
      mode:        "manual",
      provider:    claudeEnabled ? "claude" : "openai",
      model:       claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
      settings:    {},
      workspaceId,
      sb,
    });

    let rawJson: unknown;
    try {
      const cleaned = routed.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      rawJson = JSON.parse(cleaned);
    } catch {
      throw new Error("Model returned invalid JSON — try again or rephrase the request.");
    }
    let parsed = GeneratedConfigSchema.parse(rawJson);
    parsed = sanitizeGeneratedConfig(parsed);
    assertNoCredentialValues(parsed, "AccountsMind config");
    if (parsed.fields.length + parsed.stats.length + parsed.widgets.length === 0) {
      throw new Error("Generated config had no valid items after safety filtering.");
    }

    const { riskLevel, riskReasons } = classifyConfigRisk(parsed);

    const payload = {
      name:    parsed.name,
      purpose: parsed.purpose,
      fields:  parsed.fields,
      stats:   parsed.stats,
      widgets: parsed.widgets,
      risks:   parsed.risks,
    };

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id:         workspaceId,
      run_id:               runId,
      created_by_user_id:   userId,
      source:               "systemmind",
      instructed_by:        instructedBy,
      action_kind:          "accountsmind_config",
      title:                parsed.name,
      purpose:              parsed.purpose,
      payload,
      required_credentials: [],
      test_plan:            parsed.test_plan,
      risk_level:           riskLevel,
      risk_reasons:         riskReasons,
      approval_required:    true,
      status:               "draft",
      model_provider:       routed.provider,
      model_id:             routed.model,
    }).select("*").single();
    if (draftErr) throw new Error(`Failed to save draft: ${draftErr.message}`);

    await sb.from("systemmind_runs").update({
      status: "completed",
      model_provider: routed.provider,
      model_id: routed.model,
      used_fallback: routed.usedFallback,
      fallback_from: routed.fallbackFrom,
      input_tokens: routed.inputTokens,
      output_tokens: routed.outputTokens,
      cost_usd: routed.costUsd,
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspaceId);

    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_accountsmind_config_draft",
      targetType: "systemmind_generated_action",
      targetId:   draftRow.id,
      proposedAfterState: {
        title: parsed.name, risk_level: riskLevel, status: "draft", model: routed.model,
        fields: parsed.fields.length, stats: parsed.stats.length, widgets: parsed.widgets.length,
      },
      approvalStatus: "not_requested",
    });

    return {
      runId,
      draftId: draftRow.id,
      draft: draftRow,
      modelUsed: routed.model,
      provider: routed.provider,
      usedFallback: routed.usedFallback,
      claudeEnabled,
      riskLevel,
    };
  } catch (err: any) {
    await sb.from("systemmind_runs").update({
      status: "failed",
      error: (err?.message ?? String(err)).slice(0, 2000),
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspaceId);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_accountsmind_config_draft",
      targetType: "systemmind_run",
      targetId:   runId,
      error:      err?.message ?? String(err),
    });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Activation (called ONLY from activateSystemMindAutomation kind dispatch)
// ═══════════════════════════════════════════════════════════════════════════

async function versionedInsert(
  sb: Sb,
  table: string,
  workspaceId: string,
  keyCol: string,
  keyVal: string,
  row: Record<string, unknown>,
): Promise<string> {
  // Archive any live row with the same key, chaining version numbers.
  const { data: existing } = await sb.from(table)
    .select("id, version")
    .eq("workspace_id", workspaceId)
    .eq(keyCol, keyVal)
    .in("status", ["active", "paused", "hidden"])
    .eq("is_deleted", false)
    .maybeSingle();

  let version = 1;
  let previousVersionId: string | null = null;
  if (existing) {
    version = (existing.version ?? 1) + 1;
    previousVersionId = existing.id;
    const { error: archErr } = await sb.from(table)
      .update({ status: "archived" })
      .eq("id", existing.id)
      .eq("workspace_id", workspaceId);
    if (archErr) throw new Error(`Failed to archive previous ${table} row: ${archErr.message}`);
  }

  const { data: inserted, error } = await sb.from(table).insert({
    ...row,
    workspace_id: workspaceId,
    version,
    previous_version_id: previousVersionId,
    status: "active",
  }).select("id").single();
  if (error) throw new Error(`Failed to insert ${table} row: ${error.message}`);
  return inserted.id as string;
}

/**
 * Exported for the deterministic industry-preset apply path
 * (industry.server.ts) — same archive+version chain as draft activation.
 */
export async function versionedInsertConfigRow(
  sb: Sb,
  table: string,
  workspaceId: string,
  keyCol: string,
  keyVal: string,
  row: Record<string, unknown>,
): Promise<string> {
  return versionedInsert(sb, table, workspaceId, keyCol, keyVal, row);
}

export async function activateAccountsMindConfigKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: draft, error } = await sb.from("systemmind_generated_actions")
    .select("*")
    .eq("id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error("Draft not found in this workspace.");

  // Re-validate at activation time — never trust what sat in the DB.
  const payload = draft.payload ?? {};
  let cfg = GeneratedConfigSchema.parse({
    name: payload.name ?? draft.title,
    purpose: payload.purpose ?? draft.purpose ?? "",
    fields: payload.fields ?? [],
    stats: payload.stats ?? [],
    widgets: payload.widgets ?? [],
    risks: payload.risks ?? [],
    test_plan: [],
  });
  cfg = sanitizeGeneratedConfig(cfg);
  assertNoCredentialValues(cfg, "AccountsMind config");
  if (cfg.fields.length + cfg.stats.length + cfg.widgets.length === 0) {
    throw new Error("Config payload failed safety re-validation — activation refused.");
  }

  const createdBy = draft.created_by_user_id ?? null;

  // Atomic activation: one Postgres RPC wraps every field/stat/widget
  // archive + versioned insert in a single transaction (migration
  // 20260719000000). If anything fails midway, the previous dashboard is
  // left completely untouched — no half-applied config. The RPC mirrors
  // versionedInsert's archive+version chain exactly (only same-key live
  // rows are archived; unrelated live config is never touched) and is
  // service_role-only. There is deliberately NO row-by-row fallback here —
  // a fallback would reintroduce the half-apply failure mode.
  const { data: rpcResult, error: rpcError } = await sb.rpc(
    "activate_accountsmind_config_draft",
    {
      p_workspace_id:    workspaceId,
      p_created_by:      createdBy,
      p_source_draft_id: generatedActionId,
      p_fields: cfg.fields.map((f) => ({
        field_key:      f.field_key,
        label:          f.label,
        field_type:     f.field_type,
        entity_type:    f.entity_type,
        appears_in:     f.appears_in,
        required:       f.required,
        options:        f.options,
        client_visible: f.client_visible,
        risk_level:     f.field_type === "currency" ? "medium" : "low",
      })),
      p_stats: cfg.stats.map((s) => ({
        stat_key:       s.stat_key,
        label:          s.label,
        metric_key:     s.metric_key,
        format:         s.format,
        description:    s.description ?? null,
        client_visible: s.client_visible,
        risk_level:     METRIC_REGISTRY[s.metric_key]?.sensitive ? "high" : "low",
      })),
      p_widgets: cfg.widgets.map((w) => ({
        widget_key:     w.widget_key,
        title:          w.title,
        widget_type:    w.widget_type,
        metric_key:     w.metric_key,
        format:         w.format,
        description:    w.description ?? null,
        client_visible: w.client_visible,
        risk_level:     METRIC_REGISTRY[w.metric_key]?.sensitive ? "high" : "low",
      })),
    },
  );
  if (rpcError) {
    throw new Error(
      `Config activation failed — the previous dashboard is unchanged. (${rpcError.message})`,
    );
  }

  // On-widget-creation backfill: fill past daily history for the newly
  // activated trend/progress widgets so sparklines render immediately.
  // Fire-and-forget — activation must not block on (or fail because of) it.
  const trendKeys = cfg.widgets
    .filter((w) => w.widget_type === "trend" || w.widget_type === "progress")
    .map((w) => w.metric_key);
  if (trendKeys.length > 0) {
    void ensureMetricHistoryBackfillServer(workspaceId, trendKeys).catch(() => {});
  }

  return {
    activatedTargetType: "accountsmind_config",
    activatedTargetId:   generatedActionId,
    summary: {
      fields_created:  Number(rpcResult?.fields_created ?? cfg.fields.length),
      stats_created:   Number(rpcResult?.stats_created ?? cfg.stats.length),
      widgets_created: Number(rpcResult?.widgets_created ?? cfg.widgets.length),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reads + lifecycle management of live config
// ═══════════════════════════════════════════════════════════════════════════

export interface ActiveConfig {
  fields:  any[];
  stats:   any[];
  widgets: any[];
}

export async function listActiveConfigServer(
  workspaceId: string,
  opts?: { clientOnly?: boolean; includeNonActive?: boolean },
): Promise<ActiveConfig> {
  const sb = supabaseAdmin as any;
  const statuses = opts?.includeNonActive ? ["active", "paused", "hidden"] : ["active"];

  const fetchTable = async (table: string) => {
    let q = sb.from(table).select("*")
      .eq("workspace_id", workspaceId)
      .in("status", statuses)
      .eq("is_deleted", false)
      .order("display_order", { ascending: true });
    if (opts?.clientOnly) q = q.eq("client_visible", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  const [fields, stats, widgets] = await Promise.all([
    fetchTable("accountsmind_field_defs"),
    fetchTable("accountsmind_stat_defs"),
    fetchTable("accountsmind_widget_defs"),
  ]);
  return { fields, stats, widgets };
}

// ── Client-safe dashboard read (the ONLY path clients get metric data from) ──
// Sensitive (billing/cost) metrics must NEVER reach a client, no matter what
// the widget/stat rows in the DB say. sanitizeGeneratedConfig already strips
// client_visible from sensitive items at draft time, but this read applies the
// same rule again as defence-in-depth: even a tampered/legacy row marked
// client_visible=true for a sensitive metric is dropped here, and its metric
// value / history series is never computed or returned.

function isClientSafeMetricKey(key: string | null | undefined): boolean {
  return !!key && !!METRIC_REGISTRY[key] && !METRIC_REGISTRY[key].sensitive;
}

export async function getClientVisibleDashboardServer(workspaceId: string): Promise<
  ActiveConfig & {
    metrics: Record<string, number | null>;
    series:  Record<string, MetricSeriesPoint[]>;
  }
> {
  const config = await listActiveConfigServer(workspaceId, { clientOnly: true });

  // Defence-in-depth: drop any stat/widget referencing a sensitive or unknown
  // metric, and any currency custom field, regardless of client_visible flags.
  const stats   = config.stats.filter((s: any) => isClientSafeMetricKey(s.metric_key));
  const widgets = config.widgets.filter((w: any) => isClientSafeMetricKey(w.metric_key));
  const fields  = config.fields.filter((f: any) => f.field_type !== "currency");

  const keys = [
    ...stats.map((s: any) => s.metric_key),
    ...widgets.map((w: any) => w.metric_key),
  ].filter(isClientSafeMetricKey);
  const metrics = await computeMetricsServer(workspaceId, keys);
  // Record today's values so trend/progress widgets accumulate real history.
  await snapshotMetricsServer(workspaceId, metrics);

  // Series ONLY for client-safe metrics referenced by client-visible
  // trend/progress widgets.
  const seriesKeys = widgets
    .filter((w: any) => w.widget_type === "trend" || w.widget_type === "progress")
    .map((w: any) => w.metric_key)
    .filter(isClientSafeMetricKey);
  // One-off history backfill so sparklines render immediately for existing
  // workspaces (best-effort, no-op once the window is full).
  await ensureMetricHistoryBackfillServer(workspaceId, seriesKeys);
  const series = await getMetricSeriesServer(workspaceId, seriesKeys, 30);

  return { fields, stats, widgets, metrics, series };
}

const KIND_TABLE: Record<string, string> = {
  field:  "accountsmind_field_defs",
  stat:   "accountsmind_stat_defs",
  widget: "accountsmind_widget_defs",
};

const CONFIG_STATUSES = ["active", "paused", "hidden", "archived"] as const;

export async function setConfigItemStatusServer(
  workspaceId: string,
  userId: string | null,
  kind: "field" | "stat" | "widget",
  id: string,
  status: (typeof CONFIG_STATUSES)[number],
): Promise<void> {
  const table = KIND_TABLE[kind];
  if (!table) throw new Error("Unknown config item kind.");
  if (!CONFIG_STATUSES.includes(status)) throw new Error("Invalid status.");
  const sb = supabaseAdmin as any;

  const { data: row, error: fetchErr } = await sb.from(table).select("*")
    .eq("id", id).eq("workspace_id", workspaceId).eq("is_deleted", false).maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!row) throw new Error("Config item not found in this workspace.");
  if (row.status === "archived" && status !== "archived") {
    throw new Error("Archived config items cannot be reactivated directly — use rollback on the newer version instead.");
  }

  const { error } = await sb.from(table).update({ status })
    .eq("id", id).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: `accountsmind_config_${status}`,
    targetType: table,
    targetId:   id,
    beforeState: { status: row.status },
    finalAfterState: { status },
  });
}

export async function rollbackConfigItemServer(
  workspaceId: string,
  userId: string | null,
  kind: "field" | "stat" | "widget",
  id: string,
): Promise<{ restoredId: string }> {
  const table = KIND_TABLE[kind];
  if (!table) throw new Error("Unknown config item kind.");
  const sb = supabaseAdmin as any;

  const { data: row, error: fetchErr } = await sb.from(table).select("*")
    .eq("id", id).eq("workspace_id", workspaceId).eq("is_deleted", false).maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!row) throw new Error("Config item not found in this workspace.");
  if (!row.previous_version_id) throw new Error("This item has no previous version to roll back to.");

  const { data: prev, error: prevErr } = await sb.from(table).select("*")
    .eq("id", row.previous_version_id).eq("workspace_id", workspaceId).maybeSingle();
  if (prevErr) throw new Error(prevErr.message);
  if (!prev) throw new Error("Previous version row not found.");

  const { error: archErr } = await sb.from(table).update({ status: "archived" })
    .eq("id", id).eq("workspace_id", workspaceId);
  if (archErr) throw new Error(archErr.message);

  const { error: restoreErr } = await sb.from(table).update({ status: "active" })
    .eq("id", prev.id).eq("workspace_id", workspaceId);
  if (restoreErr) throw new Error(restoreErr.message);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "accountsmind_config_rollback",
    targetType: table,
    targetId:   id,
    beforeState: { active_version: row.version, id },
    finalAfterState: { active_version: prev.version, id: prev.id },
  });

  return { restoredId: prev.id as string };
}

// ── Custom field values ─────────────────────────────────────────────────────────
export async function setFieldValueServer(
  workspaceId: string,
  userId: string | null,
  fieldDefId: string,
  entityType: string,
  entityId: string,
  value: unknown,
): Promise<void> {
  const sb = supabaseAdmin as any;

  const { data: def, error: defErr } = await sb.from("accountsmind_field_defs").select("id, status, options, field_type")
    .eq("id", fieldDefId).eq("workspace_id", workspaceId).eq("is_deleted", false).maybeSingle();
  if (defErr) throw new Error(defErr.message);
  if (!def) throw new Error("Field definition not found in this workspace.");
  if (def.status !== "active") throw new Error("Field is not active.");

  // Light validation for select fields
  if ((def.field_type === "single_select" || def.field_type === "status") && value != null) {
    const opts = (def.options ?? []) as string[];
    if (opts.length > 0 && !opts.includes(String(value))) {
      throw new Error(`Value must be one of: ${opts.join(", ")}`);
    }
  }

  const { error } = await sb.from("accountsmind_field_values").upsert({
    workspace_id:       workspaceId,
    field_def_id:       fieldDefId,
    entity_type:        entityType.slice(0, 40),
    entity_id:          String(entityId).slice(0, 200),
    value:              value ?? null,
    updated_by_user_id: userId,
    updated_at:         new Date().toISOString(),
  }, { onConflict: "workspace_id,field_def_id,entity_type,entity_id" });
  if (error) throw new Error(error.message);
}

export async function listFieldValuesServer(
  workspaceId: string,
  entityType: string,
  entityId: string,
): Promise<any[]> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("accountsmind_field_values")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId);
  if (error) throw new Error(error.message);
  return data ?? [];
}
