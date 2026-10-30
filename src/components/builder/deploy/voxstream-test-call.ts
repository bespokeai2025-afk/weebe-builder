/** VoxStream (ElevenLabs Conversational AI) in-browser test call. Moved out of RetellDeployDialog unchanged; see deploy/test-call-session.ts. */
import { toast } from "sonner";
import type { TestCallSession } from "./test-call-session";

export async function runVoxStreamTestCall(session: TestCallSession): Promise<void> {
  const {
    activeSourceNodesRef,
    audioCtxRef,
    captureSinkRef,
    endCall,
    getElSignedUrl,
    keepAliveRef,
    nextPlayTimeRef,
    nodes,
    processorRef,
    pushTranscript,
    recordCurrentCallCost,
    recordedCallRef,
    setActiveNode,
    setCalling,
    setElapsedSec,
    setInCall,
    settings,
    startedAtRef,
    streamRef,
    workletRef,
    wsRelayRef,
  } = session;
  const elAgentId = (settings.deployedElevenLabsAgentId as string | undefined)?.trim();
  if (!elAgentId) {
    toast.error("Deploy the VoxStream agent first", {
      description: "Click + to create the agent before testing.",
    });
    return;
  }
  setCalling(true);
  try {
    const { signedUrl } = await getElSignedUrl({ data: { agentId: elAgentId } });

    // 16 kHz AudioContext — matches ElevenLabs native rate (no resampling needed).
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;
    nextPlayTimeRef.current = 0;

    // Keep AudioContext alive (Chrome suspends idle contexts).
    const keepOsc = audioCtx.createOscillator();
    const keepGain = audioCtx.createGain();
    keepGain.gain.value = 0;
    keepOsc.connect(keepGain);
    keepGain.connect(audioCtx.destination);
    keepOsc.start();
    keepAliveRef.current = keepOsc;

    // Microphone with echo cancellation.
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = micStream;
    const micSrc = audioCtx.createMediaStreamSource(micStream);

    // Connect to ElevenLabs WebSocket directly with the signed URL.
    const ws = new WebSocket(signedUrl);
    wsRelayRef.current = ws;

    function pcm16ToBase64(int16: Int16Array): string {
      const u8 = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
      let bin = "";
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      return btoa(bin);
    }
    function sendChunk(int16: Int16Array) {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ user_audio_chunk: pcm16ToBase64(int16) }));
    }

    // AudioWorklet capture (AudioContext is already 16 kHz — no resampling).
    let usingWorklet = false;
    if (audioCtx.audioWorklet) {
      try {
        const src = `
          class VoxCap extends AudioWorkletProcessor {
            constructor() { super(); this._b = []; this._F = 800; }
            process(inputs) {
              const ch = inputs[0]?.[0];
              if (!ch) return true;
              for (let i = 0; i < ch.length; i++) {
                const s = ch[i];
                this._b.push(s < -1 ? -32768 : s > 1 ? 32767 : Math.round(s * 32767));
                if (this._b.length >= this._F) {
                  const out = new Int16Array(this._b.splice(0, this._F));
                  this.port.postMessage(out.buffer, [out.buffer]);
                }
              }
              return true;
            }
          }
          registerProcessor('vox-cap', VoxCap);
        `;
        const blobUrl = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
        try { await audioCtx.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
        const wn = new AudioWorkletNode(audioCtx, "vox-cap");
        workletRef.current = wn;
        wn.port.onmessage = (ev) => sendChunk(new Int16Array(ev.data as ArrayBuffer));
        micSrc.connect(wn);
        const sink = audioCtx.createGain();
        sink.gain.value = 0;
        captureSinkRef.current = sink;
        wn.connect(sink);
        sink.connect(audioCtx.destination);
        usingWorklet = true;
      } catch (err) {
        console.warn("[voxstream] AudioWorklet unavailable:", err);
      }
    }
    if (!usingWorklet) {
      const proc = audioCtx.createScriptProcessor(2048, 1, 1);
      processorRef.current = proc;
      proc.onaudioprocess = (ev) => {
        const ch = ev.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++) {
          const s = ch[i];
          pcm[i] = s < -1 ? -32768 : s > 1 ? 32767 : Math.round(s * 32767);
        }
        sendChunk(pcm);
      };
      micSrc.connect(proc);
      proc.connect(audioCtx.destination);
    }

    // Schedule incoming PCM16 from ElevenLabs for playback.
    function scheduleElAudio(b64: string) {
      try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const i16 = new Int16Array(bytes.buffer);
        const f32 = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
        const audioBuf = audioCtx.createBuffer(1, f32.length, 16000);
        audioBuf.copyToChannel(f32, 0);
        const node = audioCtx.createBufferSource();
        node.buffer = audioBuf;
        node.connect(audioCtx.destination);
        const t = Math.max(audioCtx.currentTime, nextPlayTimeRef.current);
        node.start(t);
        nextPlayTimeRef.current = t + audioBuf.duration;
        activeSourceNodesRef.current.push(node);
        node.onended = () => {
          activeSourceNodesRef.current = activeSourceNodesRef.current.filter((n) => n !== node);
        };
      } catch { /* decode failed — skip */ }
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
      startedAtRef.current = Date.now();
      recordedCallRef.current = false;
      setElapsedSec(0);
      pushTranscript([]);
      setInCall(true);
      const startNode = nodes.find((n) => n.data.isStart) ?? nodes[0];
      if (startNode) setActiveNode(startNode.id);
      setCalling(false);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      const t = msg.type as string | undefined;

      if (t === "audio") {
        const ab = (msg.audio_event as Record<string, unknown> | undefined)?.audio_base64;
        if (typeof ab === "string") scheduleElAudio(ab);
      } else if (t === "agent_response") {
        const text = (msg.agent_response_event as Record<string, unknown> | undefined)?.agent_response;
        if (typeof text === "string" && text) {
          pushTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "agent" && last.partial)
              return [...prev.slice(0, -1), { ...last, text, partial: false }];
            return [...prev, { id: `el-a-${Date.now()}`, role: "agent" as const, text, partial: false }];
          });
        }
      } else if (t === "user_transcript") {
        const text = (msg.user_transcription_event as Record<string, unknown> | undefined)?.user_transcript;
        if (typeof text === "string" && text) {
          pushTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "user" && last.partial)
              return [...prev.slice(0, -1), { ...last, text, partial: false }];
            return [...prev, { id: `el-u-${Date.now()}`, role: "user" as const, text, partial: false }];
          });
        }
      } else if (t === "interruption") {
        for (const node of activeSourceNodesRef.current) {
          try { node.stop(); } catch { /* already ended */ }
        }
        activeSourceNodesRef.current = [];
        nextPlayTimeRef.current = audioCtx.currentTime;
      } else if (t === "ping") {
        const eventId = (msg.ping_event as Record<string, unknown> | undefined)?.event_id;
        ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
      } else if (t === "conversation_end") {
        recordCurrentCallCost();
        endCall();
      }
    };

    ws.onerror = () => { toast.error("VoxStream connection error"); };
    ws.onclose = () => {
      if (startedAtRef.current) {
        recordCurrentCallCost();
        startedAtRef.current = null;
      }
      setInCall(false);
      setActiveNode(null);
    };
  } catch (e) {
    toast.error("VoxStream test call failed", { description: (e as Error).message });
    setCalling(false);
  }
}
