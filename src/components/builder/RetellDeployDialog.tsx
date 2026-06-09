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
import { compileRealtimePrompt } from "@/lib/builder/compile-realtime-prompt";
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
import { getTotalCostPerMinute, getHyperStreamCostPerMinute } from "@/lib/builder/pricing";

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

  const [deploying, setDeploying] = useState<"create" | "update" | null>(null);
  const [openaiConfirmOpen, setOpenaiConfirmOpen] = useState(false);
  const [openaiDeploying, setOpenaiDeploying] = useState(false);
  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
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
  const isOpenAI = settings.voiceProvider === "OPENAI_REALTIME";

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

    function cleanupHyperStream() {
      processorRef.current?.disconnect();
      processorRef.current = null;
      workletRef.current?.disconnect();
      workletRef.current = null;
      captureSinkRef.current?.disconnect();
      captureSinkRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
      wsRelayRef.current?.close();
      wsRelayRef.current = null;
      nextPlayTimeRef.current = 0;
    }

    try {
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(
        `${wsProto}//${window.location.host}/api/hyperstream-relay?agentRowId=${encodeURIComponent(rowId)}`,
      );
      wsRelayRef.current = ws;

      // 24 kHz mono — matches OpenAI Realtime PCM16 format.
      const audioCtx = new AudioContext({ sampleRate: 24000 });
      // Browsers don't always honor the requested 24 kHz. The worklet resamples
      // capture to a guaranteed 24 kHz, but log the real rate for diagnostics.
      console.log(
        `[hyperstream] AudioContext sampleRate=${audioCtx.sampleRate} (requested 24000)`,
      );
      audioCtxRef.current = audioCtx;
      nextPlayTimeRef.current = 0;

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = micStream;

      const source = audioCtx.createMediaStreamSource(micStream);

      let sessionReady = false;

      // Convert an Int16 PCM buffer → base64 and stream to OpenAI.
      const sendPcm = (int16: Int16Array) => {
        if (!sessionReady || ws.readyState !== WebSocket.OPEN) return;
        const uint8 = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: btoa(binary) }));
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
                this._buf = new Int16Array(2400);
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
            // Configure the session. Wait for session.updated before
            // streaming mic audio — avoids sending audio before OpenAI
            // has applied the configuration.
            //
            // IMPORTANT: OpenAI Realtime session.update uses a FLAT schema —
            // turn_detection, voice, and audio formats are all top-level fields
            // on `session`, NOT nested under audio.input / audio.output.
            // Using a nested schema causes OpenAI to silently ignore turn_detection,
            // leaving the session in manual mode (no VAD → user speech never triggers
            // a response after the greeting).
            ws.send(
              JSON.stringify({
                type: "session.update",
                session: {
                  // Schema derived from session.created response (gpt-realtime model).
                  // This model uses nested audio.input/output — NOT the flat schema
                  // in the public OpenAI docs. Fields outside this shape are rejected
                  // with "unknown_parameter".
                  type: "realtime",
                  output_modalities: ["audio"],
                  instructions: compileRealtimePrompt(nodes, edges, settings, variables),
                  audio: {
                    input: {
                      turn_detection: {
                        type: "server_vad",
                        threshold: 0.5,
                        prefix_padding_ms: 300,
                        // 300 ms is the OpenAI default — keeps response latency low.
                        silence_duration_ms: 300,
                        create_response: true,
                        interrupt_response: true,
                      },
                    },
                    output: {
                      voice: settings.openaiVoice ?? "alloy",
                    },
                  },
                },
              }),
            );
            return;
          }

          // Session confirmed — safe to start mic streaming and trigger greeting.
          if (msg.type === "session.updated") {
            console.log(
              `[hyperstream] session.updated received, ws.readyState=${ws.readyState}`,
            );
            // Ask the agent to greet the caller FIRST so a re-render can't block it.
            try {
              ws.send(JSON.stringify({ type: "response.create" }));
              console.log("[hyperstream] response.create sent");
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
            toast.error("HyperStream session error", { description: String(detail) });
            return;
          }

          // Decode and schedule AI audio playback.
          // GA Realtime renamed "response.audio.delta" → "response.output_audio.delta".
          if (
            (msg.type === "response.output_audio.delta" ||
              msg.type === "response.audio.delta") &&
            typeof msg.delta === "string"
          ) {
            const ctx = audioCtxRef.current;
            if (!ctx) return;
            // Browser can auto-suspend the AudioContext after a period of
            // inactivity. Resume it before scheduling so audio actually plays.
            if (ctx.state === "suspended") void ctx.resume();
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
            // Small jitter buffer: when playback has caught up (or this is the
            // first chunk), start ~80 ms ahead so network jitter between audio
            // deltas can't cause audible gaps/crackle.
            const JITTER = 0.08;
            const startAt =
              nextPlayTimeRef.current > ctx.currentTime
                ? nextPlayTimeRef.current
                : ctx.currentTime + JITTER;
            src.start(startAt);
            nextPlayTimeRef.current = startAt + buf.duration;
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
    ? getHyperStreamCostPerMinute()
    : getTotalCostPerMinute(settings.model);
  const minutes = elapsedSec / 60;
  const cost = minutes * costPerMinute;
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
          title={`Total test-call spend @ $${costPerMinute.toFixed(2)}/min`}
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
            {inCall ? `· live $${cost.toFixed(3)} ` : ""}· @ ${costPerMinute.toFixed(2)}/min
          </span>
        </div>
      )}
    </>
  );
}
