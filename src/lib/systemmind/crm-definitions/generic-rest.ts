// ── Generic REST CRM adapter definition (DESCRIPTIVE ONLY) ────────────────────
import type { CrmAdapterDefinition } from "./types";

export const genericRestDefinition: CrmAdapterDefinition = {
  name: "generic-rest",
  label: "Generic REST CRM",
  vendor: "Configurable / Custom",
  description:
    "A fully configurable REST CRM connector for in-house or long-tail systems that expose a JSON HTTP API. Every object, field, endpoint and pagination detail below is a TEMPLATE — the integrator maps them to their own API at setup time. Authenticated with an API key placed in a configurable header.",
  status: "available",
  docsUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP",

  auth: {
    type: "api_key",
    label: "API Key (configurable header)",
    fields: [
      { key: "base_url", label: "Base URL", type: "url", required: true, description: "Root of the target REST API, e.g. https://api.yourcrm.com. All endpoint templates are resolved relative to this." },
      { key: "api_key", label: "API Key", type: "secret", required: true, description: "Secret API key/token sent on every request." },
      { key: "auth_header", label: "Auth Header Name", type: "text", required: false, description: "Header the key is sent in (default: Authorization). Value template defaults to 'Bearer {api_key}'." },
    ],
    docsUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication",
    notes: "Both the header name and value format are user-configured. Basic auth or a custom header (e.g. X-Api-Key) can be substituted at setup.",
  },

  objects: [
    { key: "lead", crmObject: "lead", description: "Generic lead resource — collection path is user-configured (e.g. /leads)." },
    { key: "contact", crmObject: "contact" },
    { key: "deal", crmObject: "deal" },
    { key: "note", crmObject: "note" },
    { key: "activity", crmObject: "activity" },
    { key: "appointment", crmObject: "appointment" },
    { key: "owner", crmObject: "user" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "{configured}", note: "All field mappings are user-configured; defaults shown are conventional." },
    { universal: "email", crmField: "email" },
    { universal: "phone", crmField: "phone" },
    { universal: "company", crmField: "company" },
    { universal: "source", crmField: "source" },
    { universal: "deal.title", crmField: "title" },
    { universal: "deal.value", crmField: "value" },
    { universal: "deal.stage", crmField: "stage" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "qualified" },
    { universal: "unqualified", crmValue: "unqualified" },
    { universal: "nurturing", crmValue: "nurturing" },
    { universal: "disqualified", crmValue: "disqualified" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "new", note: "Stage values are user-configured to match the target CRM's pipeline." },
    { universalStage: "qualified", crmStage: "qualified" },
    { universalStage: "proposal", crmStage: "proposal" },
    { universalStage: "won", crmStage: "won" },
    { universalStage: "lost", crmStage: "lost" },
  ],

  ownerMapping: { strategy: "user_id", crmField: "owner_id", note: "Owner strategy and field are user-configured (user_id / email / round_robin / team)." },

  capabilities: {
    notes: true,
    activities: true,
    appointments: true,
    recordings: true,
    transcripts: true,
    customFields: true,
    webhooks: false,
  },

  actionMappings: [
    { action: "create_lead", supported: true, crmObject: "lead", method: "POST", endpoint: "{base_url}/leads", notes: "Endpoint template; the collection path is configured per deployment." },
    { action: "update_lead", supported: true, crmObject: "lead", method: "PATCH", endpoint: "{base_url}/leads/{id}" },
    { action: "create_contact", supported: true, crmObject: "contact", method: "POST", endpoint: "{base_url}/contacts" },
    { action: "update_contact", supported: true, crmObject: "contact", method: "PATCH", endpoint: "{base_url}/contacts/{id}" },
    { action: "create_deal", supported: true, crmObject: "deal", method: "POST", endpoint: "{base_url}/deals" },
    { action: "update_deal", supported: true, crmObject: "deal", method: "PATCH", endpoint: "{base_url}/deals/{id}" },
    { action: "assign_owner", supported: true, crmObject: "lead", method: "PATCH", endpoint: "{base_url}/{object}/{id}", fieldMappings: [{ universal: "owner", crmField: "owner_id" }] },
    { action: "create_note", supported: true, crmObject: "note", method: "POST", endpoint: "{base_url}/notes", notes: "Relate the note to the record via a configured parent id field." },
    { action: "attach_transcript", supported: true, crmObject: "note", method: "POST", endpoint: "{base_url}/notes", notes: "Store transcript text as a note (or a configured activity endpoint)." },
    { action: "attach_recording", supported: true, crmObject: "note", method: "POST", endpoint: "{base_url}/notes", notes: "Store the recording URL on a note/activity per configuration." },
    { action: "move_pipeline_stage", supported: true, crmObject: "deal", method: "PATCH", endpoint: "{base_url}/deals/{id}", fieldMappings: [{ universal: "stage", crmField: "stage" }] },
    { action: "update_qualification", supported: true, crmObject: "lead", method: "PATCH", endpoint: "{base_url}/leads/{id}", fieldMappings: [{ universal: "qualification", crmField: "status" }] },
    { action: "schedule_callback", supported: true, crmObject: "activity", method: "POST", endpoint: "{base_url}/activities", notes: "Create a task/activity with a due date; endpoint is configured." },
    { action: "create_appointment", supported: true, crmObject: "appointment", method: "POST", endpoint: "{base_url}/appointments" },
    { action: "tag_record", supported: true, crmObject: "lead", method: "PATCH", endpoint: "{base_url}/leads/{id}", fieldMappings: [{ universal: "tags", crmField: "tags" }], notes: "Tags applied via a configured array field or a dedicated tags endpoint." },
    { action: "search_record", supported: true, crmObject: "lead", method: "GET", endpoint: "{base_url}/leads?q={query}", notes: "Search/filter param is user-configured for dedupe." },
    { action: "merge_record", supported: false, crmObject: "lead", notes: "No universal merge semantics for a generic REST API; enable only if the target exposes a merge endpoint (then override this mapping)." },
    { action: "archive_record", supported: true, crmObject: "lead", method: "DELETE", endpoint: "{base_url}/leads/{id}", notes: "DELETE by default; can be reconfigured to a soft-archive PATCH." },
  ],

  rateLimits: { requestsPerSecond: 5, notes: "Unknown for a generic target; a conservative default is applied. Tune to the real API's documented limits at setup." },
  pagination: { style: "page", pageParam: "page", limitParam: "per_page", maxPageSize: 100, notes: "Defaults to page-based pagination; can be reconfigured to cursor/offset/link_header to match the target API." },
  errorHandling: { authErrorCodes: [401, 403], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504], notes: "Standard HTTP status semantics assumed; adjust to the target API's conventions." },
  retryStrategy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 500, respectRetryAfter: true },
  testMethod: { description: "Perform a lightweight authenticated read against a configured health/list endpoint.", method: "GET", endpoint: "{base_url}/contacts?per_page=1", expectation: "HTTP 200 with a JSON body (or a configured 2xx health response)." },
};
