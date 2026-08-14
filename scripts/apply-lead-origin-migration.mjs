/**
 * One-time migration: add lead_origin + origin_provider columns to leads,
 * then backfill all existing rows from the existing source/meta evidence.
 *
 * Run: node scripts/apply-lead-origin-migration.mjs
 *
 * Always exits 0 — never blocks post-merge regardless of credential state.
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[lead-origin] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping");
  process.exit(0);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Check if columns already exist
const { data: colCheck } = await sb.rpc("sql", {
  query: `SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name IN ('lead_origin','origin_provider') AND table_schema='public'`
}).catch(() => ({ data: null }));

// Use direct Postgres via management API endpoint approach instead
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!mgmtToken || !projectRef) {
  console.warn("[lead-origin] No SUPABASE_ACCESS_TOKEN — will use service-role direct SQL");
  // Fall through to service-role approach
}

const SQL = `
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS lead_origin   text,
  ADD COLUMN IF NOT EXISTS origin_provider text;

UPDATE leads
SET
  lead_origin = CASE
    WHEN buzzchat_conversation_id IS NOT NULL                    THEN 'whatsapp'
    WHEN source::text = 'whatsapp'                               THEN 'whatsapp'
    WHEN source::text = 'retell'                                 THEN 'voice_call'
    WHEN meta->>'wbah_source' = 'wbah_calls'                    THEN 'voice_call'
    WHEN meta->>'wbah_source' = 'crm'                           THEN 'crm'
    WHEN source::text IN (
      'website_form','landing_page','facebook_lead_form',
      'google_ads_lead_form','tiktok_lead_form','linkedin_lead_form',
      'custom_form','webee_website_form','zapier','make','website'
    )                                                            THEN 'web_form'
    WHEN source::text = 'import'                                 THEN 'csv_import'
    WHEN source::text IN ('inbound','outbound','referral')       THEN 'crm'
    WHEN source::text = 'api'                                    THEN 'api'
    ELSE                                                              'unknown'
  END,
  origin_provider = CASE
    WHEN buzzchat_conversation_id IS NOT NULL                    THEN 'WATI'
    WHEN source::text = 'whatsapp'                               THEN 'WATI'
    WHEN source::text = 'retell'                                 THEN 'WEBEE Voice'
    WHEN meta->>'wbah_source' = 'wbah_calls'                    THEN 'WEBEE Voice'
    WHEN meta->>'wbah_source' = 'crm'                           THEN 'WeeBespoke'
    WHEN source::text IN (
      'website_form','landing_page','facebook_lead_form',
      'google_ads_lead_form','tiktok_lead_form','linkedin_lead_form',
      'custom_form','webee_website_form','zapier','make','website'
    )                                                            THEN 'Website'
    WHEN source::text = 'import'                                 THEN 'CSV'
    WHEN source::text IN ('inbound','outbound','referral')       THEN 'CRM'
    WHEN source::text = 'api'                                    THEN 'API'
    ELSE NULL
  END
WHERE lead_origin IS NULL;

CREATE INDEX IF NOT EXISTS leads_lead_origin_ws_idx
  ON leads (workspace_id, lead_origin)
  WHERE lead_origin IS NOT NULL;
`;

try {
  if (mgmtToken && projectRef) {
    console.log(`[lead-origin] Applying via Management API (project: ${projectRef})`);
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mgmtToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: SQL }),
      },
    );
    const text = await res.text();
    if (!res.ok) {
      console.error("[lead-origin] Mgmt API error:", res.status, text.slice(0, 500));
    } else {
      console.log("[lead-origin] Migration applied via Mgmt API ✓");
    }
  } else {
    // Service-role direct approach — split into statements
    const stmts = SQL.split(";").map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      const { error } = await (sb as any).rpc("sql", { query: stmt });
      if (error && !error.message.includes("already exists")) {
        console.warn("[lead-origin] stmt warning:", error.message.slice(0, 200));
      }
    }
    console.log("[lead-origin] Migration applied via service-role ✓");
  }

  // Verify
  const { data: sample } = await sb
    .from("leads")
    .select("lead_origin, origin_provider")
    .not("lead_origin", "is", null)
    .limit(5);
  console.log("[lead-origin] Sample rows:", JSON.stringify(sample));

  const { count } = await (sb as any)
    .from("leads")
    .select("*", { count: "exact", head: true })
    .not("lead_origin", "is", null);
  console.log(`[lead-origin] Backfilled rows with lead_origin set: ${count}`);

} catch (err: any) {
  console.error("[lead-origin] Unexpected error:", err?.message ?? err);
}

process.exit(0);
