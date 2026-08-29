import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Edge, OnNodesChange, OnEdgesChange, Connection } from "@xyflow/react";
import { addEdge, applyEdgeChanges, applyNodeChanges, reconnectEdge } from "@xyflow/react";
import type {
  BuilderDebugEvent,
  BuilderSettings,
  BuilderVariable,
  FlowNode,
  FlowNodeData,
  NodeKind,
  SavedFlowComponent,
} from "./types";
import { autoLayoutNodes } from "./auto-layout";
import { defaultNodeData } from "./node-registry";
import { cloneGraphSlice, selectedGraphSlice, type GraphSlice } from "./graph-ops";
import { flowComponentSlice } from "./flow-components";
import { appendFlowVersion, makePublishedSnapshot, nextVersionNumber } from "./flow-history";
import { validateComponentSlice } from "./validate";

export type { FlowNode };

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
  /** True when canvas/settings/variables differ from the last successful save. */
  isDirty: boolean;
  /** Incremented on every dirty edit so autosave can debounce on content, not just the flag. */
  editRevision: number;
  canUndo: boolean;
  canRedo: boolean;
  onNodesChange: OnNodesChange<FlowNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: (c: Connection) => void;
  onReconnect: (oldEdge: Edge, c: Connection) => void;
  addNode: (kind: NodeKind, position?: { x: number; y: number }) => void;
  addBookingNode: (position?: { x: number; y: number }) => void;
  addComponent: (id: string, position?: { x: number; y: number }) => void;
  addComponentSlice: (slice: GraphSlice, position?: { x: number; y: number }) => void;
  saveSelectionAsComponent: (label: string, description?: string) => { ok: true; id: string } | { ok: false; error: string };
  updateCustomComponent: (id: string, patch: Partial<Pick<SavedFlowComponent, "label" | "description">>) => void;
  deleteCustomComponent: (id: string) => void;
  duplicateCustomComponent: (id: string) => string | null;
  enterComponentEditor: (id: string) => boolean;
  exitComponentEditor: (save: boolean) => void;
  editingComponentId: string | null;
  recordFlowVersion: (label: string) => number | null;
  publishFlow: () => number;
  restoreFlowVersion: (version: number) => boolean;
  unpublishFlow: () => void;
  debugEvents: BuilderDebugEvent[];
  debugOpen: boolean;
  setDebugOpen: (open: boolean) => void;
  pushDebugEvent: (event: Omit<BuilderDebugEvent, "id" | "ts"> & { ts?: number }) => void;
  clearDebugEvents: () => void;
  updateNode: (id: string, data: Partial<FlowNodeData>) => void;
  deleteNode: (id: string) => void;
  deleteEdge: (id: string) => void;
  deleteSelection: () => void;
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
    /** Drop the previous agent's prompt, snapshot, and extras. Required on JSON/PDF import. */
    replaceSettings?: boolean;
  }) => void;
  setCurrentAgentRowId: (id: string | null) => void;
  /** Bumped on every successful agent save so the Builder can dismiss the undo toast. */
  saveVersion: number;
  bumpSaveVersion: () => void;
  undo: () => void;
  redo: () => void;
  copySelection: () => boolean;
  pasteClipboard: () => boolean;
  duplicateSelection: () => boolean;
}

const defaultSettings: BuilderSettings = {
  agentName: "Conversation Flow Agent",
  companyName: "",
  globalPrompt:
    "You should be polite and humble. Stay on this node's task only. Keep responses concise.",
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
  webeeSttProvider: "fish",
  webeeLlmProvider: "openai",
  webeeSpeechModel: "gpt-4o-mini",
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
  data: defaultNodeData(kind, overrides),
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
    instructionType: "prompt",
    endingPrompt: "Politely end the call",
  }),
];

const initialEdges: Edge[] = [];

let idSeq = 100;
const nextId = (prefix: string) => `${prefix}-${++idSeq}-${Date.now().toString(36)}`;

const HISTORY_MAX = 50;
let past: GraphSlice[] = [];
let future: GraphSlice[] = [];
let clipboard: GraphSlice | null = null;
let componentBackup: GraphSlice | null = null;
let dragHistoryPushed = false;

function cloneSlice(nodes: FlowNode[], edges: Edge[]): GraphSlice {
  return structuredClone({ nodes, edges });
}

function pushHistory(nodes: FlowNode[], edges: Edge[]) {
  past.push(cloneSlice(nodes, edges));
  if (past.length > HISTORY_MAX) past.shift();
  future = [];
}

function resetHistory() {
  past = [];
  future = [];
  dragHistoryPushed = false;
}

function dirtyFields(editRevision: number): Pick<State, "isDirty" | "editRevision" | "canUndo" | "canRedo"> {
  return {
    isDirty: true,
    editRevision: editRevision + 1,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

function pruneTransitionTargets(nodes: FlowNode[], liveIds: Set<string>): FlowNode[] {
  return nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      transitions: (n.data.transitions ?? []).map((t) =>
        t.target && !liveIds.has(t.target) ? { ...t, target: null } : t,
      ),
    },
  }));
}

function edgeLabelForConnection(nodes: FlowNode[], c: Connection): string | undefined {
  if (!c.source || !c.sourceHandle) return undefined;
  const source = nodes.find((n) => n.id === c.source);
  const transition = source?.data.transitions?.find((t) => t.id === c.sourceHandle);
  const text = transition?.condition?.trim();
  if (text) return text;
  if (source?.data.kind === "logic_split" && !text) return "else";
  return undefined;
}

function deselectAll<T extends { selected?: boolean }>(items: T[]): T[] {
  return items.map((item) => (item.selected ? { ...item, selected: false } : item));
}

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
      isDirty: false,
      editRevision: 0,
      canUndo: false,
      canRedo: false,
      onNodesChange: (changes) => {
        const selectOnly = changes.every((c) => c.type === "select");
        const dragStart = changes.some((c) => c.type === "position" && c.dragging === true);
        const dragEnd = changes.some((c) => c.type === "position" && c.dragging === false);
        const structural = changes.some((c) => c.type === "remove" || c.type === "add");
        const positionCommit =
          changes.some((c) => c.type === "position" && c.dragging === false) ||
          changes.some((c) => c.type === "position" && c.dragging === undefined);

        if (!selectOnly) {
          if (dragStart && !dragHistoryPushed) {
            pushHistory(get().nodes, get().edges);
            dragHistoryPushed = true;
          } else if ((structural || positionCommit) && !dragHistoryPushed) {
            pushHistory(get().nodes, get().edges);
          }
        }
        if (dragEnd) dragHistoryPushed = false;

        let nodes = applyNodeChanges(changes, get().nodes);
        let edges = get().edges;
        if (structural) {
          const live = new Set(nodes.map((n) => n.id));
          edges = edges.filter((e) => live.has(e.source) && live.has(e.target));
          nodes = pruneTransitionTargets(nodes, live);
        }
        set({
          nodes,
          edges,
          ...(selectOnly ? {} : dirtyFields(get().editRevision)),
        });
      },
      onEdgesChange: (changes) => {
        const selectOnly = changes.every((c) => c.type === "select");
        if (!selectOnly) pushHistory(get().nodes, get().edges);
        set({
          edges: applyEdgeChanges(changes, get().edges),
          ...(selectOnly ? {} : dirtyFields(get().editRevision)),
        });
      },
      onConnect: (c) => {
        pushHistory(get().nodes, get().edges);
        const edgeId = `edge-${Date.now().toString(36)}`;
        const label = edgeLabelForConnection(get().nodes, c);
        set({
          edges: addEdge(
            { ...c, type: "step", animated: false, id: edgeId, label },
            get().edges,
          ),
          ...dirtyFields(get().editRevision),
        });
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
      onReconnect: (oldEdge, c) => {
        pushHistory(get().nodes, get().edges);
        const label = edgeLabelForConnection(get().nodes, c) ?? oldEdge.label;
        set({
          edges: reconnectEdge(oldEdge, c, get().edges).map((e) =>
            e.id === oldEdge.id ? { ...e, label } : e,
          ),
          ...dirtyFields(get().editRevision),
        });
        if (oldEdge.sourceHandle && oldEdge.source) {
          set({
            nodes: get().nodes.map((n) => {
              if (n.id !== oldEdge.source && n.id !== c.source) return n;
              return {
                ...n,
                data: {
                  ...n.data,
                  transitions: n.data.transitions.map((t) => {
                    if (n.id === oldEdge.source && t.id === oldEdge.sourceHandle) {
                      return { ...t, target: t.target === oldEdge.target ? null : t.target };
                    }
                    if (n.id === c.source && t.id === c.sourceHandle && c.target) {
                      return { ...t, target: c.target };
                    }
                    return t;
                  }),
                },
              };
            }),
          });
        }
      },
      addNode: (kind, position) => {
        pushHistory(get().nodes, get().edges);
        const id = nextId(kind);
        const pos = position ?? {
          x: 320 + Math.random() * 240,
          y: 120 + get().nodes.length * 40,
        };
        const node = makeNode(kind, id, pos.x, pos.y);
        let nodes = [...deselectAll(get().nodes), { ...node, selected: true }];
        if (kind === "begin") {
          nodes = nodes.map((n) => ({
            ...n,
            data: { ...n.data, isStart: n.id === id },
          }));
        }
        set({
          nodes,
          selectedNodeId: id,
          ...dirtyFields(get().editRevision),
        });
      },
      addBookingNode: (position) => {
        get().addComponent("booking", position);
      },
      addComponentSlice: (slice, position) => {
        if (!slice.nodes.length) return;
        pushHistory(get().nodes, get().edges);
        const origin = position ?? {
          x: 320 + Math.random() * 80,
          y: 120 + get().nodes.length * 24,
        };
        const cloned = cloneGraphSlice(slice, nextId, origin);
        set({
          nodes: [...deselectAll(get().nodes), ...cloned.nodes],
          edges: [...get().edges, ...cloned.edges],
          selectedNodeId: cloned.nodes[0]?.id ?? get().selectedNodeId,
          ...dirtyFields(get().editRevision),
        });
      },
      addComponent: (id, position) => {
        const slice = flowComponentSlice(id, get().settings.customComponents ?? []);
        if (!slice) return;
        get().addComponentSlice(slice, position);
      },
      saveSelectionAsComponent: (label, description = "") => {
        const slice = selectedGraphSlice(get().nodes, get().edges);
        const fallbackId = get().selectedNodeId;
        const source =
          slice.nodes.length > 0
            ? slice
            : fallbackId
              ? { nodes: get().nodes.filter((n) => n.id === fallbackId), edges: [] }
              : { nodes: [], edges: [] };
        if (source.nodes.length === 0) return { ok: false, error: "Select one or more nodes first." };
        const issues = validateComponentSlice(source);
        if (issues.some((i) => i.level === "error")) {
          return { ok: false, error: issues.find((i) => i.level === "error")!.message };
        }
        const id = nextId("comp");
        const channel = get().settings.channelType === "whatsapp" ? "whatsapp" : "voice";
        const entry: SavedFlowComponent = {
          id,
          label: label.trim() || "Untitled component",
          description: description.trim(),
          channel,
          icon: "custom",
          slice: structuredClone(source),
          createdAt: new Date().toISOString(),
        };
        set({
          settings: {
            ...get().settings,
            customComponents: [...(get().settings.customComponents ?? []), entry],
          },
          ...dirtyFields(get().editRevision),
        });
        return { ok: true, id };
      },
      updateCustomComponent: (id, patch) => {
        const list = get().settings.customComponents ?? [];
        set({
          settings: {
            ...get().settings,
            customComponents: list.map((c) =>
              c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
            ),
          },
          ...dirtyFields(get().editRevision),
        });
      },
      deleteCustomComponent: (id) => {
        set({
          settings: {
            ...get().settings,
            customComponents: (get().settings.customComponents ?? []).filter((c) => c.id !== id),
          },
          ...dirtyFields(get().editRevision),
        });
      },
      duplicateCustomComponent: (id) => {
        const src = (get().settings.customComponents ?? []).find((c) => c.id === id);
        if (!src) return null;
        const copyId = nextId("comp");
        const copy: SavedFlowComponent = {
          ...structuredClone(src),
          id: copyId,
          label: `${src.label} copy`,
          createdAt: new Date().toISOString(),
        };
        set({
          settings: {
            ...get().settings,
            customComponents: [...(get().settings.customComponents ?? []), copy],
          },
          ...dirtyFields(get().editRevision),
        });
        return copyId;
      },
      editingComponentId: null,
      enterComponentEditor: (id) => {
        const src = (get().settings.customComponents ?? []).find((c) => c.id === id);
        if (!src) return false;
        componentBackup = cloneSlice(get().nodes, get().edges);
        resetHistory();
        set({
          editingComponentId: id,
          nodes: structuredClone(src.slice.nodes),
          edges: structuredClone(src.slice.edges),
          selectedNodeId: src.slice.nodes[0]?.id ?? null,
          flowVersion: get().flowVersion + 1,
          canUndo: false,
          canRedo: false,
        });
        return true;
      },
      exitComponentEditor: (save) => {
        const id = get().editingComponentId;
        if (!id || !componentBackup) {
          set({ editingComponentId: null });
          return;
        }
        if (save) {
          const list = get().settings.customComponents ?? [];
          set({
            settings: {
              ...get().settings,
              customComponents: list.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      slice: cloneSlice(get().nodes, get().edges),
                      updatedAt: new Date().toISOString(),
                    }
                  : c,
              ),
            },
          });
        }
        resetHistory();
        set({
          editingComponentId: null,
          nodes: componentBackup.nodes,
          edges: componentBackup.edges,
          selectedNodeId: null,
          flowVersion: get().flowVersion + 1,
          canUndo: false,
          canRedo: false,
          ...dirtyFields(get().editRevision),
        });
        componentBackup = null;
      },
      recordFlowVersion: (label) => {
        const version = nextVersionNumber(get().settings.flowHistory);
        const history = appendFlowVersion(get().settings, {
          label,
          flowData: cloneSlice(get().nodes, get().edges),
          variables: structuredClone(get().variables),
        });
        if (history === get().settings.flowHistory) return null;
        set({ settings: { ...get().settings, flowHistory: history } });
        return history[history.length - 1]?.version ?? version;
      },
      publishFlow: () => {
        const version = get().recordFlowVersion("Published") ?? nextVersionNumber(get().settings.flowHistory);
        const published = makePublishedSnapshot(
          version,
          get().nodes,
          get().edges,
          get().variables,
        );
        set({
          settings: { ...get().settings, publishedSnapshot: published },
          ...dirtyFields(get().editRevision),
        });
        return version;
      },
      restoreFlowVersion: (version) => {
        const snap = (get().settings.flowHistory ?? []).find((v) => v.version === version);
        if (!snap) return false;
        pushHistory(get().nodes, get().edges);
        set({
          nodes: structuredClone(snap.flowData.nodes),
          edges: structuredClone(snap.flowData.edges),
          variables: structuredClone(snap.variables),
          selectedNodeId: null,
          flowVersion: get().flowVersion + 1,
          ...dirtyFields(get().editRevision),
        });
        return true;
      },
      unpublishFlow: () => {
        set({
          settings: { ...get().settings, publishedSnapshot: null },
          ...dirtyFields(get().editRevision),
        });
      },
      debugEvents: [],
      debugOpen: false,
      setDebugOpen: (open) => set({ debugOpen: open }),
      pushDebugEvent: (event) => {
        const row: BuilderDebugEvent = {
          id: nextId("dbg"),
          ts: event.ts ?? Date.now(),
          type: event.type,
          nodeId: event.nodeId,
          message: event.message,
          detail: event.detail,
        };
        const next = [...get().debugEvents, row].slice(-200);
        set({ debugEvents: next, debugOpen: true });
      },
      clearDebugEvents: () => set({ debugEvents: [] }),
      updateNode: (id, data) => {
        pushHistory(get().nodes, get().edges);
        const nodes = get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n));
        let edges = get().edges;
        if (data.transitions) {
          edges = edges.map((e) => {
            if (e.source !== id || !e.sourceHandle) return e;
            const t = data.transitions!.find((tr) => tr.id === e.sourceHandle);
            if (!t) return e;
            const label =
              t.condition?.trim() ||
              (nodes.find((n) => n.id === id)?.data.kind === "logic_split" ? "else" : undefined);
            return { ...e, label };
          });
        }
        set({ nodes, edges, ...dirtyFields(get().editRevision) });
      },
      deleteNode: (id) => {
        pushHistory(get().nodes, get().edges);
        const remaining = get().nodes.filter((n) => n.id !== id);
        set({
          nodes: pruneTransitionTargets(remaining, new Set(remaining.map((n) => n.id))),
          edges: get().edges.filter((e) => e.source !== id && e.target !== id),
          selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
          ...dirtyFields(get().editRevision),
        });
      },
      deleteEdge: (id) => {
        pushHistory(get().nodes, get().edges);
        set({
          edges: get().edges.filter((e) => e.id !== id),
          ...dirtyFields(get().editRevision),
        });
      },
      deleteSelection: () => {
        const selected = get().nodes.filter((n) => n.selected);
        const ids = new Set(selected.map((n) => n.id));
        if (ids.size === 0 && get().selectedNodeId) ids.add(get().selectedNodeId);
        const selectedEdges = get().edges.filter((e) => e.selected || ids.has(e.source) || ids.has(e.target));
        if (ids.size === 0 && selectedEdges.length === 0) return;
        pushHistory(get().nodes, get().edges);
        const remaining = get().nodes.filter((n) => !ids.has(n.id));
        const live = new Set(remaining.map((n) => n.id));
        set({
          nodes: pruneTransitionTargets(remaining, live),
          edges: get().edges.filter((e) => !e.selected && live.has(e.source) && live.has(e.target)),
          selectedNodeId:
            get().selectedNodeId && ids.has(get().selectedNodeId) ? null : get().selectedNodeId,
          ...dirtyFields(get().editRevision),
        });
      },
      selectNode: (id) => set({ selectedNodeId: id, pendingAddVariable: false }),
      selectNodeAddVar: (id) => set({ selectedNodeId: id, pendingAddVariable: true }),
      setActiveNode: (id) => set({ activeNodeId: id }),
      setStartNode: (id) => {
        pushHistory(get().nodes, get().edges);
        set({
          nodes: get().nodes.map((n) => ({
            ...n,
            data: { ...n.data, isStart: n.id === id },
          })),
          ...dirtyFields(get().editRevision),
        });
      },
      clearAll: () => {
        pushHistory(get().nodes, get().edges);
        const channelType = get().settings.channelType ?? "voice";
        const isWA = channelType === "whatsapp";
        return set({
          nodes: isWA
            ? [
                makeNode("wa_start", "wa-start-node", 200, 200, {
                  label: "Conversation Start",
                  isStart: true,
                  dialogue: "",
                  transitions: [],
                }),
              ]
            : [
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
          settings: { ...defaultSettings, channelType },
          variables: [],
          currentAgentRowId: null,
          selectedNodeId: null,
          activeNodeId: null,
          flowVersion: get().flowVersion + 1,
          ...dirtyFields(get().editRevision),
        });
      },
      setSettings: (s) => set({ settings: { ...get().settings, ...s }, ...dirtyFields(get().editRevision) }),
      setVariables: (v) => set({ variables: v, ...dirtyFields(get().editRevision) }),
      addTestCallSeconds: (seconds) =>
        set({ testCallTotalSec: get().testCallTotalSec + Math.max(0, seconds) }),
      resetTestCallCost: () => set({ testCallTotalSec: 0 }),
      loadFlow: (data) => {
        resetHistory();
        const settings = data.replaceSettings
          ? {
              ...defaultSettings,
              channelType: data.settings?.channelType ?? get().settings.channelType ?? "voice",
              ...data.settings,
              publishedSnapshot: data.settings?.publishedSnapshot ?? null,
            }
          : data.settings
            ? { ...get().settings, ...data.settings }
            : get().settings;
        set({
          nodes: data.nodes,
          edges: data.edges,
          settings,
          variables: data.variables ?? (data.replaceSettings ? [] : get().variables),
          currentAgentRowId:
            data.agentRowId === undefined ? get().currentAgentRowId : data.agentRowId,
          selectedNodeId: null,
          flowVersion: get().flowVersion + 1,
          isDirty: false,
          canUndo: false,
          canRedo: false,
        });
      },
      setCurrentAgentRowId: (id) => set({ currentAgentRowId: id }),
      bumpSaveVersion: () => set({ saveVersion: get().saveVersion + 1, isDirty: false }),
      preAutoLayoutPositions: null,
      autoLayout: () => {
        const snapshot: Record<string, { x: number; y: number }> = {};
        for (const n of get().nodes) snapshot[n.id] = { x: n.position.x, y: n.position.y };
        pushHistory(get().nodes, get().edges);
        set({
          preAutoLayoutPositions: snapshot,
          nodes: autoLayoutNodes(get().nodes, get().edges),
          ...dirtyFields(get().editRevision),
        });
      },
      revertLayout: () => {
        const snap = get().preAutoLayoutPositions;
        if (!snap) return;
        pushHistory(get().nodes, get().edges);
        set({
          nodes: get().nodes.map((n) => (snap[n.id] ? { ...n, position: { ...snap[n.id] } } : n)),
          preAutoLayoutPositions: null,
          ...dirtyFields(get().editRevision),
        });
      },
      undo: () => {
        if (past.length === 0) return;
        const current = cloneSlice(get().nodes, get().edges);
        const prev = past.pop()!;
        future.push(current);
        set({
          nodes: prev.nodes,
          edges: prev.edges,
          selectedNodeId: null,
          ...dirtyFields(get().editRevision),
          canUndo: past.length > 0,
          canRedo: true,
        });
      },
      redo: () => {
        if (future.length === 0) return;
        const current = cloneSlice(get().nodes, get().edges);
        const next = future.pop()!;
        past.push(current);
        set({
          nodes: next.nodes,
          edges: next.edges,
          selectedNodeId: null,
          ...dirtyFields(get().editRevision),
          canUndo: true,
          canRedo: future.length > 0,
        });
      },
      copySelection: () => {
        const slice = selectedGraphSlice(get().nodes, get().edges);
        if (slice.nodes.length === 0) {
          const id = get().selectedNodeId;
          const node = id ? get().nodes.find((n) => n.id === id) : undefined;
          if (!node) return false;
          clipboard = { nodes: [node], edges: [] };
          return true;
        }
        clipboard = structuredClone(slice);
        return true;
      },
      pasteClipboard: () => {
        if (!clipboard || clipboard.nodes.length === 0) return false;
        pushHistory(get().nodes, get().edges);
        const cloned = cloneGraphSlice(clipboard, nextId);
        set({
          nodes: [...deselectAll(get().nodes), ...cloned.nodes],
          edges: [...deselectAll(get().edges), ...cloned.edges],
          selectedNodeId: cloned.nodes[0]?.id ?? null,
          ...dirtyFields(get().editRevision),
        });
        return true;
      },
      duplicateSelection: () => {
        const copied = get().copySelection();
        if (!copied) return false;
        return get().pasteClipboard();
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
      onRehydrateStorage: () => () => {
        resetHistory();
        useBuilderStore.setState({ isDirty: false, canUndo: false, canRedo: false });
      },
    },
  ),
);
