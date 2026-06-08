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
  [key: string]: unknown;
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
  let createdCount = 0, connectedCount = 0, updatedCount = 0, settingsCount = 0;
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
      const nodesBefore = useBuilderStore.getState().nodes.map((n) => n.id);
      useBuilderStore.getState().addNode(cmd.type as NodeKind);
      const newNode = useBuilderStore.getState().nodes.find((n) => !nodesBefore.includes(n.id));
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

    // UPDATE_GLOBAL_SETTINGS ──────────────────────────────────────────────────
    } else if (cmd.action === "UPDATE_GLOBAL_SETTINGS") {
      const patch: Record<string, unknown> = {};
      if (cmd.agentName)    patch.agentName    = cmd.agentName;
      if (cmd.globalPrompt) patch.globalPrompt = cmd.globalPrompt;
      if (cmd.language)     patch.language     = cmd.language;
      if (cmd.voiceId)      patch.voiceId      = cmd.voiceId;
      if (cmd.model)        patch.model        = cmd.model;
      if (Object.keys(patch).length) { useBuilderStore.getState().setSettings(patch); settingsCount++; }
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

      // Try to match an existing transition by via_transition label
      if (cmd.via_transition) {
        const viaLower = cmd.via_transition.toLowerCase();
        const liveNode = useBuilderStore.getState().nodes.find((n) => n.id === fromNode.id);
        const match = liveNode?.data.transitions?.find(
          (t) =>
            t.condition.toLowerCase() === viaLower ||
            t.condition.toLowerCase().includes(viaLower),
        );
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

  return { createdCount, connectedCount, updatedCount, settingsCount, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function VoiceCopilotButton() {
  const [state, setState] = useState<CopilotState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef        = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);

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

      // Snapshot current canvas nodes so GPT knows what exists
      const canvasNodes = useBuilderStore.getState().nodes.map((n) => ({
        id: n.id,
        label: n.data.label,
        kind: n.data.kind,
      }));

      const res = await fetch("/api/voice-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: base64,
          mimeType: blob.type || "audio/webm",
          canvasNodes,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        transcript?: string;
        commands?: VoiceCommand[];
        error?: string;
      };

      if (!data.ok || !data.commands) {
        toast.error(data.error ?? "Voice copilot failed. Please try again.");
        return;
      }

      // Always show what was heard first, before executing
      if (data.transcript) {
        toast.info(
          <span className="text-sm">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium block mb-0.5">
              Heard
            </span>
            "{data.transcript}"
          </span>,
          { duration: 4000, id: "voice-transcript" },
        );
      }

      if (data.commands.length === 0) {
        toast.warning(
          "No builder commands detected — try describing nodes to add, connections to make, or settings to change.",
          { duration: 5000 },
        );
        return;
      }

      const { createdCount, connectedCount, updatedCount, settingsCount, warnings } =
        await executeVoiceCommands(data.commands);

      warnings.forEach((w) => toast.warning(w, { duration: 6000 }));

      const parts: string[] = [];
      if (createdCount)  parts.push(`${createdCount} node${createdCount > 1 ? "s" : ""} added`);
      if (connectedCount) parts.push(`${connectedCount} connection${connectedCount > 1 ? "s" : ""} made`);
      if (updatedCount)  parts.push(`${updatedCount} update${updatedCount > 1 ? "s" : ""} applied`);
      if (settingsCount) parts.push("settings updated");

      if (parts.length) {
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

      toast.info("Listening… click the mic again to stop.", {
        id: "voice-listening",
        duration: 30000,
      });
    } catch (err) {
      console.error("[VoiceCopilot] Mic access error:", err);
      toast.error("Microphone access denied. Please allow mic access and try again.");
    }
  }, [state, stopRecording, processAudio]);

  const isRecording  = state === "recording";
  const isProcessing = state === "processing";

  return (
    <Button
      size="sm"
      variant="ghost"
      title={isRecording ? "Stop recording" : isProcessing ? "Processing…" : "Voice Command Copilot"}
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
            ? "text-blue-400 bg-blue-500/10"
            : "text-muted-foreground/60 hover:text-blue-400 hover:bg-blue-500/10",
      )}
    >
      {isProcessing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isRecording ? (
        <>
          <MicOff className="h-3.5 w-3.5" />
          <span className="absolute inset-0 rounded-md animate-ping bg-yellow-400/20 pointer-events-none" />
        </>
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
