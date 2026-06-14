import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TrackUsageParams } from "./types";

/**
 * Look up the per-unit cost rate for a provider from provider_cost_rates table.
 * Returns null if the migration hasn't been applied or no rate row exists.
 */
async function lookupUnitRate(
  sb: any,
  workspaceId: string,
  category: string,
  providerName: string,
  unitType: string,
): Promise<number | null> {
  try {
    const { data } = await sb
      .from("provider_cost_rates")
      .select("cost_per_unit_usd")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", category)
      .eq("provider_name", providerName)
      .eq("unit_type", unitType)
      .maybeSingle();
    return data ? Number(data.cost_per_unit_usd) : null;
  } catch {
    return null;
  }
}

export async function trackProviderUsage(params: TrackUsageParams): Promise<void> {
  const {
    workspaceId,
    category,
    providerName,
    durationMs = 0,
    costUsd = 0,
    isError = false,
    unitsConsumed,
    unitType,
  } = params;

  try {
    const sb = supabaseAdmin as any;

    // Resolve per-unit cost if unit data is provided and costUsd wasn't given explicitly
    let resolvedCostUsd = costUsd;
    let resolvedCostPerUnit: number | null = null;
    if (!isError && unitsConsumed && unitType && costUsd === 0) {
      resolvedCostPerUnit = await lookupUnitRate(sb, workspaceId, category, providerName, unitType);
      if (resolvedCostPerUnit !== null) {
        resolvedCostUsd = unitsConsumed * resolvedCostPerUnit;
      }
    }

    const { data: existing } = await sb
      .from("provider_usage")
      .select("id, requests, errors, total_cost_usd, total_duration_ms")
      .eq("workspace_id", workspaceId)
      .eq("provider_category", category)
      .eq("provider_name", providerName)
      .maybeSingle();

    // Build the update/insert payload; include per-unit columns only when provided
    // so we degrade gracefully before the cost-extension migration is applied.
    const unitFields = unitsConsumed && unitType
      ? {
          units_consumed: (existing?.units_consumed ?? 0) + unitsConsumed,
          unit_type: unitType,
          ...(resolvedCostPerUnit !== null ? { cost_per_unit_usd: resolvedCostPerUnit } : {}),
        }
      : {};

    if (existing) {
      await sb
        .from("provider_usage")
        .update({
          requests: (existing.requests ?? 0) + 1,
          errors: (existing.errors ?? 0) + (isError ? 1 : 0),
          total_cost_usd: Number(((existing.total_cost_usd ?? 0) + resolvedCostUsd).toFixed(6)),
          total_duration_ms: (existing.total_duration_ms ?? 0) + durationMs,
          last_used_at: new Date().toISOString(),
          ...unitFields,
        })
        .eq("id", existing.id);
    } else {
      await sb.from("provider_usage").insert({
        workspace_id: workspaceId,
        provider_category: category,
        provider_name: providerName,
        requests: 1,
        errors: isError ? 1 : 0,
        total_cost_usd: resolvedCostUsd,
        total_duration_ms: durationMs,
        last_used_at: new Date().toISOString(),
        ...(unitsConsumed && unitType ? {
          units_consumed: unitsConsumed,
          unit_type: unitType,
          ...(resolvedCostPerUnit !== null ? { cost_per_unit_usd: resolvedCostPerUnit } : {}),
        } : {}),
      });
    }
  } catch (err) {
    // Log column-not-found errors at debug level — they're expected before the migration is applied
    const msg = String(err);
    if (msg.includes("units_consumed") || msg.includes("unit_type") || msg.includes("cost_per_unit")) {
      // Re-try without the new columns to ensure tracking still works pre-migration
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
          await sb.from("provider_usage").update({
            requests: (existing.requests ?? 0) + 1,
            errors: (existing.errors ?? 0) + (isError ? 1 : 0),
            total_cost_usd: Number(((existing.total_cost_usd ?? 0) + costUsd).toFixed(6)),
            total_duration_ms: (existing.total_duration_ms ?? 0) + durationMs,
            last_used_at: new Date().toISOString(),
          }).eq("id", existing.id);
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
      } catch { /* silently ignore — table may not exist yet */ }
    } else {
      console.error("[trackProviderUsage] failed — table may not exist yet", err);
    }
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
