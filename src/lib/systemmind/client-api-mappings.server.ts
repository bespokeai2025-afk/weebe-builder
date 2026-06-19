/**
 * SystemMind Clients — Endpoint Mapping server functions.
 * All guarded by requirePlatformAdmin.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const WEBEE_MODULE_KEYS = [
  { key: "leads",      label: "Leads" },
  { key: "contacts",   label: "Contacts / CRM" },
  { key: "calls",      label: "Call History" },
  { key: "campaigns",  label: "Campaigns" },
  { key: "agents",     label: "Agents" },
  { key: "analytics",  label: "Analytics / Dashboard" },
  { key: "credits",    label: "Credits & Usage" },
  { key: "phone",      label: "Phone Numbers" },
  { key: "voicemail",  label: "Voicemail" },
  { key: "frequency",  label: "Call Scheduling" },
  { key: "admin",      label: "Admin / Users" },
  { key: "sync",       label: "Sync / Webhooks" },
] as const;

export const listEndpointMappings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { connectionId: string }) =>
    z.object({ connectionId: z.string() }).parse(i),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { data: rows, error } = await sb
      .from("client_api_endpoint_mappings")
      .select("*")
      .eq("client_api_connection_id", data.connectionId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const saveEndpointMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: {
    id?: string;
    connectionId: string;
    workspaceId?: string;
    moduleKey: string;
    endpointPath: string;
    method: string;
    queryParams?: Record<string, string>;
    bodyTemplate?: Record<string, unknown>;
    detectedArrayPath?: string;
    paginationStrategy?: string;
    fieldMapping?: Record<string, unknown>;
    notes?: string;
  }) =>
    z.object({
      id:                  z.string().optional(),
      connectionId:        z.string(),
      workspaceId:         z.string().optional(),
      moduleKey:           z.string(),
      endpointPath:        z.string(),
      method:              z.string(),
      queryParams:         z.record(z.string()).optional(),
      bodyTemplate:        z.record(z.unknown()).optional(),
      detectedArrayPath:   z.string().optional(),
      paginationStrategy:  z.string().optional(),
      fieldMapping:        z.record(z.unknown()).optional(),
      notes:               z.string().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const payload = {
      client_api_connection_id: data.connectionId,
      workspace_id:             data.workspaceId ?? null,
      module_key:               data.moduleKey,
      endpoint_path:            data.endpointPath,
      method:                   data.method,
      query_params:             data.queryParams ?? null,
      body_template:            data.bodyTemplate ?? null,
      detected_array_path:      data.detectedArrayPath ?? null,
      pagination_strategy:      data.paginationStrategy ?? null,
      field_mapping:            data.fieldMapping ?? null,
      notes:                    data.notes ?? null,
    };

    if (data.id) {
      const { data: row, error } = await sb
        .from("client_api_endpoint_mappings")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }

    const { data: row, error } = await sb
      .from("client_api_endpoint_mappings")
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteEndpointMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string }) => z.object({ id: z.string() }).parse(i))
  .handler(async ({ data }) => {
    const sb = supabaseAdmin as any;
    const { error } = await sb.from("client_api_endpoint_mappings").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAllMappings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const { data: rows, error } = await sb
      .from("client_api_endpoint_mappings")
      .select("*, client_api_connections(name)")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
