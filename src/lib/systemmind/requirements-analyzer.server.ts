// ── SystemMind Guided Requirements — deterministic analyzer + question engine ──
// Inspects a created agent (agents row + builder settings + flow nodes +
// custom_agent_configs + workspace switches) and produces:
//   1. DetectedAgentSetup — what the agent already has / is missing.
//   2. A gap-driven question catalog with recommended defaults (spec §3–4):
//      only asks about genuine gaps; everything detected is surfaced, not asked.
//
// NO AI in this module — detection and question building are fully
// deterministic so the flow is testable and never blocked by a model.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type RequirementQuestion,
  type RequirementAnswers,
} from "@/lib/systemmind/requirements-schema";

// ── Detected setup ─────────────────────────────────────────────────────────────
export type DetectedVariable = {
  name:      string;
  source:    "prompt" | "flow" | "lead_gen" | "qualify" | "extraction";
  mappedTo:  string | null;   // lead field target if already mapped
};

export type DetectedAgentSetup = {
  agentId:            string;
  agentName:          string;
  agentType:          string;               // lead_generation | receptionist | client_qualification | custom | (db enum)
  channel:            "voice" | "whatsapp";
  deploymentMode:     string;
  isLive:             boolean;              // has a deployed provider agent id
  promptChars:        number;
  nodeCount:          number;
  detectedPurpose:    string;               // plain-language, deterministic
  variables:          DetectedVariable[];
  extractionFields:   string[];             // existing custom_agent_configs extraction field names
  hasBookingLogic:    boolean;
  hasCallbackLogic:   boolean;
  hasOptOutLogic:     boolean;
  hasVoicemailLogic:  boolean;
  hasSentimentLogic:  boolean;
  hasNegativeReason:  boolean;
  hasSummaryField:    boolean;
  hasCrmFieldMapping: boolean;
  crmMode:            string | null;
  hasAgentConfig:     boolean;              // custom_agent_configs row exists
  followUpRulesCount: number;               // from existing deployment_config
  hasAutoCallSwitch:  boolean;              // workspace lead_auto_call enabled
  hasLinkedWorkflow:  boolean;              // build-workspace lineage workflow exists
};

const VAR_RE = /\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]{0,80})\s*\}\}/g;

function extractVarNames(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text)) !== null) out.add(m[1]);
  return [...out];
}

function textHasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export async function analyzeAgentForRequirements(
  workspaceId: string,
  agentId: string,
): Promise<DetectedAgentSetup> {
  const sb = supabaseAdmin as any;

  const { data: agent, error } = await sb.from("agents")
    .select("id, name, agent_type, settings, flow_data, variables, retell_agent_id, deployment_mode, workspace_id")
    .eq("id", agentId).eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load agent: ${error.message}`);
  if (!agent) throw new Error("Agent not found in this workspace.");

  const settings: any = agent.settings ?? {};
  const flowData: any = agent.flow_data ?? {};
  const nodes: any[] = Array.isArray(flowData.nodes) ? flowData.nodes : [];
  const prompt = String(settings.globalPrompt ?? "");
  const beginMessage = String(settings.beginMessage ?? "");
  // Flow text = node data serialised (instructions, messages, conditions).
  let flowText = "";
  try { flowText = JSON.stringify(nodes).slice(0, 200000); } catch { flowText = ""; }
  const allText = `${prompt}\n${beginMessage}\n${flowText}`;

  // Existing agent config (Build Workspace / deployment configurator output)
  const { data: cfg } = await sb.from("custom_agent_configs")
    .select("id, crm_mode, crm_field_mapping, extraction_fields, deployment_config, required_variables")
    .eq("workspace_id", workspaceId).eq("agent_id", agentId)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();

  const cfgExtraction: any[] = Array.isArray(cfg?.extraction_fields) ? cfg.extraction_fields : [];
  const extractionFields = cfgExtraction
    .map((f: any) => String(f?.name ?? f ?? "")).filter(Boolean);
  const crmFieldMapping: Record<string, unknown> =
    cfg?.crm_field_mapping && typeof cfg.crm_field_mapping === "object" ? cfg.crm_field_mapping : {};
  const followUpRules: any[] =
    Array.isArray((cfg?.deployment_config as any)?.follow_up_rules) ? (cfg!.deployment_config as any).follow_up_rules : [];

  // Variables: prompt/flow {{placeholders}} + builder variable defs + module mappings
  const varMap = new Map<string, DetectedVariable>();
  const addVar = (name: string, source: DetectedVariable["source"], mappedTo: string | null = null) => {
    const existing = varMap.get(name);
    if (existing) { if (mappedTo && !existing.mappedTo) existing.mappedTo = mappedTo; return; }
    varMap.set(name, { name, source, mappedTo });
  };
  for (const v of extractVarNames(`${prompt}\n${beginMessage}`)) addVar(v, "prompt");
  for (const v of extractVarNames(flowText)) addVar(v, "flow");
  const builderVars: any[] = Array.isArray(agent.variables) ? agent.variables : [];
  for (const v of builderVars) { const n = String(v?.name ?? ""); if (n) addVar(n, "extraction"); }
  const leadGen: any = settings.leadGen ?? {};
  const qualify: any = settings.qualify ?? {};
  for (const [k, target] of Object.entries(leadGen.variableMappings ?? {})) addVar(String(k), "lead_gen", String(target));
  for (const [k, target] of Object.entries(leadGen.postCallMappings ?? {})) addVar(String(k), "lead_gen", String(target));
  for (const [k, target] of Object.entries(qualify.preCallMappings ?? {})) addVar(String(k), "qualify", String(target));
  for (const [k, target] of Object.entries(qualify.postCallMappings ?? {})) addVar(String(k), "qualify", String(target));
  // crm_field_mapping marks variables as already mapped
  for (const [k, target] of Object.entries(crmFieldMapping)) {
    if (varMap.has(k)) varMap.get(k)!.mappedTo = varMap.get(k)!.mappedTo ?? String(target);
    else addVar(k, "extraction", String(target));
  }
  const variables = [...varMap.values()].slice(0, 60);

  // Deterministic capability detection
  const hasBookingLogic =
    settings.booking?.enabled === true ||
    textHasAny(allText, [/\bbook(ing)?\b/i, /\bappointment\b/i, /\bschedule (a )?(call|meeting|viewing)\b/i]);
  const hasCallbackLogic  = textHasAny(allText, [/\bcall.?back\b/i]) || leadGen.trackCallbackRequested === true;
  const hasOptOutLogic    = textHasAny(allText, [/\bopt.?out\b/i, /\bdo not (call|contact)\b/i, /\bunsubscribe\b/i, /\bremove (me|them) from\b/i]);
  const hasVoicemailLogic = textHasAny(allText, [/\bvoice.?mail\b/i, /\banswering machine\b/i]);
  const hasSentimentLogic =
    extractionFields.some((f) => /sentiment|interest/i.test(f)) ||
    leadGen.trackInterestLevel === true || qualify.trackInterestLevel === true;
  const hasNegativeReason =
    extractionFields.some((f) => /negative|objection|reason.*(no|not)|not_interested_reason/i.test(f)) ||
    leadGen.trackObjections === true;
  const hasSummaryField = extractionFields.some((f) => /summary/i.test(f));

  // Workspace calling switches + build lineage
  const { data: ws } = await sb.from("workspace_settings")
    .select("lead_auto_call_enabled")
    .eq("workspace_id", workspaceId).maybeSingle();
  const { data: linkedWf } = await sb.from("workspace_workflows")
    .select("id").eq("workspace_id", workspaceId).eq("source", "systemmind_build")
    .limit(1).maybeSingle();

  const agentType = String(settings.agentType ?? agent.agent_type ?? "custom");
  const channel: "voice" | "whatsapp" = settings.channelType === "whatsapp" ? "whatsapp" : "voice";

  const purposeBits: string[] = [];
  purposeBits.push(
    agentType === "lead_generation"      ? "Outbound lead-generation calling" :
    agentType === "client_qualification" ? "Lead qualification calling" :
    agentType === "receptionist"         ? "Inbound receptionist" :
    "Custom agent");
  if (hasBookingLogic) purposeBits.push("with appointment booking");
  if (channel === "whatsapp") purposeBits.push("on WhatsApp");
  const detectedPurpose = purposeBits.join(" ");

  return {
    agentId:            String(agent.id),
    agentName:          String(agent.name ?? "Agent"),
    agentType,
    channel,
    deploymentMode:     String(settings.deploymentMode ?? agent.deployment_mode ?? "RETELL"),
    isLive:             !!(agent.retell_agent_id || settings.deployedElevenLabsAgentId),
    promptChars:        prompt.length,
    nodeCount:          nodes.length,
    detectedPurpose,
    variables,
    extractionFields,
    hasBookingLogic,
    hasCallbackLogic,
    hasOptOutLogic,
    hasVoicemailLogic,
    hasSentimentLogic,
    hasNegativeReason,
    hasSummaryField,
    hasCrmFieldMapping: Object.keys(crmFieldMapping).length > 0,
    crmMode:            cfg?.crm_mode ? String(cfg.crm_mode) : null,
    hasAgentConfig:     !!cfg?.id,
    followUpRulesCount: followUpRules.length,
    hasAutoCallSwitch:  ws?.lead_auto_call_enabled === true,
    hasLinkedWorkflow:  !!linkedWf?.id,
  };
}

// ── Question engine (gap-driven, recommended defaults per spec §4) ─────────────
const STATUS_OPTIONS = [
  { value: "need_to_call",       label: "Need to call" },
  { value: "calling",            label: "Calling" },
  { value: "contact_made",       label: "Contact made" },
  { value: "interested",         label: "Interested" },
  { value: "qualified",          label: "Qualified" },
  { value: "not_interested",     label: "Not interested" },
  { value: "callback_requested", label: "Callback requested" },
];

const YES_NO = undefined; // boolean type renders its own control

export function buildRequirementsQuestions(
  detected: DetectedAgentSetup,
  answers: RequirementAnswers = {},
): RequirementQuestion[] {
  const qs: RequirementQuestion[] = [];
  const add = (q: RequirementQuestion) => { qs.push(q); };

  // ── 1. Outcome → CRM mapping (always asked — this is the core of the flow) ──
  add({
    key: "outcome_positive_status", section: "CRM outcome mapping",
    prompt: "When a call ends with a POSITIVE outcome, what should the lead's CRM status become?",
    type: "choice", options: STATUS_OPTIONS, recommendedDefault: "interested", required: true,
    whyAsked: "No CRM outcome mapping exists for this agent yet.",
  });
  add({
    key: "outcome_neutral_status", section: "CRM outcome mapping",
    prompt: "When a call is NEUTRAL (spoke, but no clear yes/no), what CRM status should be set?",
    type: "choice", options: STATUS_OPTIONS, recommendedDefault: "contact_made", required: true,
    whyAsked: "No CRM outcome mapping exists for this agent yet.",
  });
  add({
    key: "outcome_negative_status", section: "CRM outcome mapping",
    prompt: "When a call ends NEGATIVE (not interested), what CRM status should be set?",
    type: "choice", options: STATUS_OPTIONS, recommendedDefault: "not_interested", required: true,
    whyAsked: "No CRM outcome mapping exists for this agent yet.",
  });
  add({
    key: "neutral_callback_hours", section: "CRM outcome mapping",
    prompt: "For NEUTRAL outcomes, schedule a follow-up callback after how many hours?",
    type: "number", recommendedDefault: 48, required: false,
    whyAsked: "Neutral leads are usually worth one more attempt — 48h is the platform default.",
  });

  // ── 2. Booked / booking ──
  if (detected.hasBookingLogic) {
    add({
      key: "outcome_booked_status", section: "Bookings",
      prompt: "This agent books appointments. When a booking is made, what CRM status should the lead get?",
      type: "choice", options: STATUS_OPTIONS, recommendedDefault: "qualified", required: true,
      whyAsked: "Booking logic detected in the agent script/flow, but no booked-outcome CRM rule exists.",
    });
    add({
      key: "booked_create_task", section: "Bookings",
      prompt: "When a booking is made, should an ops task be created so your team sees it?",
      type: "boolean", options: YES_NO, recommendedDefault: true, required: false,
      whyAsked: "Booked appointments usually need a human confirmation step.",
    });
  }

  // ── 3. Callbacks ──
  if (detected.hasCallbackLogic) {
    add({
      key: "callback_delay_hours", section: "Callbacks",
      prompt: "When a lead asks for a callback but no specific time is agreed, call back after how many hours?",
      type: "number", recommendedDefault: 24, required: false,
      whyAsked: "Callback handling detected in the script, but no default callback delay is configured.",
    });
  }

  // ── 4. No answer / voicemail ──
  add({
    key: "no_answer_retry_hours", section: "No answer & voicemail",
    prompt: "If a call is not answered, retry after how many hours?",
    type: "number", recommendedDefault: 24, required: false,
    whyAsked: "Every calling agent needs a no-answer rule; nothing is configured yet.",
  });
  add({
    key: "voicemail_behavior", section: "No answer & voicemail",
    prompt: "If the call reaches voicemail, what should the agent do?",
    type: "choice",
    options: [
      { value: "hang_up",       label: "Hang up (no message)" },
      { value: "leave_message", label: "Leave a short message" },
      { value: "retry_later",   label: "Hang up and retry later" },
    ],
    recommendedDefault: "retry_later", required: false,
    whyAsked: detected.hasVoicemailLogic
      ? "Voicemail is mentioned in the script — confirm the behaviour."
      : "No voicemail behaviour is configured.",
  });

  // ── 5. Opt-out ──
  if (!detected.hasOptOutLogic) {
    add({
      key: "add_opt_out_handling", section: "Opt-out & compliance",
      prompt: "The script has no opt-out handling (e.g. \"remove me from your list\"). Add it? (A script addition will be drafted for your approval — nothing changes without it.)",
      type: "boolean", recommendedDefault: true, required: false,
      whyAsked: "No opt-out / do-not-call handling was detected — this is a compliance gap.",
    });
  }

  // ── 6. Negative reason capture ──
  if (!detected.hasNegativeReason) {
    add({
      key: "capture_negative_reason", section: "Data capture",
      prompt: "When someone says no, should the agent capture WHY (a negative_reason field saved to the CRM)? A script addition will be drafted for your approval.",
      type: "boolean", recommendedDefault: true, required: false,
      whyAsked: "No negative-reason capture detected — you'd lose the most valuable objection data.",
    });
  }

  // ── 7. Call summary ──
  if (!detected.hasSummaryField) {
    add({
      key: "capture_call_summary", section: "Data capture",
      prompt: "Save a short call summary to the CRM after every call?",
      type: "boolean", recommendedDefault: true, required: false,
      whyAsked: "No call-summary extraction field exists yet.",
    });
  }

  // ── 8. Unmapped variables ──
  for (const v of detected.variables.filter((x) => !x.mappedTo).slice(0, 10)) {
    add({
      key: `map_variable_${v.name}`, section: "Variable mapping",
      prompt: `The agent uses the variable "{{${v.name}}}" (${v.source.replace("_", " ")}) but it isn't mapped to a CRM field. Where should it be saved?`,
      type: "text", recommendedDefault: `meta.${v.name}`, required: false,
      whyAsked: "Unmapped variables are captured on the call but never reach your CRM.",
    });
  }

  // ── 9. Calling mode & limits ──
  add({
    key: "calling_mode", section: "Calling & campaigns",
    prompt: "How should this agent make calls once live?",
    type: "choice",
    options: [
      { value: "draft",     label: "Just save the config for now (recommended — activate later)" },
      { value: "instant",   label: "Call new leads as they arrive" },
      { value: "scheduled", label: "Scheduled campaign batches" },
      { value: "both",      label: "Both instant and scheduled" },
    ],
    recommendedDefault: "draft", required: true,
    whyAsked: "Calling activation is never assumed — you choose it explicitly.",
  });
  add({
    key: "max_attempts_per_lead", section: "Calling & campaigns",
    prompt: "Maximum call attempts per lead before giving up?",
    type: "number", recommendedDefault: 3, required: false,
    whyAsked: "Protects your leads from over-calling; 3 matches the platform daily cap.",
  });
  add({
    key: "max_calls_per_day", section: "Calling & campaigns",
    prompt: "Maximum total calls per day for this agent?",
    type: "number", recommendedDefault: 50, required: false,
    whyAsked: "A hard daily budget prevents runaway outbound volume.",
  });
  add({
    key: "calling_window_start", section: "Calling & campaigns",
    prompt: "Earliest time of day calls may start (HH:MM)?",
    type: "text", recommendedDefault: "09:00", required: false,
    whyAsked: "Calls outside business hours damage trust (and may breach rules).",
  });
  add({
    key: "calling_window_end", section: "Calling & campaigns",
    prompt: "Latest time of day calls may be placed (HH:MM)?",
    type: "text", recommendedDefault: "18:00", required: false,
    whyAsked: "Calls outside business hours damage trust (and may breach rules).",
  });

  const mode = String(answers["calling_mode"] ?? "");
  if (mode === "scheduled" || mode === "both") {
    add({
      key: "campaign_name", section: "Calling & campaigns",
      prompt: "Name for the calling campaign (it will be created PAUSED — you start it when ready)?",
      type: "text", recommendedDefault: `${detected.agentName} campaign`, required: false,
      whyAsked: "Scheduled calling runs through a campaign; it is always created paused.",
    });
  }

  // ── 10. Follow-up rules ──
  if (detected.followUpRulesCount === 0) {
    add({
      key: "follow_up_positive", section: "Follow-ups",
      prompt: "After a POSITIVE call, send a follow-up message?",
      type: "choice",
      options: [
        { value: "none",     label: "No follow-up" },
        { value: "email",    label: "Email follow-up" },
        { value: "whatsapp", label: "WhatsApp follow-up" },
      ],
      recommendedDefault: "email", required: false,
      whyAsked: "No follow-up rules configured — positive leads go cold fast.",
    });
  }

  // Drop questions already answered (they stay answered; UI shows them separately)
  return qs;
}

// Validate a proposed answers patch against the question catalog: unknown keys
// rejected, choice values must be one of the options, numbers clamped sane.
export function validateAnswersPatch(
  questions: RequirementQuestion[],
  patch: Record<string, unknown>,
): RequirementAnswers {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const out: RequirementAnswers = {};
  for (const [key, raw] of Object.entries(patch)) {
    const q = byKey.get(key);
    if (!q) throw new Error(`Unknown question key: "${key}"`);
    if (q.type === "boolean") {
      if (typeof raw !== "boolean") throw new Error(`Answer for "${key}" must be true/false.`);
      out[key] = raw;
    } else if (q.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error(`Answer for "${key}" must be a sensible number.`);
      out[key] = n;
    } else if (q.type === "choice") {
      const v = String(raw);
      if (!q.options?.some((o) => o.value === v)) throw new Error(`Answer for "${key}" is not one of the allowed options.`);
      out[key] = v;
    } else {
      const v = String(raw).slice(0, 2000);
      if (!v.trim()) throw new Error(`Answer for "${key}" cannot be empty.`);
      out[key] = v.trim();
    }
  }
  return out;
}
