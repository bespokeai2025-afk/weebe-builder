/**
 * Marks an imported lead as replied when a duplicate lead on the same number already holds the reply.
 *
 * Cause: WATI delivers a reply from the full international number ("971561169769") while the CSV
 * import stored the national form ("561169769"). Lead matching could not bridge the two, so the
 * reply created a second lead. Nothing was lost — but the IMPORTED lead, the one in the campaign
 * with the property data and upload type, still reads as never having replied, which is where the
 * replies look missing.
 *
 * The matcher is fixed going forward; this repairs the rows already written. It only ever SETS
 * has_buzzchat_reply, never clears it, and never merges or deletes a lead — duplicates are
 * reported for a human to decide on.
 *
 * Usage: node scripts/flag-imported-leads-that-replied.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const WORKSPACE = process.argv.includes("--workspace")
  ? process.argv[process.argv.indexOf("--workspace") + 1]
  : "9bc09fc9-5841-40d6-94a8-d3074a15f988"; // Avenue Elite Properties

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(".env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const U = env.SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };

/** PostgREST caps a single read at 1000 rows whatever `limit` says — page explicitly. */
async function all(pathAndQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${U}/rest/v1/${pathAndQuery}`, {
      headers: { ...H, Range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

const digits = (p) => String(p ?? "").replace(/\D/g, "");
/** Same 9-digit key the fixed lead matcher uses. */
const key = (p) => (digits(p).length >= 8 ? digits(p).slice(-9) : null);

const leads = await all(
  `leads?select=id,phone,full_name,lead_origin,has_buzzchat_reply,last_buzzchat_reply_at,buzzchat_conversation_id&workspace_id=eq.${WORKSPACE}`,
);
const inbound = await all(
  `whatsapp_messages?select=contact_phone,sent_at&workspace_id=eq.${WORKSPACE}&direction=eq.inbound&order=sent_at.asc`,
);

const latestReplyByKey = new Map();
for (const m of inbound) {
  const k = key(m.contact_phone);
  if (!k) continue;
  const prev = latestReplyByKey.get(k);
  if (!prev || String(m.sent_at) > prev) latestReplyByKey.set(k, String(m.sent_at));
}

const byKey = new Map();
for (const l of leads) {
  const k = key(l.phone);
  if (!k) continue;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(l);
}

const toFlag = [];
const duplicates = [];
for (const [k, repliedAt] of latestReplyByKey) {
  const group = byKey.get(k) ?? [];
  if (group.length === 0) continue;
  if (group.length > 1) duplicates.push({ key: k, rows: group });
  for (const lead of group) {
    if (lead.has_buzzchat_reply === true) continue;
    toFlag.push({ lead, repliedAt });
  }
}

console.log(`workspace ${WORKSPACE}`);
console.log(`leads=${leads.length}  inbound=${inbound.length}  numbers that replied=${latestReplyByKey.size}`);
console.log(`\nlead rows to mark as replied: ${toFlag.length}`);
for (const { lead, repliedAt } of toFlag.slice(0, 10)) {
  console.log(`  ${(lead.full_name ?? "?").slice(0, 26).padEnd(28)} ${String(lead.phone).padEnd(15)} origin=${lead.lead_origin ?? "-"}  replied ${repliedAt.slice(0, 10)}`);
}
if (toFlag.length > 10) console.log(`  … and ${toFlag.length - 10} more`);

console.log(`\nnumbers holding MORE THAN ONE lead row: ${duplicates.length} (not merged — your call)`);
for (const d of duplicates.slice(0, 8)) {
  console.log(`  ...${d.key}`);
  for (const r of d.rows) {
    console.log(`     ${String(r.phone).padEnd(15)} ${(r.full_name ?? "?").slice(0, 26).padEnd(28)} origin=${r.lead_origin ?? "-"} replied=${r.has_buzzchat_reply === true}`);
  }
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to set the flags.");
  process.exit(0);
}

let done = 0;
for (const { lead, repliedAt } of toFlag) {
  const patch = { has_buzzchat_reply: true, updated_at: new Date().toISOString() };
  // Never move an existing timestamp backwards.
  if (!lead.last_buzzchat_reply_at || repliedAt > String(lead.last_buzzchat_reply_at)) {
    patch.last_buzzchat_reply_at = repliedAt;
  }
  const r = await fetch(`${U}/rest/v1/leads?id=eq.${lead.id}&workspace_id=eq.${WORKSPACE}`, {
    method: "PATCH",
    headers: { ...H, Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    console.warn(`  ! ${lead.id}: ${r.status} ${(await r.text()).slice(0, 120)}`);
    continue;
  }
  done += 1;
}
console.log(`\nFlagged ${done} lead row(s).`);
