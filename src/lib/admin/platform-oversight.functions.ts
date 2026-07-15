/**
 * Master Admin (platform admin) oversight server functions.
 *
 * Package access matrix (package_definitions DB overrides), reseller +
 * child-workspace management, suspension, feature overrides, audit
 * visibility and the one-time package migration report.
 *
 * All fns require platform admin (requirePlatformAdmin). All mutations are
 * audited via writeAccessAudit. Billing provider integration is OUT of
 * scope — internal records only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAccessAudit } from "@/lib/permissions/permissions.server";
import {
  FEATURE_KEYS,
  FEATURE_LABELS,
  LEGACY_PACKAGE_KEY,
  PACKAGE_CATALOG,
} from "@/lib/packages/packages.shared";
import {
  getEffectivePackageCatalog,
  invalidatePackageCatalogCache,
} from "@/lib/packages/packages-catalog.server";
import {
  invalidateEntitlementsCache,
  seedNotificationDefaults,
} from "@/lib/packages/entitlements.server";
import { isWbahWorkspaceId } from "@/lib/wbah-exclusion.shared";

const sb = supabaseAdmin as any;
const adminMw = [requireSupabaseAuth, requirePlatformAdmin] as const;

const SUB_STATUSES = ["trial", "active", "past_due", "cancelled", "suspended"] as const;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// ── Package access matrix ────────────────────────────────────────────────────

export const adminGetPackageMatrix = createServerFn({ method: "GET" })
  .middleware([...adminMw])
  .handler(async () => {
    invalidatePackageCatalogCache(); // admin always sees fresh state
    const catalog = await getEffectivePackageCatalog();
    const { data: rows } = await sb.from("package_definitions").select("package_key, updated_at, updated_by");
    const meta = new Map<string, any>((rows ?? []).map((r: any) => [r.package_key, r]));
    return {
      featureKeys: FEATURE_KEYS,
      featureLabels: FEATURE_LABELS,
      packages: [...catalog.values()].map((p) => ({
        ...p,
        codeDefault: PACKAGE_CATALOG.some((c) => c.packageKey === p.packageKey),
        updatedAt: meta.get(p.packageKey)?.updated_at ?? null,
      })),
    };
  });

export const adminUpsertPackageDefinition = createServerFn({ method: "POST" })
  .middleware([...adminMw])
  .inputValidator(
    (d: {
      packageKey: string;
      packageName?: string;
      description?: string;
      monthlyPricePence?: number | null;
      limits?: Partial<Record<string, number | null>>;
      features?: Record<string, boolean>;
      aiDepartments?: string[];
      notificationCaps?: { emailAllowed: boolean; customRecipientsAllowed: boolean } | null;
      notificationDefaults?: Record<string, { enabled?: boolean; emailEnabled?: boolean; inAppEnabled?: boolean; frequency?: string }> | null;
      isActive?: boolean;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const packageKey = String(data.packageKey ?? "").trim();
    if (!/^[a-z0-9_]{2,50}$/.test(packageKey)) throw new Error("Invalid package key");
    if (data.monthlyPricePence !== undefined && data.monthlyPricePence !== null) {
      const p = Number(data.monthlyPricePence);
      if (!Number.isFinite(p) || !Number.isInteger(p) || p < 0 || p > 100_000_000) {
        throw new Error("Invalid monthly price");
      }
    }
    const FREQS = ["immediate", "hourly", "daily", "weekly"];
    let cleanDefaults: Record<string, any> | null | undefined = data.notificationDefaults;
    if (cleanDefaults) {
      const { NOTIFICATION_EVENT_KEYS } = await import("@/lib/notifications/notification-engine.shared");
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(cleanDefaults)) {
        if (!(NOTIFICATION_EVENT_KEYS as readonly string[]).includes(k)) continue;
        if (!v || typeof v !== "object") continue;
        out[k] = {
          enabled: v.enabled !== false,
          inAppEnabled: v.inAppEnabled !== false,
          emailEnabled: v.emailEnabled === true,
          frequency: FREQS.includes(String(v.frequency)) ? v.frequency : "immediate",
        };
      }
      cleanDefaults = out;
    }

    const features: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(data.features ?? {})) {
      if ((FEATURE_KEYS as readonly string[]).includes(k) && typeof v === "boolean") features[k] = v;
    }
    const aiDepts = (data.aiDepartments ?? []).filter((d) =>
      ["growthmind", "hivemind", "systemmind", "accountsmind"].includes(d),
    );
    const lim = data.limits ?? {};

    const { data: before } = await sb
      .from("package_definitions").select("*").eq("package_key", packageKey).maybeSingle();

    const row: Record<string, unknown> = {
      package_key: packageKey,
      package_name: data.packageName?.trim() || before?.package_name || packageKey,
      description: data.description ?? before?.description ?? null,
      monthly_price: data.monthlyPricePence === undefined ? (before?.monthly_price ?? null) : data.monthlyPricePence,
      included_voice_minutes: num(lim.includedVoiceMinutes) ?? before?.included_voice_minutes ?? 0,
      included_staff_users: num(lim.includedStaffUsers) ?? before?.included_staff_users ?? 1,
      max_agents: "maxAgents" in lim ? num(lim.maxAgents) : (before?.max_agents ?? null),
      max_workflows: "maxWorkflows" in lim ? num(lim.maxWorkflows) : (before?.max_workflows ?? null),
      max_campaigns: "maxCampaigns" in lim ? num(lim.maxCampaigns) : (before?.max_campaigns ?? null),
      max_custom_views: "maxCustomViews" in lim ? num(lim.maxCustomViews) : (before?.max_custom_views ?? null),
      max_page_filters: "maxPageFilters" in lim ? num(lim.maxPageFilters) : (before?.max_page_filters ?? null),
      max_campaign_filters: "maxCampaignFilters" in lim ? num(lim.maxCampaignFilters) : (before?.max_campaign_filters ?? null),
      max_child_accounts: "maxChildAccounts" in lim ? num(lim.maxChildAccounts) : (before?.max_child_accounts ?? null),
      features_json: Object.keys(features).length > 0 ? features : (before?.features_json ?? {}),
      ai_departments_json: data.aiDepartments ? aiDepts : (before?.ai_departments_json ?? []),
      notification_caps_json:
        data.notificationCaps === undefined
          ? (before?.notification_caps_json ?? {})
          : data.notificationCaps === null
            ? {}
            : {
                emailAllowed: data.notificationCaps.emailAllowed === true,
                customRecipientsAllowed: data.notificationCaps.customRecipientsAllowed === true,
              },
      notification_defaults_json:
        cleanDefaults === undefined
          ? (before?.notification_defaults_json ?? {})
          : (cleanDefaults ?? {}),
      is_active: data.isActive ?? before?.is_active ?? true,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    const { error } = await sb
      .from("package_definitions")
      .upsert(row, { onConflict: "package_key" });
    if (error) throw new Error(error.message);
    invalidatePackageCatalogCache();
    invalidateEntitlementsCache();

    await writeAccessAudit({
      workspaceId: null as any,
      actingUserId: context.userId,
      objectType: "package_definition",
      objectId: packageKey,
      actionType: before ? "update" : "create",
      beforeState: before ?? null,
      afterState: row,
      riskLevel: "high",
    });
    return { ok: true as const };
  });

/** Remove the DB override — the package reverts to the code catalog default. */
export const adminResetPackageDefinition = createServerFn({ method: "POST" })
  .middleware([...adminMw])
  .inputValidator((d: { packageKey: string }) => d)
  .handler(async ({ context, data }) => {
    const { data: before } = await sb
      .from("package_definitions").select("*").eq("package_key", data.packageKey).maybeSingle();
    if (!before) return { ok: true as const };
    const isCode = PACKAGE_CATALOG.some((c) => c.packageKey === data.packageKey);
    if (!isCode) {
      // Admin-created package: block deletion while workspaces still use it.
      const { count } = await sb
        .from("workspace_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("package_key", data.packageKey);
      if ((count ?? 0) > 0) {
        throw new Error(`Cannot remove "${data.packageKey}": ${count} workspace(s) are on this package.`);
      }
    }
    const { error } = await sb.from("package_definitions").delete().eq("package_key", data.packageKey);
    if (error) throw new Error(error.message);
    invalidatePackageCatalogCache();
    invalidateEntitlementsCache();
    await writeAccessAudit({
      workspaceId: null as any,
      actingUserId: context.userId,
      objectType: "package_definition",
      objectId: data.packageKey,
      actionType: "delete",
      beforeState: before,
      riskLevel: "high",
    });
    return { ok: true as const };
  });

// ── Reseller management ──────────────────────────────────────────────────────

export const adminListResellers = createServerFn({ method: "GET" })
  .middleware([...adminMw])
  .handler(async () => {
    // Resellers = parents of reseller_client relationships ∪ workspaces with
    // the reseller feature (package or admin_override).
    const [{ data: rels }, { data: feats }, { data: subs }] = await Promise.all([
      sb.from("workspace_relationships").select("parent_workspace_id, child_workspace_id, status")
        .eq("relationship_type", "reseller_client"),
      sb.from("workspace_feature_entitlements").select("workspace_id, source, enabled")
        .eq("feature_key", "reseller_client_accounts"),
      sb.from("workspace_subscriptions").select("workspace_id, package_key, subscription_status, updated_at"),
    ]);
    const subByWs = new Map<string, any>((subs ?? []).map((s: any) => [s.workspace_id, s]));
    const catalog = await getEffectivePackageCatalog();

    const parentIds = new Set<string>((rels ?? []).map((r: any) => r.parent_workspace_id));
    for (const f of feats ?? []) {
      if (f.enabled) parentIds.add(f.workspace_id);
      else continue;
    }
    for (const s of subs ?? []) {
      const pkg = catalog.get(s.package_key);
      if (pkg?.features.includes("reseller_client_accounts")) parentIds.add(s.workspace_id);
    }
    const ids = [...parentIds];
    if (ids.length === 0) return [];

    const [{ data: wss }, { data: clients }, { data: wl }, { data: emailProviders }] = await Promise.all([
      sb.from("workspaces").select("id, name, slug, owner_id, created_at").in("id", ids),
      sb.from("reseller_client_accounts").select("parent_workspace_id, status").in("parent_workspace_id", ids),
      sb.from("workspace_white_label_settings")
        .select("workspace_id, brand_name, custom_domain, custom_domain_status, hide_webee_branding")
        .in("workspace_id", ids),
      sb.from("workspace_email_provider_settings")
        .select("workspace_id, provider, is_active, sending_mode").in("workspace_id", ids),
    ]);
    const clientsByParent = new Map<string, any[]>();
    for (const c of clients ?? []) {
      const arr = clientsByParent.get(c.parent_workspace_id) ?? [];
      arr.push(c);
      clientsByParent.set(c.parent_workspace_id, arr);
    }
    const wlByWs = new Map<string, any>((wl ?? []).map((w: any) => [w.workspace_id, w]));
    const epByWs = new Map<string, any>((emailProviders ?? []).map((e: any) => [e.workspace_id, e]));

    // Feature-override map (admin_override rows explicitly grant/deny).
    const overrideByWs = new Map<string, boolean>();
    for (const f of feats ?? []) {
      if (f.source === "admin_override") overrideByWs.set(f.workspace_id, f.enabled === true);
    }

    return (wss ?? []).map((ws: any) => {
      const sub = subByWs.get(ws.id);
      const pkg = catalog.get(sub?.package_key ?? "");
      const childRows = clientsByParent.get(ws.id) ?? [];
      const wlRow = wlByWs.get(ws.id);
      const ep = epByWs.get(ws.id);
      return {
        workspaceId: ws.id,
        name: ws.name,
        slug: ws.slug,
        createdAt: ws.created_at,
        packageKey: sub?.package_key ?? null,
        packageName: pkg?.packageName ?? sub?.package_key ?? "—",
        subscriptionStatus: sub?.subscription_status ?? "none",
        lastActivityAt: sub?.updated_at ?? ws.created_at,
        childCount: childRows.filter((c: any) => c.status !== "terminated").length,
        childLimit: pkg?.limits.maxChildAccounts ?? 0,
        activeChildren: childRows.filter((c: any) => c.status === "active").length,
        suspendedChildren: childRows.filter((c: any) => c.status === "suspended").length,
        whiteLabel: wlRow
          ? {
              brandName: wlRow.brand_name,
              customDomain: wlRow.custom_domain,
              customDomainStatus: wlRow.custom_domain_status,
              hideWebeeBranding: wlRow.hide_webee_branding === true,
            }
          : null,
        emailProviderMode: ep?.is_active ? (ep.provider ?? "custom") : "platform_default",
        resellerOverride: overrideByWs.has(ws.id) ? overrideByWs.get(ws.id) : null,
        packageIncludesReseller: pkg?.features.includes("reseller_client_accounts") === true,
      };
    });
  });

export const adminListChildWorkspaces = createServerFn({ method: "GET" })
  .middleware([...adminMw])
  .handler(async () => {
    const { data: clients, error } = await sb
      .from("reseller_client_accounts")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = clients ?? [];
    const wsIds = [
      ...new Set(
        rows.flatMap((c: any) => [c.parent_workspace_id, c.child_workspace_id].filter(Boolean)),
      ),
    ];
    const childIds = rows.map((c: any) => c.child_workspace_id).filter(Boolean);
    const [{ data: wss }, { data: subs }, { data: members }, { data: agents }] = await Promise.all([
      wsIds.length ? sb.from("workspaces").select("id, name, owner_id, created_at").in("id", wsIds) : { data: [] },
      childIds.length ? sb.from("workspace_subscriptions").select("workspace_id, package_key, subscription_status").in("workspace_id", childIds) : { data: [] },
      childIds.length ? sb.from("workspace_members").select("workspace_id").in("workspace_id", childIds) : { data: [] },
      childIds.length ? sb.from("agents").select("workspace_id").in("workspace_id", childIds) : { data: [] },
    ]);
    const wsById = new Map<string, any>((wss ?? []).map((w: any) => [w.id, w]));
    const subByWs = new Map<string, any>((subs ?? []).map((s: any) => [s.workspace_id, s]));
    const catalog = await getEffectivePackageCatalog();
    const countBy = (list: any[] | null, id: string) =>
      (list ?? []).filter((m: any) => m.workspace_id === id).length;

    return rows.map((c: any) => {
      const child = c.child_workspace_id ? wsById.get(c.child_workspace_id) : null;
      const parent = wsById.get(c.parent_workspace_id);
      const sub = c.child_workspace_id ? subByWs.get(c.child_workspace_id) : null;
      return {
        clientId: c.id,
        childWorkspaceId: c.child_workspace_id,
        childName: child?.name ?? c.client_name,
        parentWorkspaceId: c.parent_workspace_id,
        parentName: parent?.name ?? "—",
        clientEmail: c.client_email,
        packageKey: sub?.package_key ?? c.package_key,
        packageName: catalog.get(sub?.package_key ?? c.package_key)?.packageName ?? c.package_key,
        status: c.status,
        subscriptionStatus: sub?.subscription_status ?? null,
        brandingMode: c.branding_mode,
        billingMode: c.billing_mode,
        createdAt: c.created_at,
        members: c.child_workspace_id ? countBy(members, c.child_workspace_id) : 0,
        agents: c.child_workspace_id ? countBy(agents, c.child_workspace_id) : 0,
        upgradeRequestedPackageKey: c.upgrade_requested_package_key ?? null,
      };
    });
  });

// ── Workspace-level admin actions ────────────────────────────────────────────

/** Grant/revoke reseller access via an admin_override feature entitlement. */
export const adminSetResellerAccess = createServerFn({ method: "POST" })
  .middleware([...adminMw])
  .inputValidator((d: { workspaceId: string; enabled: boolean | null }) => d)
  .handler(async ({ context, data }) => {
    return setFeatureOverride(context.userId, data.workspaceId, "reseller_client_accounts", data.enabled);
  });

/** Grant/remove/clear an admin feature override. enabled=null clears the row. */
export const adminSetFeatureOverride = createServerFn({ method: "POST" })
  .middleware([...adminMw])
  .inputValidator((d: { workspaceId: string; featureKey: string; enabled: boolean | null }) => d)
  .handler(async ({ context, data }) => {
    if (!(FEATURE_KEYS as readonly string[]).includes(data.featureKey)) {
      throw new Error("Unknown feature key");
    }
    return setFeatureOverride(context.userId, data.workspaceId, data.featureKey, data.enabled);
  });

async function setFeatureOverride(
  actingUserId: string,
  workspaceId: string,
  featureKey: string,
  enabled: boolean | null,
) {
  const { data: ws } = await sb.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle();
  if (!ws) throw new Error("Workspace not found");
  const { data: before } = await sb
    .from("workspace_feature_entitlements")
    .select("enabled")
    .eq("workspace_id", workspaceId)
    .eq("feature_key", featureKey)
    .eq("source", "admin_override")
    .maybeSingle();
  if (enabled === null) {
    const { error } = await sb
      .from("workspace_feature_entitlements")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("feature_key", featureKey)
      .eq("source", "admin_override");
    if (error) throw new Error(error.message);
  } else {
    const { error } = await sb.from("workspace_feature_entitlements").upsert(
      {
        workspace_id: workspaceId,
        feature_key: featureKey,
        source: "admin_override",
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,feature_key,source" },
    );
    if (error) throw new Error(error.message);
  }
  invalidateEntitlementsCache(workspaceId);
  await writeAccessAudit({
    workspaceId,
    actingUserId,
    objectType: "feature_override",
    objectId: featureKey,
    actionType: enabled === null ? "delete" : before ? "update" : "create",
    beforeState: before ?? null,
    afterState: { featureKey, enabled },
    riskLevel: "high",
  });
  return { ok: true as const };
}

/** Force-set a workspace's package (unlike provisioning, this UPDATES). */
export const adminSetWorkspacePackage = createServerFn({ method: "POST" })
  .middleware([...adminMw])
  .inputValidator((d: { workspaceId: string; packageKey: string; status?: string }) => d)
  .handler(async ({ context, data }) => {
    const catalog = await getEffectivePackageCatalog();
    if (!catalog.has(data.packageKey)) throw new Error("Unknown package key");
    const status = data.status && (SUB_STATUSES as readonly string[]).includes(data.status)
      ? data.status
      : "active";
    const { data: before } = await sb
      .from("workspace_subscriptions")
      .select("package_key, subscription_status")
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    const { error } = await sb.from("workspace_subscriptions").upsert(
      {
        workspace_id: data.workspaceId,
        package_key: data.packageKey,
        subscription_status: status,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error(error.message);
    invalidateEntitlementsCache(data.workspaceId);
    await seedNotificationDefaults(data.workspaceId, data.packageKey);
    await writeAccessAudit({
      workspaceId: data.workspaceId,
      actingUserId: context.userId,
      objectType: "package",
      objectId: data.packageKey,
      actionType: "admin_package_change",
      beforeState: before ?? null,
      afterState: { packageKey: data.packageKey, status },
      riskLevel: "high",
    });
    return { ok: true as const };
  });

/** Suspend / reactivate a workspace (entitlements degrade automatically). */
export const adminSetWorkspaceSuspended = createServerFn({ method: "POST" })
  .middleware([...adminMw])
  .inputValidator((d: { workspaceId: string; suspended: boolean }) => d)
  .handler(async ({ context, data }) => {
    if (isWbahWorkspaceId(data.workspaceId)) {
      throw new Error("The WBAH workspace cannot be suspended from here.");
    }
    const { data: before, error: bErr } = await sb
      .from("workspace_subscriptions")
      .select("package_key, subscription_status")
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!before) throw new Error("Workspace has no subscription row — run the migration report first.");
    const newStatus = data.suspended
      ? "suspended"
      : before.package_key === "trial" ? "trial" : "active";
    const { error } = await sb
      .from("workspace_subscriptions")
      .update({ subscription_status: newStatus, updated_at: new Date().toISOString() })
      .eq("workspace_id", data.workspaceId);
    if (error) throw new Error(error.message);
    invalidateEntitlementsCache(data.workspaceId);
    await writeAccessAudit({
      workspaceId: data.workspaceId,
      actingUserId: context.userId,
      objectType: "workspace_subscription",
      objectId: data.workspaceId,
      actionType: data.suspended ? "suspend" : "reactivate",
      beforeState: before,
      afterState: { subscriptionStatus: newStatus },
      riskLevel: "high",
    });
    return { ok: true as const, status: newStatus };
  });

/** Feature overrides + audit trail for one workspace (drill-in). */
export const adminGetWorkspaceOversight = createServerFn({ method: "GET" })
  .middleware([...adminMw])
  .inputValidator((d: { workspaceId: string }) => d)
  .handler(async ({ data }) => {
    const [{ data: ws }, { data: sub }, { data: overrides }, { data: audit }] = await Promise.all([
      sb.from("workspaces").select("id, name, slug, owner_id, created_at").eq("id", data.workspaceId).maybeSingle(),
      sb.from("workspace_subscriptions").select("*").eq("workspace_id", data.workspaceId).maybeSingle(),
      sb.from("workspace_feature_entitlements")
        .select("feature_key, source, enabled, updated_at")
        .eq("workspace_id", data.workspaceId)
        .eq("source", "admin_override"),
      sb.from("workspace_access_audit_logs")
        .select("id, acting_user_id, object_type, object_id, action_type, risk_level, created_at, after_state")
        .eq("workspace_id", data.workspaceId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (!ws) throw new Error("Workspace not found");
    return { workspace: ws, subscription: sub ?? null, overrides: overrides ?? [], audit: audit ?? [] };
  });

// ── Migration report ─────────────────────────────────────────────────────────

/**
 * Safe migration report for existing workspaces. Report-only unless
 * apply=true; apply is INSERT-ONLY (missing subscription rows get an
 * explicit legacy_full row). Never modifies WBAH, never changes existing
 * rows, never locks anyone out (legacy_full preserves full access).
 */
export const adminRunPackageMigrationReport = createServerFn({ method: "POST" })
  .middleware([...adminMw])
  .inputValidator((d: { apply?: boolean }) => d ?? {})
  .handler(async ({ context, data }) => {
    const apply = data.apply === true;
    const [{ data: wss, error: wErr }, { data: subs }, { data: rels }, { data: wl }, { data: members }] =
      await Promise.all([
        sb.from("workspaces").select("id, name, owner_id, created_at"),
        sb.from("workspace_subscriptions").select("workspace_id, package_key, subscription_status"),
        sb.from("workspace_relationships").select("child_workspace_id").eq("relationship_type", "reseller_client"),
        sb.from("workspace_white_label_settings").select("workspace_id"),
        sb.from("workspace_members").select("workspace_id, user_id, role").eq("role", "owner"),
      ]);
    if (wErr) throw new Error(wErr.message);
    const subByWs = new Map<string, any>((subs ?? []).map((s: any) => [s.workspace_id, s]));
    const childSet = new Set<string>((rels ?? []).map((r: any) => r.child_workspace_id));
    const wlSet = new Set<string>((wl ?? []).map((w: any) => w.workspace_id));
    const ownerSet = new Set<string>((members ?? []).map((m: any) => m.workspace_id));

    const report = (wss ?? []).map((ws: any) => {
      const sub = subByWs.get(ws.id);
      const isWbah = isWbahWorkspaceId(ws.id);
      const hasOwner = ownerSet.has(ws.id) || !!ws.owner_id;
      return {
        workspaceId: ws.id,
        name: ws.name,
        isWbah,
        isResellerChild: childSet.has(ws.id),
        hasWhiteLabel: wlSet.has(ws.id),
        hasOwner,
        currentPackageKey: sub?.package_key ?? null,
        subscriptionStatus: sub?.subscription_status ?? null,
        action: sub
          ? ("none" as const)
          : isWbah
            ? ("skipped_wbah" as const)
            : ("assign_legacy_full" as const),
        warning: !hasOwner ? "No owner found — review before changing access" : null,
      };
    });

    let appliedCount = 0;
    if (apply) {
      const toInsert = report.filter((r: any) => r.action === "assign_legacy_full");
      if (toInsert.length > 0) {
        const now = new Date().toISOString();
        const { error } = await sb.from("workspace_subscriptions").upsert(
          toInsert.map((r: any) => ({
            workspace_id: r.workspaceId,
            package_key: LEGACY_PACKAGE_KEY,
            subscription_status: "active",
            updated_at: now,
          })),
          { onConflict: "workspace_id", ignoreDuplicates: true },
        );
        if (error) throw new Error(error.message);
        appliedCount = toInsert.length;
        for (const r of toInsert) invalidateEntitlementsCache(r.workspaceId);
      }
      await writeAccessAudit({
        workspaceId: null as any,
        actingUserId: context.userId,
        objectType: "package_migration",
        objectId: "package_migration_run",
        actionType: "apply",
        afterState: {
          total: report.length,
          assigned: appliedCount,
          skippedWbah: report.filter((r: any) => r.action === "skipped_wbah").length,
        },
        riskLevel: "high",
      });
    }

    return {
      applied: apply,
      appliedCount,
      totals: {
        workspaces: report.length,
        withSubscription: report.filter((r: any) => r.action === "none").length,
        needingAssignment: report.filter((r: any) => r.action === "assign_legacy_full").length,
        wbahSkipped: report.filter((r: any) => r.isWbah).length,
        missingOwner: report.filter((r: any) => !r.hasOwner).length,
      },
      rows: report,
    };
  });
