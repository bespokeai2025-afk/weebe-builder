/**
 * What each n8n canvas node actually runs in WEBEE native code.
 */
export type WbahN8nNodeImplementation = {
  file: string;
  fn?: string;
  description: string;
  runsWhen: string;
  n8nNote?: string;
};

export const WBAH_N8N_NODE_IMPLEMENTATIONS: Record<string, WbahN8nNodeImplementation> = {
  webhook: {
    file: "src/routes/api/public/voice-webhook.ts",
    fn: "processWbahRetellWebhook",
    description: "Retell POST hits WEBEE. Routes WBAH agents to the native post-call pipeline.",
    runsWhen: "Every Retell event (call_started, call_ended, call_analyzed, transcript_updated)",
  },
  "filter-lead-1": {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    fn: "runWbahPostCallPipelineCore",
    description: "Skips analyzed branches when lead_id is missing from dynamic variables.",
    runsWhen: "Before dashboard_analyzed / CRM paths",
  },
  "call-analyzed-dashboard": {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    description: "Gate: only runs when event === call_analyzed.",
    runsWhen: "call_analyzed with lead_id",
  },
  "format-data": {
    file: "src/lib/wbah/post-call/wbah-format-data.shared.ts",
    fn: "formatWbahRetellCallData",
    description:
      "Parses calendly_slot + available_slots, resolves UK date/time, outputs requested_start UTC and callback fields.",
    runsWhen: "calendly_link or dashboard_analyzed step enabled",
    n8nNote: "n8n node #9 — Format Data",
  },
  "create-booking-link": {
    file: "src/lib/wbah/post-call/wbah-calendly.server.ts",
    fn: "createWbahCalendlyBookingLink",
    description: "POST Calendly /scheduling_links for event type EBGJSBH4HVGLYFN6.",
    runsWhen: "Has booking slot + WBAH_CALENDLY_API_TOKEN set",
    n8nNote: "n8n node #10 — batch 1 item / 2s",
  },
  "build-slot-url": {
    file: "src/lib/wbah/post-call/wbah-crm-payload.shared.ts",
    fn: "buildWbahCalendlySlotUrl",
    description: "Appends UTC slot to booking URL: {base}/{iso}?month=&date=",
    runsWhen: "After scheduling link created",
    n8nNote: "n8n node #11",
  },
  merge2: {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    fn: "postDashboardAnalyzed",
    description: "In-memory merge of webhook body + slot URL before dashboard POST (no separate merge step).",
    runsWhen: "dashboard_analyzed",
    n8nNote: "n8n Merge2 — combine analyzed + slot",
  },
  "post-dashboard-analyzed": {
    file: "src/lib/wbah/post-call/wbah-webespoke-writer.server.ts",
    fn: "postWbahCallOutputCreate",
    description:
      "POST UAT /call-output-data/create with raw_data and booking fields (callback sent separately).",
    runsWhen: "dashboard_analyzed step enabled",
    n8nNote: "n8n node #10 POST TO DASHBOARD",
  },
  "filter-lead-2": {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    description: "CRM branch gate — lead_id required.",
    runsWhen: "dynamics_allens path",
  },
  "call-analyzed-crm": {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    description: "Gate: event === call_analyzed for Dynamics.",
    runsWhen: "dynamics_allens enabled",
  },
  "get-d365-token": {
    file: "src/lib/wbah/post-call/wbah-dynamics.server.ts",
    fn: "fetchDynamicsAccessToken",
    description: "OAuth2 client_credentials token for Dynamics 365.",
    runsWhen: "Before any Dynamics PATCH",
    n8nNote: "n8n node #18",
  },
  "merge-token": {
    file: "src/lib/wbah/post-call/wbah-dynamics.server.ts",
    description: "Token held in same request context (no explicit merge node).",
    runsWhen: "dynamics_allens / dynamics_agentic",
  },
  "merge-token-data": {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    description: "Combines token + formatted call data in pipeline memory.",
    runsWhen: "dynamics_allens",
    n8nNote: "n8n Merge #20",
  },
  "webhook-extract": {
    file: "src/lib/wbah/post-call/wbah-format-data.shared.ts",
    fn: "formatWbahRetellCallData",
    description: "Extracts sentiment, summary, verified_details from structured_json_output.",
    runsWhen: "dynamics_allens",
    n8nNote: "n8n #22 WebhookDataExtract",
  },
  merge1: {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    description: "Merge token + lead + Calendly slot URL in pipeline.",
    runsWhen: "dynamics_allens + calendly_link",
    n8nNote: "n8n Merge1 #12",
  },
  "get-lead-status": {
    file: "src/lib/wbah/post-call/wbah-dynamics.server.ts",
    fn: "getWbahLeadCurrentStatus",
    description: "GET lead new_currentstatus + statecode before Allen's Logic.",
    runsWhen: "dynamics_allens",
    n8nNote: "n8n #13",
  },
  "apply-allens-logic": {
    file: "src/lib/wbah/post-call/wbah-allens-logic.shared.ts",
    fn: "applyAllensLogicV5",
    description:
      "Rule 0 callback → Rule 1 negative/disqualified → Rule 2 positive+Calendly → Rule 3 tried to contact → Rule 4 no update.",
    runsWhen: "dynamics_allens",
    n8nNote: "n8n #14",
  },
  "build-crm-payload": {
    file: "src/lib/wbah/post-call/wbah-crm-payload.shared.ts",
    fn: "buildWbahAllensCrmPayload",
    description: "Builds Dynamics PATCH with status, appointment, callback, verified_details fields.",
    runsWhen: "After Allen's Logic",
    n8nNote: "n8n #15",
  },
  "patch-dynamics-allen": {
    file: "src/lib/wbah/post-call/wbah-dynamics.server.ts",
    fn: "patchWbahLead",
    description: "PATCH Dynamics lead with Allen's CRM payload.",
    runsWhen: "dynamics_allens",
    n8nNote: "n8n #16 POST SUMMARY TO 365",
  },
  "post-dashboard-raw": {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    fn: "postDashboardRaw",
    description: "POST raw call payload on call_started / call_ended (empty booking fields).",
    runsWhen: "dashboard_raw step enabled",
    n8nNote: "n8n #26",
  },
  "get-structured-json": {
    file: "src/lib/wbah/post-call/wbah-format-data.shared.ts",
    description: "Parses custom_analysis_data.structured_json_output JSON string.",
    runsWhen: "dynamics_agentic",
    n8nNote: "n8n #28",
  },
  "get-all-valid-fields": {
    file: "src/lib/wbah/post-call/wbah-agentic-crm-normalize.shared.ts",
    description: "Extracts CRM field candidates from verified_details.",
    runsWhen: "dynamics_agentic",
    n8nNote: "n8n #29",
  },
  "get-all-valid-fields-1": {
    file: "src/lib/wbah/post-call/wbah-agentic-crm-normalize.shared.ts",
    fn: "normalizeWbahAgenticCrmFields",
    description: "Rename aliases, apply allowlist, leasehold regex from summaries.",
    runsWhen: "dynamics_agentic",
    n8nNote: "n8n #31",
  },
  "patch-dynamics-agentic": {
    file: "src/lib/wbah/post-call/wbah-dynamics.server.ts",
    fn: "patchWbahLead",
    description: "PATCH Dynamics with property/contact fields from structured output.",
    runsWhen: "dynamics_agentic",
    n8nNote: "n8n #33",
  },
  "clear-data-agentic": {
    file: "src/lib/wbah/post-call/wbah-crm-payload.shared.ts",
    fn: "buildWbahClearDataAgenticPayload",
    description: "Small follow-up PATCH: statecode, status, cos_user_sentiment, cos_call_summary.",
    runsWhen: "After agentic PATCH",
    n8nNote: "n8n #34",
  },
  "webee-live-ingest": {
    file: "src/lib/wbah/post-call/wbah-post-call.server.ts",
    fn: "handleLiveTranscript",
    description: "Upserts live call session for WEBEE transcript panel (replaces external live-ingest POST).",
    runsWhen: "live_transcript step — all events",
    n8nNote: "n8n #6",
  },
  "check-appointment-confirmed": {
    file: "src/lib/wbah/post-call/wbah-allens-logic.shared.ts",
    fn: "isWbahAppointmentConfirmed",
    description: "True when appointment_date + appointment_time valid or appointment_confirmed flag.",
    runsWhen: "calendly_invitee step",
    n8nNote: "n8n #35",
  },
  "wait-random-delay": {
    file: "src/lib/wbah/post-call/wbah-calendly.server.ts",
    fn: "wbahCalendlyRandomDelayMs",
    description: "Random wait 5–25 seconds before Calendly invitee API.",
    runsWhen: "calendly_invitee",
    n8nNote: "n8n #36",
  },
  "post-calendly-invitees": {
    file: "src/lib/wbah/post-call/wbah-calendly.server.ts",
    fn: "createWbahCalendlyInvitee",
    description: "POST Calendly /invitees with phone, address Q&A and event guests.",
    runsWhen: "calendly_invitee + confirmed slot",
    n8nNote: "n8n #37",
  },
  "wbah-calls-upsert": {
    file: "src/lib/wbah/post-call/wbah-calls-upsert.server.ts",
    fn: "upsertWbahCallFromWebhook",
    description: "Upserts call row in WEBEE Calls tab for reporting.",
    runsWhen: "wbah_calls_upsert step on call_analyzed",
  },
};

export const WBAH_N8N_BRANCH_LABELS: Record<string, string> = {
  entry: "Entry",
  dashboard_analyzed: "Dashboard (analyzed)",
  calendly_invitee: "Calendly auto-book",
  dynamics_allens: "Dynamics — Allen's Logic",
  dynamics_agentic: "Dynamics — property fields",
  lifecycle_raw: "Dashboard (started/ended)",
  webee_live: "Live transcript",
  reporting: "Reporting",
  custom: "Custom",
};

export function getNodeImplementation(nodeId: string): WbahN8nNodeImplementation | null {
  return WBAH_N8N_NODE_IMPLEMENTATIONS[nodeId] ?? null;
}
