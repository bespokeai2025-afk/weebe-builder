/**
 * Workspace Page Filters — server-side CRUD with versioning, rollback, role
 * checks and audit logging. Mirrors people-views.server.ts patterns.
 *
 * Page filters are ADDITIVE workspace configs: pages behave exactly as before
 * when no filters exist. Filters run read-only against their page's dataset
 * (PAGE_DATASETS) — they never mutate, call or message.
 *
 * All writes go through supabaseAdmin (table is server-write-only) and are
 * hard-scoped to the authenticated workspace.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import {
  PAGE_DATASETS,
  PAGE_KEYS,
  validateFilterConfig,
  applyFilterToQuery,
  runPageFilterDryRun,
  type PageKey,
  type DryRunResult,
} from "./filter-engine.server";
import {
  assertRole,
  canDraft,
  canActivate,
  writeViewAudit,
  type WorkspaceRole,
} from "./people-views.server";

const TABLE = "workspace_page_filters";

function assertPageKey(pageKey: string): asserts pageKey is PageKey {
  if (!PAGE_KEYS.includes(pageKey as PageKey)) {
    throw new Error(`Unknown page "${pageKey}". Allowed: ${PAGE_KEYS.join(", ")}.`);
  }
}

function validateForPage(pageKey: PageKey, raw: unknown) {
  const ds = PAGE_DATASETS[pageKey];
  const v = validateFilterConfig(raw, { registry: ds.registry, allowMeta: ds.allowMeta });
  if (!v.ok || !v.config) throw new Error(`Invalid filter: ${v.errors.join("; ")}`);
  return v.config;
}

async function getCurrent(workspaceId: string, id: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not found in this workspace.");
  return data;
}

async function snapshotRow(row: any): Promise<string> {
  const copy: any = { ...row };
  delete copy.id;
  delete copy.created_at;
  delete copy.updated_at;
  copy.parent_filter_id = row.id;
  copy.status = "archived";
  copy.is_default = false; // partial unique index guards defaults on current rows
  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE)
    .insert(copy)
    .select("id")
    .single();
  if (error) throw new Error(`Version snapshot failed: ${error.message}`);
  return data.id as string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listPageFilters(
  workspaceId: string,
  pageKey?: string | null,
  opts?: { includeArchived?: boolean; role?: WorkspaceRole },
) {
  assertNotWbahWorkspace(workspaceId);
  let q = (supabaseAdmin as any)
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("parent_filter_id", null)
    .order("updated_at", { ascending: false });
  if (pageKey) {
    assertPageKey(pageKey);
    q = q.eq("page_key", pageKey);
  }
  if (!opts?.includeArchived) q = q.neq("status", "archived");
  if (opts?.role) q = q.contains("visible_to_roles", [opts.role]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createPageFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  pageKey: string;
  name: string;
  description?: string | null;
  filterConfig: unknown;
  columnConfig?: unknown;
  sortConfig?: unknown;
  groupConfig?: unknown;
  status?: "draft" | "active";
  createdBySystemMind?: boolean;
  prompt?: string | null;
}) {
  assertNotWbahWorkspace(input.workspaceId);
  assertRole(canDraft(input.role), "create page filters");
  assertPageKey(input.pageKey);
  const status = input.status === "active" ? "active" : "draft";
  if (status === "active") assertRole(canActivate(input.role), "activate page filters");

  const config = validateForPage(input.pageKey, input.filterConfig);

  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE)
    .insert({
      workspace_id: input.workspaceId,
      page_key: input.pageKey,
      name: input.name.slice(0, 120),
      description: input.description ?? null,
      filter_config: config,
      column_config: input.columnConfig ?? [],
      sort_config: input.sortConfig ?? {},
      group_config: input.groupConfig ?? {},
      created_by_user_id: input.userId,
      created_by_systemmind: input.createdBySystemMind ?? false,
      systemmind_prompt: input.prompt ?? null,
      status,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "page_filter",
    objectId: data.id,
    actionType: "create",
    prompt: input.prompt,
    afterState: data,
    riskLevel: "low",
  });
  return data;
}

export async function updatePageFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
  patch: Partial<{
    name: string;
    description: string | null;
    filterConfig: unknown;
    columnConfig: unknown;
    sortConfig: unknown;
    groupConfig: unknown;
    status: "draft" | "active" | "archived";
  }>;
  prompt?: string | null;
}) {
  assertNotWbahWorkspace(input.workspaceId);
  const current = await getCurrent(input.workspaceId, input.id);
  const activating = input.patch.status === "active" && current.status !== "active";
  const archiving = input.patch.status === "archived";
  if (activating || archiving) assertRole(canActivate(input.role), archiving ? "archive page filters" : "activate page filters");
  else assertRole(canDraft(input.role), "edit page filters");

  const update: any = { updated_at: new Date().toISOString() };
  if (input.patch.name !== undefined) update.name = input.patch.name.slice(0, 120);
  if (input.patch.description !== undefined) update.description = input.patch.description;
  if (input.patch.columnConfig !== undefined) update.column_config = input.patch.columnConfig;
  if (input.patch.sortConfig !== undefined) update.sort_config = input.patch.sortConfig;
  if (input.patch.groupConfig !== undefined) update.group_config = input.patch.groupConfig;
  if (input.patch.status !== undefined) update.status = input.patch.status;
  if (archiving) update.is_default = false;
  if (input.patch.filterConfig !== undefined) {
    update.filter_config = validateForPage(current.page_key, input.patch.filterConfig);
  }
  if (input.prompt) update.systemmind_prompt = input.prompt;

  await snapshotRow(current);
  update.version = (current.version ?? 1) + 1;

  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE)
    .update(update)
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "page_filter",
    objectId: input.id,
    actionType: archiving ? "archive" : activating ? "apply" : "update",
    prompt: input.prompt,
    beforeState: current,
    afterState: data,
    riskLevel: "low",
  });
  return data;
}

export async function duplicatePageFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
}) {
  assertNotWbahWorkspace(input.workspaceId);
  assertRole(canDraft(input.role), "duplicate page filters");
  const current = await getCurrent(input.workspaceId, input.id);
  const created = await createPageFilter({
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    pageKey: current.page_key,
    name: `${current.name} (copy)`,
    description: current.description,
    filterConfig: current.filter_config,
    columnConfig: current.column_config,
    sortConfig: current.sort_config,
    groupConfig: current.group_config,
    status: "draft",
    createdBySystemMind: false,
  });
  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "page_filter",
    objectId: created.id,
    actionType: "duplicate",
    beforeState: { sourceId: input.id },
    afterState: created,
    riskLevel: "low",
  });
  return created;
}

/**
 * Sets (or clears) the default filter for a page. Changing a default is an
 * admin-only action and is always audited — never done silently.
 */
export async function setDefaultPageFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
  isDefault: boolean;
}) {
  assertNotWbahWorkspace(input.workspaceId);
  assertRole(canActivate(input.role), "change default page filters");
  const current = await getCurrent(input.workspaceId, input.id);
  if (input.isDefault && current.status !== "active") {
    throw new Error("Only an active filter can be set as default.");
  }

  if (input.isDefault) {
    // Clear any existing default for this page first (single-default index).
    await (supabaseAdmin as any)
      .from(TABLE)
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("workspace_id", input.workspaceId)
      .eq("page_key", current.page_key)
      .eq("is_default", true)
      .is("parent_filter_id", null);
  }

  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE)
    .update({ is_default: input.isDefault, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "page_filter",
    objectId: input.id,
    actionType: input.isDefault ? "set_default" : "unset_default",
    beforeState: current,
    afterState: data,
    riskLevel: "medium",
  });
  return data;
}

export async function rollbackPageFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
  versionId: string;
}) {
  assertNotWbahWorkspace(input.workspaceId);
  assertRole(canActivate(input.role), "rollback page filters");
  const current = await getCurrent(input.workspaceId, input.id);
  const snapshot = await getCurrent(input.workspaceId, input.versionId);
  if (snapshot.parent_filter_id !== input.id) {
    throw new Error("Version does not belong to this record.");
  }

  await snapshotRow(current);

  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE)
    .update({
      name: snapshot.name,
      description: snapshot.description,
      filter_config: snapshot.filter_config,
      column_config: snapshot.column_config,
      sort_config: snapshot.sort_config,
      group_config: snapshot.group_config,
      version: (current.version ?? 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "page_filter",
    objectId: input.id,
    actionType: "rollback",
    beforeState: current,
    afterState: data,
    riskLevel: "medium",
  });
  return data;
}

export async function listPageFilterVersions(workspaceId: string, id: string) {
  assertNotWbahWorkspace(workspaceId);
  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE)
    .select("id, version, status, filter_config, created_at")
    .eq("workspace_id", workspaceId)
    .eq("parent_filter_id", id)
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Dry-run + run ────────────────────────────────────────────────────────────

export async function dryRunPageFilter(input: {
  workspaceId: string;
  userId: string | null;
  pageKey: string;
  filterConfig: unknown;
  id?: string | null;
}): Promise<DryRunResult> {
  assertNotWbahWorkspace(input.workspaceId);
  assertPageKey(input.pageKey);
  const result = await runPageFilterDryRun(
    supabaseAdmin as any,
    input.workspaceId,
    input.pageKey,
    input.filterConfig,
  );

  if (input.id) {
    await (supabaseAdmin as any)
      .from(TABLE)
      .update({ last_dry_run: result, last_dry_run_at: result.ranAt })
      .eq("id", input.id)
      .eq("workspace_id", input.workspaceId);
  }

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "page_filter",
    objectId: input.id ?? null,
    actionType: "dry_run",
    dryRunResult: result,
    riskLevel: result.riskLevel,
  });
  return result;
}

/** Read-only: run a saved page filter and return matching rows from its dataset. */
export async function runPageFilter(
  workspaceId: string,
  filterId: string,
  limit = 200,
  role?: WorkspaceRole,
) {
  assertNotWbahWorkspace(workspaceId);
  const filter = await getCurrent(workspaceId, filterId);
  if (role && Array.isArray(filter.visible_to_roles) && !filter.visible_to_roles.includes(role)) {
    throw new Error("This filter is not visible to your workspace role.");
  }
  const pageKey = filter.page_key as PageKey;
  assertPageKey(pageKey);
  const ds = PAGE_DATASETS[pageKey];
  const config = validateForPage(pageKey, filter.filter_config);

  const sort = (filter.sort_config ?? {}) as { field?: string; direction?: string };
  const sortDef = sort.field ? ds.registry[sort.field] : undefined;
  const sortCol = sortDef && !sortDef.column.startsWith("meta.") ? sortDef.column : ds.defaultOrderCol;
  const ascending = sort.direction === "asc";

  let q = (supabaseAdmin as any)
    .from(ds.table)
    .select(ds.sampleColumns)
    .eq("workspace_id", workspaceId)
    .order(sortCol, { ascending })
    .limit(Math.min(limit, 500));
  q = applyFilterToQuery(q, config, ds.registry);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { filter, rows: data ?? [] };
}
