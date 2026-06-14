import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  SystemMindExecutiveSummary,
  ExecRisk,
  ExecRecommendedAction,
} from "@/lib/executives/executive-council";

// ── Grading helpers ────────────────────────────────────────────────────────────
function gradeFor(score: number): { grade: string; label: string } {
  if (score >= 90) return { grade: "A", label: "Excellent" };
  if (score >= 75) return { grade: "B", label: "Healthy" };
  if (score >= 60) return { grade: "C", label: "Stable" };
  if (score >= 40) return { grade: "D", label: "At risk" };
  return { grade: "F", label: "Critical" };
}

const HEALTH_LABELS: Record<string, string> = {
  openai: "OpenAI (AI runtime)",
  retell: "Retell (voice)",
  elevenlabs: "ElevenLabs (voice)",
  twilio: "Twilio (telephony)",
  whatsapp: "WhatsApp channel",
  calcom: "Cal.com (calendar)",
};

// ── Deterministic executive summary (client-safe pure function) ────────────────
// Computes the SystemMind executive contract from telemetry. Used by the overview
// dashboard and by HiveMind's consolidated briefing.
export function buildSystemMindSummary(data: any): SystemMindExecutiveSummary {
  const health: Record<string, boolean> = data?.systemHealth ?? {};
  const integrations = data?.integrations ?? { connected: 0, total: 0 };
  const usage = data?.usage ?? { totalCostUsd: 0, requests: 0, errors: 0, errorRate: 0 };

  const coverage = integrations.total > 0 ? integrations.connected / integrations.total : 0;
  const errorPenalty = Math.min(Number(usage.errorRate ?? 0), 100) / 100;
  const reliabilityScore = Math.max(0, Math.min(100, Math.round((coverage * 0.6 + (1 - errorPenalty) * 0.4) * 100)));
  const { grade, label } = gradeFor(reliabilityScore);

  const topRisks: ExecRisk[] = [];
  if (!health.openai) {
    topRisks.push({
      id: "no-openai",
      title: "AI runtime key missing",
      detail: "OpenAI is not configured — AI features (executives, content, embeddings) cannot run.",
      severity: "critical",
    });
  }
  if (Number(usage.errorRate ?? 0) > 5) {
    topRisks.push({
      id: "error-rate",
      title: `Elevated provider error rate (${usage.errorRate}%)`,
      detail: `${usage.errors} errors across ${usage.requests} provider requests. Investigate failing integrations.`,
      severity: Number(usage.errorRate) > 15 ? "critical" : "high",
    });
  }
  const disconnected = Object.entries(health).filter(([, v]) => !v).map(([k]) => HEALTH_LABELS[k] ?? k);
  if (disconnected.length > 0) {
    topRisks.push({
      id: "integrations-gap",
      title: `${disconnected.length} integration${disconnected.length > 1 ? "s" : ""} not connected`,
      detail: `Not connected: ${disconnected.join(", ")}. Reduced redundancy and capability.`,
      severity: disconnected.length >= integrations.total ? "high" : "medium",
    });
  }

  const recommendedActions: ExecRecommendedAction[] = [];
  if (!health.openai) {
    recommendedActions.push({
      id: "connect-openai", label: "Configure OpenAI API key", taskType: null, priority: "critical",
      problem: "No AI runtime key configured.", fix: "Add an OpenAI key in Settings → Integrations.",
      actionHref: "/settings",
    });
  }
  if (Number(usage.errorRate ?? 0) > 5) {
    recommendedActions.push({
      id: "triage-errors", label: "Triage provider errors", taskType: null, priority: "high",
      problem: `Provider error rate is ${usage.errorRate}%.`, fix: "Review provider health and failing requests.",
      actionHref: "/hivemind/system-health",
    });
  }
  if (disconnected.length > 0) {
    recommendedActions.push({
      id: "connect-integrations", label: "Connect missing integrations", taskType: null, priority: "medium",
      problem: `${disconnected.length} integrations are not connected.`, fix: "Connect remaining providers for redundancy.",
      actionHref: "/settings",
    });
  }

  const headline =
    `SystemMind: reliability ${reliabilityScore}/100 (${label}). ` +
    `${integrations.connected}/${integrations.total} integrations connected, ` +
    `${usage.errorRate ?? 0}% error rate, $${Number(usage.totalCostUsd ?? 0).toFixed(2)} runtime spend.`;

  return {
    source: "systemmind",
    role: "CTO",
    generatedAt: data?.generatedAt ?? new Date().toISOString(),
    reliabilityScore,
    grade,
    label,
    integrations,
    systemHealth: health,
    cost: {
      totalDollars: Number(usage.totalCostUsd ?? 0),
      requests: Number(usage.requests ?? 0),
      errors: Number(usage.errors ?? 0),
    },
    topRisks,
    recommendedActions,
    headline,
  };
}

// ── System prompt ──────────────────────────────────────────────────────────────
function compileSystemPrompt(data: any, personality: string, knowledgeBlock: string): string {
  const tone =
    personality === "friendly" ? "warm, encouraging, and practical"
    : personality === "concise" ? "direct, bullet-pointed, and brief"
    : "professional, technical, and risk-aware";

  const health: Record<string, boolean> = data?.systemHealth ?? {};
  const integrations = data?.integrations ?? { connected: 0, total: 0 };
  const usage = data?.usage ?? { totalCostUsd: 0, requests: 0, errors: 0, errorRate: 0 };
  const healthLines = Object.entries(health)
    .map(([k, v]) => `- ${HEALTH_LABELS[k] ?? k}: ${v ? "✅ connected" : "❌ not connected"}`)
    .join("\n");

  const base = `You are SystemMind, an AI Chief Technology Officer (CTO) built into the Webee platform.

Your communication style is ${tone}.

You are a pure technical/operations strategist. You focus exclusively on: platform reliability, monitoring, observability, security, error tracking, infrastructure, API & telephony reliability, database operations, AI runtime monitoring, and runtime cost efficiency. You do NOT comment on marketing or sales — only technical and operational health.

## Live Platform Telemetry

### Integrations (${integrations.connected}/${integrations.total} connected)
${healthLines}

### Runtime & Reliability (provider usage)
- Total provider requests: ${usage.requests ?? 0}
- Errors: ${usage.errors ?? 0} | Error rate: ${usage.errorRate ?? 0}%
- Runtime spend: $${Number(usage.totalCostUsd ?? 0).toFixed(2)}
- Agents deployed: ${data?.agents?.total ?? 0}

## Your Role as CTO
You are the user's technical advisor. You:
1. Surface the highest-impact reliability, security and infrastructure risks in the telemetry above
2. Recommend specific technical actions with clear operational impact
3. Flag cost-efficiency and error-rate problems before they escalate
4. Advise on monitoring, observability and resilience best practice
5. Report up to HiveMind (the COO) — you advise, you never execute

Always cite specific numbers. Keep responses concise and actionable — every recommendation must have a clear next step.`;

  return knowledgeBlock ? `${base}\n\n${knowledgeBlock}` : base;
}

async function chat(apiKey: string, systemPrompt: string, messages: any[], maxTokens = 800): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.6,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  return (json.choices?.[0]?.message?.content as string) ?? "";
}

// ── Chat ───────────────────────────────────────────────────────────────────────
export const getSystemMindAIResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })),
      platformData: z.any().optional(),
      personality: z.string().default("professional"),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");

    const lastUser = [...data.messages].reverse().find((m) => m.role === "user")?.content ?? "platform reliability";
    let knowledgeBlock = "";
    if (workspaceId) {
      try {
        const { querySystemMindKnowledgeContext } = await import("@/lib/systemmind/systemmind-workflow.server");
        knowledgeBlock = await querySystemMindKnowledgeContext(workspaceId, lastUser, apiKey);
      } catch {
        const { getRetrievedKnowledgeBlock } = await import("@/lib/executives/executive-knowledge.server");
        knowledgeBlock = await getRetrievedKnowledgeBlock({ workspaceId, mindType: "systemmind", query: lastUser, topK: 5 });
      }
    }

    const systemPrompt = compileSystemPrompt(data.platformData, data.personality, knowledgeBlock);
    const reply = await chat(apiKey, systemPrompt, data.messages);
    return { reply };
  });

// ── Morning briefing ─────────────────────────────────────────────────────────--
export const getSystemMindBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platformData: z.any().optional() }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;

    if (!data.platformData || !apiKey) {
      const summary = buildSystemMindSummary(data.platformData ?? {});
      return { briefing: summary.headline };
    }

    let knowledgeBlock = "";
    if (workspaceId) {
      try {
        const { querySystemMindKnowledgeContext } = await import("@/lib/systemmind/systemmind-workflow.server");
        knowledgeBlock = await querySystemMindKnowledgeContext(
          workspaceId,
          "platform reliability monitoring infrastructure security cost best practices",
          apiKey,
        );
      } catch {
        const { getRetrievedKnowledgeBlock } = await import("@/lib/executives/executive-knowledge.server");
        knowledgeBlock = await getRetrievedKnowledgeBlock({
          workspaceId, mindType: "systemmind",
          query: "platform reliability monitoring infrastructure security cost best practices", topK: 5,
        });
      }
    }

    const systemPrompt = compileSystemPrompt(data.platformData, "professional", knowledgeBlock);
    const briefing = await chat(apiKey, systemPrompt, [
      { role: "user", content: "Give me a short morning technical briefing (4-6 bullet points) covering reliability, integration health, error rate and cost. Be specific with the numbers above." },
    ], 500);
    return { briefing };
  });

// ── Executive summary (structured, server-computed) ────────────────────────────
export const getSystemMindSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const { computeSystemMindData } = await import("@/lib/systemmind/systemmind.functions");
    const data = await computeSystemMindData(workspaceId);
    return buildSystemMindSummary(data);
  });
