// ── SystemMind Agent Scanner & Dynamic Variable Engine — server-only core ─────
// Scans a selected agent build and produces a persisted, reviewable dynamic
// variable registry plus a detected-requirements report:
//   • Deterministic extraction of {{variables}} from the global prompt, start
//     message, flow nodes (incl. extract/booking/webhook/transfer nodes),
//     builder variable definitions, leadGen/qualify mappings and the latest
//     custom_agent_configs extraction schema.
//   • Deterministic detection of required integrations, credential NAMES only,
//     webhook events and booking/transfer rules.
//   • Optional AI-assisted CRM-field inference pass (graceful fallback to the
//     deterministic CRM adapter definitions + suggestion tables).
//
// PRESERVE-NOT-REPLACE: this module does not modify the existing setup console
// (systemmind_setup_states), requirements analyzer or custom agent configs —
// it reads them as detection sources and persists to the new normalized tables
// systemmind_agent_scans / systemmind_dynamic_variables /
// systemmind_variable_mappings / systemmind_transformation_rules.
//
// SAFETY INVARIANTS
//   • workspace_id comes ONLY from server context.
//   • Credential VALUES never enter this module or its tables — names only
//     (assertNoCredentialValues re-checks every stored payload).
//   • WBAH is hard-blocked (assertNotWbahWorkspace) on every entry point.
//   • Re-scans NEVER clobber reviewed variables (approved/edited/rejected rows
//     are preserved; only their detected_sources refresh).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { assertNoCredentialValues } from "@/lib/systemmind/systemmind-generators.server";
import { writeSystemMindAudit } from "@/lib/systemmind/systemmind-automation.server";
import { getCrmAdapterDefinition } from "@/lib/systemmind/crm-definitions/registry";
import {
  applyTransformation,
  validateByDataType,
  TRANSFORM_RULE_TYPES,
  type TransformResult,
} from "@/lib/systemmind/variable-transforms.shared";

// ── Types ──────────────────────────────────────────────────────────────────────

export type VariableDataType =
  | "text" | "number" | "currency" | "boolean" | "date" | "datetime" | "email"
  | "phone" | "url" | "address" | "single_select" | "multi_select" | "json" | "record_id";

export type VariableDirection =
  | "unassigned" | "crm_to_webee" | "webee_to_retell_precall" | "retell_to_webee"
  | "webee_to_crm_postcall" | "retell_to_crm_via_webee" | "bidirectional";

export type VariableStatus = "detected" | "approved" | "edited" | "rejected";

export type DynamicVariable = {
  id: string;
  agentId: string;
  name: string;
  label: string;
  description: string;
  dataType: VariableDataType;
  isRequired: boolean;
  defaultValue: string;
  exampleValue: string;
  direction: VariableDirection;
  sourceSystem: string; sourceObject: string; sourceField: string;
  destinationSystem: string; destinationObject: string; destinationField: string;
  validationRule: string;
  fallbackValue: string;
  sensitivity: string;
  allowSendToRetell: boolean;
  allowStoreInWebee: boolean;
  allowWriteToCrm: boolean;
  varClass: string;
  detectedSources: string[];
  confidence: "high" | "medium" | "low" | null;
  status: VariableStatus;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DetectedRequirementsReport = {
  agentId: string;
  agentName: string;
  agentType: string;
  channel: string;
  scannedAt: string;
  variableCount: number;
  newVariableCount: number;
  variables: Array<{ name: string; dataType: string; varClass: string; sources: string[]; direction: string }>;
  requiredIntegrations: string[];        // e.g. ["retell", "calendar", "crm:hubspot", "webhook"]
  requiredCredentialNames: string[];     // NAMES only, never values
  requiredWebhookEvents: string[];       // e.g. ["call_ended", "call_analyzed", "transcript_updated"]
  hasBookingLogic: boolean;
  hasTransferLogic: boolean;
  hasWebhookLogic: boolean;
  aiInferenceUsed: boolean;
};

// ── Deterministic classification ───────────────────────────────────────────────

const VAR_RE = /\{\{\s*([a-zA-Z0-9_][a-zA-Z0-9_.-]{0,80})\s*\}\}/g;

type ClassRow = [RegExp, string, VariableDataType, boolean, string]; // pattern, class, type, required, sensitivity
const CLASS_RULES: ClassRow[] = [
  [/^(first_?name|last_?name|full_?name|name)$/i,                       "contact", "text",     true,  "personal"],
  [/^email(_?address)?$/i,                                              "contact", "email",    true,  "personal"],
  [/^(phone(_?number)?|mobile)$/i,                                      "contact", "phone",    true,  "personal"],
  [/^preferred_contact(_method)?$/i,                                    "contact", "text",     false, "personal"],
  [/^(address|city|postcode|zip)$/i,                                    "lead",    "address",  false, "personal"],
  [/^(budget|price|amount|offer|valuation)$/i,                          "lead",    "currency", false, "financial"],
  [/^(company(_?name)?|timeline|property_type|lead_source|qualification(_status)?)$/i, "lead", "text", false, "standard"],
  [/^(lead_?status|status)$/i,                                          "lead",    "single_select", false, "standard"],
  [/^(booking_?slot|appointment_?(date|time|datetime)?|meeting_?(time|date)|viewing_?(time|date)|slot|available_?times?)$/i, "booking", "datetime", true, "standard"],
  [/^(call_?summary|call_?transcript|disposition|negative_?reason|outcome|call_?outcome|sentiment)$/i, "call_outcome", "text", false, "standard"],
  [/^call_?recording(_url)?$/i,                                         "call_outcome", "url", false, "standard"],
  [/^(crm_|dynamics_|hubspot_|salesforce_|pipedrive_|zoho_|new_)/i,     "crm",     "text",     false, "standard"],
  [/^(dob|date_of_birth|birth_?date)$/i,                                "contact", "date",     false, "sensitive_personal"],
];

function classifyVariable(name: string): { varClass: string; dataType: VariableDataType; required: boolean; sensitivity: string } {
  for (const [re, varClass, dataType, required, sensitivity] of CLASS_RULES) {
    if (re.test(name)) return { varClass, dataType, required, sensitivity };
  }
  const dataType: VariableDataType =
    /email/i.test(name) ? "email" :
    /phone|mobile/i.test(name) ? "phone" :
    /url|link/i.test(name) ? "url" :
    /budget|price|amount|cost|value/i.test(name) ? "currency" :
    /count|number|qty|quantity/i.test(name) ? "number" :
    /date|time|slot/i.test(name) ? "datetime" :
    /is_|has_|_flag$|consent|opt_?in|opt_?out/i.test(name) ? "boolean" : "text";
  return { varClass: "custom", dataType, required: false };
  // sensitivity default handled by caller
}

// Default direction per class: extraction/call outcome flows Retell→WEBEE;
// contact/lead identity flows WEBEE→Retell pre-call; crm-prefixed flows to CRM.
function defaultDirection(varClass: string, fromExtraction: boolean): VariableDirection {
  if (fromExtraction || varClass === "call_outcome" || varClass === "extraction") return "retell_to_webee";
  if (varClass === "crm") return "webee_to_crm_postcall";
  if (varClass === "contact" || varClass === "lead") return "webee_to_retell_precall";
  if (varClass === "booking") return "retell_to_webee";
  return "unassigned";
}

const WEBEE_DEST: Array<[RegExp, string, "high" | "medium"]> = [
  [/^(first_?name)$/i,               "webee.lead.first_name",     "high"],
  [/^(last_?name)$/i,                "webee.lead.last_name",      "high"],
  [/^(full_?name|name)$/i,           "webee.lead.name",           "high"],
  [/^email(_?address)?$/i,           "webee.lead.email",          "high"],
  [/^(phone(_?number)?|mobile)$/i,   "webee.lead.phone",          "high"],
  [/^company(_?name)?$/i,            "webee.lead.company",        "high"],
  [/^(booking_?slot|appointment_?(date|time|datetime)?)$/i, "webee.appointment.datetime", "high"],
  [/^call_?summary$/i,               "webee.call.summary",        "high"],
  [/^call_?transcript$/i,            "webee.call.transcript",     "high"],
  [/^call_?recording(_url)?$/i,      "webee.call.recording_url",  "high"],
  [/^sentiment$/i,                   "webee.call.sentiment",      "high"],
  [/^(lead_)?status$/i,              "webee.lead.status",         "medium"],
  [/^qualification(_status)?$/i,     "webee.lead.qualification_status", "medium"],
  [/^preferred_contact(_method)?$/i, "webee.lead.preferred_contact",    "medium"],
];

function suggestWebeeCoordinate(name: string): { coord: string; confidence: "high" | "medium" | "low" } {
  for (const [re, coord, confidence] of WEBEE_DEST) if (re.test(name)) return { coord, confidence };
  return { coord: `webee.lead.meta.${name.toLowerCase()}`, confidence: "low" };
}

function splitCoordinate(coord: string): { system: string; object: string; field: string } {
  const bits = coord.split(".");
  return { system: bits[0] ?? "", object: bits[1] ?? "", field: bits.slice(2).join(".") };
}

// Deterministic CRM field suggestion from the descriptive adapter definitions.
export function suggestCrmFieldFromDefinitions(provider: string, varName: string): string {
  const def = getCrmAdapterDefinition(provider);
  if (!def) return "";
  const target = varName.toLowerCase().replace(/_/g, "");
  for (const action of def.actionMappings) {
    for (const fm of action.fieldMappings ?? []) {
      const uni = fm.universal.toLowerCase().replace(/_/g, "");
      if (uni === target || (`${uni}` === "phone" && /^(phonenumber|mobile)$/.test(target))
        || (uni === "firstname" && target === "firstname") ) {
        return fm.crmField;
      }
    }
  }
  return "";
}

// ── Scan engine ────────────────────────────────────────────────────────────────

type FoundVar = {
  name: string;
  sources: string[];
  fromExtraction: boolean;
  declaredType?: string;
};

function collectVars(text: string, label: string, into: Map<string, FoundVar>, fromExtraction = false) {
  if (!text) return;
  VAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_RE.exec(text)) !== null) {
    const name = m[1];
    const existing = into.get(name);
    if (existing) {
      if (!existing.sources.includes(label)) existing.sources.push(label);
      if (fromExtraction) existing.fromExtraction = true;
    } else {
      into.set(name, { name, sources: [label], fromExtraction });
    }
  }
}

function addDeclared(name: string, label: string, into: Map<string, FoundVar>, declaredType?: string, fromExtraction = false) {
  const n = String(name ?? "").trim();
  if (!n || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,80}$/.test(n)) return;
  const existing = into.get(n);
  if (existing) {
    if (!existing.sources.includes(label)) existing.sources.push(label);
    if (fromExtraction) existing.fromExtraction = true;
    if (declaredType && !existing.declaredType) existing.declaredType = declaredType;
  } else {
    into.set(n, { name: n, sources: [label], fromExtraction, declaredType });
  }
}

const DECLARED_TYPE_MAP: Record<string, VariableDataType> = {
  string: "text", text: "text", number: "number", integer: "number", float: "number",
  boolean: "boolean", bool: "boolean", date: "date", datetime: "datetime",
  email: "email", phone: "phone", url: "url", enum: "single_select", json: "json",
};

// AI-assisted CRM-field inference: only runs when a CRM provider is known and
// an OpenAI key exists; deterministic definitions remain the fallback.
async function aiInferCrmFields(
  apiKey: string,
  provider: string,
  varNames: string[],
): Promise<Record<string, string>> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: "system", content: "You map voice-agent variable names to CRM API field codes. Return ONLY a JSON object { variable_name: crm_field_code }. Use the standard field codes for the named CRM. Omit variables you cannot map confidently." },
        { role: "user", content: `CRM: ${provider}\nVariables: ${varNames.join(", ")}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const json: any = await res.json();
  const raw = String(json.choices?.[0]?.message?.content ?? "{}")
    .replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
  const parsed = JSON.parse(raw);
  const out: Record<string, string> = {};
  if (parsed && typeof parsed === "object") {
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.length <= 120 && varNames.includes(k)) out[k] = v;
    }
  }
  return out;
}

export async function scanAgentVariablesServer(args: {
  workspaceId: string;
  userId: string | null;
  agentId: string;
  crmProvider?: string | null;   // hint for CRM-field inference (e.g. "hubspot")
  useAi?: boolean;               // AI-assisted CRM-field inference pass
}): Promise<{ scanId: string; report: DetectedRequirementsReport; variables: DynamicVariable[] }> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;

  const { data: agent, error: aErr } = await sb.from("agents")
    .select("id, name, agent_type, settings, flow_data, variables, retell_agent_id, workspace_id")
    .eq("id", args.agentId).eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (aErr) throw new Error(`Failed to load agent: ${aErr.message}`);
  if (!agent) throw new Error("Agent not found in this workspace.");

  const settings: any = agent.settings ?? {};
  const flowData: any = agent.flow_data ?? {};
  const nodes: any[] = Array.isArray(flowData.nodes) ? flowData.nodes : [];

  const found = new Map<string, FoundVar>();
  collectVars(String(settings.globalPrompt ?? ""), "Global prompt", found);
  collectVars(String(settings.beginMessage ?? ""), "Start message", found);

  let hasTransferLogic = false;
  const webhookEvents = new Set<string>();
  const integrations = new Set<string>();

  for (const node of nodes) {
    const d: any = node?.data ?? {};
    const nodeName = String(d.label ?? d.name ?? node?.type ?? "node");
    const nodeType = String(node?.type ?? d.type ?? "");
    const isExtract  = /extract/i.test(nodeType);
    const isBooking  = /book|calendar|cal_?com/i.test(nodeType);
    const isWebhook  = /http|webhook|function|tool/i.test(nodeType);
    const isTransfer = /transfer/i.test(nodeType) || /transfer_call/i.test(JSON.stringify(d).slice(0, 4000));
    if (isTransfer) hasTransferLogic = true;
    if (isBooking) integrations.add("calendar");
    if (isWebhook) integrations.add("webhook");
    const label =
      isExtract  ? `Extract Variable node: ${nodeName}` :
      isBooking  ? `Booking node: ${nodeName}` :
      isWebhook  ? `Webhook/function node: ${nodeName}` :
      isTransfer ? `Transfer node: ${nodeName}` :
      /crm/i.test(nodeType) ? `CRM sync node: ${nodeName}` :
      `Node: ${nodeName}`;
    let text = "";
    try { text = JSON.stringify(d); } catch { text = ""; }
    collectVars(text, label, found, isExtract);
    for (const dv of (Array.isArray(d.variables) ? d.variables : [])) {
      addDeclared(String(dv?.name ?? ""), label, found, String(dv?.type ?? ""), isExtract);
    }
  }

  // Builder-level variable definitions
  for (const v of (Array.isArray(agent.variables) ? agent.variables : [])) {
    addDeclared(String(v?.name ?? ""), "Builder variable definitions", found, String(v?.type ?? ""));
  }
  // Module mappings (pre/post-call extraction)
  const leadGen: any = settings.leadGen ?? {};
  const qualify: any = settings.qualify ?? {};
  for (const [src, label, fromExtraction] of [
    [leadGen.variableMappings, "Lead-gen pre-call mappings", false],
    [leadGen.postCallMappings, "Lead-gen post-call extraction", true],
    [qualify.preCallMappings,  "Qualify pre-call mappings", false],
    [qualify.postCallMappings, "Qualify post-call extraction", true],
  ] as Array<[Record<string, unknown> | undefined, string, boolean]>) {
    for (const k of Object.keys(src ?? {})) addDeclared(k, label, found, undefined, fromExtraction);
  }
  // Latest custom_agent_configs extraction schema
  const { data: cfg } = await sb.from("custom_agent_configs")
    .select("extraction_fields, crm_field_mapping, crm_mode")
    .eq("workspace_id", args.workspaceId).eq("agent_id", args.agentId)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  for (const f of (Array.isArray(cfg?.extraction_fields) ? cfg.extraction_fields : [])) {
    addDeclared(String((f as any)?.field_name ?? (f as any)?.name ?? f ?? ""), "Deployment config extraction schema", found, String((f as any)?.type ?? ""), true);
  }

  // Integrations / webhooks / credentials (names only)
  const allText = `${String(settings.globalPrompt ?? "")}\n${JSON.stringify(nodes).slice(0, 200000)}`;
  const hasBookingLogic = settings.booking?.enabled === true || /\bbook(ing)?\b|\bappointment\b/i.test(allText);
  const hasWebhookLogic = /webhook|http_request|api_call/i.test(allText);
  if (hasBookingLogic) integrations.add("calendar");
  if (hasWebhookLogic) integrations.add("webhook");
  if (agent.retell_agent_id) integrations.add("retell");
  const crmProvider = String(args.crmProvider ?? cfg?.crm_mode ?? "").toLowerCase();
  if (crmProvider && crmProvider !== "webee" && crmProvider !== "none") integrations.add(`crm:${crmProvider}`);

  const credentialNames: string[] = [];
  if (integrations.has("retell")) credentialNames.push("RETELL_API_KEY (or workspace Retell key)");
  if ([...integrations].some((i) => i.startsWith("crm:"))) credentialNames.push(`${crmProvider.toUpperCase()} CRM credentials`);
  if (integrations.has("calendar")) credentialNames.push("Calendar provider credentials");

  webhookEvents.add("call_ended");
  webhookEvents.add("call_analyzed");
  if (found.size > 0) webhookEvents.add("call_started");

  // ── Build variable rows ──────────────────────────────────────────────────────
  const foundList = [...found.values()].slice(0, 150);

  // AI-assisted CRM-field inference (optional, graceful fallback)
  let aiInferenceUsed = false;
  let aiCrmFields: Record<string, string> = {};
  const crmForInference = crmProvider && crmProvider !== "webee" && crmProvider !== "none" ? crmProvider : "";
  if (args.useAi && crmForInference && foundList.length > 0) {
    try {
      const { data: ws } = await sb.from("workspace_settings")
        .select("openai_api_key").eq("workspace_id", args.workspaceId).maybeSingle();
      const apiKey = ws?.openai_api_key ?? process.env.OPENAI_API_KEY ?? "";
      if (apiKey) {
        aiCrmFields = await aiInferCrmFields(apiKey, crmForInference, foundList.map((f) => f.name));
        aiInferenceUsed = true;
      }
    } catch (err: any) {
      console.warn("[variable-engine] AI CRM inference failed (deterministic fallback):", err?.message);
    }
  }
  const existingCrmMapping: Record<string, unknown> =
    cfg?.crm_field_mapping && typeof cfg.crm_field_mapping === "object" && !Array.isArray(cfg.crm_field_mapping)
      ? (cfg.crm_field_mapping as Record<string, unknown>) : {};

  // Existing registry rows — reviewed rows are never clobbered.
  const { data: existingRows } = await sb.from("systemmind_dynamic_variables")
    .select("id, name, status")
    .eq("workspace_id", args.workspaceId).eq("agent_id", args.agentId);
  const existingByName = new Map<string, any>((existingRows ?? []).map((r: any) => [r.name, r]));

  // Scan row first (variables reference it)
  const nowIso = new Date().toISOString();
  let newVariableCount = 0;

  const reportVariables = foundList.map((f) => {
    const cls = classifyVariable(f.name);
    const declared = f.declaredType ? DECLARED_TYPE_MAP[f.declaredType.toLowerCase()] : undefined;
    return {
      name: f.name,
      dataType: declared ?? cls.dataType,
      varClass: cls.varClass,
      sources: f.sources,
      direction: defaultDirection(cls.varClass, f.fromExtraction),
    };
  });

  const report: DetectedRequirementsReport = {
    agentId: String(agent.id),
    agentName: String(agent.name ?? "Agent"),
    agentType: String(settings.agentType ?? agent.agent_type ?? "custom"),
    channel: settings.channelType === "whatsapp" ? "whatsapp" : "voice",
    scannedAt: nowIso,
    variableCount: foundList.length,
    newVariableCount: 0, // patched below
    variables: reportVariables,
    requiredIntegrations: [...integrations].sort(),
    requiredCredentialNames: credentialNames,
    requiredWebhookEvents: [...webhookEvents].sort(),
    hasBookingLogic,
    hasTransferLogic,
    hasWebhookLogic,
    aiInferenceUsed,
  };
  assertNoCredentialValues(report, "Agent scan report");

  const { data: scanRow, error: scanErr } = await sb.from("systemmind_agent_scans").insert({
    workspace_id: args.workspaceId,
    agent_id: args.agentId,
    created_by_user_id: args.userId,
    status: "completed",
    report,
    ai_inference_used: aiInferenceUsed,
  }).select("id").single();
  if (scanErr) throw new Error(`Failed to record scan: ${scanErr.message}`);
  const scanId = String(scanRow.id);

  // Upsert variables: new names → detected rows; existing detected rows →
  // refresh sources/suggestions; reviewed rows → only refresh detected_sources.
  for (const f of foundList) {
    const cls = classifyVariable(f.name);
    const declared = f.declaredType ? DECLARED_TYPE_MAP[f.declaredType.toLowerCase()] : undefined;
    const dataType = declared ?? cls.dataType;
    const sensitivity = (cls as any).sensitivity ?? "standard";
    const dest = suggestWebeeCoordinate(f.name);
    const destCoord = splitCoordinate(dest.coord);
    const direction = defaultDirection(cls.varClass, f.fromExtraction);
    const crmField =
      String(existingCrmMapping[f.name] ?? "") ||
      aiCrmFields[f.name] ||
      suggestCrmFieldFromDefinitions(crmForInference, f.name);

    const existing = existingByName.get(f.name);
    if (existing && existing.status !== "detected") {
      await sb.from("systemmind_dynamic_variables")
        .update({ detected_sources: f.sources, scan_id: scanId, updated_at: nowIso })
        .eq("id", existing.id).eq("workspace_id", args.workspaceId);
      continue;
    }

    const payload = {
      workspace_id: args.workspaceId,
      agent_id: args.agentId,
      scan_id: scanId,
      name: f.name,
      label: f.name.replace(/[_.]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      description: "",
      data_type: dataType,
      is_required: cls.required,
      direction,
      source_system: f.fromExtraction ? "retell" : "webee",
      source_object: f.fromExtraction ? "call" : destCoord.object,
      source_field: f.fromExtraction ? f.name : destCoord.field,
      destination_system: destCoord.system,
      destination_object: destCoord.object,
      destination_field: crmField && direction === "webee_to_crm_postcall" ? crmField : destCoord.field,
      sensitivity,
      allow_send_to_retell: sensitivity !== "restricted",
      allow_store_in_webee: true,
      allow_write_to_crm: sensitivity !== "restricted",
      var_class: cls.varClass,
      detected_sources: f.sources,
      confidence: aiCrmFields[f.name] ? "medium" : dest.confidence,
      status: "detected",
      created_by_user_id: args.userId,
      updated_at: nowIso,
    };
    assertNoCredentialValues(payload, `Variable ${f.name}`);

    if (existing) {
      await sb.from("systemmind_dynamic_variables").update(payload)
        .eq("id", existing.id).eq("workspace_id", args.workspaceId);
    } else {
      const { error: insErr } = await sb.from("systemmind_dynamic_variables").insert(payload);
      if (insErr && insErr.code !== "23505") throw new Error(`Failed to save variable "${f.name}": ${insErr.message}`);
      if (!insErr) newVariableCount += 1;
    }
  }

  report.newVariableCount = newVariableCount;
  await sb.from("systemmind_agent_scans").update({ report }).eq("id", scanId);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: "variable_engine_scan",
    targetType: "agent",
    targetId: args.agentId,
    finalAfterState: { scanId, variableCount: foundList.length, newVariableCount, aiInferenceUsed },
  }).catch(() => {});

  const variables = await listDynamicVariablesServer({ workspaceId: args.workspaceId, agentId: args.agentId });
  return { scanId, report, variables };
}

// ── Registry reads ─────────────────────────────────────────────────────────────

function rowToVariable(row: any): DynamicVariable {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    name: String(row.name),
    label: String(row.label ?? ""),
    description: String(row.description ?? ""),
    dataType: row.data_type,
    isRequired: !!row.is_required,
    defaultValue: String(row.default_value ?? ""),
    exampleValue: String(row.example_value ?? ""),
    direction: row.direction,
    sourceSystem: String(row.source_system ?? ""), sourceObject: String(row.source_object ?? ""), sourceField: String(row.source_field ?? ""),
    destinationSystem: String(row.destination_system ?? ""), destinationObject: String(row.destination_object ?? ""), destinationField: String(row.destination_field ?? ""),
    validationRule: String(row.validation_rule ?? ""),
    fallbackValue: String(row.fallback_value ?? ""),
    sensitivity: String(row.sensitivity ?? "standard"),
    allowSendToRetell: !!row.allow_send_to_retell,
    allowStoreInWebee: !!row.allow_store_in_webee,
    allowWriteToCrm: !!row.allow_write_to_crm,
    varClass: String(row.var_class ?? "custom"),
    detectedSources: Array.isArray(row.detected_sources) ? row.detected_sources : [],
    confidence: row.confidence ?? null,
    status: row.status,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listDynamicVariablesServer(args: {
  workspaceId: string; agentId: string;
}): Promise<DynamicVariable[]> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_dynamic_variables")
    .select("*")
    .eq("workspace_id", args.workspaceId).eq("agent_id", args.agentId)
    .order("name", { ascending: true });
  if (error) throw new Error(`Failed to list variables: ${error.message}`);
  return (data ?? []).map(rowToVariable);
}

export async function getLatestScanServer(args: {
  workspaceId: string; agentId: string;
}): Promise<{ scanId: string; report: DetectedRequirementsReport; createdAt: string } | null> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_agent_scans")
    .select("id, report, created_at")
    .eq("workspace_id", args.workspaceId).eq("agent_id", args.agentId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to load scan: ${error.message}`);
  return data ? { scanId: String(data.id), report: data.report as DetectedRequirementsReport, createdAt: String(data.created_at) } : null;
}

// ── Review / edit lifecycle ────────────────────────────────────────────────────

const EDITABLE_FIELDS = new Set([
  "label", "description", "data_type", "is_required", "default_value", "example_value",
  "direction", "source_system", "source_object", "source_field",
  "destination_system", "destination_object", "destination_field",
  "validation_rule", "fallback_value", "sensitivity",
  "allow_send_to_retell", "allow_store_in_webee", "allow_write_to_crm",
]);

export async function reviewDynamicVariableServer(args: {
  workspaceId: string;
  userId: string | null;
  variableId: string;
  action: "approve" | "reject" | "edit" | "reopen";
  edits?: Record<string, unknown>;
}): Promise<DynamicVariable> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;

  const { data: row, error } = await sb.from("systemmind_dynamic_variables")
    .select("*").eq("id", args.variableId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Variable not found in this workspace.");

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: nowIso };

  if (args.action === "edit") {
    const edits = args.edits ?? {};
    for (const [k, v] of Object.entries(edits)) {
      if (!EDITABLE_FIELDS.has(k)) throw new Error(`Field "${k}" is not editable.`);
      patch[k] = v;
    }
    patch.status = "edited";
    patch.reviewed_by_user_id = args.userId;
    patch.reviewed_at = nowIso;
  } else if (args.action === "approve") {
    patch.status = "approved";
    patch.reviewed_by_user_id = args.userId;
    patch.reviewed_at = nowIso;
  } else if (args.action === "reject") {
    patch.status = "rejected";
    patch.reviewed_by_user_id = args.userId;
    patch.reviewed_at = nowIso;
  } else if (args.action === "reopen") {
    patch.status = "detected";
    patch.reviewed_by_user_id = null;
    patch.reviewed_at = null;
  }

  assertNoCredentialValues(patch, `Variable review ${row.name}`);
  const { data: updated, error: uErr } = await sb.from("systemmind_dynamic_variables")
    .update(patch).eq("id", args.variableId).eq("workspace_id", args.workspaceId)
    .select("*").single();
  if (uErr) throw new Error(`Failed to update variable: ${uErr.message}`);

  await writeSystemMindAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    actionType: `variable_${args.action}`,
    targetType: "dynamic_variable",
    targetId: args.variableId,
    finalAfterState: { name: row.name, action: args.action },
  }).catch(() => {});

  return rowToVariable(updated);
}

// ── Transformation rules ───────────────────────────────────────────────────────

export type TransformationRule = {
  id: string; name: string; description: string; ruleType: string;
  config: Record<string, unknown>; isActive: boolean; createdAt: string;
};

function rowToRule(row: any): TransformationRule {
  return {
    id: String(row.id), name: String(row.name), description: String(row.description ?? ""),
    ruleType: String(row.rule_type), config: row.config ?? {}, isActive: !!row.is_active,
    createdAt: String(row.created_at),
  };
}

export async function listTransformationRulesServer(args: { workspaceId: string }): Promise<TransformationRule[]> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_transformation_rules")
    .select("*").eq("workspace_id", args.workspaceId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToRule);
}

export async function saveTransformationRuleServer(args: {
  workspaceId: string; userId: string | null;
  id?: string | null; name: string; description?: string;
  ruleType: string; config: Record<string, unknown>; isActive?: boolean;
}): Promise<TransformationRule> {
  assertNotWbahWorkspace(args.workspaceId);
  if (!TRANSFORM_RULE_TYPES.includes(args.ruleType as any)) throw new Error(`Unknown rule type "${args.ruleType}".`);
  const sb = supabaseAdmin as any;
  const payload = {
    workspace_id: args.workspaceId,
    name: args.name.slice(0, 160),
    description: (args.description ?? "").slice(0, 1000),
    rule_type: args.ruleType,
    config: args.config ?? {},
    is_active: args.isActive !== false,
    created_by_user_id: args.userId,
    updated_at: new Date().toISOString(),
  };
  assertNoCredentialValues(payload, `Transformation rule ${args.name}`);
  if (args.id) {
    const { data, error } = await sb.from("systemmind_transformation_rules")
      .update(payload).eq("id", args.id).eq("workspace_id", args.workspaceId).select("*").single();
    if (error) throw new Error(error.message);
    return rowToRule(data);
  }
  const { data, error } = await sb.from("systemmind_transformation_rules")
    .insert(payload).select("*").single();
  if (error) throw new Error(error.message.includes("uq_sm_transform_rules") ? `A rule named "${args.name}" already exists.` : error.message);
  return rowToRule(data);
}

export async function deleteTransformationRuleServer(args: {
  workspaceId: string; userId: string | null; id: string;
}): Promise<void> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const { error } = await sb.from("systemmind_transformation_rules")
    .delete().eq("id", args.id).eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
}

// ── Mappings ───────────────────────────────────────────────────────────────────

export type VariableMappingRow = {
  id: string; variableId: string; agentId: string; direction: string;
  sourceSystem: string; sourceObject: string; sourceField: string;
  destinationSystem: string; destinationObject: string; destinationField: string;
  transformationRuleId: string | null; isRequired: boolean; isIgnored: boolean; notes: string;
};

function rowToMapping(row: any): VariableMappingRow {
  return {
    id: String(row.id), variableId: String(row.variable_id), agentId: String(row.agent_id),
    direction: String(row.direction),
    sourceSystem: String(row.source_system ?? ""), sourceObject: String(row.source_object ?? ""), sourceField: String(row.source_field ?? ""),
    destinationSystem: String(row.destination_system ?? ""), destinationObject: String(row.destination_object ?? ""), destinationField: String(row.destination_field ?? ""),
    transformationRuleId: row.transformation_rule_id ? String(row.transformation_rule_id) : null,
    isRequired: !!row.is_required, isIgnored: !!row.is_ignored, notes: String(row.notes ?? ""),
  };
}

export async function listVariableMappingsServer(args: {
  workspaceId: string; agentId: string;
}): Promise<VariableMappingRow[]> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("systemmind_variable_mappings")
    .select("*").eq("workspace_id", args.workspaceId).eq("agent_id", args.agentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToMapping);
}

const MAPPING_DIRECTIONS = new Set([
  "crm_to_webee", "webee_to_retell_precall", "retell_to_webee",
  "webee_to_crm_postcall", "retell_to_crm_via_webee", "bidirectional",
]);

export async function saveVariableMappingServer(args: {
  workspaceId: string; userId: string | null;
  id?: string | null; variableId: string; direction: string;
  sourceSystem?: string; sourceObject?: string; sourceField?: string;
  destinationSystem?: string; destinationObject?: string; destinationField?: string;
  transformationRuleId?: string | null; isRequired?: boolean; isIgnored?: boolean; notes?: string;
}): Promise<VariableMappingRow> {
  assertNotWbahWorkspace(args.workspaceId);
  if (!MAPPING_DIRECTIONS.has(args.direction)) throw new Error(`Unknown direction "${args.direction}".`);
  const sb = supabaseAdmin as any;

  // Variable must belong to this workspace (blocks cross-tenant references).
  const { data: v, error: vErr } = await sb.from("systemmind_dynamic_variables")
    .select("id, agent_id").eq("id", args.variableId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (vErr) throw new Error(vErr.message);
  if (!v) throw new Error("Variable not found in this workspace.");

  if (args.transformationRuleId) {
    const { data: r } = await sb.from("systemmind_transformation_rules")
      .select("id").eq("id", args.transformationRuleId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!r) throw new Error("Transformation rule not found in this workspace.");
  }

  const payload = {
    workspace_id: args.workspaceId,
    variable_id: args.variableId,
    agent_id: v.agent_id,
    direction: args.direction,
    source_system: args.sourceSystem ?? "", source_object: args.sourceObject ?? "", source_field: args.sourceField ?? "",
    destination_system: args.destinationSystem ?? "", destination_object: args.destinationObject ?? "", destination_field: args.destinationField ?? "",
    transformation_rule_id: args.transformationRuleId ?? null,
    is_required: args.isRequired === true,
    is_ignored: args.isIgnored === true,
    notes: (args.notes ?? "").slice(0, 1000),
    updated_at: new Date().toISOString(),
  };
  assertNoCredentialValues(payload, "Variable mapping");

  if (args.id) {
    const { data, error } = await sb.from("systemmind_variable_mappings")
      .update(payload).eq("id", args.id).eq("workspace_id", args.workspaceId).select("*").single();
    if (error) throw new Error(error.message);
    return rowToMapping(data);
  }
  const { data, error } = await sb.from("systemmind_variable_mappings")
    .insert(payload).select("*").single();
  if (error) throw new Error(error.code === "23505" ? "A mapping for this variable, direction and destination already exists." : error.message);
  return rowToMapping(data);
}

export async function deleteVariableMappingServer(args: {
  workspaceId: string; id: string;
}): Promise<void> {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const { error } = await sb.from("systemmind_variable_mappings")
    .delete().eq("id", args.id).eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
}

// ── Transformation testing (pure — sample data in, full trace out) ────────────

export type TransformationTestTrace = {
  sourceValue: unknown;
  transformed: TransformResult;
  destinationValue: unknown;
  validation: { valid: boolean; error?: string };
  error: string | null;
};

export function runTransformationTest(args: {
  ruleType: string;
  config: Record<string, unknown>;
  sampleValue: unknown;
  dataType?: string;          // validate output against this variable data type
  fallbackValue?: unknown;    // applied when transform fails or output empty
}): TransformationTestTrace {
  const transformed = applyTransformation(args.ruleType, args.sampleValue, args.config ?? {});
  let destinationValue: unknown = transformed.ok ? transformed.value : undefined;
  let error: string | null = transformed.ok ? null : (transformed.error ?? "Transformation failed.");
  if ((!transformed.ok || destinationValue === "" || destinationValue === null || destinationValue === undefined)
      && args.fallbackValue !== undefined && args.fallbackValue !== "") {
    destinationValue = args.fallbackValue;
    error = transformed.ok ? null : `${error} → fallback applied.`;
  }
  const validation = args.dataType
    ? validateByDataType(args.dataType, destinationValue)
    : { valid: true as const };
  return { sourceValue: args.sampleValue, transformed, destinationValue, validation, error };
}

export async function testTransformationRuleServer(args: {
  workspaceId: string;
  ruleId?: string | null;
  ruleType?: string;
  config?: Record<string, unknown>;
  sampleValue: unknown;
  dataType?: string;
  fallbackValue?: unknown;
}): Promise<TransformationTestTrace> {
  assertNotWbahWorkspace(args.workspaceId);
  let ruleType = args.ruleType ?? "";
  let config = args.config ?? {};
  if (args.ruleId) {
    const sb = supabaseAdmin as any;
    const { data: r, error } = await sb.from("systemmind_transformation_rules")
      .select("rule_type, config").eq("id", args.ruleId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!r) throw new Error("Transformation rule not found in this workspace.");
    ruleType = String(r.rule_type);
    config = r.config ?? {};
  }
  if (!ruleType) throw new Error("Provide ruleId or ruleType.");
  return runTransformationTest({ ruleType, config, sampleValue: args.sampleValue, dataType: args.dataType, fallbackValue: args.fallbackValue });
}
