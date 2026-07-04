/**
 * SystemMind Intelligence Settings — SERVER ONLY (Task #298).
 * Loaded dynamically inside admin-gated createServerFn handlers.
 *
 * Per-workspace settings for the Intelligence area: the confidence threshold
 * (templates scoring >= it are "recommended" by the Deployment Planner) and the
 * autonomous-deployment flag.
 *
 * SAFETY: `autonomous_deployment_enabled` is READ-ONLY here — there is no write
 * path that flips it on. `updateIntelligenceSettings` whitelists the threshold
 * only. The deployment layer asserts execution is disabled regardless.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isRelationMissing, DEFAULT_CONFIDENCE_THRESHOLD } from "@/lib/systemmind/confidence-engine.server";
import { AUTONOMOUS_DEPLOYMENT_ENABLED } from "@/lib/systemmind/deployment-execution.contract";

export interface IntelligenceSettings {
  applied: boolean; // false when the migration has not been applied yet
  confidence_threshold: number;
  autonomous_deployment_enabled: boolean; // always false — descriptive/plan-only
}

function clampThreshold(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_CONFIDENCE_THRESHOLD;
  return Math.max(0, Math.min(100, v));
}

/** Read settings, defaulting when no row (or table) exists yet. */
export async function getIntelligenceSettings(workspaceId: string): Promise<IntelligenceSettings> {
  const sb = supabaseAdmin as any;
  try {
    const { data, error } = await sb
      .from("systemmind_intelligence_settings")
      .select("confidence_threshold, autonomous_deployment_enabled")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) {
      if (isRelationMissing(error)) {
        return { applied: false, confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD, autonomous_deployment_enabled: false };
      }
      throw new Error(error.message);
    }
    return {
      applied: true,
      confidence_threshold: data?.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
      // Never trust a stray DB value over the code-level policy.
      autonomous_deployment_enabled: AUTONOMOUS_DEPLOYMENT_ENABLED && !!data?.autonomous_deployment_enabled,
    };
  } catch (e) {
    if (isRelationMissing(e)) {
      return { applied: false, confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD, autonomous_deployment_enabled: false };
    }
    throw e;
  }
}

/**
 * Update the confidence threshold ONLY. `autonomous_deployment_enabled` is never
 * written here — it stays false. Upserts the single per-workspace row.
 */
export async function updateIntelligenceSettings(
  workspaceId: string,
  confidenceThreshold: number,
  userId: string | null,
): Promise<IntelligenceSettings> {
  const sb = supabaseAdmin as any;
  const threshold = clampThreshold(confidenceThreshold);
  const now = new Date().toISOString();
  const { error } = await sb
    .from("systemmind_intelligence_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        confidence_threshold: threshold, // ONLY writable field
        updated_by: userId,
        updated_at: now,
      },
      { onConflict: "workspace_id" },
    );
  if (error) {
    if (isRelationMissing(error)) throw new Error("MIGRATION_NOT_APPLIED");
    throw new Error(error.message);
  }
  return { applied: true, confidence_threshold: threshold, autonomous_deployment_enabled: false };
}
