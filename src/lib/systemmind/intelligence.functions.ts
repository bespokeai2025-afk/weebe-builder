// ── SystemMind Intelligence — server functions (admin-only) ───────────────────
// Client-callable entry points for the SystemMind Intelligence area:
// confidence scoring, deployment planning (DESCRIPTIVE — never executed),
// readiness dashboard, learning queue, suggested improvements, and settings.
//
// Every function is gated by requireSupabaseAuth + requirePlatformAdmin and
// scoped to the caller's workspace. Reads the template/discovery/graph tables and
// writes only confidence scores, deployment plans, and the confidence threshold.
// NOTHING here deploys or provisions anything.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

const idInput = (input: unknown) => z.object({ id: z.string().uuid() }).parse(input);

async function resolveThreshold(workspaceId: string): Promise<number> {
  const { getIntelligenceSettings } = await import("@/lib/systemmind/intelligence-settings.server");
  const s = await getIntelligenceSettings(workspaceId);
  return s.confidence_threshold;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export const getIntelligenceSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { getIntelligenceSettings } = await import("@/lib/systemmind/intelligence-settings.server");
    return getIntelligenceSettings(workspaceId);
  });

export const updateIntelligenceSettingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  // Whitelist: ONLY the confidence threshold is writable. autonomous_deployment_enabled
  // is intentionally absent — it has no write path anywhere.
  .inputValidator((input) => z.object({ confidence_threshold: z.number().int().min(0).max(100) }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { updateIntelligenceSettings } = await import("@/lib/systemmind/intelligence-settings.server");
    return updateIntelligenceSettings(workspaceId, data.confidence_threshold, userId ?? null);
  });

// ── Confidence engine ──────────────────────────────────────────────────────────

export const scoreTemplatesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { scoreAllTemplates } = await import("@/lib/systemmind/confidence-engine.server");
    return scoreAllTemplates(workspaceId);
  });

export const listTemplateConfidenceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const threshold = await resolveThreshold(workspaceId);
    const { listTemplateConfidence } = await import("@/lib/systemmind/confidence-engine.server");
    return listTemplateConfidence(workspaceId, threshold);
  });

// ── Deployment planner (descriptive; never executed) ──────────────────────────

export const generateDeploymentPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((input) =>
    z.object({ requestText: z.string().min(4).max(2000) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    // API key resolved SERVER-SIDE only — never accepted from the client.
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key ?? "";
    const threshold = await resolveThreshold(workspaceId);
    const { generateDeploymentPlan } = await import("@/lib/systemmind/deployment-planner.server");
    return generateDeploymentPlan(workspaceId, data.requestText, threshold, apiKey);
  });

export const listDeploymentPlansFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { listDeploymentPlans } = await import("@/lib/systemmind/deployment-planner.server");
    return listDeploymentPlans(workspaceId);
  });

export const getDeploymentPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { getDeploymentPlan } = await import("@/lib/systemmind/deployment-planner.server");
    return getDeploymentPlan(workspaceId, data.id);
  });

export const deleteDeploymentPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator(idInput)
  .handler(async ({ context, data }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { deleteDeploymentPlan } = await import("@/lib/systemmind/deployment-planner.server");
    return deleteDeploymentPlan(workspaceId, data.id);
  });

// ── Derived intelligence views ─────────────────────────────────────────────────

export const getReadinessDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const threshold = await resolveThreshold(workspaceId);
    const { buildReadinessDashboard } = await import("@/lib/systemmind/deployment-planner.server");
    return buildReadinessDashboard(workspaceId, threshold);
  });

export const listLearningQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { listLearningQueue } = await import("@/lib/systemmind/deployment-planner.server");
    return listLearningQueue(workspaceId);
  });

export const listSuggestedImprovementsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async ({ context }) => {
    const { workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const threshold = await resolveThreshold(workspaceId);
    const { listSuggestedImprovements } = await import("@/lib/systemmind/deployment-planner.server");
    return listSuggestedImprovements(workspaceId, threshold);
  });
