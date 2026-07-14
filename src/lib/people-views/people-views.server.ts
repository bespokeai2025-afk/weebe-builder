/**
 * Workspace People Views & Campaign Filters — server-side CRUD with
 * versioning, rollback, role checks and audit logging.
 *
 * All writes go through supabaseAdmin (tables are server-write-only) and are
 * hard-scoped to the authenticated workspace — client-supplied workspace ids
 * are never accepted.
 *
 * Versioning model: one "current" row per view/filter. Every edit first
 * snapshots the current row as an archived child (parent_*_id = current id),
 * then bumps version on the current row. Rollback re-applies a snapshot's
 * config the same way. Old configs are never destroyed.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  validateFilterConfig,
  applyFilterToQuery,
  safetyConfigSchema,
  DEFAULT_SAFETY,
  runFilterDryRun,
  type SafetyConfig,
  type DryRunResult,
} from "./filter-engine.server";

export type WorkspaceRole = "owner" | "admin" | "member";
export type ObjectType = "people_view" | "campaign_filter";
/** Audit log accepts the newer object types too (page filters, campaign reports). */
export type AuditObjectType = ObjectType | "page_filter" | "campaign_report";

const TABLE: Record<ObjectType, string> = {
  people_view: "workspace_people_views",
  campaign_filter: "workspace_campaign_filters",
};
const PARENT_COL: Record<ObjectType, string> = {
  people_view: "parent_view_id",
  campaign_filter: "parent_filter_id",
};

export function canDraft(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "member";
}
export function canActivate(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

export function assertRole(ok: boolean, action: string): void {
  if (!ok) throw new Error(`Your workspace role does not allow you to ${action}.`);
}

export async function writeViewAudit(entry: {
  workspaceId: string;
  userId: string | null;
  objectType: AuditObjectType;
  objectId: string | null;
  actionType: string;
  prompt?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  dryRunResult?: unknown;
  approvalStatus?: string | null;
  riskLevel?: string | null;
}): Promise<void> {
  const { error } = await (supabaseAdmin as any).from("workspace_view_audit_logs").insert({
    workspace_id: entry.workspaceId,
    user_id: entry.userId,
    object_type: entry.objectType,
    object_id: entry.objectId,
    action_type: entry.actionType,
    prompt: entry.prompt ?? null,
    before_state: entry.beforeState ?? null,
    after_state: entry.afterState ?? null,
    dry_run_result: entry.dryRunResult ?? null,
    approval_status: entry.approvalStatus ?? null,
    risk_level: entry.riskLevel ?? null,
  });
  if (error) console.error("[people-views] audit write failed:", error.message);
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "view";
}

async function getCurrent(objectType: ObjectType, workspaceId: string, id: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE[objectType])
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not found in this workspace.");
  return data;
}

/** Snapshot a current row as an archived version child. Returns snapshot id. */
async function snapshotRow(objectType: ObjectType, row: any): Promise<string> {
  const copy: any = { ...row };
  delete copy.id;
  delete copy.created_at;
  delete copy.updated_at;
  copy[PARENT_COL[objectType]] = row.id;
  copy.status = "archived";
  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE[objectType])
    .insert(copy)
    .select("id")
    .single();
  if (error) throw new Error(`Version snapshot failed: ${error.message}`);
  return data.id as string;
}

// ── People views ─────────────────────────────────────────────────────────────

export async function listPeopleViews(
  workspaceId: string,
  includeArchived = false,
  role?: WorkspaceRole,
) {
  let q = (supabaseAdmin as any)
    .from("workspace_people_views")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("parent_view_id", null)
    .order("updated_at", { ascending: false });
  if (!includeArchived) q = q.neq("status", "archived");
  if (role) q = q.contains("visible_to_roles", [role]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listVersions(objectType: ObjectType, workspaceId: string, id: string) {
  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE[objectType])
    .select("id, version, status, filter_config, created_at")
    .eq("workspace_id", workspaceId)
    .eq(PARENT_COL[objectType], id)
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createPeopleView(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  name: string;
  description?: string | null;
  icon?: string | null;
  filterConfig: unknown;
  columnConfig?: unknown;
  sortConfig?: unknown;
  status?: "draft" | "active";
  createdBySystemMind?: boolean;
  prompt?: string | null;
}) {
  assertRole(canDraft(input.role), "create views");
  const status = input.status === "active" ? "active" : "draft";
  if (status === "active") assertRole(canActivate(input.role), "activate views");

  const v = validateFilterConfig(input.filterConfig);
  if (!v.ok) throw new Error(`Invalid filter: ${v.errors.join("; ")}`);

  const { data, error } = await (supabaseAdmin as any)
    .from("workspace_people_views")
    .insert({
      workspace_id: input.workspaceId,
      name: input.name.slice(0, 120),
      slug: slugify(input.name),
      description: input.description ?? null,
      icon: input.icon ?? null,
      filter_config: v.config,
      column_config: input.columnConfig ?? [],
      sort_config: input.sortConfig ?? {},
      created_by_user_id: input.userId,
      created_by_systemmind: input.createdBySystemMind ?? false,
      systemmind_prompt: input.prompt ?? null,
      status,
    })
    .select("*")
    .single();
  if (error) {
    if ((error.message || "").includes("idx_wpv_ws_slug_active")) {
      throw new Error(`A view named "${input.name}" already exists in this workspace.`);
    }
    throw new Error(error.message);
  }

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "people_view",
    objectId: data.id,
    actionType: "create",
    prompt: input.prompt,
    afterState: data,
    riskLevel: "low",
  });
  return data;
}

export async function updatePeopleView(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
  patch: Partial<{
    name: string;
    description: string | null;
    icon: string | null;
    filterConfig: unknown;
    columnConfig: unknown;
    sortConfig: unknown;
    status: "draft" | "active" | "archived";
  }>;
  prompt?: string | null;
}) {
  const current = await getCurrent("people_view", input.workspaceId, input.id);
  const activating = input.patch.status === "active" && current.status !== "active";
  const archiving = input.patch.status === "archived";
  if (activating || archiving) assertRole(canActivate(input.role), archiving ? "archive views" : "activate views");
  else assertRole(canDraft(input.role), "edit views");

  const update: any = { updated_at: new Date().toISOString() };
  if (input.patch.name !== undefined) {
    update.name = input.patch.name.slice(0, 120);
    update.slug = slugify(input.patch.name);
  }
  if (input.patch.description !== undefined) update.description = input.patch.description;
  if (input.patch.icon !== undefined) update.icon = input.patch.icon;
  if (input.patch.columnConfig !== undefined) update.column_config = input.patch.columnConfig;
  if (input.patch.sortConfig !== undefined) update.sort_config = input.patch.sortConfig;
  if (input.patch.status !== undefined) update.status = input.patch.status;
  if (input.patch.filterConfig !== undefined) {
    const v = validateFilterConfig(input.patch.filterConfig);
    if (!v.ok) throw new Error(`Invalid filter: ${v.errors.join("; ")}`);
    update.filter_config = v.config;
  }
  if (input.prompt) update.systemmind_prompt = input.prompt;

  await snapshotRow("people_view", current);
  update.version = (current.version ?? 1) + 1;

  const { data, error } = await (supabaseAdmin as any)
    .from("workspace_people_views")
    .update(update)
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "people_view",
    objectId: input.id,
    actionType: archiving ? "archive" : activating ? "apply" : "update",
    prompt: input.prompt,
    beforeState: current,
    afterState: data,
    riskLevel: "low",
  });
  return data;
}

export async function duplicatePeopleView(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
}) {
  assertRole(canDraft(input.role), "duplicate views");
  const current = await getCurrent("people_view", input.workspaceId, input.id);
  const created = await createPeopleView({
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    name: `${current.name} (copy)`,
    description: current.description,
    icon: current.icon,
    filterConfig: current.filter_config,
    columnConfig: current.column_config,
    sortConfig: current.sort_config,
    status: "draft",
    createdBySystemMind: false,
  });
  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "people_view",
    objectId: created.id,
    actionType: "duplicate",
    beforeState: { sourceId: input.id },
    afterState: created,
    riskLevel: "low",
  });
  return created;
}

export async function rollbackObject(input: {
  objectType: ObjectType;
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
  versionId: string;
}) {
  assertRole(canActivate(input.role), "rollback");
  const current = await getCurrent(input.objectType, input.workspaceId, input.id);
  const snapshot = await getCurrent(input.objectType, input.workspaceId, input.versionId);
  if (snapshot[PARENT_COL[input.objectType]] !== input.id) {
    throw new Error("Version does not belong to this record.");
  }

  await snapshotRow(input.objectType, current);

  const restore: any = {
    name: snapshot.name,
    description: snapshot.description,
    filter_config: snapshot.filter_config,
    version: (current.version ?? 1) + 1,
    updated_at: new Date().toISOString(),
  };
  if (input.objectType === "people_view") {
    restore.column_config = snapshot.column_config;
    restore.sort_config = snapshot.sort_config;
    restore.icon = snapshot.icon;
  } else {
    restore.safety_config = snapshot.safety_config;
    restore.source_types = snapshot.source_types;
  }

  const { data, error } = await (supabaseAdmin as any)
    .from(TABLE[input.objectType])
    .update(restore)
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: input.objectType,
    objectId: input.id,
    actionType: "rollback",
    beforeState: current,
    afterState: data,
    riskLevel: "medium",
  });
  return data;
}

// ── Campaign filters ─────────────────────────────────────────────────────────

export async function listCampaignFilters(workspaceId: string, includeArchived = false) {
  let q = (supabaseAdmin as any)
    .from("workspace_campaign_filters")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("parent_filter_id", null)
    .order("updated_at", { ascending: false });
  if (!includeArchived) q = q.neq("status", "archived");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createCampaignFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  name: string;
  description?: string | null;
  filterConfig: unknown;
  safetyConfig?: unknown;
  sourceTypes?: string[];
  status?: "draft" | "active";
  createdBySystemMind?: boolean;
  prompt?: string | null;
}) {
  assertRole(canDraft(input.role), "create campaign filters");
  const status = input.status === "active" ? "active" : "draft";
  if (status === "active") assertRole(canActivate(input.role), "activate campaign filters");

  const v = validateFilterConfig(input.filterConfig);
  if (!v.ok) throw new Error(`Invalid filter: ${v.errors.join("; ")}`);
  const safety: SafetyConfig = input.safetyConfig
    ? safetyConfigSchema.parse(input.safetyConfig)
    : DEFAULT_SAFETY;

  const { data, error } = await (supabaseAdmin as any)
    .from("workspace_campaign_filters")
    .insert({
      workspace_id: input.workspaceId,
      name: input.name.slice(0, 120),
      description: input.description ?? null,
      filter_config: v.config,
      safety_config: safety,
      source_types: input.sourceTypes ?? [],
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
    objectType: "campaign_filter",
    objectId: data.id,
    actionType: "create",
    prompt: input.prompt,
    afterState: data,
    riskLevel: status === "active" ? "medium" : "low",
  });
  return data;
}

export async function updateCampaignFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  id: string;
  patch: Partial<{
    name: string;
    description: string | null;
    filterConfig: unknown;
    safetyConfig: unknown;
    sourceTypes: string[];
    status: "draft" | "active" | "archived";
  }>;
  prompt?: string | null;
}) {
  const current = await getCurrent("campaign_filter", input.workspaceId, input.id);
  const activating = input.patch.status === "active" && current.status !== "active";
  const archiving = input.patch.status === "archived";
  if (activating || archiving) assertRole(canActivate(input.role), archiving ? "archive filters" : "activate filters");
  else assertRole(canDraft(input.role), "edit filters");

  // Activation of a filter attached to an active campaign is high-risk:
  // only admins may do it (enforced above) and it is audited as high risk.
  let riskLevel = "low";
  if (activating) {
    const { count } = await (supabaseAdmin as any)
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", input.workspaceId)
      .eq("status", "active")
      .like("description", "%__sched_v1__%")
      .ilike("description", `%${input.id}%`);
    riskLevel = (count ?? 0) > 0 ? "high" : "medium";
  }

  const update: any = { updated_at: new Date().toISOString() };
  if (input.patch.name !== undefined) update.name = input.patch.name.slice(0, 120);
  if (input.patch.description !== undefined) update.description = input.patch.description;
  if (input.patch.sourceTypes !== undefined) update.source_types = input.patch.sourceTypes;
  if (input.patch.status !== undefined) update.status = input.patch.status;
  if (input.patch.filterConfig !== undefined) {
    const v = validateFilterConfig(input.patch.filterConfig);
    if (!v.ok) throw new Error(`Invalid filter: ${v.errors.join("; ")}`);
    update.filter_config = v.config;
  }
  if (input.patch.safetyConfig !== undefined) {
    update.safety_config = safetyConfigSchema.parse(input.patch.safetyConfig);
  }
  if (input.prompt) update.systemmind_prompt = input.prompt;

  await snapshotRow("campaign_filter", current);
  update.version = (current.version ?? 1) + 1;

  const { data, error } = await (supabaseAdmin as any)
    .from("workspace_campaign_filters")
    .update(update)
    .eq("id", input.id)
    .eq("workspace_id", input.workspaceId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "campaign_filter",
    objectId: input.id,
    actionType: archiving ? "archive" : activating ? "apply" : "update",
    prompt: input.prompt,
    beforeState: current,
    afterState: data,
    riskLevel,
  });
  return data;
}

export async function convertViewToCampaignFilter(input: {
  workspaceId: string;
  userId: string | null;
  role: WorkspaceRole;
  viewId: string;
}) {
  assertRole(canDraft(input.role), "convert views");
  const view = await getCurrent("people_view", input.workspaceId, input.viewId);
  const created = await createCampaignFilter({
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    name: `${view.name} (campaign filter)`,
    description: view.description,
    filterConfig: view.filter_config,
    status: "draft",
    createdBySystemMind: view.created_by_systemmind,
  });
  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: "campaign_filter",
    objectId: created.id,
    actionType: "convert_from_view",
    beforeState: { viewId: input.viewId },
    afterState: created,
    riskLevel: "low",
  });
  return created;
}

// ── Dry-run wrapper (records result + audit) ─────────────────────────────────

export async function dryRunAndRecord(input: {
  objectType: ObjectType;
  workspaceId: string;
  userId: string | null;
  id?: string | null;
  filterConfig: unknown;
  safetyConfig?: unknown;
}): Promise<DryRunResult> {
  const safety = input.safetyConfig ? safetyConfigSchema.parse(input.safetyConfig) : DEFAULT_SAFETY;
  const result = await runFilterDryRun(
    supabaseAdmin as any,
    input.workspaceId,
    input.filterConfig,
    { mode: input.objectType === "campaign_filter" ? "campaign" : "view", safety },
  );

  if (input.id) {
    await (supabaseAdmin as any)
      .from(TABLE[input.objectType])
      .update({ last_dry_run: result, last_dry_run_at: result.ranAt })
      .eq("id", input.id)
      .eq("workspace_id", input.workspaceId);
  }

  await writeViewAudit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    objectType: input.objectType,
    objectId: input.id ?? null,
    actionType: "dry_run",
    dryRunResult: result,
    riskLevel: result.riskLevel,
  });
  return result;
}

/** Safe-listed sortable leads columns for saved-view sort_config. */
const SORTABLE_LEAD_COLUMNS = new Set([
  "full_name", "status", "sentiment", "source", "call_outcome",
  "callback_date", "created_at", "updated_at", "last_contacted_at",
  "lead_score", "attempt_count",
]);

/** Read-only: run a saved active people view and return matching leads. */
export async function runPeopleView(
  workspaceId: string,
  viewId: string,
  limit = 200,
  role?: WorkspaceRole,
  /** When set, only leads assigned to this user are returned (assignedRecordsOnly roles). */
  assignedToUserId?: string | null,
) {
  const view = await getCurrent("people_view", workspaceId, viewId);
  if (role && Array.isArray(view.visible_to_roles) && !view.visible_to_roles.includes(role)) {
    throw new Error("This view is not visible to your workspace role.");
  }
  const v = validateFilterConfig(view.filter_config);
  if (!v.ok || !v.config) throw new Error(`View has an invalid filter: ${v.errors.join("; ")}`);

  const sort = (view.sort_config ?? {}) as { field?: string; direction?: string };
  const sortCol = sort.field && SORTABLE_LEAD_COLUMNS.has(sort.field) ? sort.field : "updated_at";
  const ascending = sort.direction === "asc";

  let q = (supabaseAdmin as any)
    .from("leads")
    .select("id, full_name, phone, email, status, sentiment, source, call_outcome, callback_requested, callback_date, meeting_requested, created_at, last_contacted_at, meta")
    .eq("workspace_id", workspaceId)
    .order(sortCol, { ascending })
    .limit(Math.min(limit, 500));
  if (assignedToUserId) q = q.eq("assigned_to", assignedToUserId);
  q = applyFilterToQuery(q, v.config);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { view, rows: data ?? [] };
}
