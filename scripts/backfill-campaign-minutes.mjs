#!/usr/bin/env node
/**
 * Backfill calls.campaign_id for historical calls (idempotent, batched).
 *
 * Attribution rules (conservative — never guess across ambiguity):
 *   1. campaigns.stats->>retell_agent_id / campaigns.agent_id → agent match,
 *      only when that agent maps to exactly ONE campaign in the workspace.
 *   2. Call must fall on/after the campaign's created_at (no pre-campaign calls).
 *   3. Rows that already have campaign_id are never touched.
 *   4. Ambiguous or unmatched calls stay NULL → "Unassigned Campaign".
 *
 * Usage: node scripts/backfill-campaign-minutes.mjs [--dry-run] [--workspace <id>]
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const DRY = process.argv.includes("--dry-run");
const wsArgIdx = process.argv.indexOf("--workspace");
const ONLY_WS = wsArgIdx > -1 ? process.argv[wsArgIdx + 1] : null;
const BATCH = 500;

async function main() {
  // 1. Load all campaigns and build per-workspace agent→campaign maps.
  const { data: campaigns, error: cErr } = await sb
    .from("campaigns")
    .select("id, workspace_id, name, agent_id, created_at, stats");
  if (cErr) throw new Error(`campaigns: ${cErr.message}`);

  // Resolve each campaign's callable agent ids: the local agents row id, its
  // retell_agent_id and deployed clone id (calls.agent_id stores Retell ids).
  const agentIds = [...new Set((campaigns ?? []).map((c) => c.agent_id).filter(Boolean))];
  const agentRows = [];
  for (let i = 0; i < agentIds.length; i += 100) {
    const { data, error } = await sb
      .from("agents")
      .select("id, retell_agent_id, settings")
      .in("id", agentIds.slice(i, i + 100));
    if (error) throw new Error(`agents: ${error.message}`);
    agentRows.push(...(data ?? []));
  }
  const agentById = new Map(agentRows.map((a) => [a.id, a]));

  // ws → (retellAgentId → Set<campaign>)
  const wsAgentCampaigns = new Map();
  for (const c of campaigns ?? []) {
    if (ONLY_WS && c.workspace_id !== ONLY_WS) continue;
    const keys = new Set();
    const a = c.agent_id ? agentById.get(c.agent_id) : null;
    if (a) {
      if (a.retell_agent_id) keys.add(String(a.retell_agent_id).replace(/^(published_|draft_)/, ""));
      const dep = a.settings?.deployedRetellAgentId;
      if (dep) keys.add(String(dep));
      keys.add(String(c.agent_id));
    }
    const statsAgent = c.stats?.retell_agent_id;
    if (statsAgent) keys.add(String(statsAgent));
    if (keys.size === 0) continue;
    const m = wsAgentCampaigns.get(c.workspace_id) ?? new Map();
    for (const k of keys) {
      const set = m.get(k) ?? new Set();
      set.add(c);
      m.set(k, set);
    }
    wsAgentCampaigns.set(c.workspace_id, m);
  }

  let scanned = 0, updated = 0, ambiguous = 0, unmatched = 0;

  for (const [wsId, agentMap] of wsAgentCampaigns) {
    // Page through this workspace's unattributed calls.
    let from = 0;
    for (;;) {
      const { data: calls, error } = await sb
        .from("calls")
        .select("id, agent_id, created_at, started_at")
        .eq("workspace_id", wsId)
        .is("campaign_id", null)
        .order("created_at", { ascending: true })
        .range(from, from + BATCH - 1);
      if (error) throw new Error(`calls(${wsId}): ${error.message}`);
      const rows = calls ?? [];
      scanned += rows.length;

      const updates = new Map(); // campaignId → [callIds]
      for (const call of rows) {
        const key = call.agent_id ? String(call.agent_id).replace(/^(published_|draft_)/, "") : null;
        const set = key ? agentMap.get(key) ?? agentMap.get(String(call.agent_id)) : null;
        if (!set || set.size === 0) { unmatched++; continue; }
        const at = call.started_at ?? call.created_at;
        const eligible = [...set].filter((c) => !c.created_at || !at || at >= c.created_at);
        if (eligible.length !== 1) { ambiguous++; continue; }
        const cid = eligible[0].id;
        const list = updates.get(cid) ?? [];
        list.push(call.id);
        updates.set(cid, list);
      }

      for (const [campaignId, ids] of updates) {
        if (DRY) {
          console.log(`[dry-run] ws=${wsId} campaign=${campaignId} would update ${ids.length} calls`);
          updated += ids.length;
          continue;
        }
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const { error: uErr } = await sb
            .from("calls")
            .update({ campaign_id: campaignId })
            .in("id", chunk)
            .is("campaign_id", null); // never overwrite concurrent attribution
          if (uErr) { console.error(`update failed ws=${wsId}: ${uErr.message}`); continue; }
          updated += chunk.length;
        }
      }

      if (rows.length < BATCH) break;
      from += BATCH;
    }
  }

  console.log(JSON.stringify({ dryRun: DRY, scanned, updated, ambiguous, unmatched }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
