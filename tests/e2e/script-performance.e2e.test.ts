/**
 * GrowthMind Script Performance intelligence (e2e, real DB).
 *
 * Verifies:
 *   • computeScriptPerformance — real-row aggregation (rates, per-agent, byHour),
 *     snapshot persisted to growthmind_script_analysis, 6h cache honoured
 *   • qualification proxy: standard = call_successful; sentiment must be positive+connected
 *   • generateScriptRecommendation — draft proposal + pending hivemind_actions row,
 *     never touches agents; fails cleanly with no analysis
 *   • multi-tenant isolation: workspace B never sees workspace A's analysis
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeScriptPerformance,
  getLatestScriptAnalysis,
  generateScriptRecommendation,
} from "@/lib/growthmind/growthmind.script-performance.server";

const sb = supabaseAdmin as any;

const WS_A = randomUUID();
const WS_B = randomUUID();
let ownerUserId: string;
let agentAvaId: string;
let agentMaxId: string;
let campaignAvaId: string;

const daysAgo = (d: number, hour = 10) => {
  const t = new Date(Date.now() - d * 86400_000);
  t.setUTCHours(hour, 15, 0, 0);
  return t.toISOString();
};

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;

  for (const id of [WS_A, WS_B]) {
    const { error: wErr } = await sb.from("workspaces").insert({
      id, name: `GM ScriptPerf test ${id.slice(0, 8)}`, slug: `gm-sp-${id.slice(0, 8)}`, owner_id: ownerUserId,
    });
    if (wErr) throw new Error(`workspace fixture failed: ${wErr.message}`);
  }

  // Real agents rows (campaigns.agent_id is a hard FK to agents)
  const { data: agA, error: aErr } = await sb.from("agents")
    .insert({ user_id: ownerUserId, workspace_id: WS_A, name: "Ava" }).select("id").maybeSingle();
  if (aErr || !agA) throw new Error(`agent fixture failed: ${aErr?.message}`);
  agentAvaId = agA.id;
  const { data: agB, error: bErr } = await sb.from("agents")
    .insert({ user_id: ownerUserId, workspace_id: WS_A, name: "Max" }).select("id").maybeSingle();
  if (bErr || !agB) throw new Error(`agent fixture failed: ${bErr?.message}`);
  agentMaxId = agB.id;

  // One campaign linked to Ava's agent — only Ava's calls should attribute to it.
  const { data: camp, error: campErr } = await sb.from("campaigns")
    .insert({ workspace_id: WS_A, name: "Spring Sweep", agent_id: agentAvaId, targets: [] })
    .select("id").maybeSingle();
  if (campErr || !camp) throw new Error(`campaign fixture failed: ${campErr?.message}`);
  campaignAvaId = camp.id;

  // Workspace A calls: 4 connected (2 positive, 2 call_successful), 1 voicemail, 1 failed.
  const calls = [
    { call_status: "completed", call_successful: true,  sentiment: "positive", duration_seconds: 180, agent_name: "Ava", agent_id: agentAvaId, created_at: daysAgo(2, 9) },
    { call_status: "completed", call_successful: true,  sentiment: "positive", duration_seconds: 240, agent_name: "Ava", agent_id: agentAvaId, created_at: daysAgo(3, 9) },
    { call_status: "completed", call_successful: false, sentiment: "neutral",  duration_seconds: 60,  agent_name: "Ava", agent_id: agentAvaId, created_at: daysAgo(4, 14) },
    { call_status: "completed", call_successful: false, sentiment: "negative", duration_seconds: 45,  agent_name: "Max", agent_id: agentMaxId, created_at: daysAgo(5, 14) },
    { call_status: "completed", call_successful: false, sentiment: "positive", duration_seconds: 30,  agent_name: "Max", agent_id: agentMaxId, created_at: daysAgo(6, 16), is_voicemail: true },
    { call_status: "failed",    call_successful: false, sentiment: null,        duration_seconds: 0,   agent_name: "Max", agent_id: agentMaxId, created_at: daysAgo(7, 16) },
  ];
  for (const c of calls) {
    const { error: cErr } = await sb.from("calls").insert({ workspace_id: WS_A, to_number: "+447000000001", ...c });
    if (cErr) throw new Error(`calls fixture failed: ${cErr.message}`);
  }
});

afterAll(async () => {
  for (const id of [WS_A, WS_B]) {
    await sb.from("growthmind_script_analysis").delete().eq("workspace_id", id);
    await sb.from("growthmind_campaign_proposals").delete().eq("workspace_id", id);
    await sb.from("hivemind_actions").delete().eq("workspace_id", id);
    await sb.from("calls").delete().eq("workspace_id", id);
    await sb.from("campaigns").delete().eq("workspace_id", id);
    await sb.from("agents").delete().eq("workspace_id", id);
    await sb.from("workspaces").delete().eq("id", id);
  }
});

describe("computeScriptPerformance", () => {
  it("aggregates real rows into per-agent metrics and persists a snapshot", async () => {
    const a = await computeScriptPerformance(sb, WS_A, { force: true });
    expect(a.source).toBe("standard");
    expect(a.totals.calls).toBe(6);
    expect(a.totals.connected).toBe(4); // voicemail + failed excluded
    // positiveRate over connected: 2/4 = 50 (voicemail positive must NOT count)
    expect(a.totals.positiveRate).toBe(50);
    // qualified proxy = call_successful over connected: 2/4 = 50
    expect(a.totals.qualifiedRate).toBe(50);

    const ava = a.agents.find(x => x.agentName === "Ava");
    const max = a.agents.find(x => x.agentName === "Max");
    expect(ava).toBeTruthy();
    expect(max).toBeTruthy();
    expect(ava!.total).toBe(3);
    expect(ava!.connected).toBe(3);
    expect(ava!.qualified).toBe(2);
    expect(max!.connected).toBe(1); // voicemail + failed excluded
    expect(ava!.byHour.length).toBeGreaterThan(0);

    // Snapshot persisted
    const { data: rows } = await sb.from("growthmind_script_analysis").select("id, sample_size, metrics").eq("workspace_id", WS_A);
    expect(rows?.length).toBe(1);
    expect(rows![0].sample_size).toBe(6);
    // Campaign breakdown persisted inside metrics JSON
    expect(Array.isArray((rows![0].metrics as any)?.campaigns)).toBe(true);
  });

  it("attributes calls to campaigns via the campaign's agent (per-campaign breakdown)", async () => {
    // Read back the snapshot written by the first test (no second snapshot —
    // keeps the cache-count assertion below intact) and verify the campaign
    // breakdown both computed correctly and survived the JSON round-trip.
    const a = await getLatestScriptAnalysis(sb, WS_A);
    expect(a).toBeTruthy();
    // Only Ava's agent is linked to a campaign — Max's calls must NOT attribute.
    expect(a!.campaigns.length).toBe(1);
    const camp = a!.campaigns[0];
    expect(camp.campaignKey).toBe(campaignAvaId);
    expect(camp.campaignName).toBe("Spring Sweep");
    expect(camp.total).toBe(3);           // Ava's 3 calls only
    expect(camp.connected).toBe(3);
    expect(camp.positive).toBe(2);
    expect(camp.qualified).toBe(2);
    expect(camp.byHour.length).toBeGreaterThan(0);
  });

  it("serves the cached snapshot when fresh (no force)", async () => {
    const cached = await computeScriptPerformance(sb, WS_A);
    const { data: rows } = await sb.from("growthmind_script_analysis").select("id").eq("workspace_id", WS_A);
    expect(rows?.length).toBe(1); // no second snapshot written
    expect(cached.totals.calls).toBe(6);
  });

  it("is workspace-isolated", async () => {
    const none = await getLatestScriptAnalysis(sb, WS_B);
    expect(none).toBeNull();
    const b = await computeScriptPerformance(sb, WS_B, { force: true });
    expect(b.totals.calls).toBe(0);
  });
});

describe("generateScriptRecommendation", () => {
  it("fails cleanly when no analysis has calls", async () => {
    const res = await generateScriptRecommendation(sb, randomUUID(), { kind: "revision" });
    expect(res.ok).toBe(false);
  });

  it("creates a draft proposal + pending hivemind action, never touching agents", async () => {
    const before = await sb.from("agents").select("id", { count: "exact", head: true });
    const res = await generateScriptRecommendation(sb, WS_A, { kind: "ab_experiment", agentKey: null });
    expect(res.ok).toBe(true);
    expect(res.proposalId).toBeTruthy();

    const { data: prop } = await sb.from("growthmind_campaign_proposals").select("status, title, content_plan").eq("id", res.proposalId).maybeSingle();
    expect(prop?.status).toBe("draft");
    expect(prop?.content_plan?.length).toBeGreaterThan(100);

    const { data: acts } = await sb.from("hivemind_actions").select("status, action_type, action_payload").eq("workspace_id", WS_A);
    expect(acts?.length).toBe(1);
    expect(acts![0].status).toBe("pending");
    expect((acts![0].action_payload as any)?.proposalId).toBe(res.proposalId);

    const after = await sb.from("agents").select("id", { count: "exact", head: true });
    expect(after.count).toBe(before.count);
  });

  it("scopes a recommendation to a selected campaign", async () => {
    const res = await generateScriptRecommendation(sb, WS_A, { kind: "revision", campaignKey: campaignAvaId });
    expect(res.ok).toBe(true);
    expect(res.title).toContain("Spring Sweep");

    const { data: prop } = await sb.from("growthmind_campaign_proposals")
      .select("reason, audience").eq("id", res.proposalId).maybeSingle();
    expect(prop?.reason).toContain('campaign "Spring Sweep"');
    expect(prop?.audience).toContain('campaign "Spring Sweep"');

    const { data: acts } = await sb.from("hivemind_actions")
      .select("action_payload").eq("workspace_id", WS_A).order("created_at", { ascending: false }).limit(1);
    expect((acts?.[0]?.action_payload as any)?.campaignKey).toBe(campaignAvaId);
  });
});
