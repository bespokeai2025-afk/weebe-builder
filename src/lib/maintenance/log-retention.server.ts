/**
 * Log-table retention sweep — keeps append-only log tables from growing
 * forever (this project has repeatedly hit query timeouts from unbounded
 * tables, e.g. leads / data_records).
 *
 * Runs from the 5-minute campaign-executor tick, but only actually prunes
 * once per UTC day (in-process marker). Entirely best-effort: never throws,
 * a prune failure must never block or fail the tick. Deletes are batched
 * (id-select then delete-in) so a large backlog can never hit the Postgres
 * statement timeout — leftovers are picked up by the next day's sweep.
 *
 * ── Retention audit (documented decisions) ──────────────────────────────────
 *
 * PRUNED (append-only, all readers use bounded recent windows):
 *  • retell_webhook_events (90d) — payload-heavy webhook audit log (~9KB/row).
 *    Readers: latest debug_snapshot row, in-flight call processing only.
 *  • growthmind_ad_webhook_events (90d) — ad-platform webhook audit log;
 *    write-only after ingest (no historical readers).
 *  • hivemind_events (180d) — activity feed; UI reads latest 100, scanner
 *    dedupe window is 1 day.
 *  • provider_usage_log (400d) — cost/usage time-series. Readers: month-to-date
 *    (AccountsMind metrics, billing limits, usage dashboard), rolling 30 days
 *    (provider health), and admin month recompute (client-costing). Monthly
 *    rollups persist forever in client_monthly_costs, so 400 days keeps a full
 *    year of raw rows re-computable while bounding growth.
 *  • growthmind_generation_logs (400d) — same reader profile as
 *    provider_usage_log (usage dashboard, HiveMind week summary, 30-day stats,
 *    client-costing month windows; rollups persist in client_monthly_costs).
 *
 * KEEP FOREVER (not pruned — rollups, financial records, or user data):
 *  • client_monthly_costs / call_profitability — financial records + rollups
 *    that AccountsMind history views read indefinitely.
 *  • accountsmind_metric_snapshots — already pruned at 180d by its own sweep
 *    (see accountsmind-config.server.ts).
 *  • workflow_run_events / api_engine_logs / lead_email_log / email_send_log /
 *    usage_events / executive_events — currently near-zero volume; revisit if
 *    any of them show meaningful growth.
 *  • calls / whatsapp_messages / leads / entity_notes — user data, never
 *    auto-deleted.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface RetentionRule {
  table: string;
  /** timestamptz column the retention window applies to */
  column: string;
  days: number;
}

const RETENTION_RULES: RetentionRule[] = [
  { table: "retell_webhook_events",        column: "received_at", days: 90 },
  // NOTE: live column is created_at (migration file says received_at — live
  // schema is ground truth here).
  { table: "growthmind_ad_webhook_events", column: "created_at",  days: 90 },
  { table: "hivemind_events",              column: "created_at",  days: 180 },
  // Executive event stream — reasoning/briefings only read bounded recent
  // windows; dedup keys are day-scoped so old rows never suppress new events.
  { table: "hivemind_executive_events",    column: "created_at",  days: 180 },
  { table: "provider_usage_log",           column: "created_at",  days: 400 },
  { table: "growthmind_generation_logs",   column: "created_at",  days: 400 },
  // Content Intelligence audit trail — keep a year of activity.
  { table: "growthmind_activity_log",          column: "created_at", days: 365 },
  // Post-publish metric snapshots — bounded history for learning loops.
  { table: "growthmind_performance_snapshots", column: "created_at", days: 400 },
  // Trend Scout discovery/scoring run log — operational history only.
  { table: "growthmind_discovery_runs",        column: "created_at", days: 180 },
];

/** Rows deleted per batch (bounded so a single statement can't time out). */
const BATCH_SIZE = 1000;
/** Max batches per table per sweep — leftovers wait for the next daily run. */
const MAX_BATCHES_PER_TABLE = 5;

/** In-process once-per-UTC-day marker (resets on restart; re-running is a
 *  cheap no-op once tables are within their windows). */
let lastSweepUtcDate: string | null = null;

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Prune one table in bounded batches. Returns rows deleted. Never throws.
 */
async function pruneTable(rule: RetentionRule): Promise<number> {
  const sb = supabaseAdmin as any;
  const cutoff = cutoffIso(rule.days);
  let total = 0;
  try {
    for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
      const { data: rows, error: selErr } = await sb
        .from(rule.table)
        .select("id")
        .lt(rule.column, cutoff)
        .limit(BATCH_SIZE);
      if (selErr) {
        console.warn(`[log-retention] ${rule.table} select failed:`, selErr.message);
        break;
      }
      const ids = (rows ?? []).map((r: any) => r.id).filter(Boolean);
      if (ids.length === 0) break;

      const { error: delErr } = await sb.from(rule.table).delete().in("id", ids);
      if (delErr) {
        console.warn(`[log-retention] ${rule.table} delete failed:`, delErr.message);
        break;
      }
      total += ids.length;
      if (ids.length < BATCH_SIZE) break;
    }
  } catch (err: any) {
    console.warn(`[log-retention] ${rule.table} prune failed:`, err?.message ?? err);
  }
  if (total > 0) {
    console.log(
      `[log-retention] pruned ${total} rows from ${rule.table} older than ${rule.days}d`,
    );
  }
  return total;
}

/**
 * Daily retention sweep for the background tick. Best-effort; never throws.
 */
export async function runLogRetentionSweepServer(): Promise<{
  ran: boolean;
  pruned: Record<string, number>;
}> {
  const out: { ran: boolean; pruned: Record<string, number> } = { ran: false, pruned: {} };
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (lastSweepUtcDate === today) return out;
    lastSweepUtcDate = today;
    out.ran = true;

    for (const rule of RETENTION_RULES) {
      const n = await pruneTable(rule);
      if (n > 0) out.pruned[rule.table] = n;
    }
  } catch (err: any) {
    console.warn("[log-retention] sweep failed:", err?.message ?? err);
  }
  return out;
}
