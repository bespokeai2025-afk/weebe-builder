/**
 * End-to-end verification that HiveMind chat cites SPECIFIC pending Google Ads
 * recommendations (campaign names + actions) when the user asks about their
 * campaigns.
 *
 * This exercises the real production chat path against the live database:
 *   1. Seeds pending critical/high recommendations into
 *      growthmind_gads_recommendations for the workspace with the active
 *      Google Ads account.
 *   2. Runs the real fetchFullPlatformData → buildPlatformContext →
 *      buildSystemPrompt pipeline (same code getHiveMindAIResponse uses).
 *   3. Sends "what's happening with my campaigns" to OpenAI with that system
 *      prompt (same model/params as getHiveMindAIResponse).
 *   4. Asserts the reply names the seeded campaigns and their actions.
 *   5. Cleans up the seeded rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { fetchFullPlatformData, buildPlatformContext, buildSystemPrompt } from "@/lib/hivemind/hivemind.ai";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const DEDUPE_A = "e2e-hivemind-chat:critical:zero-conv";
const DEDUPE_B = "e2e-hivemind-chat:high:budget-cap";
const CAMPAIGN_A = "Brand Search E2E-Alpha";
const CAMPAIGN_B = "Generic Leads E2E-Beta";

let workspaceId = "";
let accountRowId = "";

describe("HiveMind chat cites specific pending Google Ads actions", () => {
  beforeAll(async () => {
    expect(SUPABASE_URL, "SUPABASE_URL required").toBeTruthy();
    expect(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY required").toBeTruthy();
    expect(OPENAI_KEY, "OPENAI_API_KEY required").toBeTruthy();

    const { data: acct, error } = await sb
      .from("growthmind_ads_accounts")
      .select("id,workspace_id")
      .eq("platform", "google").eq("status", "active")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    expect(acct, "an active Google Ads account row is required").toBeTruthy();
    workspaceId = acct!.workspace_id;
    accountRowId = acct!.id;

    const { error: seedErr } = await sb.from("growthmind_gads_recommendations").upsert(
      [
        {
          workspace_id: workspaceId,
          account_row_id: accountRowId,
          campaign_id: "e2e-alpha-1",
          campaign_name: CAMPAIGN_A,
          section: "wasted_spend",
          priority: "critical",
          confidence: 0.9,
          title: `Campaign "${CAMPAIGN_A}" spent £480 in 30 days with zero conversions`,
          evidence: { spend30d: 480, clicks30d: 610, conversions30d: 0 },
          expected_benefit: "Recover roughly £480/month in wasted spend",
          recommended_action: `Pause campaign "${CAMPAIGN_A}" — 610 clicks and £480 spend produced zero conversions in the last 30 days.`,
          status: "new",
          dedupe_key: DEDUPE_A,
        },
        {
          workspace_id: workspaceId,
          account_row_id: accountRowId,
          campaign_id: "e2e-beta-2",
          campaign_name: CAMPAIGN_B,
          section: "budget_opportunity",
          priority: "high",
          confidence: 0.8,
          title: `Campaign "${CAMPAIGN_B}" is limited by budget while converting at £12 per lead`,
          evidence: { spend30d: 900, conversions30d: 75, budgetLostImpressionShare: 0.42 },
          expected_benefit: "Around 30 extra leads/month at the current £12 cost per lead",
          recommended_action: `Raise the daily budget on "${CAMPAIGN_B}" from £30 to £45 — it loses 42% impression share to budget while converting at £12 per lead.`,
          status: "new",
          dedupe_key: DEDUPE_B,
        },
      ],
      { onConflict: "workspace_id,dedupe_key" },
    );
    if (seedErr) throw seedErr;
  });

  afterAll(async () => {
    if (workspaceId) {
      await sb.from("growthmind_gads_recommendations")
        .delete().eq("workspace_id", workspaceId)
        .in("dedupe_key", [DEDUPE_A, DEDUPE_B]);
    }
  });

  it("includes the seeded pending recommendations in the live context block", async () => {
    const platformData = await fetchFullPlatformData(sb, workspaceId);
    expect(platformData.gadsLive, "gadsLive block must be present").toBeTruthy();
    const ctx = buildPlatformContext(platformData);
    expect(ctx).toContain("LIVE GOOGLE ADS");
    expect(ctx).toContain("PENDING RECOMMENDATIONS AWAITING USER DECISION");
    expect(ctx).toContain(CAMPAIGN_A);
    expect(ctx).toContain(CAMPAIGN_B);
    expect(ctx).toContain("[CRITICAL]");
    expect(ctx).toContain("[HIGH]");
  });

  it('replies to "what\'s happening with my campaigns" citing the specific campaigns and actions', async () => {
    const platformData = await fetchFullPlatformData(sb, workspaceId);
    const ctx = buildPlatformContext(platformData);
    const systemPrompt = buildSystemPrompt(ctx, "friendly");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "what's happening with my campaigns" },
        ],
        max_tokens: 350,
        temperature: 0.4,
      }),
    });
    expect(res.ok, `OpenAI error: ${res.status}`).toBe(true);
    const json = (await res.json()) as any;
    const reply: string = json.choices?.[0]?.message?.content ?? "";
    console.log("\n──── HiveMind reply ────\n" + reply + "\n────────────────────────\n");
    try {
      const fs = await import("node:fs");
      fs.writeFileSync("/tmp/hivemind-gads-reply.txt", reply);
    } catch {}

    // Must name both specific campaigns
    expect(reply).toContain(CAMPAIGN_A);
    expect(reply).toContain(CAMPAIGN_B);
    // Must reflect the concrete actions, not generic advice
    expect(/paus/i.test(reply)).toBe(true);
    expect(/budget/i.test(reply)).toBe(true);
  }, 120_000);
});
