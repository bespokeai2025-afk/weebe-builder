// ── Platform-wide AI usage & cost ledger ──────────────────────────────────────
// One row per AI request (success, failure, fallback or diagnostic) across
// HiveMind, GrowthMind, SystemMind, AccountsMind, Content Studio, Business DNA,
// reports and background jobs.
//
// recordAiUsage() NEVER throws — a ledger failure must not break the answer
// path — but it logs loudly so silent data loss is visible in server logs.
//
// The ai_usage_ledger table is server-write-only (REVOKEd from authenticated);
// all reads go through admin-gated server functions using the admin client.

import { estimateAiCostUsd } from "./model-registry.shared";

export type AiUsageStatus = "success" | "failed" | "fallback" | "diagnostic";

export type AiUsageRecord = {
  workspaceId?: string | null;
  department: "hivemind" | "growthmind" | "systemmind" | "accountsmind" | "platform";
  feature: string;                 // e.g. "chat", "briefing", "dna_discovery", "content_generation"
  provider: string;                // "openai" | "gemini" | "claude" | ...
  requestedModel: string;
  returnedModel?: string | null;   // model reported back by the provider
  endpoint?: string | null;        // e.g. "/v1/responses", "/v1/chat/completions"
  requestId?: string | null;       // provider request ID (x-request-id / response id)
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  videoSeconds?: number;
  latencyMs?: number;
  status: AiUsageStatus;
  fallbackUsed?: boolean;
  fallbackFrom?: string | null;
  errorMessage?: string | null;
  estimatedCostUsd?: number;       // computed from the registry cost table when omitted
  routing?: Record<string, unknown> | null; // routing decision metadata (admin-visible)
};

export async function recordAiUsage(rec: AiUsageRecord): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;

    const model = rec.returnedModel || rec.requestedModel;
    const estimated = rec.estimatedCostUsd ?? estimateAiCostUsd({
      model,
      inputTokens: rec.inputTokens,
      cachedInputTokens: rec.cachedInputTokens,
      outputTokens: rec.outputTokens,
      reasoningTokens: rec.reasoningTokens,
      videoSeconds: rec.videoSeconds,
    });

    const { error } = await sb.from("ai_usage_ledger").insert({
      workspace_id: rec.workspaceId ?? null,
      department: rec.department,
      feature: rec.feature.slice(0, 120),
      provider: rec.provider,
      requested_model: rec.requestedModel,
      returned_model: rec.returnedModel ?? null,
      endpoint: rec.endpoint ?? null,
      request_id: rec.requestId ?? null,
      input_tokens: rec.inputTokens ?? 0,
      cached_input_tokens: rec.cachedInputTokens ?? 0,
      output_tokens: rec.outputTokens ?? 0,
      reasoning_tokens: rec.reasoningTokens ?? 0,
      video_seconds: rec.videoSeconds ?? 0,
      latency_ms: rec.latencyMs ?? null,
      status: rec.status,
      fallback_used: rec.fallbackUsed ?? false,
      fallback_from: rec.fallbackFrom ?? null,
      error_message: rec.errorMessage ? String(rec.errorMessage).slice(0, 500) : null,
      estimated_cost_usd: estimated,
      routing: rec.routing ?? null,
    });
    if (error) {
      console.error("[ai-usage-ledger] insert failed:", error.message);
    }
  } catch (err: any) {
    console.error("[ai-usage-ledger] recordAiUsage failed:", err?.message ?? err);
  }
}
