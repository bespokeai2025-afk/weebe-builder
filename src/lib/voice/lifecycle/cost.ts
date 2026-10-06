/**
 * What a native call costs us, resolved at call time.
 *
 * The lifecycle reports `call_cost.combined_cost` in USD cents, the same field
 * Retell populates, so campaign reconciliation and executive reporting price
 * native calls through the code they already have. Without this every native
 * call would reconcile as "cost unavailable".
 *
 * This used to return a single blended per-minute figure, which meant the stored
 * cost ignored which STT/TTS/LLM providers actually served the call — while every
 * display surface priced them individually. It now loads both the blended row and
 * the workspace's per-provider rates, so the lifecycle can price the call the same
 * way the dashboards do (see `resolveVoiceCallCost`).
 *
 * Only the engine's own meters are reported. Carrier minutes are billed by
 * Twilio and reconciled from Twilio, so including them here would double-count.
 *
 * Relative imports only — this module is reachable from the gateway bundle.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcWebeeNativeCostPerMin, type WebeeNativeCost } from "../../cost-engine/native-rates";
import type { VoiceProviderRateRow } from "../../cost-engine/voice-provider-rates";

/**
 * Cached for the process: rates change when an admin edits them, which is rare,
 * and re-reading per call would put a database round trip on the hangup path.
 */
const CACHE_TTL_MS = 5 * 60_000;

export interface NativeCostRates {
  blended: WebeeNativeCost | null;
  rates: VoiceProviderRateRow[];
  /** Blended engine cost in USD cents per minute, or null when nothing is configured. */
  centsPerMinute: number | null;
}

/** Keyed by workspace: provider rates are per-workspace and overridable. */
let cached: Map<string, { at: number; value: NativeCostRates }> = new Map();

/** Test seam; also lets a redeploy start from a clean cache. */
export function resetNativeCostCache(): void {
  cached = new Map();
}

const EMPTY: NativeCostRates = { blended: null, rates: [], centsPerMinute: null };

/**
 * Blended row plus this workspace's per-provider rates.
 *
 * Never throws: a missing table or an unreachable database must not stop a call
 * from reporting. The cost is simply omitted, which downstream already handles.
 */
export async function loadNativeCostRates(
  sb: SupabaseClient,
  workspaceId: string | null | undefined,
): Promise<NativeCostRates> {
  const key = workspaceId ?? "__none__";
  const hit = cached.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let value: NativeCostRates = EMPTY;
  try {
    const [blendedRes, ratesRes] = await Promise.all([
      sb
        .from("cost_engine_webee_native")
        .select("*")
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      workspaceId
        ? sb
            .from("provider_cost_rates")
            .select("provider_category, provider_name, unit_type, cost_per_unit_usd")
            .eq("workspace_id", workspaceId)
            .in("provider_category", ["stt", "tts", "llm", "telephony"])
        : Promise.resolve({ data: [] as unknown }),
    ]);

    const blended = (blendedRes.data ?? null) as WebeeNativeCost | null;
    const rates = ((ratesRes as { data?: unknown }).data ?? []) as VoiceProviderRateRow[];
    const centsPerMinute = blended
      ? Number((calcWebeeNativeCostPerMin({ native: blended }).engineTotal * 100).toFixed(6))
      : null;
    value = { blended, rates, centsPerMinute };
  } catch {
    // Fall through to unpriced: unreported is better than a wrong number.
  }

  cached.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Blended engine cost per minute in USD cents, or null when no rates are configured.
 *
 * Kept for callers that only need the headline rate (the live in-call accrual on the admin
 * spend page, for instance). Prefer `loadNativeCostRates` where the providers are known.
 */
export async function loadNativeCostCentsPerMinute(
  sb: SupabaseClient,
  workspaceId?: string | null,
): Promise<number | null> {
  return (await loadNativeCostRates(sb, workspaceId)).centsPerMinute;
}
