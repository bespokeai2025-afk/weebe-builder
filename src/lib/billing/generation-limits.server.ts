import { createClient } from "@supabase/supabase-js";

export type GenerationLimits = {
  video_monthly_usd:  number | null;
  image_monthly_usd:  number | null;
  llm_monthly_usd:    number | null;
  enabled:            boolean;
};

export type GenerationCategory = "video" | "image" | "llm";

const DEFAULT_LIMITS: GenerationLimits = {
  video_monthly_usd: null,
  image_monthly_usd: null,
  llm_monthly_usd:   null,
  enabled:           true,
};

function sb() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function getGenerationLimits(workspaceId: string): Promise<GenerationLimits> {
  const { data } = await sb()
    .from("workspace_settings")
    .select("generation_limits")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const raw = (data?.generation_limits ?? {}) as Partial<GenerationLimits>;
  return {
    video_monthly_usd: raw.video_monthly_usd ?? DEFAULT_LIMITS.video_monthly_usd,
    image_monthly_usd: raw.image_monthly_usd ?? DEFAULT_LIMITS.image_monthly_usd,
    llm_monthly_usd:   raw.llm_monthly_usd   ?? DEFAULT_LIMITS.llm_monthly_usd,
    enabled:           raw.enabled           ?? DEFAULT_LIMITS.enabled,
  };
}

export async function setGenerationLimits(
  workspaceId: string,
  limits: Partial<GenerationLimits>,
): Promise<void> {
  const current = await getGenerationLimits(workspaceId);
  const updated = { ...current, ...limits };
  await sb()
    .from("workspace_settings")
    .upsert({
      workspace_id:      workspaceId,
      generation_limits: updated,
      updated_at:        new Date().toISOString(),
    }, { onConflict: "workspace_id" });
}

/**
 * Calculates month-to-date spend for a given category from provider_usage_log.
 * Returns spend in USD.
 */
export async function getMonthlySpend(
  workspaceId: string,
  category: GenerationCategory,
): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const categoryMap: Record<GenerationCategory, string[]> = {
    video: ["video", "veo", "runway", "video_generation"],
    image: ["image", "image_generation", "dall_e", "imagen", "flux"],
    llm:   ["llm", "openai", "gemini", "claude", "anthropic", "growthmind_llm"],
  };

  const { data } = await sb()
    .from("provider_usage_log")
    .select("cost_usd")
    .eq("workspace_id", workspaceId)
    .in("provider_category", categoryMap[category])
    .gte("created_at", monthStart.toISOString());

  const totalUsd = (data ?? []).reduce((acc, row) => acc + (Number(row.cost_usd) || 0), 0);
  return Math.round(totalUsd * 100) / 100;
}

/**
 * Checks whether a workspace is allowed to generate content in the given category.
 * Throws a descriptive error if the monthly cap has been reached.
 *
 * Usage: call this at the top of any generation function before making API calls.
 *
 * ```ts
 * await enforceGenerationCap(workspaceId, "video");
 * // ... proceed with generation
 * ```
 */
export async function enforceGenerationCap(
  workspaceId: string,
  category: GenerationCategory,
  estimatedCostUsd = 0,
): Promise<void> {
  const limits = await getGenerationLimits(workspaceId);
  if (!limits.enabled) return;

  const capKey = `${category}_monthly_usd` as keyof GenerationLimits;
  const cap = limits[capKey] as number | null;
  if (cap == null) return;

  const spent = await getMonthlySpend(workspaceId, category);
  if (spent + estimatedCostUsd > cap) {
    const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cap);
    throw new Error(
      `Monthly ${category} generation limit of ${formatted} reached. ` +
      `You have spent $${spent.toFixed(2)} this month. ` +
      `Adjust your limits in Settings → Usage & Limits.`,
    );
  }
}
