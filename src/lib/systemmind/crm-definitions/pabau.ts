// ── Pabau CRM adapter definition (DESCRIPTIVE ONLY) ───────────────────────────
import type { CrmAdapterDefinition } from "./types";

export const pabauDefinition: CrmAdapterDefinition = {
  name: "pabau",
  label: "Pabau",
  vendor: "Pabau",
  description:
    "Medical and aesthetic practice CRM. Clients are patients; appointments and activities are first-class. Authenticated with a Bearer API key from Setup → Private Apps (type: API).",
  status: "beta",
  docsUrl: "https://docs.developers-qa.pabau.com/docs/intro",

  auth: {
    type: "api_key",
    label: "API Key (Bearer)",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "secret",
        required: true,
        description: "Private App API token from Pabau Setup → Private Apps. Sent as Authorization: Bearer …",
      },
      {
        key: "baseUrl",
        label: "API Base URL",
        type: "url",
        required: false,
        description: "Defaults to https://api.pabau.com unless Pabau support specifies another host.",
      },
    ],
    docsUrl: "https://support.pabau.com/knowledge/generate-api-key",
  },

  objects: [
    { key: "contact", crmObject: "patients", description: "Clients / patients in the practice." },
    { key: "appointment", crmObject: "appointments", description: "Booked appointments." },
    { key: "activity", crmObject: "activities", description: "Calls, notes, and follow-ups." },
  ],

  fieldMappings: [
    { universal: "name", crmField: "first_name + last_name", note: "Exact field names confirmed during live API mapping." },
    { universal: "email", crmField: "email" },
    { universal: "phone", crmField: "mobile / phone" },
  ],

  statusMappings: [],
  pipelineMappings: [],

  ownerMapping: {
    strategy: "user_id",
    crmField: "practitioner_id",
    note: "Practitioner assignment when booking — mapping TBD.",
  },

  capabilities: {
    notes: true,
    activities: true,
    appointments: true,
    recordings: false,
    transcripts: false,
    customFields: true,
    webhooks: true,
  },

  actionMappings: [
    { action: "create_lead", supported: false, notes: "Pabau uses patients/clients rather than sales leads." },
    { action: "update_lead", supported: false },
    { action: "create_contact", supported: true, crmObject: "patients", method: "POST", endpoint: "/patients" },
    { action: "update_contact", supported: true, crmObject: "patients", method: "PATCH", endpoint: "/patients/{id}" },
    { action: "create_deal", supported: false, notes: "No deal pipeline in Pabau." },
    { action: "update_deal", supported: false },
    { action: "assign_owner", supported: false, notes: "Practitioner on appointment — TBD." },
    { action: "create_note", supported: true, crmObject: "activities", method: "POST", endpoint: "/activities", notes: "Post-call call summary — TBD." },
    { action: "attach_transcript", supported: false },
    { action: "attach_recording", supported: false },
    { action: "move_pipeline_stage", supported: false },
    { action: "update_qualification", supported: false },
    { action: "schedule_callback", supported: true, crmObject: "activities", method: "POST", endpoint: "/activities" },
    { action: "create_appointment", supported: true, crmObject: "appointments", method: "POST", endpoint: "/appointments" },
    { action: "tag_record", supported: false },
    { action: "search_record", supported: true, crmObject: "patients", method: "GET", endpoint: "/patients?limit=1", notes: "Lookup by phone/email — filter params TBD." },
    { action: "merge_record", supported: false },
    { action: "archive_record", supported: false },
  ],

  rateLimits: { requestsPerSecond: 5, notes: "Conservative default; tune to Pabau documented limits." },
  pagination: { style: "page", pageParam: "page", limitParam: "limit", maxPageSize: 100 },
  errorHandling: { authErrorCodes: [401, 403], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504] },
  retryStrategy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 500, respectRetryAfter: true },
  testMethod: {
    description: "Authenticated read of patients/clients list.",
    method: "GET",
    endpoint: "/patients?limit=1",
    expectation: "HTTP 200 with JSON body (or empty list).",
  },
};
