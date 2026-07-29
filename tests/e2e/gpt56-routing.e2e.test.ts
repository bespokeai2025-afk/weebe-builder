/**
 * Live verification for Task #532 — GPT-5.6 routing upgrade.
 * Run explicitly: GPT56_ROUTING=1 npx vitest run tests/e2e/gpt56-routing.e2e.test.ts --config vitest.e2e.config.ts
 * Read-only + model calls; only writes are ai_usage_ledger rows (normal telemetry).
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { classifyAiTask } from "@/lib/ai/task-router.server";
import { openaiResponsesCall } from "@/lib/ai/openai-responses.server";
import { prepareHiveMindChat, runHiveMindToolLoop } from "@/lib/hivemind/hivemind.ai";

const RUN = process.env.GPT56_ROUTING === "1";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WORKSPACE_ID = process.env.HIVEMIND_LATENCY_WS || "c13db1d5-22e4-44ad-b678-6f296c31a947";

describe("task router classification (deterministic)", () => {
  it("routes standard chat to terra with low effort", () => {
    const r = classifyAiTask({ query: "How many leads came in this week?", department: "hivemind", feature: "chat" });
    expect(r.model).toMatch(/^gpt-5\.6-terra/);
    expect(r.taskClass).not.toBe("high_risk");
  });
  it("routes executive analysis to sol", () => {
    const r = classifyAiTask({ query: "Give me a deep strategic analysis of why revenue declined this quarter and what we should change", department: "hivemind", feature: "chat" });
    expect(["executive", "high_risk", "data_analysis"]).toContain(r.taskClass);
    expect(r.model).toMatch(/^gpt-5\.6-sol/);
  });
  it("routes background jobs to luna", () => {
    const r = classifyAiTask({ query: "summarize workspace facts", backgroundJob: true, department: "hivemind", feature: "dna" });
    expect(r.model).toMatch(/^gpt-5\.6-luna/);
  });
  it("never emits gpt-4o", () => {
    for (const q of ["hi", "approve this payment", "write a report", "analyze data trends"]) {
      const r = classifyAiTask({ query: q, department: "growthmind", feature: "chat" });
      expect(r.model.startsWith("gpt-4o")).toBe(false);
    }
  });
});

describe.runIf(RUN)("GPT-5.6 live routing + ledger", () => {
  const sb = () => createClient(SUPABASE_URL, SERVICE_KEY);

  it("luna background call ledgers with routing meta", async () => {
    const routing = classifyAiTask({ query: "test background summarize", backgroundJob: true, department: "hivemind", feature: "e2e_routing_test" });
    const r = await openaiResponsesCall({
      apiKey: process.env.OPENAI_API_KEY!,
      model: routing.model,
      input: [{ role: "user", content: "Reply with the single word OK." }],
      maxOutputTokens: 200,
      reasoningEffort: routing.reasoningEffort,
      usage: { workspaceId: WORKSPACE_ID, department: "hivemind", feature: "e2e_routing_test" },
      routing: { taskClass: routing.taskClass, reasoningEffort: routing.reasoningEffort, reason: routing.reason },
    });
    console.log("LUNA_RESULT", JSON.stringify({ model: r.model, requestId: r.requestId, text: r.text.slice(0, 50) }));
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.model).toMatch(/^gpt-5\.6-luna/);

    const { data: rows } = await sb()
      .from("ai_usage_ledger")
      .select("requested_model, returned_model, status, routing")
      .eq("feature", "e2e_routing_test")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(rows?.length).toBe(1);
    expect((rows![0] as any).routing?.taskClass).toBeTruthy();
    expect(rows![0].status).toBe("success");
  }, 120_000);

  it("HiveMind chat loop routes standard → terra and executive → sol, ledgered", async () => {
    const client = sb();
    const startIso = new Date().toISOString();

    const ask = async (query: string) => {
      const prep = await prepareHiveMindChat(client, WORKSPACE_ID, { query, history: [] });
      const result = await runHiveMindToolLoop({
        sb: client, workspaceId: WORKSPACE_ID, userId: null,
        messages: prep.messages, tools: prep.tools, apiKey: prep.apiKey, maxTokens: prep.maxTokens,
      });
      return result.response;
    };

    const std = await ask("How many calls did we handle yesterday?");
    expect(std.length).toBeGreaterThan(10);
    const exec = await ask("Give me a deep strategic analysis of our lead conversion trends and what we should change");
    expect(exec.length).toBeGreaterThan(10);

    const { data: rows } = await client
      .from("ai_usage_ledger")
      .select("requested_model, returned_model, status, routing, feature")
      .eq("workspace_id", WORKSPACE_ID)
      .eq("department", "hivemind")
      .gte("created_at", startIso)
      .order("created_at", { ascending: true });
    console.log("LEDGER_ROWS", JSON.stringify(rows, null, 2));
    const routed = (rows ?? []).filter((r: any) => r.routing?.taskClass);
    expect(routed.length).toBeGreaterThanOrEqual(2);
    expect(routed.some((r: any) => String(r.requested_model).startsWith("gpt-5.6-terra"))).toBe(true);
    expect(routed.some((r: any) => String(r.requested_model).startsWith("gpt-5.6-sol"))).toBe(true);
    expect(routed.every((r: any) => !String(r.requested_model).startsWith("gpt-4o"))).toBe(true);
  }, 300_000);
});
