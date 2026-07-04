// ── Microsoft Dynamics 365 Sales adapter definition (DESCRIPTIVE ONLY) ────────
import type { CrmAdapterDefinition } from "./types";

export const dynamicsDefinition: CrmAdapterDefinition = {
  name: "dynamics",
  label: "Microsoft Dynamics 365 Sales",
  vendor: "Microsoft Corporation",
  description:
    "Enterprise CRM on the Dataverse platform. Exposes lead, contact and opportunity entities through the Web API (OData v4). Authenticated via Azure AD OAuth2 client credentials against the org-specific Dataverse environment URL.",
  status: "beta",
  docsUrl: "https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/overview",

  auth: {
    type: "oauth2_client_credentials",
    label: "Azure AD OAuth2 (Client Credentials)",
    fields: [
      { key: "tenant_id", label: "Azure AD Tenant ID", type: "text", required: true, description: "Directory (tenant) id used at https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token." },
      { key: "client_id", label: "Application (Client) ID", type: "text", required: true, description: "App registration client id for the daemon/service principal." },
      { key: "client_secret", label: "Client Secret", type: "secret", required: true, description: "App registration client secret used to obtain an access token." },
      { key: "org_url", label: "Environment (Org) URL", type: "url", required: true, description: "Dataverse environment URL, e.g. https://yourorg.crm.dynamics.com — also the OAuth resource/scope ({org_url}/.default)." },
    ],
    docsUrl: "https://learn.microsoft.com/en-us/power-apps/developer/data-platform/authenticate-oauth",
    notes: "Client credentials flow requires an application user provisioned in Dataverse with a security role. The resource/scope is {org_url}/.default.",
  },

  objects: [
    { key: "lead", crmObject: "lead", description: "Dataverse entity set: /leads. Dynamics has a dedicated lead entity separate from contact." },
    { key: "contact", crmObject: "contact" },
    { key: "deal", crmObject: "opportunity" },
    { key: "note", crmObject: "annotation" },
    { key: "activity", crmObject: "task / phonecall / activitypointer" },
    { key: "appointment", crmObject: "appointment" },
    { key: "owner", crmObject: "systemuser / team" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "firstname + lastname", note: "Leads also expose subject/fullname." },
    { universal: "email", crmField: "emailaddress1" },
    { universal: "phone", crmField: "telephone1 / mobilephone" },
    { universal: "company", crmField: "companyname (lead) / parentcustomerid (contact)" },
    { universal: "source", crmField: "leadsourcecode" },
    { universal: "deal.title", crmField: "name (opportunity)" },
    { universal: "deal.value", crmField: "estimatedvalue" },
    { universal: "deal.stage", crmField: "stepname / stageid (Business Process Flow)" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "Qualified (statuscode=3, statecode=1)" },
    { universal: "unqualified", crmValue: "Disqualified (statecode=2)" },
    { universal: "nurturing", crmValue: "New (statuscode=1)" },
    { universal: "disqualified", crmValue: "Disqualified (statecode=2)" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "Qualify", note: "Dynamics uses Business Process Flow stages (Qualify → Develop → Propose → Close)." },
    { universalStage: "qualified", crmStage: "Develop" },
    { universalStage: "proposal", crmStage: "Propose" },
    { universalStage: "won", crmStage: "Close (Won)", note: "Set via the WinOpportunity action." },
    { universalStage: "lost", crmStage: "Close (Lost)", note: "Set via the LoseOpportunity action." },
  ],

  ownerMapping: { strategy: "user_id", crmField: "ownerid", note: "ownerid is a polymorphic lookup to systemuser or team; set via ownerid@odata.bind." },

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
    { action: "create_lead", supported: true, crmObject: "lead", method: "POST", endpoint: "/api/data/v9.2/leads" },
    { action: "update_lead", supported: true, crmObject: "lead", method: "PATCH", endpoint: "/api/data/v9.2/leads({id})" },
    { action: "create_contact", supported: true, crmObject: "contact", method: "POST", endpoint: "/api/data/v9.2/contacts" },
    { action: "update_contact", supported: true, crmObject: "contact", method: "PATCH", endpoint: "/api/data/v9.2/contacts({id})" },
    { action: "create_deal", supported: true, crmObject: "opportunity", method: "POST", endpoint: "/api/data/v9.2/opportunities" },
    { action: "update_deal", supported: true, crmObject: "opportunity", method: "PATCH", endpoint: "/api/data/v9.2/opportunities({id})" },
    { action: "assign_owner", supported: true, crmObject: "lead", method: "PATCH", endpoint: "/api/data/v9.2/{entityset}({id})", fieldMappings: [{ universal: "owner", crmField: "ownerid@odata.bind" }], notes: "Set ownerid via @odata.bind to /systemusers({id}) or /teams({id})." },
    { action: "create_note", supported: true, crmObject: "annotation", method: "POST", endpoint: "/api/data/v9.2/annotations", notes: "Set objectid@odata.bind to the target record." },
    { action: "attach_transcript", supported: true, crmObject: "annotation", method: "POST", endpoint: "/api/data/v9.2/annotations", notes: "Store transcript text in an annotation (note) linked to the record." },
    { action: "attach_recording", supported: true, crmObject: "phonecall", method: "POST", endpoint: "/api/data/v9.2/phonecalls", notes: "Store recording URL on a phonecall activity or as an annotation." },
    { action: "move_pipeline_stage", supported: true, crmObject: "opportunity", method: "PATCH", endpoint: "/api/data/v9.2/opportunities({id})", fieldMappings: [{ universal: "stage", crmField: "stageid (Business Process Flow)" }], notes: "Advance the BPF stage or PATCH the process instance." },
    { action: "update_qualification", supported: true, crmObject: "lead", method: "POST", endpoint: "/api/data/v9.2/leads({id})/Microsoft.Dynamics.CRM.QualifyLead", notes: "QualifyLead bound action; DisqualifyLead via statecode change." },
    { action: "schedule_callback", supported: true, crmObject: "task", method: "POST", endpoint: "/api/data/v9.2/tasks", notes: "Create a task activity with a scheduledend due date." },
    { action: "create_appointment", supported: true, crmObject: "appointment", method: "POST", endpoint: "/api/data/v9.2/appointments" },
    { action: "tag_record", supported: true, crmObject: "contact", method: "PATCH", endpoint: "/api/data/v9.2/contacts({id})", notes: "No native free-form tags; use a multiselect option set or Connections to categorize." },
    { action: "search_record", supported: true, crmObject: "lead", method: "GET", endpoint: "/api/data/v9.2/leads?$filter=emailaddress1 eq '{email}'", notes: "OData $filter for dedupe by email/phone." },
    { action: "merge_record", supported: true, crmObject: "contact", method: "POST", endpoint: "/api/data/v9.2/Merge", notes: "The Merge action merges duplicate leads/contacts/accounts/opportunities." },
    { action: "archive_record", supported: true, crmObject: "lead", method: "DELETE", endpoint: "/api/data/v9.2/leads({id})", notes: "DELETE removes the record; prefer setting statecode=Inactive for a soft archive." },
  ],

  rateLimits: { requestsPerMinute: 6000, notes: "Service protection limits are per user per 5-minute window (~6000 requests, ~20 min execution time, 52 concurrent). 429 responses carry Retry-After." },
  pagination: { style: "link_header", pageParam: "@odata.nextLink", limitParam: "$top / Prefer: odata.maxpagesize", maxPageSize: 5000, notes: "Follow @odata.nextLink; page size defaults to 5000 and is capped via the Prefer header." },
  errorHandling: { authErrorCodes: [401], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504], notes: "Service protection (429) includes Retry-After seconds; 412/404 for concurrency/not-found." },
  retryStrategy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, respectRetryAfter: true },
  testMethod: { description: "Read the caller's own systemuser record via WhoAmI.", method: "GET", endpoint: "/api/data/v9.2/WhoAmI", expectation: "HTTP 200 with UserId/BusinessUnitId/OrganizationId." },
};
