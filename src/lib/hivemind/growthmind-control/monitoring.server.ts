/**
 * HiveMind monitoring of GrowthMind — SERVER ONLY.
 *
 * Runs the deterministic operational health checks and turns ACTIONABLE
 * issues into HiveMind tasks (status "suggested" — nothing auto-executes).
 * Dedup relies on the open-task partial unique index on
 * (workspace_id, trigger_type, entity_id): inserts happen row-by-row and a
 * 23505 conflict simply means the task is already open.
 */

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const SEVERITY_TO_PRIORITY: Record<string, string> = {
  critical: "critical",
  warning:  "high",
  info:     "medium",
};

export interface MonitoringSweepResult {
  checked: number;
  tasksCreated: number;
  deduped: number;
}

/** Sweep one workspace: health checks → deduped suggested tasks. */
export async function runGrowthMindMonitoringSweep(workspaceId: string): Promise<MonitoringSweepResult> {
  const { checkGrowthMindOperationalHealth } = await import("@/lib/hivemind/growthmind-control/executive-view.server");
  const health = await checkGrowthMindOperationalHealth(workspaceId);
  const admin = await getAdmin();

  let tasksCreated = 0;
  let deduped = 0;
  const actionable = health.checks.filter((c) => !c.ok && (c.severity === "critical" || c.severity === "warning"));
  for (const check of actionable) {
    const { error } = await admin.from("hivemind_tasks").insert({
      workspace_id: workspaceId,
      title:        `Marketing: ${check.message}`.slice(0, 300),
      description:  check.recommendedTool
        ? `GrowthMind health check "${check.key}" is failing. Suggested tool: ${check.recommendedTool}.`
        : `GrowthMind health check "${check.key}" is failing.`,
      priority:     SEVERITY_TO_PRIORITY[check.severity] ?? "medium",
      status:       "suggested",
      source:       "growthmind_monitoring",
      trigger_type: "growthmind_health",
      entity_type:  "growthmind_health_check",
      entity_id:    check.key,
      metadata:     { severity: check.severity, checkKey: check.key, recommendedTool: check.recommendedTool ?? null, detectedAt: new Date().toISOString() },
    });
    if (!error) tasksCreated++;
    else if (error.code === "23505") deduped++;
    else console.warn("[growthmind-monitoring] task insert failed:", error.message);
  }
  return { checked: health.checks.length, tasksCreated, deduped };
}
