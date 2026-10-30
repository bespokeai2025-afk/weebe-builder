import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
// Type only — the SDK (and the ~1 MB LiveKit client inside it) loads when a call starts.
import type { RetellWebClient } from "retell-client-js-sdk";
import { Phone, PhoneOff, Loader2, RefreshCw, DollarSign, Plus, Download, Zap, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useBuilderStore } from "@/lib/builder/store";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { resolveDeploymentMode } from "@/lib/runtime/adapter";
import { buildAgentRuntimeDefinition } from "@/lib/runtime/export";
import { extractOpenAIParams } from "@/lib/runtime/import";
import type { OpenAIExecutionParams } from "@/lib/runtime/import";
import { buildOpenAIToolDefinitions, executeToolCall } from "@/lib/runtime/tool-executor";
import { buildHyperStreamBookingTools } from "@/lib/calendar/hyperstream-booking-tools";
import type { AgentRuntimeDefinition } from "@/lib/runtime/schema";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import {
  deployAgentToRetell,
  createRetellWebCall,
  fetchRetellAgent,
  deployElevenLabsAgent,
  getElevenLabsSignedUrl,
} from "@/lib/builder/retell.functions";
import {
  listMyAgents,
  upsertMyAgent,
  getMyAgentByRetellId,
} from "@/lib/agents/agents.functions";
import { getMySpend, recordTestCallCost } from "@/lib/auth/auth.functions";
import {
  getBuildProvenanceForAgent,
  markBuildVersionDeployed,
} from "@/lib/systemmind/build-workspace.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTotalCostPerMinute, getHyperStreamCostPerMinute, calcHyperStreamTurnCost, HYPERSTREAM_TELEPHONY_PER_MIN, ELEVENLABS_PER_MIN, WEBEE_NATIVE_PER_MIN } from "@/lib/builder/pricing";
import { validateFlow } from "@/lib/builder/validate";
import { nativeEngineIssues } from "@/lib/builder/engine-parity";
import { resolveWebeeSpeechModel } from "@/lib/voice/webee-native.shared";
import { AudioPlaybackController } from "@/lib/voice/browser/audio-playback-controller.shared";
import { cn } from "@/lib/utils";
import { TestCallPrepDialog, type TestCallPrepResult } from "./TestCallPrepDialog";
import type { TestCallSession } from "./deploy/test-call-session";
import { runRetellTestCall } from "./deploy/retell-test-call";
import { runHyperStreamTestCall } from "./deploy/hyperstream-test-call";
import { runCascadeVoiceTestCall } from "./deploy/cascade-voice-test-call";
import { runVoxStreamTestCall } from "./deploy/voxstream-test-call";

export type TxEntry = { id: string; role: "user" | "agent"; text: string; partial: boolean };

export type CallEndMeta = {
  costUsd?: number;
  endReason?: string;
  sessionId?: string;
  channelType?: string;
};

export function RetellDeployDialog({
  onCallActive,
  onTranscriptUpdate,
  onCallEnd,
  onLatencyUpdate,
}: {
  onCallActive?: (active: boolean) => void;
  onTranscriptUpdate?: (entries: TxEntry[]) => void;
  onCallEnd?: (transcript: TxEntry[], recordingBlob: Blob | null, meta?: CallEndMeta) => void;
  /** Speech-to-first-audio ms for the turn that just started speaking — same number Retell's own test-call widget shows live. */
  onLatencyUpdate?: (ms: number) => void;
} = {}) {
  const {
    nodes,
    edges,
    settings,
    variables,

    setSettings,
    setActiveNode,
    selectNode,
    addTestCallSeconds,
    loadFlow,
    pushDebugEvent,
    clearDebugEvents,
  } = useBuilderStore();
  const emitDebug = (
    type: string,
    message: string,
    extra?: { nodeId?: string; detail?: Record<string, unknown> },
  ) => {
    pushDebugEvent({ type, message, nodeId: extra?.nodeId, detail: extra?.detail });
  };
  const currentAgentRowId = useBuilderStore((s) => s.currentAgentRowId);
  const setCurrentAgentRowId = useBuilderStore((s) => s.setCurrentAgentRowId);
  const bumpSaveVersion = useBuilderStore((s) => s.bumpSaveVersion);

  const [deploying, setDeploying] = useState<"create" | "update" | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const [openaiConfirmOpen, setOpenaiConfirmOpen] = useState(false);
  const [openaiDeploying, setOpenaiDeploying] = useState(false);
  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
  // Exact token-based USD cost accumulated from response.done events during a
  // HyperStream call. null = no call active / no response.done received yet.
  const [hsExactCostUsd, setHsExactCostUsd] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  // Live transcript — built incrementally during a call from WS / SDK events.
  // Each entry is either partial (streaming) or done.
  const [transcript, setTranscript] = useState<TxEntry[]>([]);
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadId, setLoadId] = useState("");
  const [loading, setLoading] = useState(false);
  const [testPrepOpen, setTestPrepOpen] = useState(false);
  const testCallPrepRef = useRef<TestCallPrepResult>({ variables: {}, startSpeaker: "agent" });
  const clientRef = useRef<RetellWebClient | null>(null);
  const wsRelayRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const captureSinkRef = useRef<GainNode | null>(null);
  const keepAliveRef = useRef<OscillatorNode | null>(null);
  const wsPingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef(0);
  // All AudioBufferSourceNodes scheduled for the current response.
  // Cleared and stopped whenever a new response starts or the call ends,
  // so old audio never plays over new audio (talking-over-itself / jitter fix).
  const activeSourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const elPlaybackRef = useRef<AudioPlaybackController | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const recordedCallRef = useRef(false);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  // ── Recording refs ────────────────────────────────────────────────────────
  // masterGainRef: shared GainNode that routes AI audio to both speakers + recorder
  const masterGainRef = useRef<GainNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  // transcriptRef: always-current transcript so onCallEnd closures read the latest
  const transcriptRef = useRef<TxEntry[]>([]);
  // Guard: prevents onCallEnd from firing twice (endCall + ws.onclose both trigger cleanup)
  const callEndFiredRef = useRef(false);
  // Metadata captured at call-end time and forwarded to onCallEnd.
  const endReasonRef = useRef<string | undefined>(undefined);
  const hsSessionIdRef = useRef<string | undefined>(undefined);
  const callCostUsdRef = useRef<number | undefined>(undefined);
  const channelTypeRef = useRef<string | undefined>(undefined);

  // Always-current ref so WS message handlers can call onTranscriptUpdate / onCallEnd
  // without capturing a stale closure (avoids render → useEffect round-trip).
  const onTranscriptUpdateRef = useRef(onTranscriptUpdate);
  onTranscriptUpdateRef.current = onTranscriptUpdate;
  const onCallEndRef = useRef(onCallEnd);
  onCallEndRef.current = onCallEnd;
  const onLatencyUpdateRef = useRef(onLatencyUpdate);
  onLatencyUpdateRef.current = onLatencyUpdate;

  /** Drop-in replacement for setTranscript that also propagates to parent instantly. */
  function pushTranscript(updater: TxEntry[] | ((prev: TxEntry[]) => TxEntry[])) {
    // Compute the next value using the always-current transcriptRef so we can
    // call onTranscriptUpdateRef OUTSIDE the state updater — calling another
    // component's setState from inside a state updater triggers React's
    // "Cannot update a component while rendering" warning.
    const next = typeof updater === "function" ? updater(transcriptRef.current) : updater;
    transcriptRef.current = next;
    setTranscript(next);
    onTranscriptUpdateRef.current?.(next);
  }

  /**
   * Stop the MediaRecorder (if running), collect the chunks into a Blob, and
   * fire onCallEnd exactly once per call.  Safe to call from multiple cleanup
   * paths (ws.onclose AND endCall) — the callEndFiredRef guard prevents double-fire.
   */
  function finalizeRecording() {
    if (callEndFiredRef.current) return;
    callEndFiredRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    masterGainRef.current?.disconnect();
    masterGainRef.current = null;
    const meta: CallEndMeta = {
      costUsd: callCostUsdRef.current,
      endReason: endReasonRef.current,
      sessionId: hsSessionIdRef.current,
      channelType: channelTypeRef.current,
    };
    if (!recorder || recorder.state === "inactive") {
      onCallEndRef.current?.(transcriptRef.current, null, meta);
      return;
    }
    recorder.onstop = () => {
      const blob =
        recChunksRef.current.length > 0
          ? new Blob(recChunksRef.current, { type: recorder.mimeType || "audio/webm" })
          : null;
      recChunksRef.current = [];
      onCallEndRef.current?.(transcriptRef.current, blob, meta);
    };
    try { recorder.stop(); } catch { /* already inactive */ }
  }

  const deploy = useServerFn(deployAgentToRetell);
  const startCall = useServerFn(createRetellWebCall);
  const fetchAgent = useServerFn(fetchRetellAgent);
  const deployElevenLabs = useServerFn(deployElevenLabsAgent);
  const getElSignedUrl = useServerFn(getElevenLabsSignedUrl);
  const listAgents = useServerFn(listMyAgents);
  const upsertAgent = useServerFn(upsertMyAgent);
  const getAgentByRetellId = useServerFn(getMyAgentByRetellId);
  const fetchSpend = useServerFn(getMySpend);
  const recordCost = useServerFn(recordTestCallCost);
  const getBuildProvenanceFn = useServerFn(getBuildProvenanceForAgent);
  const markBuildDeployedFn = useServerFn(markBuildVersionDeployed);
  // Core Runtime — buildAgentRuntimeDefinition is a pure function called
  // directly from the builder store.  No DB round-trip needed for test calls.
  const qc = useQueryClient();
  const navigate = useNavigate();

  // ── SystemMind Build Workspace provenance ────────────────────────────────
  // If this agent was built/edited via the Build Workspace, surface a link
  // back to the session and mark the applied version "deployed" after a
  // successful deploy from here.
  const buildProvenanceQ = useQuery({
    queryKey: ["smbw-provenance", currentAgentRowId],
    queryFn: () => getBuildProvenanceFn({ data: { agentId: currentAgentRowId as string } }),
    enabled: Boolean(currentAgentRowId),
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const buildProvenance = buildProvenanceQ.data ?? null;

  async function notifyBuildDeployed(deployTarget: string) {
    // Best-effort: never let provenance bookkeeping break a deploy.
    try {
      const rowId = useBuilderStore.getState().currentAgentRowId;
      if (!rowId) return;
      const prov = buildProvenance?.session_id
        ? buildProvenance
        : await getBuildProvenanceFn({ data: { agentId: rowId } });
      if (!prov || prov.status !== "applied") return;
      await markBuildDeployedFn({
        data: {
          sessionId: prov.session_id as string,
          versionId: prov.id as string,
          deployTarget,
        },
      });
      qc.invalidateQueries({ queryKey: ["smbw-provenance", rowId] });
      qc.invalidateQueries({ queryKey: ["smbw-session", prov.session_id] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
    } catch (e) {
      console.warn("[build-workspace] mark-deployed skipped:", (e as Error).message);
    }
  }

  const spendQ = useQuery({
    queryKey: ["my-spend"],
    queryFn: () => fetchSpend(),
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const spendLimitCents = spendQ.data?.spendLimitCents ?? 500;
  const spendUsedCents = spendQ.data?.spendUsedCents ?? 0;
  const overLimit = spendUsedCents >= spendLimitCents;

  const agentsQ = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => listAgents(),
    enabled: loadOpen,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const deploymentMode = resolveDeploymentMode(settings);
  const isOpenAI = deploymentMode === "OPENAI_NATIVE";
  const isElevenLabs = deploymentMode === "ELEVENLABS_NATIVE";
  const isWebeeNative = deploymentMode === "WEBEE_NATIVE";
  // For VoxStream agents, agentId is set to the EL agent ID on deploy (no Retell ID).
  // WEBEE Native agents are provisioned nowhere: the local row *is* the agent, so
  // the saved row id is the only thing a call needs.
  const hasAgent = isElevenLabs
    ? Boolean(settings.deployedElevenLabsAgentId)
    : isWebeeNative
      ? Boolean(currentAgentRowId ?? settings.agentId)
      : Boolean(settings.agentId);

  const flowIssues = useMemo(
    () => [
      ...validateFlow(nodes, edges, variables, { phoneCountryCode: settings.phoneCountryCode }),
      // What WEBEE Native would drop or ignore in this flow (empty on other engines).
      ...nativeEngineIssues(nodes, edges, settings, variables),
    ],
    [nodes, edges, variables, settings],
  );
  const flowErrors = flowIssues.filter((i) => i.level === "error");
  const flowWarnings = flowIssues.filter((i) => i.level === "warn");

  useEffect(() => {
    return () => {
      clientRef.current?.stopCall();
      clientRef.current = null;
      wsRelayRef.current?.close();
      wsRelayRef.current = null;
      processorRef.current?.disconnect();
      processorRef.current = null;
      workletRef.current?.disconnect();
      workletRef.current = null;
      captureSinkRef.current?.disconnect();
      captureSinkRef.current = null;
      keepAliveRef.current?.stop();
      keepAliveRef.current = null;
      if (wsPingRef.current !== null) { clearInterval(wsPingRef.current); wsPingRef.current = null; }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      setActiveNode(null);
    };
  }, [setActiveNode]);

  // Auto-scroll transcript to bottom whenever a new entry arrives.
  // onTranscriptUpdate is now called directly inside pushTranscript, so we
  // only need the scroll side-effect here.
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [transcript]);

  // Notify parent while connecting or in-call; tick elapsed time once live.
  useEffect(() => {
    onCallActive?.(inCall || calling);
  }, [inCall, calling]);

  useEffect(() => {
    if (!inCall) return;
    const t = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 500);
    return () => clearInterval(t);
  }, [inCall]);

  async function handleOpenAIRealtimeDeploy() {
    setOpenaiDeploying(true);
    try {
      const { nodes: n, edges: e, settings: s, variables: v } = useBuilderStore.getState();
      // History snapshots ride along in settings; keep them compressed (HTTP 413 otherwise).
      await useBuilderStore.getState().compactHistory();
      const result = await upsertAgent({
        data: {
          id: currentAgentRowId ?? undefined,
          retellAgentId: null,
          name: s.agentName || "Untitled agent",
          flowData: { nodes: n, edges: e } as never,
          settings: s as never,
          variables: v as never,
        },
      });
      // Always update the row ID pointer and stamp agentId into settings so
      // hasAgent becomes true and the test-call button enables.
      setCurrentAgentRowId(result.id);
      setSettings({ agentId: result.id, deployedAgentName: s.agentName });
      bumpSaveVersion();
      setOpenaiConfirmOpen(false);
      toast.success("Enterprise Line agent saved", {
        description: `Schema compiled with voice "${s.openaiVoice ?? "alloy"}" · reasoning "${s.openaiReasoningEffort ?? "low"}".`,
      });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setOpenaiDeploying(false);
    }
  }

  async function handleDeploy(kind: "create" | "update") {
    // Block deploy if flow has validation errors.
    const { nodes: n, edges: e, variables: v, settings: st } = useBuilderStore.getState();
    const errs = validateFlow(n, e, v, { phoneCountryCode: st.phoneCountryCode }).filter(
      (i) => i.level === "error",
    );
    if (errs.length > 0) {
      setCheckOpen(true);
      toast.error(`Fix ${errs.length} error${errs.length !== 1 ? "s" : ""} before deploying`, {
        description: errs[0].message,
      });
      return;
    }

    // OpenAI Realtime agents skip Retell provisioning entirely — show the
    // Enterprise Line confirmation dialog and save schema locally only.
    if (settings.voiceProvider === "OPENAI_REALTIME") {
      setOpenaiConfirmOpen(true);
      return;
    }

    // If the agent name changed since last deploy, always create a new agent
    // regardless of whether the user clicked + or ↺.
    const nameChanged = Boolean(
      settings.agentId &&
      settings.deployedAgentName !== undefined &&
      settings.agentName !== settings.deployedAgentName,
    );

    // If the user clicks "Create" but an agent already exists in the builder,
    // update it instead of spawning a duplicate — unless the name changed.
    const effectiveKind: "create" | "update" = nameChanged
      ? "create"
      : kind === "create" && settings.agentId
        ? "update"
        : kind;
    setDeploying(effectiveKind);

    // ── HyperStream Engine guard ────────────────────────────────────────────
    // When voice_provider === "OPENAI_REALTIME" we skip ALL outbound Retell
    // API calls and write directly to our local database instead.
    if (isOpenAI) {
      try {
        const { nodes: n, edges: e, settings: s, variables: v } =
          useBuilderStore.getState();
        // Reuse existing local ID if already saved; otherwise generate one.
        const existingLocalId =
          s.agentId && !String(s.agentId).startsWith("agent_")
            ? (s.agentId as string)
            : undefined;
        const localId =
          existingLocalId ??
          `hs_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const updatedSettings = {
          ...s,
          agentId: localId,
          deployedAgentName: s.agentName,
        };
        setSettings({ agentId: localId, deployedAgentName: s.agentName });
        // History snapshots ride along in settings; keep them compressed (HTTP 413 otherwise).
        await useBuilderStore.getState().compactHistory();
        const { id: rowId } = await upsertAgent({
          data: {
            id: useBuilderStore.getState().currentAgentRowId ?? undefined,
            retellAgentId: null,
            name: s.agentName || "Untitled agent",
            flowData: { nodes: n, edges: e } as never,
            settings: updatedSettings as never,
            variables: v as never,
          },
        });
        useBuilderStore.getState().setCurrentAgentRowId(rowId);
        bumpSaveVersion();
        qc.invalidateQueries({ queryKey: ["my-agents"] });
        toast.success(
          effectiveKind === "update"
            ? "HyperStream agent updated"
            : "HyperStream agent saved",
          { description: "Saved locally — routed via Master Admin Enterprise Line" },
        );
        await notifyBuildDeployed("hyperstream");
      } catch (e) {
        toast.error("Save failed", { description: (e as Error).message });
      } finally {
        setDeploying(null);
      }
      return;
    }
    // ── End HyperStream guard ───────────────────────────────────────────────

    // ── WEBEE Native guard ──────────────────────────────────────────────────
    // Nothing is provisioned with a third party: the flow graph is executed by
    // our own gateway straight from this row, so "deploy" is a save. The row id
    // doubles as the agent id the webhook processor resolves calls against.
    if (isWebeeNative) {
      try {
        const { nodes: n, edges: e, settings: s, variables: v } =
          useBuilderStore.getState();
        // History snapshots ride along in settings; keep them compressed (HTTP 413 otherwise).
        await useBuilderStore.getState().compactHistory();
        const { id: rowId } = await upsertAgent({
          data: {
            id: useBuilderStore.getState().currentAgentRowId ?? undefined,
            retellAgentId: null,
            name: s.agentName || "Untitled agent",
            flowData: { nodes: n, edges: e } as never,
            settings: { ...s, deployedAgentName: s.agentName } as never,
            variables: v as never,
          },
        });
        useBuilderStore.getState().setCurrentAgentRowId(rowId);
        setSettings({ agentId: rowId, deployedAgentName: s.agentName });
        bumpSaveVersion();
        qc.invalidateQueries({ queryKey: ["my-agents"] });
        toast.success(
          effectiveKind === "update" ? "WEBEE Native agent updated" : "WEBEE Native agent saved",
          {
            description: s.webeeVoiceName
              ? `Flow runs in-house · voice "${s.webeeVoiceName}"`
              : "Flow runs in-house — pick a WEBEE Native voice to set the agent's voice.",
          },
        );
        await notifyBuildDeployed("webee_native");
      } catch (e) {
        toast.error("Save failed", { description: (e as Error).message });
      } finally {
        setDeploying(null);
      }
      return;
    }
    // ── End WEBEE Native guard ──────────────────────────────────────────────

    // ── VoxStream Engine guard ───────────────────────────────────────────────
    // ElevenLabs Conversational AI agents deploy directly to EL — no Retell.
    if (isElevenLabs) {
      try {
        const { nodes: n, edges: e, settings: s, variables: v } =
          useBuilderStore.getState();
        const existingElAgentId =
          effectiveKind === "update"
            ? ((s.deployedElevenLabsAgentId as string | undefined) ?? null)
            : null;
        const runtimeDef = buildAgentRuntimeDefinition({
          agentId: useBuilderStore.getState().currentAgentRowId ?? "local-vox",
          retellAgentId: null,
          agentName: s.agentName || "Untitled agent",
          updatedAt: new Date().toISOString(),
          nodes: n,
          edges: e,
          settings: s,
          variables: v,
        });
        const webhookBase =
          typeof window !== "undefined" ? window.location.origin : "";
        const result = await deployElevenLabs({
          data: {
            agentId: existingElAgentId,
            agentName: s.agentName || "Untitled agent",
            systemPrompt: runtimeDef.compiledPrompt,
            firstMessage: (s.beginMessage as string | undefined) || "",
            voiceId: (s.elevenLabsVoiceId as string | undefined) || "",
            language: ((s.language as string | undefined) || "en-US").slice(0, 2),
            webhookUrl: `${webhookBase}/api/public/elevenlabs-webhook`,
            tools: runtimeDef.tools,
          },
        });
        const updatedSettings = {
          ...s,
          deployedElevenLabsAgentId: result.agentId,
          deployedAgentName: s.agentName,
        };
        setSettings({
          deployedElevenLabsAgentId: result.agentId as never,
          deployedAgentName: s.agentName,
        });
        // History snapshots ride along in settings; keep them compressed (HTTP 413 otherwise).
        await useBuilderStore.getState().compactHistory();
        const { id: rowId } = await upsertAgent({
          data: {
            id: useBuilderStore.getState().currentAgentRowId ?? undefined,
            retellAgentId: null,
            name: s.agentName || "Untitled agent",
            flowData: { nodes: n, edges: e } as never,
            settings: updatedSettings as never,
            variables: v as never,
          },
        });
        useBuilderStore.getState().setCurrentAgentRowId(rowId);
        bumpSaveVersion();
        qc.invalidateQueries({ queryKey: ["my-agents"] });
        toast.success(
          effectiveKind === "update"
            ? "VoxStream agent updated"
            : "VoxStream agent created",
          { description: `ElevenLabs agent: ${result.agentId}` },
        );
        await notifyBuildDeployed("elevenlabs");
      } catch (e) {
        toast.error("VoxStream deploy failed", { description: (e as Error).message });
      } finally {
        setDeploying(null);
      }
      return;
    }
    // ── End VoxStream guard — OmniVoice (Retell) path below is unchanged ────

    try {
      const agent = exportAgentJson(nodes, edges, settings, variables);
      const isUpdate = effectiveKind === "update";
      // Map both the base preset names AND the Retell-native _cal suffixed
      // variants back to the base preset so nodes imported from an existing
      // agent (where the raw tool_id is e.g. "check_availability_cal") are
      // still picked up and re-configured with the correct credentials.
      const CAL_PRESET_NORMALIZE: Record<
        string,
        "check_availability" | "book_appointment" | "reschedule_appointment" | "cancel_appointment"
      > = {
        check_availability: "check_availability",
        book_appointment: "book_appointment",
        reschedule_appointment: "reschedule_appointment",
        cancel_appointment: "cancel_appointment",
        check_availability_cal: "check_availability",
        book_appointment_cal: "book_appointment",
      };
      const calToolOverrides = nodes
        .filter(
          (n) =>
            n.data.kind === "function" &&
            typeof n.data.toolId === "string" &&
            n.data.toolId in CAL_PRESET_NORMALIZE,
        )
        .map((n) => ({
          nodeId: n.id,
          preset: CAL_PRESET_NORMALIZE[n.data.toolId as string],
          name: n.data.toolName,
          description: n.data.toolDescription,
          apiKey: n.data.toolApiKey,
          eventTypeId: n.data.toolEventTypeId,
          timezone: n.data.toolTimezone,
        }));
      const res = await deploy({
        data: {
          agent: agent as Record<string, unknown>,
          mode: effectiveKind,
          agentId: isUpdate ? settings.agentId || undefined : undefined,
          conversationFlowId: isUpdate ? settings.conversationFlowId || undefined : undefined,
          bookingConfig: settings.booking,
          calToolOverrides,
        },
      });
      setSettings({
        agentId: res.agentId,
        conversationFlowId: res.conversationFlowId,
        deployedAgentName: settings.agentName,
      });
      await persistAgent(res.agentId);
      bumpSaveVersion();
      const bookingNote =
        settings.booking?.enabled === false
          ? "Booking disabled for this agent (no calendar tools attached)."
          : res.calendarConnected
            ? "Booking tools (check_availability / book_appointment / cancel_appointment) auto-attached."
            : "Calendar not connected — booking tools were NOT attached. Connect Cal.com in Settings → Calendar to enable bookings.";
      const successLabel = nameChanged
        ? "New agent created (name changed)"
        : isUpdate
          ? "Agent updated"
          : "Agent created";
      toast.success(successLabel, {
        description: `agent_id: ${res.agentId}\n${bookingNote}`,
      });
      await notifyBuildDeployed("retell");
      if (res.voiceFallback) {
        toast.warning("Voice not available in builder workspace", {
          description:
            "Your custom ElevenLabs voice wasn't found in the builder workspace — using 11labs-Adrian for test calls. Your original voice will be applied automatically when you Go Live.",
          duration: 10000,
        });
      }
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (msg.startsWith("STALE_AGENT_ID:")) {
        // The agent no longer exists in the platform — clear the stale IDs
        // so the user can create a fresh one with the + button.
        setSettings({ agentId: undefined, conversationFlowId: undefined, deployedAgentName: undefined });
        toast.error("Agent not found", {
          description: "This agent no longer exists. Click + to create a new one.",
          duration: 8000,
        });
      } else {
        toast.error("Deploy failed", { description: msg });
      }
    } finally {
      setDeploying(null);
    }
  }

  async function handleTestCall() {
    return runRetellTestCall(testCallSession());
  }

  // ── HyperStream WebRTC test call ─────────────────────────────────────────
  async function handleHyperStreamTestCall() {
    return runHyperStreamTestCall(testCallSession());
  }

  /**
   * ElevenLabs Voice mode in-browser test call.
   * Pipeline: browser mic → OpenAI Whisper STT → GPT-4.1 text → ElevenLabs TTS → browser audio.
   * Uses the /api/el-voice-relay Vite plugin — audio never leaves the dev server unencrypted.
   * Audio: 24 kHz PCM16 mono (matches OpenAI/ElevenLabs pcm_24000 format).
   */
  async function handleElVoiceTestCall() {
    return runCascadeVoiceTestCall(testCallSession());
  }

  /**
   * VoxStream (ElevenLabs Conversational AI) in-browser test call.
   * Uses a signed URL fetched server-side so the API key is never exposed.
   * Audio: 16 kHz PCM16 mono (ElevenLabs native rate).
   */
  async function handleVoxStreamTestCall() {
    return runVoxStreamTestCall(testCallSession());
  }

  function endCall() {
    endReasonRef.current = "user_hangup";
    callCostUsdRef.current = hsExactCostUsd ?? undefined;
    finalizeRecording();
    recordCurrentCallCost();
    // OmniVoice (Retell) path
    clientRef.current?.stopCall();
    clientRef.current = null;
    // HyperStream (WebSocket relay) path
    wsRelayRef.current?.close();
    wsRelayRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    workletRef.current?.disconnect();
    workletRef.current = null;
    captureSinkRef.current?.disconnect();
    captureSinkRef.current = null;
    keepAliveRef.current?.stop();
    keepAliveRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    nextPlayTimeRef.current = 0;
    setInCall(false);
    setActiveNode(null);
    startedAtRef.current = null;
  }

  const costPerMinute = isOpenAI
    ? getHyperStreamCostPerMinute(settings.openaiRealtimeModel)
    : isElevenLabs
    ? ELEVENLABS_PER_MIN
    : isWebeeNative
    ? WEBEE_NATIVE_PER_MIN
    : getTotalCostPerMinute(settings.model);
  const minutes = elapsedSec / 60;
  // HyperStream: use exact token cost once available; fall back to time estimate
  // until the first response.done arrives (e.g. during greeting).
  const costIsExact = isOpenAI && hsExactCostUsd !== null;
  const cost = costIsExact ? hsExactCostUsd! : minutes * costPerMinute;
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");

  function recordCurrentCallCost() {
    if (recordedCallRef.current || !startedAtRef.current) return;
    const seconds = Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000));
    recordedCallRef.current = true;
    if (seconds <= 0) return;
    addTestCallSeconds(seconds);
    // Persist to server-side spend cap using the correct per-provider rate.
    const deploymentMode = isElevenLabs
      ? "ELEVENLABS_NATIVE"
      : isOpenAI
      ? "OPENAI_REALTIME"
      : isWebeeNative
      ? "WEBEE_NATIVE"
      : undefined;
    recordCost({ data: { seconds, deploymentMode } })
      .then((res) => {
        qc.setQueryData(["my-spend"], {
          spendLimitCents: res.spendLimitCents,
          spendUsedCents: res.spendUsedCents,
          email: spendQ.data?.email ?? "",
        });
        if (res.overLimit) {
          toast.warning("Spend cap reached", {
            description: `You've hit $${(res.spendLimitCents / 100).toFixed(2)}. Ask an admin to add credits.`,
          });
        }
      })
      .catch((e) => console.warn("recordTestCallCost failed:", (e as Error).message));
  }

  async function handleLoadById() {
    const id = loadId.trim();
    if (!id.startsWith("agent_")) {
      toast.error('Agent ID must start with "agent_"');
      return;
    }
    setLoading(true);
    try {
      const result = await fetchAgent({ data: { agentId: id } });
      if (!result.ok) {
        toast.error("Failed to load agent", { description: result.error });
        return;
      }
      const { agentJson } = result;
      const parsed = importAgentJson(agentJson);
      // Clear any stale row id from a previously open agent BEFORE loading —
      // persistAgent below re-links to the correct local row for this Retell
      // agent, so the SystemMind dock never targets the wrong agent.
      loadFlow({ ...parsed, agentRowId: null, replaceSettings: true });
      await persistAgent(id);
      toast.success("Agent loaded", { description: id });
      setLoadOpen(false);
      setLoadId("");
    } catch (e) {
      toast.error("Failed to load agent", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  /**
   * Save (or update) the current flow into the user's `agents` table so it
   * shows up in the "Your saved agents" list. Keyed by retell_agent_id.
   */
  async function persistAgent(retellAgentId: string) {
    try {
      const { nodes: n, edges: e, settings: s, variables: v } = useBuilderStore.getState();
      const existing = await getAgentByRetellId({ data: { retellAgentId } });
      // History snapshots ride along in settings; keep them compressed (HTTP 413 otherwise).
      await useBuilderStore.getState().compactHistory();
      const saved = await upsertAgent({
        data: {
          id: existing?.id,
          retellAgentId,
          name: s.agentName || "Untitled agent",
          flowData: { nodes: n, edges: e } as never,
          settings: s as never,
          variables: v as never,
        },
      });
      // Point the builder at the row we just saved so every downstream
      // consumer (SystemMind dock, deploy, save) targets THIS agent.
      if ((saved as any)?.id) {
        useBuilderStore.getState().setCurrentAgentRowId((saved as any).id);
      }
      qc.invalidateQueries({ queryKey: ["my-agents"] });
    } catch (err) {
      console.warn("persistAgent failed:", (err as Error).message);
    }
  }

  /** Everything the test-call routines read, as of this render (they ran as closures here before). */
  function testCallSession(): TestCallSession {
    return {
      activeSourceNodesRef,
      audioCtxRef,
      callCostUsdRef,
      callEndFiredRef,
      captureSinkRef,
      channelTypeRef,
      clearDebugEvents,
      clientRef,
      cost,
      currentAgentRowId,
      edges,
      elPlaybackRef,
      emitDebug,
      endCall,
      endReasonRef,
      finalizeRecording,
      getElSignedUrl,
      hsExactCostUsd,
      hsSessionIdRef,
      isWebeeNative,
      keepAliveRef,
      masterGainRef,
      nextPlayTimeRef,
      nodes,
      onLatencyUpdateRef,
      processorRef,
      pushTranscript,
      recChunksRef,
      recordCurrentCallCost,
      recordedCallRef,
      recorderRef,
      setActiveNode,
      setCalling,
      setElapsedSec,
      setHsExactCostUsd,
      setInCall,
      settings,
      startCall,
      startedAtRef,
      streamRef,
      testCallPrepRef,
      transcript,
      variables,
      workletRef,
      wsConnectTimeoutRef,
      wsPingRef,
      wsRelayRef,
    };
  }

  return (
    <>
      {/* Pre-flight checks Dialog */}
      <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              Pre-flight checks
              {flowErrors.length > 0 ? (
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                  {flowErrors.length} error{flowErrors.length !== 1 ? "s" : ""}
                </span>
              ) : flowWarnings.length > 0 ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                  {flowWarnings.length} warning{flowWarnings.length !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  All clear
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Errors block deployment. Warnings are advisory. Click an issue to select that node.
            </DialogDescription>
          </DialogHeader>
          {flowIssues.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-3 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Agent is ready to deploy — no issues found.
            </div>
          ) : (
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
              {flowIssues.map((issue) => (
                <button
                  key={`${issue.level}|${issue.nodeId ?? ""}|${issue.message}`}
                  type="button"
                  onClick={() => {
                    if (!issue.nodeId) return;
                    selectNode(issue.nodeId);
                    setCheckOpen(false);
                  }}
                  className={cn(
                    "flex items-start gap-2 rounded-lg px-3 py-2 text-left text-xs",
                    issue.level === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-amber-500/10 text-amber-400",
                    issue.nodeId && "hover:bg-muted dark:hover:bg-white/[0.06]",
                  )}
                >
                  {issue.level === "error" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  {issue.message}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TestCallPrepDialog
        open={testPrepOpen}
        onOpenChange={setTestPrepOpen}
        nodes={nodes}
        declared={variables}
        agentId={currentAgentRowId ?? String(settings.agentId ?? "draft")}
        onStart={(prep) => {
          testCallPrepRef.current = prep;
          if (isWebeeNative || (isOpenAI && settings.voiceOutputProvider === "elevenlabs")) {
            void handleElVoiceTestCall();
          } else if (isOpenAI) {
            void handleHyperStreamTestCall();
          } else if (isElevenLabs) {
            void handleVoxStreamTestCall();
          } else {
            void handleTestCall();
          }
        }}
      />

      {/* Deploy / utility cluster */}
      <div className="flex items-center gap-0.5 rounded-md border border-border dark:border-white/[0.05] bg-muted/40 dark:bg-white/[0.02] px-1 py-0.5">
        {/* Pre-flight shield */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCheckOpen((o) => !o)}
          className={cn(
            "relative !h-8 !w-8 !p-0",
            flowErrors.length > 0
              ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
              : flowWarnings.length > 0
                ? "text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"
                : "text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400",
          )}
          title={
            flowErrors.length > 0
              ? `${flowErrors.length} error${flowErrors.length !== 1 ? "s" : ""} — fix before deploying`
              : flowWarnings.length > 0
                ? `${flowWarnings.length} warning${flowWarnings.length !== 1 ? "s" : ""}`
                : "All checks pass"
          }
        >
          {flowErrors.length > 0 ? (
            <ShieldAlert className="h-3.5 w-3.5" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {flowIssues.length > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-bold leading-none text-white",
                flowErrors.length > 0 ? "bg-destructive" : "bg-amber-500",
              )}
            >
              {flowIssues.length}
            </span>
          )}
        </Button>
        <div className="h-3.5 w-px bg-muted dark:bg-white/[0.07] mx-0.5" />
        {/* Test / Run agent */}
        {inCall || calling ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={endCall}
            className="!h-8 !w-8 !p-0 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
            title={calling ? "Cancel connecting" : "End test call"}
          >
            {calling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PhoneOff className="h-3.5 w-3.5" />
            )}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTestPrepOpen(true)}
            disabled={!hasAgent || (!isOpenAI && !isWebeeNative && overLimit)}
            className="!h-8 !w-8 !p-0 text-muted-foreground/60 hover:bg-violet-500/10 hover:text-violet-300 disabled:opacity-40"
            title={
              !hasAgent
                ? "Save the agent first"
                : !isOpenAI && !isElevenLabs && !isWebeeNative && overLimit
                  ? `Spend cap reached ($${(spendUsedCents / 100).toFixed(2)} / $${(spendLimitCents / 100).toFixed(2)}).`
                  : isWebeeNative
                    ? "Test WEBEE Native agent (in-house graph VM + TTS)"
                    : isOpenAI && settings.voiceOutputProvider === "elevenlabs"
                    ? "Test EL Voice agent (Whisper → GPT-4.1 → ElevenLabs TTS)"
                    : isOpenAI
                      ? "Test HyperStream agent (browser WebRTC)"
                      : isElevenLabs
                        ? "Test VoxStream agent (ElevenLabs)"
                        : "Test agent (browser call)"
            }
          >
            <Phone className="h-3.5 w-3.5" />
          </Button>
        )}


        {/* Load existing agent by ID — OmniVoice only */}
        {!isOpenAI && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLoadOpen(true)}
            className="!h-8 !w-8 !p-0 text-muted-foreground/60 hover:text-foreground"
            title="Load agent by ID"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Built by SystemMind — open the Build Workspace session */}
        {buildProvenance && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              navigate({
                to: "/systemmind/build",
                search: {
                  session: buildProvenance.session_id as string,
                  workflow: undefined,
                  agent: undefined,
                },
              })
            }
            className="!h-8 !w-8 !p-0 text-sky-400/80 hover:bg-sky-500/10 hover:text-sky-300"
            title={`Built by SystemMind (v${buildProvenance.version_number}) — open build session`}
          >
            <Hammer className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Update existing */}
        {hasAgent && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleDeploy("update")}
            disabled={deploying !== null}
            className="!h-8 !w-8 !p-0 text-muted-foreground/60 hover:bg-sky-500/10 hover:text-sky-300"
            title={
              isOpenAI
                ? "Sync current changes to local database"
                : "Update existing agent with current flow"
            }
          >
            {deploying === "update" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        )}

        {/* Divider before primary CTA */}
        <div className="h-3.5 w-px bg-muted dark:bg-white/[0.07] mx-0.5" />

        {/* Create / Deploy */}
        <Button
          data-tour="builder-create-deploy-btn"
          size="sm"
          variant="ghost"
          onClick={() => handleDeploy("create")}
          disabled={deploying !== null}
          className="!h-8 !w-8 !p-0 text-muted-foreground/60 hover:bg-primary/10 hover:text-primary"
          title={
            isOpenAI
              ? "Save agent to HyperStream local database"
              : "Create new agent from current flow"
          }
        >
          {deploying === "create" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {/* Transcript is now rendered in Builder's right panel via onTranscriptUpdate/onCallActive props */}

      {/* Enterprise Line confirmation dialog — shown for OpenAI Realtime agents */}
      <Dialog open={openaiConfirmOpen} onOpenChange={setOpenaiConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-violet-500/40 bg-violet-500/10 text-violet-300 gap-1 px-2 py-0.5 text-xs font-semibold"
              >
                <Zap className="h-3 w-3" />
                Enterprise Line
              </Badge>
              Save OpenAI Realtime Agent
            </DialogTitle>
            <DialogDescription>
              This agent routes through the OpenAI Realtime engine. OmniVoice provisioning is skipped —
              your tool schema and voice settings are compiled and saved directly.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24">Voice</span>
              <span className="font-mono text-foreground">{settings.openaiVoice ?? "alloy"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24">Reasoning</span>
              <span className="font-mono text-foreground">{settings.openaiReasoningEffort ?? "low"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-24">Agent name</span>
              <span className="truncate text-foreground">{settings.agentName || "Untitled agent"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setOpenaiConfirmOpen(false)}
              disabled={openaiDeploying}
            >
              Cancel
            </Button>
            <Button
              onClick={handleOpenAIRealtimeDeploy}
              disabled={openaiDeploying}
              className="gap-1.5"
            >
              {openaiDeploying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Save Agent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load agent by ID</DialogTitle>
            <DialogDescription>
              Paste an agent ID (starts with <code>agent_</code>) to pull its conversation flow into
              the builder for editing.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="agent_xxxxxxxxxxxxxxxxxxxxxxxx"
            value={loadId}
            onChange={(e) => setLoadId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLoadById();
            }}
          />

          <div className="mt-1">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Your saved agents
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {agentsQ.isLoading ? (
                <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              ) : agentsQ.data && agentsQ.data.length > 0 ? (
                agentsQ.data
                  .filter((a) => a.retell_agent_id)
                  .map((a) => {
                    const isSelected = loadId.trim() === a.retell_agent_id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setLoadId(a.retell_agent_id ?? "")}
                        onDoubleClick={() => {
                          setLoadId(a.retell_agent_id ?? "");
                          // Defer to ensure state is set before submit.
                          setTimeout(() => handleLoadById(), 0);
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors ${
                          isSelected ? "bg-muted" : ""
                        }`}
                      >
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          {a.retell_agent_id}
                        </div>
                      </button>
                    );
                  })
              ) : (
                <div className="p-3 text-xs text-muted-foreground">
                  No saved agents yet. Create or deploy one to see it here.
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Click to fill the ID, double-click to load instantly.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setLoadOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleLoadById} disabled={loading || !loadId.trim()}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Load
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cost meter — height-matched to toolbar buttons */}
      {(inCall || spendUsedCents > 0) && (
        <div
          className="flex h-8 items-center gap-1.5 rounded-md border border-border dark:border-white/[0.05] bg-muted/40 dark:bg-white/[0.02] px-2 text-[10px] font-medium text-foreground/70"
          title={
            costIsExact
              ? `OpenAI token cost only. Live calls add ~$${HYPERSTREAM_TELEPHONY_PER_MIN.toFixed(3)}/min Twilio telephony on top (not charged for builder test calls).`
              : isElevenLabs
              ? `VoxStream est. ~$${ELEVENLABS_PER_MIN.toFixed(3)}/min (ElevenLabs ConvAI — GPT-4o + Turbo v2.5 voice, blended)`
              : isWebeeNative
              ? `WEBEE Native est. ~$${WEBEE_NATIVE_PER_MIN.toFixed(3)}/min (in-house TTS + streaming STT + GPT-4.1). Live calls add carrier minutes.`
              : `Estimated spend @ $${costPerMinute.toFixed(3)}/min`
          }
        >
          {inCall && (
            <>
              <span className="inline-flex items-center gap-1 tabular-nums text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                {mm}:{ss}
              </span>
              <span className="h-3 w-px bg-border" />
            </>
          )}
          <span className="inline-flex items-center gap-1 tabular-nums text-foreground">
            <DollarSign className="h-3 w-3 text-muted-foreground" />
            {(spendUsedCents / 100 + cost).toFixed(3)}
            <span className="text-muted-foreground"> / ${(spendLimitCents / 100).toFixed(2)}</span>
          </span>
          <span className="hidden lg:inline text-muted-foreground">
            {inCall
              ? costIsExact
                ? `· exact $${cost.toFixed(5)} `
                : `· ~est. $${cost.toFixed(3)} `
              : ""}
            {costIsExact
              ? `· token-exact  + ~$${HYPERSTREAM_TELEPHONY_PER_MIN.toFixed(3)}/min telephony (live)`
              : `· ~$${costPerMinute.toFixed(3)}/min est.`}
          </span>
        </div>
      )}
    </>
  );
}
