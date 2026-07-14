/**
 * Server functions for workspace People Views & Campaign Filters.
 * workspaceId/role are always derived from the authenticated context —
 * never from client input.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActiveWorkspace } from "@/lib/workspace/context.server";
import {
  listPeopleViews,
  listCampaignFilters,
  listVersions,
  createPeopleView,
  updatePeopleView,
  duplicatePeopleView,
  createCampaignFilter,
  updateCampaignFilter,
  convertViewToCampaignFilter,
  rollbackObject,
  dryRunAndRecord,
  runPeopleView,
  type WorkspaceRole,
} from "./people-views.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FILTER_FIELDS, FILTER_OPERATORS } from "./filter-engine.server";

async function ctxRole(context: any): Promise<{ workspaceId: string; userId: string | null; role: WorkspaceRole }> {
  const { supabase, workspaceId, userId } = context;
  if (!workspaceId) throw new Error("No active workspace");
  const ws = await resolveActiveWorkspace(supabase, userId);
  return { workspaceId: ws.workspaceId, userId: userId ?? null, role: ws.workspaceRole };
}

const filterConfigInput = z.unknown();

export const listWorkspacePeopleViews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId, role } = await ctxRole(context);
    return { views: await listPeopleViews(workspaceId, false, role) };
  });

export const listWorkspaceCampaignFilters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await ctxRole(context);
    return { filters: await listCampaignFilters(workspaceId) };
  });

export const getFilterFieldCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = await ctxRole(context);
    // Include this workspace's meta.* custom fields.
    const { data: leads } = await (supabaseAdmin as any)
      .from("leads")
      .select("meta")
      .eq("workspace_id", workspaceId)
      .not("meta", "eq", "{}")
      .limit(200);
    const metaKeys = new Set<string>();
    for (const l of leads ?? []) {
      if (l.meta && typeof l.meta === "object") for (const k of Object.keys(l.meta)) metaKeys.add(k);
    }
    return {
      fields: Object.entries(FILTER_FIELDS).map(([key, def]) => ({
        key,
        label: def.label,
        kind: def.kind,
        enumValues: def.enumValues ?? null,
      })),
      customFields: Array.from(metaKeys).map((k) => ({ key: `meta.${k}`, label: k, kind: "text" })),
      operators: FILTER_OPERATORS,
    };
  });

export const createWorkspacePeopleView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(2000).nullish(),
      icon: z.string().max(60).nullish(),
      filterConfig: filterConfigInput,
      columnConfig: z.unknown().optional(),
      sortConfig: z.unknown().optional(),
      status: z.enum(["draft", "active"]).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return {
      view: await createPeopleView({
        workspaceId, userId, role,
        name: data.name,
        description: data.description ?? null,
        icon: data.icon ?? null,
        filterConfig: data.filterConfig,
        columnConfig: data.columnConfig,
        sortConfig: data.sortConfig,
        status: data.status,
      }),
    };
  });

export const updateWorkspacePeopleView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        icon: z.string().max(60).nullable().optional(),
        filterConfig: z.unknown().optional(),
        columnConfig: z.unknown().optional(),
        sortConfig: z.unknown().optional(),
        status: z.enum(["draft", "active", "archived"]).optional(),
      }),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return { view: await updatePeopleView({ workspaceId, userId, role, id: data.id, patch: data.patch as any }) };
  });

export const duplicateWorkspacePeopleView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return { view: await duplicatePeopleView({ workspaceId, userId, role, id: data.id }) };
  });

export const createWorkspaceCampaignFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(2000).nullish(),
      filterConfig: filterConfigInput,
      safetyConfig: z.unknown().optional(),
      sourceTypes: z.array(z.string().max(60)).max(20).optional(),
      status: z.enum(["draft", "active"]).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return {
      filter: await createCampaignFilter({
        workspaceId, userId, role,
        name: data.name,
        description: data.description ?? null,
        filterConfig: data.filterConfig,
        safetyConfig: data.safetyConfig,
        sourceTypes: data.sourceTypes,
        status: data.status,
      }),
    };
  });

export const updateWorkspaceCampaignFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      patch: z.object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullable().optional(),
        filterConfig: z.unknown().optional(),
        safetyConfig: z.unknown().optional(),
        sourceTypes: z.array(z.string().max(60)).max(20).optional(),
        status: z.enum(["draft", "active", "archived"]).optional(),
      }),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return { filter: await updateCampaignFilter({ workspaceId, userId, role, id: data.id, patch: data.patch as any }) };
  });

export const convertPeopleViewToCampaignFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ viewId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return { filter: await convertViewToCampaignFilter({ workspaceId, userId, role, viewId: data.viewId }) };
  });

export const dryRunWorkspaceFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      objectType: z.enum(["people_view", "campaign_filter"]),
      id: z.string().uuid().nullish(),
      filterConfig: filterConfigInput,
      safetyConfig: z.unknown().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = await ctxRole(context);
    return {
      result: await dryRunAndRecord({
        objectType: data.objectType,
        workspaceId,
        userId,
        id: data.id ?? null,
        filterConfig: data.filterConfig,
        safetyConfig: data.safetyConfig,
      }),
    };
  });

export const listWorkspaceViewVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      objectType: z.enum(["people_view", "campaign_filter"]),
      id: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = await ctxRole(context);
    return { versions: await listVersions(data.objectType, workspaceId, data.id) };
  });

export const rollbackWorkspaceViewVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      objectType: z.enum(["people_view", "campaign_filter"]),
      id: z.string().uuid(),
      versionId: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return {
      record: await rollbackObject({
        objectType: data.objectType,
        workspaceId, userId, role,
        id: data.id,
        versionId: data.versionId,
      }),
    };
  });

export const runWorkspacePeopleView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ viewId: z.string().uuid(), limit: z.number().int().min(1).max(500).optional() }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    // Assigned-records-only roles see only leads assigned to them in saved views.
    const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
    const perms = await resolvePermissions(workspaceId, userId);
    const assignedToUserId = perms.assignedRecordsOnly === true ? userId : null;
    return await runPeopleView(workspaceId, data.viewId, data.limit ?? 200, role, assignedToUserId);
  });

export const listWorkspaceViewAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ objectId: z.string().uuid().nullish(), limit: z.number().int().min(1).max(200).optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = await ctxRole(context);
    let q = (supabaseAdmin as any)
      .from("workspace_view_audit_logs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.objectId) q = q.eq("object_id", data.objectId);
    const { data: logs, error } = await q;
    if (error) throw new Error(error.message);
    return { logs: logs ?? [] };
  });
