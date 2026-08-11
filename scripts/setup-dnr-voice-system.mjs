/**
 * DNR voice system setup — prints checklist + Retell custom tool definitions.
 *
 *   PUBLIC_BASE_URL=https://your-domain.com bun scripts/setup-dnr-voice-system.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { getDrNylaRetellPrompt } from "../src/lib/dnr/dr-nyla-receptionist.prompt.ts";
import { DNR_VOICE } from "../src/lib/dnr/dnr-voice.config.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicBase =
  process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
  "https://YOUR-WEBEE-DOMAIN.com";

const bundle = getDrNylaRetellPrompt(publicBase);
const base = publicBase.replace(/\/+$/, "");

const retellCustomTools = [
  {
    name: "list_services",
    description: "List Pabau treatment services available to book at Cheshire.",
    url: `${base}${bundle.tools.listServices}`,
    parameters: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "Always pass agent_b2afcd65c127f79126ea57deb2" },
      },
    },
  },
  {
    name: "check_availability",
    description: "Check appointment slots for a treatment at Medispa Cheshire.",
    url: `${base}${bundle.tools.checkAvailability}`,
    parameters: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        service_name: { type: "string", description: "Exact Pabau service name e.g. Ultherapy - Lower Face" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["service_name", "start_date", "end_date"],
    },
  },
  {
    name: "find_or_create_client",
    description:
      "Find existing Pabau client by phone or create new client. New clients require email, gender, and date of birth.",
    url: `${base}${bundle.tools.findOrCreateClient}`,
    parameters: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        phone: { type: "string", description: "Mobile with +44 where possible" },
        is_new_client: { type: "boolean", description: "true = create new client with extra fields below" },
        email: { type: "string", description: "Required when is_new_client is true" },
        gender: {
          type: "string",
          enum: ["Male", "Female", "Other"],
          description: "Required when is_new_client is true",
        },
        date_of_birth: {
          type: "string",
          description: "YYYY-MM-DD — required when is_new_client is true",
        },
        preferred_language: { type: "string", description: "Default English" },
        how_did_you_hear_about_us: { type: "string", description: "Optional referral source" },
      },
      required: ["first_name", "last_name", "phone"],
    },
  },
  {
    name: "book_appointment",
    description: "Book a treatment appointment in Pabau at Cheshire.",
    url: `${base}${bundle.tools.bookAppointment}`,
    parameters: {
      type: "object",
      properties: {
        agent_id: { type: "string" },
        contact_id: { type: "string" },
        service_name: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:MM" },
        notes: { type: "string" },
      },
      required: ["contact_id", "service_name", "start_date", "start_time"],
    },
  },
];

const outDir = resolve(__dir, "output");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "dnr-retell-custom-tools.json"), JSON.stringify(retellCustomTools, null, 2));
writeFileSync(resolve(outDir, "dnr-dr-nyla-retell-agent.json"), JSON.stringify(bundle, null, 2));

const transferNode = {
  name: "Transfer to Front of House",
  type: "transfer_call",
  instruction: {
    type: "static_text",
    text: "I'll connect you with our front-of-house team now.",
  },
  transfer_destination: {
    type: "predefined",
    number: DNR_VOICE.transferPhone,
  },
  transfer_option: {
    type: "cold_transfer",
    show_transferee_as_caller: true,
  },
  global_node_setting: {
    condition:
      "When caller asks for a person, Emma, front of house, complaint, refund, or booking fails twice.",
  },
};

const dashboardConfig = {
  _instructions:
    "Paste into Retell dashboard for agent_b2afcd65c127f79126ea57deb2. Replace BASE_URL before go-live.",
  retell_agent_id: "agent_b2afcd65c127f79126ea57deb2",
  retell_dashboard_url:
    "https://dashboard.retellai.com/agents/agent_b2afcd65c127f79126ea57deb2",
  BASE_URL: base,
  transfer_phone: DNR_VOICE.transferPhone,
  transfer_phone_notes: "FOH transfer when human needed — NOT the Retell AI inbound number",
  clinic_phone: DNR_VOICE.location.phone,
  agent_settings: {
    agent_name: bundle.agent_name,
    language: "en-GB",
    begin_message: bundle.begin_message,
    webhook_url: `${base}/api/public/voice-webhook`,
    webhook_events: ["call_started", "call_ended", "call_analyzed"],
  },
  conversation_flow: {
    global_prompt: bundle.general_prompt,
    start_speaker: "agent",
    model_choice: { type: "cascading", model: "gpt-4.1" },
    tools: retellCustomTools.map((t) => ({
      type: "custom",
      name: t.name,
      description: t.description,
      url: t.url,
      method: "POST",
      parameter_type: "json",
      args_at_root: false,
      timeout_ms: 120000,
      speak_during_execution: true,
      speak_after_execution: true,
      parameters: t.parameters,
    })),
    transfer_call_node: transferNode,
  },
  call_workflow: {
    description: "Tool-driven receptionist + transfer to FOH when needed.",
    steps: [
      { step: 1, action: "Agent speaks begin_message" },
      { step: 2, action: "Ask new or existing. Existing: name + phone. New: name, gender, DOB, email, mobile (+44), language" },
      { step: 3, tool: "list_services", when: "Need exact Pabau service name" },
      { step: 4, tool: "check_availability", when: "Caller wants to book" },
      { step: 5, tool: "find_or_create_client", when: "Before booking" },
      { step: 6, tool: "book_appointment", when: "Caller confirms slot" },
      { step: 7, action: "Confirm booking + Castlerock House address" },
      {
        step: 8,
        action: "transfer_call",
        number: DNR_VOICE.transferPhone,
        when: "Human needed — complaint, Emma, person, 2 booking failures",
      },
    ],
  },
};

writeFileSync(
  resolve(outDir, "dnr-retell-dashboard-config.json"),
  JSON.stringify(dashboardConfig, null, 2),
);

writeFileSync(resolve(outDir, "dnr-retell-global-prompt.txt"), bundle.general_prompt);

const retellSteps = {
  agent_url: "https://dashboard.retellai.com/agents/agent_b2afcd65c127f79126ea57deb2",
  steps: [
    {
      where: "Agent → Settings → Begin message",
      value: bundle.begin_message,
    },
    {
      where: "Agent → Settings → Webhook URL",
      value: `${base}/api/public/voice-webhook`,
    },
    {
      where: "Conversation Flow → Global prompt",
      file: "scripts/output/dnr-retell-global-prompt.txt",
      note: "Copy entire file contents",
    },
    {
      where: "Conversation Flow → Tools (4 custom functions)",
      file: "scripts/output/dnr-retell-dashboard-config.json",
      path: "conversation_flow.tools",
      note: "Update find_or_create_client params if tool already exists",
    },
    {
      where: "Conversation Flow → Global node → Transfer Call",
      file: "scripts/output/dnr-retell-dashboard-config.json",
      path: "conversation_flow.transfer_call_node",
      number: DNR_VOICE.transferPhone,
    },
    { where: "Publish", action: "Publish agent after all changes" },
  ],
};
writeFileSync(resolve(outDir, "dnr-retell-update-steps.json"), JSON.stringify(retellSteps, null, 2));

spawnSync("bun", ["scripts/generate-dnr-retell-import.mjs"], {
  cwd: resolve(__dir, ".."),
  env: { ...process.env, PUBLIC_BASE_URL: base },
  stdio: "inherit",
});

console.log(`
=== DNR Dr Nyla Voice System ===

Retell agent (yours):
  https://dashboard.retellai.com/agents/agent_b2afcd65c127f79126ea57deb2

CHECKLIST (do in order):

1. WEBEE — Pabau connected (SystemMind → CRM Connections) ✅ if tested

2. WEBEE — Link agent to DNR workspace:
     node --env-file=.env scripts/link-dnr-retell-agent.mjs

3. Retell — Agent settings:
     • Begin message: ${bundle.begin_message}
     • General prompt: copy from scripts/output/dnr-dr-nyla-retell-agent.json → general_prompt
     • Webhook URL: ${base}/api/public/voice-webhook
     • Add 4 custom tools from scripts/output/dnr-retell-custom-tools.json
     • Publish agent

4. Retell — Import JSON:
     • Conversation flow: scripts/output/dnr-retell-conversation-flow-import.json
     • Or full agent: scripts/output/dnr-retell-agent-import.json
     • Publish agent

5. Pabau API key — enable WRITE for Clients + Appointments

FILES:
  scripts/output/dnr-dr-nyla-retell-agent.json
  scripts/output/dnr-retell-custom-tools.json
  scripts/output/dnr-retell-dashboard-config.json
  scripts/output/dnr-retell-global-prompt.txt
  scripts/output/dnr-retell-update-steps.json
  scripts/output/dnr-retell-agent-import.json  ← FULL upload JSON for Retell
`);
