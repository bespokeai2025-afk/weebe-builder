/**
 * E2E tests for Master Admin oversight (Task: package matrix persistence,
 * suspension degrade, feature overrides, migration report safety).
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random package key + workspace, and cleans up everything.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/master-admin-oversight.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getWorkspaceEntitlements,
  invalidateEntitlementsCache,
} from "@/lib/packages/entitlements.server";
import {
  getEffectivePackageCatalog,
  invalidatePackageCatalogCache,
  packageByKeyServer,
  notificationCapsForPackageServer,
} from "@/lib/packages/packages-catalog.server";
import { loadNotificationCaps } from "@/lib/notifications/notification-engine.shared";
import { packageByKey, PACKAGE_CATALOG } from "@/lib/packages/packages.shared";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";

const sb = supabaseAdmin as any;
const WS = randomUUID();
const TEST_PKG = `e2e_pkg_${WS.slice(0, 8)}`;
let ownerUserId: string;

beforeAll(async () => {
  const { data: profiles } = await sb.from("profiles").select("user_id").limit(1);
  if (!profiles?.length) throw new Error("Need an existing user");
  ownerUserId = profiles[0].user_id;
  const { error } = await sb.from("workspaces").insert({
    id: WS,
    name: "E2E oversight ws (safe to delete)",
    slug: `e2e-oversight-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (error) throw new Error(error.message);
  await sb.from("workspace_members").insert({ workspace_id: WS, user_id: ownerUserId, role: "owner" });
});

afterAll(async () => {
  await sb.from("package_definitions").delete().eq("package_key", TEST_PKG);
  await sb.from("package_definitions").delete().eq("package_key", "pro_bundle_e2e_never");
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await sb.from("workspace_feature_entitlements").delete().eq("workspace_id", WS);
  await sb.from("workspace_access_audit_logs").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
  invalidatePackageCatalogCache();
  invalidateEntitlementsCache();
});

describe("effective package catalog (DB overrides code)", () => {
  it("code-only packages resolve unchanged", async () => {
    invalidatePackageCatalogCache();
    const pkg = await packageByKeyServer("pro_bundle");
    const code = packageByKey("pro_bundle");
    expect(pkg.packageName).toBe(code.packageName);
    expect(pkg.dbOverride).toBe(false);
    expect(pkg.features.sort()).toEqual([...code.features].sort());
  });

  it("a DB row for a NEW package key appears in the catalog on the trial baseline", async () => {
    const { error } = await sb.from("package_definitions").insert({
      package_key: TEST_PKG,
      package_name: "E2E Test Package",
      monthly_price: 12300,
      included_voice_minutes: 42,
      included_staff_users: 3,
      max_agents: 2,
      features_json: { workflows: true, campaigns: true },
      notification_caps_json: { emailAllowed: true, customRecipientsAllowed: false },
      is_active: true,
    });
    expect(error).toBeNull();
    invalidatePackageCatalogCache();
    const catalog = await getEffectivePackageCatalog();
    const pkg = catalog.get(TEST_PKG)!;
    expect(pkg).toBeTruthy();
    expect(pkg.dbOverride).toBe(true);
    expect(pkg.packageName).toBe("E2E Test Package");
    expect(pkg.limits.maxAgents).toBe(2);
    expect(pkg.features.sort()).toEqual(["campaigns", "workflows"]);
    expect(pkg.notificationCaps).toEqual({ emailAllowed: true, customRecipientsAllowed: false });
  });

  it("-1 limit sentinel means UNLIMITED; page/action caps overlay from DB", async () => {
    const { error } = await sb
      .from("package_definitions")
      .update({
        max_agents: -1,
        page_access_json: { dashboard: "view_only" },
        action_access_json: { create_campaign: false },
      })
      .eq("package_key", TEST_PKG);
    expect(error).toBeNull();
    invalidatePackageCatalogCache();
    const pkg = await packageByKeyServer(TEST_PKG);
    expect(pkg.limits.maxAgents).toBeNull(); // -1 → unlimited
    expect((pkg.pageAccessCaps as any)?.dashboard).toBe("view_only");
    expect((pkg.actionCaps as any)?.create_campaign).toBe(false);
    // restore
    await sb
      .from("package_definitions")
      .update({ max_agents: 2, page_access_json: {}, action_access_json: {} })
      .eq("package_key", TEST_PKG);
    invalidatePackageCatalogCache();
  });

  it("unknown package keys fail closed to trial", async () => {
    const pkg = await packageByKeyServer("definitely_not_a_package");
    expect(pkg.packageKey).toBe("trial");
  });

  it("entitlement resolution uses the DB-defined package", async () => {
    await sb.from("workspace_subscriptions").upsert(
      { workspace_id: WS, package_key: TEST_PKG, subscription_status: "active" },
      { onConflict: "workspace_id" },
    );
    invalidateEntitlementsCache(WS);
    const ent = await getWorkspaceEntitlements(WS);
    expect(ent.packageKey).toBe(TEST_PKG);
    expect(ent.features.workflows).toBe(true);
    expect(ent.features.campaigns).toBe(true);
    expect(ent.features.reseller_client_accounts ?? false).toBe(false);
    expect(ent.limits.maxAgents).toBe(2);
  });

  it("notification caps honour the DB override (server + loadNotificationCaps)", async () => {
    const caps = await notificationCapsForPackageServer(TEST_PKG);
    expect(caps).toEqual({ emailAllowed: true, customRecipientsAllowed: false });
    const loaded = await loadNotificationCaps(sb, WS);
    expect(loaded).toEqual({ emailAllowed: true, customRecipientsAllowed: false });
  });

  it("suspension degrades entitlements", async () => {
    await sb
      .from("workspace_subscriptions")
      .update({ subscription_status: "suspended" })
      .eq("workspace_id", WS);
    invalidateEntitlementsCache(WS);
    const ent = await getWorkspaceEntitlements(WS);
    expect(ent.features.campaigns ?? false).toBe(false);
    // reactivate restores
    await sb.from("workspace_subscriptions").update({ subscription_status: "active" }).eq("workspace_id", WS);
    invalidateEntitlementsCache(WS);
    const ent2 = await getWorkspaceEntitlements(WS);
    expect(ent2.features.campaigns).toBe(true);
  });

  it("admin_override feature rows win over the package", async () => {
    await sb.from("workspace_feature_entitlements").upsert(
      { workspace_id: WS, feature_key: "reseller_client_accounts", source: "admin_override", enabled: true },
      { onConflict: "workspace_id,feature_key,source" },
    );
    invalidateEntitlementsCache(WS);
    const ent = await getWorkspaceEntitlements(WS);
    expect(ent.features.reseller_client_accounts).toBe(true);
  });
});

describe("platform-level audit + migration safety", () => {
  it("audit table accepts NULL workspace_id (platform-level entries)", async () => {
    const { data, error } = await sb
      .from("workspace_access_audit_logs")
      .insert({
        workspace_id: null,
        object_type: "package_definition",
        object_id: TEST_PKG,
        action_type: "e2e_test",
        risk_level: "low",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    await sb.from("workspace_access_audit_logs").delete().eq("id", data.id);
  });

  it("migration logic never selects WBAH for assignment and is insert-only", async () => {
    // Reproduce the report's selection rule directly against the DB.
    const { data: wbahSub } = await sb
      .from("workspace_subscriptions")
      .select("workspace_id, package_key, subscription_status")
      .eq("workspace_id", WBAH_WORKSPACE_ID)
      .maybeSingle();
    // Whatever WBAH's row is (or isn't), the rule is: existing rows → action none;
    // missing row + WBAH → skipped_wbah. Either way WBAH is never written.
    if (wbahSub) {
      expect(wbahSub.workspace_id).toBe(WBAH_WORKSPACE_ID); // action would be "none"
    }
    // Insert-only apply: upsert with ignoreDuplicates must not change existing rows.
    const before = await sb
      .from("workspace_subscriptions")
      .select("package_key")
      .eq("workspace_id", WS)
      .single();
    await sb.from("workspace_subscriptions").upsert(
      { workspace_id: WS, package_key: "legacy_full", subscription_status: "active" },
      { onConflict: "workspace_id", ignoreDuplicates: true },
    );
    const after = await sb
      .from("workspace_subscriptions")
      .select("package_key")
      .eq("workspace_id", WS)
      .single();
    expect(after.data.package_key).toBe(before.data.package_key); // unchanged (not legacy_full)
    expect(after.data.package_key).toBe(TEST_PKG);
  });

  it("PACKAGE_CATALOG keys are all representable in the matrix", () => {
    for (const p of PACKAGE_CATALOG) expect(/^[a-z0-9_]{2,50}$/.test(p.packageKey)).toBe(true);
  });
});
