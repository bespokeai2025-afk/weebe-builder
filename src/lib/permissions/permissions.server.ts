/**
 * Team Access (RBAC) — server-side resolver + guards.
 *
 * Fail-closed invariants:
 *   • Any lookup/merge error → NO_ACCESS (never grants more access on failure).
 *   • Non-members → NO_ACCESS.
 *   • Platform admins (profiles.user_type = 'admin') are NOT special-cased
 *     here — the platform-admin guard is a separate layer.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type ActionKey,
  type PageKey,
  type PageLevel,
  type RolePermissions,
  ACTION_LABELS,
  PAGE_LABELS,
  NO_ACCESS,
  defaultsForRoleKey,
  legacyRoleToRoleKey,
  mergeRolePermissions,
  hasAction,
  hasPageAccess,
} from "./permissions.shared";

export interface ResolvedPermissions extends RolePermissions {
  /** underlying workspace_members.role (owner/admin/member) or null */
  legacyRole: string | null;
  isMember: boolean;
}

const NO_ACCESS_RESOLVED: ResolvedPermissions = {
  ...NO_ACCESS,
  legacyRole: null,
  isMember: false,
};

/**
 * Resolve the effective permissions of a user inside a workspace.
 * NEVER throws — returns NO_ACCESS on any error (fail closed).
 */
export async function resolvePermissions(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): Promise<ResolvedPermissions> {
  try {
    if (!workspaceId || !userId) return NO_ACCESS_RESOLVED;
    const sb = supabaseAdmin as any;

    const [{ data: member, error: memberErr }, { data: extRole, error: extErr }] =
      await Promise.all([
        sb.from("workspace_members")
          .select("role")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .maybeSingle(),
        sb.from("workspace_member_roles")
          .select("role_key")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
    if (memberErr || extErr) return NO_ACCESS_RESOLVED;
    if (!member) return NO_ACCESS_RESOLVED;

    // Extended role assignment wins; otherwise map legacy role.
    let roleKey: string = extRole?.role_key || legacyRoleToRoleKey(member.role);
    // Defense-in-depth: role_key "owner" only counts when the underlying
    // workspace_members.role is actually "owner" — otherwise a rogue
    // workspace_member_roles row would grant owner-equivalent permissions.
    if (roleKey === "owner" && member.role !== "owner") {
      roleKey = legacyRoleToRoleKey(member.role);
    }

    // Workspace override for that role (if any).
    const { data: override, error: ovErr } = await sb
      .from("workspace_role_permissions")
      .select("page_access, action_access, assigned_records_only")
      .eq("workspace_id", workspaceId)
      .eq("role_key", roleKey)
      .maybeSingle();
    if (ovErr) return NO_ACCESS_RESOLVED;

    const merged = mergeRolePermissions(defaultsForRoleKey(roleKey), override);
    return { ...merged, legacyRole: member.role ?? null, isMember: true };
  } catch {
    return NO_ACCESS_RESOLVED;
  }
}

export class PermissionDeniedError extends Error {
  readonly requiredPermission: string;
  constructor(requiredPermission: string, message: string) {
    super(message);
    this.name = "PermissionDeniedError";
    this.requiredPermission = requiredPermission;
  }
}

/** Throw unless the user holds the given high-risk action grant. */
export async function requireAction(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  action: ActionKey,
): Promise<ResolvedPermissions> {
  const p = await resolvePermissions(workspaceId, userId);
  if (!hasAction(p, action)) {
    throw new PermissionDeniedError(
      action,
      `Permission denied: your role (${p.roleKey}) does not include "${ACTION_LABELS[action]}". Ask a workspace owner or admin to grant the "${action}" permission.`,
    );
  }
  return p;
}

/** Throw unless the user has at least `level` access to `page`. */
export async function requirePageAccess(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  page: PageKey,
  level: PageLevel,
): Promise<ResolvedPermissions> {
  const p = await resolvePermissions(workspaceId, userId);
  if (!hasPageAccess(p, page, level)) {
    throw new PermissionDeniedError(
      `${page}:${level}`,
      `Permission denied: your role (${p.roleKey}) does not have "${level}" access to ${PAGE_LABELS[page]}.`,
    );
  }
  return p;
}

/** Convenience: is the user an owner/admin (legacy) of the workspace? */
export function isOwnerOrAdmin(p: ResolvedPermissions): boolean {
  return p.legacyRole === "owner" || p.legacyRole === "admin";
}

/** Best-effort audit-log write. Never throws. */
export async function writeAccessAudit(entry: {
  workspaceId: string;
  actingUserId?: string | null;
  targetUserId?: string | null;
  objectType: string;
  objectId?: string | null;
  actionType: string;
  beforeState?: unknown;
  afterState?: unknown;
  riskLevel?: "low" | "medium" | "high";
}): Promise<void> {
  try {
    await (supabaseAdmin as any).from("workspace_access_audit_logs").insert({
      workspace_id: entry.workspaceId,
      acting_user_id: entry.actingUserId ?? null,
      target_user_id: entry.targetUserId ?? null,
      object_type: entry.objectType,
      object_id: entry.objectId ?? null,
      action_type: entry.actionType,
      before_state: entry.beforeState ?? null,
      after_state: entry.afterState ?? null,
      risk_level: entry.riskLevel ?? "low",
    });
  } catch (err: any) {
    console.warn("[access-audit] write failed (non-fatal):", err?.message ?? err);
  }
}
