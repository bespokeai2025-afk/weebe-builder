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

// Standard Operating Procedure order — every agent setup walks these sections
// top-to-bottom (spec: purpose → source access → data fields → functions →
// post-call → page filters → documents → follow-ups → sentiment outcomes).
export function buildRequirementsQuestions(
  detected: DetectedAgentSetup,
  answers: RequirementAnswers = {},
): RequirementQuestion[] {
  const qs: RequirementQuestion[] = [];
  const add = (q: RequirementQuestion) => { qs.push(q); };

  // ── SOP §1. Agent purpose ──
  add({
    key: "agent_purpose", section: "1. Agent purpose",
    prompt: `SystemMind detected this agent's purpose as: "${detected.detectedPurpose}". Confirm or describe in your own words what this agent is for.`,
    type: "text", recommendedDefault: detected.detectedPurpose, required: true,
    whyAsked: "Every setup starts by agreeing the agent's purpose — everything below flows from it.",
  });

  // ── SOP §2. Data source & access key ──
  add({
    key: "data_source_kind", section: "2. Data source & access",
    prompt: "Where will this agent get the people it calls (or responds to)? Access to this source is required before the agent can run.",
    type: "choice",
    options: [
      { value: "crm",         label: "CRM system (leads pulled from your CRM)" },
      { value: "webform",     label: "Webform (leads submitted via a web form)" },
      { value: "csv_upload",  label: "WEBEE CSV uploader (lists uploaded to the platform)" },
      { value: "call_source", label: "Call source only (inbound calls / dialer feed)" },
    ],
    recommendedDefault: detected.crmMode ? "crm" : "csv_upload", required: true,
    whyAsked: "The agent cannot be configured without knowing its data source — and which access key it needs.",
  });
  const srcKind = String(answers["data_source_kind"] ?? "");
  if (srcKind === "crm" || srcKind === "call_source") {
    add({
      key: "data_source_key_name", section: "2. Data source & access",
      prompt: srcKind === "crm"
        ? "REQUIRED KEY: what is the CRM access key called (e.g. \"HubSpot API key\")? Enter the key NAME only — you'll add the actual value securely in Settings → Integrations, never here."
        : "REQUIRED KEY: what is the call-source access key called (e.g. \"Twilio Auth Token\")? Enter the key NAME only — the value is added securely in Settings, never here.",
      type: "text",
      recommendedDefault: srcKind === "crm" ? "CRM API key" : "Call source API key",
      required: true,
      whyAsked: "This source needs an access key. It will appear as a required-key box on the generated config until provided.",
    });
  }

  // ── SOP §3. Data fields / variables to pull when calling ──
  const knownVars = detected.variables.map((v) => v.name).slice(0, 12).join(", ");
  add({
    key: "fields_to_pull", section: "3. Data fields to pull",
    prompt: `Which fields should the agent pull data points/variables from when calling (comma-separated)? ${knownVars ? `Variables already in the script: ${knownVars}.` : "e.g. name, phone, company, budget."}`,
    type: "text",
    recommendedDefault: knownVars || "name, phone",
    required: true,
    whyAsked: "The agent must know exactly which source fields feed its call variables — from the CRM, webform or CSV columns.",
  });

  // ── SOP §4. Agent functions — when & how often to call, concurrency ──
  add({
    key: "calling_mode", section: "4. Agent functions & calling",
    prompt: "When should this agent call people once live?",
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
    key: "max_attempts_per_lead", section: "4. Agent functions & calling",
    prompt: "How often should a user be called — maximum call attempts per lead before giving up?",
    type: "number", recommendedDefault: 3, required: false,
    whyAsked: "Protects your leads from over-calling; 3 matches the platform daily cap.",
  });
  add({
    key: "max_calls_per_day", section: "4. Agent functions & calling",
    prompt: "Maximum total calls per day for this agent?",
    type: "number", recommendedDefault: 50, required: false,
    whyAsked: "A hard daily budget prevents runaway outbound volume.",
  });
  add({
    key: "concurrent_calls", section: "4. Agent functions & calling",
    prompt: "How many concurrent calls should this agent be set up with (calls running at the same time)?",
    type: "number", recommendedDefault: 1, required: false,
    whyAsked: "Concurrency controls call throughput and provider cost — 1 is the safe default.",
  });
  add({
    key: "calling_window_start", section: "4. Agent functions & calling",
    prompt: "Earliest time of day calls may start (HH:MM)?",
    type: "text", recommendedDefault: "09:00", required: false,
    whyAsked: "Calls outside business hours damage trust (and may breach rules).",
  });
  add({
    key: "calling_window_end", section: "4. Agent functions & calling",
    prompt: "Latest time of day calls may be placed (HH:MM)?",
    type: "text", recommendedDefault: "18:00", required: false,
    whyAsked: "Calls outside business hours damage trust (and may breach rules).",
  });
  const mode = String(answers["calling_mode"] ?? "");
  if (mode === "scheduled" || mode === "both") {
    add({
      key: "campaign_name", section: "4. Agent functions & calling",
      prompt: "Name for the calling campaign (it will be created PAUSED — you start it when ready)?",
      type: "text", recommendedDefault: `${detected.agentName} campaign`, required: false,
      whyAsked: "Scheduled calling runs through a campaign; it is always created paused.",
    });
  }
  add({
    key: "no_answer_retry_hours", section: "4. Agent functions & calling",
    prompt: "If a call is not answered, retry after how many hours?",
    type: "number", recommendedDefault: 24, required: false,
    whyAsked: "Every calling agent needs a no-answer rule; nothing is configured yet.",
  });
  add({
    key: "voicemail_behavior", section: "4. Agent functions & calling",
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
  if (detected.hasCallbackLogic) {
    add({
      key: "callback_delay_hours", section: "4. Agent functions & calling",
      prompt: "When a lead asks for a callback but no specific time is agreed, call back after how many hours?",
      type: "number", recommendedDefault: 24, required: false,
      whyAsked: "Callback handling detected in the script, but no default callback delay is configured.",
    });
  }
  if (!detected.hasOptOutLogic) {
    add({
      key: "add_opt_out_handling", section: "4. Agent functions & calling",
      prompt: "The script has no opt-out handling (e.g. \"remove me from your list\"). Add it? (A script addition will be drafted for your approval — nothing changes without it.)",
      type: "boolean", recommendedDefault: true, required: false,
      whyAsked: "No opt-out / do-not-call handling was detected — this is a compliance gap.",
    });
  }

  // ── SOP §5. Post-call — data to extract, destination, custom features ──
  if (!detected.hasSummaryField) {
    add({
      key: "capture_call_summary", section: "5. Post-call data & destination",
      prompt: "After the call, save a short call summary?",
      type: "boolean", recommendedDefault: true, required: false,
      whyAsked: "No call-summary extraction field exists yet.",
    });
  }
  if (!detected.hasNegativeReason) {
    add({
      key: "capture_negative_reason", section: "5. Post-call data & destination",
      prompt: "When someone says no, should the agent capture WHY (a negative_reason field)? A script addition will be drafted for your approval.",
      type: "boolean", recommendedDefault: true, required: false,
      whyAsked: "No negative-reason capture detected — you'd lose the most valuable objection data.",
    });
  }
  add({
    key: "extra_extraction_fields", section: "5. Post-call data & destination",
    prompt: "Any OTHER data points to extract from each call (comma-separated, e.g. budget, timeline, decision_maker)? Leave the default if none.",
    type: "text", recommendedDefault: "none", required: false,
    whyAsked: "Custom extraction fields are defined up-front so the agent captures them from day one.",
  });
  add({
    key: "data_destination", section: "5. Post-call data & destination",
    prompt: "Where should the extracted data points go after the call?",
    type: "choice",
    options: [
      { value: "crm",       label: "CRM system" },
      { value: "dashboard", label: "WEBEE dashboard only" },
      { value: "both",      label: "Both CRM and dashboard" },
    ],
    recommendedDefault: detected.hasCrmFieldMapping ? "both" : "dashboard", required: true,
    whyAsked: "Every data point needs a destination — CRM, the dashboard, or both.",
  });
  add({
    key: "custom_agent_features", section: "5. Post-call data & destination",
    prompt: "Any custom agent features you require (describe in plain language, or leave the default)?",
    type: "text", recommendedDefault: "none", required: false,
    whyAsked: "Custom requirements are recorded now so they are designed in, not bolted on.",
  });
  for (const v of detected.variables.filter((x) => !x.mappedTo).slice(0, 10)) {
    add({
      key: `map_variable_${v.name}`, section: "5. Post-call data & destination",
      prompt: `The agent uses the variable "{{${v.name}}}" (${v.source.replace("_", " ")}) but it isn't mapped to a CRM field. Where should it be saved?`,
      type: "text", recommendedDefault: `meta.${v.name}`, required: false,
      whyAsked: "Unmapped variables are captured on the call but never reach your CRM.",
    });
  }

  // ── SOP §6. Page filters ──
  add({
    key: "want_page_filters", section: "6. Page filters",
    prompt: "Should SystemMind draft saved filters for your pages (Leads, Qualified, Calls, Records, People, Calendar) based on this agent's calls?",
    type: "boolean", recommendedDefault: true, required: false,
    whyAsked: "Saved filters keep each page focused on this agent's results from day one.",
  });
  if (answers["want_page_filters"] === true) {
    const pageDefs: Array<{ key: string; label: string; def: string }> = [
      { key: "page_filter_leads",     label: "LEADS page",     def: "Leads created or called by this agent" },
      { key: "page_filter_qualified", label: "QUALIFIED page", def: "Leads this agent marked interested or qualified" },
      { key: "page_filter_calls",     label: "CALLS page",     def: "Calls made by this agent" },
      { key: "page_filter_records",   label: "RECORDS page",   def: "none" },
      { key: "page_filter_people",    label: "PEOPLE page",    def: "Contacts this agent has spoken to" },
      { key: "page_filter_calendar",  label: "CALENDAR page",  def: detected.hasBookingLogic ? "Appointments booked by this agent" : "none" },
    ];
    for (const pd of pageDefs) {
      add({
        key: pd.key, section: "6. Page filters",
        prompt: `${pd.label}: describe the filter this page should have for this agent (or "none").`,
        type: "text", recommendedDefault: pd.def, required: false,
        whyAsked: "Each page can carry its own saved filter — you decide what each one shows.",
      });
    }
  }

  // ── SOP §7. Documents from Template Studio ──
  add({
    key: "auto_populate_documents", section: "7. Documents (Template Studio)",
    prompt: "Should documents auto-populate from the Template Studio after calls (e.g. a call report or booking confirmation)?",
    type: "boolean", recommendedDefault: false, required: false,
    whyAsked: "Document automation is optional — only set it up if you need it.",
  });
  if (answers["auto_populate_documents"] === true) {
    add({
      key: "document_template_name", section: "7. Documents (Template Studio)",
      prompt: "Which Template Studio template should be auto-populated (template name)?",
      type: "text", recommendedDefault: "Call report", required: false,
      whyAsked: "The template must exist in Template Studio for auto-population to work.",
    });
  }

  // ── SOP §8. Follow-ups per sentiment (email / SMS / WhatsApp) ──
  const FOLLOW_UP_OPTIONS = [
    { value: "none",     label: "No follow-up" },
    { value: "email",    label: "Email" },
    { value: "sms",      label: "SMS" },
    { value: "whatsapp", label: "WhatsApp" },
  ];
  add({
    key: "follow_up_positive", section: "8. Follow-ups",
    prompt: "After a POSITIVE call, send a follow-up via which channel?",
    type: "choice", options: FOLLOW_UP_OPTIONS,
    recommendedDefault: "email", required: false,
    whyAsked: "Positive leads go cold fast without a follow-up.",
  });
  add({
    key: "follow_up_neutral", section: "8. Follow-ups",
    prompt: "After a NEUTRAL call, send a follow-up via which channel?",
    type: "choice", options: FOLLOW_UP_OPTIONS,
    recommendedDefault: "none", required: false,
    whyAsked: "A light-touch nudge can convert undecided leads.",
  });
  add({
    key: "follow_up_negative", section: "8. Follow-ups",
    prompt: "After a NEGATIVE call, send a follow-up via which channel?",
    type: "choice", options: FOLLOW_UP_OPTIONS,
    recommendedDefault: "none", required: false,
    whyAsked: "Usually none — but some businesses send a polite thank-you.",
  });

  // ── SOP §9. Sentiment outcomes → CRM statuses ──
  add({
    key: "outcome_positive_status", section: "9. Sentiment outcomes",
    prompt: "When a call ends with a POSITIVE outcome, what should the lead's CRM status become?",
    type: "choice", options: STATUS_OPTIONS, recommendedDefault: "interested", required: true,
    whyAsked: "No CRM outcome mapping exists for this agent yet.",
  });
  add({
    key: "outcome_neutral_status", section: "9. Sentiment outcomes",
    prompt: "When a call is NEUTRAL (spoke, but no clear yes/no), what CRM status should be set?",
    type: "choice", options: STATUS_OPTIONS, recommendedDefault: "contact_made", required: true,
    whyAsked: "No CRM outcome mapping exists for this agent yet.",
  });
  add({
    key: "neutral_callback_hours", section: "9. Sentiment outcomes",
    prompt: "For NEUTRAL outcomes, schedule a follow-up callback after how many hours?",
    type: "number", recommendedDefault: 48, required: false,
    whyAsked: "Neutral leads are usually worth one more attempt — 48h is the platform default.",
  });
  add({
    key: "outcome_negative_status", section: "9. Sentiment outcomes",
    prompt: "When a call ends NEGATIVE (not interested), what CRM status should be set?",
    type: "choice", options: STATUS_OPTIONS, recommendedDefault: "not_interested", required: true,
    whyAsked: "No CRM outcome mapping exists for this agent yet.",
  });
  if (detected.hasBookingLogic) {
    add({
      key: "outcome_booked_status", section: "9. Sentiment outcomes",
      prompt: "This agent books appointments. When a booking is made, what CRM status should the lead get?",
      type: "choice", options: STATUS_OPTIONS, recommendedDefault: "qualified", required: true,
      whyAsked: "Booking logic detected in the agent script/flow, but no booked-outcome CRM rule exists.",
    });
    add({
      key: "booked_create_task", section: "9. Sentiment outcomes",
      prompt: "When a booking is made, should an ops task be created so your team sees it?",
      type: "boolean", options: YES_NO, recommendedDefault: true, required: false,
      whyAsked: "Booked appointments usually need a human confirmation step.",
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
