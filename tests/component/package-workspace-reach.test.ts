/**
 * How many workspaces a package edit reaches.
 *
 * Background: the trial package was widened in the admin matrix to unblock one sales account, then
 * reverted. Both actions silently re-governed every workspace with no subscription row, because
 * package resolution fails closed to DEFAULT_PACKAGE_KEY rather than granting nothing. The matrix
 * displayed no count at all, so the blast radius was invisible.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_PACKAGE_KEY, packageWorkspaceReach } from "@/lib/packages/packages.shared";

describe("packageWorkspaceReach", () => {
  it("counts unsubscribed workspaces against the default package", () => {
    // The number that matters: 3 explicit subscribers, but 137 more inherit it.
    expect(
      packageWorkspaceReach({
        packageKey: DEFAULT_PACKAGE_KEY,
        subscribedCount: 3,
        unsubscribedCount: 137,
      }),
    ).toEqual({ workspaceCount: 140, inheritsUnsubscribed: true });
  });

  it("does not attribute unsubscribed workspaces to any other package", () => {
    expect(
      packageWorkspaceReach({
        packageKey: "legacy_full",
        subscribedCount: 1,
        unsubscribedCount: 137,
      }),
    ).toEqual({ workspaceCount: 1, inheritsUnsubscribed: false });
  });

  it("still reports the inherited workspaces when nobody is explicitly subscribed", () => {
    // This is the live state: package_definitions is empty and no sales
    // workspace has a subscription row, so trial reads as 0 subscribers while
    // governing everything.
    expect(
      packageWorkspaceReach({
        packageKey: DEFAULT_PACKAGE_KEY,
        subscribedCount: 0,
        unsubscribedCount: 137,
      }).workspaceCount,
    ).toBe(137);
  });

  it("reports zero reach for an unused non-default package", () => {
    expect(
      packageWorkspaceReach({
        packageKey: "receptionist_pro",
        subscribedCount: 0,
        unsubscribedCount: 137,
      }).workspaceCount,
    ).toBe(0);
  });

  it("never returns a negative count", () => {
    expect(
      packageWorkspaceReach({
        packageKey: DEFAULT_PACKAGE_KEY,
        subscribedCount: -5,
        unsubscribedCount: -5,
      }).workspaceCount,
    ).toBe(0);
  });

  it("keys off the real default, so changing it moves the inheritance", () => {
    // Guards the assumption rather than hardcoding "trial" in the rule.
    expect(
      packageWorkspaceReach({
        packageKey: DEFAULT_PACKAGE_KEY,
        subscribedCount: 0,
        unsubscribedCount: 1,
      }).inheritsUnsubscribed,
    ).toBe(true);
  });
});

/**
 * The state that actually locked the sales team out.
 *
 * On 2026-09-17 the trial override was saved with every feature enabled, every page set to
 * `manage`, and `action_access_json` all false. Because an action cap is `explicit ?? feature`, the
 * explicit false won: the package advertised full access while denying `user_management` and
 * `lead_assignment` to an owner. The matrix showed no sign of the contradiction.
 */
describe("action cap vs feature contradiction", () => {
  const ACTION_FEATURE: Record<string, string> = {
    user_management: "team_access",
    lead_assignment: "leads",
    campaign_activation: "campaigns",
  };

  /** The editor's rule for flagging an action denied despite its feature. */
  function contradicted(
    features: Record<string, boolean>,
    actionCaps: Record<string, boolean>,
  ): string[] {
    return Object.keys(ACTION_FEATURE).filter(
      (k) => actionCaps[k] === false && features[ACTION_FEATURE[k]] === true,
    );
  }

  it("flags the exact state that denied the sales owner", () => {
    const features = { team_access: true, leads: true, campaigns: true };
    const actionCaps = {
      user_management: false,
      lead_assignment: false,
      campaign_activation: false,
    };
    expect(contradicted(features, actionCaps).sort()).toEqual([
      "campaign_activation",
      "lead_assignment",
      "user_management",
    ]);
  });

  it("does not flag an action denied because its feature is off too", () => {
    // Coherent: no feature, no action. That is a package tier, not a mistake.
    expect(contradicted({ team_access: false }, { user_management: false })).toEqual([]);
  });

  it("does not flag an action that is allowed", () => {
    expect(contradicted({ team_access: true }, { user_management: true })).toEqual([]);
  });

  it("does not flag an unset cap, which inherits the feature", () => {
    // An absent key means "derive from the feature" — not a denial.
    expect(contradicted({ team_access: true }, {})).toEqual([]);
  });
});
