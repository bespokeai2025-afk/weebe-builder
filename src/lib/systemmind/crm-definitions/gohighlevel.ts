// ── GoHighLevel (HighLevel) CRM adapter definition (DESCRIPTIVE ONLY) ─────────
import type { CrmAdapterDefinition } from "./types";

export const gohighlevelDefinition: CrmAdapterDefinition = {
  name: "gohighlevel",
  label: "GoHighLevel",
  vendor: "HighLevel, Inc.",
  description:
    "Agency/marketing-focused CRM with strong pipeline, calendar/appointment and automation tooling. Everything is scoped to a Location (sub-account). Authenticated with a Location API key sent as a Bearer token.",
  status: "available",
  docsUrl: "https://highlevel.stoplight.io/docs/integrations",

  auth: {
    type: "api_key",
    label: "Location API Key (Bearer)",
    fields: [
      { key: "api_key", label: "Location API Key", type: "secret", required: true, description: "Location-scoped API key sent as an Authorization: Bearer token." },
      { key: "location_id", label: "Location ID", type: "text", required: true, description: "The Location (sub-account) id that scopes all records and endpoints." },
    ],
    docsUrl: "https://highlevel.stoplight.io/docs/integrations/a04191c0fabf9-authorization",
    notes: "OAuth2 (agency/marketplace app) is also supported and required for the v2 API; a Location API key is simplest for a single sub-account.",
  },

  objects: [
    { key: "lead", crmObject: "Contact", description: "Leads are modelled as Contacts; qualification is tracked via tags/custom fields." },
    { key: "contact", crmObject: "Contact" },
    { key: "deal", crmObject: "Opportunity" },
    { key: "note", crmObject: "Note" },
    { key: "activity", crmObject: "Task / Note" },
    { key: "appointment", crmObject: "Appointment (Calendar)" },
    { key: "owner", crmObject: "User" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "firstName + lastName" },
    { universal: "email", crmField: "email" },
    { universal: "phone", crmField: "phone" },
    { universal: "company", crmField: "companyName" },
    { universal: "source", crmField: "source" },
    { universal: "deal.title", crmField: "name (Opportunity)" },
    { universal: "deal.value", crmField: "monetaryValue" },
    { universal: "deal.stage", crmField: "pipelineStageId" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "won" },
    { universal: "unqualified", crmValue: "abandoned" },
    { universal: "nurturing", crmValue: "open" },
    { universal: "disqualified", crmValue: "lost" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "New Lead", note: "Stages are defined per pipeline; move by pipelineStageId." },
    { universalStage: "qualified", crmStage: "Qualified" },
    { universalStage: "proposal", crmStage: "Proposal Sent" },
    { universalStage: "won", crmStage: "Won" },
    { universalStage: "lost", crmStage: "Lost" },
  ],

  ownerMapping: { strategy: "user_id", crmField: "assignedTo", note: "assignedTo references a Location User id; owners come from the Users API." },

  capabilities: {
    notes: true,
    activities: true,
    appointments: true,
    recordings: true,
    transcripts: true,
    customFields: true,
    webhooks: true,
  },

  actionMappings: [
    { action: "create_lead", supported: true, crmObject: "Contact", method: "POST", endpoint: "/contacts/", notes: "Create a contact then tag as lead; requires locationId." },
    { action: "update_lead", supported: true, crmObject: "Contact", method: "PUT", endpoint: "/contacts/{contactId}" },
    { action: "create_contact", supported: true, crmObject: "Contact", method: "POST", endpoint: "/contacts/" },
    { action: "update_contact", supported: true, crmObject: "Contact", method: "PUT", endpoint: "/contacts/{contactId}" },
    { action: "create_deal", supported: true, crmObject: "Opportunity", method: "POST", endpoint: "/opportunities/", notes: "Requires pipelineId and pipelineStageId." },
    { action: "update_deal", supported: true, crmObject: "Opportunity", method: "PUT", endpoint: "/opportunities/{id}" },
    { action: "assign_owner", supported: true, crmObject: "Contact", method: "PUT", endpoint: "/contacts/{contactId}", fieldMappings: [{ universal: "owner", crmField: "assignedTo" }] },
    { action: "create_note", supported: true, crmObject: "Note", method: "POST", endpoint: "/contacts/{contactId}/notes", notes: "Notes are attached to a contact." },
    { action: "attach_transcript", supported: true, crmObject: "Note", method: "POST", endpoint: "/contacts/{contactId}/notes", notes: "Store transcript text as a contact note." },
    { action: "attach_recording", supported: true, crmObject: "Note", method: "POST", endpoint: "/contacts/{contactId}/notes", notes: "Store the recording URL in a note; call recordings also surface in the conversation timeline." },
    { action: "move_pipeline_stage", supported: true, crmObject: "Opportunity", method: "PUT", endpoint: "/opportunities/{id}", fieldMappings: [{ universal: "stage", crmField: "pipelineStageId" }] },
    { action: "update_qualification", supported: true, crmObject: "Contact", method: "PUT", endpoint: "/contacts/{contactId}", fieldMappings: [{ universal: "qualification", crmField: "tags / customField" }], notes: "Qualification tracked via tags or a custom field." },
    { action: "schedule_callback", supported: true, crmObject: "Task", method: "POST", endpoint: "/contacts/{contactId}/tasks", notes: "Create a task with a dueDate for the callback." },
    { action: "create_appointment", supported: true, crmObject: "Appointment", method: "POST", endpoint: "/appointments/", notes: "Requires calendarId; strong native appointment support." },
    { action: "tag_record", supported: true, crmObject: "Contact", method: "POST", endpoint: "/contacts/{contactId}/tags", notes: "Native tags API; supports add and delete." },
    { action: "search_record", supported: true, crmObject: "Contact", method: "GET", endpoint: "/contacts/?locationId={locationId}&query={query}", notes: "Lookup/dedupe by email/phone/query." },
    { action: "merge_record", supported: true, crmObject: "Contact", method: "POST", endpoint: "/contacts/merge", notes: "Merge duplicate contacts into a primary contact." },
    { action: "archive_record", supported: true, crmObject: "Contact", method: "DELETE", endpoint: "/contacts/{contactId}", notes: "DELETE removes the contact; there is no soft-archive, so prefer tagging as archived." },
  ],

  rateLimits: { requestsPerSecond: 10, requestsPerDay: 200000, burst: 100, notes: "v2 API allows ~100 requests / 10s burst and a daily cap per resource/location." },
  pagination: { style: "cursor", pageParam: "startAfterId", limitParam: "limit", maxPageSize: 100, notes: "Contacts use cursor pagination (startAfter/startAfterId); some legacy endpoints use offset/page." },
  errorHandling: { authErrorCodes: [401], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504], notes: "429 includes Retry-After; 422 is returned for validation errors." },
  retryStrategy: { maxRetries: 4, backoff: "exponential", baseDelayMs: 500, respectRetryAfter: true },
  testMethod: { description: "Fetch the configured Location to validate the key + locationId.", method: "GET", endpoint: "/locations/{locationId}", expectation: "HTTP 200 with the location details." },
};
