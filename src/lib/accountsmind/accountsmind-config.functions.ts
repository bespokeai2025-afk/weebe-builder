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
export const getClientVisibleConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listActiveConfigServer, computeMetricsServer, snapshotMetricsServer, getMetricSeriesServer } =
      await import("@/lib/accountsmind/accountsmind-config.server");
    const workspaceId = requireWorkspaceId(context.workspaceId);
    const config = await listActiveConfigServer(workspaceId, { clientOnly: true });
    const keys = [
      ...config.stats.map((s: any) => s.metric_key),
      ...config.widgets.map((w: any) => w.metric_key),
    ];
    const metrics = await computeMetricsServer(workspaceId, keys);
    // Record today's values so trend/progress widgets accumulate real history.
    await snapshotMetricsServer(workspaceId, metrics);
    // Series ONLY for metrics already referenced by client-visible defs —
    // sensitive metrics are never client_visible, so no visibility change.
    const seriesKeys = config.widgets
      .filter((w: any) => w.widget_type === "trend" || w.widget_type === "progress")
      .map((w: any) => w.metric_key)
      .filter(Boolean);
    const series = await getMetricSeriesServer(workspaceId, seriesKeys, 30);
    return { ...config, metrics, series };
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
    const { getMetricSeriesServer } = await import(
      "@/lib/accountsmind/accountsmind-config.server"
    );
    return getMetricSeriesServer(
      requireWorkspaceId(context.workspaceId),
      data.keys,
      data.days ?? 30,
    );
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
