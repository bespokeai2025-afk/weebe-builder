import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

// ── generateAccountsMindConfigDraft ───────────────────────────────────────────
export const generateAccountsMindConfigDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      description: z.string().min(10).max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { generateAccountsMindConfigDraftServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    return generateAccountsMindConfigDraftServer({
      workspaceId:  requireWorkspaceId(context.workspaceId),
      userId:       context.userId ?? null,
      description:  data.description,
      instructedBy: "user",
    });
  });

// ── listAccountsMindConfig ────────────────────────────────────────────────────
export const listAccountsMindConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ includeNonActive: z.boolean().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { listActiveConfigServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    return listActiveConfigServer(requireWorkspaceId(context.workspaceId), {
      includeNonActive: data.includeNonActive ?? true,
    });
  });

// ── getClientVisibleConfig (client-safe section — active + client_visible only)
// Full logic lives in getClientVisibleDashboardServer so the e2e suite can
// exercise the exact production path; sensitive (billing/cost) metrics are
// stripped there as defence-in-depth even if a row was tampered client_visible.
export const getClientVisibleConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getClientVisibleDashboardServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    return getClientVisibleDashboardServer(requireWorkspaceId(context.workspaceId));
  });

// ── computeAccountsMindMetrics (internal dashboard values) ───────────────────
export const computeAccountsMindMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ keys: z.array(z.string().max(80)).max(40) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { computeMetricsServer, snapshotMetricsServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    const workspaceId = requireWorkspaceId(context.workspaceId);
    const metrics = await computeMetricsServer(workspaceId, data.keys);
    await snapshotMetricsServer(workspaceId, metrics);
    return metrics;
  });

// ── getAccountsMindMetricSeries (historical snapshots for trend widgets) ─────
export const getAccountsMindMetricSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      keys: z.array(z.string().max(80)).max(40),
      days: z.number().int().min(1).max(90).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getMetricSeriesServer, ensureMetricHistoryBackfillServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    const workspaceId = requireWorkspaceId(context.workspaceId);
    // One-off history backfill so sparklines render immediately for existing
    // workspaces (best-effort, no-op once the window is full).
    await ensureMetricHistoryBackfillServer(workspaceId, data.keys, data.days ?? 30);
    return getMetricSeriesServer(workspaceId, data.keys, data.days ?? 30);
  });

// ── setConfigItemStatus ───────────────────────────────────────────────────────
export const setConfigItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      kind:   z.enum(["field", "stat", "widget"]),
      id:     z.string().uuid(),
      status: z.enum(["active", "paused", "hidden", "archived"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { setConfigItemStatusServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    await setConfigItemStatusServer(
      requireWorkspaceId(context.workspaceId),
      context.userId ?? null,
      data.kind,
      data.id,
      data.status,
    );
    return { ok: true };
  });

// ── rollbackConfigItem ────────────────────────────────────────────────────────
export const rollbackConfigItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      kind: z.enum(["field", "stat", "widget"]),
      id:   z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { rollbackConfigItemServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    return rollbackConfigItemServer(
      requireWorkspaceId(context.workspaceId),
      context.userId ?? null,
      data.kind,
      data.id,
    );
  });

// ── setAccountsMindFieldValue ─────────────────────────────────────────────────
export const setAccountsMindFieldValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      fieldDefId: z.string().uuid(),
      entityType: z.string().min(1).max(40),
      entityId:   z.string().min(1).max(200),
      value:      z.unknown().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { setFieldValueServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    await setFieldValueServer(
      requireWorkspaceId(context.workspaceId),
      context.userId ?? null,
      data.fieldDefId,
      data.entityType,
      data.entityId,
      data.value,
    );
    return { ok: true };
  });

// ── listAccountsMindFieldValues ───────────────────────────────────────────────
export const listAccountsMindFieldValues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      entityType: z.string().min(1).max(40),
      entityId:   z.string().min(1).max(200),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { listFieldValuesServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    return listFieldValuesServer(
      requireWorkspaceId(context.workspaceId),
      data.entityType,
      data.entityId,
    );
  });

// ── Industry-aware setup (workspace-scoped; owner/admin only for writes) ─────

export const getAccountsMindIndustryState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = requireWorkspaceId(context.workspaceId);
    const [{ getWorkspaceIndustryServer }, { listIndustryOptions }, { resolvePermissions }] =
      await Promise.all([
        import("@/lib/accountsmind/industry.server"),
        import("@/lib/accountsmind/industry-presets.shared"),
        import("@/lib/permissions/permissions.server"),
      ]);
    const [industry, perms] = await Promise.all([
      getWorkspaceIndustryServer(workspaceId),
      resolvePermissions(workspaceId, context.userId ?? null),
    ]);
    const canManage =
      perms.isMember && (perms.legacyRole === "owner" || perms.legacyRole === "admin");
    return { industry, options: listIndustryOptions(), canManage };
  });

export const applyAccountsMindIndustryPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ industryKey: z.string().min(1).max(60) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const workspaceId = requireWorkspaceId(context.workspaceId);
    const userId = context.userId ?? null;
    const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
    const perms = await resolvePermissions(workspaceId, userId);
    if (!perms.isMember || (perms.legacyRole !== "owner" && perms.legacyRole !== "admin")) {
      throw new Error("Only a workspace owner or admin can change the dashboard industry setup.");
    }
    const { applyIndustryPresetServer } = await import("@/lib/accountsmind/industry.server");
    return applyIndustryPresetServer({ workspaceId, userId, industryKey: data.industryKey });
  });

// ── listAvailableMetrics (for the setup UI) ───────────────────────────────────
export const listAvailableMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { METRIC_REGISTRY } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    return Object.values(METRIC_REGISTRY).map(({ key, label, description, format, sensitive }) => ({
      key, label, description, format, sensitive,
    }));
  });
