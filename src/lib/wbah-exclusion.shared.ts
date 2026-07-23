/**
 * WBAH (We Buy Any House) workspace exclusion.
 *
 * The WBAH workspace is fully excluded from the saved page-filters system and
 * the automatic campaign-reports system (its pages use their own live-CRM
 * views). This module is import-light on purpose (NO "@/" imports) so it can
 * be pulled in via relative imports from vite-config-loaded modules like the
 * campaign executor and report-writer.shared.ts.
 */

export const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

export function isWbahWorkspaceId(workspaceId: string | null | undefined): boolean {
  return workspaceId === WBAH_WORKSPACE_ID;
}

/** Throws unless the user's active workspace is WBAH — use at WBAH server entry points. */
export function requireActiveWbahWorkspace(workspaceId: string | null | undefined): void {
  if (!isWbahWorkspaceId(workspaceId)) {
    throw new Error("Switch to the Webuyanyhouse workspace to use WBAH features.");
  }
}

/** Throws if the workspace is WBAH — use at generic client server entry points. */
export function assertNotWbahWorkspace(workspaceId: string | null | undefined): void {
  if (isWbahWorkspaceId(workspaceId)) {
    throw new Error("This feature is not available for the WBAH workspace.");
  }
}
