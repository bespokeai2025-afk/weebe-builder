/**
 * Package / entitlement resolver + guards (server only).
 *
 * Fail-closed invariants (spec §18):
 *   • Any lookup ERROR → noEntitlements() (only settings/team/billing reachable,
 *     and only if the user's role also allows it).
 *   • No subscription row → TRIAL entitlements (fail closed). Existing
 *     workspaces are backfilled with explicit legacy_full rows by
 *     scripts/backfill-workspace-packages.mjs BEFORE this code takes effect.
 *   • Suspended/cancelled subscription → trial-level access.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type FeatureKey,
  type WorkspaceEntitlements,
  ADDON_EXTRA_STAFF_USER,
  DEFAULT_PACKAGE_KEY,
  FEATURE_LABELS,
  LEGACY_PACKAGE_KEY,
  buildEntitlements,
  noEntitlements,
  packageByKey,
  capPageLevel,
} from "./packages.shared";
import {
  type ActionKey,
  type PageKey,
  type PageLevel,
  type RolePermissions,
  ACTION_KEYS,
  ACTION_LABELS,
  PAGE_KEYS,
  PAGE_LABELS,
  PAGE_LEVELS,
  pageLevelRank,
} from "@/lib/permissions/permissions.shared";
import {
  resolvePermissions,
  PermissionDeniedError,
  writeAccessAudit,
} from "@/lib/permissions/permissions.server";
import {
  SIGNAL_ENTITLEMENTS,
  bumpCacheSignal,
  checkCacheSignal,
} from "./cache-signals.server";

export class FeatureLockedError extends Error {
  readonly featureKey: string;
  readonly kind = "feature_locked";
  constructor(featureKey: string, message: string) {
    super(message);
    this.name = "FeatureLockedError";
    this.featureKey = featureKey;
  }
}

// ── Short in-process cache (entitlements change rarely; guards run often) ────
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; signal: number | null; value: WorkspaceEntitlements }>();

/**
 * Drop cached entitlements. When `broadcast` (default) also bumps the shared
 * DB signal so OTHER instances drop ALL their cached entitlements promptly
 * (coarse but safe — entitlement writes are rare and rebuilds are cheap).
 */
export function invalidateEntitlementsCache(workspaceId?: string, opts?: { broadcast?: boolean }) {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
  if (opts?.broadcast !== false) void bumpCacheSignal(SIGNAL_ENTITLEMENTS);
}

/** Package row for a workspace (subscription + resolved package def). */
export async function getWorkspacePackage(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data: sub, error } = await sb
    .from("workspace_subscriptions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const { packageByKeyServer } = await import("./packages-catalog.server");
  const pkg = await packageByKeyServer(sub ? sub.package_key : DEFAULT_PACKAGE_KEY);
  return { subscription: sub ?? null, packageDef: pkg };
}

/**
 * Resolve workspace entitlements. NEVER throws — returns noEntitlements()
 * on error (fail closed) and legacy-full when no subscription row exists.
 */
export async function getWorkspaceEntitlements(
  workspaceId: string | null | undefined,
): Promise<WorkspaceEntitlements> {
  if (!workspaceId) return noEntitlements();
  const signal = await checkCacheSignal(SIGNAL_ENTITLEMENTS);
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.signal === signal) return hit.value;
  try {
    const sb = supabaseAdmin as any;
    const [{ data: sub, error: subErr }, { data: addons, error: addErr }, { data: feats, error: featErr }] =
      await Promise.all([
        sb.from("workspace_subscriptions").select("package_key, subscription_status, trial_ends_at")
          .eq("workspace_id", workspaceId).maybeSingle(),
        sb.from("workspace_addons").select("addon_key, quantity, status")
          .eq("workspace_id", workspaceId),
        sb.from("workspace_feature_entitlements").select("feature_key, enabled, source")
          .eq("workspace_id", workspaceId),
      ]);
    if (subErr || addErr || featErr) return noEntitlements();

    // No row → lowest safe package (spec §10 — never full access by default).
    // Pre-gating workspaces get explicit legacy_full rows via the backfill script.
    let packageKey: string = sub?.package_key ?? DEFAULT_PACKAGE_KEY;
    let status: WorkspaceEntitlements["subscriptionStatus"] = sub
      ? (sub.subscription_status as any)
      : "none";

    // Cancelled/suspended paid packages degrade to trial (never fail open).
    if (sub && (status === "cancelled" || status === "suspended")) {
      packageKey = DEFAULT_PACKAGE_KEY;
    }
    // Expired trials keep trial features (trial IS the lowest package).

    const extraSeats = (addons ?? [])
      .filter((a: any) => a.addon_key === ADDON_EXTRA_STAFF_USER && a.status === "active")
      .reduce((n: number, a: any) => n + Number(a.quantity ?? 0), 0);

    // admin_override rows win over addon rows; both win over package defaults.
    const featureOverrides: Record<string, boolean> = {};
    for (const src of ["addon", "admin_override"]) {
      for (const f of feats ?? []) {
        if (f.source === src) featureOverrides[f.feature_key] = f.enabled === true;
      }
    }

    const { packageByKeyServer } = await import("./packages-catalog.server");
    const value = buildEntitlements(await packageByKeyServer(packageKey), {
      subscriptionStatus: status,
      extraStaffSeats: extraSeats,
      featureOverrides,
    });
    cache.set(workspaceId, { at: Date.now(), signal, value });
    return value;
  } catch {
    return noEntitlements();
  }
}

// ── Combined role × package resolution ──────────────────────────────────────

export interface EffectiveAccess extends RolePermissions {
  legacyRole: string | null;
  isMember: boolean;
  entitlements: WorkspaceEntitlements;
}

/** Sanitize a per-user override page/action map (unknown keys dropped). */
function sanitizeUserOverride(raw: unknown, validKeys: readonly string[], validVals?: readonly string[]) {
  const out: Record<string, any> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!validKeys.includes(k)) continue;
    if (validVals) { if (typeof v === "string" && validVals.includes(v)) out[k] = v; }
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * Resolve effective access = role permissions ∩ package caps ∩ per-user overrides.
 * Per-user overrides can only RESTRICT below role level, never raise above the
 * package cap (they may raise above role level within the cap — owner grants).
 * NEVER throws — fail closed.
 */
export async function resolveEffectiveAccess(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): Promise<EffectiveAccess> {
  const [perms, ent] = await Promise.all([
    resolvePermissions(workspaceId, userId),
    getWorkspaceEntitlements(workspaceId),
  ]);
  let pageAccess = { ...perms.pageAccess };
  let actionAccess = { ...perms.actionAccess };
  try {
    if (workspaceId && userId && perms.isMember) {
      const { data: ov } = await (supabaseAdmin as any)
        .from("workspace_user_access_overrides")
        .select("page_access_json, action_access_json, record_visibility_json")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (ov) {
        const pageOv = sanitizeUserOverride(ov.page_access_json, PAGE_KEYS, PAGE_LEVELS);
        const actOv = sanitizeUserOverride(ov.action_access_json, ACTION_KEYS);
        // Owner's underlying role can never be overridden down by a staff admin.
        if (perms.legacyRole !== "owner") {
          pageAccess = { ...pageAccess, ...pageOv };
          actionAccess = { ...actionAccess, ...actOv };
          const rv = ov.record_visibility_json as any;
          if (rv && typeof rv === "object" && typeof rv.assignedRecordsOnly === "boolean") {
            perms.assignedRecordsOnly = rv.assignedRecordsOnly;
          }
        }
      }
    }
  } catch {
    // override lookup failure → keep role-level values (no widening occurred)
  }
  // Apply package caps last: nothing exceeds the package.
  for (const p of PAGE_KEYS) {
    pageAccess[p] = capPageLevel(pageAccess[p] ?? "hidden", ent.pageAccessCaps[p]);
  }
  for (const a of ACTION_KEYS) {
    actionAccess[a] = actionAccess[a] === true && ent.actionCaps[a] === true;
  }
  return { ...perms, pageAccess, actionAccess, entitlements: ent };
}

// ── Guards ───────────────────────────────────────────────────────────────────

export async function canAccessFeature(
  workspaceId: string,
  _userId: string,
  featureKey: FeatureKey,
): Promise<boolean> {
  const ent = await getWorkspaceEntitlements(workspaceId);
  return ent.features[featureKey] === true;
}

/** Throw FeatureLockedError unless the workspace package includes the feature. */
export async function requireFeatureAccess(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  featureKey: FeatureKey,
): Promise<WorkspaceEntitlements> {
  const ent = await getWorkspaceEntitlements(workspaceId);
  if (ent.features[featureKey] !== true) {
    if (workspaceId) {
      writeAccessAudit({
        workspaceId,
        actingUserId: userId ?? null,
        objectType: "feature",
        objectId: featureKey,
        actionType: "feature_locked",
        afterState: { featureKey, packageKey: ent.packageKey },
        riskLevel: "low",
      });
    }
    throw new FeatureLockedError(
      featureKey,
      `This feature (${FEATURE_LABELS[featureKey]}) is not included in your current package. Upgrade your package to use it.`,
    );
  }
  return ent;
}

/** Role action grant AND package cap. */
export async function requireActionAccess(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  action: ActionKey,
): Promise<EffectiveAccess> {
  const eff = await resolveEffectiveAccess(workspaceId, userId);
  if (eff.actionAccess[action] !== true) {
    if (workspaceId) {
      writeAccessAudit({
        workspaceId,
        actingUserId: userId ?? null,
        objectType: "action",
        objectId: action,
        actionType: "action_denied",
        afterState: { action, packageKey: eff.entitlements.packageKey, roleKey: eff.roleKey },
        riskLevel: "medium",
      });
    }
    const cappedByPackage = eff.entitlements.actionCaps[action] !== true;
    throw new PermissionDeniedError(
      action,
      cappedByPackage
        ? `"${ACTION_LABELS[action]}" is not included in your current package.`
        : `Permission denied: your role (${eff.roleKey}) does not include "${ACTION_LABELS[action]}".`,
    );
  }
  return eff;
}

/** Role page level AND package cap. */
export async function requirePageAccessEntitled(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
  page: PageKey,
  level: PageLevel,
): Promise<EffectiveAccess> {
  const eff = await resolveEffectiveAccess(workspaceId, userId);
  if (pageLevelRank(eff.pageAccess[page] ?? "hidden") < pageLevelRank(level)) {
    if (workspaceId) {
      writeAccessAudit({
        workspaceId,
        actingUserId: userId ?? null,
        objectType: "page",
        objectId: page,
        actionType: "page_access_denied",
        afterState: { page, level, packageKey: eff.entitlements.packageKey, roleKey: eff.roleKey },
        riskLevel: "low",
      });
    }
    const cappedByPackage =
      pageLevelRank(eff.entitlements.pageAccessCaps[page]) < pageLevelRank(level);
    throw new PermissionDeniedError(
      `${page}:${level}`,
      cappedByPackage
        ? `${PAGE_LABELS[page]} is not included in your current package.`
        : `Permission denied: your role (${eff.roleKey}) does not have "${level}" access to ${PAGE_LABELS[page]}.`,
    );
  }
  return eff;
}

// ── Staff seats ───────────────────────────────────────────────────────────────

export interface StaffSeatUsage {
  allowance: number;
  activeMembers: number;
  pendingInvites: number;
  used: number;
  remaining: number;
  includedStaffUsers: number;
  extraSeats: number;
}

export async function getStaffSeatUsage(workspaceId: string): Promise<StaffSeatUsage> {
  const sb = supabaseAdmin as any;
  const [ent, { count: members, error: mErr }, { count: invites, error: iErr }] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    sb.from("workspace_members").select("user_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    sb.from("workspace_invites").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString()),
  ]);
  if (mErr || iErr) {
    // Fail closed: report zero remaining so invite paths block.
    return {
      allowance: 0, activeMembers: 0, pendingInvites: 0, used: 0, remaining: 0,
      includedStaffUsers: 0, extraSeats: 0,
    };
  }
  const activeMembers = members ?? 0;
  const pendingInvites = invites ?? 0;
  const used = activeMembers + pendingInvites;
  const allowance = ent.staffSeatAllowance;
  return {
    allowance,
    activeMembers,
    pendingInvites,
    used,
    remaining: Math.max(allowance - used, 0),
    includedStaffUsers: ent.limits.includedStaffUsers,
    extraSeats: allowance - ent.limits.includedStaffUsers,
  };
}

export async function canInviteStaff(workspaceId: string): Promise<boolean> {
  const usage = await getStaffSeatUsage(workspaceId);
  return usage.remaining > 0;
}

// ── Provisioning ─────────────────────────────────────────────────────────────

/**
 * Assign a package to a workspace (idempotent upsert). Used at signup/provision
 * time and by the backfill script. Best-effort audit; throws on write failure.
 */
export async function provisionWorkspacePackage(opts: {
  workspaceId: string;
  packageKey?: string;
  status?: "trial" | "active";
  actingUserId?: string | null;
  trialDays?: number;
}): Promise<void> {
  const packageKey = opts.packageKey ?? DEFAULT_PACKAGE_KEY;
  const status = opts.status ?? "trial";
  const trialEndsAt =
    status === "trial"
      ? new Date(Date.now() + (opts.trialDays ?? 14) * 86400_000).toISOString()
      : null;
  const { error } = await (supabaseAdmin as any)
    .from("workspace_subscriptions")
    .upsert(
      {
        workspace_id: opts.workspaceId,
        package_key: packageKey,
        subscription_status: status,
        trial_ends_at: trialEndsAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
  invalidateEntitlementsCache(opts.workspaceId);
  await seedNotificationDefaults(opts.workspaceId, packageKey);
  writeAccessAudit({
    workspaceId: opts.workspaceId,
    actingUserId: opts.actingUserId ?? null,
    objectType: "package",
    objectId: packageKey,
    actionType: "package_assigned",
    afterState: { packageKey, status },
    riskLevel: "medium",
  });
}

/**
 * Seed package default notification settings. Insert-only (ignoreDuplicates):
 * rows an admin already customised are NEVER overwritten. Best-effort.
 */
export async function seedNotificationDefaults(workspaceId: string, packageKey: string): Promise<void> {
  try {
    const { notificationDefaultsForPackageServer } = await import("@/lib/packages/packages-catalog.server");
    const defaults = await notificationDefaultsForPackageServer(packageKey);
    const entries = Object.entries(defaults);
    if (entries.length === 0) return;
    const now = new Date().toISOString();
    const rows = entries.map(([eventKey, d]) => ({
      workspace_id: workspaceId,
      event_key: eventKey,
      enabled: d.enabled !== false,
      email_enabled: d.emailEnabled === true,
      in_app_enabled: d.inAppEnabled !== false,
      recipients: { owner: true, admins: true, userIds: [], roleKeys: [], customEmails: [], campaignOwner: false },
      frequency: d.frequency ?? "immediate",
      updated_at: now,
    }));
    const { error } = await (supabaseAdmin as any)
      .from("workspace_notification_settings")
      .upsert(rows, { onConflict: "workspace_id,event_key", ignoreDuplicates: true });
    if (error) console.warn("[packages] notification defaults seed failed (non-fatal):", error.message);
  } catch (err: any) {
    console.warn("[packages] notification defaults seed failed (non-fatal):", err?.message ?? err);
  }
}

/** Throw a clear seat-limit error unless a seat is available. */
export async function requireStaffSeat(workspaceId: string): Promise<StaffSeatUsage> {
  const usage = await getStaffSeatUsage(workspaceId);
  if (usage.remaining <= 0) {
    throw new FeatureLockedError(
      ADDON_EXTRA_STAFF_USER,
      `You have reached your included staff user limit (${usage.allowance} seat${usage.allowance === 1 ? "" : "s"}, ${usage.used} in use including pending invites). Add extra staff users to continue.`,
    );
  }
  return usage;
}

/**
 * Enforce package resource limits (agents / workflows / campaigns).
 * Counts current rows and throws a plain-language error when the package cap
 * is reached. `null` limits mean unlimited.
 */
export async function requireResourceCapacity(
  workspaceId: string,
  resource: "agents" | "workflows" | "campaigns",
): Promise<void> {
  const ent = await getWorkspaceEntitlements(workspaceId);
  const limit =
    resource === "agents"
      ? ent.limits.maxAgents
      : resource === "workflows"
        ? ent.limits.maxWorkflows
        : ent.limits.maxCampaigns;
  if (limit === null || limit === undefined) return;

  const table =
    resource === "agents"
      ? "agents"
      : resource === "workflows"
        ? "workspace_workflows"
        : "campaigns";
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (error) {
    // Fail closed: if we can't verify capacity we must not allow creation.
    console.warn(`[packages] capacity count failed for ${table}:`, error.message);
    throw new FeatureLockedError(
      resource,
      "We couldn't verify your package capacity just now. Please try again in a moment.",
    );
  }
  if ((count ?? 0) >= limit) {
    const noun =
      resource === "agents" ? "AI agent" : resource === "workflows" ? "workflow" : "campaign";
    throw new FeatureLockedError(
      resource,
      `Your package (${ent.packageName}) includes up to ${limit} ${noun}${limit === 1 ? "" : "s"}. Upgrade your package to add more.`,
    );
  }
}
