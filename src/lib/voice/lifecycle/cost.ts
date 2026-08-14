/**
 * What a native call costs us, resolved at call time.
 *
 * The lifecycle reports `call_cost.combined_cost` in USD cents, the same field
 * Retell populates, so campaign reconciliation and executive reporting price
 * native calls through the code they already have. Without this every native
 * call would reconcile as "cost unavailable".
 *
 * Only the engine's own meters are reported. Carrier minutes are billed by
 * Twilio and reconciled from Twilio, so including them here would double-count.
 *
 * Relative imports only — this module is reachable from the gateway bundle.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcWebeeNativeCostPerMin, type WebeeNativeCost } from "../../cost-engine/native-rates";

/**
 * Cached for the process: rates change when an admin edits them, which is rare,
 * and re-reading per call would put a database round trip on the hangup path.
 */
const CACHE_TTL_MS = 5 * 60_000;
let cached: { at: number; centsPerMinute: number | null } | null = null;

/** Test seam; also lets a redeploy start from a clean cache. */
export function resetNativeCostCache(): void {
  cached = null;
}

/**
 * Engine cost per minute in USD cents, or null when no rates are configured.
 *
 * Never throws: a missing table or an unreachable database must not stop a call
 * from reporting. The cost is simply omitted, which downstream already handles.
 */
export async function loadNativeCostCentsPerMinute(
  sb: SupabaseClient,
): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.centsPerMinute;

  let centsPerMinute: number | null = null;
  try {
    const { data } = await sb
      .from("cost_engine_webee_native")
      .select("*")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const { engineTotal } = calcWebeeNativeCostPerMin({
        native: data as unknown as WebeeNativeCost,
      });
      centsPerMinute = Number((engineTotal * 100).toFixed(6));
    }
  } catch {
    // Fall through to null: unpriced is better than unreported.
  }

  cached = { at: Date.now(), centsPerMinute };
  return centsPerMinute;
}
