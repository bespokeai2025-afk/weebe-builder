#!/usr/bin/env node
// Idempotent WBAH backfill: merges Retell-recorded provider cost/duration into
// wbah_calls.meta (cost_usd_cents, duration_ms) and inserts any provider calls
// missing from wbah_calls entirely. Safe to re-run; only touches rows whose
// meta lacks the fields or whose row is missing.
//
// Usage: set -a; source .env; set +a; node scripts/wbah-backfill-retell-costs.mjs [--days 35] [--dry-run]
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const daysIdx = args.indexOf("--days");
const DAYS = daysIdx >= 0 ? Math.min(90, Number(args[daysIdx + 1]) || 35) : 35;
const offIdx = args.indexOf("--offset-days");
const OFFSET_DAYS = offIdx >= 0 ? Math.max(0, Number(args[offIdx + 1]) || 0) : 0;

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

const endMs = Date.now() - OFFSET_DAYS * 24 * 3600 * 1000;
const startMs = endMs - DAYS * 24 * 3600 * 1000;
console.log(`Backfill window: ${DAYS}d ending ${OFFSET_DAYS}d ago (${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()})${DRY ? " [DRY RUN]" : ""}`);

// ── Fetch ALL Retell calls in window (throw on any page failure) ──
const items = [];
let pk;
for (let page = 0; page < 60; page++) {
  const res = await fetch("https://api.retellai.com/v3/list-calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: 1000, sort_order: "descending",
      filter_criteria: { start_timestamp: { type: "range", op: "bt", value: [startMs, endMs] } },
      ...(pk ? { pagination_key: pk } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Retell ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const pageItems = j.items ?? j.calls ?? [];
  const seen = new Set(items.map((c) => c.call_id));
  let added = 0;
  for (const c of pageItems) if (c.call_id && !seen.has(c.call_id)) { items.push(c); added++; }
  console.log(`  page ${page + 1}: +${added} (total ${items.length})`);
  if (!j.has_more || !j.pagination_key || added === 0) break;
  pk = j.pagination_key;
}
console.log(`Retell calls fetched: ${items.length}`);

// ── Fetch existing wbah_calls rows for those provider ids (batched) ──
const byId = new Map(items.map((c) => [String(c.call_id), c]));
const ids = [...byId.keys()];
const existing = new Map();
for (let i = 0; i < ids.length; i += 200) {
  const batch = ids.slice(i, i + 200);
  const { data, error } = await sb.from("wbah_calls")
    .select("id, provider_call_id, meta")
    .eq("workspace_id", wsId)
    .in("id", batch);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) existing.set(String(r.id), r);
}
console.log(`Matched existing rows: ${existing.size}`);

// ── 1. Merge cost/duration into meta where missing ──
let metaUpdated = 0, metaSkipped = 0;
const pendingUpdates = [];
for (const [id, row] of existing) {
  const c = byId.get(id);
  const meta = row.meta ?? {};
  const cost = typeof c.call_cost?.combined_cost === "number" ? c.call_cost.combined_cost : null;
  const durMs = Number.isFinite(Number(c.duration_ms)) ? Number(c.duration_ms) : null;
  const needsCost = meta.cost_usd_cents == null && cost != null;
  const needsDur = meta.duration_ms == null && durMs != null;
  if (!needsCost && !needsDur) { metaSkipped++; continue; }
  const next = { ...meta };
  if (needsCost) next.cost_usd_cents = cost;
  if (needsDur) next.duration_ms = durMs;
  pendingUpdates.push({ id, next });
}
if (!DRY) {
  const CONCURRENCY = 20;
  for (let i = 0; i < pendingUpdates.length; i += CONCURRENCY) {
    await Promise.all(pendingUpdates.slice(i, i + CONCURRENCY).map(async ({ id, next }) => {
      const { error } = await sb.from("wbah_calls").update({ meta: next }).eq("id", id).eq("workspace_id", wsId);
      if (error) throw new Error(`meta update ${id}: ${error.message}`);
    }));
    if ((i / CONCURRENCY) % 25 === 0) console.log(`  meta updates: ${Math.min(i + CONCURRENCY, pendingUpdates.length)}/${pendingUpdates.length}`);
  }
}
metaUpdated = pendingUpdates.length;
console.log(`Meta backfilled: ${metaUpdated} rows updated, ${metaSkipped} already complete`);

// ── 2. Insert provider calls missing from wbah_calls ──
const missing = ids.filter((id) => !existing.has(id));
console.log(`Missing calls to insert: ${missing.length}${missing.length ? " → " + missing.join(", ") : ""}`);
let inserted = 0;
for (const id of missing) {
  const c = byId.get(id);
  const dv = c.retell_llm_dynamic_variables ?? c.collected_dynamic_variables ?? {};
  const durationMs = Number(c.duration_ms ?? 0);
  const rawStatus = String(c.call_status ?? "");
  const sentiment = String(c.call_analysis?.user_sentiment ?? "").toLowerCase();
  const row = {
    id, workspace_id: wsId,
    customer_name: dv.name ?? ([dv.first_name, dv.last_name].filter(Boolean).join(" ").trim() || null),
    phone: c.to_number ?? c.from_number ?? dv.mobile ?? null,
    agent_name: c.agent_name ?? null,
    // Same normalization as the live sync (wbah-retell-calls-sync normStatus).
    call_status: rawStatus.toLowerCase() === "ended" ? (durationMs > 0 ? "completed" : "no_answer")
      : rawStatus.toLowerCase() === "error" ? "failed"
      : rawStatus.toLowerCase() === "ongoing" ? "ongoing" : "no_answer",
    call_type: c.direction === "inbound" ? "inbound" : "outbound",
    sentiment: ["positive", "neutral", "negative"].includes(sentiment) ? sentiment : null,
    duration_seconds: durationMs > 0 ? Math.round(durationMs / 1000) : (rawStatus.toLowerCase() === "ended" ? 0 : null),
    started_at: c.start_timestamp ? new Date(Number(c.start_timestamp)).toISOString() : null,
    recording_url: c.recording_url ?? null,
    transcript: typeof c.transcript === "string" && c.transcript.trim() ? c.transcript : null,
    call_summary: c.call_analysis?.call_summary ?? null,
    disconnection_reason: c.disconnection_reason ?? null,
    end_reason: c.disconnection_reason ?? null,
    call_count: 1,
    provider_call_id: id,
    lead_id: dv.lead_id != null ? String(dv.lead_id) : null,
    meta: {
      source: "retell", backfilled: true,
      cost_usd_cents: typeof c.call_cost?.combined_cost === "number" ? c.call_cost.combined_cost : null,
      duration_ms: Number.isFinite(durationMs) ? durationMs : null,
      call_successful: c.call_analysis?.call_successful ?? null,
      in_voicemail: c.call_analysis?.in_voicemail ?? null,
      lead_id: dv.lead_id ?? null,
      agent_id: c.agent_id ?? null,
      custom_analysis: c.call_analysis?.custom_analysis_data ?? null,
      dynamic_variables: dv,
    },
    synced_at: new Date().toISOString(),
  };
  if (!DRY) {
    const { error } = await sb.from("wbah_calls").upsert(row, { onConflict: "id" });
    if (error) throw new Error(`insert ${id}: ${error.message}`);
  }
  inserted++;
}
console.log(`Inserted: ${inserted}${DRY ? " (dry run — nothing written)" : ""}`);
console.log("Backfill complete.");
