import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

// ── generateOnboardingPlan ────────────────────────────────────────────────────
export const generateOnboardingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      description: z.string().min(10).max(4000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { generateOnboardingPlanServer } = await import(
      "@/lib/systemmind/workspace-setup.server"
    );
    return generateOnboardingPlanServer({
      workspaceId:  requireWorkspaceId(context.workspaceId),
      userId:       context.userId ?? null,
      description:  data.description,
      instructedBy: "user",
    });
  });

// ── getSetupChecklist (derived completion — re-checked live on every read) ────
export const getSetupChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { getSetupChecklistServer } = await import(
      "@/lib/systemmind/workspace-setup.server"
    );
    return getSetupChecklistServer(requireWorkspaceId(context.workspaceId));
  });

// ── runWorkspaceHealthCheck ───────────────────────────────────────────────────
export const runWorkspaceHealthCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { runWorkspaceHealthCheckServer } = await import(
      "@/lib/systemmind/workspace-setup.server"
    );
    return runWorkspaceHealthCheckServer(
      requireWorkspaceId(context.workspaceId),
      context.userId ?? null,
    );
  });

// ── listHealthRuns ────────────────────────────────────────────────────────────
export const listHealthRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { listHealthRunsServer } = await import(
      "@/lib/systemmind/workspace-setup.server"
    );
    return listHealthRunsServer(requireWorkspaceId(context.workspaceId));
  });

// ── listAvailableChecks (for UI display) ──────────────────────────────────────
export const listAvailableChecks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { CHECK_REGISTRY } = await import(
      "@/lib/systemmind/workspace-setup.server"
    );
    return Object.values(CHECK_REGISTRY).map(({ key, label, description, href, weight, category }) => ({
      key, label, description, href, weight, category,
    }));
  });
