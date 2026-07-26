/**
 * SystemMind agent/CRM/workflow depth work orders — Task #490 (section 14).
 *
 * "Connect my voice agent to the CRM" must produce a COMPLETE implementation
 * work order — current architecture, variables, field map, triggers, webhooks,
 * pre/post-call data flow, test plan, rollback, verification — never a shallow
 * "Connect CRM" task.
 *
 * Honesty rules:
 *  - Every evidence item comes from REAL workspace rows (agents,
 *    systemmind_dynamic_variables, systemmind_crm_connections/discoveries,
 *    systemmind_call_triggers, workspace_workflows, workflow_runs).
 *  - Missing CRM connection → integration_missing blocker on every stage.
 *  - Unresolved agent/workflow → target_resolution_required, never invented.
 *  - The final Apply stage is created BLOCKED behind the earlier approvals —
 *    nothing is changed by this proposal; applying runs through the existing
 *    approval-gated pipelines.
 *  - WBAH is excluded entirely.
 */
import {
  insertWorkOrderWithStageTasks,
  stagePacket,
  type StageTaskSpec,
} from "@/lib/hivemind/channel-work-orders.server";
import type {
  PacketEvidence,
  PacketTarget,
} from "@/lib/minds/intelligence-packet.shared";

type Sb = any;

interface DepthStage {
  key: string;
  label: string;
  kind: "review" | "analysis" | "content" | "change" | "publication" | "execution";
  finalSend: boolean;
}

async function guards(sb: Sb, workspaceId: string): Promise<void> {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);
  const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  await assertProposalAllowed(sb, workspaceId);
}

async function packetHelpers() {
  const { buildIntelligencePacket, evidenceItem } = await import("@/lib/minds/intelligence-packet.server");
  return { buildIntelligencePacket, evidenceItem };
}

// ── 1. Agent ↔ CRM integration work order ────────────────────────────────────

export const AGENT_CRM_STAGES: DepthStage[] = [
  { key: "architecture_review", label: "Architecture Review",     kind: "analysis",  finalSend: false },
  { key: "field_mapping",       label: "Field Mapping",           kind: "change",    finalSend: false },
  { key: "triggers_webhooks",   label: "Triggers & Webhooks",     kind: "change",    finalSend: false },
  { key: "test_rollback",       label: "Test Plan & Rollback",    kind: "analysis",  finalSend: false },
  { key: "apply",               label: "Apply Integration",       kind: "execution", finalSend: true  },
];

export interface AgentCrmIntegrationOptions {
  agentId?: string | null;
  agentName?: string | null;
  crmConnectionId?: string | null;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createAgentCrmIntegrationWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: AgentCrmIntegrationOptions = {},
): Promise<{ workOrder: any; tasks: any[]; connected: boolean; agentResolved: boolean; fieldMap: Array<Record<string, unknown>> }> {
  await guards(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } = await packetHelpers();

  // Resolve the agent from REAL rows only.
  let agentQ = sb.from("agents")
    .select("id, name, agent_type, voice_provider, retell_agent_id, inbound_phone_number, flow_data, variables, settings, updated_at")
    .eq("workspace_id", workspaceId);
  if (opts.agentId) agentQ = agentQ.eq("id", opts.agentId);
  const { data: agentRows, error: agentErr } = await agentQ.limit(50);
  if (agentErr) throw new Error(agentErr.message);
  const wanted = (opts.agentName ?? "").trim().toLowerCase();
  const agents: any[] = agentRows ?? [];
  const agent =
    (opts.agentId ? agents[0] : null) ??
    (wanted ? agents.find((a) => String(a.name ?? "").trim().toLowerCase() === wanted) : null) ??
    (agents.length === 1 ? agents[0] : null);
  const agentResolved = !!agent;

  // CRM connections + latest discovery (real rows; never invented).
  let connQ = sb.from("systemmind_crm_connections")
    .select("id, provider, label, status, last_tested_at, token_expires_at")
    .eq("workspace_id", workspaceId);
  if (opts.crmConnectionId) connQ = connQ.eq("id", opts.crmConnectionId);
  const { data: connRows } = await connQ.limit(20);
  const connections: any[] = connRows ?? [];
  const verifiedConnection =
    connections.find((c) => c.status === "verified" || c.status === "connected") ?? null;
  // Fallback (unverified) connection is used for context/evidence display ONLY —
  // it must never mark the integration as connected/ready.
  const connection = verifiedConnection ?? connections[0] ?? null;
  const connected = !!verifiedConnection;

  const { data: discRows } = await sb.from("systemmind_crm_discoveries")
    .select("connection_id, provider, object_count, field_count, snapshot, discovered_at")
    .eq("workspace_id", workspaceId)
    .order("discovered_at", { ascending: false })
    .limit(5);
  const discovery = (discRows ?? []).find((d: any) =>
    connection ? String(d.connection_id) === String(connection.id) : true) ?? null;
  const discoveredFields: Array<{ object: string; field: string; label: string; type: string }> = [];
  for (const obj of (discovery?.snapshot as any)?.objects ?? []) {
    for (const f of obj.fields ?? []) {
      discoveredFields.push({ object: String(obj.key), field: String(f.key), label: String(f.label ?? f.key), type: String(f.type ?? "unknown") });
    }
  }

  // Agent dynamic variables (real scan registry rows).
  const { data: varRows } = agent
    ? await sb.from("systemmind_dynamic_variables")
        .select("id, name, label, data_type, direction, status, destination_system, destination_object, destination_field, allow_write_to_crm, sensitivity")
        .eq("workspace_id", workspaceId)
        .eq("agent_id", agent.id)
        .limit(200)
    : { data: [] as any[] };
  const variables: any[] = varRows ?? [];

  // Real triggers + webhook health for the pre/post-call data flow section.
  const { data: triggerRows } = agent
    ? await sb.from("systemmind_call_triggers")
        .select("id, name, trigger_type, enabled")
        .eq("workspace_id", workspaceId)
        .eq("agent_id", agent.id)
        .limit(50)
    : { data: [] as any[] };
  const triggers: any[] = triggerRows ?? [];
  const { data: integErrRows } = await sb.from("systemmind_integration_errors")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .limit(100);
  const openIntegrationErrors = (integErrRows ?? []).filter((r: any) => r.status !== "resolved").length;

  // Field map from reviewed variables → discovered CRM fields (never invented:
  // unmatched variables are reported as unmapped, not guessed).
  const fieldIndex = new Map(discoveredFields.map((f) => [`${f.object}.${f.field}`.toLowerCase(), f]));
  const fieldMap = variables
    .filter((v) => v.allow_write_to_crm === true || v.direction === "outbound" || v.destination_field)
    .map((v) => {
      const destKey = v.destination_object && v.destination_field
        ? `${v.destination_object}.${v.destination_field}`.toLowerCase()
        : null;
      const match = destKey ? fieldIndex.get(destKey) ?? null : null;
      return {
        variable: String(v.name),
        data_type: v.data_type ?? null,
        sensitivity: v.sensitivity ?? null,
        destination: destKey,
        mapped: !!match,
        crm_field_type: match?.type ?? null,
        note: match ? "Verified against CRM discovery." : "No verified CRM field — needs mapping review.",
      };
    });
  const unmapped = fieldMap.filter((m) => !m.mapped).length;

  const targets: PacketTarget[] = [
    {
      domain: "voice",
      entity_type: "agent",
      entity_id: agent ? String(agent.id) : null,
      entity_name: agent ? String(agent.name) : (opts.agentName ?? null),
      resolved: agentResolved,
      resolution_note: agentResolved
        ? null
        : agents.length
          ? `No unique agent match — ${agents.length} agents exist; specify which one.`
          : "No agents exist in this workspace yet.",
    },
    {
      domain: "systems",
      entity_type: "crm_connection",
      entity_id: connection ? String(connection.id) : null,
      entity_name: connection ? `${connection.provider} (${connection.label || "unlabelled"})` : null,
      resolved: connected,
      resolution_note: connected ? null : "No CRM connection configured in SystemMind CRM Connections.",
    },
  ];

  const evidence: PacketEvidence[] = [
    evidenceItem("agents", agentResolved
      ? `Agent "${agent.name}" (${agent.agent_type ?? "unknown type"}, provider ${agent.voice_provider ?? "n/a"}${agent.retell_agent_id ? ", deployed" : ", not deployed"}${agent.inbound_phone_number ? `, inbound ${agent.inbound_phone_number}` : ""}).`
      : `Agent could not be resolved (${agents.length} candidate(s)).`, {
      agent_id: agent?.id ?? null,
      deployed: !!agent?.retell_agent_id,
      candidates: agents.map((a) => ({ id: a.id, name: a.name })).slice(0, 10),
    }),
    evidenceItem("systemmind_dynamic_variables",
      `${variables.length} dynamic variable(s) registered for this agent; ${fieldMap.length} CRM-bound, ${unmapped} still unmapped.`,
      { total: variables.length, crm_bound: fieldMap.length, unmapped }),
    evidenceItem("systemmind_crm_connections",
      connected
        ? `CRM connection: ${connection.provider} (status ${connection.status}, last tested ${connection.last_tested_at ?? "never"}).`
        : "No CRM connection exists.",
      { connections: connections.map((c) => ({ id: c.id, provider: c.provider, status: c.status })) }),
    evidenceItem("systemmind_crm_discoveries",
      discovery
        ? `CRM discovery snapshot: ${discovery.object_count ?? discoveredFields.length} object(s), ${discovery.field_count ?? discoveredFields.length} field(s), discovered ${discovery.discovered_at}.`
        : "No CRM field discovery has been run — field mapping cannot be verified until discovery runs.",
      { field_count: discoveredFields.length }),
    evidenceItem("systemmind_call_triggers",
      `${triggers.length} call trigger(s) configured (${triggers.filter((t) => t.enabled).length} enabled).`,
      { triggers: triggers.map((t) => ({ type: t.trigger_type, enabled: t.enabled })) }),
    evidenceItem("systemmind_integration_errors",
      `${openIntegrationErrors} open CRM write-back error(s) in the integration error queue.`,
      { open_errors: openIntegrationErrors }),
  ];

  const integrationBlockers = connected
    ? []
    : [{ kind: "integration_missing" as const, detail: "No CRM connection is configured — connect a CRM in SystemMind → CRM Connections first." }];

  const objective = opts.objective?.trim()
    || `Connect agent "${agent?.name ?? opts.agentName ?? "(unresolved)"}" to ${connection ? connection.provider : "the CRM"} with a verified field map, triggers, webhooks and pre/post-call data flow.`;

  const diagnosis =
    `Current architecture: ${agentResolved ? `agent "${agent.name}" is ${agent.retell_agent_id ? "deployed" : "not yet deployed"} on ${agent.voice_provider ?? "an unknown provider"}` : "target agent unresolved"}; ` +
    `${connected ? `CRM ${connection.provider} is connected (${connection.status})` : "no CRM is connected"}; ` +
    `${discovery ? `${discoveredFields.length} CRM fields discovered` : "no CRM discovery has run"}; ` +
    `${fieldMap.length} variable(s) are CRM-bound with ${unmapped} unmapped; ` +
    `${triggers.length} trigger(s) exist; ${openIntegrationErrors} open write-back error(s).`;

  const planSteps = [
    { title: "Architecture review", detail: "Confirm agent deployment state, voice provider, phone number routing and where CRM data enters/leaves the call (pre-call variable injection, post-call write-back)." },
    { title: "Field mapping", detail: `Map each CRM-bound agent variable to a verified discovered CRM field (${fieldMap.length} candidate mapping(s), ${unmapped} unresolved). No unverified field names are ever written.` },
    { title: "Triggers & webhooks", detail: `Review ${triggers.length} existing call trigger(s) and the post-call webhook write-back path; define retry behavior for the ${openIntegrationErrors} open integration error(s).` },
    { title: "Test plan", detail: "Run a real test call through the setup wizard's 12-check workflow test; verify pre-call data is injected and post-call fields land in the CRM sandbox record." },
    { title: "Rollback plan", detail: "Applying keeps the previous variable-mapping rows and trigger config; rollback = restore prior mapping set and disable the write-back trigger. No CRM data is deleted." },
    { title: "Apply", detail: "Apply the approved mapping + trigger changes through the existing approval-gated SystemMind pipelines (never silently)." },
  ];

  const deliverables = [
    "Documented current agent↔CRM architecture (pre/post-call data flow)",
    `Verified field map (${fieldMap.length} mappings, unmapped fields explicitly listed)`,
    "Trigger + webhook configuration proposal",
    "Executed test-call report with pass/fail per check",
    "Rollback procedure",
  ];
  const successCriteria = [
    "Test call injects pre-call CRM data and writes post-call fields back to the CRM",
    "Zero unmapped CRM-bound variables at apply time",
    "No new rows in the integration error queue after the verification call",
  ];
  const limitations = [
    "This work order proposes the integration — nothing is changed until each stage is approved and Apply runs through the existing gated pipelines.",
    ...(discovery ? [] : ["CRM field discovery has not run — the field map cannot be verified until it does."]),
  ];

  const stageTasks: StageTaskSpec[] = AGENT_CRM_STAGES.map((stage) => ({
    stage: stage as any,
    title: `${stage.label}: ${agent?.name ?? opts.agentName ?? "agent"} ↔ ${connection?.provider ?? "CRM"}`,
    description: planSteps.find((p) => p.title.toLowerCase().startsWith(stage.label.split(" ")[0].toLowerCase()))?.detail
      ?? `${stage.label} stage for the agent↔CRM integration.`,
    packet: stagePacket({
      buildIntelligencePacket,
      mind: "systemmind",
      objective,
      intentSource: opts.source ?? "systemmind_tool:create_agent_crm_integration_work_order",
      instruction: opts.instruction ?? null,
      stage: stage as any,
      allStages: AGENT_CRM_STAGES as any,
      targets,
      evidence,
      diagnosis,
      planSteps,
      proposedChanges: [
        { target: `agent:${agent?.id ?? "unresolved"}`, change: "Bind reviewed variable mappings to verified CRM fields", reversible: true },
        { target: "systemmind_call_triggers", change: "Enable post-call CRM write-back trigger after test pass", reversible: true },
      ],
      deliverables,
      successCriteria,
      limitations,
      approvalSummary: stage.finalSend
        ? "Apply the approved agent↔CRM integration (field map + triggers) through the gated SystemMind pipelines."
        : `Approve the ${stage.label} stage of the agent↔CRM integration.`,
      sensitive: stage.finalSend,
      integrationBlockers,
      costNote: "No provider spend — configuration change only.",
    }),
  }));

  const { workOrder, tasks } = await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: `Agent ↔ CRM integration: ${agent?.name ?? opts.agentName ?? "agent"} → ${connection?.provider ?? "CRM"}`,
    objective,
    source: opts.source ?? "systemmind_tool",
    metadata: {
      depth_kind: "agent_crm_integration",
      agent_id: agent?.id ?? null,
      crm_connection_id: connection?.id ?? null,
      field_map: fieldMap,
      unmapped_fields: unmapped,
    },
    packet: stageTasks[0].packet,
    readiness: !connected
      ? "integration_required"
      : !agentResolved
        ? "target_resolution_required"
        : "ready_for_analysis_approval",
    stageTasks,
    triggerType: "systemmind_agent_crm_integration",
  });

  return { workOrder, tasks, connected, agentResolved, fieldMap };
}

// ── 2. Workflow depth work order ─────────────────────────────────────────────

export const WORKFLOW_DEPTH_STAGES: DepthStage[] = [
  { key: "workflow_review", label: "Workflow Review",      kind: "analysis",  finalSend: false },
  { key: "change_plan",     label: "Change Plan",          kind: "change",    finalSend: false },
  { key: "test_rollback",   label: "Test Plan & Rollback", kind: "analysis",  finalSend: false },
  { key: "apply",           label: "Apply Changes",        kind: "execution", finalSend: true  },
];

export interface WorkflowDepthOptions {
  workflowId?: string | null;
  workflowName?: string | null;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createWorkflowDepthWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: WorkflowDepthOptions = {},
): Promise<{ workOrder: any; tasks: any[]; workflowResolved: boolean }> {
  await guards(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } = await packetHelpers();

  let wfQ = sb.from("workspace_workflows")
    .select("id, name, status, template_id, flow_definition, updated_at")
    .eq("workspace_id", workspaceId);
  if (opts.workflowId) wfQ = wfQ.eq("id", opts.workflowId);
  const { data: wfRows, error: wfErr } = await wfQ.limit(50);
  if (wfErr) throw new Error(wfErr.message);
  const wanted = (opts.workflowName ?? "").trim().toLowerCase();
  const workflows: any[] = wfRows ?? [];
  const wf =
    (opts.workflowId ? workflows[0] : null) ??
    (wanted ? workflows.find((w) => String(w.name ?? "").trim().toLowerCase() === wanted) : null) ??
    (workflows.length === 1 ? workflows[0] : null);
  const workflowResolved = !!wf;

  const { data: runRows } = wf
    ? await sb.from("workflow_runs")
        .select("id, status, created_at")
        .eq("workspace_id", workspaceId)
        .eq("workflow_id", wf.id)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] as any[] };
  const runs: any[] = runRows ?? [];
  const failedRuns = runs.filter((r) => r.status === "failed").length;
  const nodeCount = Array.isArray((wf?.flow_definition as any)?.nodes)
    ? (wf.flow_definition as any).nodes.length
    : null;

  const targets: PacketTarget[] = [{
    domain: "systems",
    entity_type: "workspace_workflow",
    entity_id: wf ? String(wf.id) : null,
    entity_name: wf ? String(wf.name) : (opts.workflowName ?? null),
    resolved: workflowResolved,
    resolution_note: workflowResolved
      ? null
      : workflows.length
        ? `No unique workflow match — ${workflows.length} workflows exist; specify which one.`
        : "No workflows exist in this workspace yet.",
  }];

  const evidence: PacketEvidence[] = [
    evidenceItem("workspace_workflows", workflowResolved
      ? `Workflow "${wf.name}" (status ${wf.status}${nodeCount != null ? `, ${nodeCount} node(s)` : ""}, last updated ${wf.updated_at ?? "unknown"}).`
      : `Workflow could not be resolved (${workflows.length} candidate(s)).`, {
      workflow_id: wf?.id ?? null,
      status: wf?.status ?? null,
      node_count: nodeCount,
      candidates: workflows.map((w) => ({ id: w.id, name: w.name, status: w.status })).slice(0, 10),
    }),
    evidenceItem("workflow_runs",
      `${runs.length} recent run(s); ${failedRuns} failed.`,
      { recent_runs: runs.length, failed: failedRuns, last_run_at: runs[0]?.created_at ?? null }),
  ];

  const objective = opts.objective?.trim()
    || `Review and improve workflow "${wf?.name ?? opts.workflowName ?? "(unresolved)"}" with an evidence-backed change plan, test plan and rollback.`;
  const diagnosis = workflowResolved
    ? `Workflow "${wf.name}" is ${wf.status}${nodeCount != null ? ` with ${nodeCount} node(s)` : ""}; ${runs.length} recent run(s) with ${failedRuns} failure(s).`
    : `The target workflow is unresolved (${workflows.length} candidate(s)) — no change plan can be proposed against an unknown workflow.`;

  const planSteps = [
    { title: "Workflow review", detail: "Walk the flow definition node-by-node against recent run outcomes; identify failing/obsolete steps from real run evidence." },
    { title: "Change plan", detail: "Propose specific node/config changes with each change tied to a run failure or business rule — never speculative rewrites." },
    { title: "Test plan", detail: "Manual trigger of the changed workflow against a fixture record; verify each changed node's output before activation." },
    { title: "Rollback plan", detail: "The prior flow definition is retained; rollback = restore the previous definition and status. No data rows are deleted." },
    { title: "Apply", detail: "Apply the approved changes through the workflow engine's existing save/activate path." },
  ];

  const stageTasks: StageTaskSpec[] = WORKFLOW_DEPTH_STAGES.map((stage) => ({
    stage: stage as any,
    title: `${stage.label}: ${wf?.name ?? opts.workflowName ?? "workflow"}`,
    description: planSteps.find((p) => p.title.toLowerCase().startsWith(stage.label.split(" ")[0].toLowerCase()))?.detail
      ?? `${stage.label} stage for the workflow depth review.`,
    packet: stagePacket({
      buildIntelligencePacket,
      mind: "systemmind",
      objective,
      intentSource: opts.source ?? "systemmind_tool:create_workflow_depth_work_order",
      instruction: opts.instruction ?? null,
      stage: stage as any,
      allStages: WORKFLOW_DEPTH_STAGES as any,
      targets,
      evidence,
      diagnosis,
      planSteps,
      proposedChanges: [
        { target: `workspace_workflow:${wf?.id ?? "unresolved"}`, change: "Apply reviewed node/config changes (previous definition retained for rollback)", reversible: true },
      ],
      deliverables: [
        "Node-by-node review report tied to real run outcomes",
        "Specific change plan (each change evidence-justified)",
        "Executed test report",
        "Rollback procedure",
      ],
      successCriteria: [
        "Changed workflow passes a manual test run end-to-end",
        "Failure rate drops on the next reassessment window",
      ],
      limitations: [
        "Proposal only — the workflow is not modified until each stage is approved and Apply runs through the workflow engine's gated save path.",
      ],
      approvalSummary: stage.finalSend
        ? `Apply the approved changes to workflow "${wf?.name ?? "(unresolved)"}".`
        : `Approve the ${stage.label} stage of the workflow depth review.`,
      sensitive: stage.finalSend,
      costNote: "No provider spend — workflow configuration only.",
    }),
  }));

  const { workOrder, tasks } = await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: `Workflow depth review: ${wf?.name ?? opts.workflowName ?? "workflow"}`,
    objective,
    source: opts.source ?? "systemmind_tool",
    metadata: {
      depth_kind: "workflow_depth",
      workflow_id: wf?.id ?? null,
      failed_runs: failedRuns,
    },
    packet: stageTasks[0].packet,
    readiness: workflowResolved ? "ready_for_analysis_approval" : "target_resolution_required",
    stageTasks,
    triggerType: "systemmind_workflow_depth",
  });

  return { workOrder, tasks, workflowResolved };
}
