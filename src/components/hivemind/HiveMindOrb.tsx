import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState } from "@tanstack/react-router";
import { Send, Mic, MicOff, X, Minus, Loader2, ChevronRight, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHiveMindAIResponse, getHiveMindTTS } from "@/lib/hivemind/hivemind.ai";

// ── Honeycomb SVG — 7 hexagons in a hive cluster ──────────────────────────────
function HoneycombIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden>
      {/* center */}
      <polygon points="15.03,13.75 12,15.5 8.97,13.75 8.97,10.25 12,8.5 15.03,10.25"
        stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
      {/* right */}
      <polygon points="21.09,13.75 18.06,15.5 15.03,13.75 15.03,10.25 18.06,8.5 21.09,10.25"
        stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
      {/* upper-right */}
      <polygon points="18.06,8.5 15.03,10.25 12,8.5 12,5 15.03,3.25 18.06,5"
        stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
      {/* upper-left */}
      <polygon points="12,8.5 8.97,10.25 5.94,8.5 5.94,5 8.97,3.25 12,5"
        stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
      {/* left */}
      <polygon points="8.97,13.75 5.94,15.5 2.91,13.75 2.91,10.25 5.94,8.5 8.97,10.25"
        stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
      {/* lower-left */}
      <polygon points="12,19 8.97,20.75 5.94,19 5.94,15.5 8.97,13.75 12,15.5"
        stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
      {/* lower-right */}
      <polygon points="18.06,19 15.03,20.75 12,19 12,15.5 15.03,13.75 18.06,15.5"
        stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" />
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

// ── Pulsing rings component ────────────────────────────────────────────────────
function OrbRings({ speaking }: { speaking: boolean }) {
  return (
    <>
      {/* Outermost slow ping — only when speaking */}
      {speaking && (
        <span className="absolute inset-0 rounded-full bg-violet-400/20 animate-ping" style={{ animationDuration: "1.4s" }} />
      )}
      {/* Mid ring — faster ping when speaking */}
      {speaking && (
        <span className="absolute inset-[6px] rounded-full bg-violet-400/25 animate-ping" style={{ animationDuration: "0.9s" }} />
      )}
      {/* Steady glow ring */}
      <span className={cn(
        "absolute inset-0 rounded-full transition-all duration-700",
        speaking
          ? "ring-2 ring-violet-400/60 shadow-[0_0_28px_10px_rgba(139,92,246,0.45)]"
          : "ring-1 ring-violet-500/30 shadow-[0_0_12px_4px_rgba(139,92,246,0.18)]",
      )} />
    </>
  );
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

  const [messages, setMessages]     = useState<Msg[]>([]);
  const [input, setInput]           = useState("");
  const [thinking, setThinking]     = useState(false);
  const [minimized, setMinimized]   = useState(false);
  const [recording, setRecording]   = useState(false);

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const recognRef  = useRef<any>(null);

  const prefs   = useRef(loadPrefs());
  const userName = useRef(loadUserName());

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, minimized]);

  // Greet on first open
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
    const userMsg: Msg = { id: uid(), role: "user", content: text.trim() };
    const placeholder: Msg = { id: uid(), role: "hm", content: "" };
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
    } catch (e: any) {
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
      "absolute bottom-16 right-0 w-[340px] rounded-2xl border border-white/[0.08] bg-[hsl(var(--card))] shadow-2xl shadow-black/60 backdrop-blur-xl overflow-hidden transition-all duration-300",
      minimized ? "h-12" : "h-[440px]",
    )}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/[0.06] shrink-0">
        <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_0_8px_2px_rgba(139,92,246,0.4)]">
          <HoneycombIcon className="h-3 w-3 text-white" />
          {speaking && <span className="absolute inset-0 rounded-full bg-violet-400/40 animate-ping" style={{ animationDuration: "0.9s" }} />}
        </div>
        <span className="text-xs font-semibold flex-1">HiveMind</span>
        {thinking && <Loader2 className="h-3 w-3 text-violet-400 animate-spin" />}
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
                  m.role === "hm" ? "bg-violet-500/20 ring-1 ring-violet-500/30" : "bg-white/[0.08]",
                )}>
                  {m.role === "hm"
                    ? <HoneycombIcon className="h-2.5 w-2.5 text-violet-400" />
                    : <User className="h-2.5 w-2.5 text-muted-foreground" />
                  }
                </div>
                <div className={cn(
                  "rounded-xl px-2.5 py-1.5 text-xs leading-relaxed",
                  m.role === "hm"
                    ? "bg-violet-500/[0.08] border border-violet-500/15 text-foreground"
                    : "bg-white/[0.06] border border-white/[0.07] text-foreground",
                )}>
                  {m.content === ""
                    ? <span className="flex gap-1 items-center py-0.5">
                        {[0,120,240].map(d => (
                          <span key={d} className="h-1.5 w-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
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
                  : "border-white/[0.08] text-muted-foreground hover:text-foreground hover:border-white/[0.15]",
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
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 border border-violet-500/30 text-violet-400 hover:bg-violet-500/30 transition-all disabled:opacity-30"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main orb ──────────────────────────────────────────────────────────────────
export function HiveMindOrb() {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const [open, setOpen]       = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Don't render on HiveMind pages — they have their own full interface
  if (pathname.startsWith("/hivemind")) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end select-none">
      {/* Mini chat panel */}
      {open && (
        <MiniChat
          onClose={() => setOpen(false)}
          speaking={speaking}
          setSpeaking={setSpeaking}
        />
      )}

      {/* The orb button */}
      <div className="relative flex items-center justify-center">
        <OrbRings speaking={speaking} />

        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Open HiveMind assistant"
          className={cn(
            "relative flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300",
            "bg-gradient-to-br from-violet-600 via-violet-500 to-indigo-600",
            "shadow-[0_4px_24px_rgba(139,92,246,0.5)]",
            "hover:shadow-[0_4px_32px_rgba(139,92,246,0.7)] hover:scale-105",
            open && "scale-105 shadow-[0_4px_32px_rgba(139,92,246,0.7)]",
          )}
        >
          {/* Inner hexagonal backdrop */}
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white/20 to-transparent" />
          {/* Subtle inner ring */}
          <div className="absolute inset-1 rounded-full ring-1 ring-white/20" />
          {/* Icon */}
          <HoneycombIcon className={cn(
            "relative h-6 w-6 text-white transition-all duration-300",
            speaking && "scale-110",
          )} />
          {/* Speaking dot indicator */}
          {speaking && (
            <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[hsl(var(--card))]" />
          )}
        </button>

        {/* "Go full screen" hint label — appears beside orb when chat is open */}
        {open && (
          <a
            href="/hivemind/chat"
            className="absolute right-16 flex items-center gap-1 whitespace-nowrap rounded-full border border-white/[0.08] bg-[hsl(var(--card))]/90 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur-md hover:text-foreground transition-colors shadow-md"
          >
            Full HiveMind <ChevronRight className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
