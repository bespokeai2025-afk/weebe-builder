/**
 * Avenue Elite Properties workspace — the only workspace that runs Off-Plan
 * and Secondary BuzzChat campaigns alongside Listing Acquisition.
 *
 * Off-Plan / Secondary business concepts (Developer, SPA, Unit type, etc.)
 * are real-estate-specific and irrelevant noise for every other tenant, so
 * the campaign-type selector only offers them here. Listing Acquisition
 * stays available (and is the default) for all workspaces, unchanged.
 *
 * Import-light on purpose (no "@/" imports) so it stays safe to pull in from
 * relative-import-only modules, mirroring wbah-exclusion.shared.ts.
 */

export const AVENUE_ELITE_WORKSPACE_ID = "9bc09fc9-5841-40d6-94a8-d3074a15f988";

export function isAvenueEliteWorkspace(workspaceId: string | null | undefined): boolean {
  return workspaceId === AVENUE_ELITE_WORKSPACE_ID;
}
