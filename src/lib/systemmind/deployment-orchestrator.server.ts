// ── SystemMind Deployment Orchestrator — server-only core ──────────────────────
// Checklist-driven, approval-gated guidance over the EXISTING agent deployment
// flow (Deploy Agent → phone/SIP → agent type → Go Live). This module never
// builds a second deploy path — every provider-affecting action delegates to
// the exact services the manual flow uses.
//
// Safety invariants (do not weaken):
//   • The checklist is ALWAYS recomputed live from real data (agents.settings,
//     custom_agent_configs, workspace_settings, approvals). Only human
//     decisions that cannot be recomputed (skips, chosen telephony path,
//     test-call outcome) persist in systemmind_deployments.checklist_overrides.
//   • NOTHING that purchases numbers, imports SIP trunks, reassigns numbers or
//     goes live runs without a single-use approval row consumed atomically
//     (UPDATE … WHERE status='approved' AND consumed_at IS NULL RETURNING).
//     Re-validation + number-conflict re-check happen AFTER consume (TOCTOU),
//     and the provider call is always the LAST isolable step.
//   • Strict workspace isolation: every read/write is scoped to the caller's
//     workspace_id; the WBAH managed workspace is hard-blocked entirely.
//   • Custom-workflow agents with Build Workspace lineage NEVER go live here —
//     they route through applyBuildVersionServer (Apply & Go Live) with its
//     impact analysis + HiveMind approval. The checklist surfaces that.
//   • Approval payloads never contain credential values
//     (assertNoCredentialValues before insert).
//   • Every orchestration action writes a systemmind_audit_logs row; costed
//     actions also record provider usage + a SystemMind usage event for
//     AccountsMind.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeSystemMindAudit } from "@/lib/systemmind/systemmind-automation.server";
import { assertNoCredentialValues } from "@/lib/systemmind/systemmind-generators.server";
import { recordSystemMindUsageEvent } from "@/lib/systemmind/build-workspace.server";
import { trackProviderUsage } from "@/lib/providers/usage.server";
import {
  buyRetellPhoneNumberService,
  importSipPhoneNumberService,
  assignNumberToAgentService,
  listRetellPhoneNumbersService,
} from "@/lib/builder/retell-telephony.server";
import {
  goLiveAgentService,
  saveAgentPhoneNumberService,
} from "@/lib/agents/agent-golive.server";
import type { AgentGoLiveType } from "@/lib/agents/agents.functions";

// ── Types ──────────────────────────────────────────────────────────────────────

export const DEPLOYMENT_TYPES = [
  "receptionist",
  "lead_generation",
  "qualification",
  "whatsapp",
  "sms",
  "custom_workflow",
] as const;
export type DeploymentType = (typeof DEPLOYMENT_TYPES)[number];

export const APPROVAL_ACTION_TYPES = [
  "purchase_number",
  "assign_number",
  "import_sip",
  "reassign_number",
  "go_live",
] as const;
export type ApprovalActionType = (typeof APPROVAL_ACTION_TYPES)[number];

export type ChecklistStatus =
  | "complete"
  | "missing"
  | "needs_approval"
  | "failed"
  | "optional"
  | "blocked";

export type ChecklistItem = {
  key: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
  /** Suggested UI action, e.g. "choose_number" | "request_approval" | "apply_go_live". */
  action: string | null;
};

export type TelephonyPath = "purchase_retell" | "existing_number" | "sip" | "skip";

export type ChecklistOverrides = {
  telephony_path?: TelephonyPath;
  test_call?: "passed" | "failed" | "skipped";
  followup_configured?: boolean;
  extraction_confirmed?: boolean;
  crm_mapping_confirmed?: boolean;
};

export type ApprovalSummary = {
  id: string;
  action_type: ApprovalActionType;
  status: string;
  payload: Record<string, unknown>;
  requested_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  error: string | null;
};

export type DeploymentChecklist = {
  deployment: {
    id: string;
    workspace_id: string;
    agent_id: string;
    agent_name: string;
    retell_agent_id: string | null;
    agent_type: string | null;
    deployment_type: DeploymentType;
    phone_number: string | null;
    sip_trunk_ref: string | null;
    status: string;
    go_live_at: string | null;
    build_session_id: string | null;
    build_version_id: string | null;
    workflow_id: string | null;
    created_at: string;
  };
  items: ChecklistItem[];
  goLiveReady: boolean;
  blockers: string[];
  warnings: string[];
  numberConflict: { phoneNumber: string; agentId: string; agentName: string } | null;
  approvals: ApprovalSummary[];
  overrides: ChecklistOverrides;
};

const sb = () => supabaseAdmin as any;

// ── WBAH isolation ─────────────────────────────────────────────────────────────
// WBAH is a managed analytics workspace. Deployment orchestration must never
// run there — nothing gets deployed into it and its telephony config never
// feeds another workspace.
const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

export async function assertNotWbahForDeployment(workspaceId: string): Promise<void> {
  const msg =
    "Deployment orchestration is disabled in the WBAH workspace — it is a managed analytics workspace and its telephony configuration must stay isolated.";
  if (!workspaceId) throw new Error("A workspace is required for deployment orchestration.");
  if (workspaceId === WBAH_WORKSPACE_ID) throw new Error(msg);
  try {
    const { data } = await sb().from("workspaces").select("slug").eq("id", workspaceId).maybeSingle();
    if (data?.slug === "webuyanyhouse") throw new Error(msg);
  } catch (err: any) {
    if (String(err?.message ?? "").includes("Deployment orchestration is disabled")) throw err;
    // Lookup failure: the id check above already covers the known WBAH workspace.
  }
}

// ── Shared loaders (always workspace-scoped) ───────────────────────────────────

async function loadAgentOrThrow(workspaceId: string, agentId: string) {
  const { data, error } = await sb()
    .from("agents")
    .select("id, name, workspace_id, settings")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Agent not found in this workspace.");
  return data as { id: string; name: string; workspace_id: string; settings: Record<string, unknown> | null };
}

async function loadDeploymentOrThrow(workspaceId: string, deploymentId: string) {
  const { data, error } = await sb()
    .from("systemmind_deployments")
    .select("*")
    .eq("id", deploymentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Deployment not found in this workspace.");
  return data as Record<string, any>;
}

async function loadWorkspaceRetellKeyInfo(workspaceId: string) {
  const { data } = await sb()
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const wsKey = (data?.retell_workspace_id as string | undefined)?.trim();
  const hasWorkspaceKey = !!(wsKey && wsKey.startsWith("key_"));
  const hasPlatformKey = !!process.env.RETELL_API_KEY;
  return { hasWorkspaceKey, hasPlatformKey, hasAnyKey: hasWorkspaceKey || hasPlatformKey };
}

async function loadCustomAgentConfig(workspaceId: string, agentId: string) {
  const { data } = await sb()
    .from("custom_agent_configs")
    .select("id, extraction_fields, crm_field_mapping, outcome_schema, deployment_readiness_score")
    .eq("workspace_id", workspaceId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as
    | {
        id: string;
        extraction_fields: unknown[];
        crm_field_mapping: Record<string, unknown>;
        outcome_schema: unknown[];
        deployment_readiness_score: number;
      }
    | null;
}

/**
 * Detect whether a phone number is already assigned to ANOTHER agent in the
 * SAME workspace (cross-workspace numbers are invisible by design — strict
 * isolation). Used both at checklist time (warning) and re-checked AFTER an
 * approval is consumed (hard gate unless the action is reassign_number).
 */
export async function detectNumberConflictServer(args: {
  workspaceId: string;
  phoneNumber: string;
  excludeAgentId: string;
}): Promise<{ phoneNumber: string; agentId: string; agentName: string } | null> {
  if (!args.phoneNumber) return null;
  const { data } = await sb()
    .from("agents")
    .select("id, name, settings")
    .eq("workspace_id", args.workspaceId)
    .neq("id", args.excludeAgentId);
  for (const row of (data ?? []) as Array<{ id: string; name: string; settings: any }>) {
    const s = (row.settings ?? {}) as Record<string, unknown>;
    if ((s.phoneNumber as string | undefined) === args.phoneNumber) {
      return { phoneNumber: args.phoneNumber, agentId: row.id, agentName: row.name ?? "another agent" };
    }
  }
  return null;
}

// ── Deployment lifecycle ───────────────────────────────────────────────────────

function inferDeploymentType(
  settings: Record<string, unknown>,
  hasCustomConfig: boolean,
  explicit?: DeploymentType,
): DeploymentType {
  if (explicit && DEPLOYMENT_TYPES.includes(explicit)) return explicit;
  if (hasCustomConfig) return "custom_workflow";
  const t = String(settings.dashboardAgentType ?? settings.agentType ?? "").toLowerCase();
  if (t.includes("custom")) return "custom_workflow";
  if (t.includes("lead")) return "lead_generation";
  if (t.includes("qual")) return "qualification";
  if (t.includes("whatsapp")) return "whatsapp";
  if (t.includes("sms")) return "sms";
  return "receptionist";
}

/**
 * Find the active deployment record for an agent, or create one. Never creates
 * duplicates: one non-abandoned deployment per agent.
 */
export async function getOrCreateDeploymentServer(args: {
  workspaceId: string;
  userId: string | null;
  agentId: string;
  deploymentType?: DeploymentType;
}): Promise<{ deploymentId: string; created: boolean }> {
  await assertNotWbahForDeployment(args.workspaceId);
  const agent = await loadAgentOrThrow(args.workspaceId, args.agentId);
  const settings = (agent.settings ?? {}) as Record<string, unknown>;

  const { data: existing } = await sb()
    .from("systemmind_deployments")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("agent_id", args.agentId)
    .neq("status", "abandoned")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { deploymentId: existing.id as string, created: false };

  const customCfg = await loadCustomAgentConfig(args.workspaceId, args.agentId);
  const deploymentType = inferDeploymentType(settings, !!customCfg, args.deploymentType);

  // Build Workspace lineage (custom workflow agents built there must go live
  // through Apply & Go Live, never through this orchestrator).
  const { data: buildSession } = await sb()
    .from("systemmind_build_sessions")
    .select("id, active_version_id")
    .eq("workspace_id", args.workspaceId)
    .eq("target_agent_id", args.agentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: row, error } = await sb()
    .from("systemmind_deployments")
    .insert({
      workspace_id: args.workspaceId,
      created_by_user_id: args.userId,
      agent_id: args.agentId,
      retell_agent_id:
        (settings.deployedRetellAgentId as string | undefined) ??
        (settings.retellAgentId as string | undefined) ??
        null,
      agent_type: (settings.dashboardAgentType as string | undefined) ?? null,
      deployment_type: deploymentType,
      phone_number: (settings.phoneNumber as string | undefined) ?? null,
      build_session_id: buildSession?.id ?? null,
      build_version_id: buildSession?.active_version_id ?? null,
      status: "in_progress",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: "deployment_started",
    targetType: "systemmind_deployment",
    targetId: row.id,
    finalAfterState: { agent_id: args.agentId, deployment_type: deploymentType },
  });
  return { deploymentId: row.id as string, created: true };
}

/** Record a human decision the detector cannot recompute. Whitelisted keys only. */
export async function setChecklistOverrideServer(args: {
  workspaceId: string;
  userId: string | null;
  deploymentId: string;
  overrides: ChecklistOverrides;
}): Promise<void> {
  await assertNotWbahForDeployment(args.workspaceId);
  const dep = await loadDeploymentOrThrow(args.workspaceId, args.deploymentId);
  const allowed: (keyof ChecklistOverrides)[] = [
    "telephony_path",
    "test_call",
    "followup_configured",
    "extraction_confirmed",
    "crm_mapping_confirmed",
  ];
  const clean: Record<string, unknown> = {};
  for (const k of allowed) {
    if (args.overrides[k] !== undefined) clean[k] = args.overrides[k];
  }
  if (Object.keys(clean).length === 0) return;
  const before = (dep.checklist_overrides ?? {}) as Record<string, unknown>;
  const next = { ...before, ...clean };
  const { error } = await sb()
    .from("systemmind_deployments")
    .update({ checklist_overrides: next, updated_at: new Date().toISOString() })
    .eq("id", args.deploymentId)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: "deployment_override_set",
    targetType: "systemmind_deployment",
    targetId: args.deploymentId,
    beforeState: before,
    finalAfterState: next,
  });
}

/** Pause (abandon) or reactivate a deployment record from the Workflows page. */
export async function setDeploymentActiveServer(args: {
  workspaceId: string;
  userId: string | null;
  deploymentId: string;
  active: boolean;
}): Promise<void> {
  await assertNotWbahForDeployment(args.workspaceId);
  const dep = await loadDeploymentOrThrow(args.workspaceId, args.deploymentId);
  const nextStatus = args.active ? "in_progress" : "abandoned";
  if (dep.status === "live" && !args.active) {
    throw new Error(
      "This deployment is live. Pausing the record does not stop the agent — take the agent offline from the Agents page first.",
    );
  }
  const { error } = await sb()
    .from("systemmind_deployments")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", args.deploymentId)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: args.active ? "deployment_reactivated" : "deployment_paused",
    targetType: "systemmind_deployment",
    targetId: args.deploymentId,
    beforeState: { status: dep.status },
    finalAfterState: { status: nextStatus },
  });
}

export async function listDeploymentsServer(args: {
  workspaceId: string;
}): Promise<Array<Record<string, any>>> {
  const { data, error } = await sb()
    .from("systemmind_deployments")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, any>>;
}

// ── Checklist detection (stateless — recomputed live every time) ───────────────

export async function computeDeploymentChecklistServer(args: {
  workspaceId: string;
  deploymentId: string;
}): Promise<DeploymentChecklist> {
  const dep = await loadDeploymentOrThrow(args.workspaceId, args.deploymentId);
  const agent = await loadAgentOrThrow(args.workspaceId, dep.agent_id);
  const settings = (agent.settings ?? {}) as Record<string, unknown>;
  const overrides = (dep.checklist_overrides ?? {}) as ChecklistOverrides;
  const deploymentType = (dep.deployment_type ?? "receptionist") as DeploymentType;
  const isCustom = deploymentType === "custom_workflow";

  const [keyInfo, customCfg, approvalsRes] = await Promise.all([
    loadWorkspaceRetellKeyInfo(args.workspaceId),
    isCustom ? loadCustomAgentConfig(args.workspaceId, dep.agent_id) : Promise.resolve(null),
    sb()
      .from("systemmind_deployment_approvals")
      .select("id, action_type, status, payload, requested_at, approved_at, consumed_at, error")
      .eq("deployment_id", args.deploymentId)
      .eq("workspace_id", args.workspaceId)
      .order("requested_at", { ascending: false }),
  ]);
  const approvals = ((approvalsRes?.data ?? []) as ApprovalSummary[]) || [];

  // Live agent state (ground truth — never the deployment row).
  const isLive = settings.isLive === true;
  const phoneNumber = (settings.phoneNumber as string | undefined) ?? null;
  const deployedRetellId =
    (settings.deployedRetellAgentId as string | undefined) ??
    (dep.retell_agent_id as string | undefined) ??
    null;
  // Mirror agent-golive.server.ts exactly: ElevenLabs-native agents are marked
  // by deploymentMode and may go live web-only without a Retell mapping.
  const isElNative =
    (settings.deploymentMode as string | undefined) === "ELEVENLABS_NATIVE" ||
    !!(settings.deployedElevenLabsAgentId as string | undefined);
  const agentTypeSelected =
    (settings.dashboardAgentType as string | undefined) ??
    (dep.agent_type as string | undefined) ??
    null;
  const telephonyPath = overrides.telephony_path;

  const blockers: string[] = [];
  const warnings: string[] = [];
  const items: ChecklistItem[] = [];
  const buildLinked = !!dep.build_version_id;

  // 1. Agent created
  items.push({
    key: "agent_created",
    label: "Agent created",
    status: "complete",
    detail: `"${agent.name}" exists in this workspace.`,
    action: null,
  });

  // 2. Retell agent mapped
  if (isElNative) {
    items.push({
      key: "retell_agent_mapped",
      label: "Voice agent mapped",
      status: "complete",
      detail: "ElevenLabs-native agent — no Retell mapping required.",
      action: null,
    });
  } else if (deployedRetellId) {
    items.push({
      key: "retell_agent_mapped",
      label: "Retell agent mapped",
      status: "complete",
      detail: `Production voice agent ${deployedRetellId} is mapped.`,
      action: null,
    });
  } else {
    items.push({
      key: "retell_agent_mapped",
      label: "Retell agent mapped",
      status: "missing",
      detail:
        "No production voice agent is mapped yet. Use Deploy Agent to clone the builder agent to production first.",
      action: "open_deploy_panel",
    });
  }

  // 3. Agent type selected
  items.push(
    agentTypeSelected
      ? {
          key: "agent_type_selected",
          label: "Agent type selected",
          status: "complete",
          detail: `Type: ${agentTypeSelected}.`,
          action: null,
        }
      : {
          key: "agent_type_selected",
          label: "Agent type selected",
          status: "missing",
          detail: "Select the agent type (Receptionist, Lead Gen, Qualification, Custom) before Go Live.",
          action: "select_agent_type",
        },
  );

  // 4. Workflow generated
  if (isCustom) {
    items.push(
      customCfg
        ? {
            key: "workflow_generated",
            label: "Workflow generated",
            status: "complete",
            detail: "Custom agent configuration exists.",
            action: null,
          }
        : {
            key: "workflow_generated",
            label: "Workflow generated",
            status: "missing",
            detail:
              "This custom agent has no generated configuration yet. Generate it in the Custom Agent builder or Build Workspace.",
            action: "open_custom_builder",
          },
    );
  } else {
    items.push({
      key: "workflow_generated",
      label: "Workflow generated",
      status: "optional",
      detail: "Prefabricated setup — the standard deployment template is used; no custom workflow required.",
      action: null,
    });
  }

  // 5. Post-call extraction
  if (isCustom) {
    const hasExtraction =
      (Array.isArray(customCfg?.extraction_fields) && customCfg!.extraction_fields.length > 0) ||
      overrides.extraction_confirmed === true;
    items.push(
      hasExtraction
        ? {
            key: "post_call_extraction",
            label: "Post-call extraction configured",
            status: "complete",
            detail: "Extraction fields are configured.",
            action: null,
          }
        : {
            key: "post_call_extraction",
            label: "Post-call extraction configured",
            status: "missing",
            detail:
              "This workflow needs post-call extraction fields before Go Live. SystemMind can generate them as a draft.",
            action: "generate_extraction",
          },
    );
  } else {
    items.push({
      key: "post_call_extraction",
      label: "Post-call extraction configured",
      status: "optional",
      detail: "Standard setups use the built-in post-call handling.",
      action: null,
    });
  }

  // 6. CRM mapping
  if (isCustom) {
    const hasCrm =
      (customCfg?.crm_field_mapping && Object.keys(customCfg.crm_field_mapping).length > 0) ||
      overrides.crm_mapping_confirmed === true;
    items.push(
      hasCrm
        ? {
            key: "crm_mapping",
            label: "CRM mapping configured",
            status: "complete",
            detail: "CRM field mapping is configured.",
            action: null,
          }
        : {
            key: "crm_mapping",
            label: "CRM mapping configured",
            status: "missing",
            detail:
              "This workflow captures data, but CRM mapping is incomplete. SystemMind can map the fields to WEBEE Smart Dash.",
            action: "generate_crm_mapping",
          },
    );
  } else {
    items.push({
      key: "crm_mapping",
      label: "CRM mapping configured",
      status: "optional",
      detail: "Standard setups map to WEBEE Smart Dash automatically.",
      action: null,
    });
  }

  // 7. Follow-up rules
  items.push({
    key: "followup_rules",
    label: "Follow-up rules configured",
    status: overrides.followup_configured === true ? "complete" : "optional",
    detail:
      overrides.followup_configured === true
        ? "Follow-up rules confirmed."
        : "Optional — configure follow-up rules in Workflows if this agent should trigger follow-ups.",
    action: null,
  });

  // 8 + 9. Telephony (number or SIP)
  const numberAssigned = !!phoneNumber;
  const skipped = telephonyPath === "skip";
  if (numberAssigned) {
    items.push({
      key: "number_or_sip_required",
      label: "Phone number or SIP trunk required",
      status: "complete",
      detail: "Telephony requirement satisfied.",
      action: null,
    });
    items.push({
      key: "number_selected",
      label: "Phone number / SIP selected",
      status: "complete",
      detail: `Number ${phoneNumber} is assigned to this agent.`,
      action: null,
    });
  } else if (isElNative) {
    items.push({
      key: "number_or_sip_required",
      label: "Phone number or SIP trunk required",
      status: "optional",
      detail: "ElevenLabs-native agent can run web-only; a number is optional.",
      action: "choose_number",
    });
    items.push({
      key: "number_selected",
      label: "Phone number / SIP selected",
      status: "optional",
      detail: "No number assigned — the agent will be web-only.",
      action: "choose_number",
    });
  } else if (skipped) {
    warnings.push("Telephony was skipped — this agent cannot take phone calls until a number is assigned.");
    items.push({
      key: "number_or_sip_required",
      label: "Phone number or SIP trunk required",
      status: "optional",
      detail: "Skipped for now. The agent cannot receive calls until a number or SIP trunk is assigned.",
      action: "choose_number",
    });
    items.push({
      key: "number_selected",
      label: "Phone number / SIP selected",
      status: "optional",
      detail: "Skipped for now.",
      action: "choose_number",
    });
  } else {
    if (!keyInfo.hasAnyKey) {
      blockers.push(
        "This workspace does not have a Retell API key configured. Add the key in Provider Settings before deployment can continue.",
      );
      items.push({
        key: "number_or_sip_required",
        label: "Phone number or SIP trunk required",
        status: "blocked",
        detail:
          "No Retell API key is configured for this workspace, so numbers cannot be purchased or assigned.",
        action: "open_provider_settings",
      });
    } else if (telephonyPath === "sip") {
      items.push({
        key: "number_or_sip_required",
        label: "Phone number or SIP trunk required",
        status: "missing",
        detail:
          "SIP trunk selected, but no SIP trunk is imported for this workspace yet. Add SIP settings or choose a Retell number.",
        action: "setup_sip",
      });
    } else {
      items.push({
        key: "number_or_sip_required",
        label: "Phone number or SIP trunk required",
        status: "missing",
        detail:
          "This agent needs a phone number before it can go live. Purchase a Retell number, assign an existing number, or use a SIP trunk.",
        action: "choose_number",
      });
    }
    items.push({
      key: "number_selected",
      label: "Phone number / SIP selected",
      status: keyInfo.hasAnyKey ? "missing" : "blocked",
      detail: "No number assigned yet.",
      action: "choose_number",
    });
  }

  // Number conflict detection (same workspace only — isolation by design).
  let numberConflict: DeploymentChecklist["numberConflict"] = null;
  if (phoneNumber) {
    numberConflict = await detectNumberConflictServer({
      workspaceId: args.workspaceId,
      phoneNumber,
      excludeAgentId: dep.agent_id,
    });
    if (numberConflict) {
      warnings.push(
        `This number is already assigned to ${numberConflict.agentName}. Reassigning it may stop that agent receiving calls. Choose another number, or request approval to reassign.`,
      );
    }
  }

  // 10. Webhook configured
  items.push({
    key: "webhook_configured",
    label: "Webhook configured",
    status: isLive ? "complete" : "optional",
    detail: isLive
      ? "Provider webhooks were configured by Go Live."
      : "Configured automatically during Go Live by the existing deployment logic.",
    action: null,
  });

  // 11. Test call
  const testCall = overrides.test_call;
  items.push(
    testCall === "passed"
      ? {
          key: "test_call_passed",
          label: "Test call passed",
          status: "complete",
          detail: "Test call marked as passed.",
          action: null,
        }
      : testCall === "failed"
        ? {
            key: "test_call_passed",
            label: "Test call passed",
            status: "failed",
            detail: "The last test call was marked failed. Fix the agent and re-test before Go Live.",
            action: "record_test_call",
          }
        : testCall === "skipped"
          ? {
              key: "test_call_passed",
              label: "Test call passed",
              status: "optional",
              detail: "Test call skipped by the user.",
              action: "record_test_call",
            }
          : {
              key: "test_call_passed",
              label: "Test call passed",
              status: "missing",
              detail: "Run a test call (or mark it skipped) before going live.",
              action: "record_test_call",
            },
  );

  // 12. Go Live ready — every required item must be complete.
  const requiredKeys = new Set(["retell_agent_mapped", "agent_type_selected"]);
  if (isCustom) {
    requiredKeys.add("workflow_generated");
    requiredKeys.add("post_call_extraction");
    requiredKeys.add("crm_mapping");
  }
  if (!isElNative && !skipped) requiredKeys.add("number_selected");
  const failedItems = items.filter((i) => requiredKeys.has(i.key) && i.status === "failed");
  const incomplete = items.filter(
    (i) => requiredKeys.has(i.key) && i.status !== "complete" && i.status !== "optional",
  );
  const testBlocked = items.some((i) => i.key === "test_call_passed" && i.status === "failed");
  const conflictBlocksGoLive = !!numberConflict;
  if (conflictBlocksGoLive) {
    blockers.push(
      `Number conflict: ${numberConflict!.phoneNumber} is also assigned to ${numberConflict!.agentName}. Resolve it (choose another number or approve a reassign) before Go Live.`,
    );
  }
  for (const i of incomplete) blockers.push(`${i.label}: ${i.detail}`);
  if (testBlocked) blockers.push("The last test call failed — fix and re-test before Go Live.");

  const goLiveReady =
    !isLive &&
    incomplete.length === 0 &&
    failedItems.length === 0 &&
    !testBlocked &&
    !conflictBlocksGoLive &&
    blockers.length === 0;

  items.push({
    key: "go_live_ready",
    label: "Go Live ready",
    status: isLive ? "complete" : goLiveReady ? "complete" : "blocked",
    detail: isLive
      ? "Agent is live."
      : goLiveReady
        ? "All required checks pass."
        : `Blocked: ${blockers[0] ?? "required steps are incomplete."}`,
    action: null,
  });

  // 13. User approval
  const goLiveApproved = approvals.find(
    (a) => a.action_type === "go_live" && a.status === "approved" && !a.consumed_at,
  );
  const goLivePending = approvals.find((a) => a.action_type === "go_live" && a.status === "pending");
  items.push(
    isLive
      ? {
          key: "approval_required",
          label: "User approval",
          status: "complete",
          detail: "Go Live was approved and executed.",
          action: null,
        }
      : goLiveApproved
        ? {
            key: "approval_required",
            label: "User approval",
            status: "complete",
            detail: "Go Live approval granted (not yet used).",
            action: null,
          }
        : goLivePending
          ? {
              key: "approval_required",
              label: "User approval",
              status: "needs_approval",
              detail: "A Go Live approval request is waiting for your decision.",
              action: "review_approval",
            }
          : {
              key: "approval_required",
              label: "User approval",
              status: goLiveReady ? "needs_approval" : "missing",
              detail: goLiveReady
                ? "Everything is ready — request and grant Go Live approval to proceed."
                : "Approval is requested once every required step is complete.",
              action: goLiveReady ? "request_go_live_approval" : null,
            },
  );

  // 14. Go Live
  if (isLive) {
    items.push({
      key: "go_live",
      label: "Go Live",
      status: "complete",
      detail: "Agent is live and taking traffic.",
      action: null,
    });
  } else if (buildLinked) {
    items.push({
      key: "go_live",
      label: "Go Live",
      status: "blocked",
      detail:
        "This agent was built in the Build Workspace — Go Live runs through Apply & Go Live there (with its impact analysis and HiveMind approval). This checklist tracks readiness only.",
      action: "open_build_workspace",
    });
  } else if (goLiveReady && goLiveApproved) {
    items.push({
      key: "go_live",
      label: "Go Live",
      status: "missing",
      detail: "Approved and ready — click Apply & Go Live to run the existing Go Live logic.",
      action: "apply_go_live",
    });
  } else {
    items.push({
      key: "go_live",
      label: "Go Live",
      status: "blocked",
      detail: goLiveReady
        ? "Waiting for Go Live approval."
        : "Blocked until every required step is complete and approval is granted.",
      action: null,
    });
  }

  // Persist a display snapshot + derived status (never the source of truth).
  const derivedStatus = isLive
    ? "live"
    : blockers.length > 0
      ? "blocked"
      : goLiveReady
        ? "ready"
        : dep.status === "abandoned"
          ? "abandoned"
          : "in_progress";
  await sb()
    .from("systemmind_deployments")
    .update({
      status: derivedStatus,
      retell_agent_id: deployedRetellId,
      agent_type: agentTypeSelected,
      phone_number: phoneNumber,
      go_live_at: isLive && !dep.go_live_at ? new Date().toISOString() : dep.go_live_at,
      report: {
        computed_at: new Date().toISOString(),
        items: items.map((i) => ({ key: i.key, status: i.status })),
        blockers,
        warnings,
        go_live_ready: goLiveReady,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.deploymentId)
    .eq("workspace_id", args.workspaceId);

  return {
    deployment: {
      id: dep.id,
      workspace_id: dep.workspace_id,
      agent_id: dep.agent_id,
      agent_name: agent.name,
      retell_agent_id: deployedRetellId,
      agent_type: agentTypeSelected,
      deployment_type: deploymentType,
      phone_number: phoneNumber,
      sip_trunk_ref: dep.sip_trunk_ref ?? null,
      status: derivedStatus,
      go_live_at: dep.go_live_at ?? null,
      build_session_id: dep.build_session_id ?? null,
      build_version_id: dep.build_version_id ?? null,
      workflow_id: dep.workflow_id ?? null,
      created_at: dep.created_at,
    },
    items,
    goLiveReady,
    blockers,
    warnings,
    numberConflict,
    approvals,
    overrides,
  };
}

// ── Approvals ──────────────────────────────────────────────────────────────────

/**
 * Create a pending approval row for a billing/telephony/live-affecting action.
 * The payload is exactly what the approver sees (cost estimate, provider,
 * workspace, agent, billing warning) — never credential values.
 */
export async function requestDeploymentApprovalServer(args: {
  workspaceId: string;
  userId: string | null;
  deploymentId: string;
  actionType: ApprovalActionType;
  payload: Record<string, unknown>;
}): Promise<{ approvalId: string }> {
  await assertNotWbahForDeployment(args.workspaceId);
  if (!APPROVAL_ACTION_TYPES.includes(args.actionType)) {
    throw new Error(`Unknown approval action type: ${args.actionType}`);
  }
  const dep = await loadDeploymentOrThrow(args.workspaceId, args.deploymentId);
  const agent = await loadAgentOrThrow(args.workspaceId, dep.agent_id);
  // Never persist secrets in approval rows or audit logs. SIP passwords are
  // arbitrary strings no pattern can catch — strip them outright. Trunks that
  // require password auth must use the manual SIP flow (which passes the
  // password straight to the provider without storing it).
  const scrubbed: Record<string, unknown> = { ...args.payload };
  delete scrubbed.sip_password;
  delete scrubbed.sipPassword;
  assertNoCredentialValues(scrubbed, "Deployment approval payload");

  if (args.actionType === "go_live" && dep.build_version_id) {
    throw new Error(
      "This agent goes live through Build Workspace Apply & Go Live — request approval there, not from the deployment checklist.",
    );
  }

  // One pending/approved-unconsumed approval per action type at a time.
  const { data: existing } = await sb()
    .from("systemmind_deployment_approvals")
    .select("id, status, consumed_at")
    .eq("deployment_id", args.deploymentId)
    .eq("workspace_id", args.workspaceId)
    .eq("action_type", args.actionType)
    .in("status", ["pending", "approved"])
    .is("consumed_at", null)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { approvalId: existing.id as string };

  const payload = {
    ...scrubbed,
    workspace_id: args.workspaceId,
    agent_id: dep.agent_id,
    agent_name: agent.name,
    billing_warning:
      "This action may create provider costs (phone number rental, SIP usage, voice minutes). Costs are billed to this workspace.",
  };

  const { data: row, error } = await sb()
    .from("systemmind_deployment_approvals")
    .insert({
      deployment_id: args.deploymentId,
      workspace_id: args.workspaceId,
      action_type: args.actionType,
      payload,
      status: "pending",
      requested_by: args.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: `deployment_approval_requested:${args.actionType}`,
    targetType: "systemmind_deployment_approval",
    targetId: row.id,
    proposedAfterState: payload,
    approvalStatus: "pending",
  });
  return { approvalId: row.id as string };
}

/** Approve or reject a pending approval. Never consumes it. */
export async function decideDeploymentApprovalServer(args: {
  workspaceId: string;
  userId: string;
  approvalId: string;
  approve: boolean;
}): Promise<void> {
  await assertNotWbahForDeployment(args.workspaceId);
  const nextStatus = args.approve ? "approved" : "rejected";
  const { data: row, error } = await sb()
    .from("systemmind_deployment_approvals")
    .update({
      status: nextStatus,
      approved_by: args.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", args.approvalId)
    .eq("workspace_id", args.workspaceId)
    .eq("status", "pending")
    .select("id, action_type, deployment_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Approval not found, not pending, or not in this workspace.");
  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: `deployment_approval_${nextStatus}:${row.action_type}`,
    targetType: "systemmind_deployment_approval",
    targetId: args.approvalId,
    approvalStatus: nextStatus,
    approvedBy: args.userId,
  });
}

// ── Approved-action executor ───────────────────────────────────────────────────

type ExecuteResult = {
  ok: boolean;
  actionType: ApprovalActionType;
  result: Record<string, unknown>;
};

/**
 * Execute a previously approved action. Consumes the approval ATOMICALLY
 * first (single-use), then re-validates everything (TOCTOU), and only then —
 * as the LAST step — calls the provider via the SAME services the manual flow
 * uses. Never call this without an approved approval row.
 */
export async function executeApprovedDeploymentActionServer(args: {
  supabase: SupabaseClient<any>;
  workspaceId: string;
  userId: string;
  approvalId: string;
}): Promise<ExecuteResult> {
  await assertNotWbahForDeployment(args.workspaceId);
  const startedAt = new Date();

  // 1) Atomic single-use consume — the ONLY way to reach the provider call.
  const { data: approval, error: consumeErr } = await sb()
    .from("systemmind_deployment_approvals")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("id", args.approvalId)
    .eq("workspace_id", args.workspaceId)
    .eq("status", "approved")
    .is("consumed_at", null)
    .select("*")
    .maybeSingle();
  if (consumeErr) throw new Error(consumeErr.message);
  if (!approval) {
    throw new Error("This action is not approved (or the approval was already used). Request approval again.");
  }
  const actionType = approval.action_type as ApprovalActionType;
  const payload = (approval.payload ?? {}) as Record<string, unknown>;

  const failApproval = async (message: string) => {
    await sb()
      .from("systemmind_deployment_approvals")
      .update({ status: "failed", error: message.slice(0, 2000) })
      .eq("id", args.approvalId)
      .eq("workspace_id", args.workspaceId);
    await writeSystemMindAudit({
      workspaceId: args.workspaceId,
      userId: args.userId,
      actionType: `deployment_execute_failed:${actionType}`,
      targetType: "systemmind_deployment_approval",
      targetId: args.approvalId,
      error: message,
    });
  };

  try {
    // 2) Re-validate AFTER consume — workspace scope, agent ownership.
    const dep = await loadDeploymentOrThrow(args.workspaceId, approval.deployment_id);
    const agent = await loadAgentOrThrow(args.workspaceId, dep.agent_id);
    const settings = (agent.settings ?? {}) as Record<string, unknown>;
    const deployedRetellId =
      (settings.deployedRetellAgentId as string | undefined) ??
      (dep.retell_agent_id as string | undefined) ??
      undefined;

    let result: Record<string, unknown> = {};

    if (actionType === "purchase_number") {
      // 3) Provider call is the LAST isolable step.
      const bought = await buyRetellPhoneNumberService({
        userId: args.userId,
        workspaceId: args.workspaceId,
        areaCode: typeof payload.area_code === "number" ? (payload.area_code as number) : undefined,
        tollFree: payload.toll_free === true,
        nickname: (payload.nickname as string | undefined) ?? agent.name,
        inboundAgentId: deployedRetellId,
        outboundAgentId: deployedRetellId,
        agentRowId: agent.id,
      });
      await saveAgentPhoneNumberService({ supabase: args.supabase, id: agent.id, phoneNumber: bought.phoneNumber });
      result = { phone_number: bought.phoneNumber, type: bought.type };
      // Clamp the client-supplied estimate to a sane range — it is a display
      // figure for AccountsMind, never a billing source of truth.
      const rawEstimate = typeof payload.estimated_cost_usd === "number" ? (payload.estimated_cost_usd as number) : 0;
      const estimate = Math.min(Math.max(rawEstimate, 0), 100);
      void trackProviderUsage({
        workspaceId: args.workspaceId,
        category: "telephony",
        providerName: "retell",
        costUsd: estimate,
        unitsConsumed: 1,
        unitType: "phone_number",
      });
    } else if (actionType === "assign_number" || actionType === "reassign_number") {
      const phoneNumber = String(payload.phone_number ?? "");
      if (!phoneNumber) throw new Error("The approval payload does not contain a phone number.");
      // Conflict re-check AFTER consume: plain assign must not steal a number.
      const conflict = await detectNumberConflictServer({
        workspaceId: args.workspaceId,
        phoneNumber,
        excludeAgentId: agent.id,
      });
      if (conflict && actionType !== "reassign_number") {
        throw new Error(
          `This number is already assigned to ${conflict.agentName}. Choose another number, or request a reassign approval instead.`,
        );
      }
      await assignNumberToAgentService({
        userId: args.userId,
        workspaceId: args.workspaceId,
        phoneNumber,
        inboundAgentId: deployedRetellId,
        outboundAgentId: deployedRetellId,
        agentRowId: agent.id,
      });
      await saveAgentPhoneNumberService({ supabase: args.supabase, id: agent.id, phoneNumber });
      if (conflict && actionType === "reassign_number") {
        // The number left the other agent — keep its settings truthful.
        await saveAgentPhoneNumberService({ supabase: args.supabase, id: conflict.agentId, phoneNumber: null });
      }
      result = { phone_number: phoneNumber, reassigned_from: conflict?.agentName ?? null };
    } else if (actionType === "import_sip") {
      const phoneNumber = String(payload.phone_number ?? "");
      const terminationUri = String(payload.termination_uri ?? "");
      const imported = await importSipPhoneNumberService({
        userId: args.userId,
        workspaceId: args.workspaceId,
        phoneNumber,
        terminationUri,
        sipUsername: (payload.sip_username as string | undefined) ?? undefined,
        // sip_password is never persisted in approval payloads (secrets are
        // stripped at request time) — password-auth trunks use the manual flow.
        sipPassword: undefined,
        nickname: (payload.nickname as string | undefined) ?? agent.name,
        inboundAgentId: deployedRetellId,
        outboundAgentId: deployedRetellId,
        agentRowId: agent.id,
      });
      await saveAgentPhoneNumberService({ supabase: args.supabase, id: agent.id, phoneNumber: imported.phoneNumber });
      await sb()
        .from("systemmind_deployments")
        .update({ sip_trunk_ref: terminationUri, updated_at: new Date().toISOString() })
        .eq("id", dep.id)
        .eq("workspace_id", args.workspaceId);
      result = { phone_number: imported.phoneNumber, termination_uri: terminationUri };
    } else if (actionType === "go_live") {
      if (dep.build_version_id) {
        throw new Error(
          "This agent goes live through Build Workspace Apply & Go Live — not from the deployment checklist.",
        );
      }
      // Full readiness re-check AFTER consume — the checklist is the gate.
      const checklist = await computeDeploymentChecklistServer({
        workspaceId: args.workspaceId,
        deploymentId: dep.id,
      });
      if (!checklist.goLiveReady) {
        throw new Error(`Go Live blocked:\n${checklist.blockers.map((b) => `• ${b}`).join("\n")}`);
      }
      const agentType = ((): AgentGoLiveType => {
        const t = String(checklist.deployment.agent_type ?? "receptionist");
        if (t === "lead_generation" || t === "client_qualification" || t === "receptionist") return t;
        if (t === "qualification") return "client_qualification";
        return "receptionist";
      })();
      const live = await goLiveAgentService({
        supabase: args.supabase,
        userId: args.userId,
        workspaceId: args.workspaceId,
        id: agent.id,
        agentType,
      });
      result = { live: live.live, web_only: live.webOnly };
    } else {
      throw new Error(`Unknown action type: ${actionType}`);
    }

    // 4) Record the outcome on the approval + deployment rows.
    await sb()
      .from("systemmind_deployment_approvals")
      .update({ result })
      .eq("id", args.approvalId)
      .eq("workspace_id", args.workspaceId);
    await writeSystemMindAudit({
      workspaceId: args.workspaceId,
      userId: args.userId,
      actionType: `deployment_executed:${actionType}`,
      targetType: "systemmind_deployment",
      targetId: dep.id,
      beforeState: { phone_number: dep.phone_number, status: dep.status },
      finalAfterState: result,
      approvalStatus: "approved",
      approvedBy: (approval.approved_by as string | undefined) ?? null,
      executedAt: new Date().toISOString(),
    });
    void recordSystemMindUsageEvent({
      workspaceId: args.workspaceId,
      userId: args.userId,
      workflowId: dep.workflow_id ?? null,
      taskType: `deployment_${actionType}`,
      sourcePage: "deployment_orchestrator",
      startedAt,
      completedAt: new Date(),
      success: true,
    });

    // Refresh the checklist snapshot so the Workflows page shows fresh state.
    await computeDeploymentChecklistServer({ workspaceId: args.workspaceId, deploymentId: dep.id });

    return { ok: true, actionType, result };
  } catch (err: any) {
    const message = String(err?.message ?? err);
    await failApproval(message);
    void recordSystemMindUsageEvent({
      workspaceId: args.workspaceId,
      userId: args.userId,
      taskType: `deployment_${actionType}`,
      sourcePage: "deployment_orchestrator",
      startedAt,
      completedAt: new Date(),
      success: false,
      error: message,
    });
    throw err;
  }
}

// ── Existing-number listing (for "assign existing" option) ────────────────────

export async function listWorkspaceNumbersServer(args: {
  workspaceId: string;
  userId: string;
  agentRowId?: string;
}): Promise<Array<{ phoneNumber: string; nickname: string; inboundAgentId: string | null }>> {
  await assertNotWbahForDeployment(args.workspaceId);
  const numbers = await listRetellPhoneNumbersService({
    userId: args.userId,
    workspaceId: args.workspaceId,
    agentRowId: args.agentRowId,
  });
  return numbers.map((n) => ({
    phoneNumber: n.phoneNumber,
    nickname: n.nickname,
    inboundAgentId: n.inboundAgentId,
  }));
}
