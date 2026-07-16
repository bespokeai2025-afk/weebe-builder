/**
 * Cross-instance cache invalidation signals (server only).
 *
 * In-process caches (package catalog, entitlements) are invalidated locally
 * on admin writes, but other server instances would otherwise serve stale
 * values until TTL expiry. Each write bumps a version row in
 * platform_cache_signals; readers check the version at most every
 * SIGNAL_CHECK_MS, so a change propagates to every instance within a few
 * seconds instead of the full cache TTL.
 *
 * Fail-open to TTL-only behavior: if the table is missing or the lookup
 * errors, checkCacheSignal returns the last-known (possibly null) version and
 * callers fall back to their existing TTL — no behavior change for
 * single-instance deployments and no new hard dependency.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const SIGNAL_PACKAGE_CATALOG = "package_catalog";
export const SIGNAL_ENTITLEMENTS = "entitlements";
export const SIGNAL_PERMISSIONS = "permissions";

const SIGNAL_CHECK_MS = 5_000;

const local = new Map<string, { checkedAt: number; version: number | null }>();

/**
 * Current version of a signal, re-fetched at most every SIGNAL_CHECK_MS.
 * Returns null when no row exists yet or the lookup fails (callers then rely
 * on their own TTL alone).
 */
export async function checkCacheSignal(key: string): Promise<number | null> {
  const hit = local.get(key);
  if (hit && Date.now() - hit.checkedAt < SIGNAL_CHECK_MS) return hit.version;
  let version: number | null = hit?.version ?? null;
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("platform_cache_signals")
      .select("version")
      .eq("signal_key", key)
      .maybeSingle();
    if (!error) version = data ? Number(data.version) : null;
  } catch {
    // keep last-known version — TTL fallback
  }
  local.set(key, { checkedAt: Date.now(), version });
  return version;
}

/**
 * Bump a signal so every instance drops its cached value promptly.
 * Fire-and-forget safe: never throws. Uses a timestamp as the version so
 * concurrent bumps from different instances need no read-modify-write.
 */
export async function bumpCacheSignal(key: string): Promise<void> {
  const version = Date.now();
  try {
    const { error } = await (supabaseAdmin as any)
      .from("platform_cache_signals")
      .upsert(
        { signal_key: key, version, updated_at: new Date().toISOString() },
        { onConflict: "signal_key" },
      );
    if (error) {
      console.warn(`[cache-signals] bump failed for "${key}" (non-fatal):`, error.message);
      return;
    }
    // Record the new version locally so this instance's own throttled check
    // doesn't later mistake it for a remote change.
    local.set(key, { checkedAt: Date.now(), version });
  } catch (err: any) {
    console.warn(`[cache-signals] bump failed for "${key}" (non-fatal):`, err?.message ?? err);
  }
}
