/**
 * Server functions for package entitlements, staff seats, add-ons and
 * per-user access overrides (Team Access).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAccessAudit } from "@/lib/permissions/permissions.server";
import {
  ACTION_KEYS,
  PAGE_KEYS,
  PAGE_LEVELS,
} from "@/lib/permissions/permissions.shared";
import {
  ADDON_CATALOG,
  ADDON_EXTRA_STAFF_USER,
  PACKAGE_CATALOG,
  addonByKey,
} from "./packages.shared";
import {
  getStaffSeatUsage,
  getWorkspaceEntitlements,
  invalidateEntitlementsCache,
  requireActionAccess,
  resolveEffectiveAccess,
} from "./entitlements.server";

/** Effective access for the signed-in user: role ∩ package ∩ user overrides. */
export const getMyEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, workspaceId } = context;
    const [eff, seats] = await Promise.all([
      resolveEffectiveAccess(workspaceId, userId),
      workspaceId ? getStaffSeatUsage(workspaceId) : Promise.resolve(null),
    ]);
    return {
      roleKey: eff.roleKey,
      legacyRole: eff.legacyRole,
      isMember: eff.isMember,
      pageAccess: eff.pageAccess,
      actionAccess: eff.actionAccess,
      assignedRecordsOnly: eff.assignedRecordsOnly,
      entitlements: eff.entitlements,
      seatUsage: seats,
    };
  });

/** Package catalog + current workspace package (for the billing page). */
export const getWorkspacePackageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const [ent, seats, { data: addons }] = await Promise.all([
      getWorkspaceEntitlements(workspaceId),
      getStaffSeatUsage(workspaceId),
      (supabaseAdmin as any)
        .from("workspace_addons")
        .select("addon_key, addon_name, quantity, status, updated_at")
        .eq("workspace_id", workspaceId),
    ]);
    const eff = await resolveEffectiveAccess(workspaceId, userId);
    return {
      entitlements: ent,
      seatUsage: seats,
      addons: addons ?? [],
      addonCatalog: ADDON_CATALOG,
      canManageBilling: eff.actionAccess.billing === true,
      packages: PACKAGE_CATALOG.filter(
        (p) => p.isActive && p.packageKey !== "legacy_full",
      ).map((p) => ({
        packageKey: p.packageKey,
        packageName: p.packageName,
        description: p.description,
        monthlyPricePence: p.monthlyPricePence,
        includedStaffUsers: p.limits.includedStaffUsers,
      })),
    };
  });

/** Set the quantity of a chargeable add-on (currently extra_staff_user). */
export const setAddonQuantity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { addonKey: string; quantity: number }) => input)
  .handler(async ({ context, data }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireActionAccess(workspaceId, userId, "billing");

    const addon = addonByKey(data.addonKey);
    if (!addon) throw new Error("Unknown add-on");
    const quantity = Math.floor(Number(data.quantity));
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 500) {
      throw new Error("Quantity must be between 0 and 500");
    }

    // Reducing seats below current usage is blocked (spec: seats in use).
    if (addon.addonKey === ADDON_EXTRA_STAFF_USER) {
      const usage = await getStaffSeatUsage(workspaceId);
      const newAllowance = usage.includedStaffUsers + quantity;
      if (newAllowance < usage.used) {
        throw new Error(
          `Cannot reduce to ${quantity} extra seat${quantity === 1 ? "" : "s"}: ${usage.used} seats are in use (members + pending invites). Remove members or revoke invites first.`,
        );
      }
    }

    const sb = supabaseAdmin as any;
    const { data: before } = await sb
      .from("workspace_addons")
      .select("quantity, status")
      .eq("workspace_id", workspaceId)
      .eq("addon_key", addon.addonKey)
      .maybeSingle();

    const { error } = await sb.from("workspace_addons").upsert(
      {
        workspace_id: workspaceId,
        addon_key: addon.addonKey,
        addon_name: addon.addonName,
        quantity,
        status: quantity > 0 ? "active" : "cancelled",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,addon_key" },
    );
    if (error) throw new Error(error.message);
    invalidateEntitlementsCache(workspaceId);

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "addon",
      objectId: addon.addonKey,
      actionType: "addon_quantity_change",
      beforeState: before ?? null,
      afterState: { quantity, monthlyPricePence: addon.monthlyPricePence },
      riskLevel: "medium",
    });

    return { ok: true as const, quantity, seatUsage: await getStaffSeatUsage(workspaceId) };
  });

// ── Per-user access overrides (Team Access) ─────────────────────────────────

function sanitizePageMap(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (
      (PAGE_KEYS as readonly string[]).includes(k) &&
      typeof v === "string" &&
      (PAGE_LEVELS as readonly string[]).includes(v)
    ) {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeActionMap(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((ACTION_KEYS as readonly string[]).includes(k) && typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** List per-user overrides for the workspace (Team Access UI). */
export const listUserAccessOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireActionAccess(workspaceId, userId, "user_management");
    const { data, error } = await (supabaseAdmin as any)
      .from("workspace_user_access_overrides")
      .select("user_id, page_access_json, action_access_json, record_visibility_json, updated_at")
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Create/update a per-user visibility override. Owners cannot be restricted. */
export const setUserAccessOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      targetUserId: string;
      pageAccess?: Record<string, string>;
      actionAccess?: Record<string, boolean>;
      assignedRecordsOnly?: boolean;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireActionAccess(workspaceId, userId, "user_management");

    const sb = supabaseAdmin as any;
    const { data: target, error: tErr } = await sb
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!target) throw new Error("That user is not a member of this workspace");
    if (target.role === "owner") throw new Error("Workspace owner access cannot be restricted");

    const pageAccess = sanitizePageMap(data.pageAccess);
    const actionAccess = sanitizeActionMap(data.actionAccess);
    const recordVisibility =
      typeof data.assignedRecordsOnly === "boolean"
        ? { assignedRecordsOnly: data.assignedRecordsOnly }
        : {};

    const { data: before } = await sb
      .from("workspace_user_access_overrides")
      .select("page_access_json, action_access_json, record_visibility_json")
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId)
      .maybeSingle();

    const { error } = await sb.from("workspace_user_access_overrides").upsert(
      {
        workspace_id: workspaceId,
        user_id: data.targetUserId,
        page_access_json: pageAccess,
        action_access_json: actionAccess,
        record_visibility_json: recordVisibility,
        created_by_user_id: before ? undefined : userId,
        updated_by_user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    );
    if (error) throw new Error(error.message);

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      targetUserId: data.targetUserId,
      objectType: "user_access_override",
      objectId: data.targetUserId,
      actionType: before ? "update" : "create",
      beforeState: before ?? null,
      afterState: { pageAccess, actionAccess, recordVisibility },
      riskLevel: "medium",
    });

    return { ok: true as const };
  });

/** Remove a per-user override (revert to role + package defaults). */
export const clearUserAccessOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetUserId: string }) => input)
  .handler(async ({ context, data }) => {
    const { userId, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireActionAccess(workspaceId, userId, "user_management");
    const { data: before } = await (supabaseAdmin as any)
      .from("workspace_user_access_overrides")
      .select("page_access_json, action_access_json, record_visibility_json")
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId)
      .maybeSingle();
    const { error } = await (supabaseAdmin as any)
      .from("workspace_user_access_overrides")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId);
    if (error) throw new Error(error.message);
    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      targetUserId: data.targetUserId,
      objectType: "user_access_override",
      objectId: data.targetUserId,
      actionType: "delete",
      beforeState: before ?? null,
      riskLevel: "medium",
    });
    return { ok: true as const };
  });
