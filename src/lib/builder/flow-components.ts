/**
 * Drop-in mini-graphs for the builder Components tab.
 *
 * Each component is a small connected slice. Dropping one clones it onto the
 * canvas with fresh ids via `cloneGraphSlice` — same path as copy/paste.
 */
import { defaultNodeData } from "./node-registry";
import type { GraphSlice } from "./graph-ops";
import type { FlowComponentIcon, FlowNode, FlowNodeData, NodeKind, SavedFlowComponent } from "./types";

export interface FlowComponentDef {
  id: string;
  label: string;
  description: string;
  channel: "voice" | "whatsapp" | "both";
  icon: FlowComponentIcon;
  builtin?: boolean;
}

type TemplateNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  data: Partial<FlowNodeData>;
};

type TemplateEdge = { id: string; source: string; target: string; sourceHandle?: string };

const BOOKING_DIALOGUE = [
  "## Goal",
  "Help the caller schedule, reschedule, or cancel an appointment using the booking tools available to you.",
  "",
  "## When to engage",
  "- The caller asks to book, schedule, reserve, or set up an appointment / call / meeting.",
  "- The caller asks about available times, openings, or your calendar.",
  "- The caller asks to reschedule or cancel an existing appointment.",
  "",
  "## Required fields you MUST collect before calling book_appointment",
  '1. `name` — full name (first + last). Ask: "Can I grab your full name?"',
  '2. `email` — a valid email address. Ask: "What email should I send the confirmation to?" Spell it back letter-by-letter to confirm (e.g. "j-o-h-n at gmail dot com"). Do NOT proceed if unsure — re-ask until confirmed. Never invent or guess an email.',
  '3. `phone` — REQUIRED. Ask: "And what\'s the best phone number for you?" even if the caller is already calling from a known number — confirm it explicitly.',
  "4. `start` — the ISO 8601 start time of the slot the caller picked (from check_availability).",
  '5. `timezone` — IANA timezone. Infer from the caller\'s area code (e.g. 212/917 → America/New_York, 310/424 → America/Los_Angeles, 312 → America/Chicago, 44 prefix → Europe/London) and say it aloud to confirm (e.g. "I\'ll book that in Eastern Time — is that right?"). Ask if you cannot determine it.',
  "",
  "## How to handle it",
  "1. Greet and ask what they'd like to book.",
  "2. Collect name, email (spelled back to confirm), and phone number.",
  "3. Determine timezone from area code, state it aloud, and confirm with the caller.",
  "4. Ask for preferred day and rough time window.",
  "5. Call `check_availability` with the requested date range to fetch open slots.",
  '6. Read 2–3 nearby options back in natural language (e.g. "Tuesday at 2pm or Wednesday at 10am").',
  "7. Once they pick a slot, call `book_appointment` with ALL of: name, email (confirmed), phone (confirmed), start (ISO from the slot), and timezone.",
  "8. Confirm the booking out loud and tell them a confirmation email and text are on the way.",
  "9. For reschedules/cancellations, ask for the booking reference or the email used, then call `reschedule_appointment` or `cancel_appointment`.",
  "",
  "## Rules",
  "- NEVER call `book_appointment` without both a confirmed email AND phone — the API will reject the booking if both are missing.",
  "- Never invent availability — always call `check_availability` first.",
  "- If a tool returns an error, apologize briefly, explain in one sentence, and offer to try a different time or take a message.",
  "- Keep responses short and conversational; do not read raw JSON back to the caller.",
].join("\n");

function n(
  id: string,
  kind: NodeKind,
  x: number,
  y: number,
  data: Partial<FlowNodeData>,
): TemplateNode {
  return { id, kind, x, y, data };
}

function toSlice(nodes: TemplateNode[], edges: TemplateEdge[]): GraphSlice {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.kind,
      position: { x: node.x, y: node.y },
      selected: true,
      data: defaultNodeData(node.kind, { ...node.data, isStart: false }),
    })) as FlowNode[],
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
    })),
  };
}

const TEMPLATES: Record<string, () => GraphSlice> = {
  booking: () =>
    toSlice(
      [
        n("ask", "conversation", 0, 0, {
          label: "Booking",
          instructionType: "prompt",
          dialogue: BOOKING_DIALOGUE,
          transitions: [{ id: "tr-done", condition: "Booking finished or caller wants something else", target: "end" }],
        }),
        n("end", "ending", 360, 0, {
          label: "End Call",
          endingPrompt: "Confirm next steps and politely end the call.",
        }),
      ],
      [{ id: "e1", source: "ask", target: "end", sourceHandle: "tr-done" }],
    ),
  contact: () =>
    toSlice(
      [
        n("ask", "conversation", 0, 0, {
          label: "Collect contact",
          instructionType: "prompt",
          dialogue:
            "Can I take your full name, the best email for a confirmation, and a phone number — one at a time?",
          transitions: [{ id: "tr-got", condition: "Caller gave name, email, or phone", target: "extract" }],
        }),
        n("extract", "extract_variable", 360, 0, {
          label: "Save contact",
          extractVariables: [
            { id: "v-name", name: "full_name", description: "Caller's full name", type: "string", required: true },
            { id: "v-email", name: "email", description: "Email address", type: "string", required: true },
            { id: "v-phone", name: "phone", description: "Phone number", type: "string", required: true },
          ],
          transitions: [{ id: "tr-next", condition: "", target: "thanks" }],
        }),
        n("thanks", "conversation", 720, 0, {
          label: "Confirm details",
          instructionType: "static_text",
          dialogue: "Thanks — I've got {{full_name}} at {{email}}.",
        }),
      ],
      [
        { id: "e1", source: "ask", target: "extract", sourceHandle: "tr-got" },
        { id: "e2", source: "extract", target: "thanks", sourceHandle: "tr-next" },
      ],
    ),
  handoff: () =>
    toSlice(
      [
        n("ask", "conversation", 0, 0, {
          label: "Offer transfer",
          instructionType: "static_text",
          dialogue: "I can put you through to a colleague — shall I transfer you now?",
          transitions: [
            { id: "tr-yes", condition: "User says yes or wants a human", target: "xfer" },
            { id: "tr-no", condition: "User says no or wants to stay", target: null },
          ],
        }),
        n("xfer", "call_transfer", 360, 0, {
          label: "Transfer to human",
          transferMode: "static",
        }),
      ],
      [{ id: "e1", source: "ask", target: "xfer", sourceHandle: "tr-yes" }],
    ),
  wait: () =>
    toSlice(
      [
        n("hold", "wait", 0, 0, {
          label: "Wait for reply",
          instructionType: "static_text",
          dialogue: "Take your time — I'm here.",
          waitMode: "user",
          waitTimeoutMs: 8000,
          transitions: [
            { id: "tr-timeout", condition: "timeout", target: "nudge" },
            { id: "tr-spoke", condition: "User answered", target: null },
          ],
        }),
        n("nudge", "conversation", 360, 0, {
          label: "Still there?",
          instructionType: "static_text",
          dialogue: "Are you still there?",
        }),
      ],
      [{ id: "e1", source: "hold", target: "nudge", sourceHandle: "tr-timeout" }],
    ),
  http: () =>
    toSlice(
      [
        n("ask", "conversation", 0, 0, {
          label: "Need a lookup",
          instructionType: "static_text",
          dialogue: "Let me look that up for you.",
          transitions: [{ id: "tr-go", condition: "", target: "api" }],
        }),
        n("api", "http_request", 360, 0, {
          label: "HTTP lookup",
          httpMethod: "GET",
          httpUrl: "https://api.example.com/lookup/{{id}}",
          httpToolName: "lookup",
          speakDuringExecution: true,
          transitions: [{ id: "tr-ok", condition: "Request succeeded", target: "say" }],
        }),
        n("say", "conversation", 720, 0, {
          label: "Read result",
          instructionType: "prompt",
          dialogue: "Tell the caller the lookup result in one short sentence. Do not read raw JSON.",
        }),
      ],
      [
        { id: "e1", source: "ask", target: "api", sourceHandle: "tr-go" },
        { id: "e2", source: "api", target: "say", sourceHandle: "tr-ok" },
      ],
    ),
  end: () =>
    toSlice(
      [
        n("bye", "ending", 0, 0, {
          label: "End Call",
          instructionType: "static_text",
          endingPrompt: "Thanks for your time. Goodbye!",
        }),
      ],
      [],
    ),
};

export const FLOW_COMPONENTS: readonly FlowComponentDef[] = [
  {
    id: "booking",
    label: "Booking",
    description: "Collect details, check availability, and book — then hang up.",
    channel: "voice",
    icon: "booking",
    builtin: true,
  },
  {
    id: "contact",
    label: "Collect contact",
    description: "Ask for name, email, and phone, then extract them.",
    channel: "both",
    icon: "contact",
  },
  {
    id: "handoff",
    label: "Human handoff",
    description: "Offer a transfer, then a call-transfer node.",
    channel: "voice",
    icon: "handoff",
  },
  {
    id: "wait",
    label: "Wait + nudge",
    description: "Wait for the caller; on timeout ask if they are still there.",
    channel: "voice",
    icon: "wait",
  },
  {
    id: "http",
    label: "HTTP lookup",
    description: "Filler line, GET request, then a short spoken result.",
    channel: "voice",
    icon: "http",
  },
  {
    id: "end",
    label: "End call",
    description: "A goodbye ending node.",
    channel: "both",
    icon: "end",
  },
];

export function flowComponentSlice(
  id: string,
  custom: SavedFlowComponent[] = [],
): GraphSlice | null {
  const builtIn = TEMPLATES[id]?.();
  if (builtIn) return builtIn;
  return custom.find((c) => c.id === id)?.slice ?? null;
}

export function componentsFor(
  channel: "voice" | "whatsapp",
  custom: SavedFlowComponent[] = [],
): FlowComponentDef[] {
  const library = FLOW_COMPONENTS.filter((c) => c.channel === "both" || c.channel === channel).map(
    (c) => ({ ...c, builtin: true as const }),
  );
  const saved = custom
    .filter((c) => c.channel === "both" || c.channel === channel)
    .map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      channel: c.channel,
      icon: c.icon,
      builtin: false,
    }));
  return [...library, ...saved];
}
