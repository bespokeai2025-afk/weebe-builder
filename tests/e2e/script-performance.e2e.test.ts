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

  // Workspace A calls: 4 connected (2 positive, 2 call_successful), 1 voicemail, 1 failed.
  const calls = [
    { call_status: "completed", call_successful: true,  sentiment: "positive", duration_seconds: 180, agent_name: "Ava",  created_at: daysAgo(2, 9) },
    { call_status: "completed", call_successful: true,  sentiment: "positive", duration_seconds: 240, agent_name: "Ava",  created_at: daysAgo(3, 9) },
    { call_status: "completed", call_successful: false, sentiment: "neutral",  duration_seconds: 60,  agent_name: "Ava",  created_at: daysAgo(4, 14) },
    { call_status: "completed", call_successful: false, sentiment: "negative", duration_seconds: 45,  agent_name: "Max",  created_at: daysAgo(5, 14) },
    { call_status: "completed", call_successful: false, sentiment: "positive", duration_seconds: 30,  agent_name: "Max",  created_at: daysAgo(6, 16), is_voicemail: true },
    { call_status: "failed",    call_successful: false, sentiment: null,        duration_seconds: 0,   agent_name: "Max",  created_at: daysAgo(7, 16) },
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
    const { data: rows } = await sb.from("growthmind_script_analysis").select("id, sample_size").eq("workspace_id", WS_A);
    expect(rows?.length).toBe(1);
    expect(rows![0].sample_size).toBe(6);
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
});
