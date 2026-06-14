import { openaiGenerate } from "./providers/openai-growth.server";
import { geminiGenerate }  from "./providers/gemini-growth.server";
import { claudeGenerate }  from "./providers/claude-growth.server";
import {
  SMART_ROUTING,
  FALLBACK,
  calcCostUsd,
  type Provider,
  type ModelId,
} from "./model-router.shared";

// ── Types ──────────────────────────────────────────────────────────────────────

export type RouteGenerateParams = {
  system:      string;
  user:        string;
  contentType: string;
  maxTokens:   number;
  mode:        "smart" | "manual";
  provider?:   Provider;
  model?:      ModelId;
  settings:    Record<string, string>;
  workspaceId: string;
  sb:          any;
  assetId?:    string;
};

export type RouteGenerateResult = {
  text:         string;
  provider:     Provider;
  model:        ModelId;
  inputTokens:  number;
  outputTokens: number;
  costUsd:      number;
  usedFallback: boolean;
  fallbackFrom: string | null;
};

// ── Internal: dispatch to the correct provider ─────────────────────────────────

async function callProvider(
  provider: Provider,
  model:    ModelId,
  system:   string,
  user:     string,
  maxTokens: number,
  settings: Record<string, string>,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured.");
    return openaiGenerate({ system, user, model, maxTokens, apiKey });
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY ?? settings.gemini_api_key;
    if (!apiKey) throw new Error("Gemini API key not configured. Add GEMINI_API_KEY in Settings → Environment.");
    return geminiGenerate({ system, user, model, maxTokens, apiKey });
  }

  if (provider === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? settings.anthropic_api_key;
    if (!apiKey) throw new Error("Anthropic API key not configured. Add ANTHROPIC_API_KEY in Settings → Environment.");
    return claudeGenerate({ system, user, model, maxTokens, apiKey });
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ── Main router ────────────────────────────────────────────────────────────────

export async function routeGenerate(params: RouteGenerateParams): Promise<RouteGenerateResult> {
  const { system, user, contentType, maxTokens, mode, settings, workspaceId, sb, assetId } = params;

  // Determine primary target
  let targetProvider: Provider;
  let targetModel:    ModelId;

  if (mode === "manual" && params.provider && params.model) {
    targetProvider = params.provider;
    targetModel    = params.model;
  } else {
    const route    = SMART_ROUTING[contentType] ?? { provider: "gemini" as Provider, model: "gemini-2.5-pro" as ModelId };
    targetProvider = route.provider;
    targetModel    = route.model;
  }

  let text         = "";
  let inputTokens  = 0;
  let outputTokens = 0;
  let usedFallback = false;
  let fallbackFrom: string | null = null;
  let finalProvider = targetProvider;
  let finalModel    = targetModel;

  // Try primary, then retry once, then fallback
  const tryCall = () => callProvider(targetProvider, targetModel, system, user, maxTokens, settings);

  let primaryErr: Error | null = null;

  try {
    const r  = await tryCall();
    text         = r.text;
    inputTokens  = r.inputTokens;
    outputTokens = r.outputTokens;
  } catch (e1: any) {
    primaryErr = e1;
    // Retry once
    try {
      const r  = await tryCall();
      text         = r.text;
      inputTokens  = r.inputTokens;
      outputTokens = r.outputTokens;
    } catch {
      // Fallback to secondary model
      const fb = FALLBACK[targetModel];
      if (!fb) throw primaryErr;
      try {
        const r  = await callProvider(fb.provider, fb.model, system, user, maxTokens, settings);
        text          = r.text;
        inputTokens   = r.inputTokens;
        outputTokens  = r.outputTokens;
        usedFallback  = true;
        fallbackFrom  = `${targetProvider}/${targetModel}`;
        finalProvider = fb.provider;
        finalModel    = fb.model;
      } catch {
        throw primaryErr;
      }
    }
  }

  const costUsd = calcCostUsd(finalModel, inputTokens, outputTokens);

  // Log generation (fire-and-forget — never breaks the response)
  sb.from("growthmind_generation_logs").insert({
    workspace_id:       workspaceId,
    asset_id:           assetId ?? null,
    task_type:          contentType,
    provider:           finalProvider,
    model:              finalModel,
    input_tokens:       inputTokens,
    output_tokens:      outputTokens,
    estimated_cost_usd: costUsd,
    status:             usedFallback ? "fallback" : "success",
    fallback_from:      fallbackFrom,
    created_at:         new Date().toISOString(),
  }).then(() => {}).catch(() => {});

  return {
    text,
    provider:    finalProvider,
    model:       finalModel,
    inputTokens,
    outputTokens,
    costUsd,
    usedFallback,
    fallbackFrom,
  };
}

// ── HiveMind summary ──────────────────────────────────────────────────────────

export async function getGrowthmindModelSummary(
  sb:          any,
  workspaceId: string,
  sinceIso:    string,
): Promise<{
  totalGenerations: number;
  byProvider:       Record<string, number>;
  byModel:          Record<string, number>;
  estimatedCostUsd: number;
  fallbackCount:    number;
}> {
  try {
    const { data } = await sb
      .from("growthmind_generation_logs")
      .select("provider, model, estimated_cost_usd, status")
      .eq("workspace_id", workspaceId)
      .gte("created_at", sinceIso)
      .limit(5000);

    const rows = data ?? [];
    const byProvider: Record<string, number> = {};
    const byModel:    Record<string, number> = {};
    let estimatedCostUsd = 0;
    let fallbackCount    = 0;

    for (const r of rows) {
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
      byModel[r.model]       = (byModel[r.model]       ?? 0) + 1;
      estimatedCostUsd      += r.estimated_cost_usd ?? 0;
      if (r.status === "fallback") fallbackCount++;
    }

    return {
      totalGenerations: rows.length,
      byProvider,
      byModel,
      estimatedCostUsd,
      fallbackCount,
    };
  } catch {
    return { totalGenerations: 0, byProvider: {}, byModel: {}, estimatedCostUsd: 0, fallbackCount: 0 };
  }
}
