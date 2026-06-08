import { useRef, useState, useCallback } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useBuilderStore } from "@/lib/builder/store";
import type { NodeKind } from "@/lib/builder/types";
import { cn } from "@/lib/utils";

type CopilotState = "idle" | "recording" | "processing";

interface VoiceCommand {
  action: string;
  type?: string;
  label?: string;
  dialogue?: string;
  _ref?: string;
  nodeId?: string;
  from?: string;
  to?: string;
  agentName?: string;
  globalPrompt?: string;
  [key: string]: unknown;
}

function executeVoiceCommands(commands: VoiceCommand[]) {
  const store = useBuilderStore.getState();
  const idMap: Record<string, string> = {};
  let createdCount = 0;
  let connectedCount = 0;
  let updatedCount = 0;

  for (const cmd of commands) {
    if (cmd.action === "CREATE_NODE") {
      const kind = cmd.type as NodeKind;
      const nodesBefore = store.nodes.map((n) => n.id);
      store.addNode(kind);
      const newNode = useBuilderStore
        .getState()
        .nodes.find((n) => !nodesBefore.includes(n.id));
      if (newNode) {
        if (cmd._ref) idMap[cmd._ref] = newNode.id;
        const patch: Record<string, unknown> = {};
        if (cmd.label) patch.label = cmd.label;
        if (cmd.dialogue) patch.dialogue = cmd.dialogue;
        if (Object.keys(patch).length) {
          useBuilderStore.getState().updateNode(newNode.id, patch);
        }
        createdCount++;
      }
    } else if (cmd.action === "CONNECT_NODES") {
      const fromId = (cmd.from && idMap[cmd.from]) ? idMap[cmd.from] : cmd.from;
      const toId = (cmd.to && idMap[cmd.to]) ? idMap[cmd.to] : cmd.to;
      if (fromId && toId) {
        useBuilderStore.getState().onConnect({
          source: fromId,
          target: toId,
          sourceHandle: null,
          targetHandle: null,
        });
        connectedCount++;
      }
    } else if (cmd.action === "UPDATE_NODE") {
      const nodeId = (cmd.nodeId && idMap[cmd.nodeId]) ? idMap[cmd.nodeId] : cmd.nodeId;
      if (nodeId) {
        const patch: Record<string, unknown> = {};
        if (cmd.label) patch.label = cmd.label;
        if (cmd.dialogue) patch.dialogue = cmd.dialogue;
        if (Object.keys(patch).length) {
          useBuilderStore.getState().updateNode(nodeId, patch);
          updatedCount++;
        }
      }
    } else if (cmd.action === "UPDATE_SETTINGS") {
      const { action: _a, ...rest } = cmd;
      const settingPatch: Record<string, unknown> = {};
      if (rest.agentName) settingPatch.agentName = rest.agentName;
      if (rest.globalPrompt) settingPatch.globalPrompt = rest.globalPrompt;
      if (Object.keys(settingPatch).length) {
        useBuilderStore.getState().setSettings(settingPatch);
        updatedCount++;
      }
    }
  }

  return { createdCount, connectedCount, updatedCount };
}

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
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
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
        toast.info(`"${data.transcript}" — no builder commands detected. Try describing nodes to add or connections to make.`);
        return;
      }

      const { createdCount, connectedCount, updatedCount } = executeVoiceCommands(data.commands);

      const parts: string[] = [];
      if (createdCount > 0) parts.push(`${createdCount} node${createdCount > 1 ? "s" : ""} added`);
      if (connectedCount > 0) parts.push(`${connectedCount} connection${connectedCount > 1 ? "s" : ""} made`);
      if (updatedCount > 0) parts.push(`${updatedCount} update${updatedCount > 1 ? "s" : ""} applied`);

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
        const blob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm",
        });
        void processAudio(blob);
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
      title={isRecording ? "Stop recording" : isProcessing ? "Processing…" : "Voice Command Copilot"}
      disabled={isProcessing}
      onClick={() => {
        if (isRecording) {
          toast.dismiss("voice-listening");
        }
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
