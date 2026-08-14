/**
 * Retell-import JSON for DNR Dr Nyla (Retell-native shape — no wrapper keys).
 *
 *   PUBLIC_BASE_URL=https://your-domain.com bun scripts/generate-dnr-retell-import.mjs
 *
 * Outputs:
 *   dnr-retell-agent-import.json          — agent fields + conversationFlow (Retell agent import)
 *   dnr-retell-conversation-flow-import.json — conversation flow only (CF import dialog)
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildDnrRetellGeneralPrompt, DNR_RETELL_AGENT_ID, DNR_VOICE } from "../src/lib/dnr/dnr-voice.config.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:5003").replace(/\/+$/, "");
const cfId = "conversation_flow_dnr_nyla_cheshire";
const startNodeId = "dnr-start-reception";
const transferE164 = "+448081892587";

const globalPrompt = buildDnrRetellGeneralPrompt(base);

function customTool(id, name, description, url, properties, required = []) {
  return {
    type: "custom",
    name,
    tool_id: id,
    description,
    url,
    method: "POST",
    args_at_root: false,
    timeout_ms: 120000,
    speak_during_execution: true,
    speak_after_execution: true,
    parameters: {
      type: "object",
      properties,
      required,
    },
  };
}

const agentIdParam = {
  agent_id: {
    type: "string",
    description: `Always ${DNR_RETELL_AGENT_ID}`,
  },
};

const tools = [
  customTool(
    "tool-dnr-list-services",
    "list_services",
    "List Pabau treatment services available to book at Medispa Cheshire.",
    `${base}${DNR_VOICE.tools.listServices}`,
    { ...agentIdParam },
    ["agent_id"],
  ),
  customTool(
    "tool-dnr-check-availability",
    "check_availability",
    "Check appointment slots for a treatment at Medispa Cheshire.",
    `${base}${DNR_VOICE.tools.checkAvailability}`,
    {
      ...agentIdParam,
      service_name: { type: "string", description: "Exact Pabau service name" },
      start_date: { type: "string", description: "YYYY-MM-DD" },
      end_date: { type: "string", description: "YYYY-MM-DD" },
    },
    ["agent_id", "service_name", "start_date", "end_date"],
  ),
  customTool(
    "tool-dnr-find-or-create-client",
    "find_or_create_client",
    "Find existing Pabau client by phone or create new client. New clients require email and gender — do not ask for anything else.",
    `${base}${DNR_VOICE.tools.findOrCreateClient}`,
    {
      ...agentIdParam,
      first_name: { type: "string" },
      last_name: { type: "string" },
      phone: { type: "string", description: "Mobile with +44" },
      is_new_client: { type: "boolean", description: "true to create new client" },
      email: { type: "string", description: "Required when is_new_client is true" },
      gender: { type: "string", description: "Male, Female, or Other" },
    },
    ["agent_id", "first_name", "last_name", "phone"],
  ),
  customTool(
    "tool-dnr-book-appointment",
    "book_appointment",
    "Book a treatment appointment in Pabau at Cheshire after caller confirms slot.",
    `${base}${DNR_VOICE.tools.bookAppointment}`,
    {
      ...agentIdParam,
      contact_id: { type: "string", description: "From find_or_create_client" },
      service_name: { type: "string" },
      start_date: { type: "string", description: "YYYY-MM-DD" },
      start_time: { type: "string", description: "HH:MM 24h Europe/London" },
      notes: { type: "string", description: "Optional call notes" },
    },
    ["agent_id", "contact_id", "service_name", "start_date", "start_time"],
  ),
  {
    type: "transfer_call",
    name: "transfer_to_foh",
    tool_id: "tool-dnr-transfer-foh",
    description:
      "Transfer caller to front of house when they need a person, complaint, refund, or booking failed twice.",
    transfer_destination: {
      type: "predefined",
      number: transferE164,
    },
    transfer_option: {
      type: "cold_transfer",
      show_transferee_as_caller: true,
    },
    speak_during_execution: true,
    speak_after_execution: false,
  },
];

/** Retell conversation-flow import shape (start_node_id + nodes + tools at root) */
const conversationFlow = {
  conversation_flow_id: cfId,
  version: 2,
  global_prompt: globalPrompt,
  start_speaker: "agent",
  start_node_id: startNodeId,
  model_choice: { type: "cascading", model: "gpt-4.1" },
  tool_call_strict_mode: true,
  model_temperature: 0,
  knowledge_base_ids: [],
  kb_config: { top_k: 3, filter_score: 0.6 },
  tools,
  nodes: [
    {
      id: startNodeId,
      type: "conversation",
      instruction: {
        type: "prompt",
        text: "Greet the caller, then follow the global prompt for qualification, Pabau booking tools, and transfer_to_foh when a human is needed.",
      },
      edges: [],
    },
  ],
};

/** Retell agent import shape — same as GET /get-agent + conversationFlow merge */
const agentImport = {
  agent_id: DNR_RETELL_AGENT_ID,
  agent_name: DNR_VOICE.agentDisplayName,
  language: DNR_VOICE.language,
  begin_message: DNR_VOICE.beginMessage,
  webhook_url: `${base}${DNR_VOICE.webhookPath}`,
  webhook_events: ["call_started", "call_ended", "call_analyzed"],
  response_engine: {
    type: "conversation-flow",
    version: 2,
    conversation_flow_id: cfId,
  },
  normalize_for_speech: true,
  interruption_sensitivity: 0.8,
  max_call_duration_ms: 1800000,
  end_call_after_silence_ms: 600000,
  denoising_mode: "noise-and-background-speech-cancellation",
  allow_user_dtmf: true,
  conversationFlow,
};

const outDir = resolve(__dir, "output");
mkdirSync(outDir, { recursive: true });

writeFileSync(resolve(outDir, "dnr-retell-agent-import.json"), JSON.stringify(agentImport, null, 2));
writeFileSync(
  resolve(outDir, "dnr-retell-conversation-flow-import.json"),
  JSON.stringify(conversationFlow, null, 2),
);

console.log("✅ Wrote scripts/output/dnr-retell-agent-import.json (agent + conversationFlow)");
console.log("✅ Wrote scripts/output/dnr-retell-conversation-flow-import.json (flow only)");
console.log("Agent:", DNR_RETELL_AGENT_ID);
console.log("BASE_URL:", base);
