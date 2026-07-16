/**
 * Cross-instance cache invalidation signals (e2e, real DB).
 *
 * Simulates a SECOND server instance by writing the signal row directly to
 * the DB (bypassing this process's local invalidation), then verifies this
 * process's caches pick up the change once the throttled signal check
 * re-reads (≤5s), well before the 30s TTL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SIGNAL_PACKAGE_CATALOG,
  SIGNAL_PERMISSIONS,
  bumpCacheSignal,
  checkCacheSignal,
} from "@/lib/packages/cache-signals.server";
import { getEffectivePackageCatalog } from "@/lib/packages/packages-catalog.server";
import { resolvePermissions } from "@/lib/permissions/permissions.server";

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

describe("permissions signal (role edits reach a second instance)", () => {
  const WS = randomUUID();
  let memberUserId: string;
  let outsiderUserId: string;

  beforeAll(async () => {
    const { data: profiles, error: pErr } = await sb
      .from("profiles")
      .select("user_id")
      .limit(2);
    if (pErr) throw new Error(pErr.message);
    if (!profiles || profiles.length < 2) throw new Error("Need 2 existing users");
    memberUserId = profiles[0].user_id;
    outsiderUserId = profiles[1].user_id;

    const { error: wErr } = await sb.from("workspaces").insert({
      id: WS,
      name: "E2E permissions-signal test (safe to delete)",
      slug: `e2e-permsig-${WS.slice(0, 8)}`,
      owner_id: memberUserId,
    });
    if (wErr) throw new Error(wErr.message);

    const { error: mErr } = await sb.from("workspace_members").insert({
      workspace_id: WS,
      user_id: memberUserId,
      role: "member",
    });
    if (mErr) throw new Error(mErr.message);
  });

  afterAll(async () => {
    await sb.from("workspace_member_roles").delete().eq("workspace_id", WS);
    await sb.from("workspace_members").delete().eq("workspace_id", WS);
    await sb.from("workspaces").delete().eq("id", WS);
  });

  it("serves a cached resolution within TTL, then refetches after a remote bump", async () => {
    // Warm this instance's cache with the member's current (legacy "member") role.
    const first = await resolvePermissions(WS, memberUserId);
    expect(first.isMember).toBe(true);
    expect(first.legacyRole).toBe("member");

    // Within TTL + unchanged signal the exact cached object is returned.
    const cachedHit = await resolvePermissions(WS, memberUserId);
    expect(cachedHit).toBe(first);

    // A SECOND instance edits the role and bumps the shared signal — both as
    // direct DB writes, bypassing this process's local invalidation entirely.
    const { error: rErr } = await sb
      .from("workspace_members")
      .update({ role: "admin" })
      .eq("workspace_id", WS)
      .eq("user_id", memberUserId);
    if (rErr) throw new Error(rErr.message);
    const remoteVersion = await remoteBump(SIGNAL_PERMISSIONS);

    // Once the throttled signal check re-reads (≤5s), the cached entry's
    // stored version no longer matches ⇒ resolver must refetch from the DB.
    await sleep(5_200);
    const after = await checkCacheSignal(SIGNAL_PERMISSIONS);
    expect(after).toBe(remoteVersion);
    const refetched = await resolvePermissions(WS, memberUserId);
    expect(refetched).not.toBe(first); // new object ⇒ cache entry was dropped
    expect(refetched.legacyRole).toBe("admin"); // and the role edit is visible
  }, 20_000);

  it("never caches NO_ACCESS — a non-member resolves fresh on every call", async () => {
    const denied = await resolvePermissions(WS, outsiderUserId);
    expect(denied.isMember).toBe(false);
    expect(denied.legacyRole).toBe(null);

    // Grant membership directly in the DB with NO signal bump and NO local
    // invalidation. If NO_ACCESS had been cached, this would stay invisible
    // for up to 30s; because it is never cached, the next call sees it.
    const { error } = await sb.from("workspace_members").insert({
      workspace_id: WS,
      user_id: outsiderUserId,
      role: "member",
    });
    if (error) throw new Error(error.message);
    try {
      const now = await resolvePermissions(WS, outsiderUserId);
      expect(now.isMember).toBe(true);
      expect(now.legacyRole).toBe("member");
    } finally {
      await sb
        .from("workspace_members")
        .delete()
        .eq("workspace_id", WS)
        .eq("user_id", outsiderUserId);
    }
  });
});
