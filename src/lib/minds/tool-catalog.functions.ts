/**
 * Mind tool catalog — server functions.
 *
 * Returns the full shared tool inventory with per-user allowance flags so
 * web (and later mobile/API) render the SAME capabilities with the same
 * permission and approval semantics.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MindToolCatalogEntry } from "./tool-registry.shared";

/**
 * Shared catalog core — consumed by BOTH the web server function below and
 * /api/v1/minds/tools. When userId is null (workspace API key), per-user
 * allowance flags are computed against the workspace-key scope: tools with
 * a requiredActionKey are marked not-allowed because there is no user to
 * hold the entitlement (execution requires a user token anyway).
 */
export async function buildMindToolCatalog(
  workspaceId: string,
  userId: string | null,
): Promise<{ tools: MindToolCatalogEntry[] }> {
  const { listMindTools, mindToolsReady } = await import("./tool-registry.server");
  await mindToolsReady();

  let perms: any = null;
  if (userId) {
    const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
    perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember) return { tools: [] };
  }

  const tools: MindToolCatalogEntry[] = listMindTools().map((t) => {
    let allowed = true;
    let deniedReason: string | undefined;
    if (t.requiredActionKey) {
      if (!userId) {
        allowed = false;
        deniedReason = "Requires a user token (workspace API keys carry no user entitlements).";
      } else if (!perms.actionAccess?.[t.requiredActionKey]) {
        allowed = false;
        deniedReason = `Requires the "${t.requiredActionKey}" permission.`;
      }
    }
    const { inputSchema: _s, run: _r, ...meta } = t as any;
    return { ...meta, allowed, deniedReason };
  });
  return { tools };
}

export const getMindToolCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ workspaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ tools: MindToolCatalogEntry[] }> => {
    const userId = (context as any).userId as string;
    return buildMindToolCatalog(data.workspaceId, userId);
  });
