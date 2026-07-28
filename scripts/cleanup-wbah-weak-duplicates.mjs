/**
 * One-off cleanup: wbah_calls weak-id duplicate rows.
 *
 * Older WeeBespoke syncs created "weak id" rows (id NOT like 'call_%') for
 * calls that ALSO have an authoritative Retell row (id like 'call_%') — same
 * phone within a short window. Those twins double-count calls and minutes.
 *
 * Rules (mirrors the read-time guard in campaign-usage.server.ts):
 *   • A weak row is a duplicate when a Retell row exists for the same phone
 *     with |started_at delta| <= 600s.
 *   • Before deleting, booking fields the Retell twin lacks are merged in
 *     (booking_status, appointment_date, appointment_time, calendly_booking_url).
 *   • Every deleted row is backed up to .local/analytics_audit/ first.
 *
 * DRY RUN by default. Pass --apply to execute.
 * Uses the Supabase Management API (same pattern as scripts/audit-db-*.mjs).
 */
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.VITE_SUPABASE_URL;
if (!token || !url) { console.error("Missing SUPABASE_ACCESS_TOKEN / VITE_SUPABASE_URL"); process.exit(1); }
const ref = new URL(url).host.split(".")[0];

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`SQL failed: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function main() {
  // Pair every weak row with its nearest Retell twin (same phone, <=600s).
  const pairs = await q(`
    select distinct on (w.id)
      w.id as weak_id, r.id as retell_id,
      w.booking_status w_booking_status, r.booking_status r_booking_status,
      w.appointment_date w_appt_date, r.appointment_date r_appt_date,
      w.appointment_time w_appt_time, r.appointment_time r_appt_time,
      w.calendly_booking_url w_cal_url, r.calendly_booking_url r_cal_url,
      abs(extract(epoch from (w.started_at - r.started_at))) as delta_s
    from wbah_calls w
    join wbah_calls r
      on r.phone = w.phone
     and r.id like 'call_%'
     and abs(extract(epoch from (w.started_at - r.started_at))) <= 600
    where w.id not like 'call_%'
      and w.phone is not null and w.phone <> ''
    order by w.id, delta_s asc
  `);
  console.log(`Weak duplicate rows found: ${pairs.length}`);
  if (pairs.length === 0) return;

  // Backup full weak rows before any mutation.
  const weakIds = pairs.map((p) => p.weak_id);
  const backupRows = [];
  for (let i = 0; i < weakIds.length; i += 200) {
    const chunk = weakIds.slice(i, i + 200).map(lit).join(",");
    backupRows.push(...(await q(`select * from wbah_calls where id in (${chunk})`)));
  }
  const backupPath = path.join(".local/analytics_audit", `wbah_weak_dups_backup_${Date.now()}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({ pairs, rows: backupRows }, null, 2));
  console.log(`Backed up ${backupRows.length} rows → ${backupPath}`);

  if (!APPLY) {
    const merges = pairs.filter((p) =>
      (!p.r_booking_status && p.w_booking_status) ||
      (!p.r_appt_date && p.w_appt_date) ||
      (!p.r_appt_time && p.w_appt_time) ||
      (!p.r_cal_url && p.w_cal_url));
    console.log(`DRY RUN — would merge booking fields on ${merges.length} Retell twins and delete ${pairs.length} weak rows. Re-run with --apply.`);
    return;
  }

  let merged = 0, deleted = 0;
  for (const p of pairs) {
    const sets = [];
    if (!p.r_booking_status && p.w_booking_status) sets.push(`booking_status = ${lit(p.w_booking_status)}`);
    if (!p.r_appt_date && p.w_appt_date) sets.push(`appointment_date = ${lit(p.w_appt_date)}`);
    if (!p.r_appt_time && p.w_appt_time) sets.push(`appointment_time = ${lit(p.w_appt_time)}`);
    if (!p.r_cal_url && p.w_cal_url) sets.push(`calendly_booking_url = ${lit(p.w_cal_url)}`);
    if (sets.length > 0) {
      await q(`update wbah_calls set ${sets.join(", ")} where id = ${lit(p.retell_id)}`);
      merged += 1;
    }
  }
  for (let i = 0; i < weakIds.length; i += 200) {
    const chunk = weakIds.slice(i, i + 200).map(lit).join(",");
    const res = await q(`delete from wbah_calls where id in (${chunk}) and id not like 'call_%' returning id`);
    deleted += Array.isArray(res) ? res.length : 0;
  }
  console.log(`Merged booking fields into ${merged} Retell rows; deleted ${deleted} weak duplicate rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
