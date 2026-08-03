/**
 * Production n8n parameter presets — headers, body, auth, mode, combinator, etc.
 * Merged onto catalog nodes for canvas display (mirrors n8n node editor fields).
 */
import {
  WBAH_WEBEE_RETELL_WEBHOOK_PATH,
  wbahWebeeRetellWebhookUrl,
} from "@/lib/wbah/post-call/wbah-retell-agents.shared";
import type { WbahN8nNodeKind } from "./wbah-n8n-node-catalog.shared";
import {
  pinItemsFromJson,
  WBAH_DEFAULT_EXECUTE_TRIGGER,
  wbahSimulatedWebhookBaseUrl,
} from "./wbah-test-trigger-fixture.shared";
import {
  WBAH_DASHBOARD_ANALYZED_POST_BODY_TEMPLATE,
  WBAH_DASHBOARD_RAW_POST_BODY_TEMPLATE,
} from "@/lib/wbah/post-call/wbah-dashboard-post-body.shared";

export type N8nConditionRule = {
  field: string;
  operator?: string;
  value?: string;
};

export type WbahN8nNodeConfig = {
  summary?: string;
  description?: string;
  automationType?: string;
  /** Filter / IF — n8n "Conditions" panel */
  combinator?: "and" | "or";
  conditions?: N8nConditionRule[];
  condition?: string;
  expression?: string;
  /** WBAH HTTP body builder key (runtime uses native fn instead of inline IIFE). */
  wbahBodyBuilder?: string;
  url?: string;
  path?: string;
  authentication?: string;
  sendQueryParameters?: boolean;
  queryParameters?: Array<{ name: string; value: string }>;
  sendHeaders?: boolean;
  headers?: Array<{ name: string; value: string }>;
  sendBody?: boolean;
  bodyContentType?: string;
  body?: string;
  jsonBody?: string | Record<string, unknown>;
  /** Code */
  mode?: string;
  language?: string;
  code?: string;
  codeHint?: string;
  /** Merge — n8n "Combine" / "all possible combinations" */
  mergeMode?: string;
  combineBy?: string;
  /** HTTP batching (Calendly nodes #10 / #37) */
  batchSize?: number;
  batchIntervalMs?: number;
  /** Wait */
  resume?: string;
  amount?: string | number;
  unit?: string;
  durationMs?: number;
  duration?: string | number;
  /** Webhook trigger */
  httpMethod?: string;
  responseMode?: string;
  /** n8n node Settings tab */
  settings?: N8nNodeSettings;
  /** Pinned test data (n8n "Pin data") */
  pinData?: Record<string, unknown> | unknown[];
  /** Last execution snapshot for editor preview */
  lastExecution?: {
    input?: unknown;
    output?: unknown;
    status?: "success" | "error" | "skipped";
    at?: string;
  };
};

export type N8nNodeSettings = {
  /** Continue | Stop Workflow | Continue (using error output) */
  onError?: "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow";
  retryOnFail?: boolean;
  maxTries?: number;
  waitBetweenTries?: number;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
  notes?: string;
};

export const DEFAULT_N8N_NODE_SETTINGS: N8nNodeSettings = {
  onError: "continueErrorOutput",
  retryOnFail: false,
  maxTries: 3,
  waitBetweenTries: 1000,
  alwaysOutputData: false,
  executeOnce: false,
};

const CALENDLY_AUTH = "Header Auth (Calendly API token)";
const WEBESPOKE_AUTH = "Bearer Auth (WeeBespoke enterprise token)";
const D365_AUTH = "OAuth2 (Dynamics client credentials)";
const WEBEE_INGEST_AUTH = "Header Auth (WEBEE live ingest secret)";

/** Per catalog node id — full n8n-style parameters from production workflow. */
export const WBAH_N8N_NODE_PRESETS: Record<string, Partial<WbahN8nNodeConfig>> = {
  webhook: {
    httpMethod: "POST",
    path: WBAH_WEBEE_RETELL_WEBHOOK_PATH,
    url: wbahWebeeRetellWebhookUrl(wbahSimulatedWebhookBaseUrl()),
    method: "POST",
    authentication: "None",
    responseMode: "On Received",
    summary: "Retell voice webhook ingress (WEBEE / ngrok tunnel)",
    pinData: pinItemsFromJson(WBAH_DEFAULT_EXECUTE_TRIGGER),
  },
  "filter-lead-1": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }}",
        operator: "exists",
      },
    ],
  },
  "call-analyzed-dashboard": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.event }}",
        operator: "equals",
        value: "call_analyzed",
      },
    ],
  },
  "format-data": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "formatWbahRetellCallData",
  },
  "create-booking-link": {
    method: "POST",
    url: "https://api.calendly.com/scheduling_links",
    authentication: CALENDLY_AUTH,
    batchSize: 1,
    batchIntervalMs: 2000,
    sendHeaders: true,
    headers: [
      { name: "Authorization", value: "Bearer {{ $credentials.calendlyApi.token }}" },
      { name: "Accept", value: "application/json" },
      { name: "Content-Type", value: "application/json" },
    ],
    sendBody: true,
    bodyContentType: "JSON",
    jsonBody: {
      max_event_count: 1,
      owner: "https://api.calendly.com/event_types/{{ $env.WBAH_CALENDLY_EVENT_TYPE_ID }}",
      owner_type: "EventType",
    },
    summary: "Calendly scheduling_links (batch 1 / 2s)",
  },
  "build-slot-url": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "buildWbahCalendlySlotUrl",
  },
  merge2: {
    mergeMode: "Combine",
    combineBy: "all",
    summary: "Combine: analyzed webhook + slot URL (all combinations)",
  },
  "post-dashboard-analyzed": {
    method: "POST",
    url: "https://uat-api.webespokeai.com/call-output-data/create",
    authentication: WEBESPOKE_AUTH,
    sendHeaders: true,
    headers: [
      { name: "Authorization", value: "Bearer {{ $credentials.webespoke.accessToken }}" },
      { name: "Content-Type", value: "application/json" },
    ],
    sendBody: true,
    bodyContentType: "JSON",
    wbahBodyBuilder: "dashboard_analyzed",
    body: WBAH_DASHBOARD_ANALYZED_POST_BODY_TEMPLATE,
    summary: "POST call-output-data/create — n8n #10 parity ($('Build Slot URL') slot fields)",
  },
  "filter-lead-2": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }}",
        operator: "exists",
      },
    ],
  },
  "call-analyzed-crm": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.event }}",
        operator: "equals",
        value: "call_analyzed",
      },
    ],
  },
  "get-d365-token": {
    method: "POST",
    url: "https://login.microsoftonline.com/{{ $env.DYNAMICS_TENANT_ID }}/oauth2/v2.0/token",
    authentication: "None",
    sendHeaders: true,
    headers: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }],
    sendBody: true,
    bodyContentType: "Form Urlencoded",
    body: "grant_type=client_credentials&client_id={{ $env.DYNAMICS_CLIENT_ID }}&client_secret={{ $env.DYNAMICS_CLIENT_SECRET }}&scope={{ $env.DYNAMICS_RESOURCE }}",
  },
  "merge-token": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "accessToken forward",
  },
  "merge-token-data": {
    mergeMode: "Combine",
    combineBy: "all",
    summary: "Token + lead extract (all combinations)",
  },
  "filter-lead-3": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }}",
        operator: "exists",
      },
    ],
  },
  "call-analyzed-calendly": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.event }}",
        operator: "equals",
        value: "call_analyzed",
      },
      {
        field: "{{ $json }}",
        operator: "wbah:calendly_slot_not_empty",
      },
    ],
  },
  "webhook-extract": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "Build lead object + verified_details",
  },
  "if-sentiment": {
    combinator: "or",
    conditions: [
      { field: "{{ $json.user_sentiment }}", operator: "is not empty" },
      {
        field: "{{ $json.body.call.call_analysis.user_sentiment }}",
        operator: "is not empty",
      },
      {
        field: "{{ $json.body.call.call_analysis.custom_analysis_data.user_sentiment }}",
        operator: "is not empty",
      },
    ],
  },
  "forward-if-block": {
    mode: "Run Once for All Items",
    language: "JavaScript",
  },
  merge1: {
    mergeMode: "Combine",
    combineBy: "all",
    summary: "Token + lead + slot URL (all combinations)",
  },
  "get-lead-status": {
    method: "GET",
    url: "{{ $env.DYNAMICS_ORG_URL }}/api/data/v9.2/leads({{ $('Merge1').item.json.lead_id || $json.lead_id }})?$select=new_currentstatus,statecode",
    authentication: D365_AUTH,
    sendHeaders: true,
    headers: [
      { name: "Authorization", value: "Bearer {{ $('Merge1').item.json.accessToken || $json.accessToken }}" },
      { name: "Accept", value: "application/json" },
      { name: "OData-MaxVersion", value: "4.0" },
      { name: "OData-Version", value: "4.0" },
    ],
    sendBody: false,
  },
  "apply-allens-logic": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "applyAllensLogicV5",
  },
  "build-crm-payload": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "buildWbahAllensCrmPayload",
  },
  "patch-dynamics-allen": {
    method: "PATCH",
    url: "{{ $env.DYNAMICS_ORG_URL }}/api/data/v9.2/leads({{ $('Merge1').item.json.lead_id || $json.lead_id }})",
    authentication: D365_AUTH,
    sendHeaders: true,
    headers: [
      { name: "Authorization", value: "Bearer {{ $('Merge1').item.json.accessToken || $json.accessToken }}" },
      { name: "Content-Type", value: "application/json" },
      { name: "OData-MaxVersion", value: "4.0" },
      { name: "OData-Version", value: "4.0" },
      { name: "Prefer", value: "return=representation" },
    ],
    sendBody: true,
    bodyContentType: "JSON",
    jsonBody: "{{ $json.crmPayload }}",
    summary: "PATCH lead — Allen's Logic fields",
  },
  "filter-lead-4": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }}",
        operator: "exists",
      },
    ],
  },
  "if-started-ended": {
    combinator: "or",
    conditions: [
      { field: "{{ $json.body.event }}", operator: "equals", value: "call_started" },
      { field: "{{ $json.body.event }}", operator: "equals", value: "call_ended" },
    ],
  },
  "post-dashboard-raw": {
    method: "POST",
    url: "https://uat-api.webespokeai.com/call-output-data/create",
    authentication: WEBESPOKE_AUTH,
    sendHeaders: true,
    headers: [
      { name: "Authorization", value: "Bearer {{ $credentials.webespoke.accessToken }}" },
      { name: "Content-Type", value: "application/json" },
    ],
    sendBody: true,
    bodyContentType: "JSON",
    wbahBodyBuilder: "dashboard_raw",
    body: WBAH_DASHBOARD_RAW_POST_BODY_TEMPLATE,
    summary: "POST call-output-data/create — n8n #26 lifecycle (empty slot fields)",
  },
  "analyzed-calendly-slot": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.event }}",
        operator: "equals",
        value: "call_analyzed",
      },
      {
        field: "{{ $json }}",
        operator: "wbah:calendly_slot_not_empty",
      },
    ],
  },
  "filter-lead-5": {
    combinator: "and",
    conditions: [
      {
        field: "{{ $json.body.call.retell_llm_dynamic_variables.lead_id }}",
        operator: "exists",
      },
    ],
  },
  "get-structured-json": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "Parse structured_json_output",
  },
  "get-all-valid-fields": {
    mode: "Run Once for All Items",
    language: "JavaScript",
  },
  merge4: {
    mergeMode: "Combine",
    combineBy: "all",
  },
  "get-all-valid-fields-1": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    codeHint: "normalizeWbahAgenticCrmFields",
  },
  merge3: {
    mergeMode: "Combine",
    combineBy: "all",
  },
  "patch-dynamics-agentic": {
    method: "PATCH",
    url: "{{ $env.DYNAMICS_ORG_URL }}/api/data/v9.2/leads({{ $('Merge1').item.json.lead_id || $json.lead_id }})",
    authentication: D365_AUTH,
    sendHeaders: true,
    headers: [
      { name: "Authorization", value: "Bearer {{ $('Merge1').item.json.accessToken || $json.accessToken }}" },
      { name: "Content-Type", value: "application/json" },
      { name: "Prefer", value: "return=representation" },
    ],
    sendBody: true,
    bodyContentType: "JSON",
    jsonBody: "{{ $json.agenticFields }}",
    summary: "PATCH lead — structured_json_output fields",
  },
  "clear-data-agentic": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    summary: "statecode, status, sentiment, summary only",
  },
  "webee-live-ingest": {
    method: "POST",
    url: "https://webeebuilder.com/api/public/retell-live-ingest",
    authentication: WEBEE_INGEST_AUTH,
    sendHeaders: true,
    headers: [
      { name: "Content-Type", value: "application/json" },
      { name: "X-WEBEE-Live-Ingest-Secret", value: "{{ $env.WEBEE_LIVE_INGEST_SECRET }}" },
    ],
    sendBody: true,
    bodyContentType: "JSON",
    jsonBody: "{{ $json.body }}",
  },
  "check-appointment-confirmed": {
    combinator: "or",
    conditions: [
      { field: "appointment_confirmed", operator: "is true" },
      {
        field: "appointment_date + appointment_time",
        operator: "is valid",
      },
    ],
  },
  "wait-random-delay": {
    resume: "After Time Interval",
    amount: "5–25",
    unit: "seconds",
    summary: "Random delay before Calendly invitee POST",
  },
  "post-calendly-invitees": {
    method: "POST",
    url: "https://api.calendly.com/invitees",
    authentication: CALENDLY_AUTH,
    batchSize: 1,
    batchIntervalMs: 2000,
    sendHeaders: true,
    headers: [
      { name: "Authorization", value: "Bearer {{ $credentials.calendlyApi.token }}" },
      { name: "Accept", value: "application/json" },
      { name: "Content-Type", value: "application/json" },
    ],
    sendBody: true,
    bodyContentType: "JSON",
    jsonBody: {
      event_type: "https://api.calendly.com/event_types/{{ $env.WBAH_CALENDLY_EVENT_TYPE_ID }}",
      start_time: "{{ $json.startTimeUtc || $json.requestedStartUtc }}",
      invitee: {
        name: "{{ $json.name || $json.customerName }}",
        email: "{{ $json.email }}",
        timezone: "Europe/London",
      },
      event_guests: ["enquiries@webuyanyhouse.co.uk"],
      questions_and_answers: [
        { position: 0, question: "Phone Number", answer: "{{ $json.phone || $json.mobilephone || '+444 444 4444' }}" },
        { position: 1, question: "Property Address", answer: "{{ $json.propertyAddress || $json.address1_line1 || 'Address not provided' }}" },
        { position: 2, question: "Name", answer: "{{ $json.name || $json.customerName || 'Customer' }}" },
      ],
      tracking: {
        utm_source: "api",
        utm_medium: "automation",
        utm_campaign: "default_campaign",
        utm_content: "default_content",
        utm_term: "default_term",
        salesforce_uuid: "{{ $json.salesforceUuid || 'N/A' }}",
      },
    },
    summary: "Auto-book invitee with Q&A (batch 1 / 2s)",
  },
  "wbah-calls-upsert": {
    mode: "Run Once for All Items",
    language: "JavaScript",
    summary: "Upsert call row for reporting",
  },
};

/** Kind-level defaults when node has no preset (copilot / custom nodes). */
export function defaultN8nParamsForKind(kind: WbahN8nNodeKind): Partial<WbahN8nNodeConfig> {
  switch (kind) {
    case "trigger":
      return {
        httpMethod: "POST",
        path: WBAH_WEBEE_RETELL_WEBHOOK_PATH,
        authentication: "None",
        responseMode: "On Received",
      };
    case "http":
      return {
        method: "POST",
        authentication: "None",
        sendHeaders: true,
        sendBody: true,
        bodyContentType: "JSON",
        settings: { ...DEFAULT_N8N_NODE_SETTINGS },
      };
    case "code":
      return {
        mode: "Run Once for All Items",
        language: "JavaScript",
        settings: { ...DEFAULT_N8N_NODE_SETTINGS },
      };
    case "merge":
      return { mergeMode: "Combine", combineBy: "all" };
    case "filter":
    case "if":
      return { combinator: "and" };
    case "wait":
      return { resume: "After Time Interval", unit: "seconds" };
    default:
      return { settings: { ...DEFAULT_N8N_NODE_SETTINGS } };
  }
}

export function mergeN8nNodeConfig(
  nodeId: string,
  kind: WbahN8nNodeKind,
  config: Record<string, unknown> = {},
): WbahN8nNodeConfig {
  const preset = WBAH_N8N_NODE_PRESETS[nodeId] ?? {};
  const kindDefaults = defaultN8nParamsForKind(kind);
  const merged = { ...kindDefaults, ...preset, ...config } as WbahN8nNodeConfig;
  merged.settings = {
    ...DEFAULT_N8N_NODE_SETTINGS,
    ...kindDefaults.settings,
    ...preset.settings,
    ...(config.settings as N8nNodeSettings | undefined),
  };
  return merged;
}
