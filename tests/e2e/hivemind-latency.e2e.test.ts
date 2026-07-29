/**
 * HiveMind response-latency measurement harness (Task #523).
 *
 * Replicates the exact getHiveMindAIResponse pipeline stage by stage and
 * times each stage for the spec's five test questions:
 *   platform data → councils → knowledge retrieval → command block
 *   → prompt build → OpenAI call (time-to-first-token + total).
 *
 * Run explicitly with:
 *   HIVEMIND_LATENCY=1 npx vitest run tests/e2e/hivemind-latency.e2e.test.ts --config vitest.e2e.config.ts
 *
 * Skipped in the normal e2e suite (it costs real OpenAI calls). It makes NO
 * writes — pure reads + model calls. Results print as one JSON block.
 */
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  fetchFullPlatformData,
  buildPlatformContext,
  buildSystemPrompt,
  prepareHiveMindChat,
  runHiveMindToolLoop,
} from "@/lib/hivemind/hivemind.ai";

const RUN = process.env.HIVEMIND_LATENCY === "1";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const WORKSPACE_ID = process.env.HIVEMIND_LATENCY_WS || "c13db1d5-22e4-44ad-b678-6f296c31a947";

const QUESTIONS = [
  "How many calls have we had today?",
  "What happened in the business today?",
  "How is our Google Ads campaign performing?",
  "What should I focus on today?",
  "Create a task to review our negative keywords.",
];

const ms = () => performance.now();

describe.runIf(RUN)("HiveMind latency measurement", () => {
  it("measures the full pipeline for the 5 spec questions", async () => {
    expect(SUPABASE_URL && SERVICE_KEY && OPENAI_KEY).toBeTruthy();
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const results: any[] = [];

    for (const query of QUESTIONS) {
      const stage: Record<string, number> = {};
      const t0 = ms();

      // Stage 1: parallel block exactly like the handler.
      let t = ms();
      const [platformData, marketingCouncil, systemCouncil] = await Promise.all([
        (async () => {
          const s = ms();
          const d = await fetchFullPlatformData(sb, WORKSPACE_ID);
          stage.platformData = ms() - s;
          return d;
        })(),
        (async () => {
          const s = ms();
          try {
            const { buildGrowthMindExecutiveSummary } = await import("@/lib/executives/executive-bridge.server");
            const r = await buildGrowthMindExecutiveSummary(sb, WORKSPACE_ID);
            stage.marketingCouncil = ms() - s;
            return r;
          } catch { stage.marketingCouncil = ms() - s; return null; }
        })(),
        (async () => {
          const s = ms();
          try {
            const { buildSystemMindExecutiveSummary } = await import("@/lib/executives/executive-bridge.server");
            const r = await buildSystemMindExecutiveSummary(sb, WORKSPACE_ID);
            stage.systemCouncil = ms() - s;
            return r;
          } catch { stage.systemCouncil = ms() - s; return null; }
        })(),
      ]);
      stage.parallelBlock = ms() - t;

      // Stage 2: knowledge retrieval (sequential in prod handler).
      t = ms();
      let knowledgeBlock = "";
      try {
        const { getRetrievedKnowledgeBlock } = await import("@/lib/executives/executive-knowledge.server");
        knowledgeBlock = await getRetrievedKnowledgeBlock({ sb, workspaceId: WORKSPACE_ID, mindType: "hivemind", query, topK: 5 });
      } catch { /* ignore */ }
      stage.knowledge = ms() - t;

      // Stage 3: GrowthMind command context (sequential in prod handler).
      t = ms();
      let growthMindCommandBlock = "";
      try {
        const { buildGrowthMindCommandContext } = await import("@/lib/hivemind/growthmind-control/executive-view.server");
        growthMindCommandBlock = await buildGrowthMindCommandContext(WORKSPACE_ID);
      } catch { /* ignore */ }
      stage.commandBlock = ms() - t;

      // Stage 4: prompt build.
      t = ms();
      const { buildMarketingCouncilContext, buildSystemCouncilContext } = (await import(
        "@/lib/hivemind/hivemind.ai"
      )) as any;
      const ctx = buildPlatformContext(platformData)
        + (buildMarketingCouncilContext ? buildMarketingCouncilContext(marketingCouncil) : "")
        + (buildSystemCouncilContext ? buildSystemCouncilContext(systemCouncil) : "");
      const systemPrompt = buildSystemPrompt(ctx, "friendly")
        + (knowledgeBlock ? `\n\n${knowledgeBlock}` : "")
        + (growthMindCommandBlock ? `\n\n${growthMindCommandBlock}` : "");
      stage.promptBuild = ms() - t;

      // Stage 5: tool schemas (prod handler loads these).
      t = ms();
      let tools: any[] = [];
      try {
        const { getHiveMindChatToolSchemas } = await import("@/lib/hivemind/growthmind-control/chat-tools.server");
        tools = await getHiveMindChatToolSchemas();
      } catch { /* ignore */ }
      stage.toolSchemas = ms() - t;

      // Stage 6: OpenAI streamed call — measure TTFT and total.
      t = ms();
      let ttft = -1;
      let completion = "";
      let promptTokens = -1, completionTokens = -1;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query },
          ],
          max_tokens: 700,
          temperature: 0.4,
          stream: true,
          stream_options: { include_usage: true },
          ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        }),
      });
      expect(res.ok).toBe(true);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let sawToolCall = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            const delta = j.choices?.[0]?.delta;
            if (delta?.tool_calls) sawToolCall = true;
            if (delta?.content) {
              if (ttft < 0) ttft = ms() - t;
              completion += delta.content;
            }
            if (j.usage) {
              promptTokens = j.usage.prompt_tokens ?? -1;
              completionTokens = j.usage.completion_tokens ?? -1;
            }
          } catch { /* partial */ }
        }
      }
      stage.llmTtftMs = ttft;
      stage.llmTotalMs = ms() - t;
      stage.totalMs = ms() - t0;

      results.push({
        query,
        stages: Object.fromEntries(Object.entries(stage).map(([k, v]) => [k, Math.round(v)])),
        systemPromptChars: systemPrompt.length,
        promptTokens,
        completionTokens,
        sawToolCall,
        toolCount: tools.length,
        responsePreview: completion.slice(0, 220),
      });
    }

    const fs = await import("node:fs");
    const outPath = process.env.HIVEMIND_LATENCY_OUT || ".local/hivemind-latency-baseline.json";
    fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), workspaceId: WORKSPACE_ID, results }, null, 2));
    console.log("HIVEMIND_LATENCY_RESULTS " + JSON.stringify(results, null, 2));
    expect(results.length).toBe(QUESTIONS.length);
  }, 600_000);
});

/**
 * AFTER measurement — exercises the NEW shared pipeline exactly as the
 * streaming endpoint does: prepareHiveMindChat (single parallel block, depth
 * classification) + runHiveMindToolLoop with streamed tokens (TTFT). Enable
 * with HIVEMIND_LATENCY_AFTER=1 alongside HIVEMIND_LATENCY=1.
 */
describe.runIf(RUN && process.env.HIVEMIND_LATENCY_AFTER === "1")("HiveMind latency — new pipeline", () => {
  it("measures prepare + streamed tool loop for the 5 spec questions", async () => {
    expect(SUPABASE_URL && SERVICE_KEY && OPENAI_KEY).toBeTruthy();
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    process.env.OPENAI_API_KEY = OPENAI_KEY;

    const results: any[] = [];
    for (const query of QUESTIONS) {
      const t0 = ms();
      const prep = await prepareHiveMindChat(sb, WORKSPACE_ID, { query });
      const prepMs = ms() - t0;

      let ttft = -1;
      const tLoop = ms();
      const result = await runHiveMindToolLoop({
        sb,
        workspaceId: WORKSPACE_ID,
        userId: null,
        messages: prep.messages,
        tools: prep.tools,
        apiKey: prep.apiKey,
        maxTokens: prep.maxTokens,
        onToken: () => { if (ttft < 0) ttft = ms() - tLoop; },
      });
      const loopMs = ms() - tLoop;

      results.push({
        query,
        depth: prep.depth,
        maxTokens: prep.maxTokens,
        stages: {
          prepareMs: Math.round(prepMs),
          llmTtftMs: Math.round(ttft),
          loopTotalMs: Math.round(loopMs),
          totalMs: Math.round(ms() - t0),
          streamTtfbFromSendMs: Math.round(prepMs + (ttft < 0 ? loopMs : ttft)),
        },
        systemPromptChars: prep.systemPrompt.length,
        actionsTaken: result.actionsTaken,
        responsePreview: result.response.slice(0, 220),
        responseChars: result.response.length,
      });
    }

    const fs = await import("node:fs");
    const outPath = process.env.HIVEMIND_LATENCY_AFTER_OUT || ".local/hivemind-latency-after.json";
    fs.writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), workspaceId: WORKSPACE_ID, results }, null, 2));
    console.log("HIVEMIND_LATENCY_AFTER_RESULTS " + JSON.stringify(results, null, 2));
    expect(results.length).toBe(QUESTIONS.length);
  }, 600_000);
});
