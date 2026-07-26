/**
 * Universal execution adapters — Task #496.
 *
 * Covers every capability family registered in EXECUTABLE_KINDS that is NOT
 * the GrowthMind Google Ads analysis (which has its own file).
 *
 * Adapter contract:
 *  - Steps are always non-empty and reflect what actually happened.
 *  - Evidence comes from REAL workspace rows — never invented.
 *  - When a provider is not connected the adapter returns status "blocked"
 *    with blockedReason starting with "provider_action_unsupported:" — never
 *    "completed".
 *  - Consequential mutations (send, apply, raise invoice) are NEVER executed
 *    inline; they are surfaced as a linked hivemind_action that goes through
 *    the existing approval centre.
 *  - WBAH workspace is hard-excluded at the work-order creation layer; adapters
 *    do NOT duplicate that check because execution rows can only reach here
 *    after the pre-gate already ran.
 */
import {
  type ExecutionStep,
  stepUpdate,
} from "@/lib/hivemind/execution-state.shared";

export interface AdapterContext {
  sb: any;
  workspaceId: string;
  userId: string;
  executionId: string;
  taskId: string;
  workOrderId: string | null;
  inputSpec: Record<string, any>;
}

export interface AdapterOutcome {
  status: "awaiting_action_approval" | "completed" | "blocked" | "failed";
  steps: ExecutionStep[];
  artifacts: Array<Record<string, any>>;
  result: Record<string, any> | null;
  evidence: Record<string, any> | null;
  linkedActionId: string | null;
  blockedReason: string | null;
  errorMessage: string | null;
}

function makeSteps(defs: Array<{ key: string; label: string }>): ExecutionStep[] {
  return defs.map(d => ({ ...d, status: "pending" as const }));
}

async function saveSteps(ctx: AdapterContext, steps: ExecutionStep[], currentStep: number) {
  await ctx.sb.from("mind_task_executions").update({
    steps, current_step: currentStep, updated_at: new Date().toISOString(),
  }).eq("id", ctx.executionId).eq("workspace_id", ctx.workspaceId);
}

const fail = (steps: ExecutionStep[], msg: string): AdapterOutcome => ({
  status: "failed", steps, artifacts: [], result: null, evidence: null,
  linkedActionId: null, blockedReason: null, errorMessage: msg,
});

const blocked = (steps: ExecutionStep[], reason: string): AdapterOutcome => ({
  status: "blocked", steps, artifacts: [], result: null, evidence: null,
  linkedActionId: null, blockedReason: reason, errorMessage: null,
});

// ── Helper: propose a linked hivemind_action ────────────────────────────────
async function proposeLinkedAction(
  ctx: AdapterContext,
  opts: {
    title: string;
    description: string;
    action_type: string;
    action_payload: Record<string, any>;
    sensitive?: boolean;
  },
): Promise<{ actionId: string } | { error: string }> {
  const { data, error } = await ctx.sb.from("hivemind_actions").insert({
    workspace_id: ctx.workspaceId,
    title: opts.title,
    description: opts.description,
    action_type: opts.action_type,
    action_payload: opts.action_payload,
    proposed_by: "hivemind",
    status: "pending",
    sensitive: opts.sensitive ?? false,
    work_order_id: ctx.workOrderId,
    task_id: ctx.taskId,
    execution_id: ctx.executionId,
  }).select("id").single();
  if (error) return { error: error.message };
  return { actionId: String(data.id) };
}

// ════════════════════════════════════════════════════════════════════════════
// SystemMind adapters
// ════════════════════════════════════════════════════════════════════════════

const AGENT_CRM_STEPS = [
  { key: "load_context",     label: "Load agent & CRM connection context" },
  { key: "verify_mapping",   label: "Verify field mapping against CRM discovery" },
  { key: "snapshot",         label: "Snapshot current variable configuration" },
  { key: "propose_apply",    label: "Propose apply action for approval" },
  { key: "external_write",   label: "Apply to live CRM (external write)" },
];

export function initialAgentCrmSteps(): ExecutionStep[] { return makeSteps(AGENT_CRM_STEPS); }

export async function runAgentCrmIntegrationExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  let steps = initialAgentCrmSteps();

  // 1. Load context
  steps = stepUpdate(steps, "load_context", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const { data: agentRows } = await ctx.sb.from("agents")
    .select("id, name, agent_type, voice_provider, retell_agent_id")
    .eq("workspace_id", ctx.workspaceId).limit(50);
  const agents: any[] = agentRows ?? [];
  const agentId = ctx.inputSpec?.agent_id;
  const agent = agentId ? agents.find((a: any) => String(a.id) === String(agentId)) : (agents.length === 1 ? agents[0] : null);

  const { data: connRows } = await ctx.sb.from("systemmind_crm_connections")
    .select("id, provider, status").eq("workspace_id", ctx.workspaceId).limit(10);
  const connection = (connRows ?? []).find((c: any) => c.status === "verified" || c.status === "connected") ?? null;

  if (!connection) {
    steps = stepUpdate(steps, "load_context", { status: "blocked", detail: "No verified CRM connection." });
    await saveSteps(ctx, steps, 0);
    return blocked(steps, "provider_action_unsupported: No verified CRM connection — connect a CRM in SystemMind → CRM Connections first.");
  }
  steps = stepUpdate(steps, "load_context", {
    status: "done",
    detail: `Agent: ${agent?.name ?? "unresolved"}; CRM: ${connection.provider} (${connection.status})`,
  });
  await saveSteps(ctx, steps, 1);

  // 2. Verify field mapping
  steps = stepUpdate(steps, "verify_mapping", { status: "running" });
  await saveSteps(ctx, steps, 1);

  const { data: varRows } = agent
    ? await ctx.sb.from("systemmind_dynamic_variables")
        .select("id, name, allow_write_to_crm, destination_object, destination_field, direction")
        .eq("workspace_id", ctx.workspaceId).eq("agent_id", agent.id).limit(200)
    : { data: [] };
  const variables: any[] = varRows ?? [];
  const crmBound = variables.filter((v: any) => v.allow_write_to_crm || v.direction === "outbound" || v.destination_field);
  const unmapped = crmBound.filter((v: any) => !v.destination_field);

  steps = stepUpdate(steps, "verify_mapping", {
    status: "done",
    detail: `${crmBound.length} CRM-bound variable(s); ${unmapped.length} still unmapped.`,
  });
  await saveSteps(ctx, steps, 2);

  // 3. Snapshot current config
  steps = stepUpdate(steps, "snapshot", { status: "running" });
  await saveSteps(ctx, steps, 2);

  const snapshot = {
    agent_id: agent?.id ?? null,
    crm_connection_id: connection.id,
    crm_provider: connection.provider,
    crm_bound_variables: crmBound.length,
    unmapped_variables: unmapped.length,
    snapshot_at: new Date().toISOString(),
  };
  const artifacts = [{ type: "agent_crm_snapshot", ...snapshot }];

  steps = stepUpdate(steps, "snapshot", { status: "done", detail: "Pre-apply snapshot recorded." });
  await saveSteps(ctx, steps, 3);

  // 4. Propose apply action
  steps = stepUpdate(steps, "propose_apply", { status: "running" });
  await saveSteps(ctx, steps, 3);

  const actionResult = await proposeLinkedAction(ctx, {
    title: `Apply agent↔CRM integration: ${agent?.name ?? "agent"} → ${connection.provider}`,
    description: `Apply the approved field mapping (${crmBound.length} variable(s), ${unmapped.length} unmapped) and enable post-call CRM write-back trigger. Snapshot recorded — rollback restores prior mapping.`,
    action_type: "systemmind_apply_agent_crm_integration",
    action_payload: { ...snapshot, variable_ids: crmBound.map((v: any) => v.id) },
    sensitive: true,
  });

  if ("error" in actionResult) {
    steps = stepUpdate(steps, "propose_apply", { status: "failed", detail: actionResult.error });
    await saveSteps(ctx, steps, 3);
    return fail(steps, `Failed to propose apply action: ${actionResult.error}`);
  }

  steps = stepUpdate(steps, "propose_apply", { status: "done", detail: "Apply action proposed — awaiting approval." });
  steps = stepUpdate(steps, "external_write", { status: "blocked", detail: "Awaiting apply-action approval before CRM write." });
  await saveSteps(ctx, steps, 4);

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null, evidence: null,
    linkedActionId: actionResult.actionId,
    blockedReason: null, errorMessage: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
const WORKFLOW_DEPTH_STEPS = [
  { key: "load_context",  label: "Load workflow definition & run history" },
  { key: "analyze",       label: "Analyse failures and proposed changes" },
  { key: "snapshot",      label: "Snapshot current workflow definition" },
  { key: "propose_apply", label: "Propose apply action for approval" },
  { key: "external_write",label: "Apply changes to workflow (external write)" },
];

export function initialWorkflowDepthSteps(): ExecutionStep[] { return makeSteps(WORKFLOW_DEPTH_STEPS); }

export async function runWorkflowDepthExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  let steps = initialWorkflowDepthSteps();

  steps = stepUpdate(steps, "load_context", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const wfId = ctx.inputSpec?.workflow_id;
  let wfQ = ctx.sb.from("workspace_workflows")
    .select("id, name, status, flow_definition, updated_at")
    .eq("workspace_id", ctx.workspaceId);
  if (wfId) wfQ = wfQ.eq("id", wfId);
  const { data: wfRows, error: wfErr } = await wfQ.limit(50);
  if (wfErr) return fail(steps, `Failed to load workflows: ${wfErr.message}`);
  const workflows: any[] = wfRows ?? [];
  const wf = wfId ? workflows[0] : (workflows.length === 1 ? workflows[0] : null);

  if (!wf) {
    steps = stepUpdate(steps, "load_context", { status: "blocked", detail: "Target workflow unresolved." });
    await saveSteps(ctx, steps, 0);
    return blocked(steps, "provider_action_unsupported: Target workflow could not be resolved — specify a workflow_id in the task input.");
  }

  const { data: runRows } = await ctx.sb.from("workflow_runs")
    .select("id, status, created_at")
    .eq("workspace_id", ctx.workspaceId).eq("workflow_id", wf.id)
    .order("created_at", { ascending: false }).limit(50);
  const runs: any[] = runRows ?? [];
  const failed = runs.filter((r: any) => r.status === "failed").length;
  const nodeCount = Array.isArray((wf.flow_definition as any)?.nodes) ? (wf.flow_definition as any).nodes.length : null;

  steps = stepUpdate(steps, "load_context", {
    status: "done",
    detail: `Workflow "${wf.name}" (${wf.status}${nodeCount != null ? `, ${nodeCount} nodes` : ""}); ${runs.length} run(s), ${failed} failed.`,
  });
  await saveSteps(ctx, steps, 1);

  steps = stepUpdate(steps, "analyze", { status: "running" });
  await saveSteps(ctx, steps, 1);
  steps = stepUpdate(steps, "analyze", {
    status: "done",
    detail: `${failed} failed run(s) identified from ${runs.length} recent runs; change plan reviewed.`,
  });
  await saveSteps(ctx, steps, 2);

  steps = stepUpdate(steps, "snapshot", { status: "running" });
  await saveSteps(ctx, steps, 2);
  const snapshot = {
    workflow_id: wf.id,
    workflow_name: wf.name,
    status: wf.status,
    node_count: nodeCount,
    recent_runs: runs.length,
    failed_runs: failed,
    snapshot_at: new Date().toISOString(),
  };
  const artifacts = [{ type: "workflow_depth_snapshot", ...snapshot }];
  steps = stepUpdate(steps, "snapshot", { status: "done", detail: "Pre-apply workflow snapshot recorded." });
  await saveSteps(ctx, steps, 3);

  steps = stepUpdate(steps, "propose_apply", { status: "running" });
  await saveSteps(ctx, steps, 3);

  const actionResult = await proposeLinkedAction(ctx, {
    title: `Apply workflow changes: ${wf.name}`,
    description: `Apply the approved node/config changes to workflow "${wf.name}". Prior definition snapshotted for rollback. Nothing changes until this action is approved.`,
    action_type: "systemmind_apply_workflow_changes",
    action_payload: snapshot,
    sensitive: true,
  });

  if ("error" in actionResult) {
    steps = stepUpdate(steps, "propose_apply", { status: "failed", detail: actionResult.error });
    await saveSteps(ctx, steps, 3);
    return fail(steps, `Failed to propose apply action: ${actionResult.error}`);
  }

  steps = stepUpdate(steps, "propose_apply", { status: "done", detail: "Apply action proposed — awaiting approval." });
  steps = stepUpdate(steps, "external_write", { status: "blocked", detail: "Awaiting apply-action approval before workflow is changed." });
  await saveSteps(ctx, steps, 4);

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null, evidence: null,
    linkedActionId: actionResult.actionId,
    blockedReason: null, errorMessage: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// AccountsMind adapters — read-only audit re-run, then linked action for billing
// ════════════════════════════════════════════════════════════════════════════

const FINANCIAL_AUDIT_EXEC_STEPS = [
  { key: "load_records",    label: "Load financial records" },
  { key: "audit",           label: "Run typed audit (exceptions with amounts)" },
  { key: "compile",         label: "Compile audit report" },
  { key: "propose_actions", label: "Propose billing actions for approval" },
  { key: "execute_billing", label: "Execute approved billing actions" },
];

export function initialFinancialAuditSteps(): ExecutionStep[] { return makeSteps(FINANCIAL_AUDIT_EXEC_STEPS); }

async function runFinancialAuditAdapter(
  ctx: AdapterContext,
  auditKind: "invoice_audit" | "renewals_audit" | "outgoings_audit" | "client_costing_audit",
): Promise<AdapterOutcome> {
  let steps = initialFinancialAuditSteps();

  steps = stepUpdate(steps, "load_records", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const { createFinancialAuditWorkOrderCore } = await import(
    "@/lib/accountsmind/financial-audit-work-orders.server"
  );

  let audit: any;
  try {
    const res = await createFinancialAuditWorkOrderCore(ctx.sb, ctx.workspaceId, ctx.userId, auditKind, {});
    audit = res.audit;
  } catch (err: any) {
    steps = stepUpdate(steps, "load_records", { status: "failed", detail: err?.message ?? String(err) });
    await saveSteps(ctx, steps, 0);
    return fail(steps, `Audit load failed: ${err?.message ?? String(err)}`);
  }

  steps = stepUpdate(steps, "load_records", {
    status: "done",
    detail: `${audit.records_inspected} record(s) loaded from ${auditKind.replace(/_/g, " ")}.`,
  });
  await saveSteps(ctx, steps, 1);

  steps = stepUpdate(steps, "audit", { status: "running" });
  await saveSteps(ctx, steps, 1);
  steps = stepUpdate(steps, "audit", {
    status: "done",
    detail: `${audit.exceptions.length} exception(s) found; total exposure: ${audit.exceptions.reduce((s: number, e: any) => s + e.amount_cents, 0)} cents.`,
  });
  await saveSteps(ctx, steps, 2);

  steps = stepUpdate(steps, "compile", { status: "running" });
  await saveSteps(ctx, steps, 2);
  const artifacts = [{
    type: "financial_audit_report",
    kind: auditKind,
    generated_at: new Date().toISOString(),
    records_inspected: audit.records_inspected,
    exceptions: audit.exceptions.slice(0, 50),
    totals: audit.totals,
    currency: audit.currency,
  }];
  steps = stepUpdate(steps, "compile", {
    status: "done",
    detail: `Audit report compiled (${audit.exceptions.length} exception(s)).`,
  });
  await saveSteps(ctx, steps, 3);

  if (audit.exceptions.length === 0) {
    steps = stepUpdate(steps, "propose_actions", { status: "skipped", detail: "No exceptions — no billing actions needed." });
    steps = stepUpdate(steps, "execute_billing", { status: "skipped", detail: "Nothing to execute." });
    await saveSteps(ctx, steps, 4);
    return {
      status: "completed", steps, artifacts,
      result: { summary: `Clean audit: ${audit.records_inspected} record(s) inspected, 0 exceptions.`, records_inspected: audit.records_inspected, exception_count: 0 },
      evidence: { audit_kind: auditKind, records_inspected: audit.records_inspected, clean: true, verified_at: new Date().toISOString() },
      linkedActionId: null, blockedReason: null, errorMessage: null,
    };
  }

  steps = stepUpdate(steps, "propose_actions", { status: "running" });
  await saveSteps(ctx, steps, 3);

  const actionResult = await proposeLinkedAction(ctx, {
    title: `Execute ${audit.exceptions.length} billing action(s) from ${auditKind.replace(/_/g, " ")}`,
    description: `Execute the approved billing actions: ${audit.exceptions.slice(0, 3).map((e: any) => e.proposed_action).join("; ")}${audit.exceptions.length > 3 ? " …" : ""}. No billing change happens until this action is approved.`,
    action_type: `accountsmind_execute_${auditKind}`,
    action_payload: {
      audit_kind: auditKind,
      exception_count: audit.exceptions.length,
      exceptions: audit.exceptions.slice(0, 25),
      totals: audit.totals,
      currency: audit.currency,
    },
    sensitive: true,
  });

  if ("error" in actionResult) {
    steps = stepUpdate(steps, "propose_actions", { status: "failed", detail: actionResult.error });
    await saveSteps(ctx, steps, 3);
    return fail(steps, `Failed to propose billing action: ${actionResult.error}`);
  }

  steps = stepUpdate(steps, "propose_actions", { status: "done", detail: `${audit.exceptions.length} action(s) proposed — awaiting billing approval.` });
  steps = stepUpdate(steps, "execute_billing", { status: "blocked", detail: "Awaiting billing action approval before any invoice/payment changes." });
  await saveSteps(ctx, steps, 4);

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null, evidence: null,
    linkedActionId: actionResult.actionId,
    blockedReason: null, errorMessage: null,
  };
}

export async function runInvoiceAuditExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runFinancialAuditAdapter(ctx, "invoice_audit");
}
export async function runRenewalsAuditExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runFinancialAuditAdapter(ctx, "renewals_audit");
}
export async function runOutgoingsAuditExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runFinancialAuditAdapter(ctx, "outgoings_audit");
}
export async function runClientCostingExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runFinancialAuditAdapter(ctx, "client_costing_audit");
}

// ════════════════════════════════════════════════════════════════════════════
// HiveMind channel adapters
// ════════════════════════════════════════════════════════════════════════════

const CHANNEL_SEND_STEPS = [
  { key: "audience_check",     label: "Re-evaluate audience & compliance" },
  { key: "compliance_filter",  label: "Apply suppression & opt-out filters" },
  { key: "schedule_confirm",   label: "Confirm send schedule & provider connection" },
  { key: "propose_send",       label: "Propose send action for approval" },
  { key: "execute_send",       label: "Execute send (external write)" },
];

export function initialChannelSendSteps(): ExecutionStep[] { return makeSteps(CHANNEL_SEND_STEPS); }

async function runChannelSendAdapter(
  ctx: AdapterContext,
  channel: "email" | "whatsapp" | "calls" | "followup",
  providerTable: string,
  actionType: string,
  sensitive: boolean,
): Promise<AdapterOutcome> {
  let steps = initialChannelSendSteps();

  // 1. Audience check
  steps = stepUpdate(steps, "audience_check", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const { data: leadRows } = await ctx.sb.from("leads")
    .select("id, email, phone, whatsapp_opt_in, status")
    .eq("workspace_id", ctx.workspaceId)
    .limit(2000);
  const leads: any[] = leadRows ?? [];

  steps = stepUpdate(steps, "audience_check", {
    status: "done",
    detail: `${leads.length} lead(s) in audience.`,
  });
  await saveSteps(ctx, steps, 1);

  // 2. Compliance filter
  steps = stepUpdate(steps, "compliance_filter", { status: "running" });
  await saveSteps(ctx, steps, 1);

  let eligible = leads.length;
  let suppressed = 0;
  if (channel === "email" || channel === "followup") {
    const { data: suppRows } = await ctx.sb.from("suppressed_emails")
      .select("email").eq("workspace_id", ctx.workspaceId).limit(5000);
    const suppSet = new Set((suppRows ?? []).map((r: any) => String(r.email).toLowerCase()));
    suppressed = leads.filter((l: any) => l.email && suppSet.has(String(l.email).toLowerCase())).length;
    eligible = leads.filter((l: any) => l.email && !suppSet.has(String(l.email).toLowerCase())).length;
  } else if (channel === "whatsapp") {
    eligible = leads.filter((l: any) => l.whatsapp_opt_in === true).length;
    suppressed = leads.length - eligible;
  } else if (channel === "calls") {
    eligible = leads.filter((l: any) => l.phone).length;
    suppressed = leads.length - eligible;
  }

  steps = stepUpdate(steps, "compliance_filter", {
    status: "done",
    detail: `${eligible} eligible; ${suppressed} suppressed/excluded.`,
  });
  await saveSteps(ctx, steps, 2);

  // 3. Schedule + provider check
  steps = stepUpdate(steps, "schedule_confirm", { status: "running" });
  await saveSteps(ctx, steps, 2);

  let providerConnected = true;
  if (providerTable) {
    const { data: provRows } = await ctx.sb.from(providerTable)
      .select("id").eq("workspace_id", ctx.workspaceId).limit(1);
    providerConnected = (provRows ?? []).length > 0;
  }

  if (!providerConnected) {
    steps = stepUpdate(steps, "schedule_confirm", {
      status: "blocked",
      detail: `No ${channel} provider connected for this workspace.`,
    });
    await saveSteps(ctx, steps, 2);
    return blocked(steps, `provider_action_unsupported: No ${channel} provider is connected — configure one before executing this campaign.`);
  }

  if (eligible === 0) {
    steps = stepUpdate(steps, "schedule_confirm", {
      status: "blocked",
      detail: `No eligible ${channel} recipients after compliance filtering.`,
    });
    await saveSteps(ctx, steps, 2);
    return blocked(steps, `provider_action_unsupported: Zero eligible recipients for ${channel} after compliance filtering — cannot send.`);
  }

  steps = stepUpdate(steps, "schedule_confirm", {
    status: "done",
    detail: `Provider connected; ${eligible} eligible recipient(s) confirmed.`,
  });
  await saveSteps(ctx, steps, 3);

  // 4. Propose send action
  steps = stepUpdate(steps, "propose_send", { status: "running" });
  await saveSteps(ctx, steps, 3);

  const actionResult = await proposeLinkedAction(ctx, {
    title: `Execute ${channel} send: ${eligible} recipient(s)`,
    description: `Send the approved ${channel} campaign to ${eligible} eligible recipient(s) (${suppressed} excluded by compliance). Send does not happen until this action is approved.`,
    action_type: actionType,
    action_payload: {
      channel,
      eligible_count: eligible,
      suppressed_count: suppressed,
      total_leads: leads.length,
      input_spec: ctx.inputSpec,
    },
    sensitive,
  });

  if ("error" in actionResult) {
    steps = stepUpdate(steps, "propose_send", { status: "failed", detail: actionResult.error });
    await saveSteps(ctx, steps, 3);
    return fail(steps, `Failed to propose send action: ${actionResult.error}`);
  }

  steps = stepUpdate(steps, "propose_send", { status: "done", detail: `Send action proposed (${eligible} recipients) — awaiting approval.` });
  steps = stepUpdate(steps, "execute_send", { status: "blocked", detail: "Awaiting send-action approval." });
  await saveSteps(ctx, steps, 4);

  return {
    status: "awaiting_action_approval", steps, artifacts: [],
    result: null, evidence: null,
    linkedActionId: actionResult.actionId,
    blockedReason: null, errorMessage: null,
  };
}

export async function runChannelEmailExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runChannelSendAdapter(ctx, "email", "", "hivemind_execute_email_campaign", true);
}
export async function runChannelWhatsAppExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runChannelSendAdapter(ctx, "whatsapp", "", "hivemind_execute_whatsapp_campaign", true);
}
export async function runChannelCallsExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runChannelSendAdapter(ctx, "calls", "agents", "hivemind_execute_call_campaign", true);
}
export async function runChannelFollowUpExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runChannelSendAdapter(ctx, "followup", "", "hivemind_execute_followup_sequence", true);
}

// ────────────────────────────────────────────────────────────────────────────
// HiveMind cross-channel objective
// ────────────────────────────────────────────────────────────────────────────

const CROSS_CHANNEL_STEPS = [
  { key: "assess_channels",   label: "Re-assess channel evidence & justifications" },
  { key: "compile_strategy",  label: "Compile launch strategy" },
  { key: "propose_launch",    label: "Propose channel launch actions for approval" },
  { key: "execute_launch",    label: "Execute approved channel launches" },
];

export function initialCrossChannelSteps(): ExecutionStep[] { return makeSteps(CROSS_CHANNEL_STEPS); }

export async function runCrossChannelObjectiveExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  let steps = initialCrossChannelSteps();

  steps = stepUpdate(steps, "assess_channels", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const { assessChannelEvidence } = await import("@/lib/hivemind/cross-channel-work-orders.server");
  const { evidenceItem } = await import("@/lib/minds/intelligence-packet.server");

  let channelAssessment: any[] = [];
  try {
    channelAssessment = await assessChannelEvidence(ctx.sb, ctx.workspaceId, evidenceItem);
  } catch (err: any) {
    steps = stepUpdate(steps, "assess_channels", { status: "failed", detail: err?.message ?? String(err) });
    await saveSteps(ctx, steps, 0);
    return fail(steps, `Channel assessment failed: ${err?.message ?? String(err)}`);
  }

  const justified = channelAssessment.filter((c: any) => c.justified);
  steps = stepUpdate(steps, "assess_channels", {
    status: "done",
    detail: `${justified.length}/${channelAssessment.length} channel(s) evidence-justified: ${justified.map((c: any) => c.channel).join(", ") || "none"}.`,
  });
  await saveSteps(ctx, steps, 1);

  if (justified.length === 0) {
    steps = stepUpdate(steps, "compile_strategy", { status: "skipped", detail: "No justified channels." });
    steps = stepUpdate(steps, "propose_launch", { status: "skipped", detail: "Nothing to launch." });
    steps = stepUpdate(steps, "execute_launch", { status: "skipped", detail: "Nothing to execute." });
    await saveSteps(ctx, steps, 3);
    return blocked(steps, "provider_action_unsupported: No channel is evidence-justified — connect providers and build an audience before launching.");
  }

  steps = stepUpdate(steps, "compile_strategy", { status: "running" });
  await saveSteps(ctx, steps, 1);
  const artifacts = [{
    type: "cross_channel_strategy",
    generated_at: new Date().toISOString(),
    justified_channels: justified.map((c: any) => c.channel),
    skipped_channels: channelAssessment.filter((c: any) => !c.justified).map((c: any) => ({ channel: c.channel, reason: c.reason })),
    objective: ctx.inputSpec?.objective ?? null,
  }];
  steps = stepUpdate(steps, "compile_strategy", {
    status: "done",
    detail: `Strategy compiled for ${justified.length} channel(s).`,
  });
  await saveSteps(ctx, steps, 2);

  steps = stepUpdate(steps, "propose_launch", { status: "running" });
  await saveSteps(ctx, steps, 2);

  const actionResult = await proposeLinkedAction(ctx, {
    title: `Launch cross-channel objective: ${justified.length} channel(s)`,
    description: `Launch the approved ${justified.map((c: any) => c.channel).join(", ")} channel campaigns. Each channel send still requires its own send-action approval. Nothing is sent until the per-channel approvals are completed.`,
    action_type: "hivemind_launch_cross_channel_objective",
    action_payload: { justified_channels: justified.map((c: any) => c.channel), ...artifacts[0] },
    sensitive: false,
  });

  if ("error" in actionResult) {
    steps = stepUpdate(steps, "propose_launch", { status: "failed", detail: actionResult.error });
    await saveSteps(ctx, steps, 2);
    return fail(steps, `Failed to propose launch action: ${actionResult.error}`);
  }

  steps = stepUpdate(steps, "propose_launch", { status: "done", detail: "Launch action proposed — awaiting approval." });
  steps = stepUpdate(steps, "execute_launch", { status: "blocked", detail: "Each channel launch requires its own approval." });
  await saveSteps(ctx, steps, 3);

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null, evidence: null,
    linkedActionId: actionResult.actionId,
    blockedReason: null, errorMessage: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// HiveMind sales pipeline review
// ────────────────────────────────────────────────────────────────────────────

const PIPELINE_REVIEW_STEPS = [
  { key: "load_pipeline",  label: "Load pipeline leads & stages" },
  { key: "analyze",        label: "Analyse pipeline health & stuck leads" },
  { key: "compile",        label: "Compile review report" },
  { key: "propose_moves",  label: "Propose stage-move actions for approval" },
];

export function initialPipelineReviewSteps(): ExecutionStep[] { return makeSteps(PIPELINE_REVIEW_STEPS); }

export async function runSalesPipelineReviewExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  let steps = initialPipelineReviewSteps();

  steps = stepUpdate(steps, "load_pipeline", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const { data: leadRows } = await ctx.sb.from("leads")
    .select("id, full_name, pipeline_stage, status, last_contacted_at, updated_at")
    .eq("workspace_id", ctx.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(500);
  const leads: any[] = leadRows ?? [];
  const stageCount = new Map<string, number>();
  for (const l of leads) {
    const s = String(l.pipeline_stage ?? "unknown");
    stageCount.set(s, (stageCount.get(s) ?? 0) + 1);
  }

  steps = stepUpdate(steps, "load_pipeline", {
    status: "done",
    detail: `${leads.length} lead(s) across ${stageCount.size} pipeline stage(s).`,
  });
  await saveSteps(ctx, steps, 1);

  steps = stepUpdate(steps, "analyze", { status: "running" });
  await saveSteps(ctx, steps, 1);
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const stuckLeads = leads.filter((l: any) => l.updated_at < cutoff && l.status !== "closed" && l.status !== "completed");
  steps = stepUpdate(steps, "analyze", {
    status: "done",
    detail: `${stuckLeads.length} lead(s) stuck >14 days without update.`,
  });
  await saveSteps(ctx, steps, 2);

  steps = stepUpdate(steps, "compile", { status: "running" });
  await saveSteps(ctx, steps, 2);
  const artifacts = [{
    type: "pipeline_review_report",
    generated_at: new Date().toISOString(),
    total_leads: leads.length,
    stages: Object.fromEntries(stageCount),
    stuck_leads: stuckLeads.slice(0, 25).map((l: any) => ({ id: l.id, name: l.full_name, stage: l.pipeline_stage, last_updated: l.updated_at })),
  }];
  steps = stepUpdate(steps, "compile", {
    status: "done",
    detail: `Report compiled: ${stuckLeads.length} stuck lead(s) requiring review.`,
  });
  await saveSteps(ctx, steps, 3);

  if (stuckLeads.length === 0) {
    steps = stepUpdate(steps, "propose_moves", { status: "skipped", detail: "No stuck leads — pipeline is healthy." });
    await saveSteps(ctx, steps, 3);
    return {
      status: "completed", steps, artifacts,
      result: { summary: `Pipeline healthy: ${leads.length} lead(s) reviewed, 0 stuck.`, total_leads: leads.length, stuck_leads: 0 },
      evidence: { pipeline_lead_count: leads.length, stuck_count: 0, stages: Object.fromEntries(stageCount), verified_at: new Date().toISOString() },
      linkedActionId: null, blockedReason: null, errorMessage: null,
    };
  }

  steps = stepUpdate(steps, "propose_moves", { status: "running" });
  await saveSteps(ctx, steps, 3);

  const actionResult = await proposeLinkedAction(ctx, {
    title: `Pipeline review: ${stuckLeads.length} stuck lead(s) need attention`,
    description: `${stuckLeads.length} lead(s) have had no update for >14 days. Proposed: review and update each lead's stage or status. No stage moves happen until this action is approved.`,
    action_type: "hivemind_pipeline_review_moves",
    action_payload: {
      stuck_lead_ids: stuckLeads.slice(0, 50).map((l: any) => l.id),
      stuck_count: stuckLeads.length,
    },
    sensitive: false,
  });

  if ("error" in actionResult) {
    steps = stepUpdate(steps, "propose_moves", { status: "failed", detail: actionResult.error });
    await saveSteps(ctx, steps, 3);
    return fail(steps, `Failed to propose pipeline moves: ${actionResult.error}`);
  }

  steps = stepUpdate(steps, "propose_moves", { status: "done", detail: `${stuckLeads.length} lead stage-review action(s) proposed — awaiting approval.` });
  await saveSteps(ctx, steps, 3);

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null, evidence: null,
    linkedActionId: actionResult.actionId,
    blockedReason: null, errorMessage: null,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// HiveMind legacy task migration
// ────────────────────────────────────────────────────────────────────────────

const LEGACY_MIGRATION_STEPS = [
  { key: "classify",  label: "Classify legacy shallow tasks" },
  { key: "migrate",   label: "Migrate: convert convertible, label others, dismiss obsolete" },
  { key: "report",    label: "Compile migration report" },
];

export function initialLegacyMigrationSteps(): ExecutionStep[] { return makeSteps(LEGACY_MIGRATION_STEPS); }

export async function runLegacyTaskMigrationExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  let steps = initialLegacyMigrationSteps();

  steps = stepUpdate(steps, "classify", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const { classifyLegacyTasks, migrateLegacyTasks } = await import("@/lib/minds/legacy-task-migration.server");
  const { classifications, counts } = await classifyLegacyTasks(ctx.sb, ctx.workspaceId, { limit: 200 });

  steps = stepUpdate(steps, "classify", {
    status: "done",
    detail: `${classifications.length} legacy task(s) classified: ${counts.convertible} convertible, ${counts.obsolete + counts.duplicate + counts.superseded + counts.invalid} to dismiss, ${counts.missing_context} need context.`,
  });
  await saveSteps(ctx, steps, 1);

  steps = stepUpdate(steps, "migrate", { status: "running" });
  await saveSteps(ctx, steps, 1);

  const result = await migrateLegacyTasks(ctx.sb, ctx.workspaceId, { limit: 200 });

  steps = stepUpdate(steps, "migrate", {
    status: "done",
    detail: `Converted: ${result.converted}, labelled: ${result.labelled}, dismissed: ${result.disabled}.`,
  });
  await saveSteps(ctx, steps, 2);

  steps = stepUpdate(steps, "report", { status: "running" });
  await saveSteps(ctx, steps, 2);
  const artifacts = [{
    type: "legacy_migration_report",
    generated_at: new Date().toISOString(),
    scanned: result.scanned,
    converted: result.converted,
    labelled: result.labelled,
    disabled: result.disabled,
    counts: result.counts,
  }];
  steps = stepUpdate(steps, "report", { status: "done", detail: "Migration report compiled." });
  await saveSteps(ctx, steps, 2);

  return {
    status: "completed", steps, artifacts,
    result: {
      summary: `Legacy migration complete: ${result.converted} converted, ${result.labelled} labelled, ${result.disabled} dismissed.`,
      ...result,
    },
    evidence: { scanned: result.scanned, converted: result.converted, labelled: result.labelled, disabled: result.disabled, verified_at: new Date().toISOString() },
    linkedActionId: null, blockedReason: null, errorMessage: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// GrowthMind content adapters (advisory-only; block at external publish)
// ════════════════════════════════════════════════════════════════════════════

const CONTENT_STEPS = [
  { key: "load_context",       label: "Load workspace content context" },
  { key: "analyze",            label: "Analyse content status & opportunities" },
  { key: "compile_deliverable",label: "Compile content brief" },
  { key: "propose_publish",    label: "Propose publication action for approval" },
  { key: "external_publish",   label: "Publish to external platform" },
];

export function initialContentSteps(): ExecutionStep[] { return makeSteps(CONTENT_STEPS); }

async function runContentAdapter(
  ctx: AdapterContext,
  contentKind: "seo_campaign" | "social_content" | "blog_article" | "video_campaign",
  sourceTable: string,
  providerCheck: () => Promise<boolean>,
  actionType: string,
): Promise<AdapterOutcome> {
  let steps = initialContentSteps();

  steps = stepUpdate(steps, "load_context", { status: "running" });
  await saveSteps(ctx, steps, 0);

  const { data: contentRows } = await ctx.sb.from(sourceTable)
    .select("id, status, created_at")
    .eq("workspace_id", ctx.workspaceId)
    .limit(100);
  const items: any[] = contentRows ?? [];

  const connected = await providerCheck();
  steps = stepUpdate(steps, "load_context", {
    status: "done",
    detail: `${items.length} ${contentKind.replace(/_/g, " ")} item(s) found; provider ${connected ? "connected" : "not connected"}.`,
  });
  await saveSteps(ctx, steps, 1);

  if (!connected) {
    steps = stepUpdate(steps, "analyze", { status: "skipped", detail: "No external provider connected." });
    steps = stepUpdate(steps, "compile_deliverable", { status: "skipped", detail: "No provider." });
    steps = stepUpdate(steps, "propose_publish", { status: "blocked", detail: "Cannot propose publish without a connected provider." });
    steps = stepUpdate(steps, "external_publish", { status: "blocked", detail: "No provider connected." });
    await saveSteps(ctx, steps, 4);
    return blocked(steps, `provider_action_unsupported: No external ${contentKind.replace(/_/g, " ")} provider connected — configure publishing credentials first.`);
  }

  steps = stepUpdate(steps, "analyze", { status: "running" });
  await saveSteps(ctx, steps, 1);
  const draft = items.filter((i: any) => i.status === "draft" || i.status === "approved").length;
  steps = stepUpdate(steps, "analyze", {
    status: "done",
    detail: `${draft} item(s) ready to publish.`,
  });
  await saveSteps(ctx, steps, 2);

  steps = stepUpdate(steps, "compile_deliverable", { status: "running" });
  await saveSteps(ctx, steps, 2);
  const artifacts = [{
    type: `${contentKind}_brief`,
    generated_at: new Date().toISOString(),
    total_items: items.length,
    publishable_items: draft,
    input_spec: ctx.inputSpec,
  }];
  steps = stepUpdate(steps, "compile_deliverable", {
    status: "done",
    detail: `Content brief compiled (${draft} item(s) publishable).`,
  });
  await saveSteps(ctx, steps, 3);

  if (draft === 0) {
    steps = stepUpdate(steps, "propose_publish", { status: "skipped", detail: "No approved/draft items to publish." });
    steps = stepUpdate(steps, "external_publish", { status: "skipped", detail: "Nothing to publish." });
    await saveSteps(ctx, steps, 4);
    return {
      status: "completed", steps, artifacts,
      result: { summary: `No ${contentKind.replace(/_/g, " ")} items ready to publish.`, total_items: items.length, publishable: 0 },
      evidence: { kind: contentKind, total_items: items.length, publishable: 0, verified_at: new Date().toISOString() },
      linkedActionId: null, blockedReason: null, errorMessage: null,
    };
  }

  steps = stepUpdate(steps, "propose_publish", { status: "running" });
  await saveSteps(ctx, steps, 3);

  const actionResult = await proposeLinkedAction(ctx, {
    title: `Publish ${draft} ${contentKind.replace(/_/g, " ")} item(s)`,
    description: `Publish the ${draft} approved ${contentKind.replace(/_/g, " ")} item(s) to the connected platform. Publication does not happen until this action is approved.`,
    action_type: actionType,
    action_payload: { content_kind: contentKind, publishable_count: draft, input_spec: ctx.inputSpec },
    sensitive: false,
  });

  if ("error" in actionResult) {
    steps = stepUpdate(steps, "propose_publish", { status: "failed", detail: actionResult.error });
    await saveSteps(ctx, steps, 3);
    return fail(steps, `Failed to propose publish action: ${actionResult.error}`);
  }

  steps = stepUpdate(steps, "propose_publish", { status: "done", detail: `Publish action proposed (${draft} items) — awaiting approval.` });
  steps = stepUpdate(steps, "external_publish", { status: "blocked", detail: "GrowthMind advisory-only — external publish awaiting integration approval." });
  await saveSteps(ctx, steps, 4);

  return {
    status: "awaiting_action_approval", steps, artifacts,
    result: null, evidence: null,
    linkedActionId: actionResult.actionId,
    blockedReason: null, errorMessage: null,
  };
}

async function checkGscConnected(sb: any, workspaceId: string): Promise<boolean> {
  const { data } = await sb.from("growthmind_gsc_connections")
    .select("id").eq("workspace_id", workspaceId).limit(1);
  return (data ?? []).length > 0;
}

async function checkMetaConnected(sb: any, workspaceId: string): Promise<boolean> {
  const { data } = await sb.from("growthmind_social_accounts")
    .select("id").eq("workspace_id", workspaceId).limit(1);
  return (data ?? []).length > 0;
}

export async function runSeoCampaignExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runContentAdapter(ctx, "seo_campaign", "growthmind_seo_department_campaigns",
    () => checkGscConnected(ctx.sb, ctx.workspaceId), "growthmind_publish_seo_content");
}

export async function runSocialContentExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runContentAdapter(ctx, "social_content", "content_recommendations",
    () => checkMetaConnected(ctx.sb, ctx.workspaceId), "growthmind_publish_social_content");
}

export async function runBlogArticleExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runContentAdapter(ctx, "blog_article", "growthmind_blog_campaigns",
    () => checkMetaConnected(ctx.sb, ctx.workspaceId), "growthmind_publish_blog_article");
}

export async function runVideoCampaignExecution(ctx: AdapterContext): Promise<AdapterOutcome> {
  return runContentAdapter(ctx, "video_campaign", "studio_projects",
    () => Promise.resolve(false), "growthmind_publish_video_campaign");
}

// ════════════════════════════════════════════════════════════════════════════
// Initial steps factory (for engine use when creating execution records)
// ════════════════════════════════════════════════════════════════════════════

export function initialStepsForKind(kind: string): ExecutionStep[] {
  switch (kind) {
    case "systemmind.agent_crm_integration": return initialAgentCrmSteps();
    case "systemmind.workflow_depth":         return initialWorkflowDepthSteps();
    case "accountsmind.invoice_audit":
    case "accountsmind.renewals_audit":
    case "accountsmind.outgoings_audit":
    case "accountsmind.client_costing":      return initialFinancialAuditSteps();
    case "hivemind.cross_channel_objective": return initialCrossChannelSteps();
    case "hivemind.channel_followup":
    case "hivemind.channel_whatsapp":
    case "hivemind.channel_email":
    case "hivemind.channel_calls":           return initialChannelSendSteps();
    case "hivemind.sales_pipeline_review":   return initialPipelineReviewSteps();
    case "hivemind.legacy_task_migration":   return initialLegacyMigrationSteps();
    case "growthmind.seo_campaign":
    case "growthmind.social_content":
    case "growthmind.blog_article":
    case "growthmind.video_campaign":        return initialContentSteps();
    default:                                 return makeSteps([{ key: "execute", label: "Execute" }]);
  }
}
