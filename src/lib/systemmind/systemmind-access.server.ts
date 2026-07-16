/**
 * SystemMind access guards — every SystemMind server function funnels through
 * these so package (feature "systemmind"), role page level AND per-user Team
 * Access overrides are enforced uniformly (fail closed, audited).
 *
 * Levels used across SystemMind routes:
 *   • view  — read telemetry, lists, reports, drafts.
 *   • edit  — create/update drafts, tasks, settings (draft-only work).
 *   • systemmind_approval action — apply/approve/activate anything live.
 */
import {
  requireActionAccess,
  requirePageAccessEntitled,
  type EffectiveAccess,
} from "@/lib/packages/entitlements.server";

/** Read access to SystemMind (CTO) pages/data. */
export async function requireSystemMindView(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): Promise<EffectiveAccess> {
  return requirePageAccessEntitled(workspaceId, userId, "systemmind", "view");
}

/** Draft-level access: generate/edit drafts, tasks and settings (nothing goes live). */
export async function requireSystemMindEdit(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): Promise<EffectiveAccess> {
  return requirePageAccessEntitled(workspaceId, userId, "systemmind", "edit");
}

/** Approval/apply access: anything that activates, applies or approves live changes. */
export async function requireSystemMindApproval(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): Promise<EffectiveAccess> {
  return requireActionAccess(workspaceId, userId, "systemmind_approval");
}

/**
 * Draft-instead-of-apply helper: true when the user may draft (edit) but is
 * NOT allowed to apply/approve. Callers downgrade an "apply" request into a
 * draft + approval prompt instead of refusing outright.
 */
export async function canDraftButNotApply(
  workspaceId: string | null | undefined,
  userId: string | null | undefined,
): Promise<boolean> {
  try {
    const eff = await requireSystemMindEdit(workspaceId, userId);
    return eff.actionAccess.systemmind_approval !== true;
  } catch {
    return false;
  }
}
