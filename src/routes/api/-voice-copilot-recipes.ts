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

// ── Customer Care / Support Blueprint ────────────────────────────────────────
const CUSTOMER_CARE_INJECTION = `
═══ SEED RECIPE ACTIVATED: CUSTOMER CARE / SUPPORT BLUEPRINT ═══
Override the default MACRO_BLUEPRINT layout with this MANDATORY structural
template. You MUST:
  • Set "mode":"MACRO_BLUEPRINT" at the top level.
  • Generate exactly these 8 nodes with the exact types and positions specified.
  • Apply the CREATIVE EXTRAPOLATION ENGINE: infer the business domain from the
    user's description, then autonomously populate ALL dialogue, labels, variable
    names, function names, SMS body, and transition labels with domain-specific,
    production-ready content. NEVER use generic placeholders.
  • Typical triage paths by domain (adapt to whatever business the user describes):
      E-Commerce:    Order Tracking | Returns & Refunds | Damaged Items | Promo Code Issues
      SaaS / Tech:   API Key Errors | Billing & Subscriptions | Integration Help | System Downtime
      Home Services: Emergency Breakdown | Reschedule Maintenance | Invoice Dispute | Request a Quote
      Healthcare:    Appointment Booking | Prescription Enquiry | Billing | General Health Query

── NODES (create in this order, include "position" in each CREATE_NODE) ─────

{"action":"CREATE_NODE","type":"conversation","label":"Support Intro","dialogue":"<Warmly greet the caller using the business name. Introduce the AI support assistant. Ask the caller to provide their authentication token (e.g. Order ID, Account Number, or Email address) to pull up their account.>","_ref":"n1","position":{"x":100,"y":300}}

{"action":"CREATE_NODE","type":"extract_variable","label":"Capture Auth Token","dialogue":"<Prompt the caller to say or type their account reference. Confirm the format expected (e.g. 'Please say your 6-digit Order ID or spell out your registered email address').>","properties":{"variable_name":"customer_auth_token"},"_ref":"n2","position":{"x":420,"y":300}}

{"action":"CREATE_NODE","type":"logic_split","label":"Issue Triage Matrix","dialogue":"<Route based on the nature of the caller's support issue. Branch into 3–5 domain-specific support channels derived from the user's business type.>","_ref":"n3","position":{"x":740,"y":300}}

{"action":"CREATE_NODE","type":"function","label":"Knowledge Base Lookup","dialogue":"<Query the company's knowledge base or CRM API using the auth token to retrieve the caller's account record, open tickets, or relevant help articles for their stated issue.>","properties":{"function_name":"query_knowledge_base"},"_ref":"n4","position":{"x":1060,"y":120}}

{"action":"CREATE_NODE","type":"logic_split","label":"Resolution Router","dialogue":"<Route based on whether the knowledge base returned a usable help article or an escalation flag.>","_ref":"n5","position":{"x":1380,"y":120}}

{"action":"CREATE_NODE","type":"sms","label":"SMS Deflection","dialogue":"<For issues resolvable with a link (password reset, tutorial, tracking page), send an SMS to the caller's phone with the direct URL so the call can close efficiently.>","properties":{"sms_body":"<Relevant help link or self-service URL tailored to the business and issue type>"},"_ref":"n6","position":{"x":1060,"y":330}}

{"action":"CREATE_NODE","type":"agent_transfer","label":"Live Escalation","dialogue":"<Transfer to a live support agent or specialist queue for critical, billing-sensitive, or unresolved issues that the knowledge base could not resolve.>","_ref":"n7","position":{"x":1060,"y":540}}

{"action":"CREATE_NODE","type":"ending","label":"Support Goodbye","dialogue":"<Thank the caller, confirm any actions taken or tickets raised, and close the call with a warm sign-off that matches the brand's tone.>","_ref":"n8","position":{"x":1700,"y":210}}

── TRANSITIONS (after all nodes) ─────────────────────────────────────────────

{"action":"CREATE_TRANSITIONS","node":"n3","transitions":["Standard Issue","Quick Fix Needed","Critical / Billing"]}
{"action":"CREATE_TRANSITIONS","node":"n5","transitions":["Article Found","Escalation Required"]}

── CONNECTIONS (after transitions) ──────────────────────────────────────────

{"action":"CONNECT_NODES","from_node_id":"n1","to_node_id":"n2","transition_label":"Continue"}
{"action":"CONNECT_NODES","from_node_id":"n2","to_node_id":"n3","transition_label":"Verified"}
{"action":"CONNECT_NODES","from_node_id":"n3","to_node_id":"n4","via_transition":"Standard Issue"}
{"action":"CONNECT_NODES","from_node_id":"n3","to_node_id":"n6","via_transition":"Quick Fix Needed"}
{"action":"CONNECT_NODES","from_node_id":"n3","to_node_id":"n7","via_transition":"Critical / Billing"}
{"action":"CONNECT_NODES","from_node_id":"n4","to_node_id":"n5","transition_label":"Knowledge Check Complete"}
{"action":"CONNECT_NODES","from_node_id":"n5","to_node_id":"n8","via_transition":"Article Found"}
{"action":"CONNECT_NODES","from_node_id":"n5","to_node_id":"n7","via_transition":"Escalation Required"}
{"action":"CONNECT_NODES","from_node_id":"n6","to_node_id":"n8","transition_label":"SMS Sent"}

── THOUGHT TEMPLATE ─────────────────────────────────────────────────────────
In your "thought" field, complete these four steps:
  Step1: [Business domain and support purpose — include inferred audience, top call drivers, and data capture targets from the Creative Extrapolation Engine]
  Step2: Support Intro → Capture Auth Token → Issue Triage → {Standard: KB Lookup → Resolution Router → Article Found: Goodbye | Escalation Required: Live Escalation} | {Quick Fix: SMS Deflection → Goodbye} | {Critical: Live Escalation}
  Step3: conversation, extract_variable, logic_split, function, logic_split, sms, agent_transfer, ending
  Step4: n1→n2(Continue); n2→n3(Verified); n3→n4(Standard Issue), n3→n6(Quick Fix Needed), n3→n7(Critical/Billing); n4→n5(Knowledge Check Complete); n5→n8(Article Found), n5→n7(Escalation Required); n6→n8(SMS Sent)
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
  {
    // Matches: customer care, support, helpdesk, help desk, customer service,
    //          tech support, technical support, contact centre, call centre
    keywords:
      /\b(customer[\s-]?care|customer[\s-]?support|customer[\s-]?service|support[\s-]?desk|helpdesk|help[\s-]?desk|tech[\s-]?support|technical[\s-]?support|contact[\s-]?cent(re|er)|call[\s-]?cent(re|er)|support[\s-]?team|support[\s-]?line)\b/i,
    recipe: {
      name: "CUSTOMER_CARE",
      injection: CUSTOMER_CARE_INJECTION,
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
