/** WEBEE Native / ElevenLabs Voice in-browser test call through the cascade relay. Moved out of RetellDeployDialog unchanged; see deploy/test-call-session.ts. */
import { toast } from "sonner";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { buildAgentRuntimeDefinition } from "@/lib/runtime/export";
import { resolveWebeeSpeechModel } from "@/lib/voice/webee-native.shared";
import { AudioPlaybackController } from "@/lib/voice/browser/audio-playback-controller.shared";
import type { TestCallSession } from "./test-call-session";

export async function runCascadeVoiceTestCall(session: TestCallSession): Promise<void> {
  const {
    activeSourceNodesRef,
    audioCtxRef,
    callEndFiredRef,
    captureSinkRef,
    clearDebugEvents,
    currentAgentRowId,
    edges,
    elPlaybackRef,
    emitDebug,
    finalizeRecording,
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
    recorderRef,
    setActiveNode,
    setCalling,
    setElapsedSec,
    setInCall,
    settings,
    startedAtRef,
    streamRef,
    testCallPrepRef,
    transcript,
    variables,
    workletRef,
    wsConnectTimeoutRef,
    wsPingRef,
    wsRelayRef,
  } = session;
  // Both cascade engines share this relay; only the voice catalog differs.
  // Fish takes a model id as `reference_id`, ElevenLabs takes its own voice id.
  const voiceId = (
    isWebeeNative
      ? (settings.webeeVoiceId as string | undefined)
      : (settings.voiceOutputId as string | undefined)
  )?.trim();
  if (!voiceId) {
    toast.error(
      isWebeeNative ? "Select a voice first" : "Select an ElevenLabs voice first",
      {
        description: isWebeeNative
          ? "Choose a voice under Voice Infrastructure → WEBEE Native Voice."
          : "Open the OpenAI Engine panel and choose a voice under Voice Output → ElevenLabs.",
      },
    );
    return;
  }

  const rowId = currentAgentRowId ?? (settings.agentId as string | null);
  if (!rowId) {
    toast.error("Save the agent first", {
      description: "Click the + button to save before testing",
    });
    return;
  }

  callEndFiredRef.current = false;
  setCalling(true);

  // Acquire mic on the user click (autoplay gesture) so AudioContext + capture
  // are ready before the greeting TTS arrives (~2–4s after session.init).
  try {
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
  } catch (err) {
    toast.error("Microphone access required", {
      description: (err as Error).message || "Allow microphone access to test the agent.",
    });
    setCalling(false);
    return;
  }

  function cleanupElVoice() {
    if (wsPingRef.current !== null) { clearInterval(wsPingRef.current); wsPingRef.current = null; }
    if (wsConnectTimeoutRef.current !== null) {
      clearTimeout(wsConnectTimeoutRef.current);
      wsConnectTimeoutRef.current = null;
    }
    finalizeRecording();
    elPlaybackRef.current?.reset();
    elPlaybackRef.current = null;
    for (const node of activeSourceNodesRef.current) {
      try { node.stop(); } catch { /* already ended */ }
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

  // ── Build runtime definition from in-memory builder state ──────────────
  let systemPrompt: string;
  let beginMessage: string;
  try {
    const def = buildAgentRuntimeDefinition({
      agentId: rowId ?? "local-elv-test",
      retellAgentId: null,
      agentName: (settings as unknown as Record<string, unknown>).agentName as string || "Test Agent",
      updatedAt: new Date().toISOString(),
      nodes,
      edges,
      settings,
      variables,
    });
    systemPrompt = def.runtimeConfig.openai?.systemPrompt ?? def.compiledPrompt;
    beginMessage = def.voiceConfig.beginMessage ?? "";
  } catch (err) {
    toast.error("Agent definition error", { description: (err as Error).message });
    setCalling(false);
    return;
  }

  // Export the graph as it stands on screen so the relay's VM walks the flow
  // node by node. Without this the relay only gets the flattened prompt, which
  // is exactly the behaviour the graph VM exists to replace — the test call
  // would skip steps that a deployed call honours. Export failures are not
  // fatal: the relay falls back to the flat prompt.
  let exportedFlow: unknown = undefined;
  try {
    const exported = exportAgentJson(nodes, edges, settings, variables) as Record<string, unknown>;
    exportedFlow = exported.conversationFlow;
  } catch (err) {
    console.warn("[elv-relay] flow export failed, using flat prompt:", (err as Error).message);
  }

  const textModel = isWebeeNative
    ? resolveWebeeSpeechModel(settings as unknown as Record<string, unknown>)
    : (settings.openaiRealtimeModel ?? settings.model ?? "gpt-4.1");
  // Shared with the relay so the stored call row and this session are the same
  // call, which is what lets a test call be inspected afterwards.
  const relaySessionId =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `web-${Date.now()}`;
  // Actually share it. This used to be a local UUID while the saved row used a
  // second, different UUID from hsSessionIdRef — so the webhook wrote one row
  // keyed on the relay id and the recording save wrote another keyed on its
  // own, producing two rows with the same transcript for one test call.
  hsSessionIdRef.current = relaySessionId;

  try {
    // ── Audio + mic capture BEFORE WebSocket (HyperStream pattern) ─────────
    // Worklet setup yields the event loop; doing it after WS open drops early
    // relay messages. Mic is acquired on click; capture is gated until relay.connected.
    const audioCtx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = audioCtx;
    nextPlayTimeRef.current = 0;
    await audioCtx.resume();
    console.log(
      `[elv-relay] AudioContext sampleRate=${audioCtx.sampleRate} (requested 24000) state=${audioCtx.state}`,
    );
    audioCtx.onstatechange = () => {
      console.log(`[elv-relay] AudioContext state → ${audioCtx.state}`);
    };

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(audioCtx.destination);
    masterGainRef.current = masterGain;

    const keepAliveOsc = audioCtx.createOscillator();
    const keepAliveGain = audioCtx.createGain();
    keepAliveGain.gain.value = 0;
    keepAliveOsc.connect(keepAliveGain);
    keepAliveGain.connect(audioCtx.destination);
    keepAliveOsc.start();
    keepAliveRef.current = keepAliveOsc;

    let elDeltaCount = 0;
    let audioDeltaReceived = 0;
    let isElAISpeaking = false;
    let activeResponseId = 0;
    let captureLive = false;
    let micChunkCount = 0;
    let micSrc: MediaStreamAudioSourceNode | null = null;

    const playback = new AudioPlaybackController(
      () => audioCtxRef.current,
      () => masterGainRef.current,
      {
        sampleRate: 24000,
        resyncOnQueueDrain: true,
        logPrefix: "[elv-relay]",
        onFirstPlayback: (responseId) => {
          console.log(`[elv-relay] audio_first_playback response=${responseId}`);
        },
      },
    );
    elPlaybackRef.current = playback;

    let ws!: WebSocket;

    function sendMicPcm(int16: Int16Array) {
      if (!captureLive || !ws || ws.readyState !== WebSocket.OPEN || int16.length === 0) return;
      const u8 = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
      let bin = "";
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      ws.send(JSON.stringify({ type: "audio.chunk", data: btoa(bin) }));
      micChunkCount += 1;
      if (micChunkCount === 1) {
        console.log(`[elv-relay] first mic chunk sent (${int16.length} samples @ 24kHz)`);
      }
    }

    /** Downsample browser mic to 24 kHz Int16 (ScriptProcessor fallback). */
    function downsampleTo24k(f32: Float32Array, inputRate: number): Int16Array {
      const ratio = inputRate / 24000;
      if (Math.abs(ratio - 1) < 0.01) {
        const out = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = f32[i];
          out[i] = s < -1 ? -32768 : s > 1 ? 32767 : Math.round(s * 32767);
        }
        return out;
      }
      const outLen = Math.max(0, Math.floor((f32.length - 1) / ratio));
      const out = new Int16Array(outLen);
      let pos = 0;
      let prev = 0;
      for (let o = 0; o < outLen; o++) {
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const s0 = idx === 0 ? prev : f32[idx - 1]!;
        const s1 = f32[idx] ?? s0;
        let s = s0 + (s1 - s0) * frac;
        s = s < -1 ? -1 : s > 1 ? 1 : s;
        out[o] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
        pos += ratio;
      }
      return out;
    }

    const micStream = streamRef.current;
    if (!micStream) throw new Error("Microphone stream missing");
    micSrc = audioCtx.createMediaStreamSource(micStream);

    let usingWorklet = false;
    if (audioCtx.audioWorklet) {
      try {
        const workletSrc = `
          class ElvCaptureProcessor extends AudioWorkletProcessor {
            constructor() {
              super();
              this._ratio = sampleRate / 24000;
              this._pos = 0; this._prev = 0;
              this._buf = new Int16Array(1200); this._n = 0;
            }
            process(inputs) {
              const ch = inputs[0] && inputs[0][0];
              if (ch && ch.length) {
                const len = ch.length;
                while (this._pos < len) {
                  const i = Math.floor(this._pos);
                  const frac = this._pos - i;
                  const s0 = i === 0 ? this._prev : ch[i - 1];
                  const s1 = ch[i];
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
                this._prev = ch[len - 1];
                this._pos -= len;
              }
              return true;
            }
          }
          registerProcessor('elv-capture', ElvCaptureProcessor);
        `;
        const blobUrl = URL.createObjectURL(new Blob([workletSrc], { type: "application/javascript" }));
        try { await audioCtx.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
        const wn = new AudioWorkletNode(audioCtx, "elv-capture");
        workletRef.current = wn;
        wn.port.onmessage = (e) => sendMicPcm(new Int16Array(e.data as ArrayBuffer));
        micSrc.connect(wn);
        usingWorklet = true;
        console.log("[elv-relay] mic capture via AudioWorklet");
      } catch (err) {
        console.warn("[elv-relay] AudioWorklet unavailable, using ScriptProcessor:", err);
      }
    }
    if (!usingWorklet) {
      console.warn(
        `[elv-relay] ScriptProcessor fallback (resampling ${audioCtx.sampleRate} → 24000 Hz)`,
      );
      const sp = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = sp;
      sp.onaudioprocess = (e) => {
        const f32 = e.inputBuffer.getChannelData(0);
        sendMicPcm(downsampleTo24k(f32, audioCtx.sampleRate));
      };
      const sink = audioCtx.createGain();
      sink.gain.value = 0;
      captureSinkRef.current = sink;
      micSrc.connect(sp);
      sp.connect(sink);
    }

    function startRecording() {
      if (!micSrc || recorderRef.current) return;
      try {
        const recDest = audioCtx.createMediaStreamDestination();
        masterGainRef.current?.connect(recDest);
        micSrc.connect(recDest);
        const recorder = new MediaRecorder(recDest.stream);
        recChunksRef.current = [];
        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) recChunksRef.current.push(e.data);
        };
        recorder.start(1000);
        recorderRef.current = recorder;
      } catch { /* recording not supported */ }
    }

    const reportPlaybackDone = () => {
      isElAISpeaking = false;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "playback.done" }));
      }
    };

    const clearQueuedAudio = (reason?: string) => {
      playback.cancelCurrentAudio(reason ?? "barge_in");
      elDeltaCount = 0;
      isElAISpeaking = false;
    };

    async function scheduleAudioChunk(b64: string, responseId: number) {
      if (responseId !== activeResponseId) return;
      await playback.enqueueAudio(b64, responseId);
      elDeltaCount = playback.queueLength;
    }

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${wsProto}//${window.location.host}/api/el-voice-relay`);
    wsRelayRef.current = ws;
    ws.binaryType = "arraybuffer";

    wsConnectTimeoutRef.current = setTimeout(() => {
      wsConnectTimeoutRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        toast.error("Voice relay timed out", {
          // Deliberately does not name a provider. This fires only when the server said
          // nothing at all within 25s, so which key is missing is exactly what we do not
          // know here — a specific guess sends people to the wrong place.
          description:
            "Session setup took too long and the server did not report a reason. Check the agent's Voice Engine settings and refresh the page.",
        });
        cleanupElVoice();
        setCalling(false);
        setInCall(false);
      }
    }, 25_000);

    // IMPORTANT: set ws.onopen synchronously here — no await between new WebSocket()
    // and this handler or session.init is never sent.
    ws.onopen = () => {
      console.log("[elv-relay] ws.onopen — sending session.init");
      ws.send(JSON.stringify({
        type: "session.init",
        voiceId,
        systemPrompt,
        beginMessage,
        model: textModel,
        agentId: rowId,
        flow: exportedFlow,
        sessionId: relaySessionId,
        settings,
        speechLanguages: settings.speechLanguages ?? [settings.language ?? "en-US"],
        // Unset = the engine's own default, the same one live phone calls use. A hard-coded 800
        // here made every browser test call wait 300 ms longer than production.
        silenceDurationMs: settings.hyperstreamSilenceDurationMs,
        responsiveness: settings.responsiveness,
        interruptionSensitivity: settings.interruptionSensitivity,
        boostedKeywords: settings.boostedKeywords,
        // Was hardcoded to "fish" here regardless of the builder's TTS provider setting —
        // cascade-session.ts's `parseTtsProviderName(config.ttsProvider) ?? ...settings.webeeTtsProvider`
        // chain short-circuits on the FIRST truthy value, so a literal "fish" always won, even
        // when the agent was set to OpenAI. `settings` (sent below) already carries the real
        // choice; this just needs to stop overriding it with a hardcoded default.
        ttsProvider: isWebeeNative ? (settings.webeeTtsProvider ?? "fish") : undefined,
        sttProvider: isWebeeNative ? (settings.webeeSttProvider ?? "fish") : undefined,
        variables: testCallPrepRef.current.variables,
        startSpeaker: testCallPrepRef.current.startSpeaker,
      }));
      // Keep-alive: send a ping every 5 s so the reverse-proxy never sees an
      // idle connection and closes it (happens when EL streams audio quickly,
      // leaving a ~15 s gap where neither side sends anything).
      wsPingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 5000);
    };

    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string) as Record<string, unknown>; }
      catch { return; }

      // relay.connected → acquire mic then set up AudioWorklet capture
      // getUserMedia lives here (not before new WebSocket) so it doesn't
      // block onopen from being registered in time.
      if (msg.type === "relay.connected") {
        const mode = String(msg.mode ?? "flat");
        const stt = String(msg.stt ?? "?");
        const tts = String(msg.tts ?? "?");
        const vad = String(msg.vad ?? "?");
        console.log(`[elv-relay] connected mode=${mode} stt=${stt} tts=${tts} vad=${vad}`);
        if (wsConnectTimeoutRef.current !== null) {
          clearTimeout(wsConnectTimeoutRef.current);
          wsConnectTimeoutRef.current = null;
        }
        void audioCtxRef.current?.resume();
        pushTranscript([]);
        startedAtRef.current = Date.now();
        setElapsedSec(0);
        setCalling(false);
        setInCall(true);
        captureLive = true;
        startRecording();
        console.log("[elv-relay] mic capture live");
        if (isWebeeNative) {
          const lockedVoice = typeof msg.voiceId === "string" ? msg.voiceId : "";
        const sttLabel =
          stt === "fish"
            ? "Fish ASR"
            : stt === "deepgram"
              ? "Deepgram"
              : stt === "assemblyai"
                ? "AssemblyAI"
                : stt === "cartesia"
                  ? "Cartesia"
                  : stt;
          toast.message("WEBEE Native call live", {
            description: `${tts === "fish" ? "Fish Audio" : tts} TTS · ${sttLabel} STT · ${vad} VAD${lockedVoice ? ` · voice ${lockedVoice.slice(0, 8)}…` : ""}`,
            duration: 4000,
          });
        }
        const startNode = nodes.find((n) => n.data.isStart) ?? nodes[0];
        if (startNode) setActiveNode(startNode.id);
        clearDebugEvents();
        emitDebug("call", "WEBEE Native call live", { nodeId: startNode?.id });
        return;
      }

      if (msg.type === "transcript") {
        const role = msg.role as "user" | "agent";
        const text = String(msg.text ?? "");
        if (!text) return;
        console.log(`[elv-relay] transcript ${role}: ${text.slice(0, 120)}`);
        if (role === "agent") elDeltaCount = 0;
        pushTranscript((prev) => [
          // The confirmed line supersedes any interim text still on screen.
          ...prev.filter((e) => !e.partial),
          { id: crypto.randomUUID(), role, text, partial: false },
        ]);
        emitDebug(role === "user" ? "stt" : "tts", `${role}: ${text.slice(0, 160)}`);
        return;
      }

      // Interim recognition, shown so the caller sees they are being heard.
      // Streaming STT only; batch Whisper never sends these.
      if (msg.type === "transcript.partial") {
        const text = String(msg.text ?? "");
        if (!text) return;
        const role = msg.role === "agent" ? "agent" : "user";
        pushTranscript((prev) => {
          const withoutPartial = prev.filter((e) => !e.partial);
          return [...withoutPartial, { id: `partial-${role}`, role, text, partial: true }];
        });
        return;
      }

      if (msg.type === "audio.delta") {
        const responseId =
          typeof msg.responseId === "number" ? msg.responseId : activeResponseId || 1;
        if (audioDeltaReceived === 0) {
          const nbytes = String(msg.data ?? "").length;
          console.log(
            `[elv-relay] first audio.delta response=${responseId} (b64 len=${nbytes})`,
          );
        }
        audioDeltaReceived += 1;
        if (!isElAISpeaking) isElAISpeaking = true;
        void scheduleAudioChunk(String(msg.data ?? ""), responseId);
        return;
      }

      if (msg.type === "response.start") {
        activeResponseId = typeof msg.responseId === "number" ? msg.responseId : 0;
        playback.setActiveResponse(activeResponseId);
        audioDeltaReceived = 0;
        console.log(`[elv-relay] response.start id=${activeResponseId}`);
        const nodeId = typeof msg.nodeId === "string" ? msg.nodeId : undefined;
        if (nodeId) emitDebug("llm", "Speech response started", { nodeId });
        return;
      }

      if (msg.type === "turn.latency") {
        const ms = typeof msg.ms === "number" ? msg.ms : Number(msg.ms);
        if (Number.isFinite(ms)) onLatencyUpdateRef.current?.(ms);
        return;
      }

      if (msg.type === "response.cancelled") {
        console.log(
          `[elv-relay] response.cancelled id=${String(msg.responseId ?? "")} reason=${String(msg.reason ?? "")}`,
        );
        clearQueuedAudio(String(msg.reason ?? "cancelled"));
        return;
      }

      // Barge-in: the relay detected the caller talking over the agent and has
      // abandoned the turn. Anything already scheduled must be dropped, or the
      // agent keeps talking for seconds after being interrupted.
      if (msg.type === "audio.clear") {
        clearQueuedAudio("audio.clear");
        return;
      }

      // response.done fires after ALL TTS audio chunks have been sent. Tell the
      // relay once the queued audio has actually finished playing, so it knows
      // when the agent is no longer speaking.
      if (msg.type === "response.done") {
        console.log(
          `[elv-relay] response.done response=${activeResponseId} queue=${playback.queueLength}`,
        );
        playback.schedulePlaybackComplete(() => reportPlaybackDone());
        return;
      }

      if (msg.type === "call.ended") {
        console.log(`[elv-relay] call ended by flow (${String(msg.reason ?? "")})`);
        return;
      }

      if (msg.type === "node.active" && typeof msg.nodeId === "string") {
        const nodeId = String(msg.nodeId);
        if (nodes.some((n) => n.id === nodeId)) setActiveNode(nodeId);
        const label = nodes.find((n) => n.id === nodeId)?.data.label ?? nodeId;
        emitDebug("node", `Active: ${label}`, { nodeId, detail: { reason: String(msg.reason ?? "") } });
        return;
      }

      if (msg.type === "tool.result") {
        const toolId = String(msg.toolId ?? "tool");
        const ok = msg.ok === true;
        emitDebug("tool", `${toolId} ${ok ? "ok" : "fail"}`, {
          detail: { result: String(msg.result ?? "").slice(0, 500) },
        });
        return;
      }

      if (msg.type === "relay.error") {
        // Cancel the blind connect timeout first. The server has told us exactly what
        // went wrong (e.g. "Cartesia ASR requires CARTESIA_API_KEY"); leaving the timer
        // armed meant that 25s later it fired its generic "Check FISH_API_KEY" toast on
        // top of the real reason, sending people to look at the wrong provider.
        if (wsConnectTimeoutRef.current) {
          clearTimeout(wsConnectTimeoutRef.current);
          wsConnectTimeoutRef.current = null;
        }
        emitDebug("error", String(msg.message ?? "EL Voice error"));
        toast.error("EL Voice error", { description: String(msg.message ?? "") });
        return;
      }
    };

    ws.onclose = (ev) => {
      console.log(`[elv-relay] ws.onclose code=${ev.code} wasClean=${ev.wasClean}`);
      recordCurrentCallCost();
      setInCall(false);
      setActiveNode(null);
      startedAtRef.current = null;
      setCalling(false);
      cleanupElVoice();
    };

    ws.onerror = () => {
      toast.error("EL Voice connection failed");
      setCalling(false);
      cleanupElVoice();
    };
  } catch (e) {
    toast.error("EL Voice test call failed", { description: (e as Error).message });
    setCalling(false);
  }
}
