/**
 * E2E tests for access enforcement hardening (role ∩ package ∩ per-user overrides).
 *
 * Runs against the REAL shared Supabase database (service role) using a
 * throw-away random workspace id, and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/access-enforcement.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  resolveEffectiveAccess,
  requireActionAccess,
  requirePageAccessEntitled,
  invalidateEntitlementsCache,
} from "@/lib/packages/entitlements.server";
import {
  requireSystemMindView,
  requireSystemMindApproval,
} from "@/lib/systemmind/systemmind-access.server";

const sb = supabaseAdmin as any;
const WS = randomUUID();

let ownerUserId: string;
let memberUserId: string;

beforeAll(async () => {
  // Two distinct real user ids (workspace_members likely FKs auth.users).
  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("user_id")
    .limit(2);
  if (pErr) throw new Error(pErr.message);
  if (!profiles || profiles.length < 2) throw new Error("Need 2 existing users");
  ownerUserId = profiles[0].user_id;
  memberUserId = profiles[1].user_id;

  const { error: wErr } = await sb.from("workspaces").insert({
    id: WS,
    name: "E2E access-enforcement test (safe to delete)",
    slug: `e2e-access-${WS.slice(0, 8)}`,
    owner_id: ownerUserId,
  });
  if (wErr) throw new Error(wErr.message);

  const { error: mErr } = await sb.from("workspace_members").insert([
    { workspace_id: WS, user_id: ownerUserId, role: "owner" },
    { workspace_id: WS, user_id: memberUserId, role: "admin" },
  ]);
  if (mErr) throw new Error(mErr.message);
});

afterAll(async () => {
  await sb.from("workspace_user_access_overrides").delete().eq("workspace_id", WS);
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  await sb.from("workspace_access_audit_logs").delete().eq("workspace_id", WS);
  await sb.from("workspace_members").delete().eq("workspace_id", WS);
  await sb.from("workspaces").delete().eq("id", WS);
});

async function setPackage(packageKey: string) {
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", WS);
  const { error } = await sb.from("workspace_subscriptions").insert({
    workspace_id: WS,
    package_key: packageKey,
    subscription_status: "active",
  });
  if (error) throw new Error(error.message);
  invalidateEntitlementsCache(WS);
}

async function setOverride(userId: string, override: Record<string, unknown>) {
  const { error } = await sb.from("workspace_user_access_overrides").upsert(
    { workspace_id: WS, user_id: userId, ...override },
    { onConflict: "workspace_id,user_id" },
  );
  if (error) throw new Error(error.message);
}

async function clearOverrides() {
  await sb.from("workspace_user_access_overrides").delete().eq("workspace_id", WS);
}

describe("access enforcement (role ∩ package ∩ overrides)", () => {
  it("non-members are denied everything (fail closed)", async () => {
    const eff = await resolveEffectiveAccess(WS, randomUUID());
    expect(eff.isMember).toBe(false);
    await expect(
      requireActionAccess(WS, randomUUID(), "campaign_activation"),
    ).rejects.toThrow();
    await expect(requireSystemMindView(WS, randomUUID())).rejects.toThrow();
  });

  it("admin on a full package can view SystemMind and act", async () => {
    await setPackage("business_command");
    const eff = await resolveEffectiveAccess(WS, memberUserId);
    if (eff.entitlements.features["systemmind"] !== true) {
      // Catalog may name the top package differently; find one with systemmind.
      const { PACKAGE_CATALOG } = await import("@/lib/packages/packages.shared");
      const full = PACKAGE_CATALOG.find((p) => p.features.includes("systemmind" as any));
      expect(full).toBeTruthy();
      await setPackage(full!.packageKey);
    }
    await expect(requireSystemMindView(WS, memberUserId)).resolves.toBeTruthy();
    await expect(
      requireActionAccess(WS, memberUserId, "notification_settings"),
    ).resolves.toBeTruthy();
  });

  it("per-user override restricts an admin below role level", async () => {
    await setOverride(memberUserId, {
      action_access_json: { notification_settings: false },
      page_access_json: { systemmind: "hidden" },
    });
    await expect(
      requireActionAccess(WS, memberUserId, "notification_settings"),
    ).rejects.toThrow(/Permission denied|not included/);
    await expect(
      requirePageAccessEntitled(WS, memberUserId, "systemmind", "view"),
    ).rejects.toThrow();
    await expect(requireSystemMindView(WS, memberUserId)).rejects.toThrow();
    await clearOverrides();
  });

  it("owner is never locked out, even with a restricting override row", async () => {
    await setOverride(ownerUserId, {
      action_access_json: { notification_settings: false, systemmind_approval: false },
      page_access_json: { systemmind: "hidden", dashboard: "hidden" },
    });
    await expect(
      requireActionAccess(WS, ownerUserId, "notification_settings"),
    ).resolves.toBeTruthy();
    await expect(
      requirePageAccessEntitled(WS, ownerUserId, "systemmind", "view"),
    ).resolves.toBeTruthy();
    await expect(requireSystemMindApproval(WS, ownerUserId)).resolves.toBeTruthy();
    await clearOverrides();
  });

  it("package cap denies SystemMind even for an admin (trial package)", async () => {
    await setPackage("trial");
    await expect(
      requirePageAccessEntitled(WS, memberUserId, "systemmind", "view"),
    ).rejects.toThrow(/package/i);
    await expect(requireSystemMindView(WS, memberUserId)).rejects.toThrow();
  });

  it("People Views: data page + campaign activation honour package and overrides", async () => {
    await setPackage("business_command");
    // Admin can view/edit the data page (People Views funnel) on a full package.
    await expect(
      requirePageAccessEntitled(WS, memberUserId, "data", "edit"),
    ).resolves.toBeTruthy();
    await expect(
      requireActionAccess(WS, memberUserId, "campaign_activation"),
    ).resolves.toBeTruthy();
    // Per-user override hides the data page and blocks activation for the admin.
    await setOverride(memberUserId, {
      page_access_json: { data: "hidden" },
      action_access_json: { campaign_activation: false },
    });
    await expect(
      requirePageAccessEntitled(WS, memberUserId, "data", "view"),
    ).rejects.toThrow();
    await expect(
      requireActionAccess(WS, memberUserId, "campaign_activation"),
    ).rejects.toThrow();
    // Owner stays unaffected by role/override restrictions.
    await expect(
      requirePageAccessEntitled(WS, ownerUserId, "data", "edit"),
    ).resolves.toBeTruthy();
    // Effective access exposes override-aware assignedRecordsOnly for saved views.
    await setOverride(memberUserId, {
      record_visibility_json: { assignedRecordsOnly: true },
    });
    const eff = await resolveEffectiveAccess(WS, memberUserId);
    expect(eff.assignedRecordsOnly).toBe(true);
    await clearOverrides();
  });

  it("denials are audited", async () => {
    const { data: audits } = await sb
      .from("workspace_access_audit_logs")
      .select("id, action_type")
      .eq("workspace_id", WS)
      .limit(50);
    const kinds = new Set((audits ?? []).map((a: any) => a.action_type));
    expect(kinds.has("action_denied") || kinds.has("page_access_denied")).toBe(true);
  });
});
