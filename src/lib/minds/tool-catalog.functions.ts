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

export const getMindToolCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ workspaceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ tools: MindToolCatalogEntry[] }> => {
    const userId = (context as any).userId as string;
    const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
    const { listMindTools, mindToolsReady } = await import("./tool-registry.server");
    await mindToolsReady();

    const perms = await resolvePermissions(data.workspaceId, userId);
    if (!perms.isMember) return { tools: [] };

    const tools: MindToolCatalogEntry[] = listMindTools().map((t) => {
      let allowed = true;
      let deniedReason: string | undefined;
      if (t.requiredActionKey && !perms.actionAccess?.[t.requiredActionKey]) {
        allowed = false;
        deniedReason = `Requires the "${t.requiredActionKey}" permission.`;
      }
      const { inputSchema: _s, run: _r, ...meta } = t as any;
      return { ...meta, allowed, deniedReason };
    });
    return { tools };
  });
