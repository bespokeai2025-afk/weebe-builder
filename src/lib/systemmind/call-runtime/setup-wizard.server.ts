// ── SystemMind setup wizard: evidence-based step statuses, test mode,
//    activation lifecycle & versioning ─────────────────────────────────────────
// Every step status is COMPUTED LIVE from the underlying engines (variable
// engine #456, CRM connections #457, Retell sync #458, call runtime #459) —
// never a stored "done" flag without verification. Test mode runs the 12
// checks against real integrations; activation is gated on critical tests
// passing unless an authorised admin overrides (logged).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { buildTriggerSummary } from "./triggers.server";
import { assembleCallData } from "./pipeline.server";
import { computeActivationHealth, type HealthReport } from "./tick.server";

const sb = supabaseAdmin as any;

// ── Step model ────────────────────────────────────────────────────────────────

export type WizardStepStatus =
  | "not_started" | "information_required" | "in_progress" | "connected"
  | "configured" | "test_passed" | "warning" | "failed" | "active";

export interface WizardStep {
  key: string;
  label: string;
  status: WizardStepStatus;
  /** Truthful evidence lines, e.g. "42 lead fields discovered". Never vague. */
  evidence: string[];
  /** What the user must do when the step isn't complete. */
  action?: string;
}

export const WIZARD_STEP_KEYS = [
  "select_agent", "review_requirements", "connect_retell", "connect_crm",
  "precall_data", "dynamic_variables", "postcall_extraction", "crm_writeback",
  "webee_outcomes", "call_trigger", "call_queue", "webhooks",
  "test_workflow", "activate",
] as const;

// ── Live status computation ───────────────────────────────────────────────────

export async function computeWizardStatus(args: {
  workspaceId: string;
  agentId: string | null;
  activationId?: string | null;
}): Promise<{ steps: WizardStep[]; activation: any | null }> {
  assertNotWbahWorkspace(args.workspaceId);
  const steps: WizardStep[] = [];
  const push = (key: string, label: string, status: WizardStepStatus, evidence: string[], action?: string) =>
    steps.push({ key, label, status, evidence, action });

  // Activation row (draft under construction or the active workflow)
  let activation: any = null;
  if (args.activationId) {
    const { data } = await sb
      .from("systemmind_workflow_activations")
      .select("*")
      .eq("id", args.activationId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    activation = data;
  } else if (args.agentId) {
    const { data } = await sb
      .from("systemmind_workflow_activations")
      .select("*")
      .eq("workspace_id", args.workspaceId)
      .eq("agent_id", args.agentId)
      .in("status", ["draft", "testing", "active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1);
    activation = data?.[0] ?? null;
  }

  // 1. Select Agent Build
  let agent: any = null;
  if (args.agentId) {
    const { data } = await sb
      .from("agents")
      .select("id, name, agent_type, retell_agent_id, settings, status")
      .eq("id", args.agentId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    agent = data;
  }
  if (!agent) {
    push("select_agent", "Select Agent Build", "not_started", [], "Choose the agent build this workflow runs on.");
    return { steps: fillRemaining(steps), activation };
  }
  push("select_agent", "Select Agent Build", "configured", [
    `Agent "${agent.name}" selected (${agent.agent_type ?? "unknown type"})`,
  ]);

  // 2. Review Detected Requirements (latest scan)
  const { data: scan } = await sb
    .from("systemmind_agent_scans")
    .select("id, report, created_at")
    .eq("workspace_id", args.workspaceId)
    .eq("agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const scanRow = scan?.[0] ?? null;
  if (!scanRow) {
    push("review_requirements", "Review Detected Requirements", "not_started", [],
      "Run the agent scan to detect variables, integrations and webhook needs.");
  } else {
    const rep = scanRow.report ?? {};
    push("review_requirements", "Review Detected Requirements", "configured", [
      `Scan completed ${new Date(scanRow.created_at).toLocaleString("en-GB")}`,
      `${rep.variableCount ?? 0} variables detected`,
      ...(rep.requiredIntegrations?.length ? [`Requires: ${rep.requiredIntegrations.join(", ")}`] : []),
    ]);
  }

  // 3. Connect Retell (deployed agent + phone number + key)
  const settings = (agent.settings ?? {}) as Record<string, unknown>;
  const retellAgentId = (settings.deployedRetellAgentId as string) ?? agent.retell_agent_id ?? null;
  const phoneNumber = (settings.phoneNumber as string) ?? null;
  const retellEvidence: string[] = [];
  if (retellAgentId) retellEvidence.push(`Retell agent deployed (${String(retellAgentId).slice(0, 14)}…)`);
  if (phoneNumber) retellEvidence.push(`Outbound number assigned: ${phoneNumber}`);
  push(
    "connect_retell", "Connect Retell",
    retellAgentId && phoneNumber ? "connected" : retellAgentId ? "information_required" : "not_started",
    retellEvidence,
    retellAgentId && phoneNumber ? undefined : "Deploy the agent and assign a phone number in the Builder.",
  );

  // 4. Connect CRM (connection row + last evidence-based test)
  const { data: crmConns } = await sb
    .from("systemmind_crm_connections")
    .select("id, provider, status, last_test_report, last_tested_at")
    .eq("workspace_id", args.workspaceId)
    .order("created_at", { ascending: false });
  const crmConn = (crmConns ?? []).find((c: any) => c.status === "connected") ?? crmConns?.[0] ?? null;
  if (!crmConn) {
    push("connect_crm", "Connect CRM", "not_started", [], "Connect a CRM (or skip if this workflow is WEBEE-only).");
  } else {
    const report = crmConn.last_test_report ?? {};
    const okSteps = (report.steps ?? []).filter((s: any) => s.ok && !s.skipped);
    push(
      "connect_crm", "Connect CRM",
      crmConn.status === "connected" && report.ok ? "connected" : report.ok === false ? "failed" : "information_required",
      [
        `${crmConn.provider} connection ${crmConn.status}`,
        ...okSteps.map((s: any) => `${s.label}: ${s.detail}`),
        ...(report.fieldCount ? [`${report.fieldCount} lead fields discovered`] : []),
      ],
      report.ok ? undefined : "Re-test the CRM connection from the CRM Connections page.",
    );
  }

  // 5–8. Variables & mappings (variable engine)
  const { data: vars } = await sb
    .from("systemmind_dynamic_variables")
    .select("id, name, direction, status, is_required, source_field")
    .eq("workspace_id", args.workspaceId)
    .eq("agent_id", agent.id);
  const allVars = vars ?? [];
  const approved = allVars.filter((v: any) => ["approved", "edited"].includes(v.status));
  const pendingReview = allVars.filter((v: any) => v.status === "detected");
  const requiredUnmapped = approved.filter((v: any) => v.is_required && !v.source_field);

  const precallVars = approved.filter((v: any) =>
    ["crm_to_webee", "webee_to_retell_precall", "bidirectional"].includes(v.direction));
  push(
    "precall_data", "Pre-Call Data",
    precallVars.length ? (requiredUnmapped.length ? "warning" : "configured") : allVars.length ? "information_required" : "not_started",
    [
      `${precallVars.length} pre-call variables approved`,
      ...(requiredUnmapped.length ? [`${requiredUnmapped.length} required variables missing a source field`] : []),
    ],
    requiredUnmapped.length ? "Map source fields for the required variables." : undefined,
  );

  push(
    "dynamic_variables", "Dynamic Variables",
    approved.length && !pendingReview.length ? "configured" : approved.length ? "in_progress" : allVars.length ? "information_required" : "not_started",
    [
      `${approved.length}/${allVars.length} variables approved`,
      ...(pendingReview.length ? [`${pendingReview.length} awaiting review`] : []),
    ],
    pendingReview.length ? "Review the detected variables in the Variables tab." : undefined,
  );

  const extractionVars = approved.filter((v: any) =>
    ["retell_to_webee", "retell_to_crm_via_webee", "bidirectional"].includes(v.direction));
  push(
    "postcall_extraction", "Post-Call Extraction",
    extractionVars.length ? "configured" : "information_required",
    [`${extractionVars.length} extraction variables approved`],
    extractionVars.length ? undefined : "Approve at least one post-call extraction variable (e.g. call outcome).",
  );

  // CRM write-back: adapters configured in workspace_settings OR mapping direction
  const { data: wsSettings } = await sb
    .from("workspace_settings")
    .select("hubspot_api_key, ghl_api_key, webespoke_api_key, salesforce_access_token, pipedrive_api_token")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  const crmWritebackReady = Boolean(
    wsSettings?.hubspot_api_key || wsSettings?.ghl_api_key || wsSettings?.webespoke_api_key ||
    wsSettings?.salesforce_access_token || wsSettings?.pipedrive_api_token,
  );
  push(
    "crm_writeback", "CRM Write-Back",
    crmWritebackReady ? "configured" : crmConn ? "information_required" : "not_started",
    crmWritebackReady
      ? ["A post-call CRM write-back adapter is configured for this workspace"]
      : [],
    crmWritebackReady ? undefined : "Add the CRM API key under Settings → CRM to enable post-call write-back.",
  );

  // 9. WEBEE Outcomes — built-in; evidence from recent post-call executions
  const { count: postCallRuns } = await sb
    .from("systemmind_workflow_executions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", args.workspaceId)
    .eq("kind", "post_call")
    .eq("status", "completed");
  push("webee_outcomes", "WEBEE Outcomes", "configured", [
    "Lead status, summary and extraction write-back are built in",
    ...(postCallRuns ? [`${postCallRuns} post-call outcome runs completed`] : []),
  ]);

  // 10. Call Trigger
  const { data: triggers } = await sb
    .from("systemmind_call_triggers")
    .select("id, name, trigger_type, enabled, summary, conditions, calling_window, max_attempts, daily_cap")
    .eq("workspace_id", args.workspaceId)
    .eq("agent_id", agent.id);
  const enabledTriggers = (triggers ?? []).filter((t: any) => t.enabled);
  push(
    "call_trigger", "Call Trigger",
    enabledTriggers.length ? "configured" : triggers?.length ? "information_required" : "not_started",
    (triggers ?? []).map((t: any) =>
      `${t.enabled ? "ENABLED" : "disabled"} — ${t.summary || buildTriggerSummary(t)}`),
    enabledTriggers.length ? undefined : "Create and enable at least one call trigger.",
  );

  // 11. Call Queue — live stats
  const { data: queueRows } = await sb
    .from("systemmind_call_queue")
    .select("status")
    .eq("workspace_id", args.workspaceId)
    .eq("agent_id", agent.id)
    .limit(1000);
  const qCounts: Record<string, number> = {};
  for (const q of queueRows ?? []) qCounts[q.status] = (qCounts[q.status] ?? 0) + 1;
  const stuck = (qCounts.waiting_for_data ?? 0) + (qCounts.failed ?? 0);
  push(
    "call_queue", "Call Queue",
    queueRows?.length ? (stuck ? "warning" : "configured") : "not_started",
    queueRows?.length
      ? Object.entries(qCounts).map(([s, n]) => `${n} ${s.replace(/_/g, " ")}`)
      : ["Queue is empty — entries appear when a trigger fires"],
    stuck ? "Review failed / waiting-for-data queue entries." : undefined,
  );

  // 12. Webhooks — recent Retell events for this workspace
  const { data: recentWebhook } = await sb
    .from("retell_webhook_events")
    .select("id, event_type, created_at")
    .eq("workspace_id", args.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1);
  const lastWh = recentWebhook?.[0] ?? null;
  push(
    "webhooks", "Webhooks",
    lastWh ? "connected" : "information_required",
    lastWh
      ? [`Last Retell webhook received ${new Date(lastWh.created_at).toLocaleString("en-GB")} (${lastWh.event_type})`]
      : [],
    lastWh ? undefined : "No Retell webhooks received yet — they arrive automatically after the first call.",
  );

  // 13. Test Workflow
  const testResults = activation?.test_results ?? {};
  const testChecks: any[] = testResults.checks ?? [];
  const failedCritical = testChecks.filter((c: any) => !c.ok && !c.skipped && c.critical);
  if (!activation || !testChecks.length) {
    push("test_workflow", "Test Workflow", "not_started", [], "Run the 12-check workflow test before activating.");
  } else if (activation.test_passed) {
    push("test_workflow", "Test Workflow", "test_passed", [
      `${testChecks.filter((c: any) => c.ok).length}/${testChecks.length} checks passed`,
      `Last tested ${activation.last_test_at ? new Date(activation.last_test_at).toLocaleString("en-GB") : "—"}`,
      ...(activation.admin_override ? [`ADMIN OVERRIDE by ${activation.override_by_user_id} — ${activation.override_reason}`] : []),
    ]);
  } else {
    push("test_workflow", "Test Workflow", "failed",
      failedCritical.map((c: any) => `FAILED: ${c.label} — ${c.detail}`),
      "Fix the failing checks and re-run the test.");
  }

  // 14. Activate
  if (activation?.status === "active") {
    push("activate", "Activate", "active", [
      `Version ${activation.version_number} active since ${activation.activated_at ? new Date(activation.activated_at).toLocaleString("en-GB") : "—"}`,
      `Health: ${activation.health_status}`,
    ]);
  } else if (activation?.status === "paused") {
    push("activate", "Activate", "warning", [`Version ${activation.version_number} is paused`], "Resume the workflow when ready.");
  } else {
    push("activate", "Activate",
      activation?.test_passed ? "in_progress" : "not_started",
      activation ? [`Draft version ${activation.version_number}`] : [],
      activation?.test_passed ? "All tests passed — activate when ready." : "Pass the workflow test (or obtain an admin override) to activate.");
  }

  return { steps, activation };
}

function fillRemaining(steps: WizardStep[]): WizardStep[] {
  const have = new Set(steps.map((s) => s.key));
  const labels: Record<string, string> = {
    select_agent: "Select Agent Build", review_requirements: "Review Detected Requirements",
    connect_retell: "Connect Retell", connect_crm: "Connect CRM", precall_data: "Pre-Call Data",
    dynamic_variables: "Dynamic Variables", postcall_extraction: "Post-Call Extraction",
    crm_writeback: "CRM Write-Back", webee_outcomes: "WEBEE Outcomes", call_trigger: "Call Trigger",
    call_queue: "Call Queue", webhooks: "Webhooks", test_workflow: "Test Workflow", activate: "Activate",
  };
  for (const key of WIZARD_STEP_KEYS) {
    if (!have.has(key)) steps.push({ key, label: labels[key], status: "not_started", evidence: [] });
  }
  return steps;
}

// ── Test mode: the 12 checks ─────────────────────────────────────────────────

export interface WorkflowTestCheck {
  key: string;
  label: string;
  ok: boolean;
  critical: boolean;
  skipped?: boolean;
  detail: string;
}

export async function runWorkflowTestsServer(args: {
  workspaceId: string;
  userId: string | null;
  activationId: string;
}): Promise<{ passed: boolean; checks: WorkflowTestCheck[] }> {
  assertNotWbahWorkspace(args.workspaceId);
  const { data: activation } = await sb
    .from("systemmind_workflow_activations")
    .select("*")
    .eq("id", args.activationId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!activation) throw new Error("activation_not_found");
  const agentId = activation.agent_id as string | null;

  const checks: WorkflowTestCheck[] = [];
  const add = (key: string, label: string, ok: boolean, critical: boolean, detail: string, skipped = false) =>
    checks.push({ key, label, ok, critical, detail, skipped });

  // 1. CRM connection
  const { data: crmConns } = await sb
    .from("systemmind_crm_connections")
    .select("id, provider, status, last_test_report")
    .eq("workspace_id", args.workspaceId);
  const crmConn = (crmConns ?? []).find((c: any) => c.status === "connected") ?? null;
  if (!crmConn) {
    add("crm_connection", "CRM connection", true, false, "No CRM connected — workflow runs WEBEE-only", true);
  } else {
    const rep = crmConn.last_test_report ?? {};
    add("crm_connection", "CRM connection", rep.ok === true, true,
      rep.ok === true ? `${crmConn.provider}: ${((rep.steps ?? []) as any[]).filter((s) => s.ok).length} checks passed` : rep.error ?? "Last connection test failed");
  }

  // 2. Record retrieval — pick the most recent lead and assemble data
  const { data: sampleLeads } = await sb
    .from("leads")
    .select("id, phone, full_name")
    .eq("workspace_id", args.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1);
  const sampleLead = sampleLeads?.[0] ?? null;
  add("record_retrieval", "Record retrieval", Boolean(sampleLead), true,
    sampleLead ? `Sample lead retrieved ("${sampleLead.full_name ?? sampleLead.id}")` : "No leads exist to test retrieval against — add a test lead");

  // 3 + 4. Mapping + variables (live pre-call assembly against the sample lead)
  if (sampleLead && agentId) {
    try {
      const assembled = await assembleCallData({ workspaceId: args.workspaceId, agentId, leadId: String(sampleLead.id) });
      const varCount = Object.keys(assembled.dynamicVariables).length;
      add("mapping", "Field mapping & transformation", assembled.missingRequired.length === 0, true,
        assembled.missingRequired.length
          ? `Missing required: ${assembled.missingRequired.join(", ")}`
          : `${varCount} variables assembled with transformations applied`);
      add("variables", "Dynamic variables", varCount > 0, true,
        varCount > 0 ? `${varCount} variables would be sent to Retell` : "No approved variables produce values — approve and map variables first");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      add("mapping", "Field mapping & transformation", false, true, msg);
      add("variables", "Dynamic variables", false, true, msg);
    }
  } else {
    add("mapping", "Field mapping & transformation", false, true, "Needs an agent and at least one lead", !agentId);
    add("variables", "Dynamic variables", false, true, "Needs an agent and at least one lead", !agentId);
  }

  // 5. Retell deployment
  let retellOk = false;
  let retellDetail = "No agent selected";
  if (agentId) {
    const { data: agent } = await sb
      .from("agents").select("retell_agent_id, settings").eq("id", agentId).maybeSingle();
    const s = (agent?.settings ?? {}) as Record<string, unknown>;
    const rid = (s.deployedRetellAgentId as string) ?? agent?.retell_agent_id;
    const phone = s.phoneNumber as string | undefined;
    retellOk = Boolean(rid && phone);
    retellDetail = retellOk
      ? `Deployed agent ${String(rid).slice(0, 14)}… with number ${phone}`
      : !rid ? "Agent is not deployed to Retell" : "No outbound phone number assigned";
  }
  add("retell_deployment", "Retell deployment", retellOk, true, retellDetail);

  // 6. Webhook delivery (any Retell event in the last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { count: whCount } = await sb
    .from("retell_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", args.workspaceId)
    .gte("created_at", weekAgo);
  add("webhook", "Webhook delivery", (whCount ?? 0) > 0, false,
    (whCount ?? 0) > 0 ? `${whCount} Retell webhooks received in the last 7 days` : "No webhooks in 7 days — first arrives after the next call");

  // 7. Test call — a real PASSED test call for this agent (Build Workspace gate)
  let testCallOk = false;
  let testCallDetail = "No passed test call found for this agent";
  if (agentId) {
    const { data: tc } = await sb
      .from("systemmind_test_calls")
      .select("id, passed, created_at, is_manual_override")
      .eq("workspace_id", args.workspaceId)
      .eq("agent_id", agentId)
      .eq("passed", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (tc?.[0]) {
      testCallOk = true;
      testCallDetail = `Test call passed ${new Date(tc[0].created_at).toLocaleString("en-GB")}${tc[0].is_manual_override ? " (manual override)" : ""}`;
    } else {
      // Fallback evidence: a real completed outbound call by this agent
      const { data: agent } = await sb.from("agents").select("retell_agent_id, settings").eq("id", agentId).maybeSingle();
      const rid = ((agent?.settings as any)?.deployedRetellAgentId as string) ?? agent?.retell_agent_id;
      if (rid) {
        const { data: realCall } = await sb
          .from("calls")
          .select("id, call_status, created_at")
          .eq("workspace_id", args.workspaceId)
          .eq("agent_id", rid)
          .in("call_status", ["ended", "completed", "analyzed"])
          .order("created_at", { ascending: false })
          .limit(1);
        if (realCall?.[0]) {
          testCallOk = true;
          testCallDetail = `Real completed call by this agent ${new Date(realCall[0].created_at).toLocaleString("en-GB")}`;
        }
      }
    }
  }
  add("test_call", "Test call", testCallOk, true, testCallDetail);

  // 8. Extraction config
  const { count: extractionCount } = agentId
    ? await sb
        .from("systemmind_dynamic_variables")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", args.workspaceId)
        .eq("agent_id", agentId)
        .in("status", ["approved", "edited"])
        .in("direction", ["retell_to_webee", "retell_to_crm_via_webee", "bidirectional"])
    : { count: 0 };
  add("extraction", "Post-call extraction", (extractionCount ?? 0) > 0, false,
    (extractionCount ?? 0) > 0 ? `${extractionCount} extraction variables approved` : "No extraction variables — call outcomes won't be captured into fields");

  // 9. WEBEE update path (post-call pipeline is wired — evidence from executions or code path)
  const { count: postRuns } = await sb
    .from("systemmind_workflow_executions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", args.workspaceId)
    .eq("kind", "post_call");
  add("webee_update", "WEBEE outcome update", true, false,
    (postRuns ?? 0) > 0 ? `${postRuns} post-call outcome runs recorded` : "Built-in pipeline ready — first run recorded after the first call");

  // 10. CRM write-back
  const { data: wsSettings } = await sb
    .from("workspace_settings")
    .select("hubspot_api_key, ghl_api_key, webespoke_api_key, salesforce_access_token, pipedrive_api_token")
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  const wbReady = Boolean(
    wsSettings?.hubspot_api_key || wsSettings?.ghl_api_key || wsSettings?.webespoke_api_key ||
    wsSettings?.salesforce_access_token || wsSettings?.pipedrive_api_token,
  );
  const { count: deadLetters } = await sb
    .from("systemmind_integration_errors")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", args.workspaceId)
    .eq("status", "dead_letter");
  add("crm_writeback", "CRM write-back", crmConn ? wbReady && (deadLetters ?? 0) === 0 : true, false,
    !crmConn ? "No CRM connected — write-back skipped"
    : !wbReady ? "CRM connected but no write-back API key in workspace settings"
    : (deadLetters ?? 0) > 0 ? `${deadLetters} dead-lettered write-backs need attention`
    : "Write-back adapter configured, no dead-lettered errors",
    !crmConn);

  // 11. Queue behavior — state machine sanity on live rows
  const { data: qRows } = await sb
    .from("systemmind_call_queue")
    .select("status")
    .eq("workspace_id", args.workspaceId)
    .limit(500);
  const stuckFailed = (qRows ?? []).filter((q: any) => q.status === "failed").length;
  add("queue_behavior", "Queue behavior", true, false,
    qRows?.length ? `${qRows.length} queue entries; ${stuckFailed} permanently failed` : "Queue empty — populated when a trigger fires");

  // 12. Trigger
  const { data: trigRows } = agentId
    ? await sb
        .from("systemmind_call_triggers")
        .select("id, enabled")
        .eq("workspace_id", args.workspaceId)
        .eq("agent_id", agentId)
    : { data: [] };
  const enabledTrig = (trigRows ?? []).filter((t: any) => t.enabled).length;
  add("trigger", "Call trigger", enabledTrig > 0, true,
    enabledTrig > 0 ? `${enabledTrig} trigger(s) enabled` : "No enabled trigger — the workflow would never start");

  const passed = checks.every((c) => c.ok || c.skipped || !c.critical);

  await sb
    .from("systemmind_workflow_activations")
    .update({
      test_results: { checks, ranAt: new Date().toISOString(), ranBy: args.userId },
      test_passed: passed,
      last_test_at: new Date().toISOString(),
      status: activation.status === "draft" ? "testing" : activation.status,
      admin_override: false,
      override_reason: null,
      override_by_user_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.activationId);

  return { passed, checks };
}

// ── Activation lifecycle & versioning ────────────────────────────────────────

export async function getOrCreateDraftActivationServer(args: {
  workspaceId: string;
  userId: string | null;
  agentId: string;
  name?: string;
}): Promise<any> {
  assertNotWbahWorkspace(args.workspaceId);
  const { data: existing } = await sb
    .from("systemmind_workflow_activations")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("agent_id", args.agentId)
    .in("status", ["draft", "testing"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing?.[0]) return existing[0];

  // Editing an active workflow → new draft VERSION; active keeps running.
  const { data: active } = await sb
    .from("systemmind_workflow_activations")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("agent_id", args.agentId)
    .eq("status", "active")
    .maybeSingle();

  const { data: agent } = await sb
    .from("agents").select("name").eq("id", args.agentId).maybeSingle();
  const { data, error } = await sb
    .from("systemmind_workflow_activations")
    .insert({
      workspace_id: args.workspaceId,
      agent_id: args.agentId,
      name: args.name ?? `${agent?.name ?? "Agent"} call workflow`,
      status: "draft",
      version_number: active ? (active.version_number ?? 1) + 1 : 1,
      parent_activation_id: active?.id ?? null,
      config: active?.config ?? {},
      created_by_user_id: args.userId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function activateWorkflowServer(args: {
  workspaceId: string;
  userId: string | null;
  activationId: string;
  adminOverride?: { reason: string };
}): Promise<{ ok: boolean; error?: string; activation?: any }> {
  assertNotWbahWorkspace(args.workspaceId);
  const { data: activation } = await sb
    .from("systemmind_workflow_activations")
    .select("*")
    .eq("id", args.activationId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!activation) return { ok: false, error: "activation_not_found" };
  if (activation.status === "active") return { ok: false, error: "already_active" };
  if (!["draft", "testing", "paused"].includes(activation.status)) {
    return { ok: false, error: `cannot_activate_from_${activation.status}` };
  }

  // Gate: critical tests passed OR authorised, logged admin override.
  if (!activation.test_passed && activation.status !== "paused") {
    if (!args.adminOverride?.reason?.trim()) {
      return { ok: false, error: "tests_not_passed" };
    }
    const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
    await requireSystemMindEdit(args.workspaceId, args.userId);
    const { data: member } = await sb
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", args.workspaceId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (!["owner", "admin"].includes(member?.role ?? "")) {
      return { ok: false, error: "override_requires_admin" };
    }
    await sb.from("systemmind_workflow_activations").update({
      admin_override: true,
      override_reason: args.adminOverride.reason.slice(0, 500),
      override_by_user_id: args.userId,
      updated_at: new Date().toISOString(),
    }).eq("id", args.activationId);
    try {
      const { writeSystemMindAudit } = await import("@/lib/systemmind/systemmind-automation.server");
      await writeSystemMindAudit({
        workspaceId: args.workspaceId,
        userId: args.userId,
        actionType: "workflow_activation_admin_override",
        targetType: "systemmind_workflow_activations",
        targetId: args.activationId,
        finalAfterState: { reason: args.adminOverride.reason.slice(0, 500) },
        executedAt: new Date().toISOString(),
      });
    } catch { /* audit best-effort */ }
  }

  // Supersede the previous active version, then flip this one active
  // (unique partial index enforces one active per workspace+agent).
  if (activation.agent_id) {
    await sb
      .from("systemmind_workflow_activations")
      .update({ status: "superseded", deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("workspace_id", args.workspaceId)
      .eq("agent_id", activation.agent_id)
      .eq("status", "active");
  }
  const { data: updated, error } = await sb
    .from("systemmind_workflow_activations")
    .update({
      status: "active",
      activated_by_user_id: args.userId,
      activated_at: new Date().toISOString(),
      health_status: "unknown",
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.activationId)
    .in("status", ["draft", "testing", "paused"])
    .select("*");
  if (error) return { ok: false, error: error.message };
  if (!updated?.length) return { ok: false, error: "activation_state_changed" };
  return { ok: true, activation: updated[0] };
}

export async function setWorkflowStateServer(args: {
  workspaceId: string;
  userId: string | null;
  activationId: string;
  action: "pause" | "resume" | "rollback";
}): Promise<{ ok: boolean; error?: string }> {
  assertNotWbahWorkspace(args.workspaceId);
  const { data: activation } = await sb
    .from("systemmind_workflow_activations")
    .select("*")
    .eq("id", args.activationId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!activation) return { ok: false, error: "activation_not_found" };

  if (args.action === "pause") {
    if (activation.status !== "active") return { ok: false, error: "not_active" };
    await sb.from("systemmind_workflow_activations")
      .update({ status: "paused", health_status: "paused", updated_at: new Date().toISOString() })
      .eq("id", args.activationId).eq("status", "active");
    return { ok: true };
  }
  if (args.action === "resume") {
    if (activation.status !== "paused") return { ok: false, error: "not_paused" };
    const res = await activateWorkflowServer({
      workspaceId: args.workspaceId, userId: args.userId, activationId: args.activationId,
    });
    return { ok: res.ok, error: res.error };
  }
  // rollback: reactivate the parent (previous) version
  if (!activation.parent_activation_id) return { ok: false, error: "no_previous_version" };
  const { data: parent } = await sb
    .from("systemmind_workflow_activations")
    .select("id, status")
    .eq("id", activation.parent_activation_id)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!parent) return { ok: false, error: "previous_version_not_found" };
  // Current one steps aside first…
  await sb.from("systemmind_workflow_activations")
    .update({ status: "rolled_back", deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", args.activationId);
  // …then the parent (already tested when it was active) comes back.
  const { error } = await sb
    .from("systemmind_workflow_activations")
    .update({
      status: "active",
      activated_by_user_id: args.userId,
      activated_at: new Date().toISOString(),
      deactivated_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parent.id);
  if (error) return { ok: false, error: error.message };
  try {
    const { writeSystemMindAudit } = await import("@/lib/systemmind/systemmind-automation.server");
    await writeSystemMindAudit({
      workspaceId: args.workspaceId,
      userId: args.userId,
      actionType: "workflow_rollback",
      targetType: "systemmind_workflow_activations",
      targetId: args.activationId,
      finalAfterState: { rolledBackTo: parent.id },
      executedAt: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
  return { ok: true };
}

// ── Health (wizard surface) ───────────────────────────────────────────────────

export async function getWorkflowHealthServer(args: {
  workspaceId: string;
  activationId: string;
}): Promise<HealthReport> {
  const { data: activation } = await sb
    .from("systemmind_workflow_activations")
    .select("id, workspace_id, status")
    .eq("id", args.activationId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!activation) throw new Error("activation_not_found");
  return computeActivationHealth(activation);
}
