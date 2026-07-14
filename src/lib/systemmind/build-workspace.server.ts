// ── SystemMind Build Workspace — server-only core ──────────────────────────────
// Replit-style iterative builder: chat sessions produce IMMUTABLE numbered
// versions of a full agent/workflow setup (prompt, workflow steps, variables,
// extraction fields, follow-up rules, channel setup). Versions can be viewed,
// restored, compared, simulated (deterministic walk — no LLM), and Applied
// into the live workspace. High-risk applies route through the existing
// SystemMind hub + HiveMind approval pipeline (action_kind
// "build_workspace_apply") — they can never auto-apply.
//
// Safety invariants (do not weaken):
//   • workspace_id comes ONLY from server context — never from client input or
//     model output.
//   • No credentials/secrets ever enter prompts, configs, or messages — names
//     only (assertNoCredentialValues re-checked at generation AND apply time).
//   • Apply re-validates the stored config server-side (zod + step sanitiser)
//     — never trusts what sat in the DB.
//   • Live workspace_workflows rows are NEVER touched until Apply.
//   • Agent-prompt applies write custom_agent_configs — NEVER agents.settings.
//   • Every prompt/apply/restore writes a systemmind_audit_logs row, and every
//     model run writes a systemmind_usage_events row with pricing frozen at
//     write time.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  ALLOWED_STEP_TYPES,
  StepSchema,
  classifyDraftRisk,
  sanitizeGeneratedSteps,
  writeSystemMindAudit,
  isClaudeEnabled,
  submitDraftForApprovalServer,
  type GeneratedDraft,
} from "@/lib/systemmind/systemmind-automation.server";
import { assertNoCredentialValues } from "@/lib/systemmind/systemmind-generators.server";
import { RequirementsSchema } from "@/lib/systemmind/requirements-schema";
import {
  computeBuildImpactReport,
  createBuildSnapshotServer,
  listBuildSnapshotsServer,
  rollbackBuildSnapshotServer,
  type BuildImpactReport,
} from "@/lib/systemmind/build-protection.server";

// Mirrors the automation layer's module-private whitelist.
const BW_ALLOWED_TRIGGER_TYPES = ["lead_added", "lead_status_changed", "call_completed", "manual", "scheduled"] as const;

// ── Generated build config schema (strict validation of model output) ─────────
const BuildWorkflowSchema = z.object({
  name:           z.string().min(1).max(200),
  purpose:        z.string().max(2000).default(""),
  trigger_type:   z.string().max(60).default("manual"),
  trigger_config: z.record(z.unknown()).default({}),
  steps:          z.array(StepSchema).min(1).max(30),
});

const BuildConfigSchema = z.object({
  agent_prompt:      z.string().max(20000).default(""),
  workflow:          BuildWorkflowSchema,
  variables:         z.array(z.object({
    name:        z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    source:      z.string().max(120).optional(),
  })).max(40).default([]),
  extraction_fields: z.array(z.object({
    name:        z.string().min(1).max(120),
    type:        z.string().max(60).optional(),
    description: z.string().max(500).optional(),
  })).max(40).default([]),
  follow_up_rules:   z.array(z.object({
    trigger:     z.string().min(1).max(300),
    action:      z.string().min(1).max(300),
    delay_hours: z.number().min(0).max(2160).optional(),
    channel:     z.string().max(60).optional(),
  })).max(20).default([]),
  channel_setup:        z.record(z.unknown()).default({}),
  required_credentials: z.array(z.string().max(120)).max(20).default([]),
  risks:                z.array(z.string().max(300)).max(20).default([]),
  test_plan:            z.array(z.string().max(400)).max(20).default([]),
  // Guided Requirements Assistant output (optional — absent on all configs
  // produced before the assistant existed, and on plain chat-built configs).
  requirements:         RequirementsSchema.optional(),
});

export type BuildConfig = z.infer<typeof BuildConfigSchema>;

const ModelResponseSchema = z.object({
  summary: z.string().min(1).max(4000),
  config:  BuildConfigSchema,
});

// ── Validation helpers ─────────────────────────────────────────────────────────
export function validateConfigOrThrow(raw: unknown, label: string): BuildConfig {
  const parsed = BuildConfigSchema.parse(raw);
  parsed.workflow.steps = sanitizeGeneratedSteps(parsed.workflow.steps as GeneratedDraft["steps"]);
  if (parsed.workflow.steps.length === 0) {
    throw new Error(`${label}: workflow had no valid steps after safety filtering.`);
  }
  if (parsed.workflow.steps[0].type !== "trigger") {
    parsed.workflow.steps.unshift({ id: "step-0-trigger", type: "trigger", next: parsed.workflow.steps[0].id });
  }
  if (!(BW_ALLOWED_TRIGGER_TYPES as readonly string[]).includes(parsed.workflow.trigger_type)) {
    parsed.workflow.trigger_type = "manual";
  }
  assertNoCredentialValues(parsed, label);
  return parsed;
}

export function classifyConfigRisk(config: BuildConfig): { riskLevel: "low" | "medium" | "high"; riskReasons: string[] } {
  // Map onto the automation layer's deterministic classifier so build-workspace
  // and hub drafts always agree on what counts as high-risk.
  return classifyDraftRisk({
    name:                 config.workflow.name,
    purpose:              config.workflow.purpose || "(build workspace)",
    trigger_type:         config.workflow.trigger_type,
    trigger_config:       config.workflow.trigger_config,
    steps:                config.workflow.steps as GeneratedDraft["steps"],
    custom_prompt:        config.agent_prompt,
    required_credentials: config.required_credentials,
    risks:                config.risks,
    test_plan:            config.test_plan,
  });
}

// ── Pricing + usage engine ──────────────────────────────────────────────────────
export type SystemMindPricing = {
  id:                          string;
  base_charge_per_run_usd:     number;
  charge_per_minute_usd:       number;
  charge_per_1k_tokens_usd:    number;
  charge_per_tool_call_usd:    number;
  included_runs_per_month:     number;
  included_seconds_per_month:  number;
  included_tokens_per_month:   number;
  overage_multiplier:          number;
  expose_provider_cost:        boolean;
};

export async function getCurrentSystemMindPricingServer(): Promise<SystemMindPricing | null> {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("cost_engine_systemmind")
    .select("*").eq("is_current", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return {
    id:                         String(data.id),
    base_charge_per_run_usd:    Number(data.base_charge_per_run_usd ?? 0),
    charge_per_minute_usd:      Number(data.charge_per_minute_usd ?? 0),
    charge_per_1k_tokens_usd:   Number(data.charge_per_1k_tokens_usd ?? 0),
    charge_per_tool_call_usd:   Number(data.charge_per_tool_call_usd ?? 0),
    included_runs_per_month:    Number(data.included_runs_per_month ?? 0),
    included_seconds_per_month: Number(data.included_seconds_per_month ?? 0),
    included_tokens_per_month:  Number(data.included_tokens_per_month ?? 0),
    overage_multiplier:         Number(data.overage_multiplier ?? 1),
    expose_provider_cost:       !!data.expose_provider_cost,
  };
}

export function computeSystemMindCharge(
  pricing: SystemMindPricing | null,
  m: { elapsedMs: number; totalTokens: number; toolCalls: number },
): { billableUnits: number; chargeUsd: number } {
  if (!pricing) return { billableUnits: 0, chargeUsd: 0 };
  const charge =
    pricing.base_charge_per_run_usd +
    (m.elapsedMs / 60000) * pricing.charge_per_minute_usd +
    (m.totalTokens / 1000) * pricing.charge_per_1k_tokens_usd +
    m.toolCalls * pricing.charge_per_tool_call_usd;
  const rounded = Math.round(charge * 1e6) / 1e6;
  // billable_units = pre-overage charge in USD; the monthly allowance and
  // overage multiplier are applied at AccountsMind aggregation time, not here.
  return { billableUnits: rounded, chargeUsd: rounded };
}

// Fire-and-forget safe: usage recording must never break the user-facing flow.
export async function recordSystemMindUsageEvent(ev: {
  workspaceId:  string;
  userId?:      string | null;
  sessionId?:   string | null;
  versionId?:   string | null;
  workflowId?:  string | null;
  taskType:     string;
  sourcePage?:  string;
  modelProvider?: string | null;
  modelId?:     string | null;
  promptTokens?: number;
  completionTokens?: number;
  toolCallCount?: number;
  startedAt:    Date;
  completedAt:  Date;
  success:      boolean;
  error?:       string | null;
}): Promise<void> {
  try {
    const sb = supabaseAdmin as any;
    const pricing = await getCurrentSystemMindPricingServer();
    const promptTokens     = ev.promptTokens ?? 0;
    const completionTokens = ev.completionTokens ?? 0;
    const totalTokens      = promptTokens + completionTokens;
    const elapsedMs        = Math.max(0, ev.completedAt.getTime() - ev.startedAt.getTime());
    const toolCalls        = ev.toolCallCount ?? 0;
    const { billableUnits, chargeUsd } = computeSystemMindCharge(pricing, { elapsedMs, totalTokens, toolCalls });
    const { error } = await sb.from("systemmind_usage_events").insert({
      workspace_id:                ev.workspaceId,
      user_id:                     ev.userId ?? null,
      session_id:                  ev.sessionId ?? null,
      version_id:                  ev.versionId ?? null,
      workflow_id:                 ev.workflowId ?? null,
      task_type:                   ev.taskType,
      source_page:                 ev.sourcePage ?? "agent_builder",
      model_provider:              ev.modelProvider ?? null,
      model_id:                    ev.modelId ?? null,
      prompt_tokens:               promptTokens,
      completion_tokens:           completionTokens,
      total_tokens:                totalTokens,
      tool_call_count:             toolCalls,
      started_at:                  ev.startedAt.toISOString(),
      completed_at:                ev.completedAt.toISOString(),
      elapsed_ms:                  elapsedMs,
      estimated_provider_cost_usd: 0, // set by callers that know the routed cost
      pricing_config_id:           pricing?.id ?? null,
      billable_units:              billableUnits,
      customer_charge_usd:         chargeUsd,
      billing_status:              "recorded",
      success:                     ev.success,
      error:                       ev.error ? String(ev.error).slice(0, 2000) : null,
    });
    if (error) console.error("[build-workspace] usage event write failed:", error.message);
  } catch (err: any) {
    console.error("[build-workspace] usage event write crashed:", err?.message);
  }
}

// Same as above but includes the routed provider cost (generation runs).
async function recordGenerationUsage(ev: Parameters<typeof recordSystemMindUsageEvent>[0] & {
  providerCostUsd: number;
}): Promise<void> {
  try {
    const sb = supabaseAdmin as any;
    const pricing = await getCurrentSystemMindPricingServer();
    const promptTokens     = ev.promptTokens ?? 0;
    const completionTokens = ev.completionTokens ?? 0;
    const totalTokens      = promptTokens + completionTokens;
    const elapsedMs        = Math.max(0, ev.completedAt.getTime() - ev.startedAt.getTime());
    const toolCalls        = ev.toolCallCount ?? 0;
    const { billableUnits, chargeUsd } = computeSystemMindCharge(pricing, { elapsedMs, totalTokens, toolCalls });
    const { error } = await sb.from("systemmind_usage_events").insert({
      workspace_id:                ev.workspaceId,
      user_id:                     ev.userId ?? null,
      session_id:                  ev.sessionId ?? null,
      version_id:                  ev.versionId ?? null,
      workflow_id:                 ev.workflowId ?? null,
      task_type:                   ev.taskType,
      source_page:                 ev.sourcePage ?? "agent_builder",
      model_provider:              ev.modelProvider ?? null,
      model_id:                    ev.modelId ?? null,
      prompt_tokens:               promptTokens,
      completion_tokens:           completionTokens,
      total_tokens:                totalTokens,
      tool_call_count:             toolCalls,
      started_at:                  ev.startedAt.toISOString(),
      completed_at:                ev.completedAt.toISOString(),
      elapsed_ms:                  elapsedMs,
      estimated_provider_cost_usd: Math.round((ev.providerCostUsd ?? 0) * 1e6) / 1e6,
      pricing_config_id:           pricing?.id ?? null,
      billable_units:              billableUnits,
      customer_charge_usd:         chargeUsd,
      billing_status:              "recorded",
      success:                     ev.success,
      error:                       ev.error ? String(ev.error).slice(0, 2000) : null,
    });
    if (error) console.error("[build-workspace] usage event write failed:", error.message);
  } catch (err: any) {
    console.error("[build-workspace] usage event write crashed:", err?.message);
  }
}

// ── Session/version helpers ─────────────────────────────────────────────────────
async function getSessionOrThrow(workspaceId: string, sessionId: string): Promise<any> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_build_sessions")
    .select("*")
    .eq("id", sessionId).eq("workspace_id", workspaceId).eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Build session not found in this workspace.");
  return data;
}

async function getVersionOrThrow(workspaceId: string, sessionId: string, versionId: string): Promise<any> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_build_versions")
    .select("*")
    .eq("id", versionId).eq("session_id", sessionId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Build version not found in this session.");
  return data;
}

async function nextVersionNumber(sessionId: string): Promise<number> {
  const sb = supabaseAdmin as any;
  const { data } = await sb.from("systemmind_build_versions")
    .select("version_number")
    .eq("session_id", sessionId)
    .order("version_number", { ascending: false })
    .limit(1).maybeSingle();
  return (data?.version_number ?? 0) + 1;
}

async function insertMessage(args: {
  sessionId: string; workspaceId: string; userId?: string | null;
  role: "user" | "systemmind" | "system"; content: string; versionId?: string | null;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  const { error } = await sb.from("systemmind_build_messages").insert({
    session_id:   args.sessionId,
    workspace_id: args.workspaceId,
    user_id:      args.userId ?? null,
    role:         args.role,
    content:      args.content.slice(0, 20000),
    version_id:   args.versionId ?? null,
  });
  if (error) console.error("[build-workspace] message insert failed:", error.message);
}

// Supersede: when a new version arrives, prior draft/testing versions become "revised".
async function supersedeOpenVersions(sessionId: string, workspaceId: string): Promise<void> {
  const sb = supabaseAdmin as any;
  await sb.from("systemmind_build_versions")
    .update({ status: "revised" })
    .eq("session_id", sessionId).eq("workspace_id", workspaceId)
    .in("status", ["draft", "testing"]);
}

// ── Insert a deterministic (non-AI) version into an existing session ───────────
// Used by the Guided Requirements Assistant: its generator is deterministic, so
// versions enter the normal immutable pipeline without a model call. Reuses the
// same supersede + numbering + message + audit bookkeeping as promptBuildSessionServer.
export async function insertBuildVersionServer(args: {
  workspaceId: string;
  userId:      string | null;
  sessionId:   string;
  config:      BuildConfig;
  summary:     string;
  userPrompt?: string | null;
  auditAction?: string;
}): Promise<{ versionId: string; versionNumber: number; version: Record<string, any> }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, sessionId } = args;
  const session = await getSessionOrThrow(workspaceId, sessionId);
  if (session.status !== "active") throw new Error("This build session is archived — restore it first.");

  // Same trust boundary as every other entry point: full re-validation.
  const config = validateConfigOrThrow(args.config, "Requirements build config");
  const { riskLevel, riskReasons } = classifyConfigRisk(config);

  await supersedeOpenVersions(sessionId, workspaceId);
  const versionNumber = await nextVersionNumber(sessionId);

  const { data: version, error: vErr } = await sb.from("systemmind_build_versions").insert({
    session_id:         sessionId,
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    version_number:     versionNumber,
    user_prompt:        args.userPrompt ? args.userPrompt.slice(0, 8000) : null,
    assistant_summary:  args.summary.slice(0, 4000),
    generated_config:   config,
    risk_level:         riskLevel,
    risk_reasons:       riskReasons,
    status:             "draft",
  }).select("*").single();
  if (vErr) throw new Error(`Failed to save version: ${vErr.message}`);

  await insertMessage({
    sessionId, workspaceId, userId: null, role: "systemmind",
    content: args.summary, versionId: version.id,
  });
  await sb.from("systemmind_build_sessions")
    .update({ current_version_id: version.id })
    .eq("id", sessionId).eq("workspace_id", workspaceId);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: args.auditAction ?? "build_version_generated",
    targetType: "systemmind_build_version",
    targetId:   version.id,
    proposedAfterState: {
      session_id: sessionId, version_number: versionNumber,
      risk_level: riskLevel, source: "requirements_assistant",
    },
    approvalStatus: "not_requested",
  });

  return { versionId: version.id as string, versionNumber, version };
}

// ── Create session ──────────────────────────────────────────────────────────────
export async function createBuildSessionServer(args: {
  workspaceId:      string;
  userId:           string | null;
  title?:           string;
  sourcePage?:      string;
  targetAgentId?:   string | null;
  linkedWorkflowId?: string | null;
}): Promise<{ sessionId: string; seededVersionId: string | null }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId } = args;
  if (!workspaceId) throw new Error("workspace_id missing — refusing to create build session.");

  // Edit-mode seed: load the live workflow (workspace-scoped) BEFORE creating
  // anything, so a bad id fails cleanly.
  let seedWorkflow: any = null;
  if (args.linkedWorkflowId) {
    const { data: wf, error: wfErr } = await sb.from("workspace_workflows")
      .select("*")
      .eq("id", args.linkedWorkflowId).eq("workspace_id", workspaceId)
      .maybeSingle();
    if (wfErr) throw new Error(wfErr.message);
    if (!wf) throw new Error("Workflow not found in this workspace.");
    seedWorkflow = wf;
  }

  const title = (args.title ?? (seedWorkflow ? `Edit: ${seedWorkflow.name}` : "Untitled build")).slice(0, 200);
  const sourcePage = ["agent_builder","whatsapp_builder","follow_up_centre","workflows","systemmind","hivemind"]
    .includes(args.sourcePage ?? "") ? String(args.sourcePage) : "agent_builder";

  const { data: session, error } = await sb.from("systemmind_build_sessions").insert({
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    title,
    source_page:        sourcePage,
    target_agent_id:    args.targetAgentId ?? null,
    linked_workflow_id: args.linkedWorkflowId ?? null,
    status:             "active",
  }).select("id").single();
  if (error) throw new Error(`Failed to create build session: ${error.message}`);
  const sessionId = session.id as string;

  let seededVersionId: string | null = null;
  if (seedWorkflow) {
    // Build a version-1 config from the live workflow so the user iterates on
    // real current state. Steps that fail today's stricter schema are dropped
    // by the sanitiser (with a system note) rather than blocking the session.
    const rawSteps = ((seedWorkflow.flow_definition as any)?.steps ?? []) as any[];
    const stepsParsed = z.array(StepSchema).safeParse(rawSteps);
    const steps = stepsParsed.success
      ? sanitizeGeneratedSteps(stepsParsed.data as GeneratedDraft["steps"])
      : [];
    const config: BuildConfig = BuildConfigSchema.parse({
      agent_prompt: String((seedWorkflow.flow_definition as any)?.custom_prompt ?? ""),
      workflow: {
        name:           String(seedWorkflow.name ?? "Imported workflow").slice(0, 200),
        purpose:        String(seedWorkflow.description ?? "").slice(0, 2000),
        trigger_type:   String(seedWorkflow.trigger_type ?? "manual"),
        trigger_config: seedWorkflow.trigger_config ?? {},
        steps:          steps.length > 0 ? steps : [{ id: "step-1", type: "trigger" }],
      },
    });
    const { riskLevel, riskReasons } = classifyConfigRisk(config);
    const { data: v, error: vErr } = await sb.from("systemmind_build_versions").insert({
      session_id:         sessionId,
      workspace_id:       workspaceId,
      created_by_user_id: userId,
      version_number:     1,
      user_prompt:        null,
      assistant_summary:  `Loaded from live workflow "${seedWorkflow.name}". This is the current live setup — describe the changes you want and I'll produce v2. Nothing touches the live workflow until you Apply.`,
      generated_config:   config,
      risk_level:         riskLevel,
      risk_reasons:       riskReasons,
      status:             "draft",
      applied_workflow_id: seedWorkflow.id,
    }).select("id").single();
    if (vErr) throw new Error(`Failed to seed version from workflow: ${vErr.message}`);
    seededVersionId = v.id as string;
    await sb.from("systemmind_build_sessions")
      .update({ current_version_id: seededVersionId })
      .eq("id", sessionId).eq("workspace_id", workspaceId);
    await insertMessage({
      sessionId, workspaceId, userId, role: "system", versionId: seededVersionId,
      content: `Session opened from live workflow "${seedWorkflow.name}" (v1 = current live setup).${
        stepsParsed.success && steps.length === stepsParsed.data.length ? "" :
        " Note: some existing steps did not pass the current safety schema and were left out of the editable copy — the live workflow is unchanged."}`,
    });
  }

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_session_created",
    targetType: "systemmind_build_session",
    targetId:   sessionId,
    finalAfterState: { title, source_page: sourcePage, linked_workflow_id: args.linkedWorkflowId ?? null },
  });

  return { sessionId, seededVersionId };
}

// ── Create session seeded from a legacy conversion ─────────────────────────────
// Used by the Legacy Logic Converter (legacy-conversion.server.ts): the caller
// has already produced a validated BuildConfig from a legacy source. This
// creates a fresh session whose v1 IS that converted draft — nothing live is
// ever touched (the standard Apply pipeline handles that later, with all its
// protection rules).
export async function createBuildSessionFromConfigServer(args: {
  workspaceId:      string;
  userId:           string | null;
  title:            string;
  sourcePage?:      string;
  targetAgentId?:   string | null;
  config:           BuildConfig;
  assistantSummary: string;
  systemNote?:      string;
}): Promise<{ sessionId: string; versionId: string }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId } = args;
  if (!workspaceId) throw new Error("workspace_id missing — refusing to create build session.");

  // Re-validate defensively (schema + sanitiser + credential scan) even though
  // the converter already did — never trust a config across module boundaries.
  const config = validateConfigOrThrow(args.config, "Converted build config");

  const sourcePage = ["agent_builder","whatsapp_builder","follow_up_centre","workflows","systemmind","hivemind"]
    .includes(args.sourcePage ?? "") ? String(args.sourcePage) : "systemmind";

  const { data: session, error } = await sb.from("systemmind_build_sessions").insert({
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    title:              args.title.slice(0, 200),
    source_page:        sourcePage,
    target_agent_id:    args.targetAgentId ?? null,
    linked_workflow_id: null,
    status:             "active",
  }).select("id").single();
  if (error) throw new Error(`Failed to create build session: ${error.message}`);
  const sessionId = session.id as string;

  const { riskLevel, riskReasons } = classifyConfigRisk(config);
  const { data: v, error: vErr } = await sb.from("systemmind_build_versions").insert({
    session_id:         sessionId,
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    version_number:     1,
    user_prompt:        null,
    assistant_summary:  args.assistantSummary.slice(0, 4000),
    generated_config:   config,
    risk_level:         riskLevel,
    risk_reasons:       riskReasons,
    status:             "draft",
  }).select("id").single();
  if (vErr) throw new Error(`Failed to seed converted version: ${vErr.message}`);
  const versionId = v.id as string;

  await sb.from("systemmind_build_sessions")
    .update({ current_version_id: versionId })
    .eq("id", sessionId).eq("workspace_id", workspaceId);

  await insertMessage({
    sessionId, workspaceId, userId, role: "system", versionId,
    content: (args.systemNote ?? "Session opened from a legacy-logic conversion (v1 = converted draft). The original setup is untouched.").slice(0, 20000),
  });

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_session_created",
    targetType: "systemmind_build_session",
    targetId:   sessionId,
    finalAfterState: { title: args.title.slice(0, 200), source_page: sourcePage, seeded_from: "legacy_conversion" },
  });

  return { sessionId, versionId };
}

// ── Prompt (generation / iteration) ─────────────────────────────────────────────
const BUILD_SYSTEM_PROMPT = `You are SystemMind, the AI CTO of the WEBEE platform, working inside the Build Workspace — an iterative builder where the user refines a complete agent/workflow setup through conversation. You NEVER execute anything: every version is a draft until the human clicks Apply.

You produce (or revise) ONE complete build config covering:
- agent_prompt: the operating prompt for the AI agent (voice/WhatsApp), or "" if this build is workflow-only.
- workflow: a WEBEE workflow using ONLY these step types:
  - trigger            — first step, marks the entry point (no params)
  - update_lead_status — set "status" field (one of: need_to_call, calling, contact_made, interested, qualified, not_interested, callback_requested)
  - push_to_crm        — sync the lead to the connected CRM (no params)
  - create_callback    — schedule callback; params: delay_hours, delay_minutes
  - create_task        — create an ops task; params: title
  - send_whatsapp      — queue a WhatsApp message; params: template (template name string)
  - send_email         — queue an email follow-up (no params)
  - notify_user        — notify the workspace owner; params: title
  - assign_agent       — assign an AI agent; params: agent_assignment (descriptive string)
  - call_lead          — queue an outbound AI call to the lead (no params)
  - branch             — conditional split; params: conditions: [{field, op, value, next}] where op ∈ equals|not_equals|greater_than|less_than|contains
  - stop_workflow      — terminal step (no params)
  Trigger types allowed: lead_added, lead_status_changed, call_completed, manual, scheduled.
  STEP GRAPH RULES: first step MUST be type "trigger" with id "step-1"; every non-terminal step needs "next" OR conditions (branch only); ids "step-1", "step-2", ... unique; keep it 3–12 steps.
- variables: data the agent/workflow needs at runtime (name + where it comes from).
- extraction_fields: fields the agent should capture from conversations.
- follow_up_rules: plain-language follow-up rules ({trigger, action, delay_hours?, channel?}).
- channel_setup: descriptive channel requirements (e.g. {"whatsapp": "Twilio number required"}). NO credential values.
- required_credentials: credential NAMES only (e.g. "Twilio Auth Token") — NEVER values.
- risks: every real risk (e.g. "messages customers automatically").
- test_plan: 3–6 concrete manual test steps.

ITERATION RULES:
- When given a CURRENT CONFIG and a change request, return the FULL updated config (not a diff). Keep everything the user didn't ask to change.
- In "summary", explain in plain language what you built/changed and why, plus anything the user should double-check.

SAFETY RULES (mandatory): NEVER include API keys, tokens, passwords, or any credential values anywhere. Never invent step types. Simple and reliable beats clever.

Return ONLY valid JSON:
{ "summary": "...", "config": { "agent_prompt": "...", "workflow": { "name": "...", "purpose": "...", "trigger_type": "lead_added", "trigger_config": {}, "steps": [...] }, "variables": [...], "extraction_fields": [...], "follow_up_rules": [...], "channel_setup": {...}, "required_credentials": [...], "risks": [...], "test_plan": [...] } }`;

export type PromptBuildResult = {
  versionId:     string;
  versionNumber: number;
  version:       Record<string, any>;
  summary:       string;
  riskLevel:     "low" | "medium" | "high";
  modelUsed:     string;
  provider:      string;
  usedFallback:  boolean;
  elapsedMs:     number;
  totalTokens:   number;
};

export async function promptBuildSessionServer(args: {
  workspaceId: string;
  userId:      string | null;
  sessionId:   string;
  prompt:      string;
}): Promise<PromptBuildResult> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, sessionId } = args;
  const prompt = args.prompt.trim();
  if (!prompt) throw new Error("Describe what you want SystemMind to build or change.");
  const session = await getSessionOrThrow(workspaceId, sessionId);
  if (session.status !== "active") throw new Error("This build session is archived — restore it first.");

  const startedAt = new Date();

  // Current version config (iteration context)
  let currentVersion: any = null;
  if (session.current_version_id) {
    const { data } = await sb.from("systemmind_build_versions")
      .select("id, version_number, generated_config")
      .eq("id", session.current_version_id).eq("workspace_id", workspaceId)
      .maybeSingle();
    currentVersion = data ?? null;
  }

  await insertMessage({ sessionId, workspaceId, userId, role: "user", content: prompt });

  const userBlock = currentVersion
    ? `CURRENT CONFIG (version ${currentVersion.version_number}):\n${JSON.stringify(currentVersion.generated_config).slice(0, 24000)}\n\nUSER CHANGE REQUEST:\n"${prompt.slice(0, 4000)}"\n\nReturn the FULL updated config as strict JSON.`
    : `Design a complete agent/workflow build for this request:\n\n"${prompt.slice(0, 4000)}"\n\nStrict JSON only, whitelisted step types only.`;

  const claudeEnabled = isClaudeEnabled();

  try {
    const routed = await routeGenerate({
      system:      BUILD_SYSTEM_PROMPT,
      user:        userBlock,
      contentType: "systemmind_build_workspace",
      maxTokens:   8000,
      mode:        "manual",
      provider:    claudeEnabled ? "claude" : "openai",
      model:       claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
      settings:    {},
      workspaceId,
      sb,
    });

    let rawJson: unknown;
    try {
      const cleaned = routed.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      rawJson = JSON.parse(cleaned);
    } catch {
      throw new Error("SystemMind returned invalid JSON — try again or rephrase the request.");
    }
    const parsed = ModelResponseSchema.parse(rawJson);
    const config = validateConfigOrThrow(parsed.config, "Generated build config");
    const { riskLevel, riskReasons } = classifyConfigRisk(config);

    await supersedeOpenVersions(sessionId, workspaceId);
    const versionNumber = await nextVersionNumber(sessionId);

    const { data: version, error: vErr } = await sb.from("systemmind_build_versions").insert({
      session_id:         sessionId,
      workspace_id:       workspaceId,
      created_by_user_id: userId,
      version_number:     versionNumber,
      user_prompt:        prompt.slice(0, 8000),
      assistant_summary:  parsed.summary.slice(0, 4000),
      generated_config:   config,
      risk_level:         riskLevel,
      risk_reasons:       riskReasons,
      status:             "draft",
      model_provider:     routed.provider,
      model_id:           routed.model,
    }).select("*").single();
    if (vErr) throw new Error(`Failed to save version: ${vErr.message}`);

    await insertMessage({
      sessionId, workspaceId, userId: null, role: "systemmind",
      content: parsed.summary, versionId: version.id,
    });

    // Session bookkeeping: pointer + auto-title on first prompt.
    const sessionUpdate: Record<string, unknown> = { current_version_id: version.id };
    if (!currentVersion && (session.title === "Untitled build")) {
      sessionUpdate.title = config.workflow.name.slice(0, 200);
    }
    await sb.from("systemmind_build_sessions").update(sessionUpdate)
      .eq("id", sessionId).eq("workspace_id", workspaceId);

    const completedAt = new Date();
    await recordGenerationUsage({
      workspaceId, userId, sessionId, versionId: version.id,
      taskType: currentVersion ? "build_iteration" : "build_generation",
      sourcePage: session.source_page,
      modelProvider: routed.provider, modelId: routed.model,
      promptTokens: routed.inputTokens, completionTokens: routed.outputTokens,
      startedAt, completedAt, success: true,
      providerCostUsd: routed.costUsd,
    });

    await writeSystemMindAudit({
      workspaceId, userId,
      actionType: "build_version_generated",
      targetType: "systemmind_build_version",
      targetId:   version.id,
      proposedAfterState: {
        session_id: sessionId, version_number: versionNumber,
        risk_level: riskLevel, model: routed.model,
      },
      approvalStatus: "not_requested",
    });

    return {
      versionId:     version.id,
      versionNumber,
      version,
      summary:       parsed.summary,
      riskLevel,
      modelUsed:     routed.model,
      provider:      routed.provider,
      usedFallback:  routed.usedFallback,
      elapsedMs:     completedAt.getTime() - startedAt.getTime(),
      totalTokens:   routed.inputTokens + routed.outputTokens,
    };
  } catch (err: any) {
    const completedAt = new Date();
    await recordSystemMindUsageEvent({
      workspaceId, userId, sessionId,
      taskType: currentVersion ? "build_iteration" : "build_generation",
      sourcePage: session.source_page,
      startedAt, completedAt, success: false, error: err?.message ?? String(err),
    });
    await insertMessage({
      sessionId, workspaceId, userId: null, role: "system",
      content: `Generation failed: ${(err?.message ?? String(err)).slice(0, 500)}`,
    });
    throw err;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────────
export async function listBuildSessionsServer(workspaceId: string): Promise<any[]> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_build_sessions")
    .select("*")
    .eq("workspace_id", workspaceId).eq("is_deleted", false)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getBuildSessionServer(workspaceId: string, sessionId: string): Promise<{
  session:   Record<string, any>;
  versions:  any[];
  messages:  any[];
  snapshots: any[];
}> {
  const sb = supabaseAdmin as any;
  const session = await getSessionOrThrow(workspaceId, sessionId);
  const [{ data: versions, error: vErr }, { data: messages, error: mErr }, snapshots] = await Promise.all([
    sb.from("systemmind_build_versions").select("*")
      .eq("session_id", sessionId).eq("workspace_id", workspaceId)
      .order("version_number", { ascending: false }).limit(100),
    sb.from("systemmind_build_messages").select("*")
      .eq("session_id", sessionId).eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }).limit(500),
    listBuildSnapshotsServer(workspaceId, sessionId).catch(() => []),
  ]);
  if (vErr) throw new Error(vErr.message);
  if (mErr) throw new Error(mErr.message);
  return { session, versions: versions ?? [], messages: messages ?? [], snapshots };
}

// Deploy-tab provenance: latest applied/deployed build version for an agent.
export async function getBuildProvenanceForAgentServer(
  workspaceId: string,
  agentId: string,
): Promise<Record<string, any> | null> {
  const sb = supabaseAdmin as any;
  const { data: sessions } = await sb.from("systemmind_build_sessions")
    .select("id, title")
    .eq("workspace_id", workspaceId).eq("target_agent_id", agentId).eq("is_deleted", false)
    .order("updated_at", { ascending: false }).limit(20);
  const list = (sessions ?? []) as any[];
  if (list.length === 0) return null;
  const { data: version } = await sb.from("systemmind_build_versions")
    .select("id, session_id, version_number, status, assistant_summary, applied_at, deployed_at, applied_workflow_id, created_at")
    .eq("workspace_id", workspaceId)
    .in("session_id", list.map((s) => s.id))
    .in("status", ["applied", "deployed"])
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!version) return null;
  const session = list.find((s) => s.id === version.session_id);
  return { ...version, session_title: session?.title ?? "Build session" };
}

// ── Restore / notes / archive ────────────────────────────────────────────────────
export async function restoreBuildVersionServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; versionId: string;
}): Promise<{ versionId: string; versionNumber: number }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, sessionId } = args;
  const session = await getSessionOrThrow(workspaceId, sessionId);
  if (session.status !== "active") throw new Error("This build session is archived — restore it first.");
  const source = await getVersionOrThrow(workspaceId, sessionId, args.versionId);

  // Immutable history: restoring creates a NEW version with the old config.
  const config = validateConfigOrThrow(source.generated_config, "Restored build config");
  const { riskLevel, riskReasons } = classifyConfigRisk(config);

  await supersedeOpenVersions(sessionId, workspaceId);
  const versionNumber = await nextVersionNumber(sessionId);

  const { data: version, error } = await sb.from("systemmind_build_versions").insert({
    session_id:               sessionId,
    workspace_id:             workspaceId,
    created_by_user_id:       userId,
    version_number:           versionNumber,
    user_prompt:              null,
    assistant_summary:        `Restored from version ${source.version_number}.`,
    generated_config:         config,
    risk_level:               riskLevel,
    risk_reasons:             riskReasons,
    status:                   "draft",
    restored_from_version_id: source.id,
    model_provider:           source.model_provider,
    model_id:                 source.model_id,
  }).select("id, version_number").single();
  if (error) throw new Error(`Failed to restore version: ${error.message}`);

  await sb.from("systemmind_build_sessions").update({ current_version_id: version.id })
    .eq("id", sessionId).eq("workspace_id", workspaceId);

  await insertMessage({
    sessionId, workspaceId, userId, role: "system", versionId: version.id,
    content: `Restored version ${source.version_number} as version ${versionNumber}.`,
  });

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_version_restored",
    targetType: "systemmind_build_version",
    targetId:   version.id,
    beforeState: { restored_from: source.id, source_version: source.version_number },
    finalAfterState: { version_number: versionNumber },
  });

  return { versionId: version.id, versionNumber: version.version_number };
}

export async function setBuildVersionNotesServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; versionId: string; notes: string;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  await getSessionOrThrow(args.workspaceId, args.sessionId);
  await getVersionOrThrow(args.workspaceId, args.sessionId, args.versionId);
  const { error } = await sb.from("systemmind_build_versions")
    .update({ notes: args.notes.slice(0, 4000) })
    .eq("id", args.versionId).eq("session_id", args.sessionId).eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
}

export async function setBuildSessionArchivedServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; archived: boolean;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  const session = await getSessionOrThrow(args.workspaceId, args.sessionId);
  const to = args.archived ? "archived" : "active";
  if (session.status === to) return;
  const { error } = await sb.from("systemmind_build_sessions")
    .update({ status: to })
    .eq("id", args.sessionId).eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: args.archived ? "build_session_archived" : "build_session_restored",
    targetType: "systemmind_build_session",
    targetId:   args.sessionId,
    beforeState: { status: session.status },
    finalAfterState: { status: to },
  });
}

// ── Simulation (deterministic walk — NO LLM) ────────────────────────────────────
// Walks the step graph exactly the way the workflow executor would, enumerating
// every branch path, and cross-checks workspace readiness (providers, agents)
// with existence-only queries. Never sends anything, never reads credential
// values.
const STEP_DESCRIPTIONS: Record<string, string> = {
  trigger:            "Workflow entry point",
  update_lead_status: "Sets the lead's status",
  push_to_crm:        "Syncs the lead to the connected CRM",
  create_callback:    "Schedules a callback",
  create_task:        "Creates an ops task",
  send_whatsapp:      "Queues a WhatsApp message to the customer",
  send_email:         "Queues an email follow-up to the customer",
  notify_user:        "Notifies the workspace owner",
  assign_agent:       "Assigns an AI agent",
  call_lead:          "Queues an outbound AI call to the lead",
  branch:             "Conditional split",
  stop_workflow:      "Stops the workflow",
};

export type SimulationResult = {
  ok:               boolean;
  stepCount:        number;
  paths:            Array<{ label: string; steps: Array<{ id: string; type: string; description: string }> }>;
  actionsTriggered: string[];
  variables:        Array<{ name: string; source: string }>;
  warnings:         string[];
  missingSetup:     string[];
};

async function checkWorkspaceReadiness(
  workspaceId: string,
  config: BuildConfig,
): Promise<string[]> {
  const sb = supabaseAdmin as any;
  const missing: string[] = [];
  const stepTypes = new Set(config.workflow.steps.map((s: any) => s.type));
  try {
    if (stepTypes.has("send_whatsapp")) {
      const [{ data: ws }, { data: wati }] = await Promise.all([
        sb.from("workspace_settings")
          .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_access_token")
          .eq("workspace_id", workspaceId).maybeSingle(),
        sb.from("wati_connections").select("status").eq("workspace_id", workspaceId).maybeSingle(),
      ]);
      const twilioOk = !!(ws?.twilio_account_sid?.trim() && ws?.twilio_auth_token?.trim() && ws?.whatsapp_phone_id?.trim());
      const metaOk   = !!(ws?.meta_phone_number_id?.trim() && ws?.meta_access_token?.trim());
      const watiOk   = wati?.status === "connected";
      if (!twilioOk && !metaOk && !watiOk) {
        missing.push("WhatsApp provider not configured — connect Twilio, Meta or WATI in WhatsApp Settings before this workflow can send messages.");
      }
    }
    if (stepTypes.has("call_lead") || stepTypes.has("assign_agent")) {
      const { data: agents } = await sb.from("agents")
        .select("id, retell_agent_id, settings")
        .eq("workspace_id", workspaceId).limit(200);
      const hasDeployed = ((agents ?? []) as any[]).some((a) => {
        try {
          const s = typeof a.settings === "string" ? JSON.parse(a.settings) : (a.settings ?? {});
          return !!(s.deployedRetellAgentId || a.retell_agent_id);
        } catch { return !!a.retell_agent_id; }
      });
      if (!hasDeployed) missing.push("No deployed voice agent found — deploy an agent before this workflow can place calls.");
    }
  } catch (err: any) {
    missing.push(`Readiness check incomplete: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  for (const cred of config.required_credentials) {
    missing.push(`Credential required (enter it in WEBEE settings — never in this builder): ${cred}`);
  }
  return missing;
}

export async function simulateBuildVersionServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; versionId: string;
}): Promise<SimulationResult> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, sessionId, versionId } = args;
  const startedAt = new Date();
  await getSessionOrThrow(workspaceId, sessionId);
  const version = await getVersionOrThrow(workspaceId, sessionId, versionId);
  const config = validateConfigOrThrow(version.generated_config, "Simulated build config");

  const steps = config.workflow.steps as any[];
  const byId = new Map<string, any>(steps.map((s) => [String(s.id), s]));
  const warnings: string[] = [];
  const paths: SimulationResult["paths"] = [];
  const reached = new Set<string>();

  // Depth-first enumeration of every branch path (bounded).
  type Frame = { stepId: string | undefined; trail: Array<{ id: string; type: string; description: string }>; label: string; visited: Set<string> };
  const stack: Frame[] = [{ stepId: String(steps[0].id), trail: [], label: "Main path", visited: new Set() }];
  while (stack.length > 0 && paths.length < 20) {
    const frame = stack.pop()!;
    let cursor = frame.stepId;
    const trail = [...frame.trail];
    const visited = new Set(frame.visited);
    let guard = 0;
    let branched = false;
    while (cursor && guard++ < 60) {
      const step = byId.get(cursor);
      if (!step) { warnings.push(`Step "${cursor}" is referenced but does not exist — this path stalls.`); break; }
      if (visited.has(cursor)) { warnings.push(`Loop detected at step "${cursor}" — the executor would stop here.`); break; }
      visited.add(cursor);
      reached.add(cursor);
      const desc = STEP_DESCRIPTIONS[step.type] ?? step.type;
      trail.push({
        id: String(step.id), type: String(step.type),
        description: step.title ? `${desc}: ${step.title}` : (step.status ? `${desc} → ${step.status}` : desc),
      });
      if (step.type === "stop_workflow") break;
      if (step.type === "branch") {
        const conds = (step.conditions ?? []) as any[];
        if (conds.length === 0) warnings.push(`Branch "${step.id}" has no conditions — nothing can pass through it.`);
        conds.forEach((c, i) => {
          stack.push({
            stepId: String(c.next),
            trail:  [...trail],
            label:  `${frame.label} → branch ${step.id} [${c.field} ${c.op} ${String(c.value)}]`,
            visited: new Set(visited),
          });
        });
        if (step.next) {
          stack.push({ stepId: String(step.next), trail: [...trail], label: `${frame.label} → branch ${step.id} [else]`, visited: new Set(visited) });
        } else if (conds.length > 0) {
          warnings.push(`Branch "${step.id}" has no "else" path — leads matching none of the conditions stop silently.`);
        }
        branched = true;
        break;
      }
      if (!step.next) {
        if (step.type !== "stop_workflow") warnings.push(`Step "${step.id}" (${step.type}) has no "next" — the path ends here without an explicit stop.`);
        break;
      }
      cursor = String(step.next);
    }
    if (!branched) paths.push({ label: frame.label, steps: trail });
  }

  for (const s of steps) {
    if (!reached.has(String(s.id))) warnings.push(`Step "${s.id}" (${s.type}) is unreachable from the trigger.`);
  }

  const actionsTriggered = [...new Set(
    steps.filter((s) => !["trigger","branch","stop_workflow"].includes(String(s.type)))
         .map((s) => STEP_DESCRIPTIONS[s.type] ?? String(s.type)),
  )];
  const variables: Array<{ name: string; source: string }> = [
    ...config.variables.map((v) => ({ name: v.name, source: v.source ?? v.description ?? "runtime" })),
    ...config.extraction_fields.map((f) => ({ name: f.name, source: "extracted from conversation" })),
  ];

  const missingSetup = await checkWorkspaceReadiness(workspaceId, config);

  // Version bookkeeping: draft → testing (revised/applied etc. stay put).
  if (version.status === "draft") {
    await sb.from("systemmind_build_versions").update({ status: "testing" })
      .eq("id", versionId).eq("session_id", sessionId).eq("workspace_id", workspaceId);
  }

  const completedAt = new Date();
  await recordSystemMindUsageEvent({
    workspaceId, userId, sessionId, versionId,
    taskType: "build_simulation", sourcePage: "systemmind",
    startedAt, completedAt, success: true,
  });

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_version_simulated",
    targetType: "systemmind_build_version",
    targetId:   versionId,
    finalAfterState: { paths: paths.length, warnings: warnings.length, missing_setup: missingSetup.length },
  });

  return {
    ok: warnings.length === 0 && missingSetup.length === 0,
    stepCount: steps.length,
    paths, actionsTriggered, variables, warnings, missingSetup,
  };
}

// ── Apply ──────────────────────────────────────────────────────────────────────

export type BuildApplyMode = "direct" | "new_draft" | "duplicate_edit" | "propose";

// Blocking conflicts, resolved against the chosen apply mode. Most "block"
// conflicts (workspace mismatch, broken variable references, …) refuse EVERY
// apply. A small set only exists to stop an existing target being overwritten
// in place — touch-nothing modes (new_draft / duplicate_edit) may proceed,
// because they create a fresh INACTIVE row and leave the target untouched.
const OVERWRITE_ONLY_BLOCKS = new Set(["duplicate_trigger"]);
function hardBlockConflicts(impact: BuildImpactReport, mode: BuildApplyMode) {
  const touchNothing = mode === "new_draft" || mode === "duplicate_edit";
  return impact.conflicts.filter(
    (c) => c.severity === "block" && !(touchNothing && OVERWRITE_ONLY_BLOCKS.has(c.code)),
  );
}

// Plain-English hard stop built from blocking conflicts.
function buildConflictError(blocks: BuildImpactReport["conflicts"]): Error {
  const lines = blocks.map((c) => `• ${c.message} What to do: ${c.suggestion}`);
  return new Error(
    `This apply was blocked to protect your existing setup:\n${lines.join("\n")}`,
  );
}

// Direct-apply writer shared by the low/medium-risk path and the post-approval
// activation path. Re-validates everything; workspace-scoped every query.
// Protection rules (do not weaken):
//   • A rollback snapshot is ALWAYS taken before an existing target row (or an
//     existing agent config) is modified — snapshot failure aborts the apply.
//   • mode "new_draft"/"duplicate_edit" force a FRESH inactive workflow row and
//     never overwrite an existing agent config.
async function performBuildApply(args: {
  workspaceId: string;
  userId:      string | null;
  session:     any;
  version:     any;
  config:      BuildConfig;
  approvedBy?: string | null;
  mode?:       BuildApplyMode;
}): Promise<{ workflowId: string; snapshotId: string | null }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, session, version, config } = args;
  const mode = args.mode ?? "direct";
  const forceNewRow = mode === "new_draft" || mode === "duplicate_edit";
  const now = new Date().toISOString();

  // Target workflow row: edit-mode linked row, else the row a previous version
  // of THIS session already applied into, else a fresh row.
  let targetWorkflowId: string | null = forceNewRow ? null : (session.linked_workflow_id ?? null);
  if (!targetWorkflowId && !forceNewRow) {
    const { data: prior } = await sb.from("systemmind_build_versions")
      .select("applied_workflow_id")
      .eq("session_id", session.id).eq("workspace_id", workspaceId)
      .not("applied_workflow_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    targetWorkflowId = prior?.applied_workflow_id ?? null;
  }
  if (targetWorkflowId) {
    const { data: existing } = await sb.from("workspace_workflows")
      .select("id").eq("id", targetWorkflowId).eq("workspace_id", workspaceId).maybeSingle();
    if (!existing) targetWorkflowId = null; // row deleted since — create fresh
  }

  // Rollback snapshot BEFORE anything existing is touched. Snapshot failure
  // throws inside createBuildSnapshotServer and aborts the apply.
  const writesAgentConfig = !!(session.target_agent_id && config.agent_prompt.trim()) && !forceNewRow;
  let snapshotId: string | null = null;
  if (targetWorkflowId || writesAgentConfig) {
    const snap = await createBuildSnapshotServer({
      workspaceId, userId,
      sessionId:        session.id,
      versionId:        version.id,
      versionNumber:    version.version_number,
      targetWorkflowId: targetWorkflowId,
      targetAgentId:    writesAgentConfig ? session.target_agent_id : null,
      reason:           "pre_apply",
    });
    snapshotId = snap?.snapshotId ?? null;
  }

  const workflowFields = {
    name:            (mode === "duplicate_edit" ? `${config.workflow.name} (copy)` : config.workflow.name).slice(0, 200),
    description:     config.workflow.purpose.slice(0, 500) || `Built in SystemMind Build Workspace (v${version.version_number}).`,
    trigger_type:    config.workflow.trigger_type,
    trigger_config:  config.workflow.trigger_config ?? {},
    flow_definition: { steps: config.workflow.steps, custom_prompt: config.agent_prompt ?? "", source: "systemmind_build" },
    source:          "systemmind_build",
    source_build_session_id: session.id,
    source_build_version:    version.version_number,
  };

  let workflowId: string;
  if (targetWorkflowId) {
    const { error } = await sb.from("workspace_workflows")
      .update({ ...workflowFields, updated_at: now })
      .eq("id", targetWorkflowId).eq("workspace_id", workspaceId);
    if (error) throw new Error(`Failed to update workflow: ${error.message}`);
    workflowId = targetWorkflowId;
  } else {
    // Never auto-activate: new workflows land inactive; the user (or Go Live)
    // turns them on deliberately.
    const { data: wf, error } = await sb.from("workspace_workflows").insert({
      workspace_id: workspaceId,
      template_id:  null,
      ...workflowFields,
      status: "inactive",
    }).select("id").single();
    if (error) throw new Error(`Failed to create workflow: ${error.message}`);
    workflowId = wf.id as string;
  }

  // Agent-config apply: custom_agent_configs, NEVER agents.settings.
  // In new_draft/duplicate_edit mode an EXISTING agent config is never
  // overwritten — the whole point of those modes is "touch nothing existing".
  if (session.target_agent_id && config.agent_prompt.trim()) {
    const { data: cfgRow } = await sb.from("custom_agent_configs")
      .select("id")
      .eq("workspace_id", workspaceId).eq("agent_id", session.target_agent_id)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (forceNewRow && cfgRow?.id) {
      await insertMessage({
        sessionId: session.id, workspaceId, userId, role: "system", versionId: version.id,
        content: `Saved as a new draft — the existing configuration for your agent was left untouched. Apply this version directly when you're ready to update the agent.`,
      });
    } else {
    // Guided Requirements Assistant payload: persisted alongside the config so
    // the deployment pipeline (Go Live checklist, orchestrator) can read it.
    // Only APPROVED script additions ever reach agent_prompt (the approval step
    // merges them into a NEW version before apply); proposed/rejected drafts
    // ride along as inert data.
    const req = config.requirements ?? null;
    const cfgFields = {
      title:              `Build Workspace v${version.version_number}: ${config.workflow.name}`.slice(0, 200),
      agent_summary:      (version.assistant_summary ?? "").slice(0, 4000) || null,
      required_variables: config.variables,
      extraction_fields:  config.extraction_fields,
      ...(req ? {
        crm_field_mapping: req.variable_mappings,
        outcome_schema:    { outcome_rules: req.outcome_rules, summary_field: req.summary_field, negative_reason_field: req.negative_reason_field },
      } : {}),
      deployment_config: {
        agent_prompt:     config.agent_prompt,
        follow_up_rules:  config.follow_up_rules,
        channel_setup:    config.channel_setup,
        ...(req ? { requirements: req } : {}),
        source:           "systemmind_build",
        build_session_id: session.id,
        build_version:    version.version_number,
      },
      status:     "ready",
      updated_at: now,
    };
    if (cfgRow?.id) {
      const { error } = await sb.from("custom_agent_configs").update(cfgFields)
        .eq("id", cfgRow.id).eq("workspace_id", workspaceId);
      if (error) throw new Error(`Workflow applied, but the agent config update failed: ${error.message}`);
    } else {
      const { error } = await sb.from("custom_agent_configs").insert({
        workspace_id: workspaceId,
        agent_id:     session.target_agent_id,
        ...cfgFields,
      });
      if (error) throw new Error(`Workflow applied, but the agent config insert failed: ${error.message}`);
    }
    }
  }

  // Requirements: scheduled-calling campaign is created PAUSED, and only if a
  // campaign with the same name doesn't already exist. Nothing is activated:
  // no lead_auto_call switches are ever flipped here, campaigns never start
  // running on their own (spec §14 — activation is always a separate human act).
  const reqCalling = config.requirements?.calling ?? null;
  const reqCampaign = config.requirements?.campaign ?? null;
  if (reqCampaign && reqCalling && (reqCalling.mode === "scheduled" || reqCalling.mode === "both")) {
    const { data: existingCampaign } = await sb.from("campaigns")
      .select("id").eq("workspace_id", workspaceId).eq("name", reqCampaign.name.slice(0, 200))
      .limit(1).maybeSingle();
    if (!existingCampaign) {
      const { error: cErr } = await sb.from("campaigns").insert({
        workspace_id: workspaceId,
        agent_id:     session.target_agent_id ?? null,
        name:         reqCampaign.name.slice(0, 200),
        description:  reqCampaign.schedule_description.slice(0, 500) || "Created paused by SystemMind Requirements Assistant.",
        status:       "paused",
        targets:      [],
        retry_config: {
          max_attempts_per_lead: reqCalling.max_attempts_per_lead,
          retry_spacing_hours:   reqCalling.retry_spacing_hours,
        },
        schedule_config: {
          calling_window:    reqCalling.calling_window,
          max_calls_per_day: reqCalling.max_calls_per_day,
          source:            "requirements_assistant",
        },
      });
      if (cErr) {
        await insertMessage({
          sessionId: session.id, workspaceId, userId, role: "system", versionId: version.id,
          content: `Applied, but the paused campaign "${reqCampaign.name}" could not be created: ${cErr.message}. You can create it manually from the Campaigns page.`,
        });
      } else {
        await insertMessage({
          sessionId: session.id, workspaceId, userId, role: "system", versionId: version.id,
          content: `Campaign "${reqCampaign.name}" was created PAUSED. It will not call anyone until you start it from the Campaigns page.`,
        });
      }
    }
  }

  const { error: vErr } = await sb.from("systemmind_build_versions").update({
    status:              "applied",
    applied_workflow_id: workflowId,
    applied_at:          now,
  }).eq("id", version.id).eq("session_id", session.id).eq("workspace_id", workspaceId);
  if (vErr) throw new Error(`Applied, but version bookkeeping failed: ${vErr.message}`);

  await insertMessage({
    sessionId: session.id, workspaceId, userId, role: "system", versionId: version.id,
    content: mode === "direct"
      ? `Version ${version.version_number} applied to workflow "${config.workflow.name}".${snapshotId ? " A rollback snapshot of the previous state was saved first." : ""}`
      : `Version ${version.version_number} saved as a new inactive draft workflow "${config.workflow.name}${mode === "duplicate_edit" ? " (copy)" : ""}" — nothing existing was changed.`,
  });

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_version_applied",
    targetType: "systemmind_build_version",
    targetId:   version.id,
    beforeState: { status: version.status, snapshot_id: snapshotId },
    finalAfterState: {
      status: "applied", workflow_id: workflowId, version_number: version.version_number,
      apply_mode: mode, snapshot_id: snapshotId,
    },
    approvalStatus: args.approvedBy ? "approved" : "not_required",
    approvedBy: args.approvedBy ?? null,
    executedAt: now,
  });

  return { workflowId, snapshotId };
}

export type ApplyBuildResult = {
  requiresApproval:  boolean;
  workflowId:        string | null;
  hubActionId:       string | null;
  hivemindActionId:  string | null;
  riskLevel:         "low" | "medium" | "high";
  riskReasons:       string[];
  mode:              BuildApplyMode;
  snapshotId:        string | null;
  impact:            BuildImpactReport | null;
};

// ── Safety report (read-only pre-flight for the UI safety panel) ───────────────
export async function getBuildApplySafetyReportServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; versionId: string;
}): Promise<{ riskLevel: "low" | "medium" | "high"; riskReasons: string[]; impact: BuildImpactReport }> {
  const { workspaceId, userId, sessionId, versionId } = args;
  const session = await getSessionOrThrow(workspaceId, sessionId);
  const version = await getVersionOrThrow(workspaceId, sessionId, versionId);
  const config = validateConfigOrThrow(version.generated_config, "Safety check build config");
  const { riskLevel, riskReasons } = classifyConfigRisk(config);
  const impact = await computeBuildImpactReport({ workspaceId, session, version, config, riskLevel, riskReasons });

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_apply_safety_checked",
    targetType: "systemmind_build_version",
    targetId:   versionId,
    finalAfterState: {
      risk_level:        riskLevel,
      target_is_new:     impact.targetIsNew,
      target_is_live:    impact.targetIsLive,
      diff_count:        impact.diff.length,
      conflicts:         impact.conflicts.map((c) => c.code),
      requires_approval: impact.requiresApproval,
    },
  });

  return { riskLevel, riskReasons, impact };
}

// Default mode when the caller doesn't choose one. Safe-by-default: ONLY a
// completely fresh target (no existing workflow row, no existing agent config
// that would be overwritten, no live agent) applies directly. ANY existing
// target defaults to "new_draft" — overwriting in place requires the user to
// explicitly pick "direct" in the safety panel.
function resolveDefaultApplyMode(_session: any, impact: BuildImpactReport): BuildApplyMode {
  if (impact.targetIsNew && !impact.agentHasConfig && !impact.agentIsLive) return "direct";
  return "new_draft";
}

export async function applyBuildVersionServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; versionId: string;
  mode?: BuildApplyMode; goLiveIntent?: boolean;
}): Promise<ApplyBuildResult> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, sessionId, versionId } = args;
  const startedAt = new Date();
  const session = await getSessionOrThrow(workspaceId, sessionId);
  const version = await getVersionOrThrow(workspaceId, sessionId, versionId);
  if (!["draft", "testing", "revised"].includes(String(version.status))) {
    throw new Error(`Version ${version.version_number} cannot be applied from status "${version.status}".`);
  }

  // Never trust what sat in the DB: full re-validation + credential guard.
  const config = validateConfigOrThrow(version.generated_config, "Apply build config");
  const { riskLevel, riskReasons } = classifyConfigRisk(config);

  // Impact analysis + hard protection rules — ALWAYS run, every apply.
  const impact = await computeBuildImpactReport({ workspaceId, session, version, config, riskLevel, riskReasons });
  const mode: BuildApplyMode = args.mode ?? resolveDefaultApplyMode(session, impact);
  const hardBlocks = hardBlockConflicts(impact, mode);
  if (hardBlocks.length > 0) {
    throw buildConflictError(hardBlocks);
  }
  if (args.goLiveIntent) {
    // MANDATORY test-call gate — SystemMind-built agents only (standard agents
    // deploy through the normal manual flow, which is untouched).
    const { getTestGateForSessionServer } = await import("@/lib/systemmind/build-workspace-testcall.server");
    const gate = await getTestGateForSessionServer({ workspaceId, sessionId, versionId });
    if (gate.status !== "passed") {
      throw new Error(
        gate.status === "failed"
          ? "Go Live is blocked: the last test call for this version FAILED. Fix the issues (or ask SystemMind to fix them from the Test tab) and re-test, or mark the test as passed with a reason."
          : "Go Live is blocked: this version hasn't passed a test call yet. Run a real test call from the Test tab and let SystemMind validate it (or mark it passed with a reason) before going live.",
      );
    }
  }
  if (args.goLiveIntent && !impact.canGoLive) {
    const gates = impact.conflicts.filter((c) => c.severity === "block_go_live" || c.severity === "needs_approval");
    throw new Error(
      `Apply & Go Live was blocked:\n${gates.map((c) => `• ${c.message} What to do: ${c.suggestion}`).join("\n")}` +
      (impact.requiresApproval ? "\n• This change needs approval before it can go live." : ""),
    );
  }

  // Approval gate. "Touches existing" covers BOTH the workflow row and the
  // agent's configuration — a direct apply that would overwrite an existing
  // agent config (or write config for a LIVE agent) is never auto-applied
  // when an approval-gated conflict (live target, live agent, webhook change,
  // …) is present.
  const writesAgentConfig = !!(session.target_agent_id && config.agent_prompt.trim());
  const overwritesExisting =
    mode === "direct" &&
    (!impact.targetIsNew || (writesAgentConfig && (impact.agentHasConfig || impact.agentIsLive)));
  const needsApprovalGate =
    riskLevel === "high" ||
    mode === "propose" ||
    (overwritesExisting && impact.conflicts.some((c) => c.severity === "needs_approval"));

  if (needsApprovalGate) {
    // Route through the SystemMind hub + HiveMind approval — never auto-apply.
    const { data: hubRow, error: hubErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id:         workspaceId,
      run_id:               null,
      created_by_user_id:   userId,
      source:               "systemmind",
      instructed_by:        "user",
      action_kind:          "build_workspace_apply",
      title:                `Apply build v${version.version_number}: ${config.workflow.name}`.slice(0, 200),
      purpose:              config.workflow.purpose.slice(0, 2000) || "Apply a Build Workspace version to the live workspace.",
      payload: {
        session_id:     sessionId,
        version_id:     versionId,
        version_number: version.version_number,
        apply_mode:     mode === "propose" ? "direct" : mode,
        impact_summary: {
          target_is_new:  impact.targetIsNew,
          target_is_live: impact.targetIsLive,
          target_workflow_name: impact.targetWorkflowName,
          diff_count:     impact.diff.length,
          conflicts:      impact.conflicts.map((c) => ({ code: c.code, severity: c.severity, message: c.message })),
        },
      },
      required_credentials: config.required_credentials,
      test_plan:            config.test_plan,
      risk_level:           riskLevel,
      risk_reasons:         riskReasons,
      approval_required:    true,
      status:               "draft",
      model_provider:       version.model_provider,
      model_id:             version.model_id,
    }).select("id").single();
    if (hubErr) throw new Error(`Failed to create approval draft: ${hubErr.message}`);
    const hubActionId = hubRow.id as string;

    let hivemindActionId: string;
    try {
      const submitted = await submitDraftForApprovalServer(workspaceId, userId, hubActionId);
      hivemindActionId = submitted.hivemindActionId;
    } catch (err) {
      // Keep the hub clean: if approval submission fails, remove the orphan row.
      await sb.from("systemmind_generated_actions").delete()
        .eq("id", hubActionId).eq("workspace_id", workspaceId);
      throw err;
    }

    const { error: vErr } = await sb.from("systemmind_build_versions").update({
      status:        "pending_approval",
      hub_action_id: hubActionId,
    }).eq("id", versionId).eq("session_id", sessionId).eq("workspace_id", workspaceId);
    if (vErr) throw new Error(vErr.message);

    const approvalWhy = riskLevel === "high"
      ? `is HIGH RISK (${riskReasons.join("; ")})`
      : mode === "propose"
        ? "was submitted as a proposed change"
        : `would overwrite an existing setup with conflicts (${impact.conflicts.filter((c) => c.severity === "needs_approval").map((c) => c.code).join(", ")})`;
    await insertMessage({
      sessionId, workspaceId, userId, role: "system", versionId,
      content: `Version ${version.version_number} ${approvalWhy}. It has been sent to the HiveMind action centre for approval — nothing goes live until it's approved there.`,
    });

    const completedAt = new Date();
    await recordSystemMindUsageEvent({
      workspaceId, userId, sessionId, versionId,
      taskType: "build_apply_submit", sourcePage: session.source_page,
      startedAt, completedAt, success: true,
    });

    return { requiresApproval: true, workflowId: null, hubActionId, hivemindActionId, riskLevel, riskReasons, mode, snapshotId: null, impact };
  }

  const { workflowId, snapshotId } = await performBuildApply({ workspaceId, userId, session, version, config, mode });

  const completedAt = new Date();
  await recordSystemMindUsageEvent({
    workspaceId, userId, sessionId, versionId, workflowId,
    taskType: "build_apply", sourcePage: session.source_page,
    startedAt, completedAt, success: true,
  });

  return { requiresApproval: false, workflowId, hubActionId: null, hivemindActionId: null, riskLevel, riskReasons, mode, snapshotId, impact };
}

// ── Post-approval activation (called ONLY from the hub dispatcher) ─────────────
export async function activateBuildWorkspaceApplyKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: hubRow, error } = await sb.from("systemmind_generated_actions")
    .select("*")
    .eq("id", generatedActionId).eq("workspace_id", workspaceId).eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!hubRow) throw new Error("Approval draft not found in this workspace.");

  const sessionId = String(hubRow.payload?.session_id ?? "");
  const versionId = String(hubRow.payload?.version_id ?? "");
  if (!sessionId || !versionId) throw new Error("Approval draft payload is missing the build session/version reference.");

  const session = await getSessionOrThrow(workspaceId, sessionId);
  const version = await getVersionOrThrow(workspaceId, sessionId, versionId);
  if (version.status !== "pending_approval") {
    throw new Error(`Build version is no longer pending approval (status: ${version.status}).`);
  }
  const config = validateConfigOrThrow(version.generated_config, "Approved build config");

  // TOCTOU re-checks: the workspace may have changed between submission and
  // approval. Re-run the full impact analysis and refuse on any hard block.
  const { riskLevel, riskReasons } = classifyConfigRisk(config);
  const impact = await computeBuildImpactReport({ workspaceId, session, version, config, riskLevel, riskReasons });

  const approvedMode = String(hubRow.payload?.apply_mode ?? "direct") as BuildApplyMode;
  const mode: BuildApplyMode =
    approvedMode === "new_draft" || approvedMode === "duplicate_edit" ? approvedMode : "direct";

  const hardBlocks = hardBlockConflicts(impact, mode);
  if (hardBlocks.length > 0) {
    throw buildConflictError(hardBlocks);
  }

  const { workflowId, snapshotId } = await performBuildApply({
    workspaceId, userId: null, session, version, config, mode,
    approvedBy: hubRow.approved_by ?? "hivemind",
  });

  await recordSystemMindUsageEvent({
    workspaceId, sessionId, versionId, workflowId,
    taskType: "build_apply", sourcePage: session.source_page,
    startedAt: new Date(), completedAt: new Date(), success: true,
  });

  return {
    activatedTargetType: "workspace_workflow",
    activatedTargetId:   workflowId,
    summary: {
      build_session_id: sessionId, build_version: version.version_number,
      workflow_id: workflowId, apply_mode: mode, snapshot_id: snapshotId,
    },
  };
}

// ── Rollback (restore a pre-apply snapshot) ────────────────────────────────────
export async function rollbackBuildApplyServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; snapshotId: string;
}): Promise<{ restoredWorkflowId: string | null; restoredAgentConfigId: string | null }> {
  const { workspaceId, userId, sessionId, snapshotId } = args;
  await getSessionOrThrow(workspaceId, sessionId); // membership/scoping guard
  const result = await rollbackBuildSnapshotServer({ workspaceId, userId, snapshotId });
  await insertMessage({
    sessionId, workspaceId, userId, role: "system",
    content: `Rolled back to the snapshot taken before the last apply — the previous workflow${result.restoredAgentConfigId ? " and agent configuration were" : " was"} restored.`,
  });
  return result;
}

// ── Mark deployed (after a successful Go Live, orchestrated client-side) ───────
export async function markBuildVersionDeployedServer(args: {
  workspaceId: string; userId: string | null; sessionId: string; versionId: string;
  deployTarget?: string;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, sessionId, versionId } = args;
  await getSessionOrThrow(workspaceId, sessionId);
  const version = await getVersionOrThrow(workspaceId, sessionId, versionId);
  if (version.status !== "applied") {
    throw new Error(`Only an applied version can be marked deployed (status: ${version.status}).`);
  }
  // MANDATORY test-call gate for SystemMind builds — a version can only be
  // marked deployed (live) after its test call passed (or a reasoned override).
  {
    const { getTestGateForSessionServer } = await import("@/lib/systemmind/build-workspace-testcall.server");
    const gate = await getTestGateForSessionServer({ workspaceId, sessionId, versionId });
    if (gate.status !== "passed") {
      throw new Error(
        gate.status === "failed"
          ? "This version cannot go live: its last test call FAILED. Re-test from the Test tab (or mark it passed with a reason) first."
          : "This version cannot go live: it hasn't passed a test call yet. Run and validate a test call from the Test tab first.",
      );
    }
  }
  const now = new Date().toISOString();
  const { error } = await sb.from("systemmind_build_versions")
    .update({ status: "deployed", deployed_at: now })
    .eq("id", versionId).eq("session_id", sessionId).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  await insertMessage({
    sessionId, workspaceId, userId, role: "system", versionId,
    content: `Version ${version.version_number} deployed${args.deployTarget ? ` (${args.deployTarget.slice(0, 120)})` : ""}.`,
  });

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "build_version_deployed",
    targetType: "systemmind_build_version",
    targetId:   versionId,
    beforeState: { status: "applied" },
    finalAfterState: { status: "deployed", deploy_target: args.deployTarget ?? null },
    executedAt: now,
  });
}

// ── Usage summaries ─────────────────────────────────────────────────────────────
// Member-safe view: NEVER includes estimated_provider_cost_usd unless the
// current pricing row explicitly exposes it.
export async function getSystemMindUsageSummaryServer(
  workspaceId: string,
  sinceIso: string,
): Promise<Record<string, any>> {
  const sb = supabaseAdmin as any;
  const [pricing, { data, error }] = await Promise.all([
    getCurrentSystemMindPricingServer(),
    sb.from("systemmind_usage_events")
      .select("task_type, total_tokens, elapsed_ms, customer_charge_usd, estimated_provider_cost_usd, success, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  let totalTokens = 0, totalElapsedMs = 0, totalChargeUsd = 0, totalProviderCostUsd = 0, failures = 0;
  const byTask: Record<string, { runs: number; tokens: number; elapsedMs: number; chargeUsd: number }> = {};
  for (const r of rows) {
    totalTokens          += r.total_tokens ?? 0;
    totalElapsedMs       += r.elapsed_ms ?? 0;
    totalChargeUsd       += Number(r.customer_charge_usd ?? 0);
    totalProviderCostUsd += Number(r.estimated_provider_cost_usd ?? 0);
    if (!r.success) failures++;
    const t = String(r.task_type ?? "other");
    byTask[t] = byTask[t] ?? { runs: 0, tokens: 0, elapsedMs: 0, chargeUsd: 0 };
    byTask[t].runs++;
    byTask[t].tokens    += r.total_tokens ?? 0;
    byTask[t].elapsedMs += r.elapsed_ms ?? 0;
    byTask[t].chargeUsd += Number(r.customer_charge_usd ?? 0);
  }
  const summary: Record<string, any> = {
    totalRuns:       rows.length,
    failures,
    totalTokens,
    totalElapsedMs,
    totalChargeUsd:  Math.round(totalChargeUsd * 1e6) / 1e6,
    byTask,
    included: pricing ? {
      runsPerMonth:    pricing.included_runs_per_month,
      secondsPerMonth: pricing.included_seconds_per_month,
      tokensPerMonth:  pricing.included_tokens_per_month,
    } : null,
  };
  if (pricing?.expose_provider_cost) {
    summary.totalProviderCostUsd = Math.round(totalProviderCostUsd * 1e6) / 1e6;
  }
  return summary;
}

// Admin/AccountsMind view: full detail including raw provider cost, monthly
// allowance + overage applied here (aggregation time, per architect direction).
export async function getSystemMindUsageAdminServer(
  workspaceId: string,
  monthStartIso: string,
): Promise<Record<string, any>> {
  const sb = supabaseAdmin as any;
  const [pricing, { data, error }] = await Promise.all([
    getCurrentSystemMindPricingServer(),
    sb.from("systemmind_usage_events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .gte("created_at", monthStartIso)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  let totalTokens = 0, totalElapsedMs = 0, rawChargeUsd = 0, providerCostUsd = 0;
  for (const r of rows) {
    totalTokens     += r.total_tokens ?? 0;
    totalElapsedMs  += r.elapsed_ms ?? 0;
    rawChargeUsd    += Number(r.customer_charge_usd ?? 0);
    providerCostUsd += Number(r.estimated_provider_cost_usd ?? 0);
  }
  // Monthly allowance: runs/seconds/tokens each covered proportionally — the
  // simple, explainable model: if ALL three usage measures are within their
  // included allowance, the month is free; otherwise the raw charge applies
  // with the overage multiplier on the excess fraction.
  let billableChargeUsd = rawChargeUsd;
  let withinAllowance = false;
  if (pricing) {
    const runsOk    = pricing.included_runs_per_month    <= 0 || rows.length        <= pricing.included_runs_per_month;
    const secondsOk = pricing.included_seconds_per_month <= 0 || totalElapsedMs / 1000 <= pricing.included_seconds_per_month;
    const tokensOk  = pricing.included_tokens_per_month  <= 0 || totalTokens       <= pricing.included_tokens_per_month;
    const hasAnyAllowance = pricing.included_runs_per_month > 0 || pricing.included_seconds_per_month > 0 || pricing.included_tokens_per_month > 0;
    withinAllowance = hasAnyAllowance && runsOk && secondsOk && tokensOk;
    if (withinAllowance) {
      billableChargeUsd = 0;
    } else if (hasAnyAllowance) {
      billableChargeUsd = rawChargeUsd * pricing.overage_multiplier;
    }
  }
  return {
    events:            rows,
    totalRuns:         rows.length,
    totalTokens,
    totalElapsedMs,
    providerCostUsd:   Math.round(providerCostUsd * 1e6) / 1e6,
    rawChargeUsd:      Math.round(rawChargeUsd * 1e6) / 1e6,
    withinAllowance,
    billableChargeUsd: Math.round(billableChargeUsd * 1e6) / 1e6,
    marginUsd:         Math.round((billableChargeUsd - providerCostUsd) * 1e6) / 1e6,
    pricing,
  };
}

// ── Admin pricing editor (cost_engine_systemmind, is_current row-versioning) ───
export async function listSystemMindPricingHistoryServer(): Promise<any[]> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("cost_engine_systemmind")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function saveSystemMindPricingServer(args: {
  userId: string | null;
  pricing: {
    base_charge_per_run_usd:    number;
    charge_per_minute_usd:      number;
    charge_per_1k_tokens_usd:   number;
    charge_per_tool_call_usd:   number;
    included_runs_per_month:    number;
    included_seconds_per_month: number;
    included_tokens_per_month:  number;
    overage_multiplier:         number;
    expose_provider_cost:       boolean;
    notes?:                     string;
  };
}): Promise<{ id: string }> {
  const sb = supabaseAdmin as any;
  const p = args.pricing;

  // Row-versioning: insert the new current row FIRST, then retire the old ones.
  // If the insert fails nothing changes; a brief two-current overlap is resolved
  // by the reader's ORDER BY created_at DESC LIMIT 1.
  const { data: row, error: insErr } = await sb.from("cost_engine_systemmind").insert({
    base_charge_per_run_usd:    p.base_charge_per_run_usd,
    charge_per_minute_usd:      p.charge_per_minute_usd,
    charge_per_1k_tokens_usd:   p.charge_per_1k_tokens_usd,
    charge_per_tool_call_usd:   p.charge_per_tool_call_usd,
    included_runs_per_month:    Math.round(p.included_runs_per_month),
    included_seconds_per_month: Math.round(p.included_seconds_per_month),
    included_tokens_per_month:  Math.round(p.included_tokens_per_month),
    overage_multiplier:         p.overage_multiplier,
    expose_provider_cost:       p.expose_provider_cost,
    notes:                      (p.notes ?? "").slice(0, 2000) || null,
    is_current:                 true,
  }).select("id").single();
  if (insErr) throw new Error(`Failed to save pricing: ${insErr.message}`);
  const newId = row.id as string;

  const { error: retireErr } = await sb.from("cost_engine_systemmind")
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .neq("id", newId).eq("is_current", true);
  if (retireErr) throw new Error(`Pricing saved but retiring old rows failed: ${retireErr.message}`);

  // No systemmind_audit_logs row here: that table is workspace-scoped (NOT NULL
  // workspace_id) and this is platform-level config. The cost_engine_systemmind
  // table itself is the immutable history (row-versioning + notes + created_at).
  return { id: newId };
}
