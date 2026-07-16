/**
 * One-off/manual runner: create the automated "Daily Dialler Success & KPI
 * Report" email schedule for the WBAH workspace.
 *
 * Standalone duplicate of ensureAutomatedCampaignReportSchedule() in
 * src/lib/analytics-hub/report-schedule-setup.server.ts (tsx cannot resolve
 * "@/" aliases outside the Vite pipeline). Idempotent — reuses an existing
 * enabled schedule of the same report type.
 *
 * Usage: node scripts/setup-wbah-campaign-report-schedule.mjs [email ...]
 *   (no args → recipients default to WBAH owner+admin member emails)
 * Requires: VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";

const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, KEY);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let recipients = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e));
if (recipients.length === 0) {
  const { data: members } = await sb
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", WBAH_WORKSPACE_ID)
    .in("role", ["owner", "admin"]);
  const ids = (members ?? []).map((m) => m.user_id).filter(Boolean);
  const { data: profiles } = ids.length
    ? await sb.from("profiles").select("user_id, email").in("user_id", ids)
    : { data: [] };
  recipients = [...new Set((profiles ?? []).map((p) => String(p.email ?? "").trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
}
if (recipients.length === 0) {
  console.error("No recipients resolved (no owner/admin emails found). Pass emails as args.");
  process.exit(1);
}

const { data: existing, error: exErr } = await sb
  .from("analytics_report_schedules")
  .select("id, recipients_json")
  .eq("workspace_id", WBAH_WORKSPACE_ID)
  .eq("report_type", "wbah_dialler_summary")
  .eq("enabled", true)
  .limit(1);
if (exErr) { console.error("lookup failed:", exErr.message); process.exit(1); }
if (existing?.length) {
  console.log("Already set up — schedule", existing[0].id, "recipients:", existing[0].recipients_json);
  process.exit(0);
}

const { data: row, error } = await sb
  .from("analytics_report_schedules")
  .insert({
    workspace_id: WBAH_WORKSPACE_ID,
    report_type: "wbah_dialler_summary",
    name: "Daily Dialler Success & KPI Report",
    frequency: "daily",
    schedule_config_json: { hour: 8 },
    recipients_json: recipients,
    filters_json: { dateFilter: "yesterday" },
    enabled: true,
    created_by_user_id: null,
  })
  .select("id")
  .maybeSingle();
if (error) { console.error("insert failed:", error.message); process.exit(1); }
console.log("OK — created schedule", row?.id, "→ daily 08:00 UTC, recipients:", recipients);
