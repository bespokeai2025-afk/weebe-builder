/**
 * Server functions for workspace Page Filters (saved, versioned, dry-runnable
 * filters for major pages). workspaceId/role always derive from the
 * authenticated context — never from client input.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActiveWorkspace } from "@/lib/workspace/context.server";
import {
  listPageFilters,
  createPageFilter,
  updatePageFilter,
  duplicatePageFilter,
  setDefaultPageFilter,
  rollbackPageFilter,
  listPageFilterVersions,
  dryRunPageFilter,
  runPageFilter,
} from "./page-filters.server";
import type { WorkspaceRole } from "./people-views.server";
import { PAGE_DATASETS, PAGE_KEYS, FILTER_OPERATORS, type PageKey } from "./filter-engine.server";

async function ctxRole(context: any): Promise<{ workspaceId: string; userId: string | null; role: WorkspaceRole }> {
  const { supabase, workspaceId, userId } = context;
  if (!workspaceId) throw new Error("No active workspace");
  const ws = await resolveActiveWorkspace(supabase, userId);
  return { workspaceId: ws.workspaceId, userId: userId ?? null, role: ws.workspaceRole };
}

const pageKeySchema = z.enum(PAGE_KEYS as [PageKey, ...PageKey[]]);

export const listWorkspacePageFilters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ pageKey: pageKeySchema.nullish() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, role } = await ctxRole(context);
    return listPageFilters(workspaceId, data.pageKey ?? null, { role });
  });

export const getPageFilterFieldCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ pageKey: pageKeySchema }).parse(input))
  .handler(async ({ data }) => {
    const ds = PAGE_DATASETS[data.pageKey];
    return {
      fields: Object.entries(ds.registry).map(([key, def]) => ({
        key,
        label: def.label,
        kind: def.kind,
        enumValues: def.enumValues ?? null,
      })),
      operators: FILTER_OPERATORS,
      allowMeta: ds.allowMeta,
    };
  });

export const createWorkspacePageFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pageKey: pageKeySchema,
        name: z.string().min(1).max(120),
        description: z.string().max(2000).nullish(),
        filterConfig: z.unknown(),
        columnConfig: z.unknown().nullish(),
        sortConfig: z.unknown().nullish(),
        groupConfig: z.unknown().nullish(),
        status: z.enum(["draft", "active"]).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return createPageFilter({
      workspaceId,
      userId,
      role,
      pageKey: data.pageKey,
      name: data.name,
      description: data.description ?? null,
      filterConfig: data.filterConfig,
      columnConfig: data.columnConfig ?? undefined,
      sortConfig: data.sortConfig ?? undefined,
      groupConfig: data.groupConfig ?? undefined,
      status: data.status ?? "draft",
    });
  });

export const updateWorkspacePageFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        patch: z
          .object({
            name: z.string().min(1).max(120).optional(),
            description: z.string().max(2000).nullable().optional(),
            filterConfig: z.unknown().optional(),
            columnConfig: z.unknown().optional(),
            sortConfig: z.unknown().optional(),
            groupConfig: z.unknown().optional(),
            status: z.enum(["draft", "active", "archived"]).optional(),
          })
          .partial(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return updatePageFilter({ workspaceId, userId, role, id: data.id, patch: data.patch as any });
  });

export const duplicateWorkspacePageFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return duplicatePageFilter({ workspaceId, userId, role, id: data.id });
  });

export const setDefaultWorkspacePageFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), isDefault: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return setDefaultPageFilter({ workspaceId, userId, role, id: data.id, isDefault: data.isDefault });
  });

export const rollbackWorkspacePageFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), versionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId, role } = await ctxRole(context);
    return rollbackPageFilter({ workspaceId, userId, role, id: data.id, versionId: data.versionId });
  });

export const listWorkspacePageFilterVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { workspaceId } = await ctxRole(context);
    return listPageFilterVersions(workspaceId, data.id);
  });

export const dryRunWorkspacePageFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pageKey: pageKeySchema,
        filterConfig: z.unknown(),
        id: z.string().uuid().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, userId } = await ctxRole(context);
    return dryRunPageFilter({
      workspaceId,
      userId,
      pageKey: data.pageKey,
      filterConfig: data.filterConfig,
      id: data.id ?? null,
    });
  });

export const runWorkspacePageFilter = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(500).nullish() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { workspaceId, role } = await ctxRole(context);
    return runPageFilter(workspaceId, data.id, data.limit ?? 200, role);
  });
