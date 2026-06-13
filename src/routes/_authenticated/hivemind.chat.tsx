import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Brain, Mic, MicOff, Send, Volume2, VolumeX, Settings2,
  ChevronDown, Loader2, Radio, Square, Play, Pause,
  Zap, RefreshCw, X, Check, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import {
  getHiveMindAIResponse, getHiveMindMorningBriefing,
  getHiveMindTTS, listHiveMindVoices, getHiveMindSystemContext,
} from "@/lib/hivemind/hivemind.ai";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/hivemind/chat")({
  head: () => ({ meta: [{ title: "HiveMind Assistant — Webee" }] }),
  component: HiveMindChat,
});

// ── Types ──────────────────────────────────────────────────────────────────────
type Role = "user" | "hivemind";
type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  ts: Date;
  audioBase64?: string | null;
};
type VoiceSettings = {
  voiceId:     string;
  voiceName:   string;
  speed:       number;
  personality: "professional" | "friendly" | "concise";
  autoPlay:    boolean;
};
const DEFAULT_VOICE: VoiceSettings = {
  voiceId:     "21m00Tcm4TlvDq8ikWAM", // Rachel
  voiceName:   "Rachel",
  speed:       1.0,
  personality: "professional",
  autoPlay:    false,
};
const SPEED_OPTIONS = [0.7, 0.85, 1.0, 1.15, 1.3, 1.5];
const PERSONALITIES = ["professional", "friendly", "concise"] as const;

const SUGGESTED = [
  "What's happened today?",
  "Which agents need attention?",
  "How is my pipeline performing?",
  "Are any campaigns stalling?",
  "Show me inactive leads",
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function loadVoiceSettings(): VoiceSettings {
  try {
    const s = localStorage.getItem("hivemind-voice-settings");
    return s ? { ...DEFAULT_VOICE, ...JSON.parse(s) } : DEFAULT_VOICE;
  } catch { return DEFAULT_VOICE; }
}
function saveVoiceSettings(s: VoiceSettings) {
  try { localStorage.setItem("hivemind-voice-settings", JSON.stringify(s)); } catch {}
}

// ── Markdown-lite renderer ─────────────────────────────────────────────────────
function MessageText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm leading-relaxed space-y-1">
      {lines.map((line, i) => {
        // bold **text**
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={j} className="font-semibold">{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>
        );
        if (line.startsWith("• ") || line.startsWith("- ")) {
          return <div key={i} className="flex gap-1.5"><span className="text-violet-400 shrink-0 mt-0.5">•</span><span>{rendered.slice(1)}</span></div>;
        }
        return <div key={i}>{rendered}</div>;
      })}
    </div>
  );
}

// ── Audio player hook ──────────────────────────────────────────────────────────
function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const play = useCallback((id: string, base64: string, speed: number) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    audio.playbackRate = speed;
    audioRef.current = audio;
    setPlayingId(id);
    audio.play().catch(() => {});
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setPlayingId(null);
  }, []);

  return { playingId, play, stop };
}

// ── el-voice-relay hook (Live mode) ───────────────────────────────────────────
// Mirrors the RetellDeployDialog EL relay pattern without modifying that component.
function useElRelay(onTranscript: (role: Role, text: string) => void, voiceSettings: VoiceSettings) {
  const wsRef        = useRef<WebSocket | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const nextPlayRef  = useRef(0);
  const wsPingRef    = useRef<ReturnType<typeof setInterval>>();
  const streamRef    = useRef<MediaStream | null>(null);
  const workletRef   = useRef<AudioWorkletNode | null>(null);
  const [state, setState] = useState<"idle"|"connecting"|"live"|"error">("idle");
  const [error, setError]  = useState<string | null>(null);

  const scheduleChunk = useCallback((b64: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !b64) return;
    if (ctx.state === "suspended") void ctx.resume();
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const i16   = new Int16Array(bytes.buffer);
    if (!i16.length) return;
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const buf = ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = nextPlayRef.current > ctx.currentTime
      ? nextPlayRef.current : ctx.currentTime + 0.08;
    src.start(startAt);
    nextPlayRef.current = startAt + buf.duration;
  }, []);

  const start = useCallback(async (systemPrompt: string, beginMessage: string) => {
    if (wsRef.current) return;
    setState("connecting");
    setError(null);

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/api/el-voice-relay`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const audioCtx = new AudioContext({ sampleRate: 24000 });
    audioCtxRef.current = audioCtx;
    nextPlayRef.current = 0;

    // Must set onopen BEFORE any await (relay fires onopen within ~10ms)
    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "session.init",
        voiceId:      voiceSettings.voiceId,
        systemPrompt,
        beginMessage,
        model: "gpt-4.1",
      }));
      wsPingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 5000);
    };

    ws.onmessage = async (ev) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string) as Record<string, unknown>; } catch { return; }

      if (msg.type === "relay.connected") {
        setState("live");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1, sampleRate: 24000 },
          });
          streamRef.current = stream;

          // AudioWorklet PCM16 capture
          const WORKLET_CODE = `
            class PCM16Capture extends AudioWorkletProcessor {
              process(inputs) {
                const ch = inputs[0]?.[0];
                if (!ch) return true;
                const p = new Int16Array(ch.length);
                for (let i=0;i<ch.length;i++) p[i]=Math.max(-32768,Math.min(32767,Math.round(ch[i]*32767)));
                this.port.postMessage(p.buffer,[p.buffer]);
                return true;
              }
            }
            registerProcessor('pcm16-capture',PCM16Capture);
          `;
          const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" }));
          await audioCtx.audioWorklet.addModule(url);
          const micSrc  = audioCtx.createMediaStreamSource(stream);
          const worklet = new AudioWorkletNode(audioCtx, "pcm16-capture");
          workletRef.current = worklet;
          worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
          };
          micSrc.connect(worklet);
          worklet.connect(audioCtx.destination);
        } catch (e: any) {
          setError("Microphone access denied");
          setState("error");
        }
      }
      if (msg.type === "audio.delta" && typeof msg.data === "string") scheduleChunk(msg.data);
      if (msg.type === "transcript.user" && typeof msg.text === "string" && msg.text) onTranscript("user", String(msg.text));
      if (msg.type === "transcript.assistant" && typeof msg.text === "string" && msg.text) onTranscript("hivemind", String(msg.text));
    };

    ws.onerror = () => { setError("Relay connection failed"); setState("error"); };
    ws.onclose = () => { setState("idle"); };
  }, [voiceSettings.voiceId, scheduleChunk, onTranscript]);

  const stop = useCallback(() => {
    clearInterval(wsPingRef.current);
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    nextPlayRef.current = 0;
    setState("idle");
  }, []);

  useEffect(() => () => { stop(); }, [stop]);

  return { state, error, start, stop };
}

// ── Voice settings drawer ──────────────────────────────────────────────────────
function VoiceSettingsDrawer({ settings, onChange, onClose, voices }: {
  settings: VoiceSettings;
  onChange: (s: VoiceSettings) => void;
  onClose: () => void;
  voices: { id: string; name: string; category: string }[];
}) {
  return (
    <div className="border-t border-white/[0.07] bg-card/60 px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.1em]">Voice Settings</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded"><X className="h-3.5 w-3.5" /></button>
      </div>

      {/* Voice */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Voice</label>
        {voices.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/60">No voices available — add ElevenLabs key in Settings → Integrations</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {voices.slice(0, 12).map(v => (
              <button
                key={v.id}
                onClick={() => onChange({ ...settings, voiceId: v.id, voiceName: v.name })}
                className={cn(
                  "text-left px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                  settings.voiceId === v.id
                    ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                    : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground"
                )}
              >
                <p className="font-medium truncate">{v.name}</p>
                <p className="text-[10px] opacity-60 capitalize">{v.category}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Speed */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 flex items-center justify-between">
          Speed <span className="text-foreground font-medium">{settings.speed}×</span>
        </label>
        <div className="flex gap-1.5">
          {SPEED_OPTIONS.map(s => (
            <button key={s} onClick={() => onChange({ ...settings, speed: s })} className={cn(
              "flex-1 py-1 rounded-md border text-xs transition-all",
              settings.speed === s ? "border-violet-500/40 bg-violet-500/15 text-violet-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground"
            )}>{s}×</button>
          ))}
        </div>
      </div>

      {/* Personality */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Personality</label>
        <div className="flex gap-1.5">
          {PERSONALITIES.map(p => (
            <button key={p} onClick={() => onChange({ ...settings, personality: p })} className={cn(
              "flex-1 py-1.5 rounded-lg border text-xs capitalize transition-all",
              settings.personality === p ? "border-violet-500/40 bg-violet-500/15 text-violet-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground"
            )}>{p}</button>
          ))}
        </div>
      </div>

      {/* Auto-play */}
      <div className="flex items-center justify-between border-t border-white/[0.05] pt-3">
        <div>
          <p className="text-xs font-medium">Auto-play responses</p>
          <p className="text-[11px] text-muted-foreground">Speak each HiveMind response automatically</p>
        </div>
        <button
          onClick={() => onChange({ ...settings, autoPlay: !settings.autoPlay })}
          className={cn(
            "w-9 h-5 rounded-full transition-all relative",
            settings.autoPlay ? "bg-violet-500" : "bg-white/[0.1]"
          )}
        >
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", settings.autoPlay ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, onPlay, onStop, isPlaying, isTTSLoading }: {
  msg: ChatMessage;
  onPlay: (id: string, base64: string) => void;
  onStop: () => void;
  isPlaying: boolean;
  isTTSLoading: boolean;
}) {
  const isHive = msg.role === "hivemind";
  return (
    <div className={cn("flex gap-2.5 max-w-[85%]", isHive ? "self-start" : "self-end flex-row-reverse")}>
      {/* Avatar */}
      <div className={cn(
        "h-7 w-7 shrink-0 rounded-full flex items-center justify-center mt-0.5",
        isHive ? "bg-violet-500/20 ring-1 ring-violet-500/30" : "bg-white/[0.08]"
      )}>
        {isHive
          ? <Brain className="h-3.5 w-3.5 text-violet-400" />
          : <User className="h-3.5 w-3.5 text-muted-foreground" />
        }
      </div>

      <div className={cn("flex flex-col gap-0.5", isHive ? "items-start" : "items-end")}>
        {/* Bubble */}
        <div className={cn(
          "rounded-xl px-3.5 py-2.5",
          isHive
            ? "bg-violet-500/[0.08] border border-violet-500/15 text-foreground"
            : "bg-white/[0.07] border border-white/[0.08] text-foreground",
          msg.content === "" && "opacity-50"
        )}>
          {msg.content === "" && msg.role === "hivemind"
            ? <div className="flex gap-1 items-center py-1"><span className="h-1.5 w-1.5 bg-violet-400 rounded-full animate-bounce" style={{animationDelay:"0ms"}} /><span className="h-1.5 w-1.5 bg-violet-400 rounded-full animate-bounce" style={{animationDelay:"150ms"}} /><span className="h-1.5 w-1.5 bg-violet-400 rounded-full animate-bounce" style={{animationDelay:"300ms"}} /></div>
            : <MessageText text={msg.content} />
          }
        </div>

        {/* Footer: time + play button */}
        <div className={cn("flex items-center gap-1.5", isHive ? "flex-row" : "flex-row-reverse")}>
          <span className="text-[10px] text-muted-foreground/50">{fmtTime(msg.ts)}</span>
          {isHive && msg.content && (
            <button
              onClick={() => {
                if (isPlaying) { onStop(); return; }
                if (msg.audioBase64) onPlay(msg.id, msg.audioBase64);
              }}
              disabled={isTTSLoading && !msg.audioBase64}
              title={isPlaying ? "Stop" : "Play audio"}
              className="text-muted-foreground/40 hover:text-violet-400 transition-colors disabled:opacity-30"
            >
              {isTTSLoading && !msg.audioBase64
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
function HiveMindChat() {
  const aiFn        = useServerFn(getHiveMindAIResponse);
  const briefingFn  = useServerFn(getHiveMindMorningBriefing);
  const ttsFn       = useServerFn(getHiveMindTTS);
  const voicesFn    = useServerFn(listHiveMindVoices);
  const contextFn   = useServerFn(getHiveMindSystemContext);

  const [messages, setMessages]     = useState<ChatMessage[]>([]);
  const [input, setInput]           = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [voices, setVoices]               = useState<{ id: string; name: string; category: string }[]>([]);
  const [isRecording, setIsRecording]     = useState(false);
  const [mode, setMode]                   = useState<"chat" | "live">("chat");
  const [ttsLoadingId, setTtsLoadingId]   = useState<string | null>(null);
  const [liveError, setLiveError]         = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const recognRef  = useRef<any>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const { playingId, play: playAudio, stop: stopAudio } = useAudioPlayer();

  // Live relay callbacks
  const handleLiveTranscript = useCallback((role: Role, text: string) => {
    setMessages(prev => {
      // Check if the last message of this role is still incomplete (no ts mismatch)
      const last = prev[prev.length - 1];
      if (last && last.role === role && Date.now() - last.ts.getTime() < 3000) {
        return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: text } : m);
      }
      return [...prev, { id: uid(), role, content: text, ts: new Date() }];
    });
    if (role === "assistant") {
      historyRef.current.push({ role: "assistant", content: text });
    }
  }, []);

  const relay = useElRelay(handleLiveTranscript, voiceSettings);

  // Load prefs on mount
  useEffect(() => {
    setVoiceSettings(loadVoiceSettings());
  }, []);

  // Load voices
  useEffect(() => {
    voicesFn().then(r => { if (r.voices?.length) setVoices(r.voices); }).catch(() => {});
  }, []);

  // Morning briefing on mount
  useQuery({
    queryKey: ["hivemind-briefing"],
    queryFn: async () => {
      const r = await briefingFn();
      const msg: ChatMessage = {
        id: "briefing",
        role: "hivemind",
        content: r.briefing,
        ts: new Date(),
      };
      setMessages([msg]);
      // Auto-fetch TTS if autoPlay
      if (voiceSettings.autoPlay) {
        fetchAndPlayTTS(msg);
      }
      return r;
    },
    staleTime: Infinity,
    retry: 1,
  });

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Persist voice settings
  function updateVoiceSettings(s: VoiceSettings) {
    setVoiceSettings(s);
    saveVoiceSettings(s);
  }

  // TTS for a message
  async function fetchAndPlayTTS(msg: ChatMessage) {
    if (msg.audioBase64) { playAudio(msg.id, msg.audioBase64, voiceSettings.speed); return; }
    setTtsLoadingId(msg.id);
    try {
      const r = await ttsFn({ data: { text: msg.content.slice(0, 800), voiceId: voiceSettings.voiceId, speed: voiceSettings.speed } });
      if (r.audioBase64) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, audioBase64: r.audioBase64 } : m));
        playAudio(msg.id, r.audioBase64, voiceSettings.speed);
      }
    } finally { setTtsLoadingId(null); }
  }

  // Send a chat message
  async function sendMessage(query: string) {
    if (!query.trim() || isThinking) return;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: query.trim(), ts: new Date() };
    const placeholder: ChatMessage = { id: uid(), role: "hivemind", content: "", ts: new Date() };
    setMessages(prev => [...prev, userMsg, placeholder]);
    historyRef.current.push({ role: "user", content: query.trim() });
    setInput("");
    setIsThinking(true);
    try {
      const r = await aiFn({ data: { query: query.trim(), history: historyRef.current.slice(-10), personality: voiceSettings.personality } });
      historyRef.current.push({ role: "assistant", content: r.response });
      const finalMsg: ChatMessage = { ...placeholder, content: r.response, ts: new Date() };
      setMessages(prev => prev.map(m => m.id === placeholder.id ? finalMsg : m));
      if (voiceSettings.autoPlay) {
        setTimeout(() => fetchAndPlayTTS(finalMsg), 200);
      }
    } catch (e: any) {
      setMessages(prev => prev.map(m => m.id === placeholder.id
        ? { ...m, content: `Sorry, I couldn't respond: ${e.message ?? "Unknown error"}` }
        : m));
    } finally { setIsThinking(false); }
  }

  // Web Speech API
  function toggleRecording() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported in this browser."); return; }
    if (isRecording) {
      recognRef.current?.abort();
      setIsRecording(false);
      return;
    }
    const r = new SR();
    recognRef.current = r;
    r.continuous = false;
    r.interimResults = false;
    r.lang = "en-US";
    r.onstart  = () => setIsRecording(true);
    r.onend    = () => setIsRecording(false);
    r.onerror  = () => setIsRecording(false);
    r.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript as string;
      setInput(transcript);
      setTimeout(() => sendMessage(transcript), 100);
    };
    r.start();
  }

  // Live mode toggle
  async function toggleLiveMode() {
    if (mode === "live") {
      relay.stop();
      setMode("chat");
      setLiveError(null);
      return;
    }
    setMode("live");
    setLiveError(null);
    try {
      const ctx = await contextFn({ data: { personality: voiceSettings.personality, voiceId: voiceSettings.voiceId } });
      if (!ctx.hasEL) {
        setLiveError("ElevenLabs key required for live voice. Add it in Settings → Integrations.");
        setMode("chat");
        return;
      }
      await relay.start(ctx.systemPrompt, ctx.beginMessage);
    } catch (e: any) {
      setLiveError(String(e.message ?? "Could not start live session"));
      setMode("chat");
    }
  }

  const liveActive = relay.state === "live";
  const isConnecting = relay.state === "connecting";

  return (
    <HiveMindShell>
      <div className="flex flex-col h-full">

        {/* ── HEADER ── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.07] shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30">
            <Brain className="h-4 w-4 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">HiveMind Assistant</p>
            <p className="text-[11px] text-muted-foreground">
              {liveActive ? "🔴 Live voice session active" : isConnecting ? "Connecting…" : "Ask me anything about your platform"}
            </p>
          </div>

          {/* Mode toggle */}
          <button
            onClick={toggleLiveMode}
            disabled={isConnecting}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border transition-all",
              liveActive
                ? "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/20"
                : "bg-white/[0.04] text-muted-foreground border-white/[0.08] hover:text-foreground",
            )}
          >
            {isConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />}
            {liveActive ? "End Live" : "Live Voice"}
          </button>

          <button
            onClick={() => setSettingsOpen(p => !p)}
            className={cn("p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors", settingsOpen && "bg-white/[0.06] text-violet-400")}
          >
            <Settings2 className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Live error */}
        {(liveError ?? relay.error) && (
          <div className="mx-5 mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-xs text-red-400 flex items-center gap-2">
            <X className="h-3.5 w-3.5 shrink-0" />
            {liveError ?? relay.error}
          </div>
        )}

        {/* Settings drawer */}
        {settingsOpen && (
          <VoiceSettingsDrawer
            settings={voiceSettings}
            onChange={updateVoiceSettings}
            onClose={() => setSettingsOpen(false)}
            voices={voices}
          />
        )}

        {/* ── MESSAGES ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 min-h-0">

          {messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-12">
              <div className="h-14 w-14 rounded-2xl bg-violet-500/15 ring-1 ring-violet-500/25 flex items-center justify-center">
                <Brain className="h-7 w-7 text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">HiveMind is ready</p>
                <p className="text-xs text-muted-foreground mt-1">Loading your morning briefing…</p>
              </div>
              <Loader2 className="h-4 w-4 animate-spin text-violet-400/50" />
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onPlay={(id, b64) => playAudio(id, b64, voiceSettings.speed)}
              onStop={stopAudio}
              isPlaying={playingId === msg.id}
              isTTSLoading={ttsLoadingId === msg.id}
            />
          ))}

          {/* Suggested chips (show after briefing, before any user message) */}
          {messages.length === 1 && messages[0].role === "hivemind" && (
            <div className="flex flex-wrap gap-1.5 self-start ml-9 mt-1">
              {SUGGESTED.map(s => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="rounded-full border border-violet-500/20 bg-violet-500/[0.06] px-3 py-1 text-xs text-violet-300 hover:bg-violet-500/15 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── INPUT BAR ── */}
        {mode === "chat" && (
          <div className="shrink-0 border-t border-white/[0.07] px-4 py-3 bg-card/40">
            <div className="flex items-end gap-2">
              {/* Mic */}
              <button
                onClick={toggleRecording}
                title={isRecording ? "Stop recording" : "Speak"}
                className={cn(
                  "h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 transition-all",
                  isRecording
                    ? "bg-red-500/20 border-red-500/40 text-red-400 animate-pulse"
                    : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.06]",
                )}
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>

              {/* Text input */}
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage(input);
                    }
                  }}
                  placeholder={isRecording ? "Listening…" : "Ask HiveMind anything…"}
                  rows={1}
                  disabled={isThinking}
                  className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-violet-500/40 focus:ring-1 focus:ring-violet-500/20 disabled:opacity-60 max-h-32 leading-relaxed"
                  style={{ scrollbarWidth: "none" }}
                />
              </div>

              {/* Send */}
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isThinking}
                className="h-9 w-9 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center shrink-0 transition-all"
              >
                {isThinking ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Send className="h-4 w-4 text-white" />}
              </button>
            </div>
          </div>
        )}

        {/* ── LIVE MODE STATUS ── */}
        {mode === "live" && (
          <div className="shrink-0 border-t border-white/[0.07] px-4 py-4 bg-card/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {liveActive ? (
                  <>
                    <div className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-red-300">Live session active</p>
                      <p className="text-[11px] text-muted-foreground">Speak naturally — HiveMind is listening</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                    <p className="text-xs text-muted-foreground">Connecting to voice relay…</p>
                  </>
                )}
              </div>
              <button
                onClick={toggleLiveMode}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-all"
              >
                <Square className="h-3 w-3" /> End session
              </button>
            </div>
          </div>
        )}
      </div>
    </HiveMindShell>
  );
}
