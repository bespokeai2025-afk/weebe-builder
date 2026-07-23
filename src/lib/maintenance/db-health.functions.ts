import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

/**
 * Latest database-watchdog snapshot for the admin dashboard status banner.
 * Snapshot is in-process state populated by the 5-minute background tick.
 */
export const getDbHealthStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { getDbHealthWatchdogSnapshot } = await import(
      "@/lib/maintenance/db-health-watchdog.server"
    );
    return getDbHealthWatchdogSnapshot();
  });
