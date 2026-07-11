// Smart Migration Reconciliation — SAFE APPLIER
// Applies ONLY genuinely-required, additive+idempotent migrations to the live
// shared Supabase DB via the Management API. One step at a time, STOP on first
// error. Everything is IF NOT EXISTS / guarded, so re-running is safe.
import { readFileSync, writeFileSync } from "node:fs";
import { refreshSchemaMap } from "./lib/refresh-schema-map.mjs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!token) { console.error("MISSING SUPABASE_ACCESS_TOKEN"); process.exit(2); }
if (!url) { console.error("MISSING SUPABASE_URL/VITE_SUPABASE_URL"); process.exit(2); }
const projectRef = new URL(url).host.split(".")[0];
const M = "supabase/migrations/";
const LOCK = "SET lock_timeout='8s';\n";

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const readWhole = (f) => LOCK + readFileSync(M + f, "utf8");

// ── ADS_PROVIDER_CREDENTIALS (MODIFIED): tables already exist; strip the two
//    `ALTER COLUMN account_id DROP NOT NULL` (col absent → 42703). Apply only
//    the 2 workspace_settings cols + 8 indexes.
const ADS_PROVIDER = LOCK + `
ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS meta_ads_access_token TEXT,
  ADD COLUMN IF NOT EXISTS meta_ads_account_id   TEXT;
CREATE INDEX IF NOT EXISTS idx_gm_ad_campaigns_ws       ON growthmind_ad_campaigns (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_ad_campaigns_platform ON growthmind_ad_campaigns (workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_gm_ad_campaigns_synced   ON growthmind_ad_campaigns (workspace_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_ad_sync_log_ws        ON growthmind_ad_sync_log (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_ad_sync_log_platform  ON growthmind_ad_sync_log (workspace_id, platform);
CREATE INDEX IF NOT EXISTS idx_gm_ad_alerts_ws          ON growthmind_ad_budget_alerts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_gm_ad_alerts_unack       ON growthmind_ad_budget_alerts (workspace_id, acknowledged) WHERE acknowledged = FALSE;
CREATE INDEX IF NOT EXISTS idx_gm_ad_budget_caps_ws     ON growthmind_ad_budget_caps (workspace_id);
`;

// ── GROWTHMIND_ADS_AUTOMATION (MODIFIED): tables already exist. Apply the 11
//    columns on growthmind_ads_accounts + idx_ad_webhook_events_plat only.
//    SKIP idx_ad_sync_log_account (account_id absent) and idx_ad_sync_log_workspace
//    (functional duplicate of idx_gm_ad_sync_log_ws → no duplicate indexes).
const ADS_AUTOMATION = LOCK + `
ALTER TABLE growthmind_ads_accounts
  ADD COLUMN IF NOT EXISTS last_synced_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_status          TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sync_error           TEXT,
  ADD COLUMN IF NOT EXISTS meta_pixel_id        TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_id          TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_secret_enc  TEXT,
  ADD COLUMN IF NOT EXISTS webhook_registered   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS webhook_id           TEXT,
  ADD COLUMN IF NOT EXISTS currency             TEXT NOT NULL DEFAULT 'GBP',
  ADD COLUMN IF NOT EXISTS monthly_budget       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS total_spend_synced   NUMERIC(12,2) DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ad_webhook_events_plat ON growthmind_ad_webhook_events(platform);
`;

// ── content_calendar (EXTRACT-ONLY): 2 missing indexes; the file's un-guarded
//    CREATE POLICY on already-existing tables would error if run whole.
const CONTENT_CAL = LOCK + `
CREATE INDEX IF NOT EXISTS growthmind_marketing_tasks_workspace_status ON growthmind_marketing_tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS growthmind_marketing_tasks_workspace_due    ON growthmind_marketing_tasks(workspace_id, due_date);
`;

const steps = [
  // A) Additive columns/indexes on existing tables
  { name: "20260608_scheduled_calls",        sql: readWhole("20260608_scheduled_calls.sql") },
  { name: "20260609_voice_provider",         sql: readWhole("20260609_voice_provider.sql") },
  { name: "20260610_deployment_mode",        sql: readWhole("20260610_deployment_mode.sql") },
  { name: "20260612_crm_settings",           sql: readWhole("20260612_crm_settings.sql") },
  { name: "WEBESPOKE_AI_CRM",                sql: readWhole("WEBESPOKE_AI_CRM_MIGRATION.sql") },
  { name: "workspace_ai_cost_limits",        sql: readWhole("20260801000002_workspace_ai_cost_limits.sql") },
  { name: "ADS_PROVIDER_CREDENTIALS [MOD]",  sql: ADS_PROVIDER },
  { name: "GROWTHMIND_ADS_AUTOMATION [MOD]", sql: ADS_AUTOMATION },
  { name: "PLATFORM_KNOWLEDGE",              sql: readWhole("PLATFORM_KNOWLEDGE_MIGRATION.sql") },
  { name: "STRATEGY_CENTRE",                 sql: readWhole("STRATEGY_CENTRE_MIGRATION.sql") },
  // B) New tables
  { name: "ACCOUNTSMIND",                    sql: readWhole("ACCOUNTSMIND_MIGRATION.sql") },
  { name: "DEVELOPER_API",                   sql: readWhole("DEVELOPER_API_MIGRATION.sql") },
  { name: "CLIENT_API_PROBE",               sql: readWhole("CLIENT_API_PROBE_MIGRATION.sql") },
  { name: "ONBOARDING_V2",                   sql: readWhole("ONBOARDING_V2_MIGRATION.sql") },
  { name: "WEBEE_API_ENGINE",               sql: readWhole("WEBEE_API_ENGINE_MIGRATION.sql") },
  // C) SystemMind — order matters (planner FKs templates)
  { name: "SYSTEMMIND_TEMPLATE_LIBRARY",     sql: readWhole("SYSTEMMIND_TEMPLATE_LIBRARY_MIGRATION.sql") },
  { name: "SYSTEMMIND_KNOWLEDGE_GRAPH",      sql: readWhole("SYSTEMMIND_KNOWLEDGE_GRAPH_MIGRATION.sql") },
  { name: "SYSTEMMIND_DEPLOYMENT_PLANNER",   sql: readWhole("SYSTEMMIND_DEPLOYMENT_PLANNER_MIGRATION.sql") },
  // D) Extract-only
  { name: "content_calendar [2 idx only]",   sql: CONTENT_CAL },
  // E) Prod cron (inert until app_config set)
  { name: "provider_health_sweep_cron",      sql: readWhole("20260801000000_provider_health_sweep_cron.sql") },
];

const results = [];
for (const s of steps) {
  process.stdout.write(`\n▶ ${s.name} ... `);
  try {
    await q(s.sql);
    console.log("OK");
    results.push({ step: s.name, status: "OK" });
  } catch (e) {
    console.log("FAILED");
    console.error("   ERROR: " + String(e.message || e));
    results.push({ step: s.name, status: "FAILED", error: String(e.message || e) });
    writeFileSync(".local/migration_audit/apply-results.json", JSON.stringify(results, null, 2));
    console.error("\n⛔ STOP-ON-ERROR: halted. See apply-results.json.");
    process.exit(1);
  }
}
writeFileSync(".local/migration_audit/apply-results.json", JSON.stringify(results, null, 2));
console.log(`\n✅ ALL ${results.length} STEPS APPLIED. Results → .local/migration_audit/apply-results.json`);

// ── Auto-refresh the schema map so src/integrations/supabase/types.ts can never
//    drift after an apply. Non-fatal: a typegen hiccup must not mask a successful
//    migration run — the helper prints a loud warning instead.
refreshSchemaMap();
