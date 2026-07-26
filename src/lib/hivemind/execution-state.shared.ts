// Unified execution state machine for the work-order / task-execution backbone.
// Shared (client-safe): no server imports. The single authoritative source for
// which execution states exist, which transitions are legal, and the
// user-facing labels for each state. Nothing may set an execution state
// outside applyTransition / assertTransition.

export type ExecutionStatus =
  | "queued"
  | "executing"
  | "awaiting_action_approval"
  | "awaiting_external_result"
  | "verifying"
  | "completed"
  | "partially_completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "worker_interrupted";

export type TaskExecutionStatus = "draft" | "awaiting_approval" | ExecutionStatus;

export const TERMINAL_EXECUTION_STATES: ReadonlySet<ExecutionStatus> = new Set([
  "completed", "partially_completed", "failed", "cancelled",
]);

/** Legal transitions. Key = from, values = allowed to. */
export const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> = {
  queued:                    ["executing", "cancelled", "failed", "blocked"],
  executing:                 ["awaiting_action_approval", "awaiting_external_result", "verifying", "completed", "partially_completed", "blocked", "failed", "cancelled", "worker_interrupted"],
  awaiting_action_approval:  ["executing", "verifying", "blocked", "failed", "cancelled", "partially_completed"],
  awaiting_external_result:  ["executing", "verifying", "blocked", "failed", "cancelled"],
  verifying:                 ["completed", "partially_completed", "failed", "blocked"],
  completed:                 [],
  partially_completed:       [],
  blocked:                   ["queued", "executing", "cancelled", "failed"],
  failed:                    [],
  cancelled:                 [],
  worker_interrupted:        ["queued", "cancelled", "failed"],
};

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return (EXECUTION_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal execution transition: ${from} → ${to}`);
  }
}

export const EXECUTION_STATUS_LABELS: Readonly<Record<TaskExecutionStatus, string>> = {
  draft:                    "Draft",
  awaiting_approval:        "Awaiting Approval",
  queued:                   "Queued",
  executing:                "Executing",
  awaiting_action_approval: "Awaiting Action Approval",
  awaiting_external_result: "Awaiting External Result",
  verifying:                "Verifying",
  completed:                "Completed",
  partially_completed:      "Partially Completed",
  blocked:                  "Blocked",
  failed:                   "Failed",
  cancelled:                "Cancelled",
  worker_interrupted:       "Interrupted",
};

// ── Steps ─────────────────────────────────────────────────────────────────────
export type StepStatus = "pending" | "running" | "done" | "skipped" | "blocked" | "failed";

export interface ExecutionStep {
  key:        string;
  label:      string;
  status:     StepStatus;
  detail?:    string;
  started_at?: string;
  finished_at?: string;
}

export function stepUpdate(
  steps: ExecutionStep[],
  key: string,
  patch: Partial<ExecutionStep>,
): ExecutionStep[] {
  const now = new Date().toISOString();
  return steps.map(s => {
    if (s.key !== key) return s;
    const next = { ...s, ...patch };
    if (patch.status === "running" && !s.started_at) next.started_at = now;
    if (patch.status && ["done", "skipped", "blocked", "failed"].includes(patch.status) && !next.finished_at) {
      next.finished_at = now;
    }
    return next;
  });
}

// ── Executable task kinds (registry of what the engine can dispatch) ─────────
export interface ExecutableKindMeta {
  mind:  "growthmind" | "systemmind" | "accountsmind" | "hivemind";
  label: string;
  /** Entitlement action key checked before dispatch (permissions.requireAction). */
  requiredActionKey: string;
  /** Fields required in input_spec before the task can be approved & run. */
  requiredInputFields: readonly string[];
  /**
   * Whether the adapter may mutate provider state (write to an external API).
   * Informational; used by UI + audit trail. Mutation always requires a linked
   * hivemind_action approval — never auto-applied.
   */
  providerMutating: boolean;
  /**
   * Whether the execution can be rolled back (adapter snapshots before apply).
   */
  rollbackSupported: boolean;
}

export const EXECUTABLE_KINDS: Readonly<Record<string, ExecutableKindMeta>> = {
  // ── GrowthMind ──────────────────────────────────────────────────────────────
  "growthmind.gads_campaign_analysis": {
    mind: "growthmind",
    label: "Google Ads Campaign Analysis",
    requiredActionKey: "growthmind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  "growthmind.seo_campaign": {
    mind: "growthmind",
    label: "SEO Campaign Execution",
    requiredActionKey: "growthmind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  "growthmind.social_content": {
    mind: "growthmind",
    label: "Social Content Publishing",
    requiredActionKey: "growthmind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  "growthmind.blog_article": {
    mind: "growthmind",
    label: "Blog Article Publishing",
    requiredActionKey: "growthmind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  "growthmind.video_campaign": {
    mind: "growthmind",
    label: "Video Campaign Execution",
    requiredActionKey: "growthmind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  // ── SystemMind ──────────────────────────────────────────────────────────────
  "systemmind.agent_crm_integration": {
    mind: "systemmind",
    label: "Agent ↔ CRM Integration Apply",
    requiredActionKey: "systemmind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: true,
  },
  "systemmind.workflow_depth": {
    mind: "systemmind",
    label: "Workflow Depth Review Apply",
    requiredActionKey: "systemmind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: true,
  },
  // ── AccountsMind ────────────────────────────────────────────────────────────
  "accountsmind.invoice_audit": {
    mind: "accountsmind",
    label: "Invoice Audit Execution",
    requiredActionKey: "accountsmind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: false,
  },
  "accountsmind.renewals_audit": {
    mind: "accountsmind",
    label: "Renewals Audit Execution",
    requiredActionKey: "accountsmind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: false,
  },
  "accountsmind.outgoings_audit": {
    mind: "accountsmind",
    label: "Outgoings Audit Execution",
    requiredActionKey: "accountsmind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  "accountsmind.client_costing": {
    mind: "accountsmind",
    label: "Client Revenue Audit Execution",
    requiredActionKey: "accountsmind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  // ── HiveMind ────────────────────────────────────────────────────────────────
  "hivemind.cross_channel_objective": {
    mind: "hivemind",
    label: "Cross-Channel Objective Launch",
    requiredActionKey: "hivemind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  "hivemind.channel_followup": {
    mind: "hivemind",
    label: "Follow-Up Sequence Send",
    requiredActionKey: "hivemind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: false,
  },
  "hivemind.channel_whatsapp": {
    mind: "hivemind",
    label: "WhatsApp Campaign Send",
    requiredActionKey: "hivemind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: false,
  },
  "hivemind.channel_email": {
    mind: "hivemind",
    label: "Email Campaign Send",
    requiredActionKey: "hivemind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: false,
  },
  "hivemind.channel_calls": {
    mind: "hivemind",
    label: "AI Call Campaign Launch",
    requiredActionKey: "hivemind.view",
    requiredInputFields: [],
    providerMutating: true,
    rollbackSupported: false,
  },
  "hivemind.sales_pipeline_review": {
    mind: "hivemind",
    label: "Sales Pipeline Review",
    requiredActionKey: "hivemind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
  "hivemind.legacy_task_migration": {
    mind: "hivemind",
    label: "Legacy Task Migration",
    requiredActionKey: "hivemind.view",
    requiredInputFields: [],
    providerMutating: false,
    rollbackSupported: false,
  },
};

export function executableKindMeta(kind: string | null | undefined): ExecutableKindMeta | null {
  if (!kind) return null;
  return EXECUTABLE_KINDS[kind] ?? null;
}
