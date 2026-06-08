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
  // CONNECT_NODES
  from?: string;
  to?: string;
  via_transition?: string;
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
// Fuzzy node finder — exact ID → exact label → includes → Levenshtein
// ─────────────────────────────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findNode(nameOrRef: string, idMap: Record<string, string>) {
  const store = useBuilderStore.getState();
  const nodes = store.nodes;

  // 1. _ref from current batch
  const mappedId = idMap[nameOrRef];
  if (mappedId) {
    const n = nodes.find((n) => n.id === mappedId);
    if (n) return n;
  }

  // 2. Exact node ID
  const byId = nodes.find((n) => n.id === nameOrRef);
  if (byId) return byId;

  const lower = nameOrRef.toLowerCase().trim();

  // 3. Exact label (case-insensitive)
  const exact = nodes.find((n) => n.data.label.toLowerCase() === lower);
  if (exact) return exact;

  // 4. Label includes query (or query includes label)
  const includes = nodes.find(
    (n) =>
      n.data.label.toLowerCase().includes(lower) ||
      lower.includes(n.data.label.toLowerCase()),
  );
  if (includes) return includes;

  // 5. Levenshtein fuzzy — accept if distance ≤ max(3, 40% of query length)
  let best: (typeof nodes)[0] | undefined;
  let bestDist = Infinity;
  for (const n of nodes) {
    const dist = levenshtein(n.data.label.toLowerCase(), lower);
    if (dist < bestDist) {
      bestDist = dist;
      best = n;
    }
  }
  const threshold = Math.max(3, Math.floor(lower.length * 0.4));
  if (best && bestDist <= threshold) return best;

  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map node-type-specific voice properties → FlowNodeData field names
// ─────────────────────────────────────────────────────────────────────────────
function mapProperties(props: Record<string, string>): Partial<FlowNodeData> {
  const patch: Partial<FlowNodeData> = {};
  if (props.title) patch.label = props.title;
  if (props.text) patch.dialogue = props.text;
  if (props.phone_number) patch.transferNumber = props.phone_number;
  if (props.sms_body) patch.smsMessage = props.sms_body;
  if (props.variable_name) patch.variableName = props.variable_name;
  if (props.function_name) patch.toolName = props.function_name;
  if (props.code_snippet) patch.codeSource = props.code_snippet;
  return patch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command executor
// ─────────────────────────────────────────────────────────────────────────────
function executeVoiceCommands(commands: VoiceCommand[]) {
  const idMap: Record<string, string> = {};
  let createdCount = 0;
  let connectedCount = 0;
  let updatedCount = 0;
  let settingsCount = 0;
  const warnings: string[] = [];

  for (const cmd of commands) {
    // ── CREATE_NODE ──────────────────────────────────────────────────────────
    if (cmd.action === "CREATE_NODE") {
      const kind = cmd.type as NodeKind;
      const nodesBefore = useBuilderStore.getState().nodes.map((n) => n.id);
      useBuilderStore.getState().addNode(kind);
      const newNode = useBuilderStore
        .getState()
        .nodes.find((n) => !nodesBefore.includes(n.id));

      if (newNode) {
        if (cmd._ref) idMap[cmd._ref] = newNode.id;

        const patch: Partial<FlowNodeData> = {};
        if (cmd.label) patch.label = cmd.label;
        if (cmd.dialogue) patch.dialogue = cmd.dialogue;
        if (cmd.properties) Object.assign(patch, mapProperties(cmd.properties));

        if (Object.keys(patch).length) {
          useBuilderStore.getState().updateNode(newNode.id, patch);
        }
        createdCount++;
      }

    // ── CONNECT_NODES ────────────────────────────────────────────────────────
    } else if (cmd.action === "CONNECT_NODES") {
      const fromNode = cmd.from ? findNode(cmd.from, idMap) : undefined;
      const toNode = cmd.to ? findNode(cmd.to, idMap) : undefined;

      if (!fromNode || !toNode) {
        warnings.push(
          `Could not find node(s) to connect: "${cmd.from ?? "?"}" → "${cmd.to ?? "?"}"`,
        );
        continue;
      }

      // Find the matching transition handle if via_transition is given
      let sourceHandle: string | null = null;
      if (cmd.via_transition) {
        const viaLower = cmd.via_transition.toLowerCase();
        const matchingTransition = fromNode.data.transitions?.find(
          (t) =>
            t.condition.toLowerCase() === viaLower ||
            t.condition.toLowerCase().includes(viaLower) ||
            viaLower.includes(t.condition.toLowerCase()),
        );
        if (matchingTransition) sourceHandle = matchingTransition.id;
      }

      useBuilderStore.getState().onConnect({
        source: fromNode.id,
        target: toNode.id,
        sourceHandle,
        targetHandle: null,
      });
      connectedCount++;

    // ── UPDATE_NODE_PROPERTIES ───────────────────────────────────────────────
    } else if (cmd.action === "UPDATE_NODE_PROPERTIES") {
      const target = cmd.node ? findNode(cmd.node, idMap) : undefined;
      if (!target) {
        warnings.push(`Could not find node to update: "${cmd.node ?? "?"}"`);
        continue;
      }

      const patch: Partial<FlowNodeData> = {};
      if (cmd.properties) Object.assign(patch, mapProperties(cmd.properties));
      // Also accept top-level label/dialogue for convenience
      if (cmd.label) patch.label = cmd.label;
      if (cmd.dialogue) patch.dialogue = cmd.dialogue;

      if (Object.keys(patch).length) {
        useBuilderStore.getState().updateNode(target.id, patch);
        updatedCount++;
      }

    // ── CREATE_TRANSITIONS ───────────────────────────────────────────────────
    } else if (cmd.action === "CREATE_TRANSITIONS") {
      const target = cmd.node ? findNode(cmd.node, idMap) : undefined;
      if (!target) {
        warnings.push(`Could not find node for transitions: "${cmd.node ?? "?"}"`);
        continue;
      }

      const newTransitions = (cmd.transitions ?? []).map((label) => ({
        id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        condition: label,
        target: null,
      }));

      if (newTransitions.length) {
        const existing = target.data.transitions ?? [];
        useBuilderStore.getState().updateNode(target.id, {
          transitions: [...existing, ...newTransitions],
        });
        updatedCount++;
      }

    // ── UPDATE_GLOBAL_SETTINGS ───────────────────────────────────────────────
    } else if (cmd.action === "UPDATE_GLOBAL_SETTINGS") {
      const patch: Record<string, unknown> = {};
      if (cmd.agentName) patch.agentName = cmd.agentName;
      if (cmd.globalPrompt) patch.globalPrompt = cmd.globalPrompt;
      if (cmd.language) patch.language = cmd.language;
      if (cmd.voiceId) patch.voiceId = cmd.voiceId;
      if (cmd.model) patch.model = cmd.model;

      if (Object.keys(patch).length) {
        useBuilderStore.getState().setSettings(patch);
        settingsCount++;
      }
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
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const processAudio = useCallback(async (blob: Blob) => {
    setState("processing");
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const res = await fetch("/api/voice-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, mimeType: blob.type || "audio/webm" }),
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

      if (data.commands.length === 0) {
        toast.info(
          `"${data.transcript}" — no builder commands detected. Try describing nodes to add, connections to make, or settings to change.`,
        );
        return;
      }

      const { createdCount, connectedCount, updatedCount, settingsCount, warnings } =
        executeVoiceCommands(data.commands);

      // Show any fuzzy-match failures as a gentle warning
      if (warnings.length) {
        warnings.forEach((w) => toast.warning(w, { duration: 6000 }));
      }

      const parts: string[] = [];
      if (createdCount > 0) parts.push(`${createdCount} node${createdCount > 1 ? "s" : ""} added`);
      if (connectedCount > 0)
        parts.push(`${connectedCount} connection${connectedCount > 1 ? "s" : ""} made`);
      if (updatedCount > 0)
        parts.push(`${updatedCount} update${updatedCount > 1 ? "s" : ""} applied`);
      if (settingsCount > 0) parts.push("settings updated");

      toast.success(
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wide">
            Voice command detected
          </span>
          <span className="text-sm">"{data.transcript}"</span>
          {parts.length > 0 && (
            <span className="text-[11px] text-muted-foreground mt-0.5">{parts.join(" · ")}</span>
          )}
        </div>,
        { duration: 5000 },
      );
    } catch (err) {
      console.error("[VoiceCopilot] Error:", err);
      toast.error("Could not understand layout instruction. Please try again.");
    } finally {
      setState("idle");
    }
  }, []);

  const handleClick = useCallback(async () => {
    if (state === "recording") {
      stopRecording();
      return;
    }
    if (state === "processing") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        void processAudio(new Blob(chunksRef.current, { type: mimeType || "audio/webm" }));
      };

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

  const isRecording = state === "recording";
  const isProcessing = state === "processing";

  return (
    <Button
      size="sm"
      variant="ghost"
      title={
        isRecording ? "Stop recording" : isProcessing ? "Processing…" : "Voice Command Copilot"
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
