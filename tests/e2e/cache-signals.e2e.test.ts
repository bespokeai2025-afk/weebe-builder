/**
 * Cross-instance cache invalidation signals (e2e, real DB).
 *
 * Simulates a SECOND server instance by writing the signal row directly to
 * the DB (bypassing this process's local invalidation), then verifies this
 * process's caches pick up the change once the throttled signal check
 * re-reads (≤5s), well before the 30s TTL.
 */
import { describe, expect, it } from "vitest";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SIGNAL_PACKAGE_CATALOG,
  bumpCacheSignal,
  checkCacheSignal,
} from "@/lib/packages/cache-signals.server";
import { getEffectivePackageCatalog } from "@/lib/packages/packages-catalog.server";

const sb = supabaseAdmin as any;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function remoteBump(key: string): Promise<number> {
  // Direct DB write = what ANOTHER instance's bumpCacheSignal would do.
  const version = Date.now();
  const { error } = await sb
    .from("platform_cache_signals")
    .upsert({ signal_key: key, version, updated_at: new Date().toISOString() }, { onConflict: "signal_key" });
  if (error) throw new Error(error.message);
  return version;
}

describe("platform cache signals", () => {
  it("bump + check round-trips through the DB", async () => {
    await bumpCacheSignal(SIGNAL_PACKAGE_CATALOG);
    const v = await checkCacheSignal(SIGNAL_PACKAGE_CATALOG);
    expect(typeof v).toBe("number");
    const { data } = await sb
      .from("platform_cache_signals")
      .select("version")
      .eq("signal_key", SIGNAL_PACKAGE_CATALOG)
      .maybeSingle();
    expect(Number(data?.version)).toBe(v);
  });

  it("a remote bump invalidates a warm catalog cache within the check window", async () => {
    // Warm this process's cache.
    await getEffectivePackageCatalog();
    const before = await checkCacheSignal(SIGNAL_PACKAGE_CATALOG);

    // Another instance edits packages and bumps the signal.
    const remoteVersion = await remoteBump(SIGNAL_PACKAGE_CATALOG);
    expect(remoteVersion).not.toBe(before);

    // Within the throttle window the local check may still return the old
    // version; after it expires (5s) the new version must be visible and the
    // catalog must rebuild (returns a fresh Map instance).
    const cached = await getEffectivePackageCatalog();
    await sleep(5_200);
    const after = await checkCacheSignal(SIGNAL_PACKAGE_CATALOG);
    expect(after).toBe(remoteVersion);
    const rebuilt = await getEffectivePackageCatalog();
    expect(rebuilt).not.toBe(cached); // new Map ⇒ cache was dropped and rebuilt
  }, 20_000);
});
