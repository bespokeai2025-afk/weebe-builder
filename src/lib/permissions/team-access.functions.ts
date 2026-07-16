/**
 * Team Access (RBAC) server functions — member list, role changes, removals,
 * per-role permission overrides, approval settings and the access audit log.
 *
 * Safety invariants:
 *   • All mutations require the `user_management` action grant (owners/admins
 *     by default) — resolved fail-closed.
 *   • Self-elevation is impossible: users can never change their own role.
 *   • Owners can only be modified by the workspace owner themselves? — No:
 *     the owner's membership row can never be demoted/removed here at all.
 *   • Everything is scoped to the caller's active workspace.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  invalidatePermissionsCache,
  requireAction,
  resolvePermissions,
  writeAccessAudit,
} from "./permissions.server";
import {
  ROLE_KEYS,
  PAGE_KEYS,
  PAGE_LEVELS,
  ACTION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  defaultsForRoleKey,
  mergeRolePermissions,
  legacyRoleToRoleKey,
  type RoleKey,
} from "./permissions.shared";

const sb = supabaseAdmin as any;

const ROLE_KEY_RE = /^[a-z0-9_]{2,40}$/;

/** Get the caller's own effective permissions (for UI gating). */
export const getMyPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    const p = await resolvePermissions(workspaceId, userId);
    return {
      roleKey: p.roleKey,
      legacyRole: p.legacyRole,
      isMember: p.isMember,
      pageAccess: p.pageAccess,
      actionAccess: p.actionAccess,
      assignedRecordsOnly: p.assignedRecordsOnly,
    };
  });

/** List members with their extended roles. Requires team_access view. */
export const listTeamMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");

    const [{ data: members, error }, { data: extRoles }] = await Promise.all([
      sb.from("workspace_members")
        .select("user_id, role, created_at")
        .eq("workspace_id", workspaceId),
      sb.from("workspace_member_roles")
        .select("user_id, role_key")
        .eq("workspace_id", workspaceId),
    ]);
    if (error) throw new Error(error.message);
    const extMap = new Map<string, string>((extRoles ?? []).map((r: any) => [r.user_id, r.role_key]));

    const userIds = (members ?? []).map((m: any) => m.user_id);
    const { data: profiles } = userIds.length
      ? await sb.from("profiles").select("user_id, email, full_name").in("user_id", userIds)
      : { data: [] };
    const profMap = new Map<string, any>((profiles ?? []).map((p: any) => [p.user_id, p]));

    return (members ?? []).map((m: any) => ({
      userId: m.user_id,
      legacyRole: m.role,
      roleKey: extMap.get(m.user_id) ?? legacyRoleToRoleKey(m.role),
      email: profMap.get(m.user_id)?.email ?? null,
      fullName: profMap.get(m.user_id)?.full_name ?? null,
      joinedAt: m.created_at,
      isSelf: m.user_id === userId,
    }));
  });

/** Change a member's extended role. Never self; never the workspace owner. */
export const setMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetUserId: string; roleKey: string }) => input)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "user_management");

    if (data.targetUserId === userId) {
      throw new Error("You cannot change your own role.");
    }
    if (!ROLE_KEY_RE.test(data.roleKey)) throw new Error("Invalid role key");
    // Owner is not assignable — ownership exists only via workspace_members.role.
    // Assigning role_key "owner" would be a privilege-escalation path because
    // resolvePermissions prefers role_key over the legacy role.
    if (data.roleKey === "owner") {
      throw new Error("The owner role cannot be assigned. Ownership transfer is not supported here.");
    }

    // Target must be a member of THIS workspace.
    const { data: target } = await sb
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId)
      .maybeSingle();
    if (!target) throw new Error("User is not a member of this workspace");
    if (target.role === "owner") throw new Error("The workspace owner's role cannot be changed.");

    // Custom role keys must have a workspace_role_permissions row (otherwise
    // the role would be fully locked with no way to see that in the UI).
    if (!(ROLE_KEYS as readonly string[]).includes(data.roleKey)) {
      const { data: roleRow } = await sb
        .from("workspace_role_permissions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("role_key", data.roleKey)
        .maybeSingle();
      if (!roleRow) throw new Error(`Unknown role "${data.roleKey}" — define its permissions first.`);
    }

    const { data: before } = await sb
      .from("workspace_member_roles")
      .select("role_key")
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId)
      .maybeSingle();

    const { error } = await sb.from("workspace_member_roles").upsert(
      {
        workspace_id: workspaceId,
        user_id: data.targetUserId,
        role_key: data.roleKey,
        assigned_by_user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    );
    if (error) throw new Error(error.message);

    // Keep the legacy enum roughly in sync for admin-tier roles.
    const legacyRole = data.roleKey === "admin" ? "admin" : "member";
    await sb
      .from("workspace_members")
      .update({ role: legacyRole })
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId)
      .neq("role", "owner");
    invalidatePermissionsCache(workspaceId);

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      targetUserId: data.targetUserId,
      objectType: "member_role",
      objectId: data.targetUserId,
      actionType: "update",
      beforeState: { roleKey: before?.role_key ?? legacyRoleToRoleKey(target.role) },
      afterState: { roleKey: data.roleKey },
      riskLevel: "high",
    });
    return { ok: true };
  });

/** Remove a member from the workspace. Never self; never the owner. */
export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { targetUserId: string }) => input)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "user_management");
    if (data.targetUserId === userId) throw new Error("You cannot remove yourself.");

    const { data: target } = await sb
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId)
      .maybeSingle();
    if (!target) throw new Error("User is not a member of this workspace");
    if (target.role === "owner") throw new Error("The workspace owner cannot be removed.");

    const { error } = await sb
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId);
    if (error) throw new Error(error.message);
    await sb
      .from("workspace_member_roles")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", data.targetUserId);
    invalidatePermissionsCache(workspaceId);

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      targetUserId: data.targetUserId,
      objectType: "member",
      objectId: data.targetUserId,
      actionType: "remove",
      beforeState: { role: target.role },
      riskLevel: "high",
    });
    return { ok: true };
  });

/** List effective role permission matrices (defaults merged with overrides). */
export const listRolePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");

    const { data: overrides, error } = await sb
      .from("workspace_role_permissions")
      .select("role_key, display_name, page_access, action_access, assigned_records_only")
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    const ovMap = new Map<string, any>((overrides ?? []).map((r: any) => [r.role_key, r]));

    const roleKeys = Array.from(
      new Set<string>([...ROLE_KEYS, ...(overrides ?? []).map((r: any) => r.role_key)]),
    );
    return roleKeys.map((roleKey) => {
      const ov = ovMap.get(roleKey);
      const merged = mergeRolePermissions(defaultsForRoleKey(roleKey), ov);
      return {
        roleKey,
        displayName: ov?.display_name ?? null,
        isBuiltIn: (ROLE_KEYS as readonly string[]).includes(roleKey),
        hasOverride: !!ov,
        pageAccess: merged.pageAccess,
        actionAccess: merged.actionAccess,
        assignedRecordsOnly: merged.assignedRecordsOnly,
      };
    });
  });

/** Create/update a per-role permission override for this workspace. */
export const upsertRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      roleKey: string;
      displayName?: string | null;
      pageAccess: Record<string, string>;
      actionAccess: Record<string, boolean>;
      assignedRecordsOnly: boolean;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const caller = await requireAction(workspaceId, userId, "user_management");
    if (!ROLE_KEY_RE.test(data.roleKey)) throw new Error("Invalid role key");
    if (data.roleKey === "owner") throw new Error("The Owner role cannot be restricted or edited.");
    // A non-owner admin cannot edit the admin role (self-elevation guard: you
    // can never change the permission set that applies to yourself).
    if (data.roleKey === caller.roleKey) {
      throw new Error("You cannot edit the permissions of your own role.");
    }

    const pageAccess: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.pageAccess ?? {})) {
      if ((PAGE_KEYS as readonly string[]).includes(k) && (PAGE_LEVELS as readonly string[]).includes(v)) {
        pageAccess[k] = v;
      }
    }
    const actionAccess: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(data.actionAccess ?? {})) {
      if ((ACTION_KEYS as readonly string[]).includes(k) && typeof v === "boolean") {
        actionAccess[k] = v;
      }
    }

    const { data: before } = await sb
      .from("workspace_role_permissions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("role_key", data.roleKey)
      .maybeSingle();

    const row = {
      workspace_id: workspaceId,
      role_key: data.roleKey,
      display_name: data.displayName?.slice(0, 100) ?? null,
      page_access: pageAccess,
      action_access: actionAccess,
      assigned_records_only: data.assignedRecordsOnly === true,
      is_system_default: false,
      updated_by_user_id: userId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb
      .from("workspace_role_permissions")
      .upsert(row, { onConflict: "workspace_id,role_key" });
    if (error) throw new Error(error.message);
    invalidatePermissionsCache(workspaceId);

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "role_permissions",
      objectId: data.roleKey,
      actionType: before ? "update" : "create",
      beforeState: before ?? null,
      afterState: row,
      riskLevel: "high",
    });
    return { ok: true };
  });

/** Reset a role back to code defaults (delete the override). */
export const resetRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roleKey: string }) => input)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const caller = await requireAction(workspaceId, userId, "user_management");
    if (data.roleKey === caller.roleKey) {
      throw new Error("You cannot edit the permissions of your own role.");
    }
    const { data: before } = await sb
      .from("workspace_role_permissions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("role_key", data.roleKey)
      .maybeSingle();
    if (!before) return { ok: true };
    const { error } = await sb
      .from("workspace_role_permissions")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("role_key", data.roleKey);
    if (error) throw new Error(error.message);
    invalidatePermissionsCache(workspaceId);
    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "role_permissions",
      objectId: data.roleKey,
      actionType: "reset",
      beforeState: before,
      riskLevel: "medium",
    });
    return { ok: true };
  });

// ── Approval settings ────────────────────────────────────────────────────────

export const APPROVAL_KEYS = [
  "go_live",
  "campaign_activation",
  "systemmind_changes",
  "phone_purchase",
  "provider_settings",
] as const;

export const getApprovalSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) throw new Error("Not a member of this workspace");
    const { data } = await sb
      .from("workspace_approval_settings")
      .select("settings")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const settings = (data?.settings ?? {}) as Record<string, { approverRoleKeys?: string[] }>;
    return APPROVAL_KEYS.map((key) => ({
      key,
      approverRoleKeys: settings[key]?.approverRoleKeys ?? ["owner", "admin"],
    }));
  });

export const updateApprovalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { settings: Record<string, { approverRoleKeys: string[] }> }) => input)
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "user_management");

    const clean: Record<string, { approverRoleKeys: string[] }> = {};
    for (const key of APPROVAL_KEYS) {
      const entry = data.settings?.[key];
      if (!entry) continue;
      const keys = (entry.approverRoleKeys ?? []).filter((k) => ROLE_KEY_RE.test(k)).slice(0, 20);
      // Owner always retains approval rights — never lockout.
      if (!keys.includes("owner")) keys.push("owner");
      clean[key] = { approverRoleKeys: keys };
    }

    const { data: before } = await sb
      .from("workspace_approval_settings")
      .select("settings")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const { error } = await sb.from("workspace_approval_settings").upsert(
      {
        workspace_id: workspaceId,
        settings: clean,
        updated_by_user_id: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error(error.message);

    await writeAccessAudit({
      workspaceId,
      actingUserId: userId,
      objectType: "approval_settings",
      actionType: before ? "update" : "create",
      beforeState: before?.settings ?? null,
      afterState: clean,
      riskLevel: "high",
    });
    return { ok: true };
  });

/** Read the access/notifications audit log (team_access viewers). */
export const listAccessAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { limit?: number }) => input ?? {})
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    await requireAction(workspaceId, userId, "user_management");
    const { data: rows, error } = await sb
      .from("workspace_access_audit_logs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 50, 200));
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
