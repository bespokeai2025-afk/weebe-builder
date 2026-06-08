import { useRef, useState, useCallback } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
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
      const pos = findFreePosition(nodesBefore);
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
export function VoiceCopilotButton() {
  const [state, setState]             = useState<CopilotState>("idle");
  const [copilotMode, setCopilotMode] = useState<"MICRO" | "MACRO">("MICRO");
  const [sessionCost, setSessionCost] = useState(0);
  const [lastCost, setLastCost]       = useState<number | null>(null);
  // Use a ref so processAudio always reads the current mode without stale closure
  const modeRef = useRef<"MICRO" | "MACRO">("MICRO");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);

  const updateMode = useCallback((m: "MICRO" | "MACRO") => {
    modeRef.current = m;
    setCopilotMode(m);
  }, []);

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

      // ── Mode-switch detection (client-side, checked before any commands) ──
      if (data.transcript) {
        const lower = data.transcript.toLowerCase();
        const MACRO_PHRASES = ["switch to webee build", "activate webee build", "webee build mode", "enable webee build"];
        const MICRO_PHRASES = ["switch back to normal", "exit webee build", "return to normal", "normal mode", "disable webee build"];
        if (MACRO_PHRASES.some((p) => lower.includes(p))) {
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
        if (MICRO_PHRASES.some((p) => lower.includes(p))) {
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

  return (
    <div className="relative flex items-center justify-center" style={{ overflow: "visible" }}>

      {/* ── Floating badge: only visible in MACRO mode ── */}
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

      {/* ── Session cost counter (shows after first request) ── */}
      {sessionCost > 0 && (
        <div
          title={`Last request: $${lastCost?.toFixed(4)} • Session total (incl. webespokeai margin): $${sessionCost.toFixed(4)}`}
          className={cn(
            "absolute left-full ml-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono cursor-default select-none",
            isMacro
              ? "bg-yellow-400/10 text-yellow-300 border border-yellow-400/20"
              : "bg-white/[0.04] text-muted-foreground/60 border border-white/[0.06]",
          )}
          style={{ whiteSpace: "nowrap" }}
        >
          <span className="opacity-50">$</span>
          <span>{sessionCost.toFixed(4)}</span>
        </div>
      )}

      {/* ── Mic button ── */}
      <Button
        size="sm"
        variant="ghost"
        title={
          isRecording  ? "Stop recording" :
          isProcessing ? "Processing…" :
          isMacro      ? "⚡ Webee Build — describe a full flow" :
                         "Voice Command Copilot"
        }
        disabled={isProcessing}
        onClick={() => {
          if (isRecording) toast.dismiss("voice-listening");
          void handleClick();
        }}
        className={cn(
          "!h-8 !w-8 !p-0 relative transition-all duration-200",
          isRecording
            ? "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 hover:text-yellow-300"
            : isProcessing
              ? isMacro
                ? "text-yellow-400 bg-yellow-500/10"
                : "text-blue-400 bg-blue-500/10"
              : isMacro
                ? "text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 hover:text-yellow-300"
                : "text-muted-foreground/60 hover:text-blue-400 hover:bg-blue-500/10",
        )}
      >
        {isProcessing ? (
          <Loader2 className={cn("h-3.5 w-3.5 animate-spin", isMacro && "text-yellow-400")} />
        ) : isRecording ? (
          <>
            <MicOff className="h-3.5 w-3.5" />
            <span className="absolute inset-0 rounded-md animate-ping bg-yellow-400/20 pointer-events-none" />
          </>
        ) : (
          <>
            <Mic className="h-3.5 w-3.5" />
            {isMacro && (
              <span className="absolute inset-0 rounded-md animate-pulse bg-yellow-400/15 pointer-events-none" />
            )}
          </>
        )}
      </Button>
    </div>
  );
}
