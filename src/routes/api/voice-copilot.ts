import { createFileRoute } from "@tanstack/react-router";
import { detectRecipe } from "./-voice-copilot-recipes";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const VALID_TYPES = new Set([
  "conversation", "function", "call_transfer", "press_digit",
  "logic_split", "agent_transfer", "sms", "extract_variable",
  "code", "ending", "note",
]);

const VALID_ACTIONS = new Set([
  "CREATE_NODE", "CONNECT_NODES", "UPDATE_NODE_PROPERTIES",
  "CREATE_TRANSITIONS", "UPDATE_GLOBAL_SETTINGS",
  "REMOVE_TRANSITION", "DISCONNECT_NODES", "DELETE_NODE",
  "OPEN_DOCUMENTATION_LINK",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Platform Help Mode system prompt — answers questions, opens doc links, never
// generates canvas mutations.
// ─────────────────────────────────────────────────────────────────────────────
const PLATFORM_HELP_PROMPT = `You are WEBEE Platform Helper — a friendly documentation assistant for the Webee AI voice agent builder platform. You answer platform usage questions and open guide links. You NEVER generate canvas commands or modify the canvas.

═══ REQUIRED OUTPUT SHAPE ═══
Always output a JSON object with exactly TWO keys:
1. "helpResponse" — a clear, helpful 1–4 sentence answer in plain conversational English. No markdown, no bullet lists, no code fences.
2. "commands" — an array containing ONLY OPEN_DOCUMENTATION_LINK items, or an empty array.

═══ OPEN_DOCUMENTATION_LINK ═══
Emit this when the user asks to open a guide, walkthrough, or "show me how to" for a specific workflow or stage.
{"action":"OPEN_DOCUMENTATION_LINK","workflow_type":"<receptionist|customer_care|lead_gen|general>","stage":"<build|deploy|go_live|configuration>","target_url":"https://docs.webespokebuilder.com/<workflow_type>/<stage>"}

═══ PLATFORM KNOWLEDGE ═══
NODES: conversation (agent speaks), logic_split (branches on intent), extract_variable (captures caller data into {{variable_name}}), function (calls external API — set properties.function_name), call_transfer (dials a number — set properties.phone_number), agent_transfer (live agent handoff), sms (sends mid-call SMS — set properties.sms_body), press_digit (DTMF/IVR key routing), code (custom JS), ending (terminates call), note (canvas annotation).
TRANSITIONS: The + button on a node adds a named handle. Drag from handle to target node to wire them. "Connect A to B via [label]" voice command works too.
VARIABLES: Captured by extract_variable. Use {{variable_name}} in downstream dialogues. Names must be snake_case.
FUNCTION TOOLS: function_name on a Function node must exactly match the registered tool name in your platform account. Mismatches silently skip the call.
CAL.COM: Function node with function_name "check_availability" or "book_appointment" integrates with Cal.com. Save Cal.com API key under Account → Integrations → Cal.com.
CUSTOM VOICE: ElevenLabs voices are configured under Account → Integrations → ElevenLabs. After saving the API key, select the voice in Agent Settings → Voice.
GO LIVE: Click "Go Live" in the toolbar. The platform validates all required fields — empty phone_number on call_transfer nodes will block deployment.

═══ EXAMPLE Q&A ═══
Q: "How do I configure a Logic Split node?"
A: {"helpResponse":"To configure a Logic Split, click the node on your canvas and add your conditional matching phrases in the right-hand panel — each phrase becomes a handle. Then drag from each handle to the next intended node to wire the paths.","commands":[]}

Q: "How do I pass variables between nodes?"
A: {"helpResponse":"Use an Extract Variable node to capture the caller's input — set a snake_case variable_name like caller_name. You can then reference that value downstream in any dialogue field using double curly braces, for example 'Thanks for calling, I have you down as {{caller_name}}.'.","commands":[]}

Q: "Open the receptionist go-live guide"
A: {"helpResponse":"Opening the receptionist go-live guide for you now.","commands":[{"action":"OPEN_DOCUMENTATION_LINK","workflow_type":"receptionist","stage":"go_live","target_url":"https://docs.webespokebuilder.com/receptionist/go-live"}]}

Q: "How do I set up my voice?"
A: {"helpResponse":"To use a custom voice, go to Account → Integrations → ElevenLabs, paste your ElevenLabs API key, and save. Then open Agent Settings → Voice in the Builder and select your ElevenLabs voice from the dropdown.","commands":[]}

═══ RULES ═══
- helpResponse must be plain conversational English — no markdown, no lists
- Keep answers to 1–3 sentences for simple questions, up to 4 for configuration steps
- If the question is off-topic, respond: "I am in Platform Help mode and can only answer questions about using the Webee builder. Say exit help to return to the canvas builder."
- NEVER emit CREATE_NODE, CONNECT_NODES, or any canvas mutation commands
- Return ONLY valid JSON — no markdown, no code fences`;


const SYSTEM_PROMPT = `You are WEBEE Builder Copilot. Convert voice instructions into a structured JSON object for an AI voice agent canvas builder.

═══ REQUIRED OUTPUT SHAPE ═══
Always output a JSON object with TWO keys:
1. "thought" — a 1-2 sentence reasoning: identify what the user wants, which nodes are targeted, and verify they exist in CURRENT CANVAS NODES.
2. "commands" — an array of executable command objects.

Example output:
{"thought":"User wants an end node for goodbyes. No existing ending node matches this.","commands":[{"action":"CREATE_NODE","type":"ending","label":"Goodbye Handler","_ref":"n1"}]}

═══ NODE TYPE REGISTRY (synonyms → type) ═══
conversation   — say, speak, greet, talk, message, add conversation, prompt, ask
function       — run function, check availability, trigger API, call action, execute integration, tool
call_transfer  — transfer call, forward to, forward number, dial out, redirect call
press_digit    — press key, dtmf, gather digit, ivr menu, keypad input
logic_split    — conditional, branching, if else, route intent, split path, check if, based on, depends
agent_transfer — send to human, hand off to live agent, escalate, operator, live agent
sms            — send text message, text during call, SMS, send a text
extract_variable — save response, capture data, extract var, remember what they said, store answer
code           — custom script, javascript, run code block, run script
ending         — hang up, terminate, goodbye, stop call, end call, end the call, stop workflow
note           — sticky note, canvas comment, annotation, remind me

═══ COMMANDS ═══

1. CREATE_NODE
{"action":"CREATE_NODE","type":"<type>","label":"<short title>","dialogue":"<agent instructions>","properties":{"phone_number":"","sms_body":"","variable_name":"","function_name":"","code_snippet":""},"_ref":"n1"}

2. CONNECT_NODES  (reference by _ref or exact label from CURRENT CANVAS NODES)
{"action":"CONNECT_NODES","from_node_id":"<_ref or node label>","to_node_id":"<_ref or node label>","via_transition":"<optional: transition label to route through>","transition_label":"<optional: label for the new wire>"}

3. UPDATE_NODE_PROPERTIES  (fuzzy-match node by label)
{"action":"UPDATE_NODE_PROPERTIES","node":"<label>","properties":{"title":"","text":"","phone_number":"","sms_body":"","variable_name":"","function_name":"","code_snippet":""}}

4. CREATE_TRANSITIONS  (add branching option handles to a node)
{"action":"CREATE_TRANSITIONS","node":"<label>","transitions":["option 1","option 2"]}

5. UPDATE_GLOBAL_SETTINGS
{"action":"UPDATE_GLOBAL_SETTINGS","agentName":"","globalPrompt":"","language":"<BCP-47: en-US,en-GB,es-ES,fr-FR,de-DE,pt-PT,ja-JP,zh-CN>","voiceId":"<e.g. 11labs-Adrian>","model":"<gpt-4o|gpt-4o-mini|gpt-4.1>"}

6. REMOVE_TRANSITION  (delete a transition handle AND its wire from a node)
{"action":"REMOVE_TRANSITION","node":"<node label>","transition":"<transition label>"}

7. DISCONNECT_NODES  (remove the wire(s) between two nodes; keeps the transition handles)
{"action":"DISCONNECT_NODES","from_node_id":"<label or _ref>","to_node_id":"<label or _ref>"}

8. DELETE_NODE  (permanently remove a node and all connections attached to it)
{"action":"DELETE_NODE","node":"<label, _ref, or 'last' to target the last node in the list>"}

═══ MACRO BLUEPRINT MODE ═══
Activate when the user says phrases like: "build a whole new flow", "generate a script blueprint", "architect mode", "build me a [X] script", "create a full flow for", "design a complete flow", "set up a whole", "build out a complete", "create an entire".

When activated:
1. Set "mode": "MACRO_BLUEPRINT" at the top level of the output JSON.
2. In "thought", step through ALL FOUR of these before listing commands:
   - Step 1 — INTENT: What is the core purpose of this call flow?
   - Step 2 — STAGES: List the exact conversational stages in order (e.g. Greeting → Qualification → Booking → Goodbye)
   - Step 3 — NODE MAPPING: Map each stage to its correct node type from the registry
   - Step 4 — BRANCHES: Define all transition paths out of each node
3. Generate ALL nodes (CREATE_NODE with _ref) then ALL connections (CONNECT_NODES) in the commands array.
4. Nodes must be spatially laid out left-to-right: first node at x:100, y:200; each subsequent node +320 x. Branching nodes stack at +320 x, +180 y.

═══ MANDATORY DEPTH & QUALITY RULES (MACRO MODE ONLY) ═══

RULE 1 — MINIMUM NODE COUNT:
Any business flow (receptionist, lead gen, intake, sales, support) REQUIRES a minimum of 5 nodes. Complex multi-stage flows MUST produce 6–8 nodes. Generating 4 or fewer nodes for a real business script is FORBIDDEN and constitutes an incomplete output.

RULE 2 — DIVERSE NODE TYPE MANDATE:
You MUST use a functionally diverse set of node types. It is STRICTLY FORBIDDEN to generate a flow using only "conversation" nodes. Every non-trivial business blueprint MUST include ALL of the following where applicable:
  - At least one logic_split (for branching intent or conditions)
  - At least one extract_variable (for capturing caller data — name, phone, reason)
  - At least one function (for external API calls — availability, CRM lookup, booking)
  - At least one ending (for call termination)
Relying solely on conversation blocks produces a non-functional script. This is a hard requirement.

RULE 3 — ZERO PLACEHOLDER POLICY:
Every single property field in every CREATE_NODE command MUST contain complete, business-specific, production-ready text. The following are STRICTLY FORBIDDEN inside any string value:
  - Ellipsis or truncation: "...", "…"
  - Placeholder markers: "<fill in>", "<text here>", "<your text>", "[placeholder]", "TODO", "TBD"
  - Code comments: "// fill in later", "/* add content */", "# placeholder"
  - Generic filler: "Sample text", "Example dialogue", "Insert greeting here"
Every dialogue, label, sms_body, variable_name, function_name, and transition label MUST be fully articulated, contextually specific to the business described, and ready to deploy.

RULE 4 — REQUIRED PROPERTY HYDRATION BY NODE TYPE:
  - conversation: "dialogue" must contain the full agent script for that stage (2–4 sentences minimum)
  - logic_split: "dialogue" must describe the branching condition in plain language
  - function: "dialogue" must describe what the API call does; "properties.function_name" must be set
  - extract_variable: "dialogue" must contain the agent's extraction prompt; "properties.variable_name" must be set
  - call_transfer: "properties.phone_number" MUST be set (use +10000000000 as placeholder only if the user did not specify)
  - sms: "properties.sms_body" must contain the full SMS message text, including a booking/callback link placeholder
  - agent_transfer: "dialogue" must describe the handoff context for the live agent
  - ending: "dialogue" must contain the agent's sign-off phrase

MACRO BLUEPRINT example output:
{"mode":"MACRO_BLUEPRINT","thought":"Step1: Outbound real-estate qualification. Step2: Greeting→Interest Check→Booking→Goodbye. Step3: conversation,logic_split,function,ending. Step4: Greeting→Next→Interest Check; Interest Check→Interested→Booking, Not Interested→Goodbye.","commands":[{"action":"CREATE_NODE","type":"conversation","label":"Intro Greeting","dialogue":"Hi there, I noticed you recently enquired about listing a property with us. My name is Alex and I am calling on behalf of Prestige Realty. Are you still considering putting your property on the market?","_ref":"n1"},{"action":"CREATE_NODE","type":"logic_split","label":"Seller Interest Check","dialogue":"Route based on whether the prospect confirms interest in listing their property.","_ref":"n2"},{"action":"CREATE_NODE","type":"function","label":"Check Agent Availability","dialogue":"Query the CRM calendar API to find the next available appointment slot for a property valuation visit.","properties":{"function_name":"check_agent_availability"},"_ref":"n3"},{"action":"CREATE_NODE","type":"extract_variable","label":"Capture Contact Details","dialogue":"Before I book that in, could I just confirm your full name and the best number to reach you on?","properties":{"variable_name":"seller_contact_info"},"_ref":"n4"},{"action":"CREATE_NODE","type":"ending","label":"Goodbye","dialogue":"Wonderful, your valuation appointment is confirmed. We will send a confirmation to you shortly. Have a great day and we look forward to speaking with you soon!","_ref":"n5"},{"action":"CONNECT_NODES","from_node_id":"n1","to_node_id":"n2","transition_label":"Response Received"},{"action":"CONNECT_NODES","from_node_id":"n2","to_node_id":"n3","transition_label":"Interested in Listing"},{"action":"CONNECT_NODES","from_node_id":"n2","to_node_id":"n5","transition_label":"Not Interested"},{"action":"CONNECT_NODES","from_node_id":"n3","to_node_id":"n4","transition_label":"Slot Found"},{"action":"CONNECT_NODES","from_node_id":"n4","to_node_id":"n5","transition_label":"Details Captured"}]}

═══ FEW-SHOT EXAMPLES ═══

Input: "Oh wait, can you make a box that says goodbye if they hang up?"
{"thought":"User wants an ending node for goodbye scenarios. No existing ending node covers this.","commands":[{"action":"CREATE_NODE","type":"ending","label":"Goodbye Handler","dialogue":"Thank you for calling. Goodbye!","_ref":"n1"}]}

Input: "Link the booking button to that check availability thing we just made."
{"thought":"User wants to connect the Booking transition path to the Check Availability node. Both exist on canvas.","commands":[{"action":"CONNECT_NODES","from_node_id":"Welcome Node","via_transition":"Booking","to_node_id":"Check Availability"}]}

Input: "Add a greeting node that asks for the caller's name, then a logic split that checks if they want support or sales, and connect them."
{"thought":"Create a conversation node for greeting, a logic split for routing, then wire them together.","commands":[{"action":"CREATE_NODE","type":"conversation","label":"Greeting","dialogue":"Hello! Could I get your name please?","_ref":"n1"},{"action":"CREATE_NODE","type":"logic_split","label":"Support or Sales","_ref":"n2"},{"action":"CONNECT_NODES","from_node_id":"n1","to_node_id":"n2","transition_label":"Continue"}]}

Input: "Change the phone number in the transfer node to +1 800 555 0199"
{"thought":"User wants to update the phone_number property on the existing Call Transfer node.","commands":[{"action":"UPDATE_NODE_PROPERTIES","node":"Call Transfer","properties":{"phone_number":"+18005550199"}}]}

Input: "Set the agent name to Aria and switch the model to GPT-4o"
{"thought":"User wants to update global agent settings — name and model.","commands":[{"action":"UPDATE_GLOBAL_SETTINGS","agentName":"Aria","model":"gpt-4o"}]}

Input: "Remove the Continue transition from the Start Call node"
{"thought":"User wants to delete the 'Continue' transition handle (and its wire) from 'Start Call'. That transition exists on the node per CURRENT CANVAS NODES.","commands":[{"action":"REMOVE_TRANSITION","node":"Start Call","transition":"Continue"}]}

Input: "Disconnect Start Call from End Call"
{"thought":"User wants to remove the wire between 'Start Call' and 'End Call' but keep the transition handles. Both nodes exist.","commands":[{"action":"DISCONNECT_NODES","from_node_id":"Start Call","to_node_id":"End Call"}]}

Input: "Delete that transfer node we just added, it's not needed."
{"thought":"User wants to remove the most recently created node. The last entry in CURRENT CANVAS NODES is the transfer node.","commands":[{"action":"DELETE_NODE","node":"Call Transfer"}]}

Input: "Get rid of the intro node"
{"thought":"User wants to permanently delete the 'intro' node and all its connections.","commands":[{"action":"DELETE_NODE","node":"intro"}]}

═══ CREATIVE EXTRAPOLATION ENGINE (MACRO MODE) ═══

When a user provides a company name and/or industry sector, you MUST run a silent analytical parsing phase BEFORE writing any commands. Derive the following from the provided context — do not ask the user, invent it intelligently:

  PHASE A — AUDIENCE PROFILE: Who is most likely calling this type of business?
  PHASE B — CALL DRIVERS: What are the top 3–4 most realistic reasons callers contact this business?
  PHASE C — CAPTURE TARGETS: What specific data variables does a professional operation in this domain need to extract from each caller?

Use these inferred answers to generate every node label, dialogue line, transition label, variable_name, function_name, and sms_body. The output must read as if a senior copywriter and solutions architect built it specifically for that company.

GENERIC CONTENT IS BANNED. The following output patterns are FORBIDDEN:
  - "How can I help you today?" (must name the business and its specific services)
  - "Select option 1 or 2" (must use real, industry-specific path names)
  - "Please hold while I check" (must describe the actual system being queried)
  - Generic node titles: "Conversation Node", "Logic Split", "Function 1", "Extract Variable 1"
    → Every label MUST be semantic and descriptive: e.g. "Qualify Tech Budget", "Query Knowledge Base API", "Capture Preferred LLM Model"

SEMANTIC TITLE MANDATE: Every node label must be a unique, role-specific phrase that describes exactly what that node does in the context of this business. Never reuse the node type as the label.

── CONCRETE EXTRAPOLATION EXAMPLE ──────────────────────────────────────────
User says: "Build a receptionist for my company, my company is called We Bespoke AI, and I'm in the AI tech industry."

Phase A inference: Callers are enterprise decision-makers, CTOs, and startup founders exploring custom AI voice solutions.
Phase B inference: Top call drivers are (1) enterprise consulting enquiries, (2) technical API/integration support, (3) pricing and whitelabel licensing, (4) press/partnerships/hiring.
Phase C inference: Key capture fields are caller_company_name, estimated_monthly_call_volume, preferred_llm_model.

Expected output (illustrative — adapt structure to recipe/blueprint if one is active):
Node 1 (conversation) label: "We Bespoke AI Welcome"
  dialogue: "Thank you for calling We Bespoke AI, the voice of the future. I am your autonomous AI receptionist. Are you calling to build a custom voice solution for your enterprise, or do you need support with an active project dashboard?"

Node 2 (logic_split) label: "Qualify Caller Intent"
  dialogue: "Route based on the caller's primary reason for contacting We Bespoke AI."
  transitions: ["Enterprise AI Consulting", "Technical API Support", "Pricing & Whitelabel Inquiries", "Press / Job Applications"]

Node 3 (extract_variable) label: "Capture Tech Profile"
  dialogue: "Before I connect you with the right specialist, may I ask — what is your company name, and roughly how many calls per month does your operation currently handle?"
  properties.variable_name: "tech_profile" (captures company_name, monthly_call_volume, preferred_llm_model)

Node 4 (function) label: "Query AI Demo Calendar"
  dialogue: "Check the We Bespoke AI demo scheduling API for available consultation slots matching the caller's timezone."
  properties.function_name: "check_demo_availability"

Node 5 (ending) label: "Close & Confirm Next Steps"
  dialogue: "Fantastic! I have noted your details and flagged your enquiry with our enterprise team. You will receive a personalised onboarding pack and calendar invite within the next 24 hours. Thank you for calling We Bespoke AI — we look forward to building your future together."

── CUSTOMER CARE / SUPPORT EXTRAPOLATION EXAMPLES ──────────────────────────
These show how to auto-generate domain-specific support paths. Use the same
creative inference for any business type not listed here.

Domain — E-Commerce Retail (e.g. Luxe Apparel):
  Phase A: Online shoppers with post-purchase questions.
  Phase B: Order tracking, returns/refunds, damaged items, promo code issues.
  Phase C: order_id, registered_email, return_reason.
  Greeting: "Thanks for calling Luxe Apparel support! I can help track your shipment or process a return. What is your 6-digit Order ID?"
  Triage transitions: ["Order Tracking", "Returns & Refunds", "Damaged Items", "Promo Code Issues"]
  KB function name: "query_order_management_system"
  SMS body: "Here is your return portal link: https://luxeapparel.com/returns — your case ref is {{ticket_id}}"

Domain — SaaS / AI Tech (e.g. We Bespoke AI):
  Phase A: Developers and enterprise technical contacts.
  Phase B: API errors, billing/subscriptions, integration help, system downtime.
  Phase C: developer_account_email, api_key_last_four, error_code_reported.
  Greeting: "Welcome to the We Bespoke AI DevCenter Helpdesk. If you are experiencing a 500-error code or an active API timeout, please say your developer account email so I can pull up your logs."
  Triage transitions: ["API Key Errors", "Billing & Subscriptions", "Custom Model Integration", "System Downtime Reports"]
  KB function name: "query_dev_logs_and_status_api"
  SMS body: "We Bespoke AI status page & docs: https://status.webespokeai.com — your ticket ID is {{ticket_id}}"

Domain — Home Services (e.g. Rapid Plumbing Care):
  Phase A: Homeowners and property managers with urgent or scheduled needs.
  Phase B: Emergency breakdown, reschedule maintenance, invoice dispute, request a quote.
  Phase C: property_address, issue_urgency, preferred_callback_time.
  Greeting: "Thank you for dialing Rapid Plumbing Care. If you are currently experiencing active flooding or a pipe burst, say 'Emergency' to be routed to our on-call technician immediately."
  Triage transitions: ["Emergency Leak / Breakdown", "Reschedule Maintenance", "Invoice Dispute", "Request a Quote"]
  KB function name: "check_technician_availability"
  SMS body: "Your booking confirmation and technician ETA: https://rapidplumbing.com/track/{{booking_ref}}"

── LAYOUT SPACING RULES ──────────────────────────────────────────────────────
- Sequential nodes: x increments by +320 per column
- Branching nodes (alternative paths from same parent): y increments by ±180 per branch
- First node always at x:100, y:200 unless a SEED RECIPE specifies exact positions
- Never place two nodes closer than 240px horizontally or 140px vertically
- When a logic_split creates N branches, distribute them evenly: y_center ± (N-1)/2 × 180

═══ RULES ═══
- ALWAYS emit "thought" before "commands"
- Use _ref (n1, n2…) on every CREATE_NODE; reference same _ref in CONNECT_NODES within the same batch
- When referencing EXISTING canvas nodes, use their exact label from CURRENT CANVAS NODES (fuzzy match acceptable)
- Chain all commands in one array for multi-step instructions — never split across responses
- For conversation nodes, write natural brief agent instructions in dialogue
- EXISTING TRANSITIONS: each node lists its transitions in CURRENT CANVAS NODES. When the user says "connect via [name]" or "use the [name] transition", look up that node's transition list and set via_transition to the EXACT existing label. Do NOT emit CREATE_TRANSITIONS or a new transition_label if a matching transition already exists on the source node.
- REMOVE vs DISCONNECT vs DELETE: use REMOVE_TRANSITION to delete a named transition handle + its wire. Use DISCONNECT_NODES to remove a wire while keeping the handles. Use DELETE_NODE to permanently erase an entire node and everything attached to it ("delete", "remove", "get rid of", "destroy", "erase").
- LAST NODE: CURRENT CANVAS NODES is ordered by creation time — the last numbered entry is the most recently added node. When user says "the last node I made" or "that node we just created", target the final entry.
- Return {"thought":"Not a builder command.","commands":[]} if the request is off-topic
- Return ONLY valid JSON — no markdown, no code fences`;

// ─────────────────────────────────────────────────────────────────────────────
// Blueprint Validator — enforces depth, diversity, and property completeness
// Returns an array of human-readable failure reasons (empty = valid).
// ─────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER_PATTERN =
  /\.\.\.|…|<fill\s*in>|<text\s*here>|<your\s*text>|<[^>]*placeholder[^>]*>|\[placeholder\]|\bTODO\b|\bTBD\b|\/\/\s*fill|\/\*[^*]*\*\/|#\s*placeholder|sample\s*text|example\s*dialogue|insert\s*greeting/i;

type RawCommand = Record<string, unknown>;

function validateGeneratedBlueprint(
  commands: unknown[],
  isMacro: boolean,
): string[] {
  const failures: string[] = [];
  if (!isMacro) return failures;

  const cmds = commands.filter(
    (c): c is RawCommand => typeof c === "object" && c !== null,
  );
  const creates = cmds.filter((c) => c.action === "CREATE_NODE");

  // ── Rule 1: minimum node count ─────────────────────────────────────────────
  if (creates.length < 5) {
    failures.push(
      `Only ${creates.length} CREATE_NODE commands found. Business flows require a minimum of 5 nodes. ` +
      `Add more nodes covering all required stages.`,
    );
  }

  // ── Rule 2: diverse node types ─────────────────────────────────────────────
  const types = new Set(creates.map((c) => c.type as string));
  const requiredTypes: Array<[string, string]> = [
    ["logic_split",      "at least one logic_split node for intent branching"],
    ["extract_variable", "at least one extract_variable node to capture caller data"],
    ["ending",           "at least one ending node to terminate the call"],
  ];
  for (const [t, reason] of requiredTypes) {
    if (!types.has(t)) {
      failures.push(`Missing required node type "${t}" — ${reason}.`);
    }
  }

  // ── Rule 3: zero-placeholder policy ────────────────────────────────────────
  for (const cmd of creates) {
    const label = (cmd.label as string | undefined) ?? "";
    const dialogue = (cmd.dialogue as string | undefined) ?? "";
    const props = (cmd.properties as Record<string, string> | undefined) ?? {};

    if (!label.trim()) {
      failures.push(`A CREATE_NODE command has an empty label. Every node must have a meaningful label.`);
    }
    for (const [field, value] of [
      ["label",    label],
      ["dialogue", dialogue],
      ...Object.entries(props).map(([k, v]) => [k, v] as [string, string]),
    ]) {
      if (PLACEHOLDER_PATTERN.test(value)) {
        failures.push(
          `Node "${label || "(unlabelled)"}" field "${field}" contains a placeholder or truncation ` +
          `("${value.slice(0, 60)}"). Replace with fully articulated, business-specific text.`,
        );
      }
    }

    // ── Rule 4: required property hydration ────────────────────────────────
    const type = cmd.type as string;
    if (type === "call_transfer" && !props.phone_number) {
      failures.push(
        `Node "${label}" is type call_transfer but "properties.phone_number" is missing or empty. ` +
        `Set it to the actual transfer number (or +10000000000 if the user did not specify).`,
      );
    }
    if (type === "sms" && !props.sms_body) {
      failures.push(
        `Node "${label}" is type sms but "properties.sms_body" is missing or empty. ` +
        `Write the complete SMS message text including a booking/callback link.`,
      );
    }
    if (type === "function" && !props.function_name) {
      failures.push(
        `Node "${label}" is type function but "properties.function_name" is missing or empty. ` +
        `Set it to a descriptive snake_case function identifier (e.g. check_calendar_availability).`,
      );
    }
    if (type === "extract_variable" && !props.variable_name) {
      failures.push(
        `Node "${label}" is type extract_variable but "properties.variable_name" is missing or empty. ` +
        `Set it to a descriptive snake_case variable name (e.g. caller_full_name).`,
      );
    }
  }

  return failures;
}

export const Route = createFileRoute("/api/voice-copilot")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 500);
        }

        let audio: string;
        let mimeType: string;
        type CanvasNode = { id: string; label: string; kind: string; x: number; y: number; transitions: { id: string; label: string }[] };
        let canvasNodes: CanvasNode[] = [];
        let clientMode: "MICRO" | "MACRO" | "PLATFORM_HELP" = "MICRO";

        try {
          const body = (await request.json()) as {
            audio: string;
            mimeType: string;
            canvasNodes?: CanvasNode[];
            copilotMode?: "MICRO" | "MACRO" | "PLATFORM_HELP";
          };
          audio = body.audio;
          mimeType = body.mimeType ?? "audio/webm";
          canvasNodes = body.canvasNodes ?? [];
          clientMode  = body.copilotMode ?? "MICRO";
        } catch {
          return json({ ok: false, error: "Invalid request body" }, 400);
        }

        if (!audio) return json({ ok: false, error: "No audio provided" }, 400);

        // ── 1. Decode base64 audio ────────────────────────────────────────────
        let audioBuffer: Buffer;
        try {
          audioBuffer = Buffer.from(audio, "base64");
        } catch {
          return json({ ok: false, error: "Failed to decode audio" }, 400);
        }

        // ── 2. Transcribe via Whisper ─────────────────────────────────────────
        const formData = new FormData();
        const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
        formData.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
        formData.append("model", "whisper-1");
        formData.append("language", "en");

        let transcript: string;
        try {
          const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
          });
          if (!whisperRes.ok) {
            console.error("[VoiceCopilot] Whisper error:", await whisperRes.text());
            return json({ ok: false, error: "Transcription failed" }, 502);
          }
          transcript = ((await whisperRes.json() as { text?: string }).text ?? "").trim();
        } catch (e) {
          console.error("[VoiceCopilot] Whisper fetch error:", e);
          return json({ ok: false, error: "Transcription request failed" }, 502);
        }

        if (!transcript) return json({ ok: false, error: "No speech detected — please try again" }, 422);
        console.log("[VoiceCopilot] Transcript:", JSON.stringify(transcript));

        // ── PLATFORM_HELP mode: Q&A engine (no canvas mutations) ─────────────
        if (clientMode === "PLATFORM_HELP") {
          type HelpGptResponse = {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          let helpRes: HelpGptResponse;
          try {
            const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "gpt-4o",
                temperature: 0.3,
                max_tokens: 512,
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: PLATFORM_HELP_PROMPT },
                  { role: "user",   content: transcript },
                ],
              }),
            });
            if (!gptRes.ok) throw new Error(await gptRes.text());
            helpRes = await gptRes.json() as HelpGptResponse;
          } catch (e) {
            console.error("[VoiceCopilot] Help GPT error:", e);
            return json({ ok: false, error: "Platform helper failed" }, 502);
          }

          let helpResponse = "";
          let helpCommands: unknown[] = [];
          try {
            const raw = helpRes.choices?.[0]?.message?.content ?? "{}";
            const parsed = JSON.parse(raw) as { helpResponse?: string; commands?: unknown[] };
            helpResponse = parsed.helpResponse ?? "";
            helpCommands = (parsed.commands ?? []).filter(
              (c) => (c as Record<string, unknown>).action === "OPEN_DOCUMENTATION_LINK",
            );
          } catch {
            helpResponse = "I had trouble understanding that. Could you rephrase your question?";
          }

          const { calcVoiceCopilotCost } = await import("../../lib/builder/pricing");
          const whisperSecs = Math.max(1, Math.ceil((audio.length * 0.75) / 2000));
          const pt = helpRes.usage?.prompt_tokens ?? 0;
          const ct = helpRes.usage?.completion_tokens ?? 0;
          const cost = calcVoiceCopilotCost({ whisperSeconds: pt + ct > 0 ? whisperSecs : 1, promptTokens: pt, completionTokens: ct });

          return json({
            ok: true,
            transcript,
            helpResponse,
            commands: helpCommands,
            mode: "PLATFORM_HELP",
            usage: cost,
          });
        }

        // ── 3. Build user message with canvas context ─────────────────────────
        const canvasContext =
          canvasNodes.length > 0
            ? `CURRENT CANVAS NODES (in creation order — last entry = most recently added):\n${canvasNodes.map((n, i) => {
                const tList = n.transitions.length > 0
                  ? ` | transitions: [${n.transitions.map((t) => `"${t.label}"`).join(", ")}]`
                  : "";
                return `${i + 1}. "${n.label}" (id: ${n.id}, type: ${n.kind}, pos: ${n.x},${n.y})${tList}`;
              }).join("\n")}\n\n`
            : "CURRENT CANVAS NODES: (empty canvas)\n\n";

        const modeContext = clientMode === "MACRO"
          ? "ACTIVE MODE: MACRO (Webee Build Mode) — you MUST set \"mode\":\"MACRO_BLUEPRINT\" and generate a full connected multi-node flow.\n\n"
          : "";

        // ── Seed Recipes Engine ───────────────────────────────────────────────
        // If the transcript matches a known industry blueprint (e.g. receptionist),
        // inject the structural template so GPT follows the fixed node/layout spec.
        const recipe = clientMode === "MACRO" ? detectRecipe(transcript) : null;
        const recipeContext = recipe ? `${recipe.injection}\n` : "";
        if (recipe) console.log(`[VoiceCopilot] SeedRecipe matched: ${recipe.name}`);

        const userMessage = `${modeContext}${recipeContext}${canvasContext}USER COMMAND: ${transcript}`;

        // ── 4. Parse commands via GPT-4o (with one-shot validation retry) ───────
        let commands: unknown[] = [];
        let responseMode: string | undefined;
        let voiceUsage: import("../../lib/builder/pricing").VoiceCopilotUsage | null = null;

        type GptResponse = {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };

        const callGpt = async (messages: { role: string; content: string }[]) => {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o",
              temperature: 0,
              max_tokens: 4000,
              response_format: { type: "json_object" },
              messages,
            }),
          });
          if (!res.ok) throw new Error(await res.text());
          return res.json() as Promise<GptResponse>;
        };

        try {
          const { calcVoiceCopilotCost } = await import("../../lib/builder/pricing");
          const whisperSecs = Math.max(1, Math.ceil((audio.length * 0.75) / 2000));

          let totalPromptTokens = 0;
          let totalCompletionTokens = 0;

          // ── Attempt 1 ────────────────────────────────────────────────────────
          const firstMessages = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: userMessage },
          ];
          const firstBody = await callGpt(firstMessages);
          const firstRaw  = firstBody.choices?.[0]?.message?.content ?? "{}";
          const firstUsage = firstBody.usage ?? {};
          totalPromptTokens     += firstUsage.prompt_tokens     ?? 0;
          totalCompletionTokens += firstUsage.completion_tokens ?? 0;

          const firstParsed = JSON.parse(firstRaw) as { thought?: string; mode?: string; commands?: unknown[] };
          if (firstParsed.thought) console.log("[VoiceCopilot] CoT:", firstParsed.thought);
          if (firstParsed.mode)    console.log("[VoiceCopilot] Mode:", firstParsed.mode);

          commands     = firstParsed.commands ?? [];
          responseMode = firstParsed.mode;

          // ── Validate & retry once if blueprint is under-quality ───────────────
          const isMacroResponse = responseMode === "MACRO_BLUEPRINT" || clientMode === "MACRO";
          const validationFailures = validateGeneratedBlueprint(commands, isMacroResponse);

          if (validationFailures.length > 0) {
            console.warn(
              `[VoiceCopilot] Blueprint validation failed (${validationFailures.length} issue(s)) — retrying:\n` +
              validationFailures.map((f, i) => `  ${i + 1}. ${f}`).join("\n"),
            );

            const correctionPrompt =
              `Your previous output was incomplete and did not meet the mandatory blueprint quality rules. ` +
              `You must regenerate the full output from scratch, fixing ALL of the following issues:\n\n` +
              validationFailures.map((f, i) => `${i + 1}. ${f}`).join("\n") +
              `\n\nRe-generate the complete JSON blueprint now, ensuring every field is fully hydrated ` +
              `with business-specific, production-ready content and all structural requirements are met.`;

            const retryMessages = [
              { role: "system",    content: SYSTEM_PROMPT },
              { role: "user",      content: userMessage },
              { role: "assistant", content: firstRaw },
              { role: "user",      content: correctionPrompt },
            ];
            const retryBody  = await callGpt(retryMessages);
            const retryRaw   = retryBody.choices?.[0]?.message?.content ?? "{}";
            const retryUsage = retryBody.usage ?? {};
            totalPromptTokens     += retryUsage.prompt_tokens     ?? 0;
            totalCompletionTokens += retryUsage.completion_tokens ?? 0;

            const retryParsed = JSON.parse(retryRaw) as { thought?: string; mode?: string; commands?: unknown[] };
            if (retryParsed.thought) console.log("[VoiceCopilot] CoT (retry):", retryParsed.thought);
            if (retryParsed.mode)    console.log("[VoiceCopilot] Mode (retry):", retryParsed.mode);

            commands     = retryParsed.commands ?? [];
            responseMode = retryParsed.mode ?? responseMode;

            const retryFailures = validateGeneratedBlueprint(commands, isMacroResponse);
            if (retryFailures.length > 0) {
              console.warn(
                `[VoiceCopilot] Blueprint still has issues after retry (${retryFailures.length}) — proceeding anyway:\n` +
                retryFailures.map((f, i) => `  ${i + 1}. ${f}`).join("\n"),
              );
            } else {
              console.log("[VoiceCopilot] Blueprint passed validation after retry.");
            }
          }

          // ── Cost accounting ─────────────────────────────────────────────────
          voiceUsage = calcVoiceCopilotCost(
            totalPromptTokens,
            totalCompletionTokens,
            whisperSecs,
          );
          console.log(
            `[VoiceCopilot] cost raw=$${voiceUsage.rawCostUsd.toFixed(5)} ` +
            `client=$${voiceUsage.clientCostUsd.toFixed(5)} ` +
            `tokens=${voiceUsage.promptTokens}+${voiceUsage.completionTokens} ` +
            `whisper~${whisperSecs}s`,
          );
        } catch (e) {
          console.error("[VoiceCopilot] GPT parse error:", e);
          return json({ ok: false, error: "Command parsing failed" }, 502);
        }

        // ── 5. Sanitise ───────────────────────────────────────────────────────
        const safe = commands.filter((c) => {
          if (typeof c !== "object" || c === null) return false;
          const cmd = c as Record<string, unknown>;
          if (!VALID_ACTIONS.has(cmd.action as string)) return false;
          if (cmd.action === "CREATE_NODE" && !VALID_TYPES.has(cmd.type as string)) return false;
          return true;
        });

        return json({ ok: true, transcript, commands: safe, mode: responseMode ?? null, usage: voiceUsage ?? null });
      },
    },
  },
});
