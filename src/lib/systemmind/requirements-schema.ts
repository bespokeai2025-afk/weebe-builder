// ── SystemMind Guided Requirements — shared zod schema ─────────────────────────
// Pure schema module (no server deps) so build-workspace.server.ts and
// requirements.server.ts can both import it without circular imports.
//
// This describes the OPTIONAL `requirements` section of a Build Workspace
// config. It is produced deterministically from interview answers and rides
// inside systemmind_build_versions.generated_config — so it inherits the whole
// existing pipeline: immutable versions, credential scanning, risk
// classification, impact analysis, approval routing and rollback snapshots.

import { z } from "zod";

// The workflow engine's whitelisted lead statuses (mirrors update_lead_status).
export const REQ_LEAD_STATUSES = [
  "need_to_call", "calling", "contact_made", "interested",
  "qualified", "not_interested", "callback_requested",
] as const;

export const REQ_OUTCOMES = [
  "positive", "neutral", "negative", "booked",
  "callback_requested", "no_answer", "voicemail", "opt_out",
] as const;
export type RequirementOutcome = (typeof REQ_OUTCOMES)[number];

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

export const OutcomeRuleSchema = z.object({
  outcome:              z.enum(REQ_OUTCOMES),
  crm_status:           z.enum(REQ_LEAD_STATUSES),
  push_to_crm:          z.boolean().default(true),
  create_task:          z.boolean().default(false),
  task_title:           z.string().max(200).optional(),
  callback_delay_hours: z.number().min(0).max(2160).optional(),
  add_note:             z.boolean().default(false),
  stop_all_followups:   z.boolean().default(false),
});
export type OutcomeRule = z.infer<typeof OutcomeRuleSchema>;

export const ScriptAdditionSchema = z.object({
  id:              z.string().min(1).max(60),
  title:           z.string().min(1).max(200),
  reason:          z.string().max(500).default(""),
  suggested_text:  z.string().min(1).max(4000),
  insert_position: z.enum(["start", "end", "after_greeting", "before_closing"]).default("end"),
  // Drafts NEVER touch the agent prompt until explicitly approved — approval
  // merges the text into agent_prompt as a NEW immutable version.
  status:          z.enum(["proposed", "approved", "rejected"]).default("proposed"),
  approved_by:     z.string().max(80).nullable().optional(),
  approved_at:     z.string().max(40).nullable().optional(),
});
export type ScriptAddition = z.infer<typeof ScriptAdditionSchema>;

export const CallingConfigSchema = z.object({
  // "draft" = save everything, activate nothing (safe default — spec §14).
  mode:                  z.enum(["draft", "instant", "scheduled", "both"]).default("draft"),
  max_attempts_per_lead: z.number().int().min(1).max(10).default(3),
  max_calls_per_day:     z.number().int().min(1).max(500).default(50),
  calling_window:        z.object({
    start:    HHMM.default("09:00"),
    end:      HHMM.default("18:00"),
    timezone: z.string().max(60).default("Europe/London"),
  }).default({}),
  retry_spacing_hours:   z.number().min(1).max(168).default(24),
  voicemail_behavior:    z.enum(["hang_up", "leave_message", "retry_later"]).default("retry_later"),
});
export type CallingConfig = z.infer<typeof CallingConfigSchema>;

export const RequirementsSchema = z.object({
  version:               z.number().int().min(1).max(10).default(1),
  source:                z.literal("requirements_assistant").default("requirements_assistant"),
  outcome_rules:         z.array(OutcomeRuleSchema).max(12).default([]),
  extraction_fields:     z.array(z.object({
    name:        z.string().min(1).max(120),
    type:        z.string().max(60).default("string"),
    description: z.string().max(500).default(""),
    required:    z.boolean().default(false),
  })).max(40).default([]),
  // variable name → lead field target (e.g. "budget" → "meta.budget").
  variable_mappings:     z.record(z.string().max(200)).default({}),
  summary_field:         z.string().max(120).default("call_summary"),
  negative_reason_field: z.string().max(120).nullable().default(null),
  calling:               CallingConfigSchema.optional(),
  campaign:              z.object({
    name:                 z.string().min(1).max(200),
    schedule_description: z.string().max(500).default(""),
    // Campaigns produced by this assistant are ALWAYS created paused.
    start_paused:         z.literal(true).default(true),
  }).optional(),
  script_additions:      z.array(ScriptAdditionSchema).max(20).default([]),
  // Interview answers frozen at generation time (traceability / re-prompt).
  answers_snapshot:      z.record(z.unknown()).default({}),
});
export type AgentRequirements = z.infer<typeof RequirementsSchema>;

// ── Interview question model (deterministic, gap-driven) ──────────────────────
export type RequirementQuestionType = "choice" | "boolean" | "text" | "number";

export type RequirementQuestion = {
  key:                string;
  section:            string;      // spec §16 section grouping
  prompt:             string;      // plain-language question
  type:               RequirementQuestionType;
  options?:           Array<{ value: string; label: string }>;
  recommendedDefault: unknown;     // always present — "recommended default" per spec §4
  required:           boolean;
  whyAsked:           string;      // what gap in the detected setup triggered this
};

// Answer values are validated per-question at merge time.
export const AnswerValueSchema = z.union([
  z.string().max(2000), z.number().min(-1e6).max(1e6), z.boolean(),
]);
export type RequirementAnswers = Record<string, string | number | boolean>;
