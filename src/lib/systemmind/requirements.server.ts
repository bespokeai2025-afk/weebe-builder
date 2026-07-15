// ── SystemMind Guided Requirements Assistant — server-only lifecycle ───────────
// After an agent is created, SystemMind analyses it, asks only about genuine
// gaps (with recommended defaults), and deterministically generates the full
// operational requirements: CRM outcome mapping, extraction fields, variable
// mappings, calling/campaign config, follow-up rules, and approval-gated
// script-addition drafts.
//
// Safety invariants (mirror the Build Workspace):
//   • Everything lands as an IMMUTABLE Build Workspace version — Apply/Go Live
//     run through the existing protected pipeline unchanged.
//   • The live agent (agents.settings) is NEVER touched here.
//   • Script additions are drafts: only an explicit approval merges them into
//     agent_prompt — as a NEW version (previous version = instant rollback).
//   • Calling is never activated: mode "draft" by default, campaigns are
//     created paused at apply time, auto-call switches are never flipped.
//   • Generation is deterministic (no AI). AI is used ONLY for the re-prompt
//     instruction → answers-patch translation, with strict validation and
//     usage/billing recorded.
//   • WBAH is hard-blocked from this flow.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import { writeSystemMindAudit, isClaudeEnabled } from "@/lib/systemmind/systemmind-automation.server";
import { assertNotWbahForDeployment } from "@/lib/systemmind/deployment-orchestrator.server";
import {
  createBuildSessionServer,
  insertBuildVersionServer,
  recordSystemMindUsageEvent,
  type BuildConfig,
} from "@/lib/systemmind/build-workspace.server";
import {
  analyzeAgentForRequirements,
  buildRequirementsQuestions,
  validateAnswersPatch,
  type DetectedAgentSetup,
} from "@/lib/systemmind/requirements-analyzer.server";
import {
  RequirementsSchema,
  type AgentRequirements,
  type OutcomeRule,
  type RequirementAnswers,
  type RequirementQuestion,
  type ScriptAddition,
} from "@/lib/systemmind/requirements-schema";

// ── Interview row helpers ──────────────────────────────────────────────────────
async function getInterviewOrThrow(workspaceId: string, interviewId: string): Promise<any> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_requirements_interviews")
    .select("*").eq("id", interviewId).eq("workspace_id", workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Requirements interview not found in this workspace.");
  return data;
}

export type RequirementsInterview = {
  id:            string;
  sessionId:     string;
  agentId:       string;
  detected:      DetectedAgentSetup;
  questions:     RequirementQuestion[];
  answers:       RequirementAnswers;
  status:        string;
  lastGeneratedVersionId: string | null;
};

function toInterviewDto(row: any): RequirementsInterview {
  return {
    id:        String(row.id),
    sessionId: String(row.session_id),
    agentId:   String(row.agent_id),
    detected:  (row.detected ?? {}) as DetectedAgentSetup,
    questions: Array.isArray(row.questions) ? row.questions : [],
    answers:   (row.answers && typeof row.answers === "object") ? row.answers : {},
    status:    String(row.status),
    lastGeneratedVersionId: row.last_generated_version_id ? String(row.last_generated_version_id) : null,
  };
}

// ── Start / resume ─────────────────────────────────────────────────────────────
export async function startRequirementsInterviewServer(args: {
  workspaceId: string;
  userId:      string | null;
  agentId:     string;
}): Promise<RequirementsInterview> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, agentId } = args;
  if (!workspaceId) throw new Error("workspace_id missing — refusing to start requirements interview.");
  await assertNotWbahForDeployment(workspaceId);

  const detected = await analyzeAgentForRequirements(workspaceId, agentId);

  // Resume an in-progress interview for this agent if one exists.
  const { data: existing } = await sb.from("systemmind_requirements_interviews")
    .select("*")
    .eq("workspace_id", workspaceId).eq("agent_id", agentId)
    .in("status", ["in_progress", "generated"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) {
    // Refresh detection + questions (agent may have changed) but keep answers.
    const answers = (existing.answers ?? {}) as RequirementAnswers;
    const questions = buildRequirementsQuestions(detected, answers);
    const { data: updated, error } = await sb.from("systemmind_requirements_interviews")
      .update({ detected, questions, updated_at: new Date().toISOString() })
      .eq("id", existing.id).eq("workspace_id", workspaceId)
      .select("*").single();
    if (error) throw new Error(`Failed to refresh interview: ${error.message}`);
    return toInterviewDto(updated);
  }

  const { sessionId } = await createBuildSessionServer({
    workspaceId, userId,
    title:         `Requirements: ${detected.agentName}`.slice(0, 200),
    sourcePage:    "systemmind",
    targetAgentId: agentId,
  });

  const questions = buildRequirementsQuestions(detected, {});
  const { data: row, error } = await sb.from("systemmind_requirements_interviews").insert({
    workspace_id:       workspaceId,
    session_id:         sessionId,
    agent_id:           agentId,
    created_by_user_id: userId,
    detected,
    questions,
    answers:            {},
    status:             "in_progress",
  }).select("*").single();
  if (error) throw new Error(`Failed to create requirements interview: ${error.message}`);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "requirements_interview_started",
    targetType: "systemmind_requirements_interview",
    targetId:   row.id,
    finalAfterState: {
      agent_id: agentId, session_id: sessionId,
      question_count: questions.length, detected_purpose: detected.detectedPurpose,
    },
  });

  return toInterviewDto(row);
}

export async function getRequirementsInterviewServer(
  workspaceId: string, interviewId: string,
): Promise<RequirementsInterview> {
  await assertNotWbahForDeployment(workspaceId);
  return toInterviewDto(await getInterviewOrThrow(workspaceId, interviewId));
}

// ── Answer questions ───────────────────────────────────────────────────────────
export async function answerRequirementsQuestionsServer(args: {
  workspaceId: string;
  userId:      string | null;
  interviewId: string;
  answers:     Record<string, unknown>;
}): Promise<RequirementsInterview> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, interviewId } = args;
  await assertNotWbahForDeployment(workspaceId);
  const row = await getInterviewOrThrow(workspaceId, interviewId);
  if (!["in_progress", "generated"].includes(String(row.status))) {
    throw new Error(`This interview is ${row.status} — answers can no longer be changed.`);
  }

  const questions: RequirementQuestion[] = Array.isArray(row.questions) ? row.questions : [];
  const patch = validateAnswersPatch(questions, args.answers);
  const merged: RequirementAnswers = { ...(row.answers ?? {}), ...patch };

  // Re-run the question engine: some answers unlock follow-up questions
  // (e.g. scheduled calling → campaign name).
  const detected = (row.detected ?? {}) as DetectedAgentSetup;
  const refreshedQuestions = buildRequirementsQuestions(detected, merged);

  const { data: updated, error } = await sb.from("systemmind_requirements_interviews")
    .update({ answers: merged, questions: refreshedQuestions, updated_at: new Date().toISOString() })
    .eq("id", interviewId).eq("workspace_id", workspaceId)
    .select("*").single();
  if (error) throw new Error(`Failed to save answers: ${error.message}`);

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "requirements_answers_saved",
    targetType: "systemmind_requirements_interview",
    targetId:   interviewId,
    finalAfterState: { answered_keys: Object.keys(patch), total_answered: Object.keys(merged).length },
  });

  return toInterviewDto(updated);
}

// ── Deterministic generator: answers → AgentRequirements ─────────────────────
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function clampDelayHours(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.min(720, Math.max(0, Math.round(v)));
}

export function buildRequirementsFromAnswers(
  detected: DetectedAgentSetup,
  answers: RequirementAnswers,
): AgentRequirements {
  const a = answers;
  const str = (k: string, d: string) => (typeof a[k] === "string" && String(a[k]).trim() ? String(a[k]).trim() : d);
  const num = (k: string, d: number) => (Number.isFinite(Number(a[k])) ? Number(a[k]) : d);
  const bool = (k: string, d: boolean) => (typeof a[k] === "boolean" ? (a[k] as boolean) : d);

  // ── SOP §1–3: purpose, data source (+ required key name), fields to pull ──
  const purpose = str("agent_purpose", detected.detectedPurpose).slice(0, 1000);
  const srcKind = str("data_source_kind", "");
  const parseList = (raw: string): string[] =>
    raw.trim().toLowerCase() === "none"
      ? []
      : raw.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 40);
  const dataSource = (["crm", "webform", "csv_upload", "call_source"] as const).includes(srcKind as any)
    ? {
        kind: srcKind as "crm" | "webform" | "csv_upload" | "call_source",
        required_key_name:
          srcKind === "crm" || srcKind === "call_source"
            ? str("data_source_key_name", srcKind === "crm" ? "CRM API key" : "Call source API key").slice(0, 120)
            : null,
        fields_to_pull: parseList(str("fields_to_pull", "")),
      }
    : undefined;

  const rules: OutcomeRule[] = [];
  rules.push({
    outcome: "positive", crm_status: str("outcome_positive_status", "interested") as OutcomeRule["crm_status"],
    push_to_crm: true, create_task: false, add_note: false, stop_all_followups: false,
  });
  rules.push({
    outcome: "neutral", crm_status: str("outcome_neutral_status", "contact_made") as OutcomeRule["crm_status"],
    push_to_crm: true, create_task: false, add_note: false, stop_all_followups: false,
    callback_delay_hours: clampDelayHours(a["neutral_callback_hours"], 48),
  });
  rules.push({
    outcome: "negative", crm_status: str("outcome_negative_status", "not_interested") as OutcomeRule["crm_status"],
    push_to_crm: true, create_task: false, stop_all_followups: false,
    add_note: bool("capture_negative_reason", detected.hasNegativeReason),
  });
  if (detected.hasBookingLogic || a["outcome_booked_status"] !== undefined) {
    rules.push({
      outcome: "booked", crm_status: str("outcome_booked_status", "qualified") as OutcomeRule["crm_status"],
      push_to_crm: true, add_note: false, stop_all_followups: false,
      create_task: bool("booked_create_task", true),
      task_title:  "Confirm booked appointment",
    });
  }
  if (detected.hasCallbackLogic || a["callback_delay_hours"] !== undefined) {
    rules.push({
      outcome: "callback_requested", crm_status: "callback_requested",
      push_to_crm: true, create_task: false, add_note: false, stop_all_followups: false,
      callback_delay_hours: clampDelayHours(a["callback_delay_hours"], 24),
    });
  }
  rules.push({
    outcome: "no_answer", crm_status: "need_to_call",
    push_to_crm: false, create_task: false, add_note: false, stop_all_followups: false,
    callback_delay_hours: clampDelayHours(a["no_answer_retry_hours"], 24),
  });
  rules.push({
    outcome: "opt_out", crm_status: "not_interested",
    push_to_crm: true, create_task: false, add_note: true, stop_all_followups: true,
  });

  // Extraction fields (deduped by name)
  const fields: AgentRequirements["extraction_fields"] = [];
  const addField = (name: string, type: string, description: string, required = false) => {
    if (!fields.some((f) => f.name === name)) fields.push({ name, type, description, required });
  };
  addField("sentiment", "enum", "Overall call sentiment: positive, neutral or negative.", true);
  if (bool("capture_call_summary", !detected.hasSummaryField)) {
    addField("call_summary", "string", "Two-sentence summary of the call, written for the CRM timeline.");
  }
  const wantNegativeReason = bool("capture_negative_reason", false) || detected.hasNegativeReason;
  if (wantNegativeReason) {
    addField("negative_reason", "string", "The lead's stated reason for not being interested.");
  }
  if (detected.hasBookingLogic) {
    addField("appointment_datetime", "string", "The agreed appointment date/time, if one was booked.");
  }
  for (const name of parseList(str("extra_extraction_fields", "none")).slice(0, 20)) {
    addField(name.slice(0, 120).replace(/\s+/g, "_"), "string", "Custom data point requested during agent setup.");
  }

  // Variable mappings: explicit answers first, then sane defaults for the
  // fields this assistant introduces.
  const mappings: Record<string, string> = {};
  for (const [k, v] of Object.entries(a)) {
    if (k.startsWith("map_variable_") && typeof v === "string" && v.trim()) {
      mappings[k.slice("map_variable_".length)] = v.trim().slice(0, 200);
    }
  }
  if (bool("capture_call_summary", !detected.hasSummaryField)) mappings["call_summary"] = mappings["call_summary"] ?? "meta.call_summary";
  if (wantNegativeReason) mappings["negative_reason"] = mappings["negative_reason"] ?? "meta.negative_reason";

  // Calling config — mode defaults to "draft" (activate nothing).
  const windowStart = str("calling_window_start", "09:00");
  const windowEnd   = str("calling_window_end", "18:00");
  if (!HHMM_RE.test(windowStart)) throw new Error(`Calling window start "${windowStart}" must be HH:MM (e.g. 09:00).`);
  if (!HHMM_RE.test(windowEnd)) throw new Error(`Calling window end "${windowEnd}" must be HH:MM (e.g. 18:00).`);
  const mode = str("calling_mode", "draft") as "draft" | "instant" | "scheduled" | "both";
  const calling: AgentRequirements["calling"] = {
    mode,
    max_attempts_per_lead: Math.min(10, Math.max(1, Math.round(num("max_attempts_per_lead", 3)))),
    max_calls_per_day:     Math.min(500, Math.max(1, Math.round(num("max_calls_per_day", 50)))),
    concurrent_calls:      Math.min(20, Math.max(1, Math.round(num("concurrent_calls", 1)))),
    calling_window:        { start: windowStart, end: windowEnd, timezone: "Europe/London" },
    retry_spacing_hours:   Math.min(168, Math.max(1, Math.round(num("no_answer_retry_hours", 24)))),
    voicemail_behavior:    (["hang_up", "leave_message", "retry_later"].includes(str("voicemail_behavior", "retry_later"))
                             ? str("voicemail_behavior", "retry_later") : "retry_later") as "hang_up" | "leave_message" | "retry_later",
  };

  const campaign = (mode === "scheduled" || mode === "both")
    ? {
        name: str("campaign_name", `${detected.agentName} campaign`).slice(0, 200),
        schedule_description: `Calls between ${windowStart} and ${windowEnd}, max ${calling.max_calls_per_day}/day, up to ${calling.max_attempts_per_lead} attempts per lead.`,
        start_paused: true as const,
      }
    : undefined;

  // Script-addition drafts (approval-gated; never auto-merged)
  const additions: ScriptAddition[] = [];
  if (bool("add_opt_out_handling", false) && !detected.hasOptOutLogic) {
    additions.push({
      id: "sa-opt-out", title: "Opt-out handling",
      reason: "No opt-out / do-not-call handling was detected in the script — a compliance gap.",
      suggested_text:
        "If the person asks to be removed from your list, not to be called again, or to opt out: apologise once, confirm they will not be contacted again, thank them, and end the call politely. Never argue or attempt to continue the pitch after an opt-out request.",
      insert_position: "before_closing", status: "proposed",
    });
  }
  if (bool("capture_negative_reason", false) && !detected.hasNegativeReason) {
    additions.push({
      id: "sa-negative-reason", title: "Capture the reason for a no",
      reason: "The script never asks WHY a lead says no — losing the most valuable objection data.",
      suggested_text:
        "If the person is not interested, ask one gentle follow-up question to understand why (for example: \"No problem at all — just so I don't bother you again, was it the timing, the price, or something else?\"). Record their answer as negative_reason. Do not push beyond this single question.",
      insert_position: "before_closing", status: "proposed",
    });
  }
  if (calling.voicemail_behavior === "leave_message" && !detected.hasVoicemailLogic) {
    additions.push({
      id: "sa-voicemail", title: "Voicemail message",
      reason: "You chose to leave voicemail messages, but the script has no voicemail handling.",
      suggested_text:
        "If the call reaches voicemail: leave a short, friendly message with your name, the company, one sentence on why you called, and a call-back number. Keep it under 20 seconds and never leave more than one voicemail per day.",
      insert_position: "end", status: "proposed",
    });
  }

  // ── SOP §5–8: post-call destination, page filters, documents, follow-ups ──
  const destRaw = str("data_destination", detected.hasCrmFieldMapping ? "both" : "dashboard");
  const postCall = {
    data_destination: (["crm", "dashboard", "both"].includes(destRaw) ? destRaw : "both") as "crm" | "dashboard" | "both",
    custom_features: (() => { const v = str("custom_agent_features", "none"); return v.toLowerCase() === "none" ? "" : v.slice(0, 2000); })(),
  };

  const pageFilters: Array<{ page: "leads" | "qualified" | "calls" | "records" | "people" | "calendar"; description: string }> = [];
  if (bool("want_page_filters", false)) {
    for (const page of ["leads", "qualified", "calls", "records", "people", "calendar"] as const) {
      const desc = str(`page_filter_${page}`, "none");
      if (desc.trim() && desc.trim().toLowerCase() !== "none") {
        pageFilters.push({ page, description: desc.slice(0, 500) });
      }
    }
  }

  const documentAutomation = bool("auto_populate_documents", false)
    ? { enabled: true, template_name: str("document_template_name", "Call report").slice(0, 200) }
    : undefined;

  const sentimentFollowUps: Array<{ sentiment: "positive" | "neutral" | "negative"; channel: "none" | "email" | "sms" | "whatsapp" }> = [];
  for (const sentiment of ["positive", "neutral", "negative"] as const) {
    const ch = str(`follow_up_${sentiment}`, "none");
    if (["email", "sms", "whatsapp"].includes(ch)) {
      sentimentFollowUps.push({ sentiment, channel: ch as "email" | "sms" | "whatsapp" });
    }
  }

  return RequirementsSchema.parse({
    version: 1,
    purpose,
    data_source: dataSource,
    post_call: postCall,
    page_filters: pageFilters,
    document_automation: documentAutomation,
    sentiment_follow_ups: sentimentFollowUps,
    outcome_rules: rules,
    extraction_fields: fields,
    variable_mappings: mappings,
    summary_field: "call_summary",
    negative_reason_field: wantNegativeReason ? "negative_reason" : null,
    calling,
    campaign,
    script_additions: additions,
    answers_snapshot: a,
  });
}

// ── Workflow steps from outcome rules (whitelisted step types only) ───────────
function buildWorkflowStepsFromRules(rules: OutcomeRule[]): any[] {
  const steps: any[] = [];
  const endId = "step-end";
  const conditions: any[] = [];

  for (const rule of rules) {
    const base = `step-${rule.outcome}`;
    const chain: any[] = [];
    chain.push({ id: `${base}-status`, type: "update_lead_status", status: rule.crm_status });
    if (rule.push_to_crm) chain.push({ id: `${base}-crm`, type: "push_to_crm" });
    if (rule.create_task) chain.push({ id: `${base}-task`, type: "create_task", title: (rule.task_title ?? `Follow up: ${rule.outcome} call outcome`).slice(0, 200) });
    if (rule.callback_delay_hours !== undefined) {
      chain.push({ id: `${base}-callback`, type: "create_callback", delay_hours: Math.min(720, rule.callback_delay_hours) });
    }
    if (rule.add_note) chain.push({ id: `${base}-note`, type: "create_task", title: `Review ${rule.outcome === "opt_out" ? "opt-out request" : "negative reason"} note`.slice(0, 200) });
    // Wire the chain
    for (let i = 0; i < chain.length; i++) chain[i].next = i < chain.length - 1 ? chain[i + 1].id : endId;
    steps.push(...chain.slice(0, 4)); // hard cap per outcome to stay under the 30-step limit
    if (chain.length > 4) steps[steps.length - 1].next = endId;
    conditions.push({ field: "call_outcome", op: "equals", value: rule.outcome, next: chain[0].id });
  }

  return [
    { id: "step-1", type: "trigger", next: "step-2" },
    { id: "step-2", type: "branch", conditions: conditions.slice(0, 10) },
    ...steps,
    { id: endId, type: "stop_workflow" },
  ];
}

// ── Generate a Build Workspace version from the interview ─────────────────────
export async function generateRequirementsVersionServer(args: {
  workspaceId: string;
  userId:      string | null;
  interviewId: string;
  userPrompt?: string | null;   // set by the re-prompt path for traceability
}): Promise<{ versionId: string; versionNumber: number; requirements: AgentRequirements }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, interviewId } = args;
  await assertNotWbahForDeployment(workspaceId);
  const row = await getInterviewOrThrow(workspaceId, interviewId);
  const detected = (row.detected ?? {}) as DetectedAgentSetup;
  const answers = (row.answers ?? {}) as RequirementAnswers;

  const requirements = buildRequirementsFromAnswers(detected, answers);

  // Preserve any previously approved script additions in the agent prompt:
  // start from the CURRENT session version's prompt if one exists, otherwise
  // the agent's own builder prompt. The live agent is never modified here.
  const { data: session } = await sb.from("systemmind_build_sessions")
    .select("id, current_version_id, target_agent_id")
    .eq("id", row.session_id).eq("workspace_id", workspaceId).maybeSingle();
  let agentPrompt = "";
  let approvedAdditions: ScriptAddition[] = [];
  if (session?.current_version_id) {
    const { data: cur } = await sb.from("systemmind_build_versions")
      .select("generated_config").eq("id", session.current_version_id)
      .eq("workspace_id", workspaceId).maybeSingle();
    agentPrompt = String((cur?.generated_config as any)?.agent_prompt ?? "");
    const prior: ScriptAddition[] = ((cur?.generated_config as any)?.requirements?.script_additions ?? []);
    approvedAdditions = prior.filter((s) => s?.status === "approved");
  }
  if (!agentPrompt) {
    const { data: agent } = await sb.from("agents").select("settings")
      .eq("id", row.agent_id).eq("workspace_id", workspaceId).maybeSingle();
    agentPrompt = String((agent?.settings as any)?.globalPrompt ?? "");
  }

  // Carry approved additions forward (already merged into agentPrompt earlier);
  // freshly drafted additions replace only still-proposed ones with the same id.
  const carried = approvedAdditions.filter((ap) => !requirements.script_additions.some((n) => n.id === ap.id));
  requirements.script_additions = [
    ...approvedAdditions.filter((ap) => requirements.script_additions.some((n) => n.id === ap.id)),
    ...requirements.script_additions.filter((n) => !approvedAdditions.some((ap) => ap.id === n.id)),
    ...carried,
  ].slice(0, 20);

  const config: BuildConfig = {
    agent_prompt: agentPrompt.slice(0, 20000),
    workflow: {
      name:           `${detected.agentName} — call outcome handling`.slice(0, 200),
      purpose:        `Routes every completed call to the right CRM status, follow-ups and tasks (generated by the Requirements Assistant).`,
      trigger_type:   "call_completed",
      trigger_config: {},
      steps:          buildWorkflowStepsFromRules(requirements.outcome_rules),
    },
    variables: detected.variables.slice(0, 40).map((v) => ({
      name: v.name, description: `Detected in ${v.source.replace("_", " ")}`,
      source: requirements.variable_mappings[v.name] ?? v.mappedTo ?? undefined,
    })),
    extraction_fields: requirements.extraction_fields.map((f) => ({ name: f.name, type: f.type, description: f.description })),
    follow_up_rules: buildFollowUpRules(answers),
    channel_setup: {},
    // SOP §2 — the data source's access key surfaces as a required-credential
    // box on the generated config (NAME only, never a value).
    required_credentials: requirements.data_source?.required_key_name
      ? [requirements.data_source.required_key_name]
      : [],
    risks: buildRiskList(requirements),
    test_plan: [
      "Run a simulated positive call and confirm the lead status changes as configured.",
      "Run a simulated negative call and confirm the negative reason is captured.",
      "Confirm no calls are placed while calling mode is in draft.",
      requirements.campaign ? `Confirm the campaign "${requirements.campaign.name}" was created paused.` : "Confirm no campaign was created (no scheduled calling).",
    ],
    requirements,
  } as BuildConfig;

  const summary = buildGenerationSummary(detected, requirements);
  const inserted = await insertBuildVersionServer({
    workspaceId, userId,
    sessionId:   row.session_id,
    config,
    summary,
    userPrompt:  args.userPrompt ?? null,
    auditAction: "requirements_version_generated",
  });

  await sb.from("systemmind_requirements_interviews").update({
    status: "generated",
    last_generated_version_id: inserted.versionId,
    updated_at: new Date().toISOString(),
  }).eq("id", interviewId).eq("workspace_id", workspaceId);

  return { versionId: inserted.versionId, versionNumber: inserted.versionNumber, requirements };
}

function buildFollowUpRules(answers: RequirementAnswers): Array<{ trigger: string; action: string; delay_hours?: number; channel?: string }> {
  const rules: Array<{ trigger: string; action: string; delay_hours?: number; channel?: string }> = [];
  const channelLabel: Record<string, string> = {
    email: "follow-up email", sms: "follow-up SMS", whatsapp: "WhatsApp follow-up message",
  };
  const sentimentAction: Record<string, string> = {
    positive: "thanking them and confirming next steps",
    neutral:  "with a gentle nudge and an easy way to say yes",
    negative: "politely thanking them for their time",
  };
  for (const sentiment of ["positive", "neutral", "negative"] as const) {
    const fu = String(answers[`follow_up_${sentiment}`] ?? "");
    if (channelLabel[fu]) {
      rules.push({
        trigger: `Call ends with a ${sentiment} outcome`,
        action:  `Send a ${channelLabel[fu]} ${sentimentAction[sentiment]}`,
        delay_hours: 1,
        channel: fu,
      });
    }
  }
  return rules;
}

function buildRiskList(req: AgentRequirements): string[] {
  const risks: string[] = ["Updates lead CRM statuses automatically after calls."];
  if (req.calling?.mode === "instant" || req.calling?.mode === "both") {
    risks.push("Instant calling mode selected — leads will be called automatically once activated (activation itself still requires an explicit human step).");
  }
  if (req.calling?.mode === "scheduled" || req.calling?.mode === "both") {
    risks.push("Scheduled campaign calling selected — the campaign is created paused and must be started manually.");
  }
  if (req.script_additions.some((s) => s.status === "proposed")) {
    risks.push("Contains script-addition drafts awaiting approval — they do NOT change the agent until approved.");
  }
  return risks;
}

function buildGenerationSummary(detected: DetectedAgentSetup, req: AgentRequirements): string {
  const bits: string[] = [];
  bits.push(`Requirements generated for "${detected.agentName}" (${req.purpose || detected.detectedPurpose}).`);
  if (req.data_source) {
    const srcLabel: Record<string, string> = {
      crm: "CRM system", webform: "webform", csv_upload: "WEBEE CSV uploader", call_source: "call source",
    };
    bits.push(`Data source: ${srcLabel[req.data_source.kind] ?? req.data_source.kind}${req.data_source.fields_to_pull.length ? `, pulling ${req.data_source.fields_to_pull.length} field(s): ${req.data_source.fields_to_pull.slice(0, 8).join(", ")}` : ""}.`);
    if (req.data_source.required_key_name) {
      bits.push(`REQUIRED KEY: "${req.data_source.required_key_name}" must be provided (in Settings — never in chat) before this agent can go live.`);
    }
  }
  bits.push(`${req.outcome_rules.length} call-outcome rules map results to CRM statuses.`);
  bits.push(`${req.extraction_fields.length} extraction fields, ${Object.keys(req.variable_mappings).length} variable mappings.`);
  bits.push(`Calling mode: ${req.calling?.mode ?? "draft"}, ${req.calling?.concurrent_calls ?? 1} concurrent call(s)${req.campaign ? `, with paused campaign "${req.campaign.name}"` : ""}.`);
  if (req.post_call) bits.push(`Extracted data points go to: ${req.post_call.data_destination === "both" ? "CRM and dashboard" : req.post_call.data_destination === "crm" ? "the CRM" : "the WEBEE dashboard"}.`);
  if (req.page_filters.length > 0) bits.push(`${req.page_filters.length} page filter(s) specified (${req.page_filters.map((f) => f.page).join(", ")}) — drafted for the saved-filters system, applied only on approval.`);
  if (req.document_automation?.enabled) bits.push(`Documents auto-populate from Template Studio template "${req.document_automation.template_name}".`);
  if (req.sentiment_follow_ups.length > 0) bits.push(`Follow-ups: ${req.sentiment_follow_ups.map((f) => `${f.sentiment} → ${f.channel}`).join(", ")}.`);
  const proposed = req.script_additions.filter((s) => s.status === "proposed").length;
  if (proposed > 0) bits.push(`${proposed} script addition${proposed === 1 ? "" : "s"} drafted — review and approve them before they touch the script.`);
  bits.push("Nothing is live yet: Apply saves the configuration, and calling is never activated automatically.");
  return bits.join(" ");
}

// ── Script addition approval / rejection ──────────────────────────────────────
function mergeScriptAddition(prompt: string, addition: ScriptAddition): string {
  const block = `\n\n## ${addition.title} (added via SystemMind Requirements)\n${addition.suggested_text}\n`;
  if (addition.insert_position === "start") return `${block.trimStart()}\n\n${prompt}`;
  // after_greeting / before_closing / end all append — deterministic and safe;
  // the section heading makes the placement intent clear to the model.
  return `${prompt}${block}`;
}

export async function setScriptAdditionStatusServer(args: {
  workspaceId: string;
  userId:      string | null;
  interviewId: string;
  additionId:  string;
  decision:    "approved" | "rejected";
}): Promise<{ versionId: string; versionNumber: number }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, interviewId, additionId, decision } = args;
  await assertNotWbahForDeployment(workspaceId);
  const row = await getInterviewOrThrow(workspaceId, interviewId);
  if (!row.last_generated_version_id) throw new Error("Generate the requirements first — there is no version to update.");

  const { data: version, error: vErr } = await sb.from("systemmind_build_versions")
    .select("*").eq("id", row.last_generated_version_id).eq("workspace_id", workspaceId).maybeSingle();
  if (vErr) throw new Error(vErr.message);
  if (!version) throw new Error("The generated version no longer exists — regenerate the requirements.");

  const config = (version.generated_config ?? {}) as BuildConfig;
  const req = config.requirements;
  if (!req) throw new Error("This version has no requirements section.");
  const addition = req.script_additions.find((s) => s.id === additionId);
  if (!addition) throw new Error("Script addition not found on the current version.");
  if (addition.status !== "proposed") throw new Error(`This script addition is already ${addition.status}.`);

  const now = new Date().toISOString();
  const newAdditions = req.script_additions.map((s) =>
    s.id === additionId
      ? { ...s, status: decision, approved_by: decision === "approved" ? (userId ?? "user") : null, approved_at: decision === "approved" ? now : null }
      : s,
  );
  const newConfig: BuildConfig = {
    ...config,
    agent_prompt: decision === "approved"
      ? mergeScriptAddition(String(config.agent_prompt ?? ""), addition).slice(0, 20000)
      : config.agent_prompt,
    requirements: { ...req, script_additions: newAdditions },
  };

  const inserted = await insertBuildVersionServer({
    workspaceId, userId,
    sessionId:   row.session_id,
    config:      newConfig,
    summary: decision === "approved"
      ? `Script addition "${addition.title}" approved and merged into the agent prompt (new version — the previous version is your rollback point). The live agent is unchanged until you Apply.`
      : `Script addition "${addition.title}" rejected — the draft stays recorded but will never be merged.`,
    auditAction: decision === "approved" ? "requirements_script_addition_approved" : "requirements_script_addition_rejected",
  });

  await sb.from("systemmind_requirements_interviews").update({
    last_generated_version_id: inserted.versionId,
    updated_at: now,
  }).eq("id", interviewId).eq("workspace_id", workspaceId);

  return { versionId: inserted.versionId, versionNumber: inserted.versionNumber };
}

// ── Simulation (pure — never calls providers, never writes CRM data) ──────────
export type SimulatedAction = { action: string; detail: string };

export function simulateRequirementsOutcome(
  req: AgentRequirements,
  outcome: string,
): { outcome: string; matched: boolean; actions: SimulatedAction[] } {
  // Webform lead intake is not a call outcome — simulate what happens when a
  // new lead arrives, based on the configured calling mode.
  if (outcome === "webform_lead") {
    const mode = req.calling?.mode ?? "draft";
    const actions: SimulatedAction[] = [{ action: "create_lead", detail: "New lead created from the webform submission." }];
    if (mode === "instant" || mode === "both") {
      actions.push({ action: "queue_instant_call", detail: `Lead queued for an immediate call (respecting the ${req.calling?.calling_window?.start ?? "09:00"}–${req.calling?.calling_window?.end ?? "18:00"} window and ${req.calling?.max_calls_per_day ?? 50}/day cap).` });
    }
    if (mode === "scheduled" || mode === "both") {
      actions.push({ action: "add_to_campaign", detail: `Lead added to the "${req.campaign?.name ?? "campaign"}" campaign (created paused — calls start only when you activate it).` });
    }
    if (mode === "draft") {
      actions.push({ action: "no_call", detail: "Calling is in draft-only mode — the lead is saved but no call is placed." });
    }
    return { outcome, matched: true, actions };
  }

  const rule = req.outcome_rules.find((r) => r.outcome === outcome);
  if (!rule) {
    return {
      outcome, matched: false,
      actions: [{ action: "no_rule", detail: `No rule configured for outcome "${outcome}" — the lead would be left unchanged.` }],
    };
  }
  const actions: SimulatedAction[] = [];
  actions.push({ action: "update_lead_status", detail: `Lead status → "${rule.crm_status}".` });
  if (rule.push_to_crm) actions.push({ action: "push_to_crm", detail: "Lead synced to the CRM." });
  if (rule.create_task) actions.push({ action: "create_task", detail: `Ops task created: "${rule.task_title ?? "Follow up"}".` });
  if (rule.callback_delay_hours !== undefined) {
    actions.push({ action: "create_callback", detail: `Callback scheduled in ${rule.callback_delay_hours}h.` });
  }
  if (rule.add_note) actions.push({ action: "add_note", detail: outcome === "opt_out" ? "Opt-out note recorded against the lead." : "Reason captured as a note (negative_reason field)." });
  if (rule.stop_all_followups) actions.push({ action: "stop_followups", detail: "All future follow-ups and calls to this lead stopped." });
  for (const [variable, target] of Object.entries(req.variable_mappings)) {
    actions.push({ action: "map_variable", detail: `Captured "${variable}" saved to lead field "${target}".` });
  }
  return { outcome, matched: true, actions };
}

export const SIMULATION_SCENARIOS = ["positive", "neutral", "negative", "booked", "callback_requested", "no_answer", "opt_out", "webform_lead"] as const;

export async function simulateRequirementsServer(args: {
  workspaceId: string;
  userId:      string | null;
  interviewId: string;
  outcome?:    string | null;   // null = run all canned scenarios
}): Promise<Array<{ outcome: string; matched: boolean; actions: SimulatedAction[] }>> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, interviewId } = args;
  await assertNotWbahForDeployment(workspaceId);
  const row = await getInterviewOrThrow(workspaceId, interviewId);
  if (!row.last_generated_version_id) throw new Error("Generate the requirements first — there is nothing to simulate.");
  const { data: version } = await sb.from("systemmind_build_versions")
    .select("generated_config").eq("id", row.last_generated_version_id)
    .eq("workspace_id", workspaceId).maybeSingle();
  const req = (version?.generated_config as any)?.requirements as AgentRequirements | undefined;
  if (!req) throw new Error("The current version has no requirements section — regenerate first.");

  const outcomes = args.outcome ? [String(args.outcome)] : [...SIMULATION_SCENARIOS];
  const results = outcomes.map((o) => simulateRequirementsOutcome(req, o));

  await writeSystemMindAudit({
    workspaceId, userId,
    actionType: "requirements_simulated",
    targetType: "systemmind_requirements_interview",
    targetId:   interviewId,
    finalAfterState: { outcomes, matched: results.filter((r) => r.matched).length },
  });

  return results;
}

// ── Re-prompt: natural-language change → answers patch → regenerate ──────────
const RepromptPatchSchema = z.object({
  answers_patch: z.record(z.union([z.string().max(2000), z.number(), z.boolean()])).refine(
    (r) => Object.keys(r).length > 0 && Object.keys(r).length <= 20,
    "Patch must change between 1 and 20 answers.",
  ),
  explanation: z.string().max(1000).default(""),
});

const REPROMPT_SYSTEM = `You translate a user's plain-language change request into a JSON patch of interview answers for an agent-requirements assistant. You will be given the question catalog (keys, types, options) and current answers. Return ONLY strict JSON: {"answers_patch": {"question_key": value, ...}, "explanation": "..."}.
Rules: only use keys from the catalog; choice answers must be one of the listed option values; booleans are true/false; numbers are plain numbers; never invent keys; if the request cannot be expressed with the available questions, return {"answers_patch": {}, "explanation": "why"}.`;

export async function repromptRequirementsServer(args: {
  workspaceId: string;
  userId:      string | null;
  interviewId: string;
  instruction: string;
}): Promise<{ versionId: string; versionNumber: number; changedKeys: string[]; explanation: string }> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, interviewId } = args;
  const instruction = args.instruction.trim();
  if (!instruction) throw new Error("Describe the change you want.");
  await assertNotWbahForDeployment(workspaceId);
  const row = await getInterviewOrThrow(workspaceId, interviewId);
  const questions: RequirementQuestion[] = Array.isArray(row.questions) ? row.questions : [];
  const startedAt = new Date();

  const catalog = questions.map((q) => ({
    key: q.key, type: q.type, options: q.options?.map((o) => o.value),
    recommended_default: q.recommendedDefault,
  }));

  const claudeEnabled = isClaudeEnabled();
  let routed: any;
  try {
    routed = await routeGenerate({
      system:      REPROMPT_SYSTEM,
      user:        `QUESTION CATALOG:\n${JSON.stringify(catalog).slice(0, 12000)}\n\nCURRENT ANSWERS:\n${JSON.stringify(row.answers ?? {}).slice(0, 6000)}\n\nUSER CHANGE REQUEST:\n"${instruction.slice(0, 2000)}"\n\nStrict JSON only.`,
      contentType: "systemmind_requirements_reprompt",
      maxTokens:   1500,
      mode:        "manual",
      provider:    claudeEnabled ? "claude" : "openai",
      model:       claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
      settings:    {},
      workspaceId,
      sb,
    });
  } catch (err: any) {
    await recordSystemMindUsageEvent({
      workspaceId, userId, sessionId: row.session_id,
      taskType: "requirements_reprompt", sourcePage: "systemmind",
      startedAt, completedAt: new Date(), success: false, error: err?.message ?? String(err),
    });
    throw err;
  }

  const completedAt = new Date();
  let patch: z.infer<typeof RepromptPatchSchema>;
  try {
    const cleaned = String(routed.text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    patch = RepromptPatchSchema.parse(JSON.parse(cleaned));
  } catch {
    await recordSystemMindUsageEvent({
      workspaceId, userId, sessionId: row.session_id,
      taskType: "requirements_reprompt", sourcePage: "systemmind",
      modelProvider: routed.provider, modelId: routed.model,
      promptTokens: routed.inputTokens, completionTokens: routed.outputTokens,
      startedAt, completedAt, success: false, error: "invalid model JSON",
    });
    throw new Error("SystemMind couldn't turn that request into a config change — try rephrasing it.");
  }

  await recordSystemMindUsageEvent({
    workspaceId, userId, sessionId: row.session_id,
    taskType: "requirements_reprompt", sourcePage: "systemmind",
    modelProvider: routed.provider, modelId: routed.model,
    promptTokens: routed.inputTokens, completionTokens: routed.outputTokens,
    startedAt, completedAt, success: true,
  });

  const changedKeys = Object.keys(patch.answers_patch);
  if (changedKeys.length === 0) {
    throw new Error(patch.explanation || "That request doesn't map to any requirements setting — try rephrasing it.");
  }

  // Same strict validation as manual answering, then regenerate deterministically.
  await answerRequirementsQuestionsServer({ workspaceId, userId, interviewId, answers: patch.answers_patch });
  const gen = await generateRequirementsVersionServer({
    workspaceId, userId, interviewId,
    userPrompt: instruction.slice(0, 8000),
  });

  return { versionId: gen.versionId, versionNumber: gen.versionNumber, changedKeys, explanation: patch.explanation };
}
