/**
 * Follow-up continuity + depth verification for Task #523 (spec §14 Q4/Q5/Q7).
 * Run explicitly: HIVEMIND_FOLLOWUP=1 npx vitest run tests/e2e/hivemind-followup.e2e.test.ts --config vitest.e2e.config.ts
 * Read-only + model calls; no writes.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { prepareHiveMindChat, runHiveMindToolLoop } from "@/lib/hivemind/hivemind.ai";

const RUN = process.env.HIVEMIND_FOLLOWUP === "1";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WORKSPACE_ID = process.env.HIVEMIND_LATENCY_WS || "c13db1d5-22e4-44ad-b678-6f296c31a947";

describe.runIf(RUN)("HiveMind follow-up continuity", () => {
  it("retains context on follow-up and honors report depth", async () => {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const history: { role: "user" | "assistant"; content: string }[] = [];

    const ask = async (query: string) => {
      const prep = await prepareHiveMindChat(sb, WORKSPACE_ID, { query, history });
      const result = await runHiveMindToolLoop({
        sb, workspaceId: WORKSPACE_ID, userId: null,
        messages: prep.messages, tools: prep.tools, apiKey: prep.apiKey, maxTokens: prep.maxTokens,
      });
      history.push({ role: "user", content: query });
      history.push({ role: "assistant", content: result.response });
      return { depth: prep.depth, response: result.response };
    };

    const a1 = await ask("What should I focus on today?");
    const a2 = await ask("Why are you recommending that?");
    const a3 = await ask("Give me the full detailed report.");

    console.log("FOLLOWUP_RESULTS " + JSON.stringify({ a1, a2, a3 }, null, 2));

    // Follow-up must stay contextual (not a generic "what do you mean").
    expect(a2.response.length).toBeGreaterThan(40);
    // Report request must be classified as report depth and be substantial.
    expect(a3.depth).toBe("report");
    expect(a3.response.length).toBeGreaterThan(a1.response.length);
  }, 300_000);
});
