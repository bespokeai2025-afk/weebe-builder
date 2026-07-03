/**
 * Backfill: enable the `transcript_updated` webhook event on already-deployed
 * Retell agents so the dashboard Live Calls panel shows a LIVE transcript during
 * the call. New/re-deployed agents get this automatically (see retell.functions.ts);
 * this script upgrades agents that were deployed BEFORE that change.
 *
 * Idempotent: an agent already subscribed to transcript_updated is skipped.
 * It only ADDS events (union with the default call_started/ended/analyzed trio),
 * never removes any — so post-call analytics/leads/CRM keep working unchanged.
 *
 * Run: node scripts/enable-live-transcript-events.mjs
 *
 * Required env:
 *   SUPABASE_URL / VITE_SUPABASE_URL   — project URL
 *   SUPABASE_SERVICE_ROLE_KEY          — service role key (reads workspaces/deployments)
 *   RETELL_API_KEY                     — shared platform key (fallback per workspace)
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLATFORM_KEY = process.env.RETELL_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const REQUIRED_EVENTS = [
  "call_started",
  "call_ended",
  "call_analyzed",
  "transcript_updated",
];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function retell(path, apiKey, method = "GET", body) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

// Resolve the set of {agentId, apiKey} pairs per workspace, mirroring the
// dashboard's key resolution: a workspace with its own retell_workspace_id key
// uses it; otherwise the shared platform key + only that workspace's deployments.
async function collectAgents() {
  const targets = new Map(); // agentId -> apiKey (dedup)

  const { data: workspaces, error: wsErr } = await supabase
    .from("workspace_settings")
    .select("workspace_id, retell_workspace_id");
  if (wsErr) throw new Error(`workspace_settings: ${wsErr.message}`);

  for (const ws of workspaces ?? []) {
    const workspaceId = ws.workspace_id;
    const workspaceKey = (ws.retell_workspace_id ?? "").trim() || null;
    const apiKey = workspaceKey || PLATFORM_KEY;
    if (!apiKey) continue;

    const { data: deps, error: depErr } = await supabase
      .from("deployments")
      .select("provider_agent_id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "retell")
      .not("provider_agent_id", "is", null);
    if (depErr) {
      console.warn(`  ⚠ deployments (${workspaceId}): ${depErr.message}`);
      continue;
    }
    for (const d of deps ?? []) {
      if (d.provider_agent_id) targets.set(d.provider_agent_id, apiKey);
    }
  }

  // Also pick up any agents referenced directly on the agents table (settings
  // may hold a deployed clone id that predates the deployments table).
  const { data: agents } = await supabase
    .from("agents")
    .select("retell_agent_id, workspace_id, settings");
  if (agents) {
    const wsKeyById = new Map(
      (workspaces ?? []).map((w) => [
        w.workspace_id,
        ((w.retell_workspace_id ?? "").trim() || PLATFORM_KEY) ?? null,
      ]),
    );
    for (const a of agents) {
      const key = wsKeyById.get(a.workspace_id) ?? PLATFORM_KEY;
      if (!key) continue;
      const deployedId = a.settings?.deployedRetellAgentId;
      if (deployedId && !targets.has(deployedId)) targets.set(deployedId, key);
    }
  }

  return targets;
}

const targets = await collectAgents();
console.log(`Found ${targets.size} deployed Retell agent(s) to check.\n`);

let updated = 0;
let skipped = 0;
let failed = 0;

for (const [agentId, apiKey] of targets) {
  try {
    const agent = await retell(`/get-agent/${agentId}`, apiKey);
    const existing = Array.isArray(agent.webhook_events) ? agent.webhook_events : [];
    const merged = Array.from(new Set([...existing, ...REQUIRED_EVENTS]));

    const alreadyHas = REQUIRED_EVENTS.every((e) => existing.includes(e));
    if (alreadyHas) {
      skipped++;
      console.log(`  = ${agentId} already subscribed — skipping`);
      continue;
    }

    await retell(`/update-agent/${agentId}`, apiKey, "PATCH", {
      webhook_events: merged,
    });
    updated++;
    console.log(`  ✓ ${agentId} → [${merged.join(", ")}]`);
  } catch (e) {
    failed++;
    console.warn(`  ✗ ${agentId}: ${e.message}`);
  }
}

console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
process.exit(0);
