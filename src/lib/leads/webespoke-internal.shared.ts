/**
 * Who may use the AI Sales Assistant.
 *
 * The assistant pitches WEBEE itself, so it only makes sense for WeBespoke's own team selling the
 * product. In a customer workspace it would be nonsense — Avenue Elite sell property to their
 * leads, not conversational AI — so it is hidden there rather than left as a confusing button.
 *
 * Gate is platform admin OR a WeBespoke-owned workspace: sales@webespokeai.com is deliberately
 * `user_type = "user"`, so an admin-only check would lock out the people who actually sell.
 * Import-light on purpose, following wbah-exclusion.shared.ts.
 */

/** WeBespoke's own workspaces — the admin workspace plus the sales team's. */
export const WEBESPOKE_INTERNAL_WORKSPACE_IDS = [
  "c13db1d5-22e4-44ad-b678-6f296c31a947", // admin's Workspace (admin@webespokeai.com)
  "8288f37e-5abf-458c-bde3-2a49c6a89691", // webespokeai sales
  "4f4a7938-077a-431c-9b45-64613b5574a8", // Webespoke ai sales
  "e2fbf7da-aee8-424b-9395-7e33381f05d0", // sales's Workspace
] as const;

export function isWebespokeInternalWorkspace(workspaceId: string | null | undefined): boolean {
  return (WEBESPOKE_INTERNAL_WORKSPACE_IDS as readonly string[]).includes(
    String(workspaceId ?? ""),
  );
}

/** Whether this user, in this workspace, may generate WEBEE sales material. */
export function canUseSalesAssistant(args: {
  workspaceId: string | null | undefined;
  userType: string | null | undefined;
}): boolean {
  if (String(args.userType ?? "").toLowerCase() === "admin") return true;
  return isWebespokeInternalWorkspace(args.workspaceId);
}

export function assertSalesAssistantAccess(args: {
  workspaceId: string | null | undefined;
  userType: string | null | undefined;
}): void {
  if (!canUseSalesAssistant(args)) {
    throw new Error(
      "The AI Sales Assistant is only available to the WeBespoke team — it generates pitches for WEBEE itself.",
    );
  }
}
