/**
 * WBAH production n8n post-call pipeline ↔ SystemMind integration constants.
 * Native WEBEE execution lives in src/lib/wbah/post-call/ (n8n migration).
 */

import { wbahWebeeRetellWebhookUrl } from "@/lib/wbah/post-call/wbah-retell-agents.shared";
import {
  defaultWbahPostCallWorkflowConfig,
  wbahStepsToFlowDefinition,
} from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import {
  defaultRebookPostCallWorkflowConfig,
} from "@/lib/wbah/workflow/wbah-rebook-workflow.shared";

export const WBAH_N8N_WORKFLOW_ID = "yR3vAIdZNLovD8jx";
export const WBAH_N8N_WEBHOOK_URL =
  "https://bespoke.app.n8n.cloud/webhook/392d5d13-7ee2-4fa0-ad46-7736ba4603bf";
export const WBAH_N8N_INSTANCE = "https://bespoke.app.n8n.cloud";

/** Target Retell webhook after cutover from n8n (voice-webhook alias). */
export const WBAH_WEBEE_RETELL_WEBHOOK_URL = wbahWebeeRetellWebhookUrl();

/** Global builder template — Real estate Client Qualification (call script source). */
export const WBAH_CALL_SCRIPT_TEMPLATE_ID = "3911dcb4-c9a1-4f0b-b61e-ce03771e73dd";
export const WBAH_CALL_SCRIPT_TEMPLATE_NAME = "Real estate - Client Qualification";

export type WbahRetellAgentRef = {
  retellAgentId: string;
  label: string;
  role: "new_leads_dialer" | "qualification" | "tried_to_contact" | "rebooking";
};

/** Production WBAH dialer agents that share the same n8n webhook. */
export const WBAH_N8N_RETELL_AGENTS: WbahRetellAgentRef[] = [
  {
    retellAgentId: "agent_53f739ef52b1244f5d86fcd955",
    label: "WBAH New Leads Agent (new workspace)",
    role: "new_leads_dialer",
  },
  {
    retellAgentId: "agent_a03162ee94d003c298817e727c",
    label: "WBAH New Leads Agent",
    role: "new_leads_dialer",
  },
  {
    retellAgentId: "agent_698b8e07acac970aefaf0a52b6",
    label: "WBAH New leads",
    role: "new_leads_dialer",
  },
  {
    retellAgentId: "agent_d6a2d73962c52f673b98f56218",
    label: "WBAH New Leads Agent (SystemMind test)",
    role: "new_leads_dialer",
  },
  {
    retellAgentId: "agent_50598858538a69272a4bf04bf8",
    label: "WBAH Client qualification agent",
    role: "qualification",
  },
  {
    retellAgentId: "agent_0440750bb59597eef7352901bf",
    label: "WBAH Client qualification agent outbound",
    role: "qualification",
  },
];

export const WBAH_NEW_LEADS_AGENTS = WBAH_N8N_RETELL_AGENTS.filter(
  (a) => a.role === "new_leads_dialer",
);

export const WBAH_REBOOK_AGENTS: WbahRetellAgentRef[] = [
  {
    retellAgentId: "agent_b642aebb65a218741169ba7759",
    label: "WBAH Rebooking Agent (new workspace)",
    role: "rebooking",
  },
  {
    retellAgentId: "agent_1e1b13bd9564da4556370fe0be",
    label: "Rebooking consultation agent",
    role: "rebooking",
  },
  {
    retellAgentId: "agent_0e07f26bebd25acbd82993e3a3",
    label: "Rebooking agent: WBAH client qualification agent",
    role: "rebooking",
  },
];

/** Documented Rebook post-call branches (Opportunity-only — no Calendly, no Lead PATCH). */
export const WBAH_REBOOK_N8N_BRANCHES = [
  {
    id: "rebook_dynamics",
    label: "call_analyzed → Dynamics Opportunity PATCH + note",
    summary:
      "Format rebook fields → D365 token → PATCH /opportunities({id}) → timeline note on Opportunity.",
  },
  {
    id: "rebook_dashboard",
    label: "call_analyzed → Dashboard (no Calendly)",
    summary: "POST call-output-data/create with call result; booking handled in Retell.",
  },
  {
    id: "lifecycle_raw",
    label: "call_started / call_ended → raw dashboard POST",
    summary: "Lifecycle events for Rebook opportunity rows.",
  },
  {
    id: "webee_live",
    label: "Live transcript ingest",
    summary: "WEBEE live panel on every event.",
  },
];

/** Documented n8n branches (for SystemMind template library + build console). */
export const WBAH_N8N_BRANCHES = [
  {
    id: "dashboard_analyzed",
    label: "call_analyzed → Dashboard + Calendly",
    summary:
      "Format slot → Create Calendly link → Build slot URL → POST call-output-data/create with booking + callback fields.",
  },
  {
    id: "dynamics_allens",
    label: "call_analyzed → Dynamics (Allen's Logic)",
    summary:
      "D365 token → GET lead status → Allen's Logic V5 → Build CRM Payload → PATCH lead (status, appointments, callback).",
  },
  {
    id: "dynamics_agentic",
    label: "call_analyzed → Dynamics (structured_json_output)",
    summary:
      "Parse structured_json_output → normalize CRM fields → PATCH lead with property/contact details.",
  },
  {
    id: "lifecycle_raw",
    label: "call_started / call_ended → Dashboard raw",
    summary: "POST call-output-data/create with cleaned raw_data only (no booking fields).",
  },
  {
    id: "webee_live",
    label: "WEBEE Live Ingest (parallel)",
    summary: "POST /api/public/retell-live-ingest for live transcript panel in WEBEE.",
  },
] as const;

export const WBAH_TEMPLATE_SYSTEMMIND_NAME = "WBAH New Leads — Retell Post-Call (n8n)";

/** Pre-built call-script deployment config (mirrors global template post-call extraction). */
export function buildWbahNewLeadsCallScriptConfig() {
  return {
    agent_summary:
      "WBAH outbound New Leads qualification agent. Uses the Client Qualification conversation flow, " +
      "Calendly slot booking during the call, and post-call extraction to Dynamics via native WEBEE pipeline.",
    deployment_readiness_score: 92,
    suggested_agent_type: "client_qualification",
    retell_webhook_url: WBAH_WEBEE_RETELL_WEBHOOK_URL,
    legacy_n8n_webhook_url: WBAH_N8N_WEBHOOK_URL,
    n8n_workflow_id: WBAH_N8N_WORKFLOW_ID,
    global_template_id: WBAH_CALL_SCRIPT_TEMPLATE_ID,
    dialer_agents: WBAH_NEW_LEADS_AGENTS,
    required_variables: [
      { name: "lead_id", source: "retell_llm_dynamic_variables", required: true },
      { name: "first_name", source: "retell_llm_dynamic_variables" },
      { name: "last_name", source: "retell_llm_dynamic_variables" },
      { name: "property_address_line2", source: "retell_llm_dynamic_variables" },
      { name: "available_slots", source: "retell_llm_dynamic_variables" },
    ],
    extraction_fields: [
      { name: "calendly_slot", type: "json", description: "Preferred appointment date/time (UK local)." },
      { name: "email_address", type: "string", description: "Caller email for Calendly invitee." },
      { name: "structured_json_output", type: "json", description: "Dynamics-mapped property + contact fields." },
      { name: "callback_datetime", type: "string", description: "Callback request datetime (UK → UTC in n8n)." },
      { name: "callback_type", type: "string", description: "Callback reason/type." },
      { name: "user_sentiment", type: "enum", description: "positive | negative | neutral — drives Allen's Logic." },
      { name: "call_summary", type: "string" },
    ],
    outcome_schema: [
      { outcome: "appointment_booked", description: "Positive sentiment + valid Calendly URL → Logged in Dynamics." },
      { outcome: "callback_requested", description: "callback_datetime set → Call Back Request status." },
      { outcome: "negative_disqualified", description: "Negative sentiment → Disqualified." },
      { outcome: "positive_no_booking", description: "Positive, no Calendly → Tried To Contact." },
    ],
    crm_field_mapping: {
      new_currentstatus: "Allen's Logic V5 (181510002 callback, 100000008 logged, etc.)",
      cos_calendly_booking_url: "Build Slot URL node output",
      cos_appointment_date: "Format Data / slot URL",
      cos_appointment_time: "Format Data UTC ISO",
      cos_callbackrequest: "callback_datetime normalized to UTC",
      cos_user_sentiment: "Retell call_analysis.user_sentiment",
      cos_call_summary: "Retell call_analysis.call_summary",
      verified_details: "structured_json_output.verified_details → Dynamics PATCH",
    },
    webhook_payload_schema: {
      event: "call_analyzed | call_started | call_ended",
      "call.retell_llm_dynamic_variables.lead_id": "required",
      "call.call_analysis.custom_analysis_data": "calendly_slot, structured_json_output, email_address, callback_*",
    },
    go_live_checklist: [
      "Set WBAH_POST_CALL_ENABLED=true on WEBEE production.",
      "Set CALENDLY_API_TOKEN (or WBAH_CALENDLY_API_TOKEN) and verify event type EBGJSBH4HVGLYFN6.",
      "Confirm DYNAMICS_* env vars (tenant, client, secret, org URL).",
      "Point Retell agent webhook_url to WEBEE (not n8n): " + WBAH_WEBEE_RETELL_WEBHOOK_URL,
      "Remove n8n WEBEE Live Ingest branch (WEBEE receives Retell directly).",
      "lead_id present in retell_llm_dynamic_variables for every dial.",
      "Test call_analyzed end-to-end: dashboard row + Dynamics status update.",
    ],
  };
}

/** SystemMind Build Workspace v1 config for WBAH New Leads + native post-call. */
export function buildWbahNewLeadsSystemMindConfig() {
  const script = buildWbahNewLeadsCallScriptConfig();
  const wbahPipeline = defaultWbahPostCallWorkflowConfig({
    retell_agents: WBAH_NEW_LEADS_AGENTS.map((a) => a.retellAgentId),
  });
  const flow = wbahStepsToFlowDefinition(wbahPipeline);

  return {
    agent_prompt: [
      "You are the WBAH (We Buy Any House) outbound New Leads qualification agent.",
      "Follow the Real estate - Client Qualification conversation flow:",
      "introduce yourself, confirm property details, qualify the seller, offer a free consultation,",
      "and book a Calendly appointment when the caller is interested.",
      "Use Check_Availability_Calendly during the call when discussing slots.",
      "Always capture lead_id from dynamic variables for CRM sync after the call.",
      "",
      "Post-call automation runs in WEBEE (src/lib/wbah/post-call): dashboard ingest, Calendly link creation,",
      "Allen's Logic status rules, and Dynamics 365 PATCH.",
    ].join("\n"),
    workflow: {
      name: WBAH_TEMPLATE_SYSTEMMIND_NAME,
      purpose:
        "Native WEBEE post-call pipeline for WBAH New Leads outbound agents. Replaces n8n workflow " +
        "yR3vAIdZNLovD8jx: WeeBespoke dashboard ingest, Calendly links, Dynamics Allen's Logic + agentic PATCH.",
      trigger_type: "call_completed",
      trigger_config: {
        external_orchestrator: "webee",
        webee_webhook_url: WBAH_WEBEE_RETELL_WEBHOOK_URL,
        legacy_n8n_workflow_id: WBAH_N8N_WORKFLOW_ID,
        retell_agents: WBAH_NEW_LEADS_AGENTS.map((a) => a.retellAgentId),
        required_dynamic_variable: "lead_id",
        wbah_post_call: wbahPipeline,
      },
      steps: flow.steps as any[],
    },
    variables: script.required_variables.map((v) => ({
      name: v.name,
      description: v.source,
      source: v.source,
    })),
    extraction_fields: script.extraction_fields.map((f) => ({
      name: f.name,
      type: f.type,
      description: f.description,
    })),
    follow_up_rules: [],
    channel_setup: {
      retell: {
        webhook_mode: "webee_native",
        webhook_url: WBAH_WEBEE_RETELL_WEBHOOK_URL,
        legacy_n8n_webhook_url: WBAH_N8N_WEBHOOK_URL,
        dialer_agents: WBAH_NEW_LEADS_AGENTS,
        call_script_template_id: WBAH_CALL_SCRIPT_TEMPLATE_ID,
        call_script_template_name: WBAH_CALL_SCRIPT_TEMPLATE_NAME,
      },
      wbah_post_call: wbahPipeline,
      n8n: {
        workflow_id: WBAH_N8N_WORKFLOW_ID,
        webhook_url: WBAH_N8N_WEBHOOK_URL,
        branches: WBAH_N8N_BRANCHES,
        deprecated: true,
      },
      webee: {
        live_ingest_path: "/api/public/retell-live-ingest",
        dashboard_read_api: "https://uat-api.webespokeai.com/call-output-data/get-user-history",
      },
    },
    required_credentials: [
      "n8n_production_webhook",
      "dynamics_oauth_client_credentials",
      "calendly_api_token",
      "webespoke_uat_api",
      "webee_live_ingest_secret",
    ],
    risks: [
      "Cutover requires Retell webhook_url change on every WBAH dialer agent.",
      "Set WBAH_POST_CALL_ENABLED=true before cutover or only live transcripts will run.",
      "Allen's Logic and agentic Dynamics PATCH both fire on call_analyzed when lead_id is set.",
    ],
    test_plan: [
      "Place test call with lead_id in dynamic variables; confirm n8n execution succeeds.",
      "Verify call-output-data/create row appears in WeeBespoke UAT.",
      "Confirm Dynamics lead status matches sentiment + booking outcome.",
      "Confirm live transcript appears in WEBEE via retell-live-ingest.",
    ],
  };
}

/** SystemMind template for WBAH Rebook — separate webhook workflow (Opportunity-only). */
export function buildWbahRebookSystemMindConfig() {
  const wbahPipeline = defaultRebookPostCallWorkflowConfig({
    retell_agents: WBAH_REBOOK_AGENTS.map((a) => a.retellAgentId),
  });
  const flow = wbahStepsToFlowDefinition(wbahPipeline);

  return {
    agent_prompt: [
      "You are the WBAH Rebook Initial Consultation agent.",
      "The CRM record is a Dynamics Opportunity — not a Lead.",
      "Retell dynamic variables MUST include:",
      "  crm_type=opportunity",
      "  opportunity_id={{opportunityid}}",
      "  optional originating_lead_id for reference only (never PATCH Lead after call).",
      "Booking is handled in-call via Retell — no post-call Calendly automation.",
    ].join("\n"),
    workflow: {
      name: "WBAH Rebook Post-Call (Opportunity)",
      purpose:
        "Native WEBEE post-call for Rebook agents. PATCH Dynamics Opportunity + timeline note only.",
      trigger_type: "call_completed",
      trigger_config: {
        external_orchestrator: "webee",
        webee_webhook_url: WBAH_WEBEE_RETELL_WEBHOOK_URL,
        retell_agents: WBAH_REBOOK_AGENTS.map((a) => a.retellAgentId),
        required_dynamic_variables: ["crm_type", "opportunity_id"],
        wbah_post_call: wbahPipeline,
      },
      steps: flow.steps as any[],
    },
    variables: [
      { name: "crm_type", description: "Must be opportunity", source: "Retell dynamic vars" },
      { name: "opportunity_id", description: "Dynamics opportunityid", source: "Retell dynamic vars" },
      { name: "originating_lead_id", description: "Reference only", source: "Retell dynamic vars" },
    ],
    channel_setup: {
      retell: {
        webhook_mode: "webee_native",
        webhook_url: WBAH_WEBEE_RETELL_WEBHOOK_URL,
        dialer_agents: WBAH_REBOOK_AGENTS,
      },
      wbah_post_call: wbahPipeline,
      n8n: {
        deprecated: true,
        note: "Use WEBEE native Rebook workflow — do not share New Leads n8n webhook",
      },
    },
    risks: [
      "Do not point Rebook agents at the New Leads n8n webhook — it PATCHes Leads.",
      "lead_id in legacy rows may hold opportunityid — always set crm_type=opportunity.",
    ],
    test_plan: [
      "Rebook test call with crm_type=opportunity and opportunity_id set.",
      "Confirm [DynamicsOpportunity] Synced log and Opportunity fields updated in D365.",
      "Confirm originating Lead is unchanged.",
      "Confirm no Calendly nodes run.",
    ],
  };
}

export function buildWbahN8nManualUnderstanding() {
  return {
    purpose:
      "Receive Retell webhooks for WBAH outbound agents, persist call analysis to WeeBespoke dashboard, " +
      "create Calendly booking links, and update Dynamics 365 leads (Allen's Logic + structured field PATCH).",
    business_summary:
      "Production post-call pipeline for WBAH New Leads and qualification dialers. " +
      "Requires lead_id in Retell dynamic variables.",
    technical_summary:
      "Webhook trigger fans out to 6 branches: dashboard+Calendly on call_analyzed, Dynamics token merge, " +
      "agentic structured_json PATCH, raw lifecycle events, and WEBEE live ingest.",
    required_services: ["Retell", "n8n", "Dynamics 365", "Calendly", "WeeBespoke UAT", "WEBEE"],
    confidence: 95,
    branches: WBAH_N8N_BRANCHES,
  };
}

export function buildWbahN8nStructureSnapshot() {
  return {
    nodes: [
      { id: "webhook", name: "Webhook", type: "n8n-nodes-base.webhook" },
      { id: "filter_lead", name: "Filter lead_id", type: "n8n-nodes-base.filter" },
      { id: "format_data", name: "Format Data", type: "n8n-nodes-base.code" },
      { id: "calendly_link", name: "Create Booking Link", type: "n8n-nodes-base.httpRequest" },
      { id: "build_slot", name: "Build Slot URL", type: "n8n-nodes-base.code" },
      { id: "post_dashboard", name: "POST TO DASHBOARD", type: "n8n-nodes-base.httpRequest" },
      { id: "d365_token", name: "GET D365 Token", type: "n8n-nodes-base.httpRequest" },
      { id: "allens_logic", name: "Apply Allens Logic", type: "n8n-nodes-base.code" },
      { id: "build_crm", name: "Build CRM Payload", type: "n8n-nodes-base.code" },
      { id: "patch_dynamics", name: "POST SUMMARY TO 365", type: "n8n-nodes-base.httpRequest" },
      { id: "webee_ingest", name: "WEBEE Live Ingest", type: "n8n-nodes-base.httpRequest" },
    ],
    edges: [
      { from: "webhook", to: "filter_lead" },
      { from: "filter_lead", to: "format_data" },
      { from: "format_data", to: "calendly_link" },
      { from: "calendly_link", to: "build_slot" },
      { from: "build_slot", to: "post_dashboard" },
      { from: "webhook", to: "d365_token" },
      { from: "d365_token", to: "allens_logic" },
      { from: "allens_logic", to: "build_crm" },
      { from: "build_crm", to: "patch_dynamics" },
      { from: "webhook", to: "webee_ingest" },
    ],
    order: [
      "webhook",
      "filter_lead",
      "format_data",
      "calendly_link",
      "build_slot",
      "post_dashboard",
      "d365_token",
      "allens_logic",
      "build_crm",
      "patch_dynamics",
      "webee_ingest",
    ],
  };
}
