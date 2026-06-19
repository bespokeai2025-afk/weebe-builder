import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { cacheHealthCheck, cacheFlushWorkspace } from "@/lib/cache/redis.server";

export const getCacheHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return cacheHealthCheck();
  });

export const flushWorkspaceCache = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as { workspaceId: string };
    if (!workspaceId) throw new Error("No active workspace");
    const deletedCount = await cacheFlushWorkspace(workspaceId);
    return { deletedCount };
  });
