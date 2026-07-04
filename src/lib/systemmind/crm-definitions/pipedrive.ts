// ── Pipedrive CRM adapter definition (DESCRIPTIVE ONLY) ───────────────────────
import type { CrmAdapterDefinition } from "./types";

export const pipedriveDefinition: CrmAdapterDefinition = {
  name: "pipedrive",
  label: "Pipedrive",
  vendor: "Pipedrive OÜ",
  description:
    "Sales-pipeline-first CRM built around Deals moving through Stages. Models people as Persons and companies as Organizations. Simple REST v1 API authenticated with a personal API token passed as an api_token query parameter.",
  status: "available",
  docsUrl: "https://developers.pipedrive.com/docs/api/v1",

  auth: {
    type: "personal_token",
    label: "Personal API Token (api_token query param)",
    fields: [
      { key: "api_token", label: "API Token", type: "secret", required: true, description: "Personal API token from Settings → Personal preferences → API. Sent on every request as an ?api_token= query parameter." },
      { key: "company_domain", label: "Company Domain", type: "text", required: false, description: "Optional company domain, e.g. yourco (yourco.pipedrive.com), used to build the API base URL." },
    ],
    docsUrl: "https://pipedrive.readme.io/docs/how-to-find-the-api-token",
    notes: "OAuth2 apps are also supported for marketplace integrations; the personal api_token query param is simplest for a single account.",
  },

  objects: [
    { key: "lead", crmObject: "Lead", description: "Pipedrive has a dedicated Leads inbox separate from Deals; leads convert into deals." },
    { key: "contact", crmObject: "Person" },
    { key: "deal", crmObject: "Deal" },
    { key: "note", crmObject: "Note" },
    { key: "activity", crmObject: "Activity" },
    { key: "appointment", crmObject: "Activity (type=meeting)" },
    { key: "owner", crmObject: "User" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "name", note: "Person name is a single 'name' field." },
    { universal: "email", crmField: "email[0].value", note: "Emails are an array of {label,value} objects." },
    { universal: "phone", crmField: "phone[0].value", note: "Phones are an array of {label,value} objects." },
    { universal: "company", crmField: "org_id (Organization)" },
    { universal: "source", crmField: "lead_source / custom field" },
    { universal: "deal.title", crmField: "title" },
    { universal: "deal.value", crmField: "value" },
    { universal: "deal.stage", crmField: "stage_id" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "open" },
    { universal: "unqualified", crmValue: "lost" },
    { universal: "nurturing", crmValue: "open" },
    { universal: "disqualified", crmValue: "deleted" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "Lead In", note: "stage_id references a stage in a specific pipeline_id." },
    { universalStage: "qualified", crmStage: "Qualified" },
    { universalStage: "proposal", crmStage: "Proposal Made" },
    { universalStage: "won", crmStage: "Won", note: "Deals are marked won via status=won rather than a terminal stage." },
    { universalStage: "lost", crmStage: "Lost", note: "Deals are marked lost via status=lost." },
  ],

  ownerMapping: { strategy: "user_id", crmField: "owner_id", note: "owner_id / user_id references a Pipedrive User; ids come from the Users API." },

  capabilities: {
    notes: true,
    activities: true,
    appointments: true,
    recordings: false,
    transcripts: true,
    customFields: true,
    webhooks: true,
  },

  actionMappings: [
    { action: "create_lead", supported: true, crmObject: "Lead", method: "POST", endpoint: "/v1/leads", notes: "Create a lead in the Leads inbox; requires a linked person_id or organization_id." },
    { action: "update_lead", supported: true, crmObject: "Lead", method: "PATCH", endpoint: "/v1/leads/{id}" },
    { action: "create_contact", supported: true, crmObject: "Person", method: "POST", endpoint: "/v1/persons" },
    { action: "update_contact", supported: true, crmObject: "Person", method: "PUT", endpoint: "/v1/persons/{id}" },
    { action: "create_deal", supported: true, crmObject: "Deal", method: "POST", endpoint: "/v1/deals" },
    { action: "update_deal", supported: true, crmObject: "Deal", method: "PUT", endpoint: "/v1/deals/{id}" },
    { action: "assign_owner", supported: true, crmObject: "Deal", method: "PUT", endpoint: "/v1/deals/{id}", fieldMappings: [{ universal: "owner", crmField: "owner_id" }] },
    { action: "create_note", supported: true, crmObject: "Note", method: "POST", endpoint: "/v1/notes", notes: "Attach via deal_id / person_id / org_id / lead_id." },
    { action: "attach_transcript", supported: true, crmObject: "Note", method: "POST", endpoint: "/v1/notes", notes: "Store transcript text as a note linked to the deal/person." },
    { action: "attach_recording", supported: true, crmObject: "Note", method: "POST", endpoint: "/v1/notes", notes: "No native call recording object; store the recording URL in a note or activity." },
    { action: "move_pipeline_stage", supported: true, crmObject: "Deal", method: "PUT", endpoint: "/v1/deals/{id}", fieldMappings: [{ universal: "stage", crmField: "stage_id" }] },
    { action: "update_qualification", supported: true, crmObject: "Deal", method: "PUT", endpoint: "/v1/deals/{id}", fieldMappings: [{ universal: "qualification", crmField: "status" }], notes: "Deal status open/won/lost; lead qualification via label_ids or custom field." },
    { action: "schedule_callback", supported: true, crmObject: "Activity", method: "POST", endpoint: "/v1/activities", notes: "Create an activity type=call with a due_date/due_time." },
    { action: "create_appointment", supported: true, crmObject: "Activity", method: "POST", endpoint: "/v1/activities", notes: "Create an activity type=meeting." },
    { action: "tag_record", supported: true, crmObject: "Deal", method: "PUT", endpoint: "/v1/deals/{id}", fieldMappings: [{ universal: "tags", crmField: "label_ids" }], notes: "Pipedrive uses Labels rather than free-form tags." },
    { action: "search_record", supported: true, crmObject: "Person", method: "GET", endpoint: "/v1/persons/search?term={query}", notes: "Item search endpoints support dedupe by email/phone/name." },
    { action: "merge_record", supported: true, crmObject: "Person", method: "PUT", endpoint: "/v1/persons/{id}/merge", notes: "Persons, Organizations and Deals expose merge endpoints." },
    { action: "archive_record", supported: true, crmObject: "Deal", method: "DELETE", endpoint: "/v1/deals/{id}", notes: "DELETE marks the record as deleted (recoverable for ~30 days) rather than a hard purge." },
  ],

  rateLimits: { requestsPerSecond: 10, burst: 100, notes: "Token-bucket per API token/company; based on a rolling 2-second budget. Response headers expose x-ratelimit-remaining." },
  pagination: { style: "offset", pageParam: "start", limitParam: "limit", maxPageSize: 500, notes: "additional_data.pagination.next_start signals more pages; limit defaults to 100." },
  errorHandling: { authErrorCodes: [401], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504], notes: "429 includes a Retry-After header; 410 is returned for deleted resources." },
  retryStrategy: { maxRetries: 4, backoff: "exponential", baseDelayMs: 500, respectRetryAfter: true },
  testMethod: { description: "Fetch the authenticated user's own profile.", method: "GET", endpoint: "/v1/users/me", expectation: "HTTP 200 with the current user's data and company info." },
};
