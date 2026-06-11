import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RetellWebClient } from "retell-client-js-sdk";
import { Phone, PhoneOff, Loader2, RefreshCw, DollarSign, Plus, Download, Zap } from "lucide-react";
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
import type { AgentRuntimeDefinition } from "@/lib/runtime/schema";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import {
  deployAgentToRetell,
  createRetellWebCall,
  fetchRetellAgent,
} from "@/lib/builder/retell.functions";
import {
  listMyAgents,
  upsertMyAgent,
  getMyAgentByRetellId,
} from "@/lib/agents/agents.functions";
import { getMySpend, recordTestCallCost } from "@/lib/auth/auth.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTotalCostPerMinute, getHyperStreamCostPerMinute, calcHyperStreamTurnCost } from "@/lib/builder/pricing";

export function RetellDeployDialog() {
  const {
    nodes,
    edges,
    settings,
    variables,

    setSettings,
    setActiveNode,
    addTestCallSeconds,
    loadFlow,
  } = useBuilderStore();
  const currentAgentRowId = useBuilderStore((s) => s.currentAgentRowId);
  const setCurrentAgentRowId = useBuilderStore((s) => s.setCurrentAgentRowId);
  const bumpSaveVersion = useBuilderStore((s) => s.bumpSaveVersion);

  const [deploying, setDeploying] = useState<"create" | "update" | null>(null);
  const [openaiConfirmOpen, setOpenaiConfirmOpen] = useState(false);
  const [openaiDeploying, setOpenaiDeploying] = useState(false);
  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
  // Exact token-based USD cost accumulated from response.done events during a
  // HyperStream call. null = no call active / no response.done received yet.
  const [hsExactCostUsd, setHsExactCostUsd] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [loadOpen, setLoadOpen] = useState(false);
  const [loadId, setLoadId] = useState("");
  const [loading, setLoading] = useState(false);
  const clientRef = useRef<RetellWebClient | null>(null);
  const wsRelayRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const captureSinkRef = useRef<GainNode | null>(null);
  const keepAliveRef = useRef<OscillatorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const recordedCallRef = useRef(false);

  const deploy = useServerFn(deployAgentToRetell);
  const startCall = useServerFn(createRetellWebCall);
  const fetchAgent = useServerFn(fetchRetellAgent);
  const listAgents = useServerFn(listMyAgents);
  const upsertAgent = useServerFn(upsertMyAgent);
  const getAgentByRetellId = useServerFn(getMyAgentByRetellId);
  const fetchSpend = useServerFn(getMySpend);
  const recordCost = useServerFn(recordTestCallCost);
  // Core Runtime — buildAgentRuntimeDefinition is a pure function called
  // directly from the builder store.  No DB round-trip needed for test calls.
  const qc = useQueryClient();

  const spendQ = useQuery({
    queryKey: ["my-spend"],
    queryFn: () => fetchSpend(),
    refetchOnWindowFocus: false,
  });
  const spendLimitCents = spendQ.data?.spendLimitCents ?? 500;
  const spendUsedCents = spendQ.data?.spendUsedCents ?? 0;
  const overLimit = spendUsedCents >= spendLimitCents;

  const agentsQ = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => listAgents(),
    enabled: loadOpen,
    refetchOnWindowFocus: false,
  });

  const hasAgent = Boolean(settings.agentId);
  // Use the adapter so the mode resolves correctly for both legacy agents
  // (voiceProvider="OPENAI_REALTIME") and new agents (deploymentMode="OPENAI_NATIVE").
  const deploymentMode = resolveDeploymentMode(settings);
  const isOpenAI = deploymentMode === "OPENAI_NATIVE";

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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      setActiveNode(null);
    };
  }, [setActiveNode]);

  // Tick elapsed seconds while in a call.
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
      } catch (e) {
        toast.error("Save failed", { description: (e as Error).message });
      } finally {
        setDeploying(null);
      }
      return;
    }
    // ── End HyperStream guard — OmniVoice (Retell) path below is unchanged ──

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
    const agentId = (settings.agentId ?? "").trim();
    if (!agentId.startsWith("agent_")) {
      toast.error("Deploy the agent first to get a valid agent ID");
      return;
    }
    setCalling(true);
    try {
      const { accessToken } = await startCall({ data: { agentId } });
      const client = new RetellWebClient();
      clientRef.current = client;

      client.on("call_started", () => {
        startedAtRef.current = Date.now();
        recordedCallRef.current = false;
        setElapsedSec(0);
        setInCall(true);
        // Highlight the start node immediately.
        const startNode = nodes.find((n) => n.data.isStart) ?? nodes[0];
        if (startNode) setActiveNode(startNode.id);
      });

      client.on("call_ended", () => {
        recordCurrentCallCost();
        setInCall(false);
        setActiveNode(null);
        startedAtRef.current = null;
        clientRef.current = null;
      });

      // Retell emits various event shapes — we look anywhere for a node id.
      const tryHighlightFromPayload = (payload: unknown) => {
        if (!payload || typeof payload !== "object") return;
        const obj = payload as Record<string, unknown>;
        const candidates = [
          obj.current_node_id,
          obj.node_id,
          (obj.node as Record<string, unknown> | undefined)?.id,
          (obj.metadata as Record<string, unknown> | undefined)?.current_node_id,
        ];
        for (const c of candidates) {
          if (typeof c === "string" && nodes.some((n) => n.id === c)) {
            setActiveNode(c);
            return;
          }
        }
      };

      // Listen to every event Retell may emit for flow transitions.
      const events = ["update", "metadata", "node_transition", "agent_node_transition"] as const;
      for (const ev of events) {
        // SDK typing is loose — cast to any to register dynamic events.
        (client as unknown as { on: (e: string, cb: (p: unknown) => void) => void }).on(
          ev,
          tryHighlightFromPayload,
        );
      }

      client.on("error", (err: unknown) => {
        toast.error("Call error", {
          description: String((err as Error)?.message ?? err),
        });
        client.stopCall();
      });
      await client.startCall({ accessToken });
    } catch (e) {
      toast.error("Test call failed", { description: (e as Error).message });
    } finally {
      setCalling(false);
    }
  }

  // ── HyperStream WebRTC test call ─────────────────────────────────────────
  async function handleHyperStreamTestCall() {
    const rowId = currentAgentRowId ?? (settings.agentId as string | null);
    if (!rowId) {
      toast.error("Save the agent first", {
        description: "Click the + button to save before testing",
      });
      return;
    }
    setCalling(true);
    setHsExactCostUsd(null);

    function cleanupHyperStream() {
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
      wsRelayRef.current?.close();
      wsRelayRef.current = null;
      nextPlayTimeRef.current = 0;
    }

    // ── Instrumentation — hoisted above all async work ─────────────────────
    // t0 is set here, before exportDefinition(), so runtime phase timings
    // (export, validation, model resolve) share the same clock reference as
    // all subsequent WebSocket event logs.  This is the authoritative session
    // clock — nothing upstream sets it.
    const t0 = performance.now();
    const hsLog = (
      direction: "OUT" | "IN " | "   ",
      event: string,
      extra: Record<string, unknown> = {},
    ) => {
      const ms = (performance.now() - t0).toFixed(0).padStart(6);
      const pairs = Object.entries(extra)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(`[HS ${ms}ms] ${direction} ${event}${pairs ? "  " + pairs : ""}`);
    };

    // ── Phase 1: Core Runtime — load and validate the agent definition ──────
    // Maps Builder/panel model IDs → OpenAI Realtime API model IDs.
    // Native realtime IDs pass through unchanged.
    // Non-realtime IDs (gpt-4.1, etc.) map to their realtime equivalent.
    // Always route through this function — never pass a raw panel ID to OpenAI.
    function resolvedRealtimeModel(modelId: string): string {
      const REALTIME_MODEL_MAP: Record<string, string> = {
        // Native realtime IDs — pass through as-is
        "gpt-4o-realtime-preview":      "gpt-4o-realtime-preview",
        "gpt-4o-mini-realtime-preview": "gpt-4o-mini-realtime-preview",
        // Builder / panel IDs that map to a realtime equivalent
        "gpt-realtime":  "gpt-realtime",
        "gpt-4.1":       "gpt-realtime",
        "gpt-4.1-fast":  "gpt-realtime",
        "gpt-4.1-mini":  "gpt-realtime",
      };
      return REALTIME_MODEL_MAP[modelId] ?? "gpt-realtime";
    }

    let params: OpenAIExecutionParams;
    let runtimeDef: AgentRuntimeDefinition;
    try {
      // Build directly from in-memory store — no DB round-trip, no auth
      // dependency.  Works for unsaved agents, expired sessions, and stale
      // currentAgentRowId values.  The user tests exactly what they have open.
      const agentId = rowId ?? "local-test-call";
      hsLog("   ", "runtime.export.start", { agentId, source: "builder-store" });
      const exportStart = performance.now();
      runtimeDef = buildAgentRuntimeDefinition({
        agentId,
        retellAgentId: null,
        agentName: (settings as unknown as Record<string, unknown>).agentName as string || "Test Agent",
        updatedAt: new Date().toISOString(),
        nodes,
        edges,
        settings,
        variables,
      });
      hsLog("   ", "runtime.export.complete", {
        durationMs: (performance.now() - exportStart).toFixed(0),
        agentId: runtimeDef.agentId,
        provider: runtimeDef.provider,
        nodes: runtimeDef.workflow.nodes.length,
        tools: runtimeDef.tools.length,
        variables: runtimeDef.variables.length,
        runtimeVersion: runtimeDef.runtimeVersion,
      });

      const validationStart = performance.now();
      // extractOpenAIParams asserts def.provider === "OPENAI_NATIVE" and throws
      // if runtimeConfig.openai is absent — both are Builder assembly bugs.
      params = extractOpenAIParams(runtimeDef);
      hsLog("   ", "runtime.validation.complete", {
        durationMs: (performance.now() - validationStart).toFixed(0),
        provider: params.provider,
        voice: params.voice,
        model: params.model,
        promptChars: params.systemPrompt.length,
      });
    } catch (err) {
      hsLog("   ", "runtime.export.error", { error: (err as Error).message });
      toast.error("Agent definition error", {
        description: (err as Error).message,
      });
      setCalling(false);
      return;
    }

    // ── Phase 2: Model selection through Core Runtime ──────────────────────
    // Always run through resolvedRealtimeModel so non-native IDs like "gpt-4.1"
    // are correctly mapped to their OpenAI Realtime API equivalent ("gpt-realtime").
    // Panel selector value takes priority over the builder's base model ID.
    const modelResolveStart = performance.now();
    const panelModelId = settings.openaiRealtimeModel;
    const realtimeModel = resolvedRealtimeModel(panelModelId ?? runtimeDef.model.id);
    hsLog("   ", "runtime.model.resolve", {
      durationMs: (performance.now() - modelResolveStart).toFixed(0),
      builderId: runtimeDef.model.id,
      panelModelId: panelModelId ?? "(none — legacy fallback)",
      realtimeModel,
    });

    // Running exact token cost accumulated from response.done events.
    // Closed over by the WS message handler so each turn adds to it.
    let callExactCostUsd = 0;

    try {
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${wsProto}//${window.location.host}/api/hyperstream-relay` +
          `?agentRowId=${encodeURIComponent(rowId)}` +
          `&model=${encodeURIComponent(realtimeModel)}`,
      );
      wsRelayRef.current = ws;

      // 24 kHz mono — matches OpenAI Realtime PCM16 format.
      const audioCtx = new AudioContext({ sampleRate: 24000 });
      // Browsers don't always honor the requested 24 kHz. The worklet resamples
      // capture to a guaranteed 24 kHz, but log the real rate for diagnostics.
      console.log(
        `[hyperstream] AudioContext sampleRate=${audioCtx.sampleRate} (requested 24000)`,
      );
      // Log any state changes so we can detect auto-suspension.
      audioCtx.onstatechange = () => {
        console.log(`[hyperstream] AudioContext state → ${audioCtx.state}`);
      };
      // Keep-alive oscillator: a silent (gain=0) sine wave running for the
      // entire call. Without it browsers can auto-suspend the AudioContext
      // when no audio is actively playing, which kills the worklet's
      // process() loop and stops mic audio from reaching OpenAI's VAD.
      const keepAliveOsc = audioCtx.createOscillator();
      const keepAliveGain = audioCtx.createGain();
      keepAliveGain.gain.value = 0;
      keepAliveOsc.connect(keepAliveGain);
      keepAliveGain.connect(audioCtx.destination);
      keepAliveOsc.start();
      keepAliveRef.current = keepAliveOsc;

      audioCtxRef.current = audioCtx;
      nextPlayTimeRef.current = 0;

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = micStream;

      const source = audioCtx.createMediaStreamSource(micStream);

      let sessionReady = false;

      // ── Duration trackers for the latency breakdown ──────────────────────
      // All timestamps are performance.now() values relative to t0.
      // t0 and hsLog are hoisted above this WS try block — all runtime phase
      // logs (export, validation, model resolve) and WS event logs share the
      // same clock reference.
      let sessionUpdateSentAt: number | null = null;  // relay.connected → session.updated
      let speechStartedAt:    number | null = null;   // speech_started (TTFA ref, cleared after use)
      let responseCreatedAt:  number | null = null;   // response.created → response.done
      let toolCallStartedAt:  number | null = null;   // fn_call received → output sent
      // True only between response.created and response.done / response.cancelled.
      // Guards response.cancel so we never send it when no response is in flight.
      let isResponseInProgress = false;
      // Turn timeline refs — persist from speech_started → response.done so the
      // timeline report at response.done has all its anchor points available.
      let turnSpeechStartAt: number | null = null;   // kept until response.done
      let turnSpeechStopAt:  number | null = null;   // kept until response.done
      let firstAudioDeltaAt: number | null = null;   // first delta timestamp
      // Audio delta accumulation for the turn — reset at response.created.
      let audioDeltaCount   = 0;
      let audioDeltaByteTotal = 0;

      // Emit Core Runtime identity once at WS open.  All subsequent logs share t0.
      hsLog("   ", "core.runtime.activated", {
        agentId: runtimeDef.agentId,
        runtimeVersion: runtimeDef.runtimeVersion,
        provider: runtimeDef.provider,
        modelId: runtimeDef.model.id,
        realtimeModel,
        tools: runtimeDef.tools.length,
        knowledgeBaseIds: runtimeDef.knowledgeBase.ids.length,
        compiledPromptChars: params.systemPrompt.length,
      });

      // Audio-append throttle: log a summary every 50 packets instead of
      // every single one (50ms chunks × 50 = ~2.5 s between log lines).
      let appendPktCount = 0;
      let appendByteTotal = 0;

      // Track which response_id we last saw so we can label "first delta".
      let currentResponseId = "";
      let deltaCountForResponse = 0;

      // ── TTFA (Time to First Audio) tracking ──────────────────────────────
      // speechStoppedAt records the performance.now() timestamp when OpenAI
      // confirms VAD detected end-of-speech. The first audio delta for each
      // response uses this to compute the end-to-end TTFA:
      //   TTFA = t(first_delta) − t(speech_stopped)
      // This covers: silence_duration_ms + committed + response.created +
      //              LLM first token + relay return hop.
      let speechStoppedAt: number | null = null;

      // Convert an Int16 PCM buffer → base64 and stream to OpenAI.
      const sendPcm = (int16: Int16Array) => {
        if (!sessionReady || ws.readyState !== WebSocket.OPEN) return;
        const uint8 = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
        const payload = JSON.stringify({ type: "input_audio_buffer.append", audio: btoa(binary) });
        ws.send(payload);
        appendPktCount += 1;
        appendByteTotal += payload.length;
        if (appendPktCount % 50 === 0) {
          hsLog("OUT", "input_audio_buffer.append", {
            packets: appendPktCount,
            totalBytes: appendByteTotal,
          });
        }
      };

      // Prefer AudioWorklet: it runs mic capture on the audio render thread, so
      // a busy main thread (React re-renders, audio decoding) can no longer drop
      // input frames — which is what caused laggy / clipped speech with the old
      // ScriptProcessorNode. Fall back to ScriptProcessor where unsupported.
      let usingWorklet = false;
      if (audioCtx.audioWorklet) {
        try {
          // Resample mic input (whatever rate the browser actually gave the
          // context) down to a guaranteed 24 kHz, mono, and emit ~100 ms
          // (2400-sample) Int16 chunks. If the context is already 24 kHz the
          // ratio is 1 and this is a straight copy.
          const workletCode = `
            class CaptureProcessor extends AudioWorkletProcessor {
              constructor() {
                super();
                this._ratio = sampleRate / 24000; // input frames per output frame
                this._pos = 0;                     // fractional read cursor
                this._prev = 0;                    // last sample of previous block
                // 1200 samples @ 24 kHz = 50 ms chunks.
                // Smaller chunks reduce mic-to-OpenAI capture latency vs the
                // previous 2400-sample (100 ms) accumulator.
                this._buf = new Int16Array(1200);
                this._n = 0;
              }
              process(inputs) {
                const ch = inputs[0] && inputs[0][0];
                if (ch && ch.length) {
                  const len = ch.length;
                  // Inlined to avoid allocating a closure per process() call.
                  // Virtual layout: index 0 → this._prev, index k → ch[k-1].
                  // Loop invariant: Math.floor(this._pos) < len, so ch[i] is always valid.
                  while (this._pos < len) {
                    const i = Math.floor(this._pos);
                    const frac = this._pos - i;
                    const s0 = i === 0 ? this._prev : ch[i - 1];
                    const s1 = ch[i]; // i ≤ len-1 guaranteed by while condition
                    let s = s0 + (s1 - s0) * frac;
                    s = s < -1 ? -1 : s > 1 ? 1 : s;
                    this._buf[this._n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
                    if (this._n === this._buf.length) {
                      const out = this._buf.slice(0, this._n);
                      this.port.postMessage(out.buffer, [out.buffer]);
                      this._n = 0;
                    }
                    this._pos += this._ratio;
                  }
                  this._pos -= len;           // carry remainder into next block
                  this._prev = ch[len - 1];   // carry boundary sample for interpolation
                }
                return true;
              }
            }
            registerProcessor('capture-processor', CaptureProcessor);
          `;
          const blobUrl = URL.createObjectURL(
            new Blob([workletCode], { type: "application/javascript" }),
          );
          try {
            await audioCtx.audioWorklet.addModule(blobUrl);
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
          const node = new AudioWorkletNode(audioCtx, "capture-processor");
          workletRef.current = node;
          node.port.onmessage = (ev) => sendPcm(new Int16Array(ev.data as ArrayBuffer));
          source.connect(node);
          // Keep the node pulled by the graph without emitting audible output.
          const sink = audioCtx.createGain();
          sink.gain.value = 0;
          captureSinkRef.current = sink;
          node.connect(sink);
          sink.connect(audioCtx.destination);
          usingWorklet = true;
        } catch (err) {
          console.warn("[hyperstream] AudioWorklet unavailable, falling back:", err);
        }
      }

      if (!usingWorklet) {
        // ScriptProcessorNode fallback (deprecated, main-thread).
        // WARNING: this path does NOT resample. The AudioContext was requested
        // at 24 kHz but the browser may supply a different native rate (e.g.
        // 44100 Hz). If the actual rate differs, OpenAI receives audio at the
        // wrong speed — VAD fires erratically and ASR produces garbled output.
        // Use a browser that supports AudioWorklet to avoid this path.
        console.warn(
          `[hyperstream] ScriptProcessorNode fallback active. ` +
          `AudioContext.sampleRate=${audioCtx.sampleRate}. ` +
          `OpenAI expects 24000 Hz PCM16 — if this differs, audio will be garbled.`,
        );
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        source.connect(processor);
        processor.connect(audioCtx.destination);
        processor.onaudioprocess = (e) => {
          if (!sessionReady || ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          sendPcm(int16);
        };
      }

      ws.binaryType = "arraybuffer";
      ws.onmessage = (ev) => {
        try {
          const raw =
            typeof ev.data === "string"
              ? ev.data
              : new TextDecoder().decode(ev.data as ArrayBuffer);
          const msg = JSON.parse(raw) as Record<string, unknown>;

          if (msg.type === "relay.connected") {
            hsLog("IN ", "relay.connected");
            // ── Phase 1: Session creation through Core Runtime ──────────────
            // params.systemPrompt — compiled and schema-validated by
            //   buildAgentRuntimeDefinition → AgentRuntimeDefinitionSchema.parse()
            // params.voice — from runtimeConfig.openai.voice (typed, not raw state)
            //
            // Phase 3: Tool definitions through Core Runtime
            // buildOpenAIToolDefinitions converts def.tools (RetellTool[]) to the
            // OpenAI Realtime function format.  Empty array when no tools defined —
            // omitted from the payload so OpenAI doesn't reject an empty tools field.
            //
            // IMPORTANT: This model uses nested audio.input/output — NOT the flat
            // schema in the public OpenAI docs. Fields outside this shape are
            // rejected with "unknown_parameter".  Turn detection must be inside
            // audio.input, voice inside audio.output.
            const toolBuildStart = performance.now();
            const toolDefs = buildOpenAIToolDefinitions(runtimeDef.tools);
            hsLog("   ", "runtime.tool.build.complete", {
              durationMs: (performance.now() - toolBuildStart).toFixed(0),
              toolCount: toolDefs.length,
            });
            const sessionConfig: Record<string, unknown> = {
              type: "realtime",
              output_modalities: ["audio"],
              instructions: params.systemPrompt,
              audio: {
                input: {
                  turn_detection: {
                    type: "server_vad",
                    threshold: 0.5,
                    prefix_padding_ms: 200,
                    // 200 ms silence_duration_ms is the OpenAI minimum —
                    // minimises dead time after the user stops speaking.
                    silence_duration_ms: 200,
                    create_response: true,
                    interrupt_response: true,
                  },
                },
                output: {
                  voice: params.voice,
                },
              },
            };
            if (toolDefs.length > 0) {
              sessionConfig.tools = toolDefs;
            }
            const updatePayload = JSON.stringify({
              type: "session.update",
              session: sessionConfig,
            });
            hsLog("OUT", "session.update", {
              payloadBytes: updatePayload.length,
              instructionsChars: params.systemPrompt.length,
              voice: params.voice,
              hasInstructions: params.systemPrompt.length > 0,
              tools: toolDefs.length,
            });
            ws.send(updatePayload);
            sessionUpdateSentAt = performance.now();
            hsLog("   ", "runtime.session.update.sent", {
              totalFromT0_ms: (performance.now() - t0).toFixed(0),
              payloadBytes: updatePayload.length,
            });
            return;
          }

          // Session confirmed — safe to start mic streaming and trigger greeting.
          if (msg.type === "session.updated") {
            const sessionCreationMs = sessionUpdateSentAt !== null
              ? (performance.now() - sessionUpdateSentAt).toFixed(0)
              : "n/a";
            // server_vad confirmation: session.updated means OpenAI accepted
            // the turn_detection config.  If sessionCreationMs is >2000ms,
            // the OpenAI API is under load — consider retrying.
            hsLog("IN ", "session.updated", {
              payloadBytes: raw.length,
              sessionCreationMs,
            });
            // Ask the agent to greet the caller FIRST so a re-render can't block it.
            try {
              const rcPayload = JSON.stringify({ type: "response.create" });
              ws.send(rcPayload);
              hsLog("OUT", "response.create", { payloadBytes: rcPayload.length });
            } catch (err) {
              console.error("[hyperstream] response.create send failed:", err);
            }
            sessionReady = true;
            startedAtRef.current = Date.now();
            recordedCallRef.current = false;
            setElapsedSec(0);
            setInCall(true);
            setCalling(false);
            const startNode = nodes.find((n) => n.data?.isStart) ?? nodes[0];
            if (startNode) setActiveNode(startNode.id);
            return;
          }

          if (msg.type === "relay.error") {
            toast.error("HyperStream error", {
              description: msg.message as string,
            });
            return;
          }

          // Forward OpenAI-native error events so they aren't silently swallowed.
          if (msg.type === "error") {
            const detail = (msg.error as Record<string, unknown> | undefined)?.message
              ?? msg.message
              ?? "Unknown error";
            hsLog("IN ", "error", { detail: String(detail).slice(0, 120) });
            toast.error("HyperStream session error", { description: String(detail) });
            return;
          }

          // ── Speech detection events (confirms user audio is reaching OpenAI VAD)
          if (msg.type === "input_audio_buffer.speech_started") {
            // ── Interruption / barge-in support ──────────────────────────
            // Reset the playback scheduler so the next response's audio is
            // scheduled from now, not relative to where the interrupted
            // response would have finished.  Without this reset the new
            // response plays in the future (audible silence gap) or is
            // skipped entirely if nextPlayTime is far ahead.
            nextPlayTimeRef.current = 0;
            const now = performance.now();
            speechStartedAt = now;
            turnSpeechStartAt = now;
            // Reset audio accumulators for the new turn.
            firstAudioDeltaAt = null;
            audioDeltaCount = 0;
            audioDeltaByteTotal = 0;
            // ── response.cancel outbound ──────────────────────────────────
            // Send response.cancel explicitly when the user starts speaking
            // mid-response.  Belt-and-suspenders with interrupt_response:true
            // in the session config — both mechanisms are now active.
            // This answers "is response.cancel sent when user interrupts":
            //   YES — logged below as OUT response.cancel when active.
            //   server_vad interrupt_response:true handles it server-side too.
            // NOTE: input_audio_buffer.commit is NOT sent here or anywhere.
            //   In server_vad mode OpenAI auto-commits the buffer when VAD
            //   detects end-of-speech — the client never sends commit.
            // Guard: only cancel if a response is actively in-flight.
            // currentResponseId persists after response.done, so checking it
            // alone caused "Cancellation failed: no active response found".
            if (isResponseInProgress && currentResponseId && ws.readyState === WebSocket.OPEN) {
              const cancelPayload = JSON.stringify({ type: "response.cancel" });
              ws.send(cancelPayload);
              hsLog("OUT", "response.cancel", {
                response_id: currentResponseId,
                payloadBytes: cancelPayload.length,
                reason: "barge-in (speech_started)",
              });
            }
            // vadActive:true confirms server_vad is working — this event only
            // fires when OpenAI VAD detects speech.  If absent, mic audio is
            // not reaching OpenAI.
            hsLog("IN ", "input_audio_buffer.speech_started", {
              audio_start_ms: msg.audio_start_ms,
              item_id: msg.item_id,
              payloadBytes: raw.length,
              appendPacketsSoFar: appendPktCount,
              schedulerReset: true,
              vadActive: true,
              activeResponseId: currentResponseId || "none",
            });
            return;
          }

          if (msg.type === "input_audio_buffer.speech_stopped") {
            // Record the moment speech ends — t0 reference for TTFA below.
            // Also captured in turnSpeechStopAt which persists to response.done.
            const now = performance.now();
            speechStoppedAt = now;
            turnSpeechStopAt = now;
            const speechDurationMs = speechStartedAt !== null
              ? (speechStoppedAt - speechStartedAt).toFixed(0)
              : "n/a";
            // input_audio_buffer.commit: NOT sent by the client in server_vad
            // mode.  OpenAI auto-commits the buffer when VAD detects
            // end-of-speech and sends input_audio_buffer.committed (logged
            // below).  The client never sends input_audio_buffer.commit.
            hsLog("IN ", "input_audio_buffer.speech_stopped", {
              audio_end_ms: msg.audio_end_ms,
              item_id: msg.item_id,
              payloadBytes: raw.length,
              tOffset_ms: (speechStoppedAt - t0).toFixed(0),
              speechDurationMs,
              commitSentByClient: false,
            });
            return;
          }

          if (msg.type === "input_audio_buffer.committed") {
            hsLog("IN ", "input_audio_buffer.committed", {
              item_id: msg.item_id,
              previous_item_id: msg.previous_item_id,
            });
            return;
          }

          // ── Response lifecycle
          if (msg.type === "response.created") {
            const resp = msg.response as Record<string, unknown> | undefined;
            currentResponseId = (resp?.id as string) ?? "";
            isResponseInProgress = true;
            deltaCountForResponse = 0;
            responseCreatedAt = performance.now();
            // Reset audio delta accumulators for this response.
            firstAudioDeltaAt = null;
            audioDeltaCount = 0;
            audioDeltaByteTotal = 0;
            // lagFromSpeechStop: covers silence_duration_ms (200ms) + VAD
            // commit + relay round-trip.  Typical range: 200–500ms.
            // n/a on the greeting (no preceding speech_stopped event).
            const lagFromSpeechStop = speechStoppedAt !== null
              ? `${(responseCreatedAt - speechStoppedAt).toFixed(0)}ms`
              : "n/a (greeting)";
            hsLog("IN ", "response.created", {
              response_id: currentResponseId,
              payloadBytes: raw.length,
              lagFromSpeechStop,
            });
            return;
          }

          if (msg.type === "response.output_item.added") {
            const item = msg.item as Record<string, unknown> | undefined;
            hsLog("IN ", "response.output_item.added", {
              response_id: msg.response_id ?? currentResponseId,
              output_index: msg.output_index,
              item_id: item?.id,
              item_type: item?.type,
              item_role: item?.role,
              payloadBytes: raw.length,
            });
            return;
          }

          if (msg.type === "response.done") {
            const resp = msg.response as Record<string, unknown> | undefined;
            const usage = resp?.usage as Record<string, unknown> | undefined;
            const tDone = performance.now();
            const capturedResponseCreatedAt = responseCreatedAt;
            const responseDurationMs = capturedResponseCreatedAt !== null
              ? (tDone - capturedResponseCreatedAt).toFixed(0)
              : "n/a";
            responseCreatedAt = null;
            isResponseInProgress = false;
            // ── Exact token cost for this turn ────────────────────────────
            const inputDetails  = usage?.input_token_details  as { text_tokens?: number; audio_tokens?: number } | undefined;
            const outputDetails = usage?.output_token_details as { text_tokens?: number; audio_tokens?: number } | undefined;
            const turnCostUsd = calcHyperStreamTurnCost(
              realtimeModel,
              inputDetails,
              outputDetails,
              usage?.input_tokens  as number | undefined,
              usage?.output_tokens as number | undefined,
            );
            callExactCostUsd += turnCostUsd;
            setHsExactCostUsd(callExactCostUsd);
            hsLog("IN ", "response.done", {
              response_id: resp?.id,
              status: resp?.status,
              payloadBytes: raw.length,
              audioDeltas: deltaCountForResponse,
              audioDeltaByteTotal,
              inputTokens:    usage?.input_tokens,
              outputTokens:   usage?.output_tokens,
              audioInTokens:  inputDetails?.audio_tokens,
              textInTokens:   inputDetails?.text_tokens,
              audioOutTokens: outputDetails?.audio_tokens,
              textOutTokens:  outputDetails?.text_tokens,
              turnCostUsd:    `$${turnCostUsd.toFixed(6)}`,
              callTotalUsd:   `$${callExactCostUsd.toFixed(6)}`,
              responseDurationMs,
            });

            // ── Turn timeline report ──────────────────────────────────────
            // Printed at every response.done so each turn has a complete
            // latency breakdown visible in the console.
            // Reference point: turnSpeechStopAt (when user stopped speaking).
            // n/a for greeting responses (no speech_stopped preceded them).
            const ref = turnSpeechStopAt;
            const fmtMs = (t: number | null): string =>
              t !== null ? `t0+${(t - t0).toFixed(0)}ms` : "n/a";
            const fmtDelta = (t: number | null, base: number | null): string =>
              t !== null && base !== null
                ? `${t >= base ? "+" : ""}${(t - base).toFixed(0)}ms`
                : "n/a";

            const stopToCreated =
              ref !== null && capturedResponseCreatedAt !== null
                ? `${(capturedResponseCreatedAt - ref).toFixed(0)}ms`
                : "n/a";
            const createdToAudio =
              capturedResponseCreatedAt !== null && firstAudioDeltaAt !== null
                ? `${(firstAudioDeltaAt - capturedResponseCreatedAt).toFixed(0)}ms`
                : "n/a";
            const totalTurnLatency =
              ref !== null && firstAudioDeltaAt !== null
                ? `${(firstAudioDeltaAt - ref).toFixed(0)}ms`
                : "n/a";

            console.groupCollapsed(
              `[HS turn] response_id=${resp?.id ?? "?"} ` +
              `stop→created=${stopToCreated}  created→audio=${createdToAudio}  ` +
              `total=${totalTurnLatency}  duration=${responseDurationMs}ms`,
            );
            console.log("  User Starts Speaking  ", fmtMs(turnSpeechStartAt),  fmtDelta(turnSpeechStartAt, ref));
            console.log("  User Stops Speaking   ", fmtMs(ref),                "(reference)");
            console.log("  Response Created      ", fmtMs(capturedResponseCreatedAt), fmtDelta(capturedResponseCreatedAt, ref));
            console.log("  First Audio Delta     ", fmtMs(firstAudioDeltaAt),  fmtDelta(firstAudioDeltaAt, ref));
            console.log("  Response Done         ", fmtMs(tDone),              fmtDelta(tDone, ref));
            console.log("  ──────────────────────────────────────────────────────");
            console.log("  Speech Stop → Response Created  :", stopToCreated);
            console.log("  Response Created → First Audio  :", createdToAudio);
            console.log("  Total Turn Latency (stop→audio) :", totalTurnLatency);
            console.log("  Response Duration               :", `${responseDurationMs}ms`);
            console.log("  Audio deltas / total bytes      :", `${audioDeltaCount} / ${audioDeltaByteTotal}B`);
            console.log("  Input tokens / Output tokens    :", usage?.input_tokens, "/", usage?.output_tokens);
            console.log("  Audio in / text in tokens       :", inputDetails?.audio_tokens, "/", inputDetails?.text_tokens);
            console.log("  Audio out / text out tokens     :", outputDetails?.audio_tokens, "/", outputDetails?.text_tokens);
            console.log("  Turn cost (exact)               :", `$${turnCostUsd.toFixed(6)}`);
            console.log("  Call cumulative cost            :", `$${callExactCostUsd.toFixed(6)}`);
            console.groupEnd();

            // Clear turn timeline refs for next turn.
            turnSpeechStartAt = null;
            turnSpeechStopAt  = null;
            firstAudioDeltaAt = null;
            return;
          }

          // ── Interruption confirmation ─────────────────────────────────────
          // OpenAI sends response.cancelled when interrupt_response:true fires
          // (i.e. server_vad detected speech mid-response and auto-cancelled).
          // Seeing this event confirms barge-in is working end-to-end.
          // If this never appears during a barge-in, interrupt_response is not
          // being honoured by the model — check the session.update config.
          if (msg.type === "response.cancelled") {
            const resp = msg.response as Record<string, unknown> | undefined;
            isResponseInProgress = false;
            hsLog("IN ", "response.cancelled", {
              response_id: resp?.id ?? msg.response_id,
              interruptConfirmed: true,
            });
            return;
          }

          // ── Phase 3: Tool execution through Core Runtime ──────────────────
          // OpenAI fires this event when it has finished streaming all arguments
          // for a function call.  Route through the Core Runtime tool executor,
          // return the result as a function_call_output conversation item, then
          // re-trigger response generation so the agent can continue the turn.
          if (msg.type === "response.function_call_arguments.done") {
            const toolName = typeof msg.name === "string" ? msg.name : "";
            const callId = typeof msg.call_id === "string" ? msg.call_id : "";
            const argsStr = typeof msg.arguments === "string" ? msg.arguments : "{}";
            toolCallStartedAt = performance.now();
            const callReceivedAt = toolCallStartedAt;
            hsLog("IN ", "response.function_call_arguments.done", {
              tool: toolName,
              call_id: callId,
              argsBytes: argsStr.length,
              // Tool execution is async (.then) — does NOT block the onmessage
              // handler or response generation for other turns.
              nonBlocking: true,
            });
            let toolArgs: unknown;
            try {
              toolArgs = JSON.parse(argsStr);
            } catch {
              toolArgs = {};
            }
            // executeToolCall always resolves — errors are returned as a result
            // string so the session can continue instead of hanging.
            executeToolCall(toolName, toolArgs, runtimeDef.tools)
              .then((result) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                const outputPayload = JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: callId,
                    output: result.output,
                  },
                });
                ws.send(outputPayload);
                const resumePayload = JSON.stringify({ type: "response.create" });
                ws.send(resumePayload);
                hsLog("OUT", "function_call_output", {
                  tool: toolName,
                  call_id: callId,
                  outputBytes: result.output.length,
                  toolDurationMs: (performance.now() - callReceivedAt).toFixed(0),
                  error: result.error ?? null,
                });
              })
              .catch((err: unknown) => {
                console.error("[hyperstream] executeToolCall failed:", err);
              });
            return;
          }

          // ── Decode and schedule AI audio playback.
          // GA Realtime renamed "response.audio.delta" → "response.output_audio.delta".
          if (
            (msg.type === "response.output_audio.delta" ||
              msg.type === "response.audio.delta") &&
            typeof msg.delta === "string"
          ) {
            deltaCountForResponse += 1;
            audioDeltaCount += 1;
            const deltaB64 = msg.delta as string;
            audioDeltaByteTotal += deltaB64.length;
            const now = performance.now();

            if (deltaCountForResponse === 1) {
              // ── First delta: compute TTFA and record timeline anchor ────
              firstAudioDeltaAt = now;
              const ttfa = speechStoppedAt !== null
                ? `${(now - speechStoppedAt).toFixed(0)}ms`
                : "n/a (greeting)";
              hsLog("IN ", msg.type as string, {
                seq: deltaCountForResponse,
                response_id: msg.response_id ?? currentResponseId,
                payloadBytes: raw.length,
                deltaBytes: deltaB64.length,
                ttfa_ms: ttfa,
              });
              // Clear so next turn gets a fresh TTFA measurement.
              speechStoppedAt = null;
            } else {
              // ── Subsequent deltas: log every event per trace requirement ─
              hsLog("IN ", msg.type as string, {
                seq: deltaCountForResponse,
                response_id: msg.response_id ?? currentResponseId,
                payloadBytes: raw.length,
                deltaBytes: deltaB64.length,
                totalBytes: audioDeltaByteTotal,
              });
            }

            const ctx = audioCtxRef.current;
            if (!ctx) return;
            // Resume if suspended (belt-and-suspenders — the keep-alive
            // oscillator should prevent suspension, but just in case).
            if (ctx.state === "suspended") {
              hsLog("   ", "AudioContext suspended on delta — resuming");
              void ctx.resume();
            }
            const binaryStr = atob(msg.delta as string);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++)
              bytes[i] = binaryStr.charCodeAt(i);
            const int16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
            const buf = ctx.createBuffer(1, float32.length, 24000);
            buf.copyToChannel(float32, 0);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            // Jitter buffer: start 25 ms ahead of now on the first chunk so
            // single-packet network jitter can't cause audible gaps or crackle.
            // 25 ms is sufficient for the local relay; 80 ms was over-provisioned.
            const JITTER = 0.025;
            const startAt =
              nextPlayTimeRef.current > ctx.currentTime
                ? nextPlayTimeRef.current
                : ctx.currentTime + JITTER;
            src.start(startAt);
            nextPlayTimeRef.current = startAt + buf.duration;
          }

          // ── Audio stream complete ─────────────────────────────────────────
          // response.output_audio.done fires when ALL audio deltas for a
          // response have been delivered.  Logs the total delta count and byte
          // total so we know the full audio stream was received intact.
          if (
            msg.type === "response.output_audio.done" ||
            msg.type === "response.audio.done"
          ) {
            hsLog("IN ", msg.type as string, {
              response_id: msg.response_id ?? currentResponseId,
              payloadBytes: raw.length,
              totalDeltasSoFar: audioDeltaCount,
              totalBytesSoFar: audioDeltaByteTotal,
            });
            return;
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = (ev) => {
        console.log(
          `[hyperstream] browser ws.onclose code=${ev.code} reason="${ev.reason}" wasClean=${ev.wasClean}`,
        );
        recordCurrentCallCost();
        setInCall(false);
        setActiveNode(null);
        startedAtRef.current = null;
        setCalling(false);
        cleanupHyperStream();
      };

      ws.onerror = (ev) => {
        console.error("[hyperstream] browser ws.onerror", ev);
        toast.error("HyperStream connection failed");
        setCalling(false);
        cleanupHyperStream();
      };
    } catch (e) {
      toast.error("HyperStream test call failed", {
        description: (e as Error).message,
      });
      setCalling(false);
      cleanupHyperStream();
    }
  }

  function endCall() {
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
    // Persist to server-side spend cap and refresh meter.
    recordCost({ data: { seconds } })
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
      loadFlow(parsed);
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
      await upsertAgent({
        data: {
          id: existing?.id,
          retellAgentId,
          name: s.agentName || "Untitled agent",
          flowData: { nodes: n, edges: e } as never,
          settings: s as never,
          variables: v as never,
        },
      });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
    } catch (err) {
      console.warn("persistAgent failed:", (err as Error).message);
    }
  }

  return (
    <>
      {/* Deploy / utility cluster */}
      <div className="flex items-center gap-0.5 rounded-md border border-white/[0.05] bg-white/[0.02] px-1 py-0.5">
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
            onClick={isOpenAI ? handleHyperStreamTestCall : handleTestCall}
            disabled={!hasAgent || (!isOpenAI && overLimit)}
            className="!h-8 !w-8 !p-0 text-muted-foreground/60 hover:bg-violet-500/10 hover:text-violet-300 disabled:opacity-40"
            title={
              !hasAgent
                ? "Save the agent first"
                : !isOpenAI && overLimit
                  ? `Spend cap reached ($${(spendUsedCents / 100).toFixed(2)} / $${(spendLimitCents / 100).toFixed(2)}).`
                  : isOpenAI
                    ? "Test HyperStream agent (browser WebRTC)"
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
        <div className="h-3.5 w-px bg-white/[0.07] mx-0.5" />

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
              This agent routes through the OpenAI Realtime engine. Retell provisioning is skipped —
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
          className="flex h-8 items-center gap-1.5 rounded-md border border-white/[0.05] bg-white/[0.02] px-2 text-[10px] font-medium text-foreground/70"
          title={costIsExact ? "Exact OpenAI token cost (audio + text tokens from response.done)" : `Estimated test-call spend @ $${costPerMinute.toFixed(3)}/min`}
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
            {costIsExact ? "· token-exact" : `· ~$${costPerMinute.toFixed(3)}/min est.`}
          </span>
        </div>
      )}
    </>
  );
}
