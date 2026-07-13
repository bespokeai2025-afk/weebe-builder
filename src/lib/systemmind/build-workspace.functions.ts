import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export const createBuildSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      title:            z.string().max(200).optional(),
      sourcePage:       z.string().max(60).optional(),
      targetAgentId:    z.string().uuid().nullable().optional(),
      linkedWorkflowId: z.string().uuid().nullable().optional(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { createBuildSessionServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return createBuildSessionServer({
      workspaceId:      requireWorkspaceId(context.workspaceId),
      userId:           context.userId ?? null,
      title:            data.title,
      sourcePage:       data.sourcePage,
      targetAgentId:    data.targetAgentId ?? null,
      linkedWorkflowId: data.linkedWorkflowId ?? null,
    });
  });

export const listBuildSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listBuildSessionsServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return listBuildSessionsServer(requireWorkspaceId(context.workspaceId));
  });

export const getBuildSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getBuildSessionServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return getBuildSessionServer(requireWorkspaceId(context.workspaceId), data.sessionId);
  });

export const setBuildSessionArchived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), archived: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { setBuildSessionArchivedServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    await setBuildSessionArchivedServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sessionId:   data.sessionId,
      archived:    data.archived,
    });
    return { ok: true };
  });

// ── Prompt (generation / iteration) ───────────────────────────────────────────

export const promptBuildSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      prompt:    z.string().min(3).max(8000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { promptBuildSessionServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return promptBuildSessionServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sessionId:   data.sessionId,
      prompt:      data.prompt,
    });
  });

// ── Versions: restore / notes ─────────────────────────────────────────────────

export const restoreBuildVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), versionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { restoreBuildVersionServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return restoreBuildVersionServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sessionId:   data.sessionId,
      versionId:   data.versionId,
    });
  });

export const setBuildVersionNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sessionId: z.string().uuid(),
      versionId: z.string().uuid(),
      notes:     z.string().max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { setBuildVersionNotesServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    await setBuildVersionNotesServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sessionId:   data.sessionId,
      versionId:   data.versionId,
      notes:       data.notes,
    });
    return { ok: true };
  });

// ── Simulate / Apply / Deploy ─────────────────────────────────────────────────

export const simulateBuildVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), versionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { simulateBuildVersionServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return simulateBuildVersionServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sessionId:   data.sessionId,
      versionId:   data.versionId,
    });
  });

export const getBuildApplySafetyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), versionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getBuildApplySafetyReportServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return getBuildApplySafetyReportServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sessionId:   data.sessionId,
      versionId:   data.versionId,
    });
  });

export const applyBuildVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sessionId:    z.string().uuid(),
      versionId:    z.string().uuid(),
      mode:         z.enum(["direct", "new_draft", "duplicate_edit", "propose"]).optional(),
      goLiveIntent: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { applyBuildVersionServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return applyBuildVersionServer({
      workspaceId:  requireWorkspaceId(context.workspaceId),
      userId:       context.userId ?? null,
      sessionId:    data.sessionId,
      versionId:    data.versionId,
      mode:         data.mode,
      goLiveIntent: data.goLiveIntent,
    });
  });

export const rollbackBuildApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid(), snapshotId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { rollbackBuildApplyServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return rollbackBuildApplyServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sessionId:   data.sessionId,
      snapshotId:  data.snapshotId,
    });
  });

export const markBuildVersionDeployed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sessionId:    z.string().uuid(),
      versionId:    z.string().uuid(),
      deployTarget: z.string().max(200).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { markBuildVersionDeployedServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    await markBuildVersionDeployedServer({
      workspaceId:  requireWorkspaceId(context.workspaceId),
      userId:       context.userId ?? null,
      sessionId:    data.sessionId,
      versionId:    data.versionId,
      deployTarget: data.deployTarget,
    });
    return { ok: true };
  });

// ── Provenance (Deploy tab / Workflows page) ──────────────────────────────────

export const getBuildProvenanceForAgent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ agentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { getBuildProvenanceForAgentServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return getBuildProvenanceForAgentServer(
      requireWorkspaceId(context.workspaceId),
      data.agentId,
    );
  });

// ── Usage (member-safe) ───────────────────────────────────────────────────────

export const getSystemMindUsageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).default(30) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { getSystemMindUsageSummaryServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    const sinceIso = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();
    return getSystemMindUsageSummaryServer(requireWorkspaceId(context.workspaceId), sinceIso);
  });

// ── Admin: usage detail + pricing editor ──────────────────────────────────────

export const getSystemMindUsageAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: unknown) =>
    z.object({
      workspaceId:   z.string().uuid().optional(),
      monthStartIso: z.string().datetime({ offset: true }).optional(),
    }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { getSystemMindUsageAdminServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    // Admin can inspect any workspace; defaults to their active one.
    const wsId = data.workspaceId ?? requireWorkspaceId(context.workspaceId);
    const monthStart = data.monthStartIso
      ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    return getSystemMindUsageAdminServer(wsId, monthStart);
  });

export const getSystemMindPricing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { getCurrentSystemMindPricingServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return getCurrentSystemMindPricingServer();
  });

export const listSystemMindPricingHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { listSystemMindPricingHistoryServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return listSystemMindPricingHistoryServer();
  });

export const saveSystemMindPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input: unknown) =>
    z.object({
      base_charge_per_run_usd:    z.number().min(0).max(1000),
      charge_per_minute_usd:      z.number().min(0).max(1000),
      charge_per_1k_tokens_usd:   z.number().min(0).max(1000),
      charge_per_tool_call_usd:   z.number().min(0).max(1000),
      included_runs_per_month:    z.number().min(0).max(1000000),
      included_seconds_per_month: z.number().min(0).max(100000000),
      included_tokens_per_month:  z.number().min(0).max(1000000000),
      overage_multiplier:         z.number().min(0).max(100),
      expose_provider_cost:       z.boolean(),
      notes:                      z.string().max(2000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { saveSystemMindPricingServer } = await import(
      "@/lib/systemmind/build-workspace.server"
    );
    return saveSystemMindPricingServer({
      userId:  context.userId ?? null,
      pricing: data,
    });
  });
