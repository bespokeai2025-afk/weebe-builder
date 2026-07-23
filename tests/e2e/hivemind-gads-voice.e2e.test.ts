/**
 * End-to-end verification that the HiveMind VOICE assistant's system context
 * (the prompt injected into the el-voice-relay session.init by
 * getHiveMindSystemContext) contains the LIVE GOOGLE ADS block with pending
 * recommendations — the same block the text chat path is verified to have in
 * tests/e2e/hivemind-gads-chat.e2e.test.ts.
 *
 * getHiveMindSystemContext builds its systemPrompt as:
 *   buildSystemPrompt(buildPlatformContext(fetchFullPlatformData(...)) + council contexts, ...)
 * This test runs that same pipeline against the live database:
 *   1. Seeds pending critical/high recommendations into
 *      growthmind_gads_recommendations for the workspace with the active
 *      Google Ads account.
 *   2. Runs fetchFullPlatformData → buildPlatformContext → buildSystemPrompt
 *      (the voice composition; council summaries are appended after the
 *      platform context in production and cannot remove it).
 *   3. Asserts the resulting voice system prompt names the seeded campaigns,
 *      their priorities and concrete actions.
 *   4. Cleans up the seeded rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { fetchFullPlatformData, buildPlatformContext, buildSystemPrompt } from "@/lib/hivemind/hivemind.ai";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const DEDUPE_A = "e2e-hivemind-voice:critical:zero-conv";
const DEDUPE_B = "e2e-hivemind-voice:high:budget-cap";
const CAMPAIGN_A = "Brand Search VoiceE2E-Alpha";
const CAMPAIGN_B = "Generic Leads VoiceE2E-Beta";

let workspaceId = "";
let accountRowId = "";

describe("HiveMind voice context includes pending Google Ads actions", () => {
  beforeAll(async () => {
    expect(SUPABASE_URL, "SUPABASE_URL required").toBeTruthy();
    expect(SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY required").toBeTruthy();

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
          campaign_id: "e2e-voice-alpha-1",
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
          campaign_id: "e2e-voice-beta-2",
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

  it("voice system prompt contains the LIVE GOOGLE ADS block with the seeded pending recommendations", async () => {
    const platformData = await fetchFullPlatformData(sb, workspaceId);
    expect(platformData.gadsLive, "gadsLive block must be present").toBeTruthy();

    const ctx = buildPlatformContext(platformData);
    const systemPrompt = buildSystemPrompt(ctx, "friendly", "Voice Tester");

    expect(systemPrompt).toContain("LIVE GOOGLE ADS");
    expect(systemPrompt).toContain("PENDING RECOMMENDATIONS AWAITING USER DECISION");
    expect(systemPrompt).toContain(CAMPAIGN_A);
    expect(systemPrompt).toContain(CAMPAIGN_B);
    expect(systemPrompt).toContain("[CRITICAL]");
    expect(systemPrompt).toContain("[HIGH]");
    expect(systemPrompt).toContain("Pause campaign");
    expect(systemPrompt).toContain("Raise the daily budget");
  }, 60_000);
});
