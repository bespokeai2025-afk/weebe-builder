import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TrackUsageParams } from "./types";

export async function trackProviderUsage(params: TrackUsageParams): Promise<void> {
  const { workspaceId, category, providerName, durationMs = 0, costUsd = 0, isError = false } = params;

  try {
    const sb = supabaseAdmin as any;
    const { data: existing } = await sb
      .from("provider_usage")
      .select("id, requests, errors, total_cost_usd, total_duration_ms")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", category)
      .eq("provider_name", providerName)
      .maybeSingle();

    if (existing) {
      await sb
        .from("provider_usage")
        .update({
          requests: (existing.requests ?? 0) + 1,
          errors: (existing.errors ?? 0) + (isError ? 1 : 0),
          total_cost_usd: Number(((existing.total_cost_usd ?? 0) + costUsd).toFixed(6)),
          total_duration_ms: (existing.total_duration_ms ?? 0) + durationMs,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await sb.from("provider_usage").insert({
        workspace_id: workspaceId,
        provider_category: category,
        provider_name: providerName,
        requests: 1,
        errors: isError ? 1 : 0,
        total_cost_usd: costUsd,
        total_duration_ms: durationMs,
        last_used_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error("[trackProviderUsage] failed — table may not exist yet", err);
  }
}

export async function getProviderUsage(workspaceId: string): Promise<
  Array<{
    provider_category: string;
    provider_name: string;
    requests: number;
    errors: number;
    total_cost_usd: number;
    total_duration_ms: number;
    last_used_at: string | null;
  }>
> {
  try {
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("provider_usage")
      .select("provider_category, provider_name, requests, errors, total_cost_usd, total_duration_ms, last_used_at")
      .eq("workspace_id", workspaceId)
      .order("total_cost_usd", { ascending: false });
    return data ?? [];
  } catch {
    return [];
  }
}

export async function getProviderSettings(workspaceId: string): Promise<
  Array<{
    provider_category: string;
    provider_name: string;
    status: string;
    is_default: boolean;
    is_fallback: boolean;
    priority: number;
    last_sync: string | null;
  }>
> {
  try {
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("provider_settings")
      .select("provider_category, provider_name, status, is_default, is_fallback, priority, last_sync")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: true });
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Upsert a provider setting row with partial-update semantics:
 * - If the row already exists, only the explicitly supplied fields are changed.
 * - If the row is new, sensible defaults are applied.
 * This prevents a priority-only update from accidentally resetting `status`
 * to "disconnected" for providers that are already active.
 */
export async function upsertProviderSetting(params: {
  workspaceId: string;
  category: string;
  providerName: string;
  status?: string;
  isDefault?: boolean;
  isFallback?: boolean;
  priority?: number;
  credentials?: Record<string, unknown>;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  const { workspaceId, category, providerName } = params;

  // Read the existing row so we can merge — prevents silently overwriting
  // a connected/active status when only priority/role fields are being changed.
  const { data: existing } = await sb
    .from("provider_settings")
    .select("status, is_default, is_fallback, priority, credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", category)
    .eq("provider_name", providerName)
    .maybeSingle();

  const merged = {
    workspace_id: workspaceId,
    provider_category: category,
    provider_name: providerName,
    status: params.status ?? existing?.status ?? "disconnected",
    is_default: params.isDefault ?? existing?.is_default ?? false,
    is_fallback: params.isFallback ?? existing?.is_fallback ?? false,
    priority: params.priority ?? existing?.priority ?? 99,
    credentials: params.credentials ?? existing?.credentials ?? {},
    updated_at: new Date().toISOString(),
  };

  await sb.from("provider_settings").upsert(
    merged,
    { onConflict: "workspace_id,provider_category,provider_name" },
  );
}
