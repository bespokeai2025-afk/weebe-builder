/**
 * Marketing demo fixtures.
 *
 * ISOLATION CONTRACT — read before editing:
 *   - Nothing here may import from @/lib/builder, @/components/builder,
 *     @/integrations, @tanstack/react-query or @tanstack/react-start.
 *   - Shapes are duplicated locally ON PURPOSE. A type import from
 *     @/lib/builder/types is a module-graph edge, and FlowNodes.tsx reaches
 *     the service-role Supabase client in two hops. Because both Supabase
 *     clients are lazy Proxies, such a leak throws nothing and logs nothing —
 *     it only shows up in the bundle. Keep the boundary hard.
 *   - The simulation is deterministic and offline. It must never create an
 *     agent, call Retell/Twilio, book a calendar, touch a CRM, or hit an LLM.
 *
 * The vocabulary deliberately mirrors the real workflow-engine STEP_LIBRARY
 * shape ({ type, label, icon, ... }) so the demo reads as a subset of the
 * actual product rather than a separate invention.
 */

import {
  Flag,
  MessageCircle,
  Split,
  FunctionSquare,
  Globe,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";

/* ── Node vocabulary ─────────────────────────────────────────────────────── */

export type StoryNodeKind =
  | "incoming_call"
  | "ai_agent"
  | "qualify_lead"
  | "book_appointment"
  | "update_crm"
  | "send_sms";

export interface StoryNodeDef {
  kind: StoryNodeKind;
  label: string;
  /** One line, shown in the inspector. Never hidden behind a hover. */
  summary: string;
  icon: LucideIcon;
  /** Fixed nodes are pre-placed and cannot be removed. */
  fixed: boolean;
  /** Which ledger actions this node is responsible for. */
  emits: ActionKey[];
  /** The real Builder node type this maps to, shown in the card header so the
   *  demo reads as the actual product (Begin, Conversation, Logic Split…). */
  nodeType: string;
  /** Icon colour from the real Builder palette. */
  typeColor: string;
  /** Short body line on the node card, like a node prompt preview. */
  blurb: string;
}

export const NODE_DEFS: Record<StoryNodeKind, StoryNodeDef> = {
  incoming_call: {
    kind: "incoming_call",
    label: "Incoming Call",
    summary: "Every call to your business number starts the workflow — 24/7, no voicemail.",
    icon: Flag,
    fixed: true,
    emits: [],
    nodeType: "Begin",
    typeColor: "#c084fc",
    blurb: "Inbound call to your business number",
  },
  ai_agent: {
    kind: "ai_agent",
    label: "AI Agent",
    summary: "Answers in a natural voice, understands intent, and decides what to do next.",
    icon: MessageCircle,
    fixed: true,
    emits: ["intent_detected"],
    nodeType: "Conversation",
    typeColor: "#60a5fa",
    blurb: "Greet the caller and work out what they need",
  },
  qualify_lead: {
    kind: "qualify_lead",
    label: "Qualify Lead",
    summary: "Asks your qualifying questions and scores the caller before anyone's time is spent.",
    icon: Split,
    fixed: false,
    emits: ["lead_qualified"],
    nodeType: "Logic Split",
    typeColor: "#f472b6",
    blurb: "New patient? Treatment? Ready to book?",
  },
  book_appointment: {
    kind: "book_appointment",
    label: "Book Appointment",
    summary: "Checks live calendar availability and books the slot while the caller is still on the line.",
    icon: FunctionSquare,
    fixed: false,
    emits: ["calendar_checked", "appointment_booked"],
    nodeType: "Function",
    typeColor: "#a78bfa",
    blurb: "check_availability() · book_slot()",
  },
  update_crm: {
    kind: "update_crm",
    label: "Update CRM",
    summary: "Writes the contact, transcript and outcome straight into your CRM. No re-typing.",
    icon: Globe,
    fixed: false,
    emits: ["crm_updated"],
    nodeType: "HTTP Request",
    typeColor: "#60a5fa",
    blurb: "POST contact + transcript to CRM",
  },
  send_sms: {
    kind: "send_sms",
    label: "Send SMS",
    summary: "Texts a confirmation and a calendar link the moment the call ends.",
    icon: MessageSquareText,
    fixed: false,
    emits: ["sms_sent"],
    nodeType: "In-Call SMS",
    typeColor: "#fb923c",
    blurb: "Text the booking confirmation",
  },
};

/** What the visitor may drop into the two open slots. */
export const PALETTE: StoryNodeKind[] = [
  "qualify_lead",
  "book_appointment",
  "update_crm",
  "send_sms",
];

/* ── The scripted call ───────────────────────────────────────────────────── */

export type ActionKey =
  | "intent_detected"
  | "lead_qualified"
  | "calendar_checked"
  | "appointment_booked"
  | "crm_updated"
  | "sms_sent";

export const ACTION_LABEL: Record<ActionKey, string> = {
  intent_detected: "Intent detected — booking request",
  lead_qualified: "Lead qualified — high intent",
  calendar_checked: "Calendar checked — 3 slots free",
  appointment_booked: "Appointment booked — Thu 2:30pm",
  crm_updated: "CRM updated — contact + transcript",
  sms_sent: "SMS sent — confirmation + link",
};

export type ScriptStep =
  | {
      at: number;
      kind: "turn";
      role: "agent" | "caller";
      text: string;
      /** Omit the line entirely if this node was never placed, so the agent
       *  never offers to book when the visitor didn't give it a calendar. */
      requires?: StoryNodeKind;
    }
  | { at: number; kind: "signal"; node: StoryNodeKind }
  | { at: number; kind: "action"; action: ActionKey }
  | { at: number; kind: "end" };

/**
 * `at` is ABSOLUTE milliseconds from start, not a relative delay. Three things
 * fall out of that for free:
 *   - the runner is one timer chain, so cancelling is one clearTimeout and
 *     there are no orphaned timers if the component unmounts mid-call;
 *   - "Skip to results" is just applyUpTo(Infinity);
 *   - reduced motion is applyUpTo(Infinity) too — those users get the same
 *     data model evaluated at t = end, not a lesser fallback.
 */
export const CALL_SCRIPT: readonly ScriptStep[] = [
  { at: 300, kind: "signal", node: "incoming_call" },
  { at: 700, kind: "turn", role: "agent", text: "Good afternoon, Harborview Dental — this is Ava. How can I help?" },
  { at: 2600, kind: "signal", node: "ai_agent" },
  { at: 2900, kind: "turn", role: "caller", text: "Hi — I'd like to book a consultation." },
  { at: 4300, kind: "action", action: "intent_detected" },
  { at: 4900, kind: "turn", role: "agent", text: "Of course. Have you visited us before?", requires: "qualify_lead" },
  { at: 6300, kind: "turn", role: "caller", text: "No, first time. I'm looking at implants.", requires: "qualify_lead" },
  { at: 7600, kind: "signal", node: "qualify_lead" },
  { at: 8100, kind: "action", action: "lead_qualified" },
  { at: 8700, kind: "turn", role: "agent", text: "Perfect. I have Thursday at 2:30, or Friday morning.", requires: "book_appointment" },
  { at: 10300, kind: "signal", node: "book_appointment" },
  { at: 10600, kind: "action", action: "calendar_checked" },
  { at: 11100, kind: "turn", role: "caller", text: "Thursday at 2:30 works.", requires: "book_appointment" },
  { at: 12300, kind: "action", action: "appointment_booked" },
  { at: 12800, kind: "turn", role: "agent", text: "Booked. I've texted you the details — see you Thursday.", requires: "book_appointment" },
  { at: 14200, kind: "signal", node: "update_crm" },
  { at: 14500, kind: "action", action: "crm_updated" },
  { at: 15000, kind: "signal", node: "send_sms" },
  { at: 15200, kind: "action", action: "sms_sent" },
  { at: 16200, kind: "end" },
];

export const CALL_DURATION_MS = 16200;

/* ── Outcomes ────────────────────────────────────────────────────────────── */

export interface OutcomeDef {
  key: string;
  /** A string, so there is no fake precision and no counter-up lie. */
  value: string;
  label: string;
  caption: string;
  /** Which ledger rows this card is assembled from. */
  fromActions: ActionKey[];
}

// These describe the DEMO call above, not measured customer results. The
// real call data (Supabase `calls`, checked 2026-10-10) is too early and
// includes test traffic, so no customer-wide figures are claimed here until
// there's a month of real usage to quote.
export const OUTCOMES: OutcomeDef[] = [
  {
    key: "answered",
    value: "1st ring",
    label: "Answered straight away",
    caption: "Ava picked up on the first ring. No hold music, no voicemail.",
    fromActions: ["intent_detected"],
  },
  {
    key: "booked",
    value: "Under 1 min",
    label: "Call to booked",
    caption: "Qualified and booked in for Thursday at 2:30 before the caller hung up.",
    fromActions: ["lead_qualified", "calendar_checked", "appointment_booked"],
  },
  {
    key: "admin",
    value: "No admin",
    label: "Nothing left to do",
    caption: "Add the CRM and SMS steps and the agent logs the call and texts the confirmation itself.",
    fromActions: ["crm_updated", "sms_sent"],
  },
];

/* ── Marketing content ───────────────────────────────────────────────────── */

export const USE_CASES = [
  {
    title: "Dental & healthcare",
    body: "Fill the diary from after-hours calls and cut no-shows with automatic reminders.",
  },
  {
    title: "Property",
    body: "Qualify buyers and book viewings the moment an enquiry lands, day or night.",
  },
  {
    title: "Automotive",
    body: "Book test drives and service slots without pulling anyone off the floor.",
  },
  {
    title: "Trades & home services",
    body: "Capture the job while you're up a ladder. Every missed call is a lost quote.",
  },
];

export const TRUST_POINTS = [
  "Your own number, your own voice, your own script",
  "Live calendar and CRM integration",
  "Full transcripts and recordings on every call",
  "UK data residency, GDPR-ready, SOC 2 controls",
];
