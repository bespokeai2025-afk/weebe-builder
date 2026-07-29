// READ-ONLY campaign analytics data-accuracy audit (Phase 1).
// Uses the Supabase Management API to run SELECT-only queries against the live DB.
// Writes results to .local/analytics_audit/audit.json. NO writes, NO DDL.
import { writeFileSync, mkdirSync } from "node:fs";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
if (!token || !url) { console.error("MISSING SUPABASE env"); process.exit(2); }
const projectRef = new URL(url).host.split(".")[0];

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const out = { generatedAt: new Date().toISOString() };
const run = async (key, sql) => {
  try { out[key] = await q(sql); } catch (e) { out[key] = { error: String(e.message || e) }; }
  console.log(key, JSON.stringify(out[key]).slice(0, 1200));
};

// ---- calls table ----
await run("calls_overview", `
  select workspace_id, count(*) as rows, count(distinct retell_call_id) as distinct_provider_ids,
         count(*) filter (where retell_call_id is null) as null_provider_id,
         count(*) filter (where campaign_id is null) as null_campaign_id,
         count(*) filter (where duration_seconds is null) as null_duration,
         count(*) filter (where duration_seconds = 0) as zero_duration,
         min(started_at) as first_call, max(started_at) as last_call
  from calls group by workspace_id order by rows desc`);

await run("calls_dup_provider_ids", `
  select retell_call_id, count(*) as n from calls
  where retell_call_id is not null group by retell_call_id having count(*) > 1 limit 20`);

await run("calls_status_distribution", `
  select call_status, count(*) as n, sum(duration_seconds) as total_secs from calls group by call_status order by n desc`);

await run("calls_direction_distribution", `
  select call_type, count(*) as n from calls group by call_type`);

await run("calls_duration_sanity", `
  select count(*) filter (where duration_seconds > 7200) as over_2h,
         count(*) filter (where duration_seconds > 86400) as over_1d,
         max(duration_seconds) as max_secs,
         percentile_cont(0.5) within group (order by duration_seconds) as median_secs
  from calls where duration_seconds is not null`);

await run("calls_orphan_campaigns", `
  select c.workspace_id, count(*) as calls_with_missing_campaign
  from calls c left join campaigns cp on cp.id = c.campaign_id
  where c.campaign_id is not null and cp.id is null
  group by c.workspace_id`);

await run("calls_campaign_wrong_workspace", `
  select count(*) as n from calls c join campaigns cp on cp.id = c.campaign_id
  where cp.workspace_id is distinct from c.workspace_id`);

await run("calls_agents_multi_campaign", `
  select cp.workspace_id, cp.agent_id, count(distinct cp.id) as campaigns
  from campaigns cp where cp.agent_id is not null
  group by cp.workspace_id, cp.agent_id having count(distinct cp.id) > 1 limit 20`);

await run("calls_null_campaign_by_type", `
  select workspace_id, call_type, count(*) as n, sum(coalesce(duration_seconds,0)) as secs
  from calls where campaign_id is null group by workspace_id, call_type order by n desc limit 30`);

// ---- wbah_calls ----
await run("wbah_overview", `
  select count(*) as rows, count(distinct id) as distinct_ids,
         count(*) filter (where duration_seconds is null) as null_duration,
         count(*) filter (where duration_seconds = 0) as zero_duration,
         min(started_at) as first_call, max(started_at) as last_call
  from wbah_calls`);

await run("wbah_weak_id_dups", `
  select phone, started_at::date as d, count(*) as n
  from wbah_calls where phone is not null
  group by phone, started_at::date having count(*) > 3 order by n desc limit 15`);

await run("wbah_near_dup_pairs", `
  select count(*) as near_dup_pairs from (
    select a.id from wbah_calls a join wbah_calls b
      on a.phone = b.phone and a.id < b.id
      and abs(extract(epoch from (a.started_at - b.started_at))) < 90
    where a.phone is not null and a.phone <> ''
  ) t`);

await run("wbah_agent_distribution", `
  select agent_id, count(*) as n, sum(coalesce(duration_seconds,0)) as secs
  from wbah_calls group by agent_id order by n desc limit 15`);

// ---- campaigns ----
await run("campaigns_overview", `
  select workspace_id, count(*) as campaigns,
         count(*) filter (where status = 'archived') as archived
  from campaigns group by workspace_id`);

// duration column types (ms vs s check)
await run("duration_col_types", `
  select table_name, column_name, data_type from information_schema.columns
  where table_schema='public' and column_name ilike '%duration%' order by table_name`);

mkdirSync(".local/analytics_audit", { recursive: true });
writeFileSync(".local/analytics_audit/audit.json", JSON.stringify(out, null, 2));
console.log("\nWritten .local/analytics_audit/audit.json");
