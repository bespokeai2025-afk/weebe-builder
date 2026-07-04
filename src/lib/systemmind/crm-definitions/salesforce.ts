// ── Salesforce CRM adapter definition (DESCRIPTIVE ONLY) ──────────────────────
import type { CrmAdapterDefinition } from "./types";

export const salesforceDefinition: CrmAdapterDefinition = {
  name: "salesforce",
  label: "Salesforce",
  vendor: "Salesforce, Inc.",
  description:
    "Enterprise CRM with distinct Lead, Contact, Account and Opportunity objects. Uses OAuth2 with an org-specific instance URL and the REST API (sObjects).",
  status: "available",
  docsUrl: "https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/",

  auth: {
    type: "oauth2",
    label: "OAuth2 (Connected App)",
    fields: [
      { key: "instance_url", label: "Instance URL", type: "url", required: true, description: "Org instance URL, e.g. https://yourorg.my.salesforce.com" },
      { key: "access_token", label: "Access Token", type: "secret", required: true, description: "OAuth2 access token from the connected app." },
    ],
    docsUrl: "https://help.salesforce.com/s/articleView?id=sf.connected_app_overview.htm",
    notes: "Refresh tokens are used to renew access tokens; the instance URL is org-specific.",
  },

  objects: [
    { key: "lead", crmObject: "Lead", description: "Salesforce has a dedicated Lead object separate from Contact." },
    { key: "contact", crmObject: "Contact" },
    { key: "deal", crmObject: "Opportunity" },
    { key: "note", crmObject: "Note / ContentNote" },
    { key: "activity", crmObject: "Task / Event" },
    { key: "appointment", crmObject: "Event" },
    { key: "owner", crmObject: "User" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "FirstName + LastName" },
    { universal: "email", crmField: "Email" },
    { universal: "phone", crmField: "Phone" },
    { universal: "company", crmField: "Company (Lead) / Account.Name" },
    { universal: "source", crmField: "LeadSource" },
    { universal: "deal.title", crmField: "Name" },
    { universal: "deal.value", crmField: "Amount" },
    { universal: "deal.stage", crmField: "StageName" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "Qualified" },
    { universal: "unqualified", crmValue: "Unqualified" },
    { universal: "nurturing", crmValue: "Nurturing" },
    { universal: "disqualified", crmValue: "Closed - Not Converted" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "Prospecting" },
    { universalStage: "qualified", crmStage: "Qualification" },
    { universalStage: "proposal", crmStage: "Proposal/Price Quote" },
    { universalStage: "won", crmStage: "Closed Won" },
    { universalStage: "lost", crmStage: "Closed Lost" },
  ],

  ownerMapping: { strategy: "user_id", crmField: "OwnerId", note: "OwnerId references a User (or Queue) id." },

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
    { action: "create_lead", supported: true, crmObject: "Lead", method: "POST", endpoint: "/services/data/v60.0/sobjects/Lead" },
    { action: "update_lead", supported: true, crmObject: "Lead", method: "PATCH", endpoint: "/services/data/v60.0/sobjects/Lead/{id}" },
    { action: "create_contact", supported: true, crmObject: "Contact", method: "POST", endpoint: "/services/data/v60.0/sobjects/Contact" },
    { action: "update_contact", supported: true, crmObject: "Contact", method: "PATCH", endpoint: "/services/data/v60.0/sobjects/Contact/{id}" },
    { action: "create_deal", supported: true, crmObject: "Opportunity", method: "POST", endpoint: "/services/data/v60.0/sobjects/Opportunity" },
    { action: "update_deal", supported: true, crmObject: "Opportunity", method: "PATCH", endpoint: "/services/data/v60.0/sobjects/Opportunity/{id}" },
    { action: "assign_owner", supported: true, crmObject: "Lead", method: "PATCH", endpoint: "/services/data/v60.0/sobjects/{object}/{id}", fieldMappings: [{ universal: "owner", crmField: "OwnerId" }] },
    { action: "create_note", supported: true, crmObject: "Note", method: "POST", endpoint: "/services/data/v60.0/sobjects/Note" },
    { action: "attach_transcript", supported: true, crmObject: "Task", method: "POST", endpoint: "/services/data/v60.0/sobjects/Task", notes: "Store transcript in a Task description linked via WhoId." },
    { action: "attach_recording", supported: true, crmObject: "Task", method: "POST", endpoint: "/services/data/v60.0/sobjects/Task", notes: "Store recording URL on a Task/Activity." },
    { action: "move_pipeline_stage", supported: true, crmObject: "Opportunity", method: "PATCH", endpoint: "/services/data/v60.0/sobjects/Opportunity/{id}", fieldMappings: [{ universal: "stage", crmField: "StageName" }] },
    { action: "update_qualification", supported: true, crmObject: "Lead", method: "PATCH", endpoint: "/services/data/v60.0/sobjects/Lead/{id}", fieldMappings: [{ universal: "qualification", crmField: "Status" }] },
    { action: "schedule_callback", supported: true, crmObject: "Task", method: "POST", endpoint: "/services/data/v60.0/sobjects/Task", notes: "Create a Task with ActivityDate + reminder." },
    { action: "create_appointment", supported: true, crmObject: "Event", method: "POST", endpoint: "/services/data/v60.0/sobjects/Event" },
    { action: "tag_record", supported: true, crmObject: "TopicAssignment", method: "POST", endpoint: "/services/data/v60.0/sobjects/TopicAssignment", notes: "Salesforce uses Topics for tag-like labelling." },
    { action: "search_record", supported: true, crmObject: "Lead", method: "GET", endpoint: "/services/data/v60.0/query?q={SOQL}", notes: "SOQL query for dedupe by email/phone." },
    { action: "merge_record", supported: true, crmObject: "Contact", method: "POST", endpoint: "/services/data/v60.0/composite (merge)", notes: "Contact/Lead merge via the merge API." },
    { action: "archive_record", supported: true, crmObject: "Lead", method: "DELETE", endpoint: "/services/data/v60.0/sobjects/Lead/{id}", notes: "Deleted records go to the Recycle Bin (soft delete)." },
  ],

  rateLimits: { requestsPerDay: 100000, notes: "Daily API request limit is edition + license based (per 24h rolling window)." },
  pagination: { style: "cursor", pageParam: "nextRecordsUrl", limitParam: "LIMIT (SOQL)", maxPageSize: 2000, notes: "queryMore via nextRecordsUrl; SOQL LIMIT controls batch size." },
  errorHandling: { authErrorCodes: [401], rateLimitCodes: [429, 403], retryableCodes: [429, 500, 503], notes: "REQUEST_LIMIT_EXCEEDED returns 403; expired sessions return 401 INVALID_SESSION_ID." },
  retryStrategy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, respectRetryAfter: true },
  testMethod: { description: "Fetch API limits for the org.", method: "GET", endpoint: "/services/data/v60.0/limits", expectation: "HTTP 200 with the org's daily API usage." },
};
