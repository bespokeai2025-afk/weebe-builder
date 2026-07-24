/**
 * GrowthMind commercial objectives — HiveMind-managed, SERVER ONLY.
 *
 * Objectives are the durable commercial context HiveMind sets for GrowthMind
 * ("what marketing is for"). Table is members-read / server-write
 * (growthmind_objectives, migration 20260724180000).
 */
import { z } from "zod";

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export const ObjectiveInput = z.object({
  id:                   z.string().uuid().optional(),
  name:                 z.string().min(3).max(300),
  businessOutcome:      z.string().max(2000).optional(),
  targetAudience:       z.string().max(2000).optional(),
  targetProduct:        z.string().max(1000).optional(),
  platforms:            z.array(z.string().max(50)).max(10).optional(),
  startDate:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority:             z.enum(["low", "medium", "high", "critical"]).optional(),
  budgetLimitUsd:       z.number().min(0).max(10_000_000).nullable().optional(),
  contentVolume:        z.number().int().min(0).max(10_000).nullable().optional(),
  approvalRequirements: z.string().max(2000).optional(),
  successMetrics:       z.array(z.string().max(300)).max(20).optional(),
});
export type ObjectiveInputT = z.infer<typeof ObjectiveInput>;

export async function listGrowthMindObjectives(workspaceId: string, includeClosed = false) {
  const admin = await getAdmin();
  let q = admin.from("growthmind_objectives").select("*").eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false }).limit(50);
  if (!includeClosed) q = q.in("status", ["active", "paused"]);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveGrowthMindObjective(
  workspaceId: string,
  userId: string | null,
  input: ObjectiveInputT,
): Promise<{ id: string; created: boolean }> {
  const admin = await getAdmin();
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    name:                  input.name,
    business_outcome:      input.businessOutcome ?? null,
    target_audience:       input.targetAudience ?? null,
    target_product:        input.targetProduct ?? null,
    approval_requirements: input.approvalRequirements ?? null,
    updated_at:            now,
  };
  if (input.platforms !== undefined) row.platforms = input.platforms;
  if (input.startDate !== undefined) row.start_date = input.startDate;
  if (input.endDate !== undefined) row.end_date = input.endDate;
  if (input.priority !== undefined) row.priority = input.priority;
  if (input.budgetLimitUsd !== undefined) row.budget_limit_usd = input.budgetLimitUsd;
  if (input.contentVolume !== undefined) row.content_volume = input.contentVolume;
  if (input.successMetrics !== undefined) row.success_metrics = input.successMetrics;

  if (input.id) {
    const { data, error } = await admin.from("growthmind_objectives")
      .update(row)
      .eq("id", input.id).eq("workspace_id", workspaceId)
      .select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Objective not found in this workspace.");
    return { id: data.id as string, created: false };
  }
  const { data, error } = await admin.from("growthmind_objectives")
    .insert({ workspace_id: workspaceId, created_by: userId, status: "active", ...row })
    .select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, created: true };
}

export async function setGrowthMindObjectiveStatus(
  workspaceId: string,
  objectiveId: string,
  status: "active" | "paused" | "completed" | "cancelled",
): Promise<void> {
  const admin = await getAdmin();
  const { data, error } = await admin.from("growthmind_objectives")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", objectiveId).eq("workspace_id", workspaceId)
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Objective not found in this workspace.");
}
