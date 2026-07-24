/**
 * Executive recommendation follow-through — mode gating + approval routing (e2e, real DB).
 *
 * Verifies:
 *   • observe mode: no follow-through may be proposed (fail closed)
 *   • recommend mode: external/sensitive follow-through downgraded to internal create_task
 *   • assistant mode: stale_lead_backlog maps to a SENSITIVE create_followup_campaign
 *     with server-built lead_ids, landing "pending" (approval required, never executed)
 *   • dedup: one live follow-through per recommendation
 *   • outcome reflection: executed→completed, rejected→under_review, failed→failed,
 *     terminal recommendations never resurrected
 *   • runExecutiveReasoning auto-proposes follow-throughs only in assistant/operator modes
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  proposeFollowThroughForRecommendation,
  reflectActionOutcomeOnRecommendation,
  ruleOfDedupeKey,
  type RecommendationRow,
} from "@/lib/hivemind/executive-followthrough.server";
import type { HiveMindModeConfig } from "@/lib/hivemind/mode-gate.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();
let ownerUserId: string;

const DAY = 86_400_000;

function cfg(mode: HiveMindModeConfig["mode"]): HiveMindModeConfig {
  return { mode, operatorEnabled: mode === "operator", operatorPermissions: {} };
}

async function insertRec(overrides: Record<string, unknown> = {}): Promise<RecommendationRow> {
  const { data, error } = await sb.from("hivemind_recommendations").insert({
    workspace_id: WS,
    title: "Recover 12 stale leads before intent decays",
    department: "crm",
    priority: "high",
    business_issue: "12 leads have waited more than 7 days without any first contact attempt.",
    recommended_action: "Assign the 12 untouched leads to an owner today and run the recovery call sequence, oldest first.",
    next_step: "Open the leads list filtered to need-to-call.",
    evidence: { metrics: { staleLeads: 12, daysWaiting: 9 } },
    confidence: 0.8,
    status: "new",
    source: "executive_reasoning",
    dedupe_key: `test:${randomUUID()}`,
    ...overrides,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as RecommendationRow;
}

beforeAll(async () => {
  const { data: profiles, error } = await sb.from("profiles").select("user_id").limit(1);
  if (error || !profiles?.length) throw new Error("Need an existing user for workspace fixture");
  ownerUserId = profiles[0].user_id;
  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: `exec-ft e2e ${WS.slice(0, 8)}`,
    slug: `exec-ft-e2e-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (wErr) throw new Error(`fixture workspace insert failed: ${wErr.message}`);
}, 60_000);

afterAll(async () => {
  await sb.from("workspaces").delete().eq("id", WS);
}, 60_000);

describe("ruleOfDedupeKey", () => {
  it("strips the trailing date suffix only", () => {
    expect(ruleOfDedupeKey("stale_lead_backlog:2026-07-24")).toBe("stale_lead_backlog");
    expect(ruleOfDedupeKey("event:campaign_failed:abc")).toBe("event:campaign_failed:abc");
  });
});

describe("mode gating of follow-through", () => {
  it("observe mode proposes nothing (fail closed)", async () => {
    const rec = await insertRec();
    const res = await proposeFollowThroughForRecommendation(sb, WS, rec, cfg("observe"), {
      isWbah: false, proposedBy: "executive_reasoning",
    });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe("observe_mode");
    const { data: acts } = await sb.from("hivemind_actions")
      .select("id").eq("workspace_id", WS).eq("source_recommendation_id", rec.id);
    expect((acts ?? []).length).toBe(0);
  }, 60_000);

  it("closed recommendations never trigger anything", async () => {
    const rec = await insertRec({ status: "dismissed" });
    const res = await proposeFollowThroughForRecommendation(sb, WS, rec, cfg("assistant"), {
      isWbah: false, proposedBy: "executive_reasoning",
    });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe("closed_recommendation");
  }, 60_000);

  it("recommend mode downgrades a sensitive mapping to an internal create_task", async () => {
    // Seed stale leads so the stale_lead_backlog mapping WOULD produce a campaign.
    const stale = new Date(Date.now() - 10 * DAY).toISOString();
    for (let i = 0; i < 3; i++) {
      const { error } = await sb.from("leads").insert({
        workspace_id: WS,
        full_name: `e2e stale lead ${i}`,
        phone: `+4470000000${i}`,
        status: "need_to_call",
        source: "website_form",
        updated_at: stale,
      });
      if (error) throw new Error(error.message);
    }
    const rec = await insertRec({ dedupe_key: "stale_lead_backlog:2026-07-24" });
    const res = await proposeFollowThroughForRecommendation(sb, WS, rec, cfg("recommend"), {
      isWbah: false, proposedBy: "executive_reasoning",
    });
    expect(res.ok).toBe(true);
    expect(res.actionType).toBe("create_task");
    expect(res.downgraded).toBe(true);
    expect(res.sensitive).toBe(false);
    const { data: act } = await sb.from("hivemind_actions")
      .select("status, sensitive, action_type").eq("id", res.actionId).single();
    expect(act.status).toBe("pending");
    expect(act.sensitive).toBe(false);
    // Clean up rec link for later tests (leads stay for the assistant test).
    await sb.from("hivemind_actions").delete().eq("id", res.actionId);
  }, 60_000);

  it("assistant mode maps stale_lead_backlog to a SENSITIVE pending campaign with server-built lead_ids", async () => {
    const rec = await insertRec({ dedupe_key: "stale_lead_backlog:2026-07-25" });
    const res = await proposeFollowThroughForRecommendation(sb, WS, rec, cfg("assistant"), {
      isWbah: false, proposedBy: "executive_reasoning",
    });
    expect(res.ok).toBe(true);
    expect(res.actionType).toBe("create_followup_campaign");
    expect(res.sensitive).toBe(true);
    const { data: act } = await sb.from("hivemind_actions")
      .select("status, sensitive, sensitive_category, action_payload, source_recommendation_id")
      .eq("id", res.actionId).single();
    expect(act.status).toBe("pending"); // NEVER auto-executed
    expect(act.sensitive).toBe(true);
    expect(act.sensitive_category).toBeTruthy();
    expect(act.source_recommendation_id).toBe(rec.id);
    expect(Array.isArray(act.action_payload.lead_ids)).toBe(true);
    expect(act.action_payload.lead_ids.length).toBeGreaterThanOrEqual(3);

    // Dedup: a second follow-through for the same rec is refused.
    const again = await proposeFollowThroughForRecommendation(sb, WS, rec, cfg("assistant"), {
      isWbah: false, proposedBy: "executive_reasoning",
    });
    expect(again.ok).toBe(false);
    expect(again.skipped).toBe("already_linked");
  }, 60_000);

  it("WBAH workspaces never query leads — always internal task", async () => {
    const rec = await insertRec({ dedupe_key: "stale_lead_backlog:2026-07-26" });
    const res = await proposeFollowThroughForRecommendation(sb, WS, rec, cfg("assistant"), {
      isWbah: true, proposedBy: "executive_reasoning",
    });
    expect(res.ok).toBe(true);
    expect(res.actionType).toBe("create_task");
  }, 60_000);
});

describe("outcome reflection onto recommendations", () => {
  it("executed → completed, rejected → under_review, failed → failed", async () => {
    for (const [outcome, expected] of [
      ["executed", "completed"],
      ["rejected", "under_review"],
      ["failed", "failed"],
    ] as const) {
      const rec = await insertRec({ status: "in_progress" });
      await reflectActionOutcomeOnRecommendation(sb, WS, rec.id, outcome);
      const { data } = await sb.from("hivemind_recommendations")
        .select("status, result").eq("id", rec.id).single();
      expect(data.status).toBe(expected);
      expect(data.result).toBeTruthy();
    }
  }, 60_000);

  it("never resurrects a terminal recommendation", async () => {
    const rec = await insertRec({ status: "dismissed" });
    await reflectActionOutcomeOnRecommendation(sb, WS, rec.id, "executed");
    const { data } = await sb.from("hivemind_recommendations")
      .select("status").eq("id", rec.id).single();
    expect(data.status).toBe("dismissed");
  }, 60_000);

  it("is a no-op without a source recommendation id", async () => {
    await expect(
      reflectActionOutcomeOnRecommendation(sb, WS, null, "executed"),
    ).resolves.toBeUndefined();
  });
});

describe("reasoning engine auto-proposal by mode", () => {
  it("assistant mode auto-proposes pending follow-throughs for new event-driven recs", async () => {
    // Put the workspace into assistant mode.
    await sb.from("workspace_settings").upsert(
      { workspace_id: WS, hivemind_mode: "assistant" },
      { onConflict: "workspace_id" },
    );
    const { publishExecutiveEvent, classifyPendingExecutiveEvents } =
      await import("@/lib/hivemind/executive-events.shared");
    const pub = await publishExecutiveEvent(sb, {
      workspaceId: WS,
      eventType: "campaign_failed",
      sourceSystem: "campaigns",
      title: "Campaign send failed for 42 recipients",
      summary: "The outbound campaign batch failed with provider errors on 42 of 50 recipients.",
      dedupKey: `e2e-ft-campaign-fail:${WS}`,
      evidence: { failedRecipients: 42, totalRecipients: 50 },
    });
    expect(pub.ok).toBe(true);
    await classifyPendingExecutiveEvents(sb, 500);

    const { runExecutiveReasoning } = await import("@/lib/hivemind/executive-reasoning.server");
    const run = await runExecutiveReasoning(sb, WS, false);
    expect(run.ok).toBe(true);
    expect(run.insertedRecs).toBeGreaterThanOrEqual(1);
    expect(run.proposedFollowThroughs).toBeGreaterThanOrEqual(1);

    // Every auto-proposed follow-through is pending + linked, never executed.
    const { data: acts } = await sb.from("hivemind_actions")
      .select("status, source_recommendation_id, proposed_by")
      .eq("workspace_id", WS)
      .not("source_recommendation_id", "is", null);
    expect((acts ?? []).length).toBeGreaterThanOrEqual(1);
    for (const a of acts ?? []) {
      expect(["pending"]).toContain(a.status);
    }
  }, 120_000);

  it("observe mode: the engine writes nothing at all", async () => {
    await sb.from("workspace_settings").update({ hivemind_mode: "observe" }).eq("workspace_id", WS);
    const { runExecutiveReasoning } = await import("@/lib/hivemind/executive-reasoning.server");
    const run = await runExecutiveReasoning(sb, WS, false);
    expect(run.ok).toBe(true);
    expect(run.insertedRecs).toBe(0);
    expect(run.insertedTasks).toBe(0);
    expect(run.proposedFollowThroughs).toBe(0);
  }, 60_000);
});
