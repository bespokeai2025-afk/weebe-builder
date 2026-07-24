import { useState, useRef, useEffect, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState, useNavigate } from "@tanstack/react-router";
import { Send, Mic, MicOff, X, Minus, Loader2, ChevronRight, User, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHiveMindAIResponse, getHiveMindTTS } from "@/lib/hivemind/hivemind.ai";

// ── Keyframe styles ────────────────────────────────────────────────────────────
const ORB_STYLES = `
@keyframes hm-orb-idle-breathe {
  0%,100% { transform: scale(1); opacity: 1; }
  50%      { transform: scale(1.06); opacity: 0.9; }
}
@keyframes hm-ring-cw {
  to { transform: rotate(360deg); }
}
@keyframes hm-ring-ccw {
  to { transform: rotate(-360deg); }
}
@keyframes hm-ring-cw-slow {
  to { transform: rotate(360deg); }
}
@keyframes hm-pulse-out {
  0%   { transform: scale(0.9); opacity: 0.7; }
  100% { transform: scale(2.2); opacity: 0; }
}
@keyframes hm-core-think {
  0%,100% { transform: scale(1) rotate(0deg); }
  25%     { transform: scale(1.1) rotate(90deg); }
  50%     { transform: scale(0.95) rotate(180deg); }
  75%     { transform: scale(1.05) rotate(270deg); }
}
@keyframes hm-speak-bounce {
  0%,100% { transform: scaleY(0.3); }
  50%     { transform: scaleY(1); }
}
@keyframes hm-energy-flow {
  0%   { stroke-dashoffset: 200; opacity: 0.2; }
  50%  { opacity: 0.8; }
  100% { stroke-dashoffset: 0; opacity: 0.2; }
}
@keyframes hm-alert-ring {
  0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
  50%     { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
}
@keyframes hm-notification-pop {
  0%   { transform: scale(0.5); opacity: 0; }
  70%  { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes hm-wave-bar {
  0%,100% { transform: scaleY(0.25); opacity: 0.4; }
  50%     { transform: scaleY(1); opacity: 1; }
}
@keyframes hm-outer-glow-pulse {
  0%,100% { opacity: 0.4; transform: scale(1); }
  50%     { opacity: 0.9; transform: scale(1.08); }
}
`;

// ── Types ──────────────────────────────────────────────────────────────────────
type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";
type Msg = { id: string; role: "user" | "hm"; content: string };
type VoiceSettings = { voiceId: string; speed: number; personality: "professional" | "friendly" | "concise" };

function uid() { return Math.random().toString(36).slice(2, 9); }
function loadPrefs(): VoiceSettings {
  try {
    const s = localStorage.getItem("hivemind-voice-settings");
    const p = s ? JSON.parse(s) : {};
    return { voiceId: p.voiceId ?? "21m00Tcm4TlvDq8ikWAM", speed: p.speed ?? 1.0, personality: p.personality ?? "friendly" };
  } catch { return { voiceId: "21m00Tcm4TlvDq8ikWAM", speed: 1.0, personality: "friendly" }; }
}
function loadUserName(): string {
  try { return localStorage.getItem("hivemind-user-name") ?? ""; } catch { return ""; }
}

// ── Orb visual sizes & colors by state ────────────────────────────────────────
const ORB_CONFIG: Record<OrbState, {
  size: number;
  coreSize: number;
  haloOpacity: number;
  glowColor: string;
  glowSize: string;
  ringColor: string;
  ringOpacity: number;
  coreColor: string;
  label: string;
}> = {
  idle: {
    size: 56, coreSize: 18,
    haloOpacity: 0.15,
    glowColor: "rgba(14,165,233,0.25)", glowSize: "0 0 20px 8px rgba(14,165,233,0.2)",
    ringColor: "rgba(14,165,233,0.3)", ringOpacity: 0.5,
    coreColor: "#7dd3fc",
    label: "Idle",
  },
  listening: {
    size: 64, coreSize: 20,
    haloOpacity: 0.22,
    glowColor: "rgba(6,182,212,0.35)", glowSize: "0 0 30px 12px rgba(6,182,212,0.35)",
    ringColor: "rgba(6,182,212,0.5)", ringOpacity: 0.75,
    coreColor: "#22d3ee",
    label: "Listening",
  },
  thinking: {
    size: 60, coreSize: 18,
    haloOpacity: 0.2,
    glowColor: "rgba(99,102,241,0.35)", glowSize: "0 0 28px 10px rgba(99,102,241,0.3)",
    ringColor: "rgba(99,102,241,0.5)", ringOpacity: 0.7,
    coreColor: "#a5b4fc",
    label: "Thinking",
  },
  speaking: {
    size: 72, coreSize: 22,
    haloOpacity: 0.3,
    glowColor: "rgba(6,182,212,0.5)", glowSize: "0 0 40px 20px rgba(6,182,212,0.4)",
    ringColor: "rgba(6,182,212,0.7)", ringOpacity: 0.9,
    coreColor: "#ffffff",
    label: "Speaking",
  },
  error: {
    size: 56, coreSize: 18,
    haloOpacity: 0.2,
    glowColor: "rgba(239,68,68,0.3)", glowSize: "0 0 20px 8px rgba(239,68,68,0.25)",
    ringColor: "rgba(239,68,68,0.4)", ringOpacity: 0.6,
    coreColor: "#fca5a5",
    label: "Error",
  },
};

// ── Waveform bars (speaking state) ────────────────────────────────────────────
function WaveformBars() {
  const barCount = 8;
  const bars = Array.from({ length: barCount });
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: "50%" }}>
      {bars.map((_, i) => {
        const angle = (i / barCount) * 360;
        const delay = (i / barCount) * 0.7;
        const r = 40; // radius from center
        const rad = (angle * Math.PI) / 180;
        const x = 50 + r * Math.cos(rad);
        const y = 50 + r * Math.sin(rad);
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: 3,
              height: 12,
              marginLeft: -1.5,
              marginTop: -6,
              borderRadius: 2,
              background: "linear-gradient(to top, rgba(6,182,212,0.2), rgba(6,182,212,0.9))",
              transformOrigin: "center bottom",
              transform: `rotate(${angle + 90}deg) scaleY(0.25)`,
              animation: `hm-wave-bar 0.5s ease-in-out infinite`,
              animationDelay: `${delay}s`,
              willChange: "transform, opacity",
            }}
          />
        );
      })}
    </div>
  );
}

// ── Orb visual ────────────────────────────────────────────────────────────────
function OrbVisual({ state, notifCount, alertMode, isOpen }: {
  state: OrbState;
  notifCount: number;
  alertMode: boolean;
  isOpen: boolean;
}) {
  const cfg = ORB_CONFIG[state];
  const sz = cfg.size;

  return (
    <div
      className="relative flex items-center justify-center transition-all duration-500"
      style={{ width: sz, height: sz, willChange: "width, height" }}
    >
      {/* Outermost halo — always */}
      <span
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${cfg.glowColor} 0%, transparent 70%)`,
          boxShadow: cfg.glowSize,
          animation: state === "idle"
            ? "hm-orb-idle-breathe 3.5s ease-in-out infinite"
            : state === "speaking"
            ? "hm-outer-glow-pulse 0.8s ease-in-out infinite"
            : "hm-orb-idle-breathe 2s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />

      {/* Alert ring */}
      {alertMode && (
        <span
          className="absolute rounded-full pointer-events-none"
          style={{
            inset: -4,
            border: "2px solid rgba(239,68,68,0.6)",
            borderRadius: "50%",
            animation: "hm-alert-ring 1.5s ease-in-out infinite",
            willChange: "box-shadow",
          }}
        />
      )}

      {/* Outer rotating ring (dashed) */}
      <span
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: 4,
          border: `1px dashed ${cfg.ringColor}`,
          opacity: cfg.ringOpacity,
          animation: state === "thinking"
            ? "hm-ring-cw 1.2s linear infinite"
            : state === "speaking"
            ? "hm-ring-cw 1.8s linear infinite"
            : state === "listening"
            ? "hm-ring-cw 2.5s linear infinite"
            : "hm-ring-cw 6s linear infinite",
          willChange: "transform",
        }}
      />

      {/* Middle counter-ring (dotted) */}
      <span
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: 10,
          border: `1px dotted ${cfg.ringColor}`,
          opacity: cfg.ringOpacity * 0.6,
          animation: state === "thinking"
            ? "hm-ring-ccw 0.9s linear infinite"
            : state === "speaking"
            ? "hm-ring-ccw 1.4s linear infinite"
            : "hm-ring-ccw 8s linear infinite",
          willChange: "transform",
        }}
      />

      {/* Pulse rings (listening + speaking) */}
      {(state === "listening" || state === "speaking") && (
        <>
          <span
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              border: `1px solid ${cfg.ringColor}`,
              animation: "hm-pulse-out 1.6s ease-out infinite",
              willChange: "transform, opacity",
            }}
          />
          <span
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              border: `1px solid ${cfg.ringColor}`,
              animation: "hm-pulse-out 1.6s ease-out infinite",
              animationDelay: "0.8s",
              willChange: "transform, opacity",
            }}
          />
        </>
      )}

      {/* Waveform bars — speaking only */}
      {state === "speaking" && <WaveformBars />}

      {/* Core sphere */}
      <span
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: 16,
          background: `radial-gradient(circle at 38% 38%, rgba(255,255,255,0.25), transparent 70%), radial-gradient(circle, ${cfg.glowColor} 0%, rgba(0,30,60,0.6) 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2), 0 0 12px 4px ${cfg.glowColor}`,
          animation: state === "thinking"
            ? "hm-core-think 1.8s ease-in-out infinite"
            : state === "idle"
            ? "hm-orb-idle-breathe 3.5s ease-in-out infinite"
            : undefined,
          willChange: "transform",
        }}
      />

      {/* Bright center dot */}
      <span
        className="absolute rounded-full pointer-events-none transition-all duration-500"
        style={{
          width: cfg.coreSize,
          height: cfg.coreSize,
          marginLeft: -(cfg.coreSize / 2),
          marginTop: -(cfg.coreSize / 2),
          top: "50%",
          left: "50%",
          background: cfg.coreColor,
          boxShadow: `0 0 12px 6px ${cfg.glowColor}, 0 0 24px 10px ${cfg.glowColor}`,
          willChange: "width, height, box-shadow",
        }}
      />

      {/* Notification badge */}
      {notifCount > 0 && (
        <span
          className="absolute -top-1 -right-1 flex items-center justify-center rounded-full text-[9px] font-bold text-white pointer-events-none"
          style={{
            width: 16, height: 16,
            background: "linear-gradient(135deg, #f59e0b, #ef4444)",
            boxShadow: "0 0 6px rgba(239,68,68,0.6)",
            animation: "hm-notification-pop 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards",
            willChange: "transform, opacity",
          }}
        >
          {notifCount > 9 ? "9+" : notifCount}
        </span>
      )}
    </div>
  );
}

// ── Mini chat panel ────────────────────────────────────────────────────────────
function MiniChat({ onClose, onStateChange }: {
  onClose: () => void;
  onStateChange: (s: { thinking: boolean; speaking: boolean; listening: boolean }) => void;
}) {
  const aiFn  = useServerFn(getHiveMindAIResponse);
  const ttsFn = useServerFn(getHiveMindTTS);

  const [messages, setMessages]   = useState<Msg[]>([]);
  const [input, setInput]         = useState("");
  const [thinking, setThinkingS]  = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeakingS]  = useState(false);
  const [micError, setMicError]   = useState<string | null>(null);

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const recognRef  = useRef<any>(null);
  const ttsGenRef  = useRef(0);
  const prefs      = useRef(loadPrefs());
  const userName   = useRef(loadUserName());

  const setThinking = useCallback((v: boolean) => {
    setThinkingS(v);
    onStateChange({ thinking: v, speaking: false, listening: recording });
  }, [recording, onStateChange]);

  const setSpeaking = useCallback((v: boolean) => {
    setSpeakingS(v);
    onStateChange({ thinking: false, speaking: v, listening: recording });
  }, [recording, onStateChange]);

  useEffect(() => {
    onStateChange({ thinking, speaking, listening: recording });
  }, [thinking, speaking, recording]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, minimized]);

  useEffect(() => {
    const name = userName.current;
    setMessages([{ id: "greet", role: "hm", content: name ? `Online, ${name}. How can I assist?` : "HiveMind online. How can I assist?" }]);
  }, []);

  function stopAudio() { audioRef.current?.pause(); audioRef.current = null; setSpeaking(false); }

  async function playTTS(text: string) {
    stopAudio();
    const gen = ++ttsGenRef.current;
    const p = prefs.current;
    try {
      const r = await ttsFn({ data: { text: text.slice(0, 600), voiceId: p.voiceId, speed: p.speed } });
      if (gen !== ttsGenRef.current) return;
      if (!r.audioBase64) return;
      const audio = new Audio(`data:audio/mpeg;base64,${r.audioBase64}`);
      audio.playbackRate = p.speed;
      audioRef.current  = audio;
      setSpeaking(true);
      audio.play().catch(() => setSpeaking(false));
      audio.onended = () => { setSpeaking(false); audioRef.current = null; };
      audio.onerror = () => { setSpeaking(false); audioRef.current = null; };
    } catch { if (gen === ttsGenRef.current) setSpeaking(false); }
  }

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const userMsg: Msg     = { id: uid(), role: "user", content: text.trim() };
    const placeholder: Msg = { id: uid(), role: "hm",   content: "" };
    setMessages(prev => [...prev, userMsg, placeholder]);
    historyRef.current.push({ role: "user", content: text.trim() });
    setInput("");
    setThinking(true);
    try {
      const r = await aiFn({ data: { query: text.trim(), history: historyRef.current.slice(-6), personality: prefs.current.personality, userName: userName.current } });
      historyRef.current.push({ role: "assistant", content: r.response });
      const reply: Msg = { ...placeholder, content: r.response };
      setMessages(prev => prev.map(m => m.id === placeholder.id ? reply : m));
      playTTS(r.response);
    } catch (err: any) {
      const msg = err?.message ?? String(err ?? "Unknown error");
      setMessages(prev => prev.map(m => m.id === placeholder.id
        ? { ...m, content: `Error: ${msg.slice(0, 200)}` }
        : m
      ));
    } finally { setThinking(false); }
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { setMicError("Not supported — use Chrome or Edge"); setTimeout(() => setMicError(null), 4000); return; }
    if (recording) { recognRef.current?.stop(); setRecording(false); return; }
    setMicError(null);
    const r = new SR();
    recognRef.current = r;
    r.continuous      = false;
    r.interimResults  = false;
    r.lang            = "en-US";
    r.maxAlternatives = 1;
    r.onstart  = () => setRecording(true);
    r.onend    = () => setRecording(false);
    r.onerror  = (e: any) => {
      setRecording(false);
      const labels: Record<string, string> = {
        "not-allowed": "Mic blocked — allow microphone", "no-speech": "No speech heard",
        "audio-capture": "No mic found", "network": "Network error", "aborted": "",
      };
      const label = labels[e.error] ?? `Mic error: ${e.error}`;
      if (label) { setMicError(label); setTimeout(() => setMicError(null), 4000); }
    };
    r.onresult = (e: any) => {
      const t = (e.results[0]?.[0]?.transcript as string | undefined)?.trim();
      if (t) {
        setInput(t);
        setTimeout(() => {
          setInput(prev => { if (prev === t) { send(t); return ""; } return prev; });
        }, 800);
      }
    };
    try { r.start(); } catch (err: any) {
      setRecording(false);
      setMicError(`Could not start mic: ${err?.message ?? "unknown"}`);
      setTimeout(() => setMicError(null), 4000);
    }
  }

  return (
    <div className={cn(
      "absolute bottom-24 right-0 w-[340px] rounded-2xl overflow-hidden transition-all duration-300 select-text",
      minimized ? "h-12" : "h-[440px]",
    )}
    style={{
      background: "linear-gradient(160deg, rgba(2,12,27,0.97) 0%, rgba(4,20,44,0.97) 100%)",
      border: "1px solid rgba(6,182,212,0.15)",
      boxShadow: "0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(6,182,212,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
      backdropFilter: "blur(24px)",
    }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid rgba(6,182,212,0.1)" }}>
        {/* Mini orb indicator */}
        <div className="relative h-5 w-5 shrink-0 flex items-center justify-center">
          <div className={cn(
            "h-2 w-2 rounded-full transition-all duration-300",
            speaking
              ? "bg-white shadow-[0_0_8px_3px_rgba(6,182,212,0.9),0_0_16px_6px_rgba(6,182,212,0.5)]"
              : thinking
              ? "bg-indigo-300 shadow-[0_0_6px_2px_rgba(99,102,241,0.7)]"
              : recording
              ? "bg-cyan-300 shadow-[0_0_6px_2px_rgba(6,182,212,0.8)]"
              : "bg-sky-400 shadow-[0_0_4px_2px_rgba(14,165,233,0.5)]",
          )} />
          {(speaking || recording) && (
            <span className="absolute inset-0 rounded-full animate-ping"
              style={{ background: speaking ? "rgba(6,182,212,0.3)" : "rgba(6,182,212,0.2)", animationDuration: speaking ? "0.9s" : "1.4s" }} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-sky-200 tracking-wide">HiveMind</span>
          {(thinking || recording || speaking) && (
            <span className="ml-2 text-[9px] text-sky-400/70 uppercase tracking-widest">
              {thinking ? "thinking" : recording ? "listening" : "speaking"}
            </span>
          )}
        </div>

        {thinking && <Loader2 className="h-3 w-3 text-sky-400 animate-spin" />}

        <button onClick={() => setMinimized(m => !m)}
          className="text-sky-400/30 hover:text-sky-400/70 transition-colors ml-1">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => { stopAudio(); onClose(); }}
          className="text-sky-400/30 hover:text-sky-400/70 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!minimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 h-[calc(440px-100px)]"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(6,182,212,0.2) transparent" }}>
            {messages.map(m => (
              <div key={m.id} className={cn(
                "flex gap-2 max-w-[90%]",
                m.role === "hm" ? "self-start" : "self-end flex-row-reverse ml-auto",
              )}>
                <div className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5",
                  m.role === "hm"
                    ? "bg-sky-500/10 ring-1 ring-sky-500/20"
                    : "bg-white/[0.06]",
                )}>
                  {m.role === "hm"
                    ? <div className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_4px_2px_rgba(14,165,233,0.5)]" />
                    : <User className="h-2.5 w-2.5 text-muted-foreground" />
                  }
                </div>
                <div className={cn(
                  "rounded-xl px-2.5 py-1.5 text-xs leading-relaxed",
                  m.role === "hm"
                    ? "text-sky-100/90"
                    : "text-foreground/80",
                )}
                style={m.role === "hm"
                  ? { background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.12)" }
                  : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }
                }>
                  {m.content === ""
                    ? <span className="flex gap-1 items-center py-0.5">
                        {[0,140,280].map(d => (
                          <span key={d} className="h-1.5 w-1.5 rounded-full animate-bounce"
                            style={{ background: "#22d3ee", animationDelay: `${d}ms` }} />
                        ))}
                      </span>
                    : m.content
                  }
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {micError && (
            <div className="mx-3 mb-1 rounded-lg px-2.5 py-1.5 text-[10px] text-red-400"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              {micError}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-center gap-2 px-3 py-2.5"
            style={{ borderTop: "1px solid rgba(6,182,212,0.1)" }}>
            <button onClick={toggleMic}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all",
                recording
                  ? "border-cyan-500/50 text-cyan-400 animate-pulse"
                  : "border-sky-500/20 text-sky-400/50 hover:text-sky-400",
              )}
              style={recording ? { background: "rgba(6,182,212,0.12)" } : { background: "rgba(14,165,233,0.05)" }}
            >
              {recording ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            </button>

            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(input))}
              placeholder={recording ? "Listening…" : "Ask HiveMind…"}
              className="flex-1 bg-transparent text-xs placeholder:text-sky-400/25 focus:outline-none min-w-0 text-sky-100"
            />

            <button onClick={() => send(input)}
              disabled={!input.trim() || thinking}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all disabled:opacity-25"
              style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", color: "#38bdf8" }}
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Orb ───────────────────────────────────────────────────────────────────
export function HiveMindOrb() {
  const pathname   = useRouterState({ select: s => s.location.pathname });
  const navigate   = useNavigate();

  const [open, setOpen]         = useState(false);
  const [hovered, setHovered]   = useState(false);
  const [notifCount]            = useState(0); // future: wire to hivemind_tasks count
  const [alertMode]             = useState(false); // future: wire to critical system alerts
  const [chatState, setChatState] = useState<{ thinking: boolean; speaking: boolean; listening: boolean }>({
    thinking: false, speaking: false, listening: false,
  });

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Draggable position (offsets from bottom-right, persisted) ──
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 24, bottom: 24 });
  // Restore saved position after mount (avoids SSR/client hydration mismatch).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("hm-orb-pos") ?? "");
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) {
        setPos({
          right: Math.min(Math.max(saved.right, 8), window.innerWidth - 80),
          bottom: Math.min(Math.max(saved.bottom, 8), window.innerHeight - 80),
        });
      }
    } catch {}
  }, []);
  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  function onDragPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, right: pos.right, bottom: pos.bottom, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    d.moved = true;
    setPos({
      right: Math.min(Math.max(d.right - dx, 8), window.innerWidth - 80),
      bottom: Math.min(Math.max(d.bottom - dy, 8), window.innerHeight - 80),
    });
  }
  function onDragPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) {
      suppressClickRef.current = true;
      setPos((p) => {
        try { localStorage.setItem("hm-orb-pos", JSON.stringify(p)); } catch {}
        return p;
      });
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  }

  // Inject keyframes once
  useEffect(() => {
    const id = "hm-orb-styles";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = ORB_STYLES;
    document.head.appendChild(style);
    return () => { /* keep styles mounted for app lifetime */ };
  }, []);

  // Derive orb state from chat state
  const orbState: OrbState = (() => {
    if (chatState.speaking)  return "speaking";
    if (chatState.thinking)  return "thinking";
    if (chatState.listening) return "listening";
    return "idle";
  })();

  // Hide on HiveMind pages (they have their own UI)
  if (pathname.startsWith("/hivemind")) return null;

  function handleOrbClick() {
    if (suppressClickRef.current) return; // was a drag, not a click
    // Debounce single/double click
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      navigate({ to: "/hivemind/chat" });
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      setOpen(o => !o);
    }, 220);
  }

  return (
    <div
      className="fixed z-50 flex flex-col items-end select-none"
      style={{ right: pos.right, bottom: pos.bottom, touchAction: "none" }}
    >
      {/* Chat panel */}
      {open && (
        <MiniChat
          onClose={() => setOpen(false)}
          onStateChange={setChatState}
        />
      )}

      <div className="relative flex flex-col items-end">
        {/* Full HiveMind link pill (when open) */}
        {open && (
          <a
            href="/hivemind/chat"
            className="mb-2 flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[10px] text-sky-300/70 hover:text-sky-300 transition-colors shadow-md"
            style={{
              background: "rgba(2,12,27,0.92)",
              border: "1px solid rgba(6,182,212,0.15)",
              backdropFilter: "blur(16px)",
            }}
          >
            Full HiveMind <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}

        {/* Tooltip (hover, not open) */}
        {hovered && !open && (
          <div
            className="absolute bottom-full right-0 mb-3 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-medium pointer-events-none"
            style={{
              background: "rgba(2,12,27,0.95)",
              border: "1px solid rgba(6,182,212,0.2)",
              color: "#bae6fd",
              backdropFilter: "blur(12px)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
          >
            <span className="opacity-60 text-[9px] uppercase tracking-widest mr-1.5">DoubleClick</span>Full HiveMind
            <div
              className="absolute -bottom-1 right-5 w-2 h-2 rotate-45"
              style={{ background: "rgba(2,12,27,0.95)", borderRight: "1px solid rgba(6,182,212,0.2)", borderBottom: "1px solid rgba(6,182,212,0.2)" }}
            />
          </div>
        )}

        {/* State label (appears when active) */}
        {orbState !== "idle" && (
          <div
            className="absolute right-full mr-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-widest pointer-events-none"
            style={{
              background: "rgba(2,12,27,0.9)",
              border: `1px solid ${orbState === "speaking" ? "rgba(6,182,212,0.3)" : orbState === "thinking" ? "rgba(99,102,241,0.3)" : "rgba(6,182,212,0.25)"}`,
              color: orbState === "speaking" ? "#22d3ee" : orbState === "thinking" ? "#a5b4fc" : "#7dd3fc",
              backdropFilter: "blur(12px)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: orbState === "speaking" ? "#22d3ee" : orbState === "thinking" ? "#a5b4fc" : "#7dd3fc",
                animation: "hm-orb-idle-breathe 1.2s ease-in-out infinite",
                boxShadow: `0 0 4px 2px ${orbState === "speaking" ? "rgba(6,182,212,0.6)" : "rgba(99,102,241,0.5)"}`,
              }}
            />
            {ORB_CONFIG[orbState].label}
          </div>
        )}

        {/* The orb button */}
        <button
          onClick={handleOrbClick}
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-label="Open HiveMind Executive Assistant (drag to move)"
          title="Drag to move"
          className="relative cursor-grab active:cursor-grabbing transition-transform duration-300 active:scale-95 focus:outline-none"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            transform: hovered ? "scale(1.1)" : "scale(1)",
          }}
        >
          <OrbVisual
            state={orbState}
            notifCount={notifCount}
            alertMode={alertMode}
            isOpen={open}
          />
        </button>

        {/* "Executive Assistant" identity line */}
        <div
          className="mt-1.5 text-center text-[8px] font-semibold tracking-[0.18em] uppercase pointer-events-none"
          style={{ color: "rgba(6,182,212,0.4)", letterSpacing: "0.18em" }}
        >
          HiveMind
        </div>
      </div>
    </div>
  );
}
