/**
 * E2E tests for the reseller / white-label hierarchy (Task: reseller child
 * client accounts).
 *
 * Runs against the REAL shared Supabase database (service role) using
 * throw-away random workspaces, and cleans up everything it creates.
 *
 * Run: npx vitest run --config vitest.e2e.config.ts tests/e2e/reseller-hierarchy.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getWorkspaceEntitlements,
  invalidateEntitlementsCache,
  canAccessFeature,
} from "@/lib/packages/entitlements.server";
import {
  getChildAccountUsage,
  requireChildAccountCapacity,
  createChildClientAccount,
  setChildAccountSuspended,
  listChildAccounts,
  upsertWhiteLabelSettings,
  getWhiteLabelSettings,
  resolveEffectiveBranding,
  ALLOWED_CHILD_PACKAGE_KEYS,
} from "@/lib/reseller/reseller.server";
import { ADDON_EXTRA_CHILD_ACCOUNT } from "@/lib/packages/packages.shared";

const sb = supabaseAdmin as any;
const PARENT = randomUUID();
const OTHER_PARENT = randomUUID();

let ownerUserId: string;
const createdChildWorkspaceIds: string[] = [];

beforeAll(async () => {
  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("user_id")
    .limit(1);
  if (pErr) throw new Error(pErr.message);
  if (!profiles?.length) throw new Error("Need an existing user");
  ownerUserId = profiles[0].user_id;

  for (const [id, name] of [
    [PARENT, "E2E reseller parent (safe to delete)"],
    [OTHER_PARENT, "E2E reseller other parent (safe to delete)"],
  ] as const) {
    const { error } = await sb.from("workspaces").insert({
      id,
      name,
      slug: `e2e-reseller-${id.slice(0, 8)}`,
      owner_id: ownerUserId,
    });
    if (error) throw new Error(error.message);
    const { error: mErr } = await sb
      .from("workspace_members")
      .insert({ workspace_id: id, user_id: ownerUserId, role: "owner" });
    if (mErr) throw new Error(mErr.message);
  }
});

afterAll(async () => {
  const allWs = [PARENT, OTHER_PARENT, ...createdChildWorkspaceIds];
  await sb.from("reseller_client_accounts").delete().in("parent_workspace_id", [PARENT, OTHER_PARENT]);
  await sb.from("workspace_relationships").delete().in("parent_workspace_id", [PARENT, OTHER_PARENT]);
  await sb.from("workspace_white_label_settings").delete().in("workspace_id", allWs);
  await sb.from("workspace_addons").delete().in("workspace_id", allWs);
  await sb.from("workspace_subscriptions").delete().in("workspace_id", allWs);
  await sb.from("workspace_access_audit_logs").delete().in("workspace_id", allWs);
  await sb.from("workspace_invites").delete().in("workspace_id", allWs);
  await sb.from("workspace_members").delete().in("workspace_id", allWs);
  await sb.from("workspaces").delete().in("id", allWs);
});

async function setPackage(wsId: string, packageKey: string) {
  await sb.from("workspace_subscriptions").delete().eq("workspace_id", wsId);
  const { error } = await sb.from("workspace_subscriptions").insert({
    workspace_id: wsId,
    package_key: packageKey,
    subscription_status: "active",
  });
  if (error) throw new Error(error.message);
  invalidateEntitlementsCache(wsId);
}

describe("entitlements & capacity", () => {
  it("non-enterprise packages have no reseller feature and zero capacity", async () => {
    await setPackage(PARENT, "receptionist_pro");
    const ent = await getWorkspaceEntitlements(PARENT);
    expect(ent.features["reseller_client_accounts"]).not.toBe(true);
    const usage = await getChildAccountUsage(PARENT);
    expect(usage.allowance).toBe(0);
    await expect(requireChildAccountCapacity(PARENT)).rejects.toThrow();
  });

  it("enterprise grants the feature and 25 included child accounts", async () => {
    await setPackage(PARENT, "enterprise");
    expect(await canAccessFeature(PARENT, ownerUserId, "reseller_client_accounts")).toBe(true);
    const usage = await getChildAccountUsage(PARENT);
    expect(usage.allowance).toBe(25);
    expect(usage.remaining).toBe(25);
  });

  it("extra child account addon raises the allowance", async () => {
    const { error } = await sb.from("workspace_addons").insert({
      workspace_id: PARENT,
      addon_key: ADDON_EXTRA_CHILD_ACCOUNT,
      addon_name: "Extra Client Account",
      quantity: 3,
      status: "active",
    });
    if (error) throw new Error(error.message);
    const usage = await getChildAccountUsage(PARENT);
    expect(usage.allowance).toBe(28);
    await sb
      .from("workspace_addons")
      .delete()
      .eq("workspace_id", PARENT)
      .eq("addon_key", ADDON_EXTRA_CHILD_ACCOUNT);
  });
});

describe("child account lifecycle", () => {
  let clientId: string;
  let childWs: string;

  it("creates a child workspace with relationship, client row, package, invite", async () => {
    const res = await createChildClientAccount({
      parentWorkspaceId: PARENT,
      actingUserId: ownerUserId,
      clientName: `E2E Client ${PARENT.slice(0, 6)}`,
      clientEmail: `e2e-client-${PARENT.slice(0, 8)}@example.com`,
      packageKey: "receptionist_lite",
      brandingMode: "inherit",
    });
    clientId = res.client.id;
    childWs = res.childWorkspaceId;
    createdChildWorkspaceIds.push(childWs);

    const { data: rel } = await sb
      .from("workspace_relationships")
      .select("*")
      .eq("child_workspace_id", childWs)
      .single();
    expect(rel.parent_workspace_id).toBe(PARENT);
    expect(rel.status).toBe("active");

    const ent = await getWorkspaceEntitlements(childWs);
    expect(ent.packageKey).toBe("receptionist_lite");
    // Child does NOT inherit reseller powers.
    expect(ent.features["reseller_client_accounts"]).not.toBe(true);

    const { data: invites } = await sb
      .from("workspace_invites")
      .select("email")
      .eq("workspace_id", childWs);
    expect(invites?.length).toBeGreaterThan(0);
  });

  it("rejects disallowed packages for children", async () => {
    expect(ALLOWED_CHILD_PACKAGE_KEYS).not.toContain("enterprise");
    await expect(
      createChildClientAccount({
        parentWorkspaceId: PARENT,
        actingUserId: ownerUserId,
        clientName: "Bad pkg",
        clientEmail: "bad@example.com",
        packageKey: "enterprise",
        brandingMode: "inherit",
      }),
    ).rejects.toThrow(/package/i);
  });

  it("sibling isolation: another parent cannot see or manage this client", async () => {
    await setPackage(OTHER_PARENT, "enterprise");
    const others = await listChildAccounts(OTHER_PARENT);
    expect(others.find((c: any) => c.id === clientId)).toBeUndefined();
    await expect(
      setChildAccountSuspended({
        parentWorkspaceId: OTHER_PARENT,
        actingUserId: ownerUserId,
        clientId,
        suspended: true,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("suspend degrades the child's subscription; reactivate restores it", async () => {
    const r = await setChildAccountSuspended({
      parentWorkspaceId: PARENT,
      actingUserId: ownerUserId,
      clientId,
      suspended: true,
    });
    expect(r.status).toBe("suspended");
    const { data: sub } = await sb
      .from("workspace_subscriptions")
      .select("subscription_status")
      .eq("workspace_id", childWs)
      .single();
    expect(sub.subscription_status).toBe("suspended");

    const r2 = await setChildAccountSuspended({
      parentWorkspaceId: PARENT,
      actingUserId: ownerUserId,
      clientId,
      suspended: false,
    });
    expect(r2.status).toBe("active");
  });

  it("capacity is enforced (fail closed at limit)", async () => {
    // Shrink allowance to current usage by downgrading, then attempt create.
    await setPackage(PARENT, "receptionist_pro"); // maxChildAccounts 0
    await expect(
      createChildClientAccount({
        parentWorkspaceId: PARENT,
        actingUserId: ownerUserId,
        clientName: "Overflow",
        clientEmail: "overflow@example.com",
        packageKey: "trial",
        brandingMode: "webee",
      }),
    ).rejects.toThrow();
    await setPackage(PARENT, "enterprise");
  });

  it("Master Admin visibility: child is an ordinary workspaces row", async () => {
    const { data } = await sb.from("workspaces").select("id, name").eq("id", childWs).single();
    expect(data?.id).toBe(childWs);
  });
});

describe("white label settings & branding resolution", () => {
  it("upsert respects feature gating of custom domain / hide branding", async () => {
    const saved = await upsertWhiteLabelSettings({
      workspaceId: PARENT,
      actingUserId: ownerUserId,
      patch: {
        brand_name: "E2E Brand",
        primary_color: "#123456",
        custom_domain: "app.e2e-brand.test",
        hide_webee_branding: true,
      },
      allowCustomDomain: false,
      allowHideBranding: false,
    });
    expect(saved.brand_name).toBe("E2E Brand");
    expect(saved.custom_domain).toBeNull();
    expect(saved.hide_webee_branding).not.toBe(true);

    const saved2 = await upsertWhiteLabelSettings({
      workspaceId: PARENT,
      actingUserId: ownerUserId,
      patch: { custom_domain: "app.e2e-brand.test", hide_webee_branding: true },
      allowCustomDomain: true,
      allowHideBranding: true,
    });
    expect(saved2.custom_domain).toBe("app.e2e-brand.test");
    expect(saved2.custom_domain_status).toBe("requested");
    expect(saved2.hide_webee_branding).toBe(true);
  });

  it("child in inherit mode resolves the parent's branding", async () => {
    const childWs = createdChildWorkspaceIds[0];
    const branding = await resolveEffectiveBranding(childWs);
    expect(branding.source).toBe("parent");
    expect((branding.settings as any)?.brand_name).toBe("E2E Brand");
  });

  it("parent's own settings read back parent-scoped only", async () => {
    const other = await getWhiteLabelSettings(OTHER_PARENT);
    expect(other).toBeNull();
  });
});

describe("RLS posture", () => {
  it("new hierarchy tables exist and are queryable via service role", async () => {
    // RLS enablement + member policies + REVOKE writes are asserted in the
    // migration itself (applied live); service role bypasses RLS, so here we
    // assert the tables exist and respond.
    for (const t of ["workspace_relationships", "workspace_white_label_settings", "reseller_client_accounts"]) {
      const col = t === "workspace_white_label_settings" ? "workspace_id" : "id";
      const { error: qErr } = await sb.from(t).select(col).limit(1);
      expect(qErr).toBeNull();
    }
  });
});
