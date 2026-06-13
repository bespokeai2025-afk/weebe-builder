import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Edge, Node, OnNodesChange, OnEdgesChange, Connection } from "@xyflow/react";
import { addEdge, applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import type { BuilderSettings, BuilderVariable, FlowNodeData, NodeKind } from "./types";
import { autoLayoutNodes } from "./auto-layout";

export type FlowNode = Node<FlowNodeData>;

interface State {
  nodes: FlowNode[];
  edges: Edge[];
  settings: BuilderSettings;
  variables: BuilderVariable[];
  testCallTotalSec: number;
  selectedNodeId: string | null;
  activeNodeId: string | null;
  /** When true, NodeEditorDialog auto-opens the Add Variable form on mount. */
  pendingAddVariable: boolean;
  /** Row id of the currently-loaded saved agent (null = unsaved new flow). */
  currentAgentRowId: string | null;
  /** Bumped whenever the whole graph is replaced (import/clear) so the canvas can re-fit. */
  flowVersion: number;
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: (c: Connection) => void;
  addNode: (kind: NodeKind, position?: { x: number; y: number }) => void;
  addBookingNode: (position?: { x: number; y: number }) => void;
  updateNode: (id: string, data: Partial<FlowNodeData>) => void;
  deleteNode: (id: string) => void;
  deleteEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  selectNodeAddVar: (id: string) => void;
  setActiveNode: (id: string | null) => void;
  setStartNode: (id: string) => void;
  clearAll: () => void;
  autoLayout: () => void;
  revertLayout: () => void;
  preAutoLayoutPositions: Record<string, { x: number; y: number }> | null;
  setSettings: (s: Partial<BuilderSettings>) => void;
  setVariables: (v: BuilderVariable[]) => void;
  addTestCallSeconds: (seconds: number) => void;
  resetTestCallCost: () => void;
  loadFlow: (data: {
    nodes: FlowNode[];
    edges: Edge[];
    settings?: Partial<BuilderSettings>;
    variables?: BuilderVariable[];
    agentRowId?: string | null;
  }) => void;
  setCurrentAgentRowId: (id: string | null) => void;
  /** Bumped on every successful agent save so the Builder can dismiss the undo toast. */
  saveVersion: number;
  bumpSaveVersion: () => void;
}

const defaultSettings: BuilderSettings = {
  agentName: "Conversation Flow Agent",
  companyName: "",
  globalPrompt:
    "You should be polite and humble to the user. Stay on script, keep responses concise.",
  beginMessage: "",
  model: "gpt-4.1",
  voiceId: "11labs-Adrian",
  language: "en-US",
  speechLanguages: ["en-US"],
  temperature: 0.3,
  webhookUrl: "",
  transitionFlexibility: "flex",
  startSpeaker: "agent",
  beginAfterUserSilenceMs: 0,
  handbookEchoVerification: false,
  handbookSpeechNormalization: true,
  handbookDefaultPersonality: true,
  handbookScopeBoundaries: true,
  handbookNaturalFillerWords: false,
  handbookNatoPhoneticAlphabet: false,
  handbookHighEmpathy: false,
  handbookAiDisclosure: true,
  handbookSmartMatching: true,
  voiceSpeed: 1,
  voiceTemperature: 1,
  volume: 1,
  responsiveness: 1,
  voiceEmotion: "none",
  interruptionSensitivity: 0.7,
  enableBackchannel: false,
  backchannelFrequency: 0.8,
  backchannelWords: [],
  reminderTriggerMs: 10000,
  reminderMaxCount: 1,
  ambientSound: "none",
  ambientSoundVolume: 1,
  boostedKeywords: [],
  pronunciationDictionary: [],
  endCallAfterSilenceMs: 600000,
  beginMessageDelayMs: 0,
  booking: { enabled: true, instructions: "", eventTypeId: "" },
  sttMode: "fast",
  vocabSpecialization: "general",
  allowUserDtmf: false,
  allowDtmfInterruption: false,
  denoisingMode: "noise-and-background-speech-cancellation",
  maxCallDurationMs: 1800000,
  ringDurationMs: 30000,
  enableDynamicVoiceSpeed: false,
  enableDynamicResponsiveness: false,
  normalizeForSpeech: true,
  voiceProvider: "RETELL",
  openaiVoice: "alloy",
  openaiReasoningEffort: "low",
  channelType: "voice",
};

const NODE_LABELS: Record<NodeKind, string> = {
  conversation: "Conversation",
  function: "Function",
  call_transfer: "Call Transfer",
  press_digit: "Press Digit",
  logic_split: "Logic Split",
  agent_transfer: "Agent Transfer",
  sms: "In-Call SMS",
  extract_variable: "Extract Variable",
  code: "Code",
  ending: "Ending",
  note: "Note",
  wa_message: "WA Message",
  wa_delay: "WA Delay",
  wa_media: "WA Media",
};

const makeNode = (
  kind: NodeKind,
  id: string,
  x: number,
  y: number,
  overrides: Partial<FlowNodeData> = {},
): FlowNode => ({
  id,
  type: kind,
  position: { x, y },
  data: {
    kind,
    label: NODE_LABELS[kind],
    dialogue: "",
    transitions: [],
    ...overrides,
  },
});

const initialNodes: FlowNode[] = [
  makeNode("conversation", "start-node", 200, 200, {
    label: "Welcome Node",
    isStart: true,
    startSpeaker: "agent",
    instructionType: "static_text",
    dialogue: "Hello, this is customer support. How can I help you today?",
  }),
  makeNode("ending", "end-node", 700, 200, {
    label: "End Call",
    endingPrompt: "Politely end the call",
  }),
];

const initialEdges: Edge[] = [];

let idSeq = 100;
const nextId = (prefix: string) => `${prefix}-${++idSeq}-${Date.now().toString(36)}`;

export const useBuilderStore = create<State>()(
  persist(
    (set, get) => ({
      nodes: initialNodes,
      edges: initialEdges,
      settings: defaultSettings,
      variables: [],
      testCallTotalSec: 0,
      selectedNodeId: null,
      activeNodeId: null,
      pendingAddVariable: false,
      currentAgentRowId: null,
      flowVersion: 0,
      saveVersion: 0,
      onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
      onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
      onConnect: (c) => {
        const edgeId = `edge-${Date.now().toString(36)}`;
        set({
          edges: addEdge({ ...c, animated: false, id: edgeId }, get().edges),
        });
        // If the connection originates from a transition handle, link it.
        if (c.sourceHandle && c.source && c.target) {
          set({
            nodes: get().nodes.map((n) =>
              n.id === c.source
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      transitions: n.data.transitions.map((t) =>
                        t.id === c.sourceHandle ? { ...t, target: c.target! } : t,
                      ),
                    },
                  }
                : n,
            ),
          });
        }
      },
      addNode: (kind, position) => {
        const id = nextId(kind);
        const pos = position ?? {
          x: 320 + Math.random() * 240,
          y: 120 + get().nodes.length * 40,
        };
        const node = makeNode(kind, id, pos.x, pos.y, {
          ...(kind === "function" ? { speakDuringExecution: false, waitForResult: true } : {}),
          ...(kind === "ending" ? { endingPrompt: "Politely end the call" } : {}),
          ...(kind === "conversation" ? { instructionType: "prompt" } : {}),
        });
        set({ nodes: [...get().nodes, node] });
      },
      addBookingNode: (position) => {
        const id = nextId("conversation");
        const pos = position ?? {
          x: 320 + Math.random() * 240,
          y: 120 + get().nodes.length * 40,
        };
        const node = makeNode("conversation", id, pos.x, pos.y, {
          label: "Booking",
          instructionType: "prompt",
          dialogue: [
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
          ].join("\n"),
        });
        set({ nodes: [...get().nodes, node], selectedNodeId: id });
      },
      updateNode: (id, data) =>
        set({
          nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
        }),
      deleteNode: (id) =>
        set({
          nodes: get().nodes.filter((n) => n.id !== id),
          edges: get().edges.filter((e) => e.source !== id && e.target !== id),
          selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
        }),
      deleteEdge: (id) => set({ edges: get().edges.filter((e) => e.id !== id) }),
      selectNode: (id) => set({ selectedNodeId: id, pendingAddVariable: false }),
      selectNodeAddVar: (id) => set({ selectedNodeId: id, pendingAddVariable: true }),
      setActiveNode: (id) => set({ activeNodeId: id }),
      setStartNode: (id) =>
        set({
          nodes: get().nodes.map((n) => ({
            ...n,
            data: { ...n.data, isStart: n.id === id },
          })),
        }),
      clearAll: () =>
        set({
          nodes: [
            makeNode("conversation", "start-node", 200, 200, {
              label: "Start Call",
              isStart: true,
              startSpeaker: "agent",
              instructionType: "static_text",
              dialogue: "",
            }),
            makeNode("ending", "end-node", 700, 200, {
              label: "End Call",
              endingPrompt: "",
            }),
          ],
          edges: [],
          // Fully reset settings (speech, pronunciation, boosted keywords,
          // backchannel words, saved Retell agent/flow IDs, etc.) and variables
          // so a "new" flow starts truly blank.
          settings: { ...defaultSettings },
          variables: [],
          currentAgentRowId: null,
          // Preserve testCallTotalSec across clears — cost history is cumulative.

          selectedNodeId: null,
          activeNodeId: null,
          flowVersion: get().flowVersion + 1,
        }),
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      setVariables: (v) => set({ variables: v }),
      addTestCallSeconds: (seconds) =>
        set({ testCallTotalSec: get().testCallTotalSec + Math.max(0, seconds) }),
      resetTestCallCost: () => set({ testCallTotalSec: 0 }),
      loadFlow: (data) =>
        set({
          nodes: data.nodes,
          edges: data.edges,
          settings: data.settings ? { ...get().settings, ...data.settings } : get().settings,
          variables: data.variables ?? get().variables,
          currentAgentRowId:
            data.agentRowId === undefined ? get().currentAgentRowId : data.agentRowId,
          selectedNodeId: null,
          flowVersion: get().flowVersion + 1,
        }),
      setCurrentAgentRowId: (id) => set({ currentAgentRowId: id }),
      bumpSaveVersion: () => set({ saveVersion: get().saveVersion + 1 }),
      preAutoLayoutPositions: null,
      autoLayout: () => {
        const snapshot: Record<string, { x: number; y: number }> = {};
        for (const n of get().nodes) snapshot[n.id] = { x: n.position.x, y: n.position.y };
        set({
          preAutoLayoutPositions: snapshot,
          nodes: autoLayoutNodes(get().nodes, get().edges),
        });
      },
      revertLayout: () => {
        const snap = get().preAutoLayoutPositions;
        if (!snap) return;
        set({
          nodes: get().nodes.map((n) => (snap[n.id] ? { ...n, position: { ...snap[n.id] } } : n)),
          preAutoLayoutPositions: null,
        });
      },
    }),
    {
      name: "script-flow-builder-v2",
      partialize: (s) => ({
        nodes: s.nodes,
        edges: s.edges,
        settings: s.settings,
        variables: s.variables,
        testCallTotalSec: s.testCallTotalSec,
        currentAgentRowId: s.currentAgentRowId,
      }),
    },
  ),
);
