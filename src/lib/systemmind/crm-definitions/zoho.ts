// ── Zoho CRM adapter definition (DESCRIPTIVE ONLY) ────────────────────────────
import type { CrmAdapterDefinition } from "./types";

export const zohoDefinition: CrmAdapterDefinition = {
  name: "zoho",
  label: "Zoho CRM",
  vendor: "Zoho Corporation",
  description:
    "Module-based CRM with distinct Leads, Contacts and Deals modules plus Notes, Tasks and Events. Uses OAuth2 via accounts.zoho.com with a region-specific API domain (e.g. www.zohoapis.com, .eu, .in). Records are wrapped in a { data: [...] } envelope.",
  status: "available",
  docsUrl: "https://www.zoho.com/crm/developer/docs/api/v6/",

  auth: {
    type: "oauth2",
    label: "OAuth2 (Zoho Accounts)",
    fields: [
      { key: "access_token", label: "Access Token", type: "secret", required: true, description: "OAuth2 access token sent as 'Authorization: Zoho-oauthtoken {token}'." },
      { key: "api_domain", label: "API Domain", type: "url", required: true, description: "Region-specific API base, e.g. https://www.zohoapis.com (US), .eu, .in, .com.au, .jp." },
      { key: "refresh_token", label: "Refresh Token", type: "secret", required: false, description: "Long-lived token used against accounts.zoho.com to mint new access tokens." },
    ],
    docsUrl: "https://www.zoho.com/crm/developer/docs/api/v6/oauth-overview.html",
    notes: "Tokens are minted at accounts.zoho.com/oauth/v2/token; the api_domain is returned at grant time and is data-center specific. Access tokens expire hourly.",
  },

  objects: [
    { key: "lead", crmObject: "Leads", description: "Dedicated Leads module; convert into Contacts/Deals." },
    { key: "contact", crmObject: "Contacts" },
    { key: "deal", crmObject: "Deals" },
    { key: "note", crmObject: "Notes" },
    { key: "activity", crmObject: "Tasks / Calls" },
    { key: "appointment", crmObject: "Events" },
    { key: "owner", crmObject: "Users" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "First_Name + Last_Name" },
    { universal: "email", crmField: "Email" },
    { universal: "phone", crmField: "Phone / Mobile" },
    { universal: "company", crmField: "Company (Leads) / Account_Name (Contacts)" },
    { universal: "source", crmField: "Lead_Source" },
    { universal: "deal.title", crmField: "Deal_Name" },
    { universal: "deal.value", crmField: "Amount" },
    { universal: "deal.stage", crmField: "Stage" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "Qualified" },
    { universal: "unqualified", crmValue: "Not Qualified" },
    { universal: "nurturing", crmValue: "Contacted" },
    { universal: "disqualified", crmValue: "Junk Lead" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "Qualification" },
    { universalStage: "qualified", crmStage: "Needs Analysis" },
    { universalStage: "proposal", crmStage: "Proposal/Price Quote" },
    { universalStage: "won", crmStage: "Closed Won" },
    { universalStage: "lost", crmStage: "Closed Lost" },
  ],

  ownerMapping: { strategy: "user_id", crmField: "Owner.id", note: "Owner is a user lookup object { id, name }; ids come from the Users API." },

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
    { action: "create_lead", supported: true, crmObject: "Leads", method: "POST", endpoint: "/crm/v6/Leads", notes: "Records are wrapped in { data: [ ... ] }." },
    { action: "update_lead", supported: true, crmObject: "Leads", method: "PUT", endpoint: "/crm/v6/Leads/{id}" },
    { action: "create_contact", supported: true, crmObject: "Contacts", method: "POST", endpoint: "/crm/v6/Contacts" },
    { action: "update_contact", supported: true, crmObject: "Contacts", method: "PUT", endpoint: "/crm/v6/Contacts/{id}" },
    { action: "create_deal", supported: true, crmObject: "Deals", method: "POST", endpoint: "/crm/v6/Deals" },
    { action: "update_deal", supported: true, crmObject: "Deals", method: "PUT", endpoint: "/crm/v6/Deals/{id}" },
    { action: "assign_owner", supported: true, crmObject: "Leads", method: "PUT", endpoint: "/crm/v6/{module}/{id}", fieldMappings: [{ universal: "owner", crmField: "Owner" }], notes: "Set Owner to { id } of the target user." },
    { action: "create_note", supported: true, crmObject: "Notes", method: "POST", endpoint: "/crm/v6/{module}/{id}/Notes", notes: "Notes are related-list records under a parent record." },
    { action: "attach_transcript", supported: true, crmObject: "Notes", method: "POST", endpoint: "/crm/v6/{module}/{id}/Notes", notes: "Store transcript text as a note under the record." },
    { action: "attach_recording", supported: true, crmObject: "Attachments", method: "POST", endpoint: "/crm/v6/{module}/{id}/Attachments", notes: "No native call recording object; attach the file or store the URL in a note." },
    { action: "move_pipeline_stage", supported: true, crmObject: "Deals", method: "PUT", endpoint: "/crm/v6/Deals/{id}", fieldMappings: [{ universal: "stage", crmField: "Stage" }] },
    { action: "update_qualification", supported: true, crmObject: "Leads", method: "PUT", endpoint: "/crm/v6/Leads/{id}", fieldMappings: [{ universal: "qualification", crmField: "Lead_Status" }] },
    { action: "schedule_callback", supported: true, crmObject: "Tasks", method: "POST", endpoint: "/crm/v6/Tasks", notes: "Create a task with Due_Date and a reminder; relate via What_Id/Who_Id." },
    { action: "create_appointment", supported: true, crmObject: "Events", method: "POST", endpoint: "/crm/v6/Events" },
    { action: "tag_record", supported: true, crmObject: "Leads", method: "POST", endpoint: "/crm/v6/Leads/actions/add_tags?tag_names={tags}&ids={ids}", notes: "Native Tags API supports add_tags / remove_tags per module." },
    { action: "search_record", supported: true, crmObject: "Leads", method: "GET", endpoint: "/crm/v6/Leads/search?criteria=(Email:equals:{email})", notes: "Search by criteria / email / phone for dedupe." },
    { action: "merge_record", supported: true, crmObject: "Leads", method: "POST", endpoint: "/crm/v6/Leads/{id}/actions/merge", notes: "Merge duplicate records into a master record." },
    { action: "archive_record", supported: true, crmObject: "Leads", method: "DELETE", endpoint: "/crm/v6/Leads/{id}", notes: "DELETE moves the record to the Recycle Bin (recoverable) rather than a hard purge." },
  ],

  rateLimits: { requestsPerDay: 25000, notes: "Credit-based: each org has a daily API credit pool scaled by edition + user count (e.g. 25k+ credits/day). Concurrency capped (~10–25 simultaneous calls)." },
  pagination: { style: "page", pageParam: "page", limitParam: "per_page", maxPageSize: 200, notes: "info.more_records signals more pages; per_page max is 200. v6 also supports page_token cursors." },
  errorHandling: { authErrorCodes: [401], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504], notes: "INVALID_TOKEN → 401; TOO_MANY_REQUESTS / credit exhaustion → 429." },
  retryStrategy: { maxRetries: 3, backoff: "exponential", baseDelayMs: 1000, respectRetryAfter: true },
  testMethod: { description: "Fetch org info / current users to validate the token + api_domain.", method: "GET", endpoint: "/crm/v6/users?type=CurrentUser", expectation: "HTTP 200 with the current user's profile." },
};
