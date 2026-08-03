/**
 * Execution snapshot persistence — save/load/resume state for wait nodes.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ExecutionSnapshot } from "../types/execution.schema";
import { ExecutionSnapshotSchema } from "../types/execution.schema";

const sb = supabaseAdmin as any;

export async function saveExecutionSnapshot(
  workspaceId: string,
  snapshot: ExecutionSnapshot,
): Promise<void> {
  const parsed = ExecutionSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new Error(`Invalid snapshot: ${parsed.error.message}`);
  }

  const { error } = await sb
    .from("automation_workflow_executions")
    .update({
      status: snapshot.status,
      snapshot: parsed.data,
      last_error: snapshot.lastError ?? null,
      completed_at: snapshot.completedAt ?? null,
    })
    .eq("id", snapshot.executionId)
    .eq("workspace_id", workspaceId);

  if (error) throw new Error(error.message);
}

export async function loadExecutionSnapshot(
  workspaceId: string,
  executionId: string,
): Promise<ExecutionSnapshot | null> {
  const { data, error } = await sb
    .from("automation_workflow_executions")
    .select("snapshot, status")
    .eq("workspace_id", workspaceId)
    .eq("id", executionId)
    .maybeSingle();

  if (error || !data?.snapshot) return null;
  const parsed = ExecutionSnapshotSchema.safeParse(data.snapshot);
  return parsed.success ? parsed.data : null;
}

export async function findExecutionByWaitToken(
  token: string,
): Promise<{ workspaceId: string; executionId: string } | null> {
  const { data, error } = await sb
    .from("automation_workflow_executions")
    .select("id, workspace_id, snapshot, status")
    .eq("status", "waiting")
    .limit(50);

  if (error || !data?.length) return null;

  for (const row of data as Array<{ id: string; workspace_id: string; snapshot: unknown }>) {
    const snap = ExecutionSnapshotSchema.safeParse(row.snapshot);
    if (snap.success && snap.data.waitingOn?.token === token) {
      return { workspaceId: String(row.workspace_id), executionId: String(row.id) };
    }
  }
  return null;
}

export async function listWaitingExecutionsDue(
  limit = 20,
): Promise<Array<{ workspaceId: string; executionId: string; until?: string }>> {
  const { data, error } = await sb
    .from("automation_workflow_executions")
    .select("id, workspace_id, snapshot")
    .eq("status", "waiting")
    .limit(limit);

  if (error || !data?.length) return [];

  const now = Date.now();
  const due: Array<{ workspaceId: string; executionId: string; until?: string }> = [];

  for (const row of data as Array<{ id: string; workspace_id: string; snapshot: unknown }>) {
    const snap = ExecutionSnapshotSchema.safeParse(row.snapshot);
    if (!snap.success || !snap.data.waitingOn) continue;
    const wait = snap.data.waitingOn;
    if (wait.type === "delay") {
      if (!wait.until || new Date(wait.until).getTime() <= now) {
        due.push({
          workspaceId: String(row.workspace_id),
          executionId: String(row.id),
          until: wait.until,
        });
      }
    }
  }
  return due;
}
