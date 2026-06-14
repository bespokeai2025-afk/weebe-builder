import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState } from "@tanstack/react-router";
import { Send, Mic, MicOff, X, Minus, Loader2, ChevronRight, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHiveMindAIResponse, getHiveMindTTS } from "@/lib/hivemind/hivemind.ai";

// ── HiveEmblem ─────────────────────────────────────────────────────────────────
// 5 pointy-top hexagons: 1 larger center + 4 outer, arranged in a diamond cluster.
// Inspired by the original Webee logo — deep navy fill, bright cyan glowing edges.
function HiveEmblem({
  speaking,
  size = 64,
}: {
  speaking: boolean;
  size?: number;
}) {
  // Pointy-top polygon at (cx,cy) radius r
  const hex = (cx: number, cy: number, r: number) => {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (30 + 60 * i);
      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(" ");
  };

  // Center R=13, 4 outer R=11 — touching the center (apothem sum = 11.26+9.53=20.79)
  const hexes = [
    { pts: hex(34, 34, 13), isCenter: true },   // center (hero hex)
    { pts: hex(23.6, 16, 11), isCenter: false }, // upper-left
    { pts: hex(44.4, 16, 11), isCenter: false }, // upper-right
    { pts: hex(44.4, 52, 11), isCenter: false }, // lower-right
    { pts: hex(23.6, 52, 11), isCenter: false }, // lower-left
  ];

  const strokeColor  = speaking ? "#5de8ff" : "#00cfff";
  const strokeWidth  = speaking ? 1.5 : 1.1;
  const filterId     = speaking ? "hm-glow-speak" : "hm-glow";

  return (
    <svg
      viewBox="0 0 68 68"
      width={size}
      height={size}
      fill="none"
      aria-hidden
      style={{ filter: speaking ? "drop-shadow(0 0 8px rgba(0,210,255,0.6))" : "drop-shadow(0 0 4px rgba(0,180,255,0.3))" }}
    >
      <defs>
        {/* Subtle edge glow — rest state */}
        <filter id="hm-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Stronger edge glow — speaking state */}
        <filter id="hm-glow-speak" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Radial gradient fills */}
        <radialGradient id="hm-fill-center" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#0d1f52" />
          <stop offset="100%" stopColor="#040d24" />
        </radialGradient>
        <radialGradient id="hm-fill-outer" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#0a1840" />
          <stop offset="100%" stopColor="#03091a" />
        </radialGradient>
      </defs>

      {/* Thin connector lines between hex edges — gives the "shared wall" honeycomb feel */}
      <g opacity={speaking ? 0.5 : 0.25} stroke={strokeColor} strokeWidth="0.5">
        {/* center ↔ upper-left */}
        <line x1="22.74" y1="27.5"  x2="23.1"  y2="27"   />
        <line x1="34"    y1="21"    x2="33.13"  y2="21.5" />
        {/* center ↔ upper-right */}
        <line x1="34"    y1="21"    x2="44.4"   y2="27"   />
        <line x1="45.26" y1="27.5"  x2="44.87"  y2="27"   />
        {/* center ↔ lower-right */}
        <line x1="45.26" y1="40.5"  x2="44.4"   y2="41"   />
        <line x1="34"    y1="47"    x2="34.87"  y2="46.5" />
        {/* center ↔ lower-left */}
        <line x1="22.74" y1="40.5"  x2="23.6"   y2="41"   />
        <line x1="34"    y1="47"    x2="33.13"  y2="46.5" />
      </g>

      {/* Hexagons */}
      {hexes.map((h, i) => (
        <g key={i}>
          {/* Speaking pulse shadow behind each hex */}
          {speaking && (
            <polygon
              points={h.pts}
              fill={h.isCenter ? "rgba(0,180,255,0.12)" : "rgba(0,150,255,0.07)"}
              style={{ animation: `hm-glow-pulse ${0.9 + i * 0.08}s ease-in-out infinite alternate` }}
            />
          )}
          <polygon
            points={h.pts}
            fill={`url(#${h.isCenter ? "hm-fill-center" : "hm-fill-outer"})`}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            filter={`url(#${filterId})`}
            style={speaking ? { animation: `hm-glow-pulse ${1.1 + i * 0.07}s ease-in-out infinite alternate` } : undefined}
          />
        </g>
      ))}
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Msg = { id: string; role: "user" | "hm"; content: string };
type VoiceSettings = { voiceId: string; speed: number; personality: "professional" | "friendly" | "concise" };

function uid() { return Math.random().toString(36).slice(2, 9); }

function loadPrefs(): VoiceSettings {
  try {
    const s = localStorage.getItem("hivemind-voice-settings");
    const p = s ? JSON.parse(s) : {};
    return {
      voiceId:     p.voiceId     ?? "21m00Tcm4TlvDq8ikWAM",
      speed:       p.speed       ?? 1.0,
      personality: p.personality ?? "friendly",
    };
  } catch { return { voiceId: "21m00Tcm4TlvDq8ikWAM", speed: 1.0, personality: "friendly" }; }
}
function loadUserName(): string {
  try { return localStorage.getItem("hivemind-user-name") ?? ""; } catch { return ""; }
}

// ── Mini chat panel ────────────────────────────────────────────────────────────
function MiniChat({
  onClose,
  speaking,
  setSpeaking,
}: {
  onClose: () => void;
  speaking: boolean;
  setSpeaking: (v: boolean) => void;
}) {
  const aiFn  = useServerFn(getHiveMindAIResponse);
  const ttsFn = useServerFn(getHiveMindTTS);

  const [messages, setMessages]   = useState<Msg[]>([]);
  const [input, setInput]         = useState("");
  const [thinking, setThinking]   = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [recording, setRecording] = useState(false);

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const recognRef  = useRef<any>(null);
  const prefs      = useRef(loadPrefs());
  const userName   = useRef(loadUserName());

  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, minimized]);

  useEffect(() => {
    const name = userName.current;
    const greeting = name
      ? `Hey ${name}! What's on your mind?`
      : "Hey! What can I help you with today?";
    setMessages([{ id: "greet", role: "hm", content: greeting }]);
  }, []);

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking(false);
  }

  async function playTTS(text: string) {
    stopAudio();
    const p = prefs.current;
    try {
      const r = await ttsFn({ data: { text: text.slice(0, 600), voiceId: p.voiceId, speed: p.speed } });
      if (!r.audioBase64) return;
      const audio = new Audio(`data:audio/mpeg;base64,${r.audioBase64}`);
      audio.playbackRate = p.speed;
      audioRef.current = audio;
      setSpeaking(true);
      audio.play().catch(() => setSpeaking(false));
      audio.onended = () => { setSpeaking(false); audioRef.current = null; };
      audio.onerror = () => { setSpeaking(false); audioRef.current = null; };
    } catch { setSpeaking(false); }
  }

  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const userMsg: Msg    = { id: uid(), role: "user", content: text.trim() };
    const placeholder: Msg = { id: uid(), role: "hm",   content: "" };
    setMessages(prev => [...prev, userMsg, placeholder]);
    historyRef.current.push({ role: "user", content: text.trim() });
    setInput("");
    setThinking(true);
    try {
      const r = await aiFn({
        data: {
          query:       text.trim(),
          history:     historyRef.current.slice(-8),
          personality: prefs.current.personality,
          userName:    userName.current,
        },
      });
      historyRef.current.push({ role: "assistant", content: r.response });
      const reply: Msg = { ...placeholder, content: r.response };
      setMessages(prev => prev.map(m => m.id === placeholder.id ? reply : m));
      await playTTS(r.response);
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === placeholder.id ? { ...m, content: "Sorry — something went wrong. Try again?" } : m
      ));
    } finally { setThinking(false); }
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported in this browser."); return; }
    if (recording) { recognRef.current?.abort(); setRecording(false); return; }
    const r = new SR();
    recognRef.current = r;
    r.continuous = false; r.interimResults = false; r.lang = "en-US";
    r.onstart  = () => setRecording(true);
    r.onend    = () => setRecording(false);
    r.onerror  = () => setRecording(false);
    r.onresult = (e: any) => {
      const t = e.results[0][0].transcript as string;
      setTimeout(() => send(t), 100);
    };
    r.start();
  }

  return (
    <div className={cn(
      "absolute bottom-20 right-0 w-[340px] rounded-2xl border border-white/[0.08] bg-[hsl(var(--card))] shadow-2xl shadow-black/60 backdrop-blur-xl overflow-hidden transition-all duration-300",
      minimized ? "h-12" : "h-[440px]",
    )}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/[0.06] shrink-0">
        <div className="relative shrink-0">
          <HiveEmblem speaking={speaking} size={20} />
        </div>
        <span className="text-xs font-semibold flex-1">HiveMind</span>
        {thinking && <Loader2 className="h-3 w-3 text-cyan-400 animate-spin" />}
        <button onClick={() => setMinimized(m => !m)} className="text-muted-foreground/50 hover:text-foreground transition-colors">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => { stopAudio(); onClose(); }} className="text-muted-foreground/50 hover:text-foreground transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!minimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 h-[calc(440px-100px)]">
            {messages.map(m => (
              <div key={m.id} className={cn("flex gap-2 max-w-[88%]", m.role === "hm" ? "self-start" : "self-end flex-row-reverse ml-auto")}>
                <div className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5",
                  m.role === "hm" ? "bg-cyan-500/10 ring-1 ring-cyan-500/20" : "bg-white/[0.08]",
                )}>
                  {m.role === "hm"
                    ? <HiveEmblem speaking={false} size={12} />
                    : <User className="h-2.5 w-2.5 text-muted-foreground" />
                  }
                </div>
                <div className={cn(
                  "rounded-xl px-2.5 py-1.5 text-xs leading-relaxed",
                  m.role === "hm"
                    ? "bg-cyan-500/[0.06] border border-cyan-500/10 text-foreground"
                    : "bg-white/[0.06] border border-white/[0.07] text-foreground",
                )}>
                  {m.content === ""
                    ? <span className="flex gap-1 items-center py-0.5">
                        {[0, 120, 240].map(d => (
                          <span key={d} className="h-1.5 w-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </span>
                    : m.content
                  }
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-white/[0.06]">
            <button
              onClick={toggleMic}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all",
                recording
                  ? "border-red-500/40 bg-red-500/15 text-red-400"
                  : "border-white/[0.08] text-muted-foreground hover:text-foreground",
              )}
            >
              {recording ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(input))}
              placeholder="Ask HiveMind…"
              className="flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none min-w-0"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || thinking}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25 transition-all disabled:opacity-30"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Orb ──────────────────────────────────────────────────────────────────
export function HiveMindOrb() {
  const pathname               = useRouterState({ select: s => s.location.pathname });
  const [open, setOpen]        = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Hide on HiveMind pages — they have the full interface
  if (pathname.startsWith("/hivemind")) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end select-none">
      {open && (
        <MiniChat
          onClose={() => setOpen(false)}
          speaking={speaking}
          setSpeaking={setSpeaking}
        />
      )}

      {/* ── Starburst rays — speaking only ── */}
      <div className="relative flex items-center justify-center">
        {speaking && (
          <>
            <div
              className="absolute pointer-events-none"
              style={{
                width: 160, height: 160,
                background: "repeating-conic-gradient(from 0deg, rgba(0,200,255,0.5) 0deg 1.5deg, transparent 1.5deg 12deg)",
                animation: "hm-ray-spin 2.2s linear infinite",
                maskImage: "radial-gradient(circle, transparent 25%, black 45%, transparent 100%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 25%, black 45%, transparent 100%)",
                borderRadius: "50%",
              }}
            />
            <div
              className="absolute pointer-events-none"
              style={{
                width: 180, height: 180,
                background: "repeating-conic-gradient(from 8deg, rgba(0,140,255,0.3) 0deg 1deg, transparent 1deg 14deg)",
                animation: "hm-ray-spin-slow 3.5s linear infinite",
                maskImage: "radial-gradient(circle, transparent 28%, black 46%, transparent 100%)",
                WebkitMaskImage: "radial-gradient(circle, transparent 28%, black 46%, transparent 100%)",
                borderRadius: "50%",
              }}
            />
            <div
              className="absolute pointer-events-none"
              style={{
                width: 100, height: 100,
                borderRadius: "50%",
                background: "radial-gradient(circle, rgba(80,220,255,0.25) 0%, rgba(0,130,255,0.1) 50%, transparent 100%)",
                animation: "hm-glow-pulse 1s ease-in-out infinite",
              }}
            />
          </>
        )}

        {/* ── Floating emblem button — no circle, just the hexagon cluster ── */}
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Open HiveMind assistant"
          className={cn(
            "relative cursor-pointer transition-all duration-300",
            "hover:scale-110 active:scale-95",
            open && "scale-105",
          )}
          style={{ background: "none", border: "none", padding: 0 }}
        >
          <HiveEmblem speaking={speaking} size={68} />
        </button>

        {/* "Full HiveMind" pill — appears when panel is open */}
        {open && (
          <a
            href="/hivemind/chat"
            className="absolute right-20 flex items-center gap-1 whitespace-nowrap rounded-full border border-white/[0.08] bg-[hsl(var(--card))]/90 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur-md hover:text-foreground transition-colors shadow-md"
          >
            Full HiveMind <ChevronRight className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
