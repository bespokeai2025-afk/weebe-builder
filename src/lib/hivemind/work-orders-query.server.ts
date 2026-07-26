/**
 * Work-order query layer — surfaces staged work orders with their linked
 * HiveMind tasks, per-stage readiness/blockers, and intelligence-packet
 * audit findings so the UI can render a consumable detail view.
 *
 * All reads are workspace-scoped; no cross-workspace data is ever returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { UniversalMindIntelligencePacket } from "@/lib/minds/intelligence-packet.shared";
import { READINESS_LABELS, isApprovableReadiness } from "@/lib/minds/intelligence-packet.shared";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkOrderStatus =
  | "open" | "in_progress" | "awaiting_approval" | "blocked"
  | "partially_completed" | "completed" | "cancelled" | "failed";

export interface WorkOrderStageTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  readiness_state: string | null;
  execution_status: string | null;
  task_category: string | null;
  metadata: Record<string, unknown> | null;
  intelligence_packet: UniversalMindIntelligencePacket | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderSummary {
  id: string;
  title: string;
  objective: string | null;
  status: WorkOrderStatus;
  source: string | null;
  readiness_state: string | null;
  assigned_minds: string[];
  metadata: Record<string, unknown> | null;
  intelligence_packet: UniversalMindIntelligencePacket | null;
  created_at: string;
  updated_at: string;
  stage_tasks: WorkOrderStageTask[];
  /** Derived: stage count, completed stages, blockers */
  stage_count: number;
  completed_stages: number;
  blocker_count: number;
  /** The approval stage key from task.metadata.approval_stage (or null) */
  channel_kind: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBlockedTask(task: WorkOrderStageTask): boolean {
  const blockers = task.intelligence_packet?.blockers ?? [];
  return (
    task.readiness_state === "blocked" ||
    task.readiness_state === "integration_required" ||
    task.execution_status === "blocked" ||
    task.execution_status === "failed" ||
    blockers.length > 0
  );
}

function toWorkOrderSummary(wo: any, tasks: any[]): WorkOrderSummary {
  const stageTasks: WorkOrderStageTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    readiness_state: t.readiness_state ?? null,
    execution_status: t.execution_status ?? null,
    task_category: t.task_category ?? null,
    metadata: (t.metadata ?? null) as Record<string, unknown> | null,
    intelligence_packet: (t.intelligence_packet ?? null) as UniversalMindIntelligencePacket | null,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));

  return {
    id: wo.id,
    title: wo.title,
    objective: wo.objective ?? null,
    status: (wo.status ?? "open") as WorkOrderStatus,
    source: wo.source ?? null,
    readiness_state: wo.readiness_state ?? null,
    assigned_minds: (wo.assigned_minds ?? []) as string[],
    metadata: (wo.metadata ?? null) as Record<string, unknown> | null,
    intelligence_packet: (wo.intelligence_packet ?? null) as UniversalMindIntelligencePacket | null,
    created_at: wo.created_at,
    updated_at: wo.updated_at,
    stage_tasks: stageTasks,
    stage_count: stageTasks.length,
    completed_stages: stageTasks.filter((t) => t.status === "completed").length,
    blocker_count: stageTasks.filter(isBlockedTask).length,
    channel_kind: (wo.metadata as any)?.channel_kind ?? null,
  };
}

// ── Server functions ──────────────────────────────────────────────────────────

export async function getWorkOrdersCore(
  sb: any,
  workspaceId: string,
  opts: { activeOnly?: boolean; mind?: string | null } = {},
): Promise<WorkOrderSummary[]> {
  let q = sb
    .from("work_orders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (opts.activeOnly) {
    q = q.not("status", "in", '("completed","cancelled")');
  }

  const { data: workOrders, error: woErr } = await q;
  if (woErr) throw new Error(woErr.message);
  if (!workOrders?.length) return [];

  const ids: string[] = workOrders.map((wo: any) => wo.id);

  const { data: taskRows, error: taskErr } = await sb
    .from("hivemind_tasks")
    .select("id, title, description, status, readiness_state, execution_status, task_category, metadata, intelligence_packet, work_order_id, created_at, updated_at")
    .eq("workspace_id", workspaceId)
    .in("work_order_id", ids)
    .order("created_at", { ascending: true });

  if (taskErr) throw new Error(taskErr.message);

  const tasksByWo: Record<string, any[]> = {};
  for (const t of taskRows ?? []) {
    if (!tasksByWo[t.work_order_id]) tasksByWo[t.work_order_id] = [];
    tasksByWo[t.work_order_id].push(t);
  }

  return workOrders.map((wo: any) => toWorkOrderSummary(wo, tasksByWo[wo.id] ?? []));
}

export const getWorkOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    return (await getWorkOrdersCore(context.supabase as any, workspaceId, { activeOnly: false })) as any;
  });

export const getWorkOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = context.supabase as any;

    const { data: wo, error } = await sb
      .from("work_orders")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!wo) throw new Error("Work order not found");

    const { data: taskRows, error: taskErr } = await sb
      .from("hivemind_tasks")
      .select("id, title, description, status, readiness_state, execution_status, task_category, metadata, intelligence_packet, work_order_id, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("work_order_id", data.id)
      .order("created_at", { ascending: true });

    if (taskErr) throw new Error(taskErr.message);

    return toWorkOrderSummary(wo, taskRows ?? []) as any;
  });

// ── Derived label helpers (shared with UI) ────────────────────────────────────

export function workOrderStatusLabel(status: WorkOrderStatus): string {
  const MAP: Record<WorkOrderStatus, string> = {
    open:                 "Open",
    in_progress:          "In Progress",
    awaiting_approval:    "Awaiting Approval",
    blocked:              "Blocked",
    partially_completed:  "Partially Complete",
    completed:            "Completed",
    cancelled:            "Cancelled",
    failed:               "Failed",
  };
  return MAP[status] ?? status;
}

export function workOrderProgressPct(wo: WorkOrderSummary): number {
  if (!wo.stage_count) return 0;
  return Math.round((wo.completed_stages / wo.stage_count) * 100);
}

export function stageReadinessLabel(state: string | null | undefined): string {
  if (!state) return "";
  return READINESS_LABELS[state as keyof typeof READINESS_LABELS] ?? state;
}

export function stageIsApprovable(state: string | null | undefined): boolean {
  return isApprovableReadiness(state);
}

export function stageBlockers(task: WorkOrderStageTask): string[] {
  const blockers: string[] = [];
  const pkt = task.intelligence_packet;
  if (pkt?.blockers?.length) {
    for (const b of pkt.blockers) {
      blockers.push(b.detail);
    }
  }
  if (task.execution_status === "blocked" && !blockers.length) {
    blockers.push("Execution blocked — prior stages may need approval.");
  }
  if (task.execution_status === "failed" && !blockers.length) {
    blockers.push("Execution failed.");
  }
  return blockers;
}

export function packetAuditFindings(pkt: UniversalMindIntelligencePacket | null): Array<{ label: string; value: string | number | null }> {
  if (!pkt) return [];
  const out: Array<{ label: string; value: string | number | null }> = [];

  for (const ev of pkt.evidence ?? []) {
    if (!ev.data) continue;
    const d = ev.data as Record<string, unknown>;

    // Sales pipeline / audit fields
    if (typeof d.stalled === "number")              out.push({ label: "Stalled leads",              value: d.stalled });
    if (typeof d.never_contacted === "number")      out.push({ label: "Never contacted",             value: d.never_contacted });
    if (typeof d.missing_contact_info === "number") out.push({ label: "Missing contact info",        value: d.missing_contact_info });
    if (typeof d.duplicate_phones === "number")     out.push({ label: "Duplicate phone numbers",     value: d.duplicate_phones });
    if (typeof d.missing_critical_fields === "number") out.push({ label: "Missing critical fields",  value: d.missing_critical_fields });
    if (typeof d.conversion_pct === "number")       out.push({ label: "Conversion rate",             value: `${d.conversion_pct}%` });
    if (typeof d.won === "number")                  out.push({ label: "Won leads",                   value: d.won });
    if (typeof d.lost_without_reason === "number")  out.push({ label: "Lost without reason",         value: d.lost_without_reason });

    // Channel audience / compliance fields
    if (typeof d.eligible === "number")             out.push({ label: "Eligible audience",           value: d.eligible });
    if (typeof d.excluded === "object" && d.excluded) {
      const ex = d.excluded as Record<string, unknown>;
      if (typeof ex.opted_out === "number" && ex.opted_out > 0)   out.push({ label: "Opted out",       value: ex.opted_out });
      if (typeof ex.suppressed === "number" && ex.suppressed > 0)  out.push({ label: "Suppressed",      value: ex.suppressed });
      if (typeof ex.no_phone === "number" && ex.no_phone > 0)      out.push({ label: "No phone",        value: ex.no_phone });
      if (typeof ex.no_email === "number" && ex.no_email > 0)      out.push({ label: "No email",        value: ex.no_email });
      if (typeof ex.duplicate === "number" && ex.duplicate > 0)    out.push({ label: "Duplicates",      value: ex.duplicate });
    }

    // Financial / invoice audit fields
    if (typeof d.overdue_cents === "number")        out.push({ label: "Overdue (p)",                 value: d.overdue_cents });
    if (typeof d.provider_spend_delta_pct === "number") out.push({ label: "Provider spend Δ",        value: `${d.provider_spend_delta_pct}%` });
    if (typeof d.unpaid_count === "number")         out.push({ label: "Unpaid invoices",              value: d.unpaid_count });

    // Sequence / schedule fields
    if (typeof d.steps === "object" && Array.isArray(d.steps)) {
      out.push({ label: "Sequence steps",           value: d.steps.length });
    }

    // Cross-channel
    if (typeof d.justified_channels === "number")  out.push({ label: "Justified channels",           value: d.justified_channels });
    if (typeof d.skipped_channels === "number")    out.push({ label: "Channels skipped (no data)",   value: d.skipped_channels });
  }

  return out;
}
