/**
 * One-time backfill: give every existing workspace WITHOUT a subscription row
 * an explicit `legacy_full` package (active) so nothing breaks when package
 * gating goes live. New workspaces get `trial` at provision time instead.
 *
 * Idempotent — only inserts for workspaces missing a row. Prints a report.
 * Run: node scripts/backfill-workspace-packages.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data: workspaces, error: wsErr } = await sb
  .from("workspaces")
  .select("id, name, created_at")
  .limit(5000);
if (wsErr) { console.error("workspaces read failed:", wsErr.message); process.exit(1); }

const { data: subs, error: subErr } = await sb
  .from("workspace_subscriptions")
  .select("workspace_id, package_key")
  .limit(10000);
if (subErr) { console.error("subscriptions read failed:", subErr.message); process.exit(1); }

const have = new Set((subs ?? []).map((s) => s.workspace_id));
const missing = (workspaces ?? []).filter((w) => !have.has(w.id));

console.log(`Workspaces total: ${workspaces?.length ?? 0}`);
console.log(`Already have a package row: ${have.size}`);
console.log(`Missing (will backfill as legacy_full): ${missing.length}`);

let ok = 0, failed = 0;
for (const w of missing) {
  const { error } = await sb.from("workspace_subscriptions").insert({
    workspace_id: w.id,
    package_key: "legacy_full",
    subscription_status: "active",
  });
  if (error) {
    // unique violation = raced/already present — fine
    if ((error.message || "").includes("duplicate")) { ok++; continue; }
    failed++;
    console.warn(`  ✗ ${w.id} (${w.name}): ${error.message}`);
  } else {
    ok++;
    console.log(`  ✓ ${w.id} (${w.name}) → legacy_full`);
  }
}

console.log(`\nBackfill complete: ${ok} inserted, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
