/**
 * Apply wbah_crm_contacts do_not_contact column migration.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/apply-wbah-crm-contacts-dnc-migration.mjs
 *
 * Requires:
 *   SUPABASE_ACCESS_TOKEN — Supabase personal access token (sbp_...) for Management API
 *   VITE_SUPABASE_URL     — e.g. https://ugrsdmmztnfgeajhwhzy.supabase.co
 */

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
const mgmtToken   = process.env.SUPABASE_ACCESS_TOKEN;

if (!supabaseUrl) { console.error("MISSING VITE_SUPABASE_URL"); process.exit(2); }
if (!mgmtToken)   { console.error("MISSING SUPABASE_ACCESS_TOKEN"); process.exit(2); }

// Strip KEY=VALUE prefix if the env var was injected as "VITE_SUPABASE_URL=https://..."
const cleanUrl = supabaseUrl.includes("=") ? supabaseUrl.split("=").slice(1).join("=") : supabaseUrl;
const projectRef = cleanUrl.replace("https://", "").split(".")[0];
const apiUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

const SQL = `
ALTER TABLE IF EXISTS wbah_crm_contacts
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_wbah_crm_contacts_dnc
  ON wbah_crm_contacts (workspace_id, do_not_contact)
  WHERE do_not_contact = true;

COMMENT ON COLUMN wbah_crm_contacts.do_not_contact IS
  'True when the contact''s most-recent call had negative sentiment. '
  'Excludes the contact from future WEBEE campaign queues regardless of '
  'Dynamics sync state. Set by the post-call pipeline; never cleared automatically.';
`;

async function runQuery(sql) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mgmtToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text;
}

try {
  console.log("Applying wbah_crm_contacts do_not_contact migration...");
  const result = await runQuery(SQL);
  console.log("✓ Migration applied:", result);
} catch (err) {
  console.error("✗ Migration failed:", err.message);
  console.error("   Set SUPABASE_ACCESS_TOKEN=sbp_... and re-run this script.");
  process.exit(1);
}
