// ─────────────────────────────────────────────────────────────────────────────
// Voice Copilot — Seed Recipes Engine
//
// When a user invokes MACRO mode and describes a known industry flow (e.g.
// "build a receptionist"), the engine injects a hardcoded structural blueprint
// into the GPT context so it always produces the correct node types, layout
// positions, and stage sequencing — then adapts copy to the specific business.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedRecipe {
  name: string;
  /** Injected into the userMessage before the USER COMMAND line */
  injection: string;
}

// ── Receptionist Blueprint ────────────────────────────────────────────────────
const RECEPTIONIST_INJECTION = `
═══ SEED RECIPE ACTIVATED: VIRTUAL RECEPTIONIST BLUEPRINT ═══
Override the default MACRO_BLUEPRINT layout with this MANDATORY structural
template. You MUST:
  • Set "mode":"MACRO_BLUEPRINT" at the top level.
  • Generate exactly these 8 nodes with the exact types and positions specified.
  • Adapt ALL dialogue, labels, and transition text to match the specific
    business name/type described by the user (spa, law firm, dental clinic, etc.)
    — ONLY the text content adapts; node types and x/y positions are fixed.

── NODES (create in this order, include "position" in each CREATE_NODE) ─────

{"action":"CREATE_NODE","type":"conversation","label":"Welcome","dialogue":"<Greet the caller warmly. State the business name. Offer three options: booking an appointment, a general enquiry, or speaking to a staff member.>","_ref":"n1","position":{"x":100,"y":200}}

{"action":"CREATE_NODE","type":"logic_split","label":"Caller Triage","dialogue":"<Route based on caller intent>","_ref":"n2","position":{"x":420,"y":200}}

{"action":"CREATE_NODE","type":"function","label":"Check Availability","dialogue":"<Call the calendar/availability API (Cal.com) to retrieve open appointment slots before offering times to the caller.>","_ref":"n3","position":{"x":740,"y":80}}

{"action":"CREATE_NODE","type":"extract_variable","label":"Capture Caller Info","dialogue":"<Ask for and securely capture: caller full name, contact phone number, and reason for calling.>","properties":{"variable_name":"caller_info"},"_ref":"n4","position":{"x":740,"y":330}}

{"action":"CREATE_NODE","type":"agent_transfer","label":"Live Staff Transfer","dialogue":"<Transfer the call to a live staff member to handle the urgent request.>","_ref":"n5","position":{"x":740,"y":580}}

{"action":"CREATE_NODE","type":"conversation","label":"Booking Confirmed","dialogue":"<Confirm the appointment details with the caller. Provide a reference number and any preparation instructions relevant to the business type.>","_ref":"n6","position":{"x":1060,"y":80}}

{"action":"CREATE_NODE","type":"sms","label":"SMS Fallback","dialogue":"<No slots are available or it is outside business hours. Text the caller a digital booking link and a callback message.>","properties":{"sms_body":"<Business-specific booking link + callback message>"},"_ref":"n7","position":{"x":1060,"y":330}}

{"action":"CREATE_NODE","type":"ending","label":"Goodbye","dialogue":"<Politely end the call. Match the tone and sign-off phrase to the business type.>","_ref":"n8","position":{"x":1060,"y":580}}

── TRANSITIONS (after all nodes) ─────────────────────────────────────────────

{"action":"CREATE_TRANSITIONS","node":"n2","transitions":["Booking Appointment","General Inquiry","Speak to Staff"]}
{"action":"CREATE_TRANSITIONS","node":"n3","transitions":["Slots Available","No Slots"]}

── CONNECTIONS (after transitions) ──────────────────────────────────────────

{"action":"CONNECT_NODES","from_node_id":"n1","to_node_id":"n2","transition_label":"Start Triage"}
{"action":"CONNECT_NODES","from_node_id":"n2","to_node_id":"n3","via_transition":"Booking Appointment"}
{"action":"CONNECT_NODES","from_node_id":"n2","to_node_id":"n4","via_transition":"General Inquiry"}
{"action":"CONNECT_NODES","from_node_id":"n2","to_node_id":"n5","via_transition":"Speak to Staff"}
{"action":"CONNECT_NODES","from_node_id":"n3","to_node_id":"n6","via_transition":"Slots Available"}
{"action":"CONNECT_NODES","from_node_id":"n3","to_node_id":"n7","via_transition":"No Slots"}
{"action":"CONNECT_NODES","from_node_id":"n4","to_node_id":"n6","transition_label":"Confirmed"}
{"action":"CONNECT_NODES","from_node_id":"n7","to_node_id":"n8","transition_label":"After SMS"}

── THOUGHT TEMPLATE ─────────────────────────────────────────────────────────
In your "thought" field, complete these four steps:
  Step1: [Business type and purpose]
  Step2: Welcome → Caller Triage → {Booking: Check Availability → Booking Confirmed | No Slots: SMS Fallback → Goodbye} | {General Inquiry: Capture Caller Info → Booking Confirmed} | {Urgent: Live Staff Transfer}
  Step3: conversation, logic_split, function, extract_variable, agent_transfer, conversation, sms, ending
  Step4: n1→n2(Start Triage); n2→n3(Booking Appointment), n2→n4(General Inquiry), n2→n5(Speak to Staff); n3→n6(Slots Available), n3→n7(No Slots); n4→n6(Confirmed); n7→n8(After SMS)
═══ END SEED RECIPE ═══
`;

// ── Recipe Catalogue ──────────────────────────────────────────────────────────
const RECIPES: Array<{
  keywords: RegExp;
  recipe: SeedRecipe;
}> = [
  {
    // Matches: receptionist, reception, front desk, call handler, answering service,
    //          intake agent, welcome agent, booking agent, secretary
    keywords:
      /\b(receptionist|reception|front[\s-]?desk|call[\s-]?handler|answering[\s-]?service|intake[\s-]?agent|welcome[\s-]?agent|booking[\s-]?agent|secretary)\b/i,
    recipe: {
      name: "RECEPTIONIST",
      injection: RECEPTIONIST_INJECTION,
    },
  },
];

/**
 * Given the Whisper transcript, returns a matching SeedRecipe or null.
 * Only fires when the client is already in MACRO mode.
 */
export function detectRecipe(transcript: string): SeedRecipe | null {
  const lower = transcript.toLowerCase();
  for (const { keywords, recipe } of RECIPES) {
    if (keywords.test(lower)) return recipe;
  }
  return null;
}
