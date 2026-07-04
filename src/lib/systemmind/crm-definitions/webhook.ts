// ── Webhook CRM adapter definition (DESCRIPTIVE ONLY) ─────────────────────────
import type { CrmAdapterDefinition } from "./types";

export const webhookDefinition: CrmAdapterDefinition = {
  name: "webhook",
  label: "Webhook (Outbound)",
  vendor: "Configurable / Custom",
  description:
    "A fire-and-forget outbound webhook 'CRM'. It is write-only: every write action POSTs a structured event payload to a single configured URL and cannot read data back. Ideal for feeding an automation platform (Zapier/Make/n8n) or a custom ingest endpoint. Payloads are optionally signed with an HMAC signature header.",
  status: "available",
  docsUrl: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",

  auth: {
    type: "webhook_signature",
    label: "Webhook URL + Signing Secret (HMAC)",
    fields: [
      { key: "webhook_url", label: "Webhook URL", type: "url", required: true, description: "Destination URL that receives POSTed event payloads." },
      { key: "signing_secret", label: "Signing Secret", type: "secret", required: false, description: "Optional HMAC secret used to sign each payload (e.g. X-Signature: sha256=...) so the receiver can verify authenticity." },
      { key: "signature_header", label: "Signature Header", type: "text", required: false, description: "Header the signature is sent in (default: X-Webhook-Signature)." },
    ],
    docsUrl: "https://en.wikipedia.org/wiki/HMAC",
    notes: "There is no bearer token or session; authenticity is established by verifying the HMAC signature of the request body against the shared secret.",
  },

  objects: [
    { key: "lead", crmObject: "event(type=lead)", description: "There are no server-side objects; each action emits an event of a given type in the payload." },
    { key: "contact", crmObject: "event(type=contact)" },
    { key: "deal", crmObject: "event(type=deal)" },
    { key: "note", crmObject: "event(type=note)" },
    { key: "activity", crmObject: "event(type=activity)" },
    { key: "appointment", crmObject: "event(type=appointment)" },
    { key: "owner", crmObject: "event(field=owner)" },
  ],

  fieldMappings: [
    { universal: "name", crmField: "payload.name" },
    { universal: "email", crmField: "payload.email" },
    { universal: "phone", crmField: "payload.phone" },
    { universal: "company", crmField: "payload.company" },
    { universal: "source", crmField: "payload.source" },
    { universal: "deal.title", crmField: "payload.deal.title" },
    { universal: "deal.value", crmField: "payload.deal.value" },
    { universal: "deal.stage", crmField: "payload.deal.stage" },
  ],

  statusMappings: [
    { universal: "qualified", crmValue: "qualified" },
    { universal: "unqualified", crmValue: "unqualified" },
    { universal: "nurturing", crmValue: "nurturing" },
    { universal: "disqualified", crmValue: "disqualified" },
  ],

  pipelineMappings: [
    { universalStage: "new", crmStage: "new", note: "Stage is passed through verbatim in the event payload." },
    { universalStage: "qualified", crmStage: "qualified" },
    { universalStage: "proposal", crmStage: "proposal" },
    { universalStage: "won", crmStage: "won" },
    { universalStage: "lost", crmStage: "lost" },
  ],

  ownerMapping: { strategy: "email", crmField: "payload.owner", note: "Owner is emitted as-is (email or id) in the payload; the receiver decides how to route it." },

  capabilities: {
    notes: true,
    activities: true,
    appointments: false,
    recordings: true,
    transcripts: true,
    customFields: true,
    webhooks: true,
  },

  actionMappings: [
    { action: "create_lead", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs an event { type: 'create_lead', data: {...} } to the configured URL." },
    { action: "update_lead", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'update_lead', data: {...} }; no read-back to confirm." },
    { action: "create_contact", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'create_contact', data: {...} }." },
    { action: "update_contact", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'update_contact', data: {...} }." },
    { action: "create_deal", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'create_deal', data: {...} }." },
    { action: "update_deal", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'update_deal', data: {...} }." },
    { action: "assign_owner", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", fieldMappings: [{ universal: "owner", crmField: "payload.owner" }], notes: "POSTs { type: 'assign_owner', data: {...} }." },
    { action: "create_note", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'create_note', data: {...} }." },
    { action: "attach_transcript", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "Transcript text is included inline in the event payload." },
    { action: "attach_recording", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "Recording URL is included in the event payload." },
    { action: "move_pipeline_stage", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", fieldMappings: [{ universal: "stage", crmField: "payload.deal.stage" }], notes: "POSTs { type: 'move_pipeline_stage', data: {...} }." },
    { action: "update_qualification", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", fieldMappings: [{ universal: "qualification", crmField: "payload.qualification" }], notes: "POSTs { type: 'update_qualification', data: {...} }." },
    { action: "schedule_callback", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'schedule_callback', data: {...} }; the receiver schedules the task." },
    { action: "create_appointment", supported: false, crmObject: "event", notes: "No native calendar; appointments are not modelled. Emit as a generic event only if the receiver handles it." },
    { action: "tag_record", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", fieldMappings: [{ universal: "tags", crmField: "payload.tags" }], notes: "POSTs { type: 'tag_record', data: {...} }." },
    { action: "search_record", supported: false, crmObject: "event", notes: "Webhooks are write-only / fire-and-forget — there is no read-back channel to search records." },
    { action: "merge_record", supported: false, crmObject: "event", notes: "Webhooks are write-only / no read-back, so duplicate detection and merging are not possible." },
    { action: "archive_record", supported: true, crmObject: "event", method: "POST", endpoint: "{webhook_url}", notes: "POSTs { type: 'archive_record', data: {...} }; the receiver performs the archive." },
  ],

  rateLimits: { requestsPerSecond: 20, notes: "Bounded by the receiving endpoint; no vendor quota. Keep POST volume within the destination's tolerance." },
  pagination: { style: "none", notes: "No list/read endpoints — nothing to paginate." },
  errorHandling: { authErrorCodes: [401, 403], rateLimitCodes: [429], retryableCodes: [429, 500, 502, 503, 504], notes: "Delivery status comes from the receiver's HTTP response; 2xx is success, 4xx (except 429) is treated as non-retryable." },
  retryStrategy: { maxRetries: 5, backoff: "exponential", baseDelayMs: 1000, respectRetryAfter: true, notes: "Fire-and-forget delivery retries transient failures with backoff; dedupe on the receiver via an event id." },
  testMethod: { description: "Send a signed ping event to the configured URL.", method: "POST", endpoint: "{webhook_url}", expectation: "Receiver responds 2xx to a { type: 'ping' } payload." },
};
