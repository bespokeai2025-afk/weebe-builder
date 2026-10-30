/** HyperStream in-browser test call over WebRTC/WebSocket. Moved out of RetellDeployDialog unchanged; see deploy/test-call-session.ts. */
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useBuilderStore } from "@/lib/builder/store";
import { buildAgentRuntimeDefinition } from "@/lib/runtime/export";
import { extractOpenAIParams } from "@/lib/runtime/import";
import type { OpenAIExecutionParams } from "@/lib/runtime/import";
import { buildOpenAIToolDefinitions, executeToolCall } from "@/lib/runtime/tool-executor";
import type { AgentRuntimeDefinition } from "@/lib/runtime/schema";
import { calcHyperStreamTurnCost } from "@/lib/builder/pricing";
import { buildHyperStreamBookingTools } from "@/lib/calendar/hyperstream-booking-tools";
import type { TestCallSession } from "./test-call-session";

export async function runHyperStreamTestCall(session: TestCallSession): Promise<void> {
  const {
    activeSourceNodesRef,
    audioCtxRef,
    callCostUsdRef,
    callEndFiredRef,
    captureSinkRef,
    channelTypeRef,
    cost,
    currentAgentRowId,
    edges,
    emitDebug,
    endReasonRef,
    finalizeRecording,
    hsExactCostUsd,
    hsSessionIdRef,
    keepAliveRef,
    masterGainRef,
    nextPlayTimeRef,
    nodes,
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
    startedAtRef,
    streamRef,
    transcript,
    variables,
    workletRef,
    wsRelayRef,
  } = session;
  const rowId = currentAgentRowId ?? (settings.agentId as string | null);
  if (!rowId) {
    toast.error("Save the agent first", {
      description: "Click the + button to save before testing",
    });
    return;
  }
  callEndFiredRef.current = false;
  setCalling(true);
  setHsExactCostUsd(null);

  function cleanupHyperStream() {
    // Stop all scheduled audio immediately so nothing plays after hangup.
    for (const node of activeSourceNodesRef.current) {
      try { node.stop(); } catch { /* already ended — ignore */ }
    }
    activeSourceNodesRef.current = [];
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

    // Guard against a race where relay.connected / session.created arrive
    // during the AudioWorklet addModule() await below (which yields the
    // event loop).  Buffer those messages so none are silently dropped.
    ws.binaryType = "arraybuffer";
    const pendingMessages: MessageEvent[] = [];
    ws.onmessage = (ev) => pendingMessages.push(ev);

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

    // Echo cancellation is CRITICAL: without it the mic picks up the AI's
    // speaker output, VAD fires on the AI's own voice, and the model
    // "responds" to itself — causing repetition, false input detection,
    // and the apparent 37-second silence gap on the first turn.
    //
    // autoGainControl is intentionally OFF: AGC normalises the mic level
    // toward a target loudness, which means it boosts background noise
    // between turns to speech levels — making OpenAI's VAD unable to
    // distinguish noise from speech. Without AGC the mic level is stable
    // and consistent; semantic_vad can reliably detect actual speech.
    //
    // channelCount:1 forces mono capture so the worklet never receives
    // an empty first channel (some browsers give the non-primary channel
    // in index 0 for stereo mic configurations).
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 24000,
      },
    });
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

    // ── Mic gate: mute while AI is speaking ──────────────────────────────
    // Browser echo cancellation (echoCancellation: true on getUserMedia)
    // cancels room echo using the OS audio reference, but it cannot always
    // cancel Web Audio API output with the variable jitter delay we apply
    // (80–250 ms).  The reliable fix: don't send mic audio to OpenAI while
    // the AI is playing back, then clear the buffer before unblocking.
    // This makes the call half-duplex (no barge-in) but eliminates the
    // false-speech transcriptions caused by the AI hearing its own voice.
    let isAISpeaking = false;
    let aiSpeakingDrainTimer: ReturnType<typeof setTimeout> | null = null;
    const unmuteMic = () => {
      isAISpeaking = false;
      // Discard any echo that seeped into the buffer while AI was speaking.
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "input_audio_buffer.clear" })); } catch { /* non-fatal */ }
      }
      hsLog("   ", "mic.unmuted", {});
    };

    // Convert an Int16 PCM buffer → base64 and stream to OpenAI.
    const sendPcm = (int16: Int16Array) => {
      if (!sessionReady || ws.readyState !== WebSocket.OPEN) return;
      if (isAISpeaking) return; // mic gate — discard echo while AI plays back
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
        // Do NOT connect the worklet output to audioCtx.destination.
        // Routing mic audio into the AudioContext output graph causes the
        // browser's AEC to see the user's own voice in the speaker output
        // and cancel it — suppressing the user's speech while AI echo
        // passes through unchanged.
        //
        // AudioWorklet nodes with process() returning true are kept alive
        // by the spec even without output connections, as long as they have
        // active inputs (our MediaStreamSource provides audio continuously).
        // The keep-alive oscillator keeps the rendering thread running.
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

    // ── Recording setup ───────────────────────────────────────────────────
    // masterGain routes all AI audio to both speakers (ctx.destination) and
    // the MediaRecorder.  Mic audio goes to the recorder only (not to
    // playback — would cause echo even with echoCancellation enabled).
    try {
      const recDest = audioCtx.createMediaStreamDestination();
      const masterGain = audioCtx.createGain();
      masterGain.connect(audioCtx.destination);
      masterGain.connect(recDest);
      masterGainRef.current = masterGain;
      source.connect(recDest); // mic → record only
      const recorder = new MediaRecorder(recDest.stream);
      recChunksRef.current = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
    } catch { /* recording not supported in this browser — continue */ }

    // Holds the full tool list (runtime tools + booking tools) once the
    // relay.connected session is set up. Used by executeToolCall so it can
    // find the `url` field on booking tools even though those arrive after
    // the session.update and are not in the original runtimeDef.tools.
    let activeTools: typeof runtimeDef.tools = runtimeDef.tools;

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
          // Merge Cal.com booking tools into the session tools when booking is
          // enabled. We append them here (after runtime export) so we don't
          // interfere with the Core Runtime schema and Retell flows.
          const hsBookingSettings = (useBuilderStore.getState().settings as unknown as Record<string, unknown>);
          const bookingEnabled = (hsBookingSettings.booking as Record<string, unknown> | undefined)?.enabled === true;
          const hsAgentId = useBuilderStore.getState().currentAgentRowId;
          const allTools = bookingEnabled && hsAgentId
            ? [...runtimeDef.tools, ...buildHyperStreamBookingTools(hsAgentId)]
            : runtimeDef.tools;
          activeTools = allTools as typeof runtimeDef.tools;

          // Push the full tool registry (including URL fields that are stripped
          // before session.update reaches OpenAI) to the relay so it can execute
          // tools server-side in deployed-agent mode.  The relay intercepts this
          // message and never forwards it to OpenAI.
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "relay.tool_registry",
              tools: (allTools as Array<Record<string, unknown>>).map((t) => ({
                name: t.name ?? "",
                tool_type: t.tool_type ?? null,
                url: t.url ?? null,
                api_url: t.api_url ?? null,
              })),
            }));
          }

          const toolDefs = buildOpenAIToolDefinitions(allTools as typeof runtimeDef.tools);
          hsLog("   ", "runtime.tool.build.complete", {
            durationMs: (performance.now() - toolBuildStart).toFixed(0),
            toolCount: toolDefs.length,
            bookingTools: bookingEnabled ? 5 : 0,
          });
          const hsSettings = useBuilderStore.getState().settings;
          // Default to semantic_vad — it understands natural conversation boundaries
          // far better than server_vad for multi-step flows and won't trigger on brief
          // pauses mid-sentence. "low" eagerness means the model waits longer before
          // deciding the user has finished speaking, preventing premature responses.
          const tdMode = hsSettings.hyperstreamTurnDetection ?? "semantic_vad";
          const turnDetectionConfig =
            tdMode === "semantic_vad"
              ? {
                  type: "semantic_vad" as const,
                  eagerness: hsSettings.hyperstreamEagerness ?? "low",
                  create_response: true,
                  interrupt_response: true,
                }
              : {
                  type: "server_vad" as const,
                  threshold: hsSettings.hyperstreamVadThreshold ?? 0.5,
                  prefix_padding_ms: hsSettings.hyperstreamPrefixPaddingMs ?? 200,
                  silence_duration_ms: hsSettings.hyperstreamSilenceDurationMs ?? 800,
                  create_response: true,
                  interrupt_response: true,
                };

          const inputConfig: Record<string, unknown> = {
            transcription: { model: hsSettings.hyperstreamTranscriptionModel ?? "whisper-1" },
            turn_detection: turnDetectionConfig,
          };
          if (
            hsSettings.hyperstreamNoiseReduction &&
            hsSettings.hyperstreamNoiseReduction !== "none"
          ) {
            inputConfig.noise_reduction = { type: hsSettings.hyperstreamNoiseReduction };
          }

          // When booking is enabled, append the agent_id hint so the model
          // knows which value to pass in every booking tool call.
          let instructions = params.systemPrompt;
          if (bookingEnabled && hsAgentId) {
            instructions +=
              `\n\n# Calendar booking tools\nYour agent_id is "${hsAgentId}". ` +
              `Include this exact value as the "agent_id" argument in every booking ` +
              `tool call (get_event_types, check_availability, book_appointment, ` +
              `cancel_appointment, reschedule_appointment). Never omit it.`;
          }

          const sessionConfig: Record<string, unknown> = {
            type: "realtime",
            output_modalities: ["audio"],
            instructions,
            audio: {
              input: inputConfig,
              output: {
                voice: params.voice,
              },
            },
          };
          // Cap tokens per response — prevents the model from speaking multiple
          // conversation steps in one turn. 200 tokens ≈ 2–3 sentences, enough
          // for one step but not enough to race through the entire script.
          sessionConfig.max_response_output_tokens =
            hsSettings.hyperstreamMaxTokens ?? 200;
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
          // Clear any ambient noise that accumulated in the audio buffer
          // during AudioWorklet setup (before sessionReady was true).
          // Prevents stale mic audio from contaminating the first VAD window.
          try {
            const clearPayload = JSON.stringify({ type: "input_audio_buffer.clear" });
            ws.send(clearPayload);
            hsLog("OUT", "input_audio_buffer.clear", { reason: "pre-greeting flush" });
          } catch { /* non-fatal */ }
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
          pushTranscript([]);
          setHsExactCostUsd(null);
          // Reset per-call metadata refs.
          endReasonRef.current = "agent_hangup";
          hsSessionIdRef.current = crypto.randomUUID();
          callCostUsdRef.current = undefined;
          channelTypeRef.current = "web";
          callEndFiredRef.current = false;
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

        // relay.tool_executed is sent by the relay in deployed-agent mode when
        // it has executed a booking tool server-side. The browser should NOT
        // also call executeToolCall for this event — just log it for debugging.
        if (msg.type === "relay.tool_executed") {
          hsLog("IN ", "relay.tool_executed", {
            tool: msg.tool,
            call_id: msg.call_id,
            resultBytes: typeof msg.result === "string" ? msg.result.length : 0,
          });
          emitDebug("tool", `Tool ${String(msg.tool ?? "unknown")} ran`, {
            detail: { call_id: msg.call_id },
          });
          return;
        }

        // Forward OpenAI-native error events so they aren't silently swallowed.
        if (msg.type === "error") {
          const detail = String(
            (msg.error as Record<string, unknown> | undefined)?.message
              ?? msg.message
              ?? "Unknown error"
          );
          hsLog("IN ", "error", { detail: detail.slice(0, 120) });
          // "Cancellation failed: no active response found" is a benign race
          // between our explicit response.cancel and OpenAI's own
          // interrupt_response:true auto-cancel — both fire simultaneously and
          // the server-side one wins.  Log it but never surface it as a toast.
          if (detail.toLowerCase().includes("cancellation failed")) return;
          toast.error("HyperStream session error", { description: detail });
          return;
        }

        // ── Speech detection events (confirms user audio is reaching OpenAI VAD)
        if (msg.type === "input_audio_buffer.speech_started") {
          // ── Interruption / barge-in support ──────────────────────────
          // Stop every already-scheduled AudioBufferSourceNode NOW so the
          // old response's audio cuts off the instant the user speaks.
          // Without this, old and new audio play simultaneously → overlap.
          for (const node of activeSourceNodesRef.current) {
            try { node.stop(); } catch { /* already ended */ }
          }
          activeSourceNodesRef.current = [];
          nextPlayTimeRef.current = 0;
          const now = performance.now();
          speechStartedAt = now;
          turnSpeechStartAt = now;
          // Reset audio accumulators for the new turn.
          firstAudioDeltaAt = null;
          audioDeltaCount = 0;
          audioDeltaByteTotal = 0;
          // If the mic gate is somehow still active (e.g. drain timer hasn't
          // fired yet), open it immediately — the VAD already heard speech.
          if (isAISpeaking) {
            if (aiSpeakingDrainTimer !== null) { clearTimeout(aiSpeakingDrainTimer); aiSpeakingDrainTimer = null; }
            isAISpeaking = false;
            hsLog("   ", "mic.unmuted", { reason: "speech_started barge-in" });
          }
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
          // Show a live "speaking…" bubble in the transcript panel.
          const speakItemId = typeof msg.item_id === "string" ? msg.item_id : crypto.randomUUID();
          pushTranscript((prev) => [
            ...prev,
            { id: `user-${speakItemId}`, role: "user", text: "speaking…", partial: true },
          ]);
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
          // Keep the "speaking…" bubble as partial — it will be replaced
          // with the real transcript text when
          // conversation.item.input_audio_transcription.completed fires.
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
          // Stop any audio still playing from the PREVIOUS response.
          // This covers two cases:
          //   (a) User barges in while AI is mid-sentence (response.cancelled
          //       arrives first, but audio may still be draining).
          //   (b) Back-to-back turns where response.done fired but audio was
          //       still scheduled into the future when the new turn starts.
          for (const node of activeSourceNodesRef.current) {
            try { node.stop(); } catch { /* already ended */ }
          }
          activeSourceNodesRef.current = [];
          nextPlayTimeRef.current = 0;
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
          // ── Unmute mic once queued audio finishes playing ─────────────
          // Wait for the scheduled audio buffer to drain + 300 ms echo-tail
          // before re-opening the mic gate so the AI's last word doesn't
          // get picked up by the mic as "user speech".
          {
            const ctx = audioCtxRef.current;
            const remainingMs = ctx && nextPlayTimeRef.current > ctx.currentTime
              ? (nextPlayTimeRef.current - ctx.currentTime) * 1000
              : 0;
            const ECHO_TAIL_MS = 300;
            if (aiSpeakingDrainTimer !== null) clearTimeout(aiSpeakingDrainTimer);
            aiSpeakingDrainTimer = setTimeout(() => {
              aiSpeakingDrainTimer = null;
              unmuteMic();
            }, remainingMs + ECHO_TAIL_MS);
          }
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
          // AI response cancelled (barge-in) — unmute mic immediately so the
          // user's ongoing speech flows through without delay.
          if (aiSpeakingDrainTimer !== null) { clearTimeout(aiSpeakingDrainTimer); aiSpeakingDrainTimer = null; }
          unmuteMic();
          hsLog("IN ", "response.cancelled", {
            response_id: resp?.id ?? msg.response_id,
            interruptConfirmed: true,
          });
          return;
        }

        // ── Live transcript events ────────────────────────────────────────
        // response.output_audio_transcript.delta: OpenAI streams the agent's
        // speech-to-text transcript in real time as audio is generated.
        if (msg.type === "response.output_audio_transcript.delta") {
          const respId = (msg.response_id as string) ?? currentResponseId;
          const delta = typeof msg.delta === "string" ? msg.delta : "";
          if (delta) {
            pushTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "agent" && last.id === respId && last.partial) {
                return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
              }
              return [...prev, { id: respId, role: "agent", text: delta, partial: true }];
            });
          }
          return;
        }

        // response.output_audio_transcript.done: agent turn text complete.
        if (msg.type === "response.output_audio_transcript.done") {
          const respId = (msg.response_id as string) ?? currentResponseId;
          pushTranscript((prev) => {
            // Find last agent entry with this response id and mark it done.
            let found = false;
            return prev.map((e) => {
              if (!found && e.role === "agent" && e.id === respId) {
                found = true;
                return { ...e, partial: false };
              }
              return e;
            });
          });
          return;
        }

        // User speech transcription — replaces the live "speaking…" bubble
        // with the real transcribed text once Whisper finishes.
        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          const text = typeof msg.transcript === "string" ? msg.transcript.trim() : "";
          const itemId = typeof msg.item_id === "string" ? msg.item_id : crypto.randomUUID();
          if (text) {
            pushTranscript((prev) => {
              const targetId = `user-${itemId}`;
              const idx = prev.findIndex((e) => e.id === targetId);
              if (idx !== -1) {
                // Replace the placeholder bubble with the real transcript
                const updated = [...prev];
                updated[idx] = { id: targetId, role: "user", text, partial: false };
                return updated;
              }
              // Bubble not found (race) — append it
              return [...prev, { id: targetId, role: "user", text, partial: false }];
            });
          }
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
          executeToolCall(toolName, toolArgs, activeTools)
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
            // ── First delta: mute mic + clear uncommitted buffer ─────────
            // Cancel any in-flight drain timer so we don't unmute early.
            if (aiSpeakingDrainTimer !== null) {
              clearTimeout(aiSpeakingDrainTimer);
              aiSpeakingDrainTimer = null;
            }
            isAISpeaking = true;
            hsLog("   ", "mic.muted", { reason: "AI audio started" });
            // Also clear anything in the uncommitted buffer that accumulated
            // while the LLM was "thinking" — it may contain echo from the
            // previous turn.
            try { ws.send(JSON.stringify({ type: "input_audio_buffer.clear" })); } catch { /* non-fatal */ }

            // ── Compute TTFA and record timeline anchor ─────────────────
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
          src.connect(masterGainRef.current ?? ctx.destination);
          // Track so we can stop this node instantly on barge-in or new response.
          activeSourceNodesRef.current.push(src);
          src.onended = () => {
            const arr = activeSourceNodesRef.current;
            const idx = arr.indexOf(src);
            if (idx !== -1) arr.splice(idx, 1);
          };
          // Two-tier jitter buffer:
          // • First chunk (deltaCountForResponse === 1): 80 ms startup delay.
          //   Barely perceptible but ensures the first few burst-delivered deltas
          //   are already queued before playback starts, preventing an immediate
          //   underrun when OpenAI delivers chunks slower than real-time.
          // • Underrun recovery (scheduler fell behind ctx.currentTime): 250 ms.
          //   When generation rate < real-time playback rate, the scheduler will
          //   occasionally catch up to ctx.currentTime. A 250 ms recovery window
          //   gives the model enough lead time so subsequent chunks arrive before
          //   the buffer empties again — turning two audible ~120 ms cuts into a
          //   single inaudible re-sync.
          const JITTER = deltaCountForResponse === 1 ? 0.080 : 0.250;
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

    // Drain messages that arrived during the AudioWorklet setup await
    for (const ev of pendingMessages) ws.onmessage!(ev);

    ws.onclose = (ev) => {
      // Only override if the user didn't explicitly hang up.
      if (endReasonRef.current !== "user_hangup") {
        endReasonRef.current = ev.code === 1000 ? "agent_hangup" : "connection_error";
      }
      callCostUsdRef.current = callCostUsdRef.current ?? (hsExactCostUsd ?? undefined);
      finalizeRecording();
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
