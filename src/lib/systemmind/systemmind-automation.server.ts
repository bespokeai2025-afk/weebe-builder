// ── SystemMind Automation Layer — server-only core ─────────────────────────────
// Claude-powered generation of WORKSPACE-SCOPED automation DRAFTS. SystemMind
// NEVER executes anything itself: every draft goes through the approval-first
// lifecycle draft → pending_approval → approved → active (→ paused) with
// rejected/failed as terminal branches. Activation happens ONLY through the
// HiveMind approval pipeline, and the payload is re-validated server-side at
// activation time against the workflow-executor step whitelist.
//
// Safety invariants (do not weaken):
//   • workspace_id comes ONLY from server context — never from client input or
//     model output.
//   • No credentials/secrets are ever placed in prompts or drafts.
//   • High-risk drafts always require approval and can never auto-activate.
//   • Every generation and lifecycle transition writes a systemmind_audit_logs row.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";

// ── Step whitelist (MUST mirror workflow-executor.server.ts switch) ────────────
export const ALLOWED_STEP_TYPES = [
  "trigger",
  "update_lead_status",
  "push_to_crm",
  "create_callback",
  "create_task",
  "send_whatsapp",
  "send_email",
  "notify_user",
  "assign_agent",
  "call_lead",
  "branch",
  "stop_workflow",
] as const;

const ALLOWED_TRIGGER_TYPES = ["lead_added", "lead_status_changed", "call_completed", "manual", "scheduled"] as const;

const ALLOWED_OPS = ["equals", "not_equals", "greater_than", "less_than", "contains"] as const;

// ── Generated draft schema (strict validation of model output) ────────────────
const ConditionSchema = z.object({
  field: z.string().min(1).max(100),
  op:    z.enum(ALLOWED_OPS),
  value: z.union([z.string(), z.number(), z.boolean()]),
  next:  z.string().min(1).max(100),
});

export const StepSchema = z.object({
  id:            z.string().min(1).max(100),
  type:          z.enum(ALLOWED_STEP_TYPES),
  next:          z.string().max(100).optional(),
  conditions:    z.array(ConditionSchema).max(10).optional(),
  status:        z.string().max(60).optional(),
  title:         z.string().max(300).optional(),
  delay_hours:   z.number().min(0).max(720).optional(),
  delay_minutes: z.number().min(0).max(59).optional(),
  template:      z.string().max(120).optional(),
  agent_assignment: z.string().max(120).optional(),
});

const GeneratedDraftSchema = z.object({
  name:                 z.string().min(1).max(200),
  purpose:              z.string().min(1).max(2000),
  trigger_type:         z.string().max(60),
  trigger_config:       z.record(z.unknown()).default({}),
  steps:                z.array(StepSchema).min(1).max(30),
  custom_prompt:        z.string().max(8000).default(""),
  required_credentials: z.array(z.string().max(120)).max(20).default([]),
  risks:                z.array(z.string().max(300)).max(20).default([]),
  test_plan:            z.array(z.string().max(400)).max(20).default([]),
});

export type GeneratedDraft = z.infer<typeof GeneratedDraftSchema>;

export type SystemMindDraftStatus =
  | "draft" | "pending_approval" | "approved" | "active" | "paused" | "rejected" | "failed";

// ── Audit log helper ───────────────────────────────────────────────────────────
export async function writeSystemMindAudit(entry: {
  workspaceId:        string;
  userId?:            string | null;
  instructedBy?:      string;
  actionType:         string;
  targetType?:        string;
  targetId?:          string;
  beforeState?:       Record<string, unknown> | null;
  proposedAfterState?: Record<string, unknown> | null;
  finalAfterState?:   Record<string, unknown> | null;
  approvalStatus?:    string | null;
  approvedBy?:        string | null;
  executedAt?:        string | null;
  error?:             string | null;
}): Promise<void> {
  const sb = supabaseAdmin as any;
  const { error } = await sb.from("systemmind_audit_logs").insert({
    workspace_id:         entry.workspaceId,
    user_id:              entry.userId ?? null,
    source_agent:         "systemmind",
    instructed_by:        entry.instructedBy ?? "user",
    action_type:          entry.actionType,
    target_type:          entry.targetType ?? null,
    target_id:            entry.targetId ?? null,
    before_state:         entry.beforeState ?? null,
    proposed_after_state: entry.proposedAfterState ?? null,
    final_after_state:    entry.finalAfterState ?? null,
    approval_status:      entry.approvalStatus ?? null,
    approved_by:          entry.approvedBy ?? null,
    approved_at:          entry.approvedBy ? new Date().toISOString() : null,
    executed_at:          entry.executedAt ?? null,
    error:                entry.error ?? null,
  });
  if (error) console.error("[systemmind-automation] audit log write failed:", error.message);
}

// ── Deterministic high-risk classifier ─────────────────────────────────────────
const CREDENTIAL_KEYWORDS = [
  "api key", "api_key", "apikey", "credential", "secret", "token", "password",
  "webhook url", "webhook_url", "billing", "payment", "usage limit",
];

export function classifyDraftRisk(draft: GeneratedDraft): {
  riskLevel: "low" | "medium" | "high";
  riskReasons: string[];
} {
  const reasons: string[] = [];
  const stepTypes = new Set(draft.steps.map((s) => s.type));

  // External customer messaging → high
  if (stepTypes.has("send_whatsapp")) reasons.push("Sends WhatsApp messages to customers");
  if (stepTypes.has("send_email"))    reasons.push("Sends emails to customers");

  // Outbound calling → high
  if (stepTypes.has("call_lead"))     reasons.push("Queues outbound AI calls to leads");

  // Credential / webhook / billing mentions anywhere in the draft → high
  const textBlob = [
    draft.name, draft.purpose, draft.custom_prompt,
    ...draft.required_credentials, ...draft.risks,
    JSON.stringify(draft.trigger_config ?? {}),
  ].join(" ").toLowerCase();
  const credentialHit = CREDENTIAL_KEYWORDS.find((k) => textBlob.includes(k));
  if (credentialHit) reasons.push(`Touches sensitive configuration ("${credentialHit}")`);

  // Bulk operations → high. A scheduled trigger combined with outbound
  // messaging/calling fans out to every matching lead on every tick, and
  // "all leads"-style wording signals whole-base targeting.
  if (
    draft.trigger_type === "scheduled" &&
    (stepTypes.has("send_whatsapp") || stepTypes.has("send_email") || stepTypes.has("call_lead"))
  ) {
    reasons.push("Bulk: scheduled trigger combined with customer messaging/calling");
  }
  if (/\ball leads\b|\bevery lead\b|\bevery contact\b|\ball contacts\b/.test(textBlob)) {
    reasons.push("Bulk: targets all leads/contacts");
  }

  // Bulk data mutation → medium
  const mediumReasons: string[] = [];
  if (stepTypes.has("update_lead_status")) mediumReasons.push("Changes lead statuses automatically");
  if (stepTypes.has("push_to_crm"))        mediumReasons.push("Writes lead data to the CRM");

  if (reasons.length > 0) return { riskLevel: "high", riskReasons: [...reasons, ...mediumReasons] };
  if (mediumReasons.length > 0) return { riskLevel: "medium", riskReasons: mediumReasons };
  return { riskLevel: "low", riskReasons: [] };
}

// ── Claude availability ─────────────────────────────────────────────────────────
export function isClaudeEnabled(): boolean {
  return process.env.SYSTEMMIND_CLAUDE_ENABLED === "true" && !!process.env.ANTHROPIC_API_KEY;
}

// ── Step sanitiser (defence-in-depth after zod parse) ──────────────────────────
function sanitizeSteps(steps: GeneratedDraft["steps"]): GeneratedDraft["steps"] {
  const ids = new Set<string>();
  const cleaned = steps.filter((s) => {
    if (ids.has(s.id)) return false;
    ids.add(s.id);
    return (ALLOWED_STEP_TYPES as readonly string[]).includes(s.type);
  });
  // Drop next/condition targets that point at non-existent steps
  for (const s of cleaned) {
    if (s.next && !ids.has(s.next)) delete s.next;
    if (s.conditions) s.conditions = s.conditions.filter((c) => ids.has(c.next));
  }
  return cleaned;
}

// Exported for the generators module (n8n conversion re-uses the exact same
// validation + sanitisation pipeline).
export const sanitizeGeneratedSteps = sanitizeSteps;

// ── Generation ─────────────────────────────────────────────────────────────────
const GENERATION_SYSTEM_PROMPT = `You are SystemMind, the AI CTO of the WEBEE platform. You design WORKSPACE-SCOPED automation workflow drafts. You NEVER execute anything — you only produce a draft for human approval.

The WEBEE workflow engine supports ONLY these step types (use no others):
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

STEP GRAPH RULES:
- First step MUST be type "trigger" with id "step-1".
- Every non-terminal step needs "next" (the id of the following step) OR conditions (branch only).
- Ids: "step-1", "step-2", ... unique strings.
- Keep it 3–12 steps. Simple and reliable beats clever.

SAFETY RULES (mandatory):
- NEVER include API keys, tokens, passwords, or any credential values anywhere.
- If the automation needs credentials (e.g. WhatsApp provider), name them in required_credentials as placeholders like "WATI access token" — never values.
- List every real risk in "risks" (e.g. "messages customers automatically").
- test_plan: 3–6 concrete manual test steps a human can follow before activation.

Return ONLY valid JSON:
{
  "name": "...",
  "purpose": "...",
  "trigger_type": "lead_added",
  "trigger_config": {},
  "steps": [ { "id": "step-1", "type": "trigger", "next": "step-2" }, ... ],
  "custom_prompt": "<the operating prompt/instructions for any AI agent step in this workflow, or '' if none>",
  "required_credentials": ["..."],
  "risks": ["..."],
  "test_plan": ["..."]
}`;

export interface GenerateAutomationArgs {
  workspaceId:  string;
  userId:       string | null;
  description:  string;
  instructedBy?: "user" | "hivemind" | "admin";
}

export type GenerateAutomationResult = {
  runId:       string;
  draftId:     string;
  // Record<string, any> (not unknown): TanStack Start's serializable-return
  // check rejects `unknown` index signatures on server fn return types.
  draft:       Record<string, any>;
  modelUsed:   string;
  provider:    string;
  usedFallback: boolean;
  claudeEnabled: boolean;
  riskLevel:   "low" | "medium" | "high";
};

export async function generateAutomationDraftServer(
  args: GenerateAutomationArgs,
): Promise<GenerateAutomationResult> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, description } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to generate.");

  // 1. Run record
  const { data: run, error: runErr } = await sb.from("systemmind_runs").insert({
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    instructed_by:      instructedBy,
    run_type:           "workflow_generation",
    input_description:  description.slice(0, 4000),
    status:             "running",
  }).select("id").single();
  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  const runId = run.id as string;

  const claudeEnabled = isClaudeEnabled();

  try {
    // 2. Generate via the shared model router (Claude preferred, GPT-4.1 fallback)
    const routed = await routeGenerate({
      system:      GENERATION_SYSTEM_PROMPT,
      user:        `Design a workspace automation for this request:\n\n"${description.slice(0, 3000)}"\n\nRemember: draft only, strict JSON, whitelisted step types only.`,
      contentType: "systemmind_automation",
      maxTokens:   4000,
      mode:        "manual",
      provider:    claudeEnabled ? "claude" : "openai",
      model:       claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
      settings:    {},
      workspaceId,
      sb,
    });

    // 3. Strict parse + sanitise
    let rawJson: unknown;
    try {
      const cleaned = routed.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      rawJson = JSON.parse(cleaned);
    } catch {
      throw new Error("Model returned invalid JSON — try again or rephrase the request.");
    }
    const parsed = GeneratedDraftSchema.parse(rawJson);
    parsed.steps = sanitizeSteps(parsed.steps);
    if (parsed.steps.length === 0) throw new Error("Generated workflow had no valid steps after safety filtering.");
    if (parsed.steps[0].type !== "trigger") {
      parsed.steps.unshift({ id: "step-0-trigger", type: "trigger", next: parsed.steps[0].id });
    }
    const triggerType = (ALLOWED_TRIGGER_TYPES as readonly string[]).includes(parsed.trigger_type)
      ? parsed.trigger_type
      : "manual";

    // 4. Deterministic risk classification
    const { riskLevel, riskReasons } = classifyDraftRisk(parsed);

    // 5. Persist the draft (workspace_id from context ONLY)
    const payload = {
      name:           parsed.name,
      purpose:        parsed.purpose,
      trigger_type:   triggerType,
      trigger_config: parsed.trigger_config ?? {},
      flow_definition: { steps: parsed.steps },
      custom_prompt:  parsed.custom_prompt ?? "",
      risks:          parsed.risks,
    };

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id:         workspaceId,
      run_id:               runId,
      created_by_user_id:   userId,
      source:               "systemmind",
      instructed_by:        instructedBy,
      action_kind:          "workspace_workflow",
      title:                parsed.name,
      purpose:              parsed.purpose,
      payload,
      required_credentials: parsed.required_credentials,
      test_plan:            parsed.test_plan,
      risk_level:           riskLevel,
      risk_reasons:         riskReasons,
      approval_required:    true,
      status:               "draft",
      model_provider:       routed.provider,
      model_id:             routed.model,
    }).select("*").single();
    if (draftErr) throw new Error(`Failed to save draft: ${draftErr.message}`);

    // 6. Close the run
    await sb.from("systemmind_runs").update({
      status:        "completed",
      model_provider: routed.provider,
      model_id:      routed.model,
      used_fallback: routed.usedFallback,
      fallback_from: routed.fallbackFrom,
      input_tokens:  routed.inputTokens,
      output_tokens: routed.outputTokens,
      cost_usd:      routed.costUsd,
      completed_at:  new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspaceId);

    // 7. Audit
    await writeSystemMindAudit({
      workspaceId,
      userId,
      instructedBy,
      actionType:  "generate_draft",
      targetType:  "systemmind_generated_action",
      targetId:    draftRow.id,
      proposedAfterState: { title: parsed.name, risk_level: riskLevel, status: "draft", model: routed.model },
      approvalStatus: "not_requested",
    });

    return {
      runId,
      draftId:      draftRow.id,
      draft:        draftRow,
      modelUsed:    routed.model,
      provider:     routed.provider,
      usedFallback: routed.usedFallback,
      claudeEnabled,
      riskLevel,
    };
  } catch (err: any) {
    await sb.from("systemmind_runs").update({
      status:       "failed",
      error:        (err?.message ?? String(err)).slice(0, 2000),
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspaceId);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_run",
      targetId:   runId,
      error:      err?.message ?? String(err),
    });
    throw err;
  }
}

// ── Lifecycle transitions ───────────────────────────────────────────────────────
const ALLOWED_TRANSITIONS: Record<string, SystemMindDraftStatus[]> = {
  draft:            ["pending_approval", "rejected"],
  pending_approval: ["approved", "active", "rejected", "failed"],
  approved:         ["active", "failed"],
  active:           ["paused"],
  paused:           ["active"],
  rejected:         [],
  failed:           [],
};

async function getDraftOrThrow(workspaceId: string, draftId: string): Promise<any> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_generated_actions")
    .select("*")
    .eq("id", draftId)
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Draft not found in this workspace.");
  return data;
}

function assertTransition(from: string, to: SystemMindDraftStatus): void {
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error(`Invalid lifecycle transition: ${from} → ${to}`);
  }
}

// ── Submit for approval (creates the HiveMind approval record) ─────────────────
export async function submitDraftForApprovalServer(
  workspaceId: string,
  userId: string | null,
  draftId: string,
): Promise<{ hivemindActionId: string }> {
  const sb = supabaseAdmin as any;
  const draft = await getDraftOrThrow(workspaceId, draftId);
  assertTransition(draft.status, "pending_approval");

  const riskNote = draft.risk_level === "high"
    ? " HIGH RISK — review the listed risks carefully before approving."
    : "";

  const { data: action, error } = await sb.from("hivemind_actions").insert({
    workspace_id:   workspaceId,
    title:          `Activate SystemMind automation: "${draft.title}"`,
    description:    `${draft.purpose ?? ""}\n\nRisk level: ${draft.risk_level}.${riskNote}`.trim().slice(0, 2000),
    action_type:    "activate_systemmind_automation",
    action_payload: { generated_action_id: draftId, draft_title: draft.title, risk_level: draft.risk_level },
    status:         "pending",
    proposed_by:    "systemmind",
  }).select("id").single();
  if (error) throw new Error(`Failed to create approval record: ${error.message}`);

  const { error: upErr } = await sb.from("systemmind_generated_actions").update({
    status:             "pending_approval",
    hivemind_action_id: action.id,
  }).eq("id", draftId).eq("workspace_id", workspaceId);
  if (upErr) throw new Error(upErr.message);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "submit_for_approval",
    targetType: "systemmind_generated_action",
    targetId:   draftId,
    beforeState: { status: draft.status },
    proposedAfterState: { status: "pending_approval", hivemind_action_id: action.id },
    approvalStatus: "pending",
  });

  return { hivemindActionId: action.id as string };
}

// ── Activation (called ONLY from the HiveMind approval executor) ────────────────
// Re-validates the stored payload against the step whitelist at execution time.
export async function activateSystemMindAutomation(
  workspaceId: string,
  generatedActionId: string,
  approvedBy: string,
): Promise<{ workflow_id: string; draft_id: string }> {
  const sb = supabaseAdmin as any;
  const draft = await getDraftOrThrow(workspaceId, generatedActionId);
  assertTransition(draft.status, "active");

  // ── Kind dispatch ─────────────────────────────────────────────────────────
  // Generator kinds (whatsapp_setup / follow_up_sequence / n8n_blueprint) have
  // their own activation logic in the generators module; the hub row status
  // update + audit stays centralised here. Dynamic string-literal import to
  // avoid a static import cycle (generators imports helpers from this file).
  const kind = String(draft.action_kind ?? "workflow");
  if (
    kind === "whatsapp_setup" || kind === "follow_up_sequence" || kind === "n8n_blueprint" ||
    kind === "accountsmind_config" || kind === "onboarding_plan" || kind === "build_workspace_apply" ||
    kind === "build_test_override" || kind === "people_view" || kind === "campaign_filter" ||
    kind === "page_filter" || kind === "campaign_fix"
  ) {
    let result: { activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> };
    try {
      if (kind === "accountsmind_config") {
        const cfg = await import("@/lib/accountsmind/accountsmind-config.server");
        result = await cfg.activateAccountsMindConfigKind(workspaceId, generatedActionId);
      } else if (kind === "onboarding_plan") {
        const setup = await import("@/lib/systemmind/workspace-setup.server");
        result = await setup.activateOnboardingPlanKind(workspaceId, generatedActionId);
      } else if (kind === "build_workspace_apply") {
        const bw = await import("@/lib/systemmind/build-workspace.server");
        result = await bw.activateBuildWorkspaceApplyKind(workspaceId, generatedActionId);
      } else if (kind === "build_test_override") {
        const tc = await import("@/lib/systemmind/build-workspace-testcall.server");
        result = await tc.activateBuildTestOverrideKind(workspaceId, generatedActionId);
      } else if (kind === "people_view") {
        const pv = await import("@/lib/people-views/people-views-systemmind.server");
        result = await pv.activatePeopleViewKind(workspaceId, generatedActionId);
      } else if (kind === "campaign_filter") {
        const pv = await import("@/lib/people-views/people-views-systemmind.server");
        result = await pv.activateCampaignFilterKind(workspaceId, generatedActionId);
      } else if (kind === "page_filter") {
        const pf = await import("@/lib/people-views/page-filters-systemmind.server");
        result = await pf.activatePageFilterKind(workspaceId, generatedActionId);
      } else if (kind === "campaign_fix") {
        const cr = await import("@/lib/campaign-reports/campaign-reports-systemmind.server");
        result = await cr.activateCampaignFixKind(workspaceId, generatedActionId);
      } else {
        const gen = await import("@/lib/systemmind/systemmind-generators.server");
        if (kind === "whatsapp_setup") {
          result = await gen.activateWhatsAppSetupKind(workspaceId, generatedActionId);
        } else if (kind === "follow_up_sequence") {
          result = await gen.activateFollowUpSequenceKind(workspaceId, generatedActionId);
        } else {
          result = await gen.activateN8nBlueprintKind(workspaceId, generatedActionId);
        }
      }
    } catch (err) {
      await sb.from("systemmind_generated_actions").update({
        status: "failed",
        error_message: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
      }).eq("id", generatedActionId).eq("workspace_id", workspaceId);
      throw err;
    }

    const activatedAt = new Date().toISOString();
    const { error: kindUpErr } = await sb.from("systemmind_generated_actions").update({
      status:                "active",
      approved_by:           approvedBy,
      approved_at:           activatedAt,
      activated_at:          activatedAt,
      activated_target_type: result.activatedTargetType,
      activated_target_id:   result.activatedTargetId,
    }).eq("id", generatedActionId).eq("workspace_id", workspaceId);
    if (kindUpErr) throw new Error(kindUpErr.message);

    await writeSystemMindAudit({
      workspaceId,
      actionType: "activate",
      targetType: "systemmind_generated_action",
      targetId:   generatedActionId,
      beforeState: { status: draft.status },
      finalAfterState: { status: "active", kind, ...result.summary },
      approvalStatus: "approved",
      approvedBy,
      executedAt: activatedAt,
    });

    // Learn from every successful setup — fire-and-forget, never blocks activation.
    import("@/lib/systemmind/systemmind-setup-learning.server")
      .then((m) => m.recordSetupSuccessLearning({
        workspaceId,
        kind,
        sourceId: generatedActionId,
        title: String(draft.title ?? kind),
        summary: {
          activated_target_type: result.activatedTargetType,
          activated_target_id:   result.activatedTargetId,
          ...result.summary,
        },
      }))
      .catch((e) => console.error("[SetupLearning] failed:", (e as Error)?.message));

    // Keep the legacy return shape: workflow_id carries the activated target id
    // so the HiveMind executor needs no changes.
    return { workflow_id: result.activatedTargetId, draft_id: generatedActionId };
  }

  // ── Legacy workflow kind ──────────────────────────────────────────────────
  // Re-validate payload server-side — never trust what's been sitting in the DB
  // or anything a client may have altered.
  const payload = draft.payload ?? {};
  const steps = (payload.flow_definition?.steps ?? []) as any[];
  const stepsParsed = z.array(StepSchema).min(1).max(30).safeParse(steps);
  if (!stepsParsed.success) {
    await sb.from("systemmind_generated_actions").update({
      status: "failed", error_message: "Payload failed re-validation at activation time.",
    }).eq("id", generatedActionId).eq("workspace_id", workspaceId);
    throw new Error("Draft payload failed safety re-validation — activation refused.");
  }
  const safeSteps = sanitizeSteps(stepsParsed.data);
  if (safeSteps.length === 0) throw new Error("No valid steps after safety filtering — activation refused.");

  const triggerType = (ALLOWED_TRIGGER_TYPES as readonly string[]).includes(String(payload.trigger_type))
    ? String(payload.trigger_type)
    : "manual";

  const { data: wf, error: wfErr } = await sb.from("workspace_workflows").insert({
    workspace_id:    workspaceId,
    template_id:     null,
    name:            String(payload.name ?? draft.title).slice(0, 200),
    description:     `SystemMind-generated automation (draft ${generatedActionId}). ${String(payload.purpose ?? "").slice(0, 400)}`,
    trigger_type:    triggerType,
    trigger_config:  payload.trigger_config ?? {},
    flow_definition: { steps: safeSteps, custom_prompt: payload.custom_prompt ?? "", source: "systemmind" },
    status:          "active",
  }).select("id").single();
  if (wfErr) throw new Error(`Failed to create workflow: ${wfErr.message}`);

  const now = new Date().toISOString();
  const { error: upErr } = await sb.from("systemmind_generated_actions").update({
    status:                "active",
    approved_by:           approvedBy,
    approved_at:           now,
    activated_at:          now,
    activated_target_type: "workspace_workflow",
    activated_target_id:   wf.id,
  }).eq("id", generatedActionId).eq("workspace_id", workspaceId);
  if (upErr) throw new Error(upErr.message);

  await writeSystemMindAudit({
    workspaceId,
    actionType: "activate",
    targetType: "systemmind_generated_action",
    targetId:   generatedActionId,
    beforeState: { status: draft.status },
    finalAfterState: { status: "active", workflow_id: wf.id },
    approvalStatus: "approved",
    approvedBy,
    executedAt: now,
  });

  // Learn from every successful setup — fire-and-forget, never blocks activation.
  import("@/lib/systemmind/systemmind-setup-learning.server")
    .then((m) => m.recordSetupSuccessLearning({
      workspaceId,
      kind: "workflow",
      sourceId: generatedActionId,
      title: String(payload.name ?? draft.title ?? "Workflow automation"),
      summary: {
        workflow_id:  wf.id,
        trigger_type: triggerType,
        step_count:   safeSteps.length,
        purpose:      String(payload.purpose ?? "").slice(0, 400),
      },
    }))
    .catch((e) => console.error("[SetupLearning] failed:", (e as Error)?.message));

  return { workflow_id: wf.id as string, draft_id: generatedActionId };
}

// ── Reject / pause / resume ─────────────────────────────────────────────────────
export async function rejectDraftServer(
  workspaceId: string,
  userId: string | null,
  draftId: string,
): Promise<void> {
  const sb = supabaseAdmin as any;
  const draft = await getDraftOrThrow(workspaceId, draftId);
  assertTransition(draft.status, "rejected");

  const { error } = await sb.from("systemmind_generated_actions")
    .update({ status: "rejected" })
    .eq("id", draftId).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  if (draft.hivemind_action_id) {
    await sb.from("hivemind_actions")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", draft.hivemind_action_id)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending");
  }

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "reject",
    targetType: "systemmind_generated_action",
    targetId:   draftId,
    beforeState: { status: draft.status },
    finalAfterState: { status: "rejected" },
    approvalStatus: "rejected",
  });
}

export async function setDraftPausedServer(
  workspaceId: string,
  userId: string | null,
  draftId: string,
  paused: boolean,
): Promise<void> {
  const sb = supabaseAdmin as any;
  const draft = await getDraftOrThrow(workspaceId, draftId);
  const to: SystemMindDraftStatus = paused ? "paused" : "active";
  // Resume must only ever move paused → active. Without this guard, a
  // pending_approval/approved draft could be flipped straight to "active"
  // via resume, bypassing the approval gate (pending_approval → active is a
  // legal transition, but only activateSystemMindAutomation may perform it).
  if (!paused && draft.status !== "paused") {
    throw new Error(`Only a paused automation can be resumed (current status: ${draft.status}).`);
  }
  assertTransition(draft.status, to);

  const { error } = await sb.from("systemmind_generated_actions")
    .update({ status: to })
    .eq("id", draftId).eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  // Mirror onto the live activated target so the draft status and the running
  // automation can never disagree. workspace_workflow (legacy + n8n_blueprint)
  // and hexmail_campaign (follow_up_sequence) both support active/paused;
  // whatsapp_setup_draft has no live runtime, so nothing to mirror.
  if (draft.activated_target_type === "workspace_workflow" && draft.activated_target_id) {
    const { error: mirrorErr } = await sb.from("workspace_workflows")
      .update({ status: paused ? "paused" : "active", updated_at: new Date().toISOString() })
      .eq("id", draft.activated_target_id)
      .eq("workspace_id", workspaceId);
    if (mirrorErr) throw new Error(`Draft ${paused ? "paused" : "resumed"} but the live workflow update failed: ${mirrorErr.message}`);
  } else if (draft.activated_target_type === "hexmail_campaign" && draft.activated_target_id) {
    const { error: mirrorErr } = await sb.from("hexmail_campaigns")
      .update({ status: paused ? "paused" : "active", updated_at: new Date().toISOString() })
      .eq("id", draft.activated_target_id)
      .eq("workspace_id", workspaceId);
    if (mirrorErr) throw new Error(`Draft ${paused ? "paused" : "resumed"} but the live campaign update failed: ${mirrorErr.message}`);
  }

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: paused ? "pause" : "resume",
    targetType: "systemmind_generated_action",
    targetId:   draftId,
    beforeState: { status: draft.status },
    finalAfterState: { status: to },
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────────
export async function listAutomationDraftsServer(workspaceId: string): Promise<any[]> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_generated_actions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listAutomationRunsServer(workspaceId: string): Promise<any[]> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listAutomationAuditServer(
  workspaceId: string,
  targetId?: string,
): Promise<any[]> {
  const sb = supabaseAdmin as any;
  let q = sb.from("systemmind_audit_logs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (targetId) q = q.eq("target_id", targetId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
