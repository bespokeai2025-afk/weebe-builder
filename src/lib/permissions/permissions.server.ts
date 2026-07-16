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
  SIGNAL_PERMISSIONS,
  bumpCacheSignal,
  checkCacheSignal,
} from "@/lib/packages/cache-signals.server";
import {
  type ActionKey,
  type PageKey,
  type PageLevel,
  type RolePermissions,
  NO_ACCESS,
  defaultsForRoleKey,
  legacyRoleToRoleKey,
  mergeRolePermissions,
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

// ── Short in-process cache (resolver runs on nearly every server fn) ────────
// Guarded by the shared "permissions" DB signal so role edits on ANY instance
// reach every other instance within ~5s instead of the full TTL.
const CACHE_TTL_MS = 30_000;
const permCache = new Map<
  string,
  { at: number; signal: number | null; value: ResolvedPermissions }
>();

/**
 * Drop cached resolved permissions. When `broadcast` (default) also bumps the
 * shared DB signal so OTHER instances drop ALL their cached entries promptly
 * (coarse but safe — role/permission writes are rare and rebuilds are cheap).
 * Pass a workspaceId to only clear that workspace's entries locally.
 */
export function invalidatePermissionsCache(
  workspaceId?: string,
  opts?: { broadcast?: boolean },
) {
  if (workspaceId) {
    for (const key of permCache.keys()) {
      if (key.startsWith(`${workspaceId}:`)) permCache.delete(key);
    }
  } else {
    permCache.clear();
  }
  if (opts?.broadcast !== false) void bumpCacheSignal(SIGNAL_PERMISSIONS);
}

/**
 * Resolve the effective permissions of a user inside a workspace.
 * NEVER throws — returns NO_ACCESS on any error (fail closed).
 * Successful member resolutions are cached briefly (TTL + shared signal);
 * NO_ACCESS results are never cached so new members/recoveries apply instantly.
 */
export async function resolvePermissions(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): Promise<ResolvedPermissions> {
  if (!workspaceId || !userId) return NO_ACCESS_RESOLVED;
  const cacheKey = `${workspaceId}:${userId}`;
  const signal = await checkCacheSignal(SIGNAL_PERMISSIONS);
  const hit = permCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.signal === signal) {
    return hit.value;
  }
  try {
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
    const value: ResolvedPermissions = {
      ...merged,
      legacyRole: member.role ?? null,
      isMember: true,
    };
    permCache.set(cacheKey, { at: Date.now(), signal, value });
    return value;
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

/**
 * Throw unless the user holds the given high-risk action grant, the workspace
 * package includes it, AND no per-user Team Access override removes it.
 * Delegates to the override-aware entitlement guard so ALL call sites resolve
 * the merged role ∩ package ∩ per-user-override result (fail closed) and an
 * access-denied audit entry is written on refusal.
 */
export async function requireAction(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  action: ActionKey,
): Promise<ResolvedPermissions> {
  // Dynamic import avoids a static circular dependency.
  const { requireActionAccess } = await import("@/lib/packages/entitlements.server");
  return requireActionAccess(workspaceId, userId, action);
}

/**
 * Throw unless the user has at least `level` access to `page` after merging
 * role, package cap AND per-user Team Access overrides (fail closed, audited).
 */
export async function requirePageAccess(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  page: PageKey,
  level: PageLevel,
): Promise<ResolvedPermissions> {
  const { requirePageAccessEntitled } = await import("@/lib/packages/entitlements.server");
  return requirePageAccessEntitled(workspaceId, userId, page, level);
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
