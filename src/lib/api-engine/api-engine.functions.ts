/**
 * API Engine — TanStack server functions.
 * Exposes engine status and WBAH profile seeding to admin UI.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { getEngineStatus, seedWbahApiProfile } from "./data-source-router.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getApiEngineStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    return getEngineStatus();
  });

export const seedWbahProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { workspaceId: string }) =>
    z.object({ workspaceId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data }) => {
    return seedWbahApiProfile(data.workspaceId);
  });

export const listApiProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const { data, error } = await sb
      .from("workspace_api_profiles")
      .select("id, workspace_id, data_source_key, display_name, is_active, auth_strategy, pagination_strategy, module_mappings, engine_config, created_at, updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((p: any) => ({
      ...p,
      moduleMappingCount: Object.keys(p.module_mappings ?? {}).length,
    }));
  });

export const getApiEngineLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { hours?: number; moduleKey?: string }) =>
    z.object({
      hours:     z.number().optional(),
      moduleKey: z.string().optional(),
    }).parse(i ?? {}),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const hours = data.hours ?? 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    let q = sb
      .from("api_engine_logs")
      .select("id, workspace_id, data_source_key, module_key, endpoint_path, http_method, status_code, latency_ms, record_count, total_reported, error_msg, requested_at")
      .gte("requested_at", since)
      .order("requested_at", { ascending: false })
      .limit(500);

    if (data.moduleKey) q = q.eq("module_key", data.moduleKey);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
