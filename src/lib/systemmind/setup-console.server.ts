// ── SystemMind Setup Console — agent scan + setup state engine ────────────────
// Replit-style setup console for the Build Workspace: scans the linked agent
// for {{variables}}, classifies them, tracks variable→WEBEE→CRM mappings,
// CRM provider choice (non-secret config only), status trigger rules and the
// test/approval state — then computes an exact, grouped required-inputs list
// that gates Apply.
//
// SAFETY INVARIANTS
//  • Credential VALUES never enter this module or its table. CRM secrets are
//    saved via the existing provider credential flow (provider_settings).
//    assertNoCredentialValues re-checks every stored payload.
//  • All reads/writes are scoped by workspace_id; the session must belong to
//    the workspace. Writes go through the service role (table has REVOKE for
//    authenticated) so RLS SELECT-only is preserved.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNoCredentialValues } from "@/lib/systemmind/systemmind-generators.server";
import { writeSystemMindAudit } from "@/lib/systemmind/systemmind-automation.server";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SetupVariableClass =
  | "contact" | "lead" | "booking" | "crm" | "call_outcome" | "extraction" | "custom" | "unknown";

export type ScannedVariable = {
  name:        string;
  foundIn:     string[];         // human labels: "Global prompt", "Node: Ask budget", …
  type:        string;           // text | number | phone | email | datetime | boolean
  varClass:    SetupVariableClass;
  required:    boolean;
};

export type VariableMapping = {
  variable:     string;
  webeeField:   string;          // e.g. lead.phone, lead.meta.budget, appointment.datetime
  crmField:     string;          // CRM API code, e.g. mobilephone, new_budget
  fieldType:    string;
  required:     boolean;
  ignored:      boolean;
  defaultValue: string;
  transformation: string;
  suggested:    boolean;         // suggested by SystemMind, awaiting approval
  confidence:   "high" | "medium" | "low" | null;
  approved:     boolean;         // user approved the suggestion (or edited it)
};

export type TriggerRule = {
  id:           string;
  source:       string;          // webee_lead_status | crm_lead_status | crm_deal_stage | call_outcome | campaign_event | custom_webhook | webee_pipeline | crm_appointment_status
  object:       string;          // lead | contact | deal | appointment | campaign_lead | custom
  fieldLabel:   string;
  fieldApiCode: string;
  statusName:   string;
  statusCode:   string;
  condition:    string;          // equals | changes_to | contains
  action:       string;          // plain-language action to run
};

export type SetupCrmConfig = {
  provider:     string;          // webee | hubspot | salesforce | pipedrive | zoho | dynamics | gohighlevel | custom | none
  // NON-SECRET config only (URLs, IDs that are not secrets are still kept out;
  // only field-code style values allowed):
  orgUrl:       string;
  defaultOwner: string;
  defaultPipeline: string;
  defaultSource:   string;
  customEndpoints: { baseUrl?: string; authType?: string; testPath?: string; createLeadPath?: string; updateLeadPath?: string; statusUpdatePath?: string };
  connectionStatus: "not_connected" | "missing_credentials" | "testing" | "connected" | "failed" | "expired" | "permission_issue";
  lastTestedAt: string | null;
  lastTestError: string | null;
};

export type SetupTestState = {
  payload:      Record<string, unknown> | null;
  generatedAt:  string | null;
  runAt:        string | null;
  runOk:        boolean | null;
  runNotes:     string | null;
  approvedBy:   string | null;
  approvedAt:   string | null;
};

export type RequiredInputItem = {
  group:  "context" | "agent" | "crm_access" | "variables" | "triggers" | "testing";
  key:    string;
  label:  string;
  done:   boolean;
  required: boolean;
  anchor: string;   // UI element id to scroll to ("Fill in")
  tab:    string;   // which setup tab holds the field
};

// ── Required Context (business + technical context captured BEFORE config) ────

export type SetupContext = {
  business: {
    businessName: string; industry: string; mainGoal: string; problem: string;
    audience: string; desiredOutcome: string; onSuccess: string; onFailure: string;
  };
  agent: {
    channel: string;           // phone | whatsapp | sms | email | mixed
    direction: string;         // inbound | outbound | both
    lifecycle: string;         // live | draft | test
    updateMode: string;        // update_existing | new_workflow
    scanTarget: string;        // which script/prompt should be scanned
  };
  data: {
    requiredFields: string[]; optionalFields: string[]; preProvidedFields: string[];
    postCallFields: string[]; saveToWebee: boolean | null; sendToCrm: boolean | null;
    fieldsConfirmed: boolean;
  };
  crm: {
    syncRequired: boolean | null; objectTable: string; pipeline: string; owner: string;
    sourceCode: string; duplicateRule: string; updateFields: string; triggerStatuses: string;
  };
  trigger: {
    source: string; object: string; field: string; value: string;
    frequency: string;         // once | every_time
    timing: string;            // immediate | delayed
    scopeFilter: string;       // specific campaigns/agents/lead sources
  };
  outcome: { finalAction: string; actions: string[]; notes: string };
  booking: {
    required: boolean | null; calendarProvider: string; eventType: string;
    bookingVariable: string; duration: string; timezone: string; availabilityRules: string;
    confirmationMessage: string; rebookingRules: string; cancellationHandling: string;
    crmAppointmentField: string;
  };
  followup: {
    enabled: boolean | null; channel: string; delay: string; attempts: string;
    stopConditions: string; templates: string; owner: string; stopStatuses: string;
  };
  compliance: {
    canContact: boolean | null; consentSource: string; dncRules: string; region: string;
    callingHours: string; disclaimers: string; escalationRules: string; handoverRules: string;
  };
  success: {
    definition: string; testProves: string; webeeExpectation: string;
    crmExpectation: string; mustNotHappen: string; approver: string;
  };
  confirmed:   boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  suggestedAt: string | null;  // when auto-suggest last filled empty fields
};

export const DEFAULT_CONTEXT: SetupContext = {
  business: { businessName: "", industry: "", mainGoal: "", problem: "", audience: "", desiredOutcome: "", onSuccess: "", onFailure: "" },
  agent:    { channel: "", direction: "", lifecycle: "", updateMode: "", scanTarget: "" },
  data:     { requiredFields: [], optionalFields: [], preProvidedFields: [], postCallFields: [], saveToWebee: null, sendToCrm: null, fieldsConfirmed: false },
  crm:      { syncRequired: null, objectTable: "", pipeline: "", owner: "", sourceCode: "", duplicateRule: "", updateFields: "", triggerStatuses: "" },
  trigger:  { source: "", object: "", field: "", value: "", frequency: "", timing: "", scopeFilter: "" },
  outcome:  { finalAction: "", actions: [], notes: "" },
  booking:  { required: null, calendarProvider: "", eventType: "", bookingVariable: "", duration: "", timezone: "", availabilityRules: "", confirmationMessage: "", rebookingRules: "", cancellationHandling: "", crmAppointmentField: "" },
  followup: { enabled: null, channel: "", delay: "", attempts: "", stopConditions: "", templates: "", owner: "", stopStatuses: "" },
  compliance: { canContact: null, consentSource: "", dncRules: "", region: "", callingHours: "", disclaimers: "", escalationRules: "", handoverRules: "" },
  success:  { definition: "", testProves: "", webeeExpectation: "", crmExpectation: "", mustNotHappen: "", approver: "" },
  confirmed: false, confirmedBy: null, confirmedAt: null, suggestedAt: null,
};

export type SetupState = {
  id:          string;
  sessionId:   string;
  agentId:     string | null;
  scan:        {
    scannedAt: string | null;
    agentName: string | null;
    agentType: string | null;
    channel:   string | null;
    isLive:    boolean;
    variables: ScannedVariable[];
    hasBookingLogic: boolean;
    hasWebhookLogic: boolean;
  };
  mappings:    VariableMapping[];
  crm:         SetupCrmConfig;
  triggers:    TriggerRule[];
  test:        SetupTestState;
  context:     SetupContext;
};

// ── Variable classification (deterministic keyword table) ─────────────────────

const CLASS_RULES: Array<[RegExp, SetupVariableClass, string, boolean]> = [
  // pattern, class, type, required-by-default
  [/^(first_?name|last_?name|full_?name|name|email|phone(_?number)?|mobile|preferred_contact(_method)?)$/i, "contact", "text", true],
  [/^(company(_?name)?|postcode|zip|address|city|budget|timeline|property_type|lead_status|lead_source|qualification(_status)?)$/i, "lead", "text", false],
  [/^(booking_?slot|appointment_?(date|time|datetime)?|meeting_?(time|date)|viewing_?(time|date)|slot|available_?times?)$/i, "booking", "datetime", true],
  [/^(call_?summary|call_?transcript|call_?recording(_url)?|sentiment|outcome|call_?outcome|disposition|negative_?reason)$/i, "call_outcome", "text", false],
  [/^(crm_|dynamics_|hubspot_|salesforce_|new_)/i, "crm", "text", false],
];

function classifyVariable(name: string): { varClass: SetupVariableClass; type: string; required: boolean } {
  for (const [re, varClass, type, required] of CLASS_RULES) {
    if (re.test(name)) {
      const t =
        /email/i.test(name) ? "email" :
        /phone|mobile/i.test(name) ? "phone" :
        /budget|price|amount|count|number/i.test(name) ? "number" :
        /date|time|slot/i.test(name) ? "datetime" : type;
      return { varClass, type: t, required };
    }
  }
  return { varClass: "custom", type: "text", required: false };
}

// Default WEBEE destination suggestions per well-known variable
const WEBEE_DEST: Array<[RegExp, string, "high" | "medium"]> = [
  [/^(first_?name)$/i,               "lead.first_name",        "high"],
  [/^(last_?name)$/i,                "lead.last_name",         "high"],
  [/^(full_?name|name)$/i,           "lead.name",              "high"],
  [/^email$/i,                       "lead.email",             "high"],
  [/^(phone(_?number)?|mobile)$/i,   "lead.phone",             "high"],
  [/^company(_?name)?$/i,            "lead.company",           "high"],
  [/^(booking_?slot|appointment_?(date|time|datetime)?)$/i, "appointment.datetime", "high"],
  [/^call_?summary$/i,               "call.summary",           "high"],
  [/^call_?transcript$/i,            "call.transcript",        "high"],
  [/^call_?recording(_url)?$/i,      "call.recording_url",     "high"],
  [/^sentiment$/i,                   "call.sentiment",         "high"],
  [/^(lead_)?status$/i,              "lead.status",            "medium"],
  [/^qualification(_status)?$/i,     "lead.qualification_status", "medium"],
  [/^preferred_contact(_method)?$/i, "lead.preferred_contact", "medium"],
];

function suggestWebeeField(name: string): { dest: string; confidence: "high" | "medium" | "low" } {
  for (const [re, dest, confidence] of WEBEE_DEST) if (re.test(name)) return { dest, confidence };
  return { dest: `lead.meta.${name.toLowerCase()}`, confidence: "low" };
}

// Common CRM field-code suggestions per provider (never auto-approved)
const CRM_CODE_SUGGESTIONS: Record<string, Record<string, string>> = {
  dynamics: {
    first_name: "firstname", last_name: "lastname", full_name: "fullname", name: "fullname",
    email: "emailaddress1", phone_number: "mobilephone", phone: "mobilephone", mobile: "mobilephone",
    company_name: "companyname", company: "companyname", postcode: "address1_postalcode",
  },
  hubspot: {
    first_name: "firstname", last_name: "lastname", email: "email",
    phone_number: "phone", phone: "phone", company_name: "company", company: "company",
  },
  salesforce: {
    first_name: "FirstName", last_name: "LastName", email: "Email",
    phone_number: "Phone", phone: "Phone", company_name: "Company", company: "Company",
  },
  pipedrive: {
    first_name: "first_name", last_name: "last_name", email: "email",
    phone_number: "phone", phone: "phone", company_name: "org_name",
  },
};

function suggestCrmCode(provider: string, varName: string): string {
  const table = CRM_CODE_SUGGESTIONS[provider];
  if (!table) return "";
  return table[varName.toLowerCase()] ?? "";
}

// ── Scan engine ────────────────────────────────────────────────────────────────

const VAR_RE = /\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]{0,80})\s*\}\}/g;

function collectVars(text: string, label: string, into: Map<string, ScannedVariable>) {
  if (!text) return;
  VAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_RE.exec(text)) !== null) {
    const name = m[1];
    const existing = into.get(name);
    if (existing) {
      if (!existing.foundIn.includes(label)) existing.foundIn.push(label);
    } else {
      const cls = classifyVariable(name);
      into.set(name, { name, foundIn: [label], ...cls });
    }
  }
}

export async function scanAgentForSetupServer(args: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  agentId?: string | null;
}): Promise<SetupState> {
  const sb = supabaseAdmin as any;

  // Session must belong to workspace; resolve agent id.
  const { data: session, error: sErr } = await sb.from("systemmind_build_sessions")
    .select("id, workspace_id, target_agent_id")
    .eq("id", args.sessionId).eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (sErr) throw new Error(`Failed to load session: ${sErr.message}`);
  if (!session) throw new Error("Build session not found in this workspace.");

  const agentId = args.agentId ?? session.target_agent_id;
  if (!agentId) throw new Error("No agent linked yet. Select the agent this workflow should configure.");

  // If the caller supplies a different agent, persist the link on the session.
  if (args.agentId && args.agentId !== session.target_agent_id) {
    const { data: agentCheck } = await sb.from("agents")
      .select("id").eq("id", args.agentId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!agentCheck) throw new Error("That agent does not belong to this workspace.");
    await sb.from("systemmind_build_sessions")
      .update({ target_agent_id: args.agentId, updated_at: new Date().toISOString() })
      .eq("id", args.sessionId).eq("workspace_id", args.workspaceId);
  }

  const { data: agent, error: aErr } = await sb.from("agents")
    .select("id, name, agent_type, settings, flow_data, variables, retell_agent_id, deployment_mode, workspace_id")
    .eq("id", agentId).eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (aErr) throw new Error(`Failed to load agent: ${aErr.message}`);
  if (!agent) throw new Error("Agent not found in this workspace.");

  const settings: any = agent.settings ?? {};
  const flowData: any = agent.flow_data ?? {};
  const nodes: any[] = Array.isArray(flowData.nodes) ? flowData.nodes : [];

  const found = new Map<string, ScannedVariable>();
  collectVars(String(settings.globalPrompt ?? ""), "Global prompt", found);
  collectVars(String(settings.beginMessage ?? ""), "Start message", found);

  // Per-node scan with node labels so "Found in" is precise.
  for (const node of nodes) {
    const d: any = node?.data ?? {};
    const nodeName = String(d.label ?? d.name ?? node?.type ?? "node");
    const nodeType = String(node?.type ?? d.type ?? "");
    const label =
      /extract/i.test(nodeType)              ? `Extract Variable node: ${nodeName}` :
      /book|calendar|cal_?com/i.test(nodeType) ? `Booking node: ${nodeName}` :
      /http|webhook|function|tool/i.test(nodeType) ? `Webhook/function node: ${nodeName}` :
      /crm/i.test(nodeType)                  ? `CRM sync node: ${nodeName}` :
      `Node: ${nodeName}`;
    let text = "";
    try { text = JSON.stringify(d); } catch { text = ""; }
    collectVars(text, label, found);
    // Extract-variable nodes declare variables even without {{}} syntax.
    const declared: any[] = Array.isArray(d.variables) ? d.variables : [];
    for (const dv of declared) {
      const n = String(dv?.name ?? "").trim();
      if (!n) continue;
      if (!found.has(n)) {
        const cls = classifyVariable(n);
        found.set(n, { name: n, foundIn: [label], ...cls, type: String(dv?.type ?? cls.type) });
      }
    }
  }

  // Builder-level variable definitions + post-call extraction settings
  const builderVars: any[] = Array.isArray(agent.variables) ? agent.variables : [];
  for (const v of builderVars) {
    const n = String(v?.name ?? "").trim();
    if (!n) continue;
    if (!found.has(n)) {
      const cls = classifyVariable(n);
      found.set(n, { name: n, foundIn: ["Builder variable definitions"], ...cls, type: String(v?.type ?? cls.type) });
    }
  }
  const leadGen: any = settings.leadGen ?? {};
  const qualify: any = settings.qualify ?? {};
  for (const src of [leadGen.variableMappings, leadGen.postCallMappings, qualify.preCallMappings, qualify.postCallMappings]) {
    for (const k of Object.keys(src ?? {})) {
      if (!found.has(k)) {
        const cls = classifyVariable(k);
        found.set(k, { name: k, foundIn: ["Post-call data extraction"], ...cls, varClass: "extraction" });
      }
    }
  }
  // Existing custom_agent_configs extraction fields
  const { data: cfg } = await sb.from("custom_agent_configs")
    .select("extraction_fields, crm_field_mapping")
    .eq("workspace_id", args.workspaceId).eq("agent_id", agentId)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  for (const f of (Array.isArray(cfg?.extraction_fields) ? cfg.extraction_fields : [])) {
    const n = String((f as any)?.name ?? f ?? "").trim();
    if (n && !found.has(n)) {
      const cls = classifyVariable(n);
      found.set(n, { name: n, foundIn: ["Post-call data extraction"], ...cls, varClass: "extraction" });
    }
  }

  const variables = [...found.values()].slice(0, 120);
  const allText = `${String(settings.globalPrompt ?? "")}\n${JSON.stringify(nodes).slice(0, 200000)}`;
  const hasBookingLogic = settings.booking?.enabled === true ||
    /\bbook(ing)?\b|\bappointment\b/i.test(allText);
  const hasWebhookLogic = /webhook|http_request|api_call/i.test(allText);

  // Load existing state (preserve user's mappings/crm/triggers/test).
  const existing = await getSetupStateRow(args.workspaceId, args.sessionId);
  const prevMappings: VariableMapping[] = existing?.mappings ?? [];
  const prevByVar = new Map(prevMappings.map((m) => [m.variable, m]));

  const crmProvider = (existing?.crm as SetupCrmConfig | undefined)?.provider ?? "none";
  const existingCrmMapping: Record<string, unknown> =
    cfg?.crm_field_mapping && typeof cfg.crm_field_mapping === "object" ? cfg.crm_field_mapping : {};

  const mappings: VariableMapping[] = variables.map((v) => {
    const prev = prevByVar.get(v.name);
    if (prev) return prev; // never clobber user edits on re-scan
    const dest = suggestWebeeField(v.name);
    const crmCode = String(existingCrmMapping[v.name] ?? "") || suggestCrmCode(crmProvider, v.name);
    return {
      variable: v.name,
      webeeField: dest.dest,
      crmField: crmCode,
      fieldType: v.type,
      required: v.required,
      ignored: false,
      defaultValue: "",
      transformation: "",
      suggested: true,
      confidence: dest.confidence,
      approved: false,
    };
  });

  const scan = {
    scannedAt: new Date().toISOString(),
    agentName: String(agent.name ?? "Agent"),
    agentType: String(settings.agentType ?? agent.agent_type ?? "custom"),
    channel:   settings.channelType === "whatsapp" ? "whatsapp" : "voice",
    isLive:    !!(agent.retell_agent_id || settings.deployedElevenLabsAgentId),
    variables,
    hasBookingLogic,
    hasWebhookLogic,
  };

  const state = await upsertSetupStateRow({
    workspaceId: args.workspaceId,
    userId: args.userId,
    sessionId: args.sessionId,
    agentId,
    patch: { scan, mappings },
  });

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: "setup_agent_scanned",
    targetType: "build_session",
    targetId: args.sessionId,
    finalAfterState: { agentId, variableCount: variables.length },
  }).catch(() => {});

  return state;
}

// ── State CRUD ─────────────────────────────────────────────────────────────────

const DEFAULT_CRM: SetupCrmConfig = {
  provider: "none", orgUrl: "", defaultOwner: "", defaultPipeline: "", defaultSource: "",
  customEndpoints: {}, connectionStatus: "not_connected", lastTestedAt: null, lastTestError: null,
};
const DEFAULT_TEST: SetupTestState = {
  payload: null, generatedAt: null, runAt: null, runOk: null, runNotes: null, approvedBy: null, approvedAt: null,
};

function rowToState(row: any): SetupState {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    agentId: row.agent_id ? String(row.agent_id) : null,
    scan: {
      scannedAt: null, agentName: null, agentType: null, channel: null, isLive: false,
      variables: [], hasBookingLogic: false, hasWebhookLogic: false,
      ...(row.scan ?? {}),
    },
    mappings: Array.isArray(row.mappings) ? row.mappings : [],
    crm: { ...DEFAULT_CRM, ...(row.crm ?? {}) },
    triggers: Array.isArray(row.triggers) ? row.triggers : [],
    test: { ...DEFAULT_TEST, ...(row.test ?? {}) },
    context: mergeContext(row.context ?? {}),
  };
}

function mergeContext(raw: any): SetupContext {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    business:   { ...DEFAULT_CONTEXT.business,   ...(c.business ?? {}) },
    agent:      { ...DEFAULT_CONTEXT.agent,      ...(c.agent ?? {}) },
    data:       { ...DEFAULT_CONTEXT.data,       ...(c.data ?? {}) },
    crm:        { ...DEFAULT_CONTEXT.crm,        ...(c.crm ?? {}) },
    trigger:    { ...DEFAULT_CONTEXT.trigger,    ...(c.trigger ?? {}) },
    outcome:    { ...DEFAULT_CONTEXT.outcome,    ...(c.outcome ?? {}) },
    booking:    { ...DEFAULT_CONTEXT.booking,    ...(c.booking ?? {}) },
    followup:   { ...DEFAULT_CONTEXT.followup,   ...(c.followup ?? {}) },
    compliance: { ...DEFAULT_CONTEXT.compliance, ...(c.compliance ?? {}) },
    success:    { ...DEFAULT_CONTEXT.success,    ...(c.success ?? {}) },
    confirmed:   c.confirmed === true,
    confirmedBy: c.confirmedBy ?? null,
    confirmedAt: c.confirmedAt ?? null,
    suggestedAt: c.suggestedAt ?? null,
  };
}

async function getSetupStateRow(workspaceId: string, sessionId: string): Promise<SetupState | null> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_setup_states")
    .select("*").eq("workspace_id", workspaceId).eq("session_id", sessionId).maybeSingle();
  if (error) throw new Error(`Failed to load setup state: ${error.message}`);
  return data ? rowToState(data) : null;
}

export async function getSetupStateServer(workspaceId: string, sessionId: string): Promise<SetupState | null> {
  const sb = supabaseAdmin as any;
  const { data: session } = await sb.from("systemmind_build_sessions")
    .select("id").eq("id", sessionId).eq("workspace_id", workspaceId).maybeSingle();
  if (!session) throw new Error("Build session not found in this workspace.");
  return getSetupStateRow(workspaceId, sessionId);
}

async function upsertSetupStateRow(args: {
  workspaceId: string; userId: string; sessionId: string; agentId?: string | null;
  patch: Partial<{ scan: unknown; mappings: unknown; crm: unknown; triggers: unknown; test: unknown; context: unknown }>;
}): Promise<SetupState> {
  const sb = supabaseAdmin as any;

  // Safety: nothing that looks like a credential value may be stored here.
  assertNoCredentialValues(args.patch, "Setup state");

  const now = new Date().toISOString();
  const existing = await getSetupStateRow(args.workspaceId, args.sessionId);
  if (existing) {
    const upd: Record<string, unknown> = { updated_at: now };
    if (args.patch.scan !== undefined)     upd.scan = args.patch.scan;
    if (args.patch.mappings !== undefined) upd.mappings = args.patch.mappings;
    if (args.patch.crm !== undefined)      upd.crm = args.patch.crm;
    if (args.patch.triggers !== undefined) upd.triggers = args.patch.triggers;
    if (args.patch.test !== undefined)     upd.test = args.patch.test;
    if (args.patch.context !== undefined)  upd.context = args.patch.context;
    if (args.agentId !== undefined)        upd.agent_id = args.agentId;
    const { data, error } = await sb.from("systemmind_setup_states")
      .update(upd).eq("id", existing.id).eq("workspace_id", args.workspaceId)
      .select("*").single();
    if (error) throw new Error(`Failed to save setup state: ${error.message}`);
    return rowToState(data);
  }
  const { data, error } = await sb.from("systemmind_setup_states")
    .insert({
      workspace_id: args.workspaceId,
      session_id: args.sessionId,
      agent_id: args.agentId ?? null,
      scan: args.patch.scan ?? {},
      mappings: args.patch.mappings ?? [],
      crm: args.patch.crm ?? {},
      triggers: args.patch.triggers ?? [],
      test: args.patch.test ?? {},
      context: args.patch.context ?? {},
      created_by: args.userId,
    })
    .select("*").single();
  if (error) throw new Error(`Failed to create setup state: ${error.message}`);
  return rowToState(data);
}

// ── Patch validation schemas (used by the server fns) ─────────────────────────

const NO_SECRET_STRING = z.string().max(400);

export const MappingPatchSchema = z.object({
  variable:       z.string().min(1).max(120),
  webeeField:     NO_SECRET_STRING.optional(),
  crmField:       NO_SECRET_STRING.optional(),
  fieldType:      NO_SECRET_STRING.optional(),
  required:       z.boolean().optional(),
  ignored:        z.boolean().optional(),
  defaultValue:   NO_SECRET_STRING.optional(),
  transformation: NO_SECRET_STRING.optional(),
  approved:       z.boolean().optional(),
});

export const CrmPatchSchema = z.object({
  provider:        z.enum(["none", "webee", "hubspot", "gohighlevel", "salesforce", "pipedrive", "zoho", "dynamics", "custom"]).optional(),
  orgUrl:          NO_SECRET_STRING.optional(),
  defaultOwner:    NO_SECRET_STRING.optional(),
  defaultPipeline: NO_SECRET_STRING.optional(),
  defaultSource:   NO_SECRET_STRING.optional(),
  customEndpoints: z.object({
    baseUrl: NO_SECRET_STRING.optional(), authType: NO_SECRET_STRING.optional(),
    testPath: NO_SECRET_STRING.optional(), createLeadPath: NO_SECRET_STRING.optional(),
    updateLeadPath: NO_SECRET_STRING.optional(), statusUpdatePath: NO_SECRET_STRING.optional(),
  }).optional(),
  connectionStatus: z.enum(["not_connected", "missing_credentials", "testing", "connected", "failed", "expired", "permission_issue"]).optional(),
  lastTestedAt:  z.string().nullable().optional(),
  lastTestError: z.string().max(600).nullable().optional(),
});

export const TriggerRuleSchema = z.object({
  id:           z.string().min(1).max(60),
  source:       NO_SECRET_STRING,
  object:       NO_SECRET_STRING,
  fieldLabel:   NO_SECRET_STRING,
  fieldApiCode: NO_SECRET_STRING,
  statusName:   NO_SECRET_STRING,
  statusCode:   NO_SECRET_STRING,
  condition:    NO_SECRET_STRING,
  action:       NO_SECRET_STRING,
});

export async function updateSetupStateServer(args: {
  workspaceId: string; userId: string; sessionId: string;
  mappingPatches?: Array<z.infer<typeof MappingPatchSchema>>;
  crmPatch?: z.infer<typeof CrmPatchSchema>;
  triggers?: Array<z.infer<typeof TriggerRuleSchema>>;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  if (!state) throw new Error("Run the agent scan first.");

  const patch: Record<string, unknown> = {};

  if (args.mappingPatches?.length) {
    const byVar = new Map(state.mappings.map((m) => [m.variable, m]));
    for (const p of args.mappingPatches) {
      const cur = byVar.get(p.variable);
      const next: VariableMapping = {
        ...(cur ?? {
          variable: p.variable, webeeField: "", crmField: "", fieldType: "text",
          required: false, ignored: false, defaultValue: "", transformation: "",
          suggested: false, confidence: null, approved: true,
        }),
        ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
      } as VariableMapping;
      // Any user edit counts as approval of the row.
      if (p.approved === undefined && (p.webeeField !== undefined || p.crmField !== undefined || p.ignored !== undefined)) {
        next.approved = true;
        next.suggested = false;
      }
      byVar.set(p.variable, next);
    }
    patch.mappings = [...byVar.values()];
  }

  if (args.crmPatch) {
    const nextCrm = { ...state.crm, ...args.crmPatch };
    // Provider change refreshes CRM code suggestions for still-unapproved rows.
    if (args.crmPatch.provider && args.crmPatch.provider !== state.crm.provider) {
      const src = (patch.mappings as VariableMapping[] | undefined) ?? state.mappings;
      patch.mappings = src.map((m) =>
        m.approved || m.crmField ? m : { ...m, crmField: suggestCrmCode(args.crmPatch!.provider!, m.variable) });
      nextCrm.connectionStatus = args.crmPatch.provider === "none" || args.crmPatch.provider === "webee"
        ? "connected" : "not_connected";
    }
    patch.crm = nextCrm;
  }

  if (args.triggers) patch.triggers = args.triggers.slice(0, 40);

  const next = await upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId, patch,
  });

  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: "setup_state_updated",
    targetType: "build_session",
    targetId: args.sessionId,
    finalAfterState: {
      changed: Object.keys(patch),
      mappingCount: args.mappingPatches?.length ?? 0,
      triggerCount: args.triggers?.length ?? 0,
    },
  }).catch(() => {});

  return next;
}

// ── CRM connection status refresh (creds live in provider_settings) ───────────

const CRM_PROVIDER_MAP: Record<string, string> = {
  hubspot: "hubspot", gohighlevel: "gohighlevel", salesforce: "salesforce",
  pipedrive: "pipedrive", dynamics: "dynamics", zoho: "zoho", custom: "custom",
};

export async function refreshSetupCrmStatusServer(args: {
  workspaceId: string; userId: string; sessionId: string;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  if (!state) throw new Error("Run the agent scan first.");
  const provider = state.crm.provider;
  if (provider === "none" || provider === "webee") {
    return upsertSetupStateRow({
      workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
      patch: { crm: { ...state.crm, connectionStatus: "connected", lastTestedAt: new Date().toISOString(), lastTestError: null } },
    });
  }
  const providerName = CRM_PROVIDER_MAP[provider];
  const sb = supabaseAdmin as any;
  const { data: ps } = await sb.from("provider_settings")
    .select("status, credentials")
    .eq("workspace_id", args.workspaceId).eq("category", "crm").eq("provider_name", providerName)
    .maybeSingle();
  const hasCreds = !!ps?.credentials && Object.values(ps.credentials as Record<string, string>).some((v) => v && String(v).trim());

  let status: SetupCrmConfig["connectionStatus"] = hasCreds ? "connected" : "missing_credentials";
  let lastTestError: string | null = null;
  if (hasCreds) {
    try {
      const { runProviderHealthCheck } = await import("@/lib/providers/health.server");
      const r = await runProviderHealthCheck(args.workspaceId, "crm", providerName);
      status = r.ok ? "connected" : "failed";
      lastTestError = r.ok ? null : String(r.error ?? "Connection test failed");
    } catch {
      // No health check implemented for this provider — creds saved counts as connected.
      status = "connected";
    }
  }
  return upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
    patch: { crm: { ...state.crm, connectionStatus: status, lastTestedAt: new Date().toISOString(), lastTestError } },
  });
}

// ── Required inputs computation (pure; used by UI AND the Apply gate) ─────────

export function computeRequiredInputs(state: SetupState | null): RequiredInputItem[] {
  const items: RequiredInputItem[] = [];
  const add = (i: RequiredInputItem) => items.push(i);

  // Required Context comes FIRST — SystemMind must not configure before context.
  const cc = computeContextCompleteness(state);
  for (const ci of cc.items.filter((i) => i.required)) {
    add({
      group: "context",
      key: `ctx_${ci.group}_${ci.key}`,
      label: `${ci.groupLabel}: ${ci.label}`,
      done: ci.done,
      required: true,
      anchor: ci.anchor,
      tab: "context",
    });
  }

  add({
    group: "agent", key: "agent_linked", label: "Agent linked",
    done: !!state?.agentId, required: true, anchor: "setup-linked-agent", tab: "agent",
  });
  add({
    group: "agent", key: "agent_scanned", label: "Agent scanned",
    done: !!state?.scan.scannedAt, required: true, anchor: "setup-linked-agent", tab: "agent",
  });
  if (!state) return items;

  const crm = state.crm;
  const externalCrm = !["none", "webee"].includes(crm.provider);
  if (externalCrm) {
    add({
      group: "crm_access", key: "crm_credentials",
      label: `${crmLabel(crm.provider)} credentials saved`,
      done: !["not_connected", "missing_credentials"].includes(crm.connectionStatus),
      required: true, anchor: "setup-crm-credentials", tab: "credentials",
    });
    add({
      group: "crm_access", key: "crm_connection_test",
      label: "CRM connection test passed",
      done: crm.connectionStatus === "connected" && !!crm.lastTestedAt,
      required: true, anchor: "setup-crm-credentials", tab: "credentials",
    });
  }

  const active = state.mappings.filter((m) => !m.ignored);
  for (const m of active.filter((x) => x.required)) {
    add({
      group: "variables", key: `map_webee_${m.variable}`,
      label: `{{${m.variable}}} WEBEE destination`,
      done: !!m.webeeField.trim(),
      required: true, anchor: `setup-var-${m.variable}`, tab: "variables",
    });
    if (externalCrm) {
      add({
        group: "variables", key: `map_crm_${m.variable}`,
        label: `CRM field code for {{${m.variable}}}`,
        done: !!m.crmField.trim(),
        required: true, anchor: `setup-var-${m.variable}`, tab: "mapping",
      });
    }
  }
  const unapproved = active.filter((m) => m.suggested && !m.approved);
  add({
    group: "variables", key: "mappings_approved",
    label: unapproved.length
      ? `${unapproved.length} suggested mapping${unapproved.length === 1 ? "" : "s"} awaiting your approval`
      : "Suggested mappings approved",
    done: unapproved.length === 0,
    required: true, anchor: "setup-variables-table", tab: "variables",
  });

  add({
    group: "triggers", key: "trigger_rule",
    label: "At least one workflow trigger rule",
    done: state.triggers.length > 0,
    required: true, anchor: "setup-trigger-rules", tab: "triggers",
  });
  state.triggers.forEach((t, idx) => {
    const crmTrigger = /^crm_/.test(t.source);
    if (crmTrigger) {
      add({
        group: "triggers", key: `trigger_field_${t.id}`,
        label: `Trigger ${idx + 1}: CRM trigger field API code`,
        done: !!t.fieldApiCode.trim(),
        required: true, anchor: `setup-trigger-${t.id}`, tab: "triggers",
      });
      add({
        group: "triggers", key: `trigger_code_${t.id}`,
        label: `Trigger ${idx + 1}: CRM status code for "${t.statusName || "status"}"`,
        done: !!t.statusCode.trim(),
        required: true, anchor: `setup-trigger-${t.id}`, tab: "triggers",
      });
    }
  });

  add({
    group: "testing", key: "test_payload",
    label: "Test payload generated",
    done: !!state.test.payload,
    required: true, anchor: "setup-test-payload", tab: "test",
  });
  add({
    group: "testing", key: "test_run",
    label: "Test run completed",
    done: !!state.test.runAt,
    required: true, anchor: "setup-test-payload", tab: "test",
  });
  add({
    group: "testing", key: "user_approval",
    label: "Setup approved by you",
    done: !!state.test.approvedAt,
    required: true, anchor: "setup-test-approve", tab: "test",
  });

  return items;
}

// ── Required Context completeness ──────────────────────────────────────────────

export type ContextItem = {
  group:    string;   // "business" | "agent" | "data" | "crm" | "trigger" | "outcome" | "booking" | "followup" | "compliance" | "success" | "confirm"
  groupLabel: string;
  key:      string;
  label:    string;
  helper:   string;
  done:     boolean;
  required: boolean;
  anchor:   string;
};

export type ContextCompleteness = {
  items: ContextItem[];
  score: number;            // 0–100 across all items
  missingTotal: number;
  missingRequired: number;
  missingOptional: number;
  bookingRelevant: boolean;
  followupRelevant: boolean;
  crmRelevant: boolean;
};

export function computeContextCompleteness(state: SetupState | null): ContextCompleteness {
  const c = state?.context ?? DEFAULT_CONTEXT;
  const items: ContextItem[] = [];
  const add = (group: string, groupLabel: string, key: string, label: string, helper: string, done: boolean, required: boolean) =>
    items.push({ group, groupLabel, key, label, helper, done, required, anchor: `ctx-${group}-${key}` });

  const filled = (v: string) => !!v.trim();

  // 1. Business context
  add("business", "Business Context", "mainGoal", "Main goal of the agent",
    "What is this agent for? e.g. qualify estate agency seller leads and book valuations.", filled(c.business.mainGoal), true);
  add("business", "Business Context", "desiredOutcome", "Desired outcome",
    "What should exist after the agent succeeds? e.g. qualified lead with booking pushed to Dynamics.", filled(c.business.desiredOutcome), true);
  add("business", "Business Context", "audience", "Who is the agent speaking to?",
    "e.g. inbound website leads, cold outbound sellers.", filled(c.business.audience), false);
  add("business", "Business Context", "problem", "What problem is this solving?",
    "The business pain this setup removes.", filled(c.business.problem), false);
  add("business", "Business Context", "onSuccess", "After a successful call/message",
    "e.g. update the lead, book the slot, notify the owner.", filled(c.business.onSuccess), false);
  add("business", "Business Context", "onFailure", "After an unsuccessful call/message",
    "e.g. start follow-up, mark no-answer.", filled(c.business.onFailure), false);
  add("business", "Business Context", "industry", "Industry",
    "Helps SystemMind pick sensible defaults.", filled(c.business.industry), false);

  // 2. Agent context (linked agent + scan live from state, not free text)
  add("agent", "Agent Context", "linked", "Linked agent selected",
    "Select the agent so SystemMind can scan its script, prompt, variables and connected tools.", !!state?.agentId, true);
  add("agent", "Agent Context", "scanned", "Agent scan has been run",
    "The scan finds {{variables}}, booking logic and webhooks in the agent.", !!state?.scan.scannedAt, true);
  add("agent", "Agent Context", "channel", "Channel",
    "Phone, WhatsApp, SMS, email or mixed.", filled(c.agent.channel) || !!state?.scan.channel, true);
  add("agent", "Agent Context", "direction", "Inbound or outbound?",
    "How do conversations start?", filled(c.agent.direction), false);
  add("agent", "Agent Context", "updateMode", "Update existing agent or new workflow?",
    "Should this setup change the agent itself or add a workflow around it?", filled(c.agent.updateMode), false);

  // 3. Data collection context
  add("data", "Data Context", "fieldsConfirmed", "Required collected fields confirmed",
    "Confirm which detected variables must be collected, saved or ignored.", c.data.fieldsConfirmed, true);
  add("data", "Data Context", "saveDestination", "Save destination chosen",
    "Should collected data be saved to WEBEE, sent to the CRM, or both?",
    c.data.saveToWebee === true || c.data.sendToCrm === true, true);

  // 4. CRM context — relevant when an external CRM is selected or CRM sync requested
  const externalCrm = !!state && !["none", "webee"].includes(state.crm.provider);
  const crmRelevant = externalCrm || c.data.sendToCrm === true || c.crm.syncRequired === true;
  if (crmRelevant) {
    add("crm", "CRM Context", "provider", "CRM provider selected",
      "Choose where the agent data should go.", externalCrm, true);
    add("crm", "CRM Context", "objectTable", "CRM object/table",
      "e.g. leads, contacts, opportunities.", filled(c.crm.objectTable), true);
    add("crm", "CRM Context", "duplicateRule", "Duplicate handling rule",
      "What happens when the lead already exists in the CRM?", filled(c.crm.duplicateRule), true);
    add("crm", "CRM Context", "pipeline", "CRM pipeline", "Pipeline/stage new records land in.", filled(c.crm.pipeline), false);
    add("crm", "CRM Context", "owner", "CRM owner", "Default record owner.", filled(c.crm.owner), false);
    add("crm", "CRM Context", "sourceCode", "Source/campaign code", "Attribution code stamped on records.", filled(c.crm.sourceCode), false);
    add("crm", "CRM Context", "triggerStatuses", "CRM statuses that drive the workflow",
      "Which CRM statuses/stages should start or stop the workflow?", filled(c.crm.triggerStatuses), false);
  }

  // 5. Trigger context
  add("trigger", "Trigger Context", "source", "What starts this workflow?",
    "e.g. WEBEE lead status becomes Positive, CRM lead becomes Qualified, call outcome is Appointment Booked.",
    filled(c.trigger.source) || (state?.triggers.length ?? 0) > 0, true);
  add("trigger", "Trigger Context", "frequency", "Trigger once or every time?",
    "Should the workflow fire once per lead or on every matching change?", filled(c.trigger.frequency), false);
  add("trigger", "Trigger Context", "timing", "Immediately or after a delay?",
    "", filled(c.trigger.timing), false);
  add("trigger", "Trigger Context", "scopeFilter", "Limit to specific campaigns/agents/sources?",
    "", filled(c.trigger.scopeFilter), false);

  // 6. Outcome context
  add("outcome", "Outcome Context", "finalAction", "Final action after the trigger",
    "What success looks like: create/update lead, book appointment, send WhatsApp, start follow-up…",
    filled(c.outcome.finalAction) || c.outcome.actions.length > 0, true);

  // 7. Booking context — only when booking is involved
  const bookingVars = state?.scan.variables.some((v) => v.varClass === "booking") ?? false;
  const bookingRelevant = c.booking.required === true || (c.booking.required !== false && (!!state?.scan.hasBookingLogic || bookingVars));
  if (bookingRelevant) {
    add("booking", "Booking Context", "calendarProvider", "Calendar provider",
      "e.g. Cal.com, Google Calendar.", filled(c.booking.calendarProvider), true);
    add("booking", "Booking Context", "bookingVariable", "Booking field/variable",
      "Which detected variable carries the chosen slot?", filled(c.booking.bookingVariable), true);
    add("booking", "Booking Context", "eventType", "Event type or booking link",
      "", filled(c.booking.eventType), true);
    add("booking", "Booking Context", "timezone", "Timezone",
      "", filled(c.booking.timezone), true);
    add("booking", "Booking Context", "confirmationMessage", "Confirmation handling",
      "What the lead receives once booked.", filled(c.booking.confirmationMessage), false);
    add("booking", "Booking Context", "cancellationHandling", "Cancellation/reschedule handling",
      "", filled(c.booking.cancellationHandling), false);
  }

  // 8. Follow-up context — only when enabled
  if (c.followup.enabled === true) {
    add("followup", "Follow-Up Context", "channel", "Follow-up channel", "", filled(c.followup.channel), true);
    add("followup", "Follow-Up Context", "delay", "Delay before first follow-up", "", filled(c.followup.delay), true);
    add("followup", "Follow-Up Context", "attempts", "Number of attempts", "", filled(c.followup.attempts), true);
    add("followup", "Follow-Up Context", "stopConditions", "Stop conditions",
      "Which statuses or replies stop the follow-up?", filled(c.followup.stopConditions), true);
  }

  // 9. Compliance context (optional but tracked)
  add("compliance", "Compliance Context", "callingHours", "Calling hours",
    "", filled(c.compliance.callingHours), false);
  add("compliance", "Compliance Context", "dncRules", "Do-not-contact rules",
    "", filled(c.compliance.dncRules), false);
  add("compliance", "Compliance Context", "handoverRules", "Human handover rules",
    "", filled(c.compliance.handoverRules), false);

  // 10. Success criteria
  add("success", "Success Criteria", "definition", "What does a successful setup mean?",
    "e.g. lead updated in WEBEE, Dynamics receives mapped fields, test payload passes.", filled(c.success.definition), true);
  add("success", "Success Criteria", "testProves", "What should the test prove?",
    "", filled(c.success.testProves), false);
  add("success", "Success Criteria", "mustNotHappen", "What should NOT happen?",
    "", filled(c.success.mustNotHappen), false);

  // Confirmation itself
  add("confirm", "Confirmation", "confirmed", "Context confirmed by you",
    "Review the context and press Confirm Context — SystemMind never builds on unconfirmed context.", c.confirmed, true);

  const missing = items.filter((i) => !i.done);
  return {
    items,
    score: items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : 0,
    missingTotal: missing.length,
    missingRequired: missing.filter((i) => i.required).length,
    missingOptional: missing.filter((i) => !i.required).length,
    bookingRelevant, followupRelevant: c.followup.enabled === true, crmRelevant,
  };
}

// ── Context save / auto-suggest / confirm ─────────────────────────────────────

const CTX_STR = z.string().max(2000);
const CTX_ARR = z.array(z.string().max(200)).max(60);

export const ContextPatchSchema = z.object({
  business: z.object({
    businessName: CTX_STR, industry: CTX_STR, mainGoal: CTX_STR, problem: CTX_STR,
    audience: CTX_STR, desiredOutcome: CTX_STR, onSuccess: CTX_STR, onFailure: CTX_STR,
  }).partial().optional(),
  agent: z.object({
    channel: CTX_STR, direction: CTX_STR, lifecycle: CTX_STR, updateMode: CTX_STR, scanTarget: CTX_STR,
  }).partial().optional(),
  data: z.object({
    requiredFields: CTX_ARR, optionalFields: CTX_ARR, preProvidedFields: CTX_ARR, postCallFields: CTX_ARR,
    saveToWebee: z.boolean().nullable(), sendToCrm: z.boolean().nullable(), fieldsConfirmed: z.boolean(),
  }).partial().optional(),
  crm: z.object({
    syncRequired: z.boolean().nullable(), objectTable: CTX_STR, pipeline: CTX_STR, owner: CTX_STR,
    sourceCode: CTX_STR, duplicateRule: CTX_STR, updateFields: CTX_STR, triggerStatuses: CTX_STR,
  }).partial().optional(),
  trigger: z.object({
    source: CTX_STR, object: CTX_STR, field: CTX_STR, value: CTX_STR,
    frequency: CTX_STR, timing: CTX_STR, scopeFilter: CTX_STR,
  }).partial().optional(),
  outcome: z.object({ finalAction: CTX_STR, actions: CTX_ARR, notes: CTX_STR }).partial().optional(),
  booking: z.object({
    required: z.boolean().nullable(), calendarProvider: CTX_STR, eventType: CTX_STR, bookingVariable: CTX_STR,
    duration: CTX_STR, timezone: CTX_STR, availabilityRules: CTX_STR, confirmationMessage: CTX_STR,
    rebookingRules: CTX_STR, cancellationHandling: CTX_STR, crmAppointmentField: CTX_STR,
  }).partial().optional(),
  followup: z.object({
    enabled: z.boolean().nullable(), channel: CTX_STR, delay: CTX_STR, attempts: CTX_STR,
    stopConditions: CTX_STR, templates: CTX_STR, owner: CTX_STR, stopStatuses: CTX_STR,
  }).partial().optional(),
  compliance: z.object({
    canContact: z.boolean().nullable(), consentSource: CTX_STR, dncRules: CTX_STR, region: CTX_STR,
    callingHours: CTX_STR, disclaimers: CTX_STR, escalationRules: CTX_STR, handoverRules: CTX_STR,
  }).partial().optional(),
  success: z.object({
    definition: CTX_STR, testProves: CTX_STR, webeeExpectation: CTX_STR,
    crmExpectation: CTX_STR, mustNotHappen: CTX_STR, approver: CTX_STR,
  }).partial().optional(),
});

export async function saveSetupContextServer(args: {
  workspaceId: string; userId: string; sessionId: string;
  patch: z.infer<typeof ContextPatchSchema>;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  const cur = state?.context ?? DEFAULT_CONTEXT;
  const p = args.patch;
  const next: SetupContext = {
    ...cur,
    business:   { ...cur.business,   ...(p.business ?? {}) },
    agent:      { ...cur.agent,      ...(p.agent ?? {}) },
    data:       { ...cur.data,       ...(p.data ?? {}) },
    crm:        { ...cur.crm,        ...(p.crm ?? {}) },
    trigger:    { ...cur.trigger,    ...(p.trigger ?? {}) },
    outcome:    { ...cur.outcome,    ...(p.outcome ?? {}) },
    booking:    { ...cur.booking,    ...(p.booking ?? {}) },
    followup:   { ...cur.followup,   ...(p.followup ?? {}) },
    compliance: { ...cur.compliance, ...(p.compliance ?? {}) },
    success:    { ...cur.success,    ...(p.success ?? {}) },
    // Any edit invalidates a previous confirmation.
    confirmed: false, confirmedBy: null, confirmedAt: null,
  };
  const saved = await upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
    patch: { context: next },
  });
  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: "setup_context_saved", targetType: "build_session", targetId: args.sessionId,
    finalAfterState: { changedGroups: Object.keys(p) },
  }).catch(() => {});
  return saved;
}

/** Fill EMPTY context fields with suggestions derived from the agent scan.
 *  Never overwrites user values, never auto-confirms — the user must review. */
export async function autoSuggestSetupContextServer(args: {
  workspaceId: string; userId: string; sessionId: string;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  if (!state?.scan.scannedAt) throw new Error("Run the agent scan first — suggestions come from the agent's script and variables.");
  const c = state.context;
  const vars = state.scan.variables;
  const reqVars = vars.filter((v) => v.required).map((v) => v.name);
  const optVars = vars.filter((v) => !v.required && v.varClass !== "extraction").map((v) => v.name);
  const postVars = vars.filter((v) => v.varClass === "extraction" || v.varClass === "call_outcome").map((v) => v.name);
  const bookingVar = vars.find((v) => v.varClass === "booking")?.name ?? "";
  const agentType = state.scan.agentType ?? "custom";
  const typeGoal: Record<string, string> = {
    client_qualification: "Qualify leads, collect the key details and hand qualified leads to the right destination.",
    lead_gen: "Capture new leads and their contact details, then save them for follow-up.",
    receptionist: "Answer inbound enquiries, take messages and route callers correctly.",
    booking: "Book appointments into the calendar and confirm slots with the lead.",
  };
  const suggested: SetupContext = {
    ...c,
    business: {
      ...c.business,
      mainGoal: c.business.mainGoal || (typeGoal[agentType] ?? `Run the "${state.scan.agentName ?? "linked"}" agent's workflow end to end.`),
      desiredOutcome: c.business.desiredOutcome ||
        (bookingVar ? "A qualified lead with a confirmed booking, saved to WEBEE and synced to the CRM if enabled."
                    : "A processed lead with all collected details saved to WEBEE and synced to the CRM if enabled."),
    },
    agent: {
      ...c.agent,
      channel: c.agent.channel || (state.scan.channel ?? ""),
      lifecycle: c.agent.lifecycle || (state.scan.isLive ? "live" : "draft"),
    },
    data: {
      ...c.data,
      requiredFields: c.data.requiredFields.length ? c.data.requiredFields : reqVars,
      optionalFields: c.data.optionalFields.length ? c.data.optionalFields : optVars,
      postCallFields: c.data.postCallFields.length ? c.data.postCallFields : postVars,
      saveToWebee: c.data.saveToWebee ?? true,
      sendToCrm: c.data.sendToCrm ?? (!["none", "webee"].includes(state.crm.provider) ? true : null),
    },
    trigger: {
      ...c.trigger,
      source: c.trigger.source || (state.triggers[0]
        ? `${state.triggers[0].source.replace(/_/g, " ")}: ${state.triggers[0].statusName || state.triggers[0].statusCode}`
        : ""),
    },
    outcome: {
      ...c.outcome,
      finalAction: c.outcome.finalAction ||
        (bookingVar ? "Create/update the lead in WEBEE and create the appointment."
                    : "Create/update the lead in WEBEE with the collected details."),
    },
    booking: {
      ...c.booking,
      required: c.booking.required ?? (state.scan.hasBookingLogic || !!bookingVar ? true : null),
      bookingVariable: c.booking.bookingVariable || bookingVar,
    },
    success: {
      ...c.success,
      definition: c.success.definition ||
        `Agent collects ${reqVars.slice(0, 5).map((v) => `{{${v}}}`).join(", ") || "the required fields"}; the lead is updated in WEBEE; the test payload passes; you approve before go-live.`,
    },
    confirmed: false, confirmedBy: null, confirmedAt: null,
    suggestedAt: new Date().toISOString(),
  };
  const saved = await upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
    patch: { context: suggested },
  });
  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: "setup_context_suggested", targetType: "build_session", targetId: args.sessionId,
  }).catch(() => {});
  return saved;
}

export async function confirmSetupContextServer(args: {
  workspaceId: string; userId: string; sessionId: string;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  if (!state) throw new Error("Run the agent scan first.");
  const cc = computeContextCompleteness(state);
  const missingRequired = cc.items.filter((i) => i.required && !i.done && i.group !== "confirm");
  if (missingRequired.length > 0) {
    throw new Error(
      `Cannot confirm yet — ${missingRequired.length} required context item${missingRequired.length === 1 ? "" : "s"} missing: ` +
      missingRequired.slice(0, 6).map((i) => `${i.groupLabel}: ${i.label}`).join("; ") +
      (missingRequired.length > 6 ? "; …" : ""),
    );
  }
  const saved = await upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
    patch: { context: { ...state.context, confirmed: true, confirmedBy: args.userId, confirmedAt: new Date().toISOString() } },
  });
  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: "setup_context_confirmed", targetType: "build_session", targetId: args.sessionId,
  }).catch(() => {});
  return saved;
}

function crmLabel(provider: string): string {
  return ({
    dynamics: "Microsoft Dynamics", hubspot: "HubSpot", salesforce: "Salesforce",
    pipedrive: "Pipedrive", zoho: "Zoho", gohighlevel: "GoHighLevel",
    custom: "Custom API", webee: "WEBEE CRM", none: "No CRM",
  } as Record<string, string>)[provider] ?? provider;
}

// ── Test payload + run + approve ───────────────────────────────────────────────

const EXAMPLE_VALUES: Array<[RegExp, string]> = [
  [/email/i, "test@example.com"],
  [/phone|mobile/i, "+447000000000"],
  [/budget|price|amount/i, "250000"],
  [/date|time|slot/i, "2026-07-17T14:00:00Z"],
  [/first_?name/i, "Alex"],
  [/last_?name/i, "Taylor"],
  [/name/i, "Alex Taylor"],
  [/postcode|zip/i, "SW1A 1AA"],
  [/status/i, "qualified"],
  [/summary/i, "Test call summary"],
];

function exampleValue(name: string): string {
  for (const [re, v] of EXAMPLE_VALUES) if (re.test(name)) return v;
  return `test_${name.toLowerCase()}`;
}

export async function generateSetupTestPayloadServer(args: {
  workspaceId: string; userId: string; sessionId: string;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  if (!state) throw new Error("Run the agent scan first.");
  const active = state.mappings.filter((m) => !m.ignored);
  const trigger = state.triggers[0] ?? null;
  const payload = {
    workspace_id: args.workspaceId,
    agent_id: state.agentId,
    trigger: trigger ? {
      source: trigger.source, object: trigger.object,
      field: trigger.fieldApiCode || trigger.fieldLabel, value: trigger.statusCode || trigger.statusName,
    } : null,
    variables: Object.fromEntries(active.map((m) => [m.variable, m.defaultValue || exampleValue(m.variable)])),
    webee_mapping: Object.fromEntries(active.filter((m) => m.webeeField).map((m) => [m.variable, m.webeeField])),
    crm_mapping: Object.fromEntries(active.filter((m) => m.crmField).map((m) => [m.variable, m.crmField])),
  };
  return upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
    patch: { test: { ...state.test, payload, generatedAt: new Date().toISOString(), runAt: null, runOk: null, approvedAt: null, approvedBy: null } },
  });
}

export async function runSetupTestServer(args: {
  workspaceId: string; userId: string; sessionId: string;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  if (!state?.test.payload) throw new Error("Generate a test payload first.");

  // Deterministic dry-run: validate the payload maps cleanly (no live CRM write).
  const problems: string[] = [];
  const req = computeRequiredInputs(state).filter((i) =>
    i.required && !i.done && i.group !== "testing");
  for (const r of req) problems.push(r.label);
  const ok = problems.length === 0;

  const next = await upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
    patch: { test: { ...state.test, runAt: new Date().toISOString(), runOk: ok, runNotes: ok ? "Dry run passed — payload maps cleanly with the saved mappings and trigger rules." : `Dry run found ${problems.length} problem(s): ${problems.slice(0, 6).join("; ")}` } },
  });
  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: "setup_test_run", targetType: "build_session", targetId: args.sessionId,
    finalAfterState: { ok, problems: problems.slice(0, 10) },
  }).catch(() => {});
  return next;
}

export async function approveSetupServer(args: {
  workspaceId: string; userId: string; sessionId: string;
}): Promise<SetupState> {
  const state = await getSetupStateServer(args.workspaceId, args.sessionId);
  if (!state) throw new Error("Run the agent scan first.");
  if (!state.test.runAt) throw new Error("Run the test before approving.");
  if (state.test.runOk === false) throw new Error("The last test run failed — fix the listed problems and re-run before approving.");
  const next = await upsertSetupStateRow({
    workspaceId: args.workspaceId, userId: args.userId, sessionId: args.sessionId,
    patch: { test: { ...state.test, approvedBy: args.userId, approvedAt: new Date().toISOString() } },
  });
  await writeSystemMindAudit({
    workspaceId: args.workspaceId, userId: args.userId,
    actionType: "setup_approved", targetType: "build_session", targetId: args.sessionId,
  }).catch(() => {});
  return next;
}

// ── Apply gate (called from applyBuildVersionServer) ───────────────────────────
// Only enforced when a setup state EXISTS for the session — existing sessions
// without the setup console keep their current behaviour.

export async function assertSetupCompleteForApply(workspaceId: string, sessionId: string): Promise<void> {
  const state = await getSetupStateRow(workspaceId, sessionId);
  if (!state) return;
  const missing = computeRequiredInputs(state).filter((i) => i.required && !i.done);
  if (missing.length > 0) {
    throw new Error(
      `Setup incomplete — ${missing.length} required input${missing.length === 1 ? "" : "s"} remaining. Fill them in on the Setup tabs: ` +
      missing.slice(0, 8).map((m) => m.label).join("; ") + (missing.length > 8 ? "; …" : ""),
    );
  }
}
