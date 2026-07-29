#!/usr/bin/env node
// Admin per-call reconciliation for a WBAH period: compares Retell (provider)
// against wbah_calls (WEBEE) call-by-call and prints a reconciliation table.
// Read-only — never writes.
//
// Usage: node scripts/wbah-reconcile-period.mjs [--start 2026-07-28T23:00:00Z] [--end 2026-07-29T23:00:00Z]
//        (defaults to the current London day)
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
function argOf(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }

// Default period = current London day.
function londonDayWindow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const dayStartLocal = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00`);
  // Determine London offset at that instant (0 or 60 min).
  const probe = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12));
  const offMin = (new Date(probe.toLocaleString("en-US", { timeZone: "Europe/London" })).getTime()
    - new Date(probe.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60000;
  const startMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - offMin * 60000;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(startMs + 24 * 3600 * 1000).toISOString() };
}

const def = londonDayWindow();
const startIso = argOf("--start") ?? def.startIso;
const endIso = argOf("--end") ?? def.endIso;

const sb = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: ws } = await sb.from("workspaces").select("id").eq("slug", "webuyanyhouse").maybeSingle();
if (!ws?.id) throw new Error("WBAH workspace not found");
const wsId = ws.id;
const { data: settings } = await sb.from("workspace_settings").select("retell_workspace_id").eq("workspace_id", wsId).maybeSingle();
const apiKey = settings?.retell_workspace_id?.trim();
if (!apiKey?.startsWith("key_")) throw new Error("WBAH Retell key missing");

console.log(`WBAH reconciliation period: ${startIso} → ${endIso}`);

// ── Provider side ──
const retell = [];
let pk;
for (let page = 0; page < 60; page++) {
  const res = await fetch("https://api.retellai.com/v3/list-calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: 1000, sort_order: "descending",
      filter_criteria: { start_timestamp: { type: "range", op: "bt", value: [Date.parse(startIso), Date.parse(endIso) - 1] } },
      ...(pk ? { pagination_key: pk } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Retell ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const seen = new Set(retell.map((c) => c.call_id));
  let added = 0;
  for (const c of j.items ?? j.calls ?? []) if (c.call_id && !seen.has(c.call_id)) { retell.push(c); added++; }
  if (!j.has_more || !j.pagination_key || added === 0) break;
  pk = j.pagination_key;
}

// ── WEBEE side ──
const local = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("wbah_calls")
    .select("id, provider_call_id, duration_seconds, started_at, campaign_id, meta, agent_name")
    .eq("workspace_id", wsId)
    .gte("started_at", startIso).lt("started_at", endIso)
    .order("started_at", { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  local.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const localById = new Map(local.map((r) => [String(r.provider_call_id ?? r.id), r]));
const retellById = new Map(retell.map((c) => [String(c.call_id), c]));

let pSec = 0, pCost = 0, pCostMissing = 0;
for (const c of retell) {
  pSec += (Number(c.duration_ms ?? 0)) / 1000;
  const cc = c.call_cost?.combined_cost;
  if (typeof cc === "number") pCost += cc; else pCostMissing++;
}
let lSec = 0;
for (const r of local) lSec += Number(r.duration_seconds ?? 0);

const missingLocal = retell.filter((c) => !localById.has(String(c.call_id)));
const extraLocal = local.filter((r) => !retellById.has(String(r.provider_call_id ?? r.id)));
const drift = [];
for (const c of retell) {
  const r = localById.get(String(c.call_id));
  if (!r) continue;
  const provider = Math.round(Number(c.duration_ms ?? 0) / 1000);
  const webee = Number(r.duration_seconds ?? 0);
  if (Math.abs(provider - webee) > 1) drift.push({ id: c.call_id, provider, webee });
}

console.log(`\nProvider (Retell): ${retell.length} calls, ${(pSec / 60).toFixed(2)} min, cost ${pCostMissing === retell.length ? "unavailable" : `$${(pCost / 100).toFixed(2)}`}${pCostMissing ? ` (${pCostMissing} calls w/o cost)` : ""}`);
console.log(`WEBEE (wbah_calls): ${local.length} calls, ${(lSec / 60).toFixed(2)} min`);
console.log(`Difference: ${((lSec - pSec) / 60).toFixed(2)} min (tolerance ±${((retell.length * 0.5) / 60).toFixed(2)} min from per-call second rounding)`);

if (missingLocal.length) {
  console.log(`\nMissing from WEBEE (${missingLocal.length}):`);
  for (const c of missingLocal) console.log(`  ${c.call_id}  ${new Date(Number(c.start_timestamp)).toISOString()}  ${(Number(c.duration_ms ?? 0) / 60000).toFixed(2)} min  agent ${c.agent_id ?? "?"}`);
}
if (extraLocal.length) {
  console.log(`\nIn WEBEE but not provider window (${extraLocal.length}) — usually boundary/weak-id rows:`);
  for (const r of extraLocal.slice(0, 20)) console.log(`  ${r.id}  ${r.started_at}  ${(Number(r.duration_seconds ?? 0) / 60).toFixed(2)} min`);
  if (extraLocal.length > 20) console.log(`  … +${extraLocal.length - 20} more`);
}
if (drift.length) {
  console.log(`\nPer-call duration drift >1s (${drift.length}):`);
  for (const dRow of drift.slice(0, 20)) console.log(`  ${dRow.id}  provider ${dRow.provider}s vs webee ${dRow.webee}s`);
}
if (!missingLocal.length && !extraLocal.length && !drift.length) console.log("\n✓ Fully reconciled call-by-call.");
