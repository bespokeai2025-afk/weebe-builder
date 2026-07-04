// ── HubSpot CRM adapter definition (DESCRIPTIVE ONLY) ─────────────────────────
import type { CrmAdapterDefinition } from "./types";

export const hubspotDefinition: CrmAdapterDefinition = {
  name: "hubspot",
  label: "HubSpot",
  vendor: "HubSpot, Inc.",
  description:
    "Inbound-focused CRM. Objects are modelled as CRM records with typed 'properties'. Private App tokens or OAuth2 are used for auth.",
  status: "available",
  docsUrl: "https://developers.hubspot.com/docs/api/crm/understanding-the-crm",

  auth: {
    type: "api_key",
    label: "Private App Token (Bearer) or OAuth2",
    fields: [
      { key: "access_token", label: "Private App Token", type: "secret", required: true, description: "HubSpot private app access token sent as a Bearer token." },
    ],
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    notes: "OAuth2 is also supported for multi-portal installs; a single private app token is simplest for one portal.",
  },

  objects: [
    { key: "lead", crmObject: "Contact", description: "HubSpot models leads as Contacts with a lifecycle stage." },
    { key: "contact", crmObject: "Contact" },
    { key: "deal", crmObject: "Deal" },
    { key: "note", crmObject: "Note (engagement)" },
    { key: "activity", crmObject: "Engagement (call/meeting/note)" },
    { key: "appointment", crmObject: "Meeting (engagement)" },
    { key: "owner", crmObject: "Owner" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "properties.firstname + properties.lastname" },
    { universal: "email", crmField: "properties.email" },
    { universal: "phone", crmField: "properties.phone" },
    { universal: "company", crmField: "properties.company" },
    { universal: "source", crmField: "properties.hs_lead_source" },
    { universal: "deal.title", crmField: "properties.dealname" },
    { universal: "deal.value", crmField: "properties.amount" },
    { universal: "deal.stage", crmField: "properties.dealstage" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "qualifiedtobuy" },
    { universal: "unqualified", crmValue: "unqualified" },
    { universal: "nurturing", crmValue: "lead" },
    { universal: "disqualified", crmValue: "other" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "appointmentscheduled" },
    { universalStage: "qualified", crmStage: "qualifiedtobuy" },
    { universalStage: "proposal", crmStage: "presentationscheduled" },
    { universalStage: "won", crmStage: "closedwon" },
    { universalStage: "lost", crmStage: "closedlost" },
  ],

  ownerMapping: { strategy: "user_id", crmField: "hubspot_owner_id", note: "Owner ids come from the Owners API." },

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
    { action: "create_lead", supported: true, crmObject: "Contact", method: "POST", endpoint: "/crm/v3/objects/contacts", notes: "Create a contact with lifecyclestage=lead." },
    { action: "update_lead", supported: true, crmObject: "Contact", method: "PATCH", endpoint: "/crm/v3/objects/contacts/{id}" },
    { action: "create_contact", supported: true, crmObject: "Contact", method: "POST", endpoint: "/crm/v3/objects/contacts" },
    { action: "update_contact", supported: true, crmObject: "Contact", method: "PATCH", endpoint: "/crm/v3/objects/contacts/{id}" },
    { action: "create_deal", supported: true, crmObject: "Deal", method: "POST", endpoint: "/crm/v3/objects/deals" },
    { action: "update_deal", supported: true, crmObject: "Deal", method: "PATCH", endpoint: "/crm/v3/objects/deals/{id}" },
    { action: "assign_owner", supported: true, crmObject: "Contact", method: "PATCH", endpoint: "/crm/v3/objects/{object}/{id}", fieldMappings: [{ universal: "owner", crmField: "hubspot_owner_id" }] },
    { action: "create_note", supported: true, crmObject: "Note", method: "POST", endpoint: "/crm/v3/objects/notes", notes: "Associate the note engagement to the record." },
    { action: "attach_transcript", supported: true, crmObject: "Note", method: "POST", endpoint: "/crm/v3/objects/notes", notes: "Store transcript as a note body associated to the contact." },
    { action: "attach_recording", supported: true, crmObject: "Call", method: "POST", endpoint: "/crm/v3/objects/calls", notes: "Store recording URL on a call engagement." },
    { action: "move_pipeline_stage", supported: true, crmObject: "Deal", method: "PATCH", endpoint: "/crm/v3/objects/deals/{id}", fieldMappings: [{ universal: "stage", crmField: "properties.dealstage" }] },
    { action: "update_qualification", supported: true, crmObject: "Contact", method: "PATCH", endpoint: "/crm/v3/objects/contacts/{id}", fieldMappings: [{ universal: "qualification", crmField: "properties.hs_lead_status" }] },
    { action: "schedule_callback", supported: true, crmObject: "Task", method: "POST", endpoint: "/crm/v3/objects/tasks", notes: "Create a task engagement with a due date." },
    { action: "create_appointment", supported: true, crmObject: "Meeting", method: "POST", endpoint: "/crm/v3/objects/meetings" },
    { action: "tag_record", supported: true, crmObject: "Contact", method: "PATCH", endpoint: "/crm/v3/objects/contacts/{id}", notes: "HubSpot uses a multi-checkbox property rather than free-form tags." },
    { action: "search_record", supported: true, crmObject: "Contact", method: "POST", endpoint: "/crm/v3/objects/contacts/search" },
    { action: "merge_record", supported: true, crmObject: "Contact", method: "POST", endpoint: "/crm/v3/objects/contacts/merge" },
    { action: "archive_record", supported: true, crmObject: "Contact", method: "DELETE", endpoint: "/crm/v3/objects/contacts/{id}", notes: "DELETE archives (soft delete) in HubSpot." },
  ],

  rateLimits: { requestsPerSecond: 10, requestsPerDay: 250000, burst: 100, notes: "Per private app; higher tiers raise the daily cap." },
  pagination: { style: "cursor", pageParam: "after", limitParam: "limit", maxPageSize: 100, notes: "Cursor returned in paging.next.after." },
  errorHandling: { authErrorCodes: [401], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504], notes: "429 includes a Retry-After style backoff." },
  retryStrategy: { maxRetries: 4, backoff: "exponential", baseDelayMs: 500, respectRetryAfter: true },
  testMethod: { description: "Fetch the authenticated account's owners.", method: "GET", endpoint: "/crm/v3/owners", expectation: "HTTP 200 with an owners collection." },
};
