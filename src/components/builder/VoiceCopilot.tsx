import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, Loader2, HelpCircle, X, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBuilderStore } from "@/lib/builder/store";
import type { NodeKind, FlowNodeData } from "@/lib/builder/types";
import { cn } from "@/lib/utils";

type CopilotState = "idle" | "recording" | "processing";

interface VoiceCommand {
  action: string;
  // CREATE_NODE
  type?: string;
  label?: string;
  dialogue?: string;
  _ref?: string;
  properties?: Record<string, string>;
  // CONNECT_NODES — support both old (from/to) and new spec (from_node_id/to_node_id)
  from?: string;
  to?: string;
  from_node_id?: string;
  to_node_id?: string;
  via_transition?: string;
  transition_label?: string;
  // UPDATE_NODE_PROPERTIES
  node?: string;
  // CREATE_TRANSITIONS
  transitions?: string[];
  // UPDATE_GLOBAL_SETTINGS
  agentName?: string;
  globalPrompt?: string;
  language?: string;
  voiceId?: string;
  model?: string;
  // REMOVE_TRANSITION
  transition?: string;
  // DISCONNECT_NODES (reuses from_node_id/to_node_id)
  // CREATE_NODE with seed-recipe position override
  position?: { x: number; y: number };
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collision-aware placement (spec §4)
// Sequential: place to the right of the rightmost node at +320,+0
// If that spot is occupied: stack below at +320,+180 increments
// Floating (no nodes): default 320, 200
// ─────────────────────────────────────────────────────────────────────────────
const NODE_W = 240, NODE_H = 140, MARGIN = 40;

function hasCollision(pos: { x: number; y: number }, nodes: { position: { x: number; y: number } }[]) {
  return nodes.some(
    (n) =>
      Math.abs(n.position.x - pos.x) < NODE_W + MARGIN &&
      Math.abs(n.position.y - pos.y) < NODE_H + MARGIN,
  );
}

function findFreePosition(existingNodes: { position: { x: number; y: number } }[]): { x: number; y: number } {
  if (existingNodes.length === 0) return { x: 320, y: 200 };
  const maxX = Math.max(...existingNodes.map((n) => n.position.x));
  const avgY = Math.round(existingNodes.reduce((s, n) => s + n.position.y, 0) / existingNodes.length);
  // Try sequential right placement first
  for (let row = 0; row < 6; row++) {
    const candidate = { x: maxX + 320, y: avgY + row * (NODE_H + MARGIN) };
    if (!hasCollision(candidate, existingNodes)) return candidate;
  }
  // Fall back: far right, below all nodes
  const maxY = Math.max(...existingNodes.map((n) => n.position.y));
  return { x: maxX + 320, y: maxY + NODE_H + MARGIN * 2 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy node finder — exact ID → _ref map → exact label → includes → Levenshtein
// ─────────────────────────────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function findNode(nameOrRef: string, idMap: Record<string, string>) {
  const nodes = useBuilderStore.getState().nodes;

  // 1. _ref resolved to real ID
  const mapped = idMap[nameOrRef];
  if (mapped) {
    const n = nodes.find((n) => n.id === mapped);
    if (n) return n;
  }
  // 2. Exact node ID
  const byId = nodes.find((n) => n.id === nameOrRef);
  if (byId) return byId;

  const lower = nameOrRef.toLowerCase().trim();
  // 3. Exact label
  const exact = nodes.find((n) => n.data.label.toLowerCase() === lower);
  if (exact) return exact;
  // 4. Substring
  const sub = nodes.find(
    (n) =>
      n.data.label.toLowerCase().includes(lower) ||
      lower.includes(n.data.label.toLowerCase()),
  );
  if (sub) return sub;
  // 5. Levenshtein ≤ max(3, 40% of query)
  let best: (typeof nodes)[0] | undefined;
  let bestDist = Infinity;
  for (const n of nodes) {
    const d = levenshtein(n.data.label.toLowerCase(), lower);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  if (best && bestDist <= Math.max(3, Math.floor(lower.length * 0.4))) return best;
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map voice property names → FlowNodeData field names
// ─────────────────────────────────────────────────────────────────────────────
function mapProperties(props: Record<string, string>): Partial<FlowNodeData> {
  const p: Partial<FlowNodeData> = {};
  if (props.title) p.label = props.title;
  if (props.text) p.dialogue = props.text;
  if (props.phone_number) p.transferNumber = props.phone_number;
  if (props.sms_body) p.smsMessage = props.sms_body;
  if (props.variable_name) p.variableName = props.variable_name;
  if (props.function_name) p.toolName = props.function_name;
  if (props.code_snippet) p.codeSource = props.code_snippet;
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command executor — two-phase to avoid ReactFlow handle race condition.
// Phase 1 (sync):  CREATE_NODE, CREATE_TRANSITIONS, UPDATE_*, settings
// Phase 2 (rAF×2): CONNECT_NODES — deferred so new handles are mounted first
// ─────────────────────────────────────────────────────────────────────────────
async function executeVoiceCommands(commands: VoiceCommand[]) {
  const idMap: Record<string, string> = {};
  let createdCount = 0, connectedCount = 0, updatedCount = 0, settingsCount = 0, deletedCount = 0;
  const warnings: string[] = [];

  // ── Phase 1: everything except CONNECT_NODES ─────────────────────────────
  const deferred: VoiceCommand[] = [];

  for (const cmd of commands) {
    if (cmd.action === "CONNECT_NODES") {
      deferred.push(cmd);
      continue;
    }

    // CREATE_NODE ─────────────────────────────────────────────────────────────
    if (cmd.action === "CREATE_NODE") {
      const nodesBefore = useBuilderStore.getState().nodes;
      // Use recipe-specified position when present; otherwise auto-place
      const pos = cmd.position ?? findFreePosition(nodesBefore);
      useBuilderStore.getState().addNode(cmd.type as NodeKind, pos);
      const newNode = useBuilderStore.getState().nodes.find((n) => !nodesBefore.some((b) => b.id === n.id));
      if (newNode) {
        if (cmd._ref) idMap[cmd._ref] = newNode.id;
        const patch: Partial<FlowNodeData> = {};
        if (cmd.label) patch.label = cmd.label;
        if (cmd.dialogue) patch.dialogue = cmd.dialogue;
        if (cmd.properties) Object.assign(patch, mapProperties(cmd.properties));
        if (Object.keys(patch).length) useBuilderStore.getState().updateNode(newNode.id, patch);
        createdCount++;
      }

    // UPDATE_NODE_PROPERTIES ──────────────────────────────────────────────────
    } else if (cmd.action === "UPDATE_NODE_PROPERTIES") {
      const target = cmd.node ? findNode(cmd.node, idMap) : undefined;
      if (!target) { warnings.push(`Could not find node: "${cmd.node ?? "?"}"`); continue; }
      const patch: Partial<FlowNodeData> = {};
      if (cmd.label) patch.label = cmd.label;
      if (cmd.dialogue) patch.dialogue = cmd.dialogue;
      if (cmd.properties) Object.assign(patch, mapProperties(cmd.properties));
      if (Object.keys(patch).length) { useBuilderStore.getState().updateNode(target.id, patch); updatedCount++; }

    // CREATE_TRANSITIONS ──────────────────────────────────────────────────────
    } else if (cmd.action === "CREATE_TRANSITIONS") {
      const target = cmd.node ? findNode(cmd.node, idMap) : undefined;
      if (!target) { warnings.push(`Could not find node: "${cmd.node ?? "?"}"`); continue; }
      const newTransitions = (cmd.transitions ?? []).map((label) => ({
        id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        condition: label,
        target: null,
      }));
      if (newTransitions.length) {
        const fresh = useBuilderStore.getState().nodes.find((n) => n.id === target.id);
        useBuilderStore.getState().updateNode(target.id, {
          transitions: [...(fresh?.data.transitions ?? []), ...newTransitions],
        });
        updatedCount++;
      }

    // DELETE_NODE ─────────────────────────────────────────────────────────────
    // Permanently removes the node and all edges attached to it (store handles edges).
    } else if (cmd.action === "DELETE_NODE") {
      const target = cmd.node ? findNode(cmd.node, idMap) : undefined;
      if (!target) { warnings.push(`Could not find node to delete: "${cmd.node ?? "?"}"`); continue; }
      useBuilderStore.getState().deleteNode(target.id);
      deletedCount++;

    // UPDATE_GLOBAL_SETTINGS ──────────────────────────────────────────────────
    } else if (cmd.action === "UPDATE_GLOBAL_SETTINGS") {
      const patch: Record<string, unknown> = {};
      if (cmd.agentName)    patch.agentName    = cmd.agentName;
      if (cmd.globalPrompt) patch.globalPrompt = cmd.globalPrompt;
      if (cmd.language)     patch.language     = cmd.language;
      if (cmd.voiceId)      patch.voiceId      = cmd.voiceId;
      if (cmd.model)        patch.model        = cmd.model;
      if (Object.keys(patch).length) { useBuilderStore.getState().setSettings(patch); settingsCount++; }

    // REMOVE_TRANSITION ───────────────────────────────────────────────────────
    // Removes the named transition handle AND any edges wired through it.
    } else if (cmd.action === "REMOVE_TRANSITION") {
      const target = cmd.node ? findNode(cmd.node, idMap) : undefined;
      if (!target) { warnings.push(`Could not find node: "${cmd.node ?? "?"}"`); continue; }
      const liveNode = useBuilderStore.getState().nodes.find((n) => n.id === target.id);
      const allTransitions = liveNode?.data.transitions ?? [];
      const transLabel = (cmd.transition ?? "").toLowerCase();
      // Fuzzy match the named transition
      let match = allTransitions.find(
        (t) => t.condition.toLowerCase() === transLabel || t.condition.toLowerCase().includes(transLabel) || transLabel.includes(t.condition.toLowerCase()),
      );
      if (!match) {
        const thresh = Math.max(2, Math.floor(transLabel.length * 0.35));
        match = allTransitions.find((t) => levenshtein(t.condition.toLowerCase(), transLabel) <= thresh);
      }
      if (!match) { warnings.push(`Could not find transition "${cmd.transition ?? "?"}" on "${target.data.label}"`); continue; }
      // Remove the transition from the node
      useBuilderStore.getState().updateNode(target.id, {
        transitions: allTransitions.filter((t) => t.id !== match!.id),
      });
      // Remove edges that used this handle
      useBuilderStore.setState({
        edges: useBuilderStore.getState().edges.filter((e) => e.sourceHandle !== match!.id),
      });
      deletedCount++;

    // DISCONNECT_NODES ────────────────────────────────────────────────────────
    // Removes all edges between two nodes; keeps the transition handles intact
    // (they are just left unconnected so the user can reconnect later).
    } else if (cmd.action === "DISCONNECT_NODES") {
      const fromRef  = cmd.from_node_id ?? cmd.from;
      const toRef    = cmd.to_node_id   ?? cmd.to;
      const fromNode = fromRef ? findNode(fromRef, idMap) : undefined;
      const toNode   = toRef   ? findNode(toRef,   idMap) : undefined;
      if (!fromNode || !toNode) {
        warnings.push(`Could not find nodes: "${fromRef ?? "?"}" → "${toRef ?? "?"}"`);
        continue;
      }
      const { edges } = useBuilderStore.getState();
      const toRemove = new Set(
        edges.filter((e) => e.source === fromNode.id && e.target === toNode.id).map((e) => e.id),
      );
      if (toRemove.size === 0) { warnings.push(`No connection found between "${fromNode.data.label}" and "${toNode.data.label}"`); continue; }
      // Remove edges
      useBuilderStore.setState({ edges: edges.filter((e) => !toRemove.has(e.id)) });
      // Clear target on affected transitions so handles show as unconnected
      const removedHandles = new Set(
        edges.filter((e) => toRemove.has(e.id)).map((e) => e.sourceHandle).filter(Boolean),
      );
      useBuilderStore.getState().updateNode(fromNode.id, {
        transitions: (useBuilderStore.getState().nodes.find((n) => n.id === fromNode.id)?.data.transitions ?? [])
          .map((t) => removedHandles.has(t.id) ? { ...t, target: null } : t),
      });
      deletedCount++;
    }
  }

  // ── Phase 2: connections — wait two rAF so new Handle elements mount ──────
  if (deferred.length > 0) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    for (const cmd of deferred) {
      const fromRef  = cmd.from_node_id ?? cmd.from;
      const toRef    = cmd.to_node_id   ?? cmd.to;
      const fromNode = fromRef ? findNode(fromRef, idMap) : undefined;
      const toNode   = toRef   ? findNode(toRef,   idMap) : undefined;

      if (!fromNode || !toNode) {
        warnings.push(`Could not find nodes: "${fromRef ?? "?"}" → "${toRef ?? "?"}"`);
        continue;
      }

      let sourceHandle: string | null = null;

      // Try to match an existing transition by via_transition label (fuzzy)
      if (cmd.via_transition) {
        const viaLower = cmd.via_transition.toLowerCase();
        const liveNode = useBuilderStore.getState().nodes.find((n) => n.id === fromNode.id);
        const transitions = liveNode?.data.transitions ?? [];
        // Exact or substring match first, then Levenshtein fallback
        let match = transitions.find(
          (t) =>
            t.condition.toLowerCase() === viaLower ||
            t.condition.toLowerCase().includes(viaLower) ||
            viaLower.includes(t.condition.toLowerCase()),
        );
        if (!match) {
          const threshold = Math.max(2, Math.floor(viaLower.length * 0.35));
          match = transitions.find(
            (t) => levenshtein(t.condition.toLowerCase(), viaLower) <= threshold,
          );
        }
        if (match) sourceHandle = match.id;
      }

      // No matching handle — create a new transition, then wait one more frame
      if (!sourceHandle) {
        const newId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const conditionLabel = cmd.transition_label ?? cmd.via_transition ?? "Continue";
        const liveNode = useBuilderStore.getState().nodes.find((n) => n.id === fromNode.id);
        useBuilderStore.getState().updateNode(fromNode.id, {
          transitions: [
            ...(liveNode?.data.transitions ?? []),
            { id: newId, condition: conditionLabel, target: toNode.id },
          ],
        });
        sourceHandle = newId;
        // Wait for the new Handle to mount before connecting
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }

      useBuilderStore.getState().onConnect({
        source: fromNode.id,
        target: toNode.id,
        sourceHandle,
        targetHandle: null,
      });
      connectedCount++;
    }
  }

  return { createdCount, connectedCount, updatedCount, settingsCount, deletedCount, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
// ── Cycling hint phrases shown under the mic button ─────────────────────────
const HINTS = [
  'Try: "Switch to Webee Build"',
  'Try: "Delete the conversation node"',
  'Try: "Connect Intro to Check Availability"',
  'Try: "Add a logic split node"',
  'Try: "Rename this node to Booking Confirm"',
  'Try: "Webee help"',
  'Try: "How do I pass variables?"',
  'Try: "Open the receptionist go-live guide"',
];

// ── Cheat-sheet command catalogue ────────────────────────────────────────────
const CHEAT_SECTIONS = [
  {
    title: "App Modes",
    icon: "⚡",
    commands: [
      { phrase: "Switch to Webee Build",  desc: "Activate Macro Blueprint mode" },
      { phrase: "Switch back to normal",  desc: "Return to single-command mode" },
      { phrase: "Exit Webee Build",       desc: "Exit Macro mode" },
      { phrase: "Webee help",             desc: "Activate Platform Helper mode" },
      { phrase: "Switch to Webee help",   desc: "Activate Platform Helper mode" },
      { phrase: "Exit help",              desc: "Exit Platform Helper mode" },
    ],
  },
  {
    title: "Platform Helper",
    icon: "📘",
    commands: [
      { phrase: "How do I configure a Logic Split?",       desc: "Step-by-step configuration guide" },
      { phrase: "How do I pass variables between nodes?",  desc: "Learn variable extraction & usage" },
      { phrase: "How do I check my Retell config?",        desc: "Troubleshoot Retell setup" },
      { phrase: "Open the receptionist go-live guide",     desc: "Opens documentation in a new tab" },
      { phrase: "Open the customer care build guide",      desc: "Opens documentation in a new tab" },
      { phrase: "How do I deploy my agent?",               desc: "Publishing & Go Live walkthrough" },
    ],
  },
  {
    title: "Node Creation",
    icon: "＋",
    commands: [
      { phrase: "Add a logic split node",         desc: "Creates a Logic Split node" },
      { phrase: "Create a code block",             desc: "Creates a Code block node" },
      { phrase: "Add a conversation node called…", desc: "Creates & names a node" },
      { phrase: "Create an end call node",         desc: "Creates an End Call node" },
    ],
  },
  {
    title: "Connections & Transitions",
    icon: "↔",
    commands: [
      { phrase: "Connect Intro to Check Availability", desc: "Wires two nodes together" },
      { phrase: "Add a transition labelled Yes",        desc: "Creates a handle on a node" },
      { phrase: "Remove the wire between A and B",      desc: "Disconnects two nodes" },
    ],
  },
  {
    title: "Canvas Tweaks",
    icon: "✏",
    commands: [
      { phrase: "Delete the conversation node",         desc: "Removes a node + its wires" },
      { phrase: "Rename this node to Booking Confirm",  desc: "Updates a node's label" },
      { phrase: "Set the welcome message to…",          desc: "Updates node dialogue" },
    ],
  },
];

export function VoiceCopilotButton({
  onModeChange,
}: {
  onModeChange?: (mode: "MICRO" | "MACRO" | "PLATFORM_HELP") => void;
} = {}) {
  const [state, setState]             = useState<CopilotState>("idle");
  const [copilotMode, setCopilotMode] = useState<"MICRO" | "MACRO" | "PLATFORM_HELP">("MICRO");
  const [sessionCost, setSessionCost] = useState(0);
  const [lastCost, setLastCost]       = useState<number | null>(null);
  const [hintIndex, setHintIndex]     = useState(0);
  const [hintVisible, setHintVisible] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showSheet, setShowSheet]     = useState(false);
  const [portalRoot, setPortalRoot]   = useState<HTMLElement | null>(null);
  // Use a ref so processAudio always reads the current mode without stale closure
  const modeRef        = useRef<"MICRO" | "MACRO" | "PLATFORM_HELP">("MICRO");
  const hoverTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);

  // Cycle hint text every 3 s with a short fade between items
  useEffect(() => {
    const id = setInterval(() => {
      setHintVisible(false);
      setTimeout(() => {
        setHintIndex((i) => (i + 1) % HINTS.length);
        setHintVisible(true);
      }, 350);
    }, 3200);
    return () => clearInterval(id);
  }, []);

  // Grab portal root once on client (keeps SSR safe)
  useEffect(() => { setPortalRoot(document.body); }, []);

  // Close help sheet on Escape
  useEffect(() => {
    if (!showSheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowSheet(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSheet]);

  const updateMode = useCallback((m: "MICRO" | "MACRO" | "PLATFORM_HELP") => {
    modeRef.current = m;
    setCopilotMode(m);
    onModeChange?.(m);
  }, [onModeChange]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const processAudio = useCallback(async (blob: Blob) => {
    setState("processing");
    try {
      // Encode audio to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Snapshot current canvas nodes — include positions and transitions so
      // GPT can reason about layout, reference "the last node", and reuse existing handles
      const canvasNodes = useBuilderStore.getState().nodes.map((n) => ({
        id: n.id,
        label: n.data.label,
        kind: n.data.kind,
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        transitions: n.data.transitions.map((t) => ({ id: t.id, label: t.condition })),
      }));

      const currentMode = modeRef.current;

      const res = await fetch("/api/voice-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: base64,
          mimeType: blob.type || "audio/webm",
          canvasNodes,
          copilotMode: currentMode,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        transcript?: string;
        commands?: VoiceCommand[];
        helpResponse?: string;
        mode?: string | null;
        error?: string;
        usage?: {
          promptTokens: number;
          completionTokens: number;
          whisperSeconds: number;
          rawCostUsd: number;
          clientCostUsd: number;
        } | null;
      };

      // Accumulate session cost immediately (even if commands fail later)
      if (data.usage) {
        setSessionCost((prev) => prev + data.usage!.clientCostUsd);
        setLastCost(data.usage.clientCostUsd);
      }

      if (!data.ok || !data.commands) {
        toast.error(data.error ?? "Voice copilot failed. Please try again.");
        return;
      }

      // ── PLATFORM_HELP mode: show helpResponse + execute doc-link commands only ──
      if (currentMode === "PLATFORM_HELP") {
        if (data.helpResponse) {
          toast.success(
            <div className="flex items-start gap-2 text-sm max-w-[280px]">
              <span className="text-purple-400 text-base shrink-0 mt-0.5">📘</span>
              <div>
                <span className="text-[10px] font-semibold tracking-wide text-purple-400 block mb-0.5 uppercase">
                  Platform Helper
                </span>
                <span className="text-slate-200 text-[12px] leading-snug">{data.helpResponse}</span>
              </div>
            </div>,
            { duration: 12000 },
          );
        }
        // Execute only OPEN_DOCUMENTATION_LINK commands from the help response
        for (const cmd of data.commands) {
          if (cmd.action === "OPEN_DOCUMENTATION_LINK" && (cmd as Record<string, unknown>).target_url) {
            window.open((cmd as Record<string, unknown>).target_url as string, "_blank", "noopener,noreferrer");
          }
        }
        return;
      }

      // ── Mode-switch detection (client-side, checked before any commands) ──
      if (data.transcript) {
        const lower = data.transcript.toLowerCase();

        // Whisper mangles "Webee" in many ways: "we be", "we bee", "weeby", "WeBeBuild",
        // "WeeBeeBuild", "web build", "EXIT WEB BUILD" etc. Use intent-based matching:
        // look for the activation verb AND any phonetic trace of "webee" separately.
        //
        // "Webee" phonetic fingerprint: word starting with "we" or "w" followed by
        // some combo of e/b sounds, OR the standalone word "web".
        const WB = /\bwe+b|web\b|we[\s-]b/i;      // covers weeb, web, we be, we-b …
        const isActivate = /\b(switch\s+to|activate|enable|start\s+webee?)\b/i;
        const isExit     = /\bexit\b|\bswitch\s+back\b|\breturn\s+to\s+normal\b|\bnormal\s+mode\b/i;

        // PLATFORM_HELP: (webee/WB fingerprint OR webee? word) AND "help" present
        const isHelpActivate = (WB.test(lower) || /\bwebee?\b/i.test(lower)) && /\bhelp\b/i.test(lower);
        // Explicit "exit help" / "close help" → back to MICRO (no WB required)
        const isExitHelp = /\bexit\s+help\b|\bclose\s+help\b/i.test(lower);

        // MACRO: activation verb present AND phonetic "webee" present
        const isMacroSwitch = isActivate.test(lower) && WB.test(lower);
        // MICRO: exit verb present AND (phonetic "webee" OR "build" present)
        //        OR standard return phrases alone (no "webee" needed)
        const isMicroSwitch =
          (isExit.test(lower) && (WB.test(lower) || /\bbuild\b/i.test(lower))) ||
          /\b(switch\s+back|return\s+to\s+normal|normal\s+mode)\b/i.test(lower);

        // Check PLATFORM_HELP first so "switch to webee help" doesn't trigger MACRO
        if (isHelpActivate) {
          updateMode("PLATFORM_HELP");
          toast.success(
            <div className="flex items-center gap-2 text-sm">
              <span className="text-purple-400 text-base">📘</span>
              <div>
                <span className="text-purple-400 font-bold">Platform Helper</span>
                <span className="text-muted-foreground ml-1.5">activated — ask me anything about the platform</span>
              </div>
            </div>,
            { duration: 5000 },
          );
          return;
        }
        if (isMacroSwitch) {
          updateMode("MACRO");
          toast.success(
            <div className="flex items-center gap-2 text-sm">
              <span className="text-yellow-400 text-base">⚡</span>
              <div>
                <span className="text-yellow-400 font-bold">Webee Build Mode</span>
                <span className="text-muted-foreground ml-1.5">activated — describe a full flow</span>
              </div>
            </div>,
            { duration: 5000 },
          );
          return;
        }
        if (isMicroSwitch || isExitHelp) {
          updateMode("MICRO");
          toast.info("Normal mode restored.", { duration: 3000 });
          return;
        }
      }

      const isBlueprint = data.mode === "MACRO_BLUEPRINT";

      // Show what was heard — with architect mode badge if applicable
      if (data.transcript) {
        toast.info(
          <span className="text-sm">
            {isBlueprint && (
              <span className="text-[10px] font-semibold tracking-wide text-yellow-400 block mb-0.5 uppercase">
                ✦ Architect Mode
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium block mb-0.5">
              {isBlueprint ? "Blueprint Detected" : "Heard"}
            </span>
            "{data.transcript}"
          </span>,
          { duration: isBlueprint ? 6000 : 4000, id: "voice-transcript" },
        );
      }

      // If architect mode, announce before executing (it takes a moment)
      if (isBlueprint) {
        toast(
          <div className="flex items-center gap-2 text-sm">
            <span className="text-yellow-400 text-base">✦</span>
            <div>
              <span className="text-yellow-400 font-semibold">Architect Mode Active</span>
              <span className="text-muted-foreground ml-1.5">— applying full blueprint…</span>
            </div>
          </div>,
          { id: "architect-mode", duration: 8000 },
        );
      }

      if (data.commands.length === 0) {
        toast.warning(
          "No builder commands detected — try describing nodes to add, connections to make, or settings to change.",
          { duration: 5000 },
        );
        return;
      }

      const { createdCount, connectedCount, updatedCount, settingsCount, deletedCount, warnings } =
        await executeVoiceCommands(data.commands);

      // Dismiss architect mode "in progress" toast
      if (isBlueprint) toast.dismiss("architect-mode");

      warnings.forEach((w) => toast.warning(w, { duration: 6000 }));

      const parts: string[] = [];
      if (createdCount)   parts.push(`${createdCount} node${createdCount > 1 ? "s" : ""} added`);
      if (connectedCount) parts.push(`${connectedCount} connection${connectedCount > 1 ? "s" : ""} made`);
      if (updatedCount)   parts.push(`${updatedCount} update${updatedCount > 1 ? "s" : ""} applied`);
      if (deletedCount)   parts.push(`${deletedCount} removed`);
      if (settingsCount)  parts.push("settings updated");

      if (parts.length) {
        if (isBlueprint) {
          toast.success(
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wide">
                ✦ Blueprint Complete
              </span>
              <span className="text-sm">{parts.join(" · ")} — saved to draft</span>
            </div>,
            { duration: 6000 },
          );
        } else {
          toast.success(
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">
                Done
              </span>
              <span className="text-sm">{parts.join(" · ")}</span>
            </div>,
            { duration: 4000 },
          );
        }
      }
    } catch (err) {
      console.error("[VoiceCopilot] Error:", err);
      toast.error("Could not understand layout instruction. Please try again.");
    } finally {
      setState("idle");
    }
  }, []);

  const handleClick = useCallback(async () => {
    if (state === "recording") { stopRecording(); return; }
    if (state === "processing") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () =>
        void processAudio(new Blob(chunksRef.current, { type: mimeType || "audio/webm" }));

      recorder.start();
      setState("recording");

      toast.info(
        modeRef.current === "MACRO"
          ? "⚡ Webee Build — describe your full flow, then click the mic to stop."
          : "Listening… click the mic again to stop.",
        { id: "voice-listening", duration: 30000 },
      );
    } catch (err) {
      console.error("[VoiceCopilot] Mic access error:", err);
      toast.error("Microphone access denied. Please allow mic access and try again.");
    }
  }, [state, stopRecording, processAudio]);

  const isRecording  = state === "recording";
  const isProcessing = state === "processing";
  const isMacro      = copilotMode === "MACRO";
  const isHelp       = copilotMode === "PLATFORM_HELP";

  return (
    <>
      {/* ────────────────────────────────────────────────────────────────────
          Slide-out help sheet — portalled to body so fixed pos works correctly
      ──────────────────────────────────────────────────────────────────── */}
      {portalRoot && createPortal(
        <>
          {/* Backdrop */}
          <div
            className={cn(
              "fixed inset-0 z-[9998] bg-black/60 transition-opacity duration-200",
              showSheet ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
            )}
            onClick={() => setShowSheet(false)}
          />
          {/* Panel */}
          <div
            className={cn(
              "fixed top-0 right-0 h-full w-[320px] z-[9999] flex flex-col",
              "bg-[#0f1117] border-l-2 border-slate-700 shadow-[0_0_80px_rgba(0,0,0,1)]",
              "transition-transform duration-[250ms] ease-in-out",
              showSheet ? "translate-x-0" : "translate-x-full",
            )}
          >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🎙️</span>
            <span className="text-sm font-bold text-white tracking-tight">Voice Controls</span>
          </div>
          <button
            onClick={() => setShowSheet(false)}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Activation highlights */}
        <div className="mx-4 mt-4 mb-1 space-y-2">
          <div className="px-3 py-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10">
            <p className="text-[10px] text-yellow-500/80 uppercase tracking-widest mb-1.5 font-bold">Build mode</p>
            <div className="flex items-center gap-2">
              <span className="text-yellow-400 text-sm">⚡</span>
              <span className="text-yellow-300 text-[13px] font-semibold">"Switch to Webee Build"</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">Describe a full multi-node flow in one sentence.</p>
          </div>
          <div className="px-3 py-3 rounded-lg border border-purple-500/50 bg-purple-500/10">
            <p className="text-[10px] text-purple-400/80 uppercase tracking-widest mb-1.5 font-bold">Platform helper</p>
            <div className="flex items-center gap-2">
              <span className="text-purple-400 text-sm">📘</span>
              <span className="text-purple-300 text-[13px] font-semibold">"Webee help"</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">Ask platform questions or open step-by-step guides.</p>
          </div>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4 mt-3 scrollbar-none">
          {CHEAT_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-[11px] text-slate-400">{section.icon}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{section.title}</span>
              </div>
              <div className="space-y-1">
                {section.commands.map((cmd) => (
                  <div key={cmd.phrase} className="flex items-start gap-2 rounded-md px-2.5 py-2 bg-slate-800 hover:bg-slate-700 transition-colors">
                    <ChevronRight className="h-3 w-3 text-slate-500 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-100 font-medium leading-snug">"{cmd.phrase}"</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{cmd.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-700 text-[10px] text-slate-500 text-center">
          Press <kbd className="px-1 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">Esc</kbd> to close
        </div>
          </div>
        </>,
        document.body,
      )}

      {/* ────────────────────────────────────────────────────────────────────
          Main widget wrapper
      ──────────────────────────────────────────────────────────────────── */}
      <div className="relative flex items-center justify-center gap-0.5" style={{ overflow: "visible" }}>

        {/* ── MACRO floating badge ── */}
        {isMacro && (
          <div
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-50"
            style={{ whiteSpace: "nowrap" }}
          >
            <div className="flex items-center gap-1.5 bg-yellow-400 text-slate-900 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full shadow-lg shadow-yellow-500/40">
              <span>⚡ WEBEE BUILD</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateMode("MICRO");
                  toast.info("Normal mode restored.", { duration: 3000 });
                }}
                className="opacity-60 hover:opacity-100 transition-opacity leading-none ml-0.5"
                title="Exit Webee Build Mode"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── PLATFORM_HELP floating badge ── */}
        {isHelp && (
          <div
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-50"
            style={{ whiteSpace: "nowrap" }}
          >
            <div className="flex items-center gap-1.5 bg-purple-500 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full shadow-lg shadow-purple-500/40">
              <span>📘 PLATFORM HELPER ACTIVE</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateMode("MICRO");
                  toast.info("Normal mode restored.", { duration: 3000 });
                }}
                className="opacity-60 hover:opacity-100 transition-opacity leading-none ml-0.5"
                title="Exit Platform Helper"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* ── Hover tooltip (MICRO mode only, 500 ms delay) ── */}
        {showTooltip && !isMacro && !isHelp && !isRecording && !isProcessing && (
          <div
            className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
            style={{ whiteSpace: "nowrap" }}
          >
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-2xl shadow-black/60 w-56">
              <p className="text-[11px] font-bold text-slate-100 mb-1.5">🎙️ Voice Controls</p>
              <p className="text-[10px] text-slate-400 leading-relaxed mb-2.5">
                Click to speak commands for single actions. To build entire layouts at once, use the phrase below:
              </p>
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-yellow-500/40 bg-yellow-500/10">
                <span className="text-yellow-400 text-[10px]">⚡</span>
                <span className="text-yellow-300 text-[11px] font-semibold">"Switch to Webee Build"</span>
              </div>
              {sessionCost > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Session cost</span>
                  <div className="flex items-center gap-2 text-[10px] font-mono">
                    {lastCost !== null && (
                      <span className="text-slate-500">last <span className="text-slate-400">${lastCost.toFixed(4)}</span></span>
                    )}
                    <span className="text-slate-300 font-semibold">${sessionCost.toFixed(4)}</span>
                  </div>
                </div>
              )}
            </div>
            {/* Arrow */}
            <div className="flex justify-center mt-[-1px]">
              <div className="w-2.5 h-2.5 bg-slate-900 border-r border-b border-slate-800 rotate-45 -mt-1.5" />
            </div>
          </div>
        )}

        {/* ── Mic button ── */}
        <Button
          size="sm"
          variant="ghost"
          disabled={isProcessing}
          onMouseEnter={() => {
            hoverTimerRef.current = setTimeout(() => setShowTooltip(true), 500);
          }}
          onMouseLeave={() => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            setShowTooltip(false);
          }}
          onClick={() => {
            setShowTooltip(false);
            if (isRecording) toast.dismiss("voice-listening");
            void handleClick();
          }}
          className={cn(
            "!h-8 !w-8 !p-0 relative transition-all duration-200",
            isRecording
              ? isHelp
                ? "text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 hover:text-purple-300"
                : "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 hover:text-yellow-300"
              : isProcessing
                ? isMacro
                  ? "text-yellow-400 bg-yellow-500/10"
                  : isHelp
                    ? "text-purple-400 bg-purple-500/10"
                    : "text-blue-400 bg-blue-500/10"
                : isMacro
                  ? "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 hover:text-yellow-300"
                  : isHelp
                    ? "text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 hover:text-purple-300"
                    : "text-muted-foreground/60 hover:text-blue-400 hover:bg-blue-500/10",
          )}
        >
          {isProcessing ? (
            <Loader2 className={cn("h-3.5 w-3.5 animate-spin", isMacro && "text-yellow-400", isHelp && "text-purple-400")} />
          ) : isRecording ? (
            <>
              <MicOff className="h-3.5 w-3.5" />
              <span className={cn(
                "absolute inset-0 rounded-md animate-ping pointer-events-none",
                isHelp ? "bg-purple-400/20" : "bg-yellow-400/20",
              )} />
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5" />
              {isMacro && (
                <span className="absolute inset-0 rounded-md animate-pulse bg-yellow-400/15 pointer-events-none" />
              )}
              {isHelp && (
                <span className="absolute inset-0 rounded-md animate-pulse bg-purple-400/15 pointer-events-none" />
              )}
            </>
          )}
        </Button>

        {/* ── Help (?) button ── */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowSheet((s) => !s); }}
          title="Voice command cheat sheet"
          className="flex items-center justify-center h-5 w-5 rounded text-slate-600 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
        >
          <HelpCircle className="h-3 w-3" />
        </button>

        {/* ── Cycling hint text (idle only) ── */}
        {!isRecording && !isProcessing && (
          <div
            className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 pointer-events-none"
            style={{ whiteSpace: "nowrap" }}
          >
            <p
              className="text-[9px] font-medium text-slate-500 transition-opacity duration-300"
              style={{ opacity: hintVisible ? 1 : 0 }}
            >
              {HINTS[hintIndex]}
            </p>
          </div>
        )}

      </div>
    </>
  );
}
