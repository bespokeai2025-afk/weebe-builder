import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState } from "@tanstack/react-router";
import { Send, Mic, MicOff, X, Minus, Loader2, ChevronRight, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHiveMindAIResponse, getHiveMindTTS } from "@/lib/hivemind/hivemind.ai";

// ── Types ──────────────────────────────────────────────────────────────────────
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

// ── Mini chat panel ────────────────────────────────────────────────────────────
function MiniChat({ onClose, speaking, setSpeaking }: {
  onClose: () => void; speaking: boolean; setSpeaking: (v: boolean) => void;
}) {
  const aiFn  = useServerFn(getHiveMindAIResponse);
  const ttsFn = useServerFn(getHiveMindTTS);

  const [messages, setMessages]   = useState<Msg[]>([]);
  const [input, setInput]         = useState("");
  const [thinking, setThinking]   = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micError, setMicError]   = useState<string | null>(null);

  const historyRef   = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const bottomRef    = useRef<HTMLDivElement>(null);
  const audioRef     = useRef<HTMLAudioElement | null>(null);
  const recognRef    = useRef<any>(null);
  const ttsGenRef    = useRef(0);          // incremented on every new TTS call; stale fetches bail out
  const prefs        = useRef(loadPrefs());
  const userName     = useRef(loadUserName());

  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking, minimized]);

  useEffect(() => {
    const name = userName.current;
    setMessages([{ id: "greet", role: "hm", content: name ? `Hey ${name}! What's on your mind?` : "Hey! What can I help you with?" }]);
  }, []);

  function stopAudio() { audioRef.current?.pause(); audioRef.current = null; setSpeaking(false); }

  async function playTTS(text: string) {
    stopAudio();
    const gen = ++ttsGenRef.current;   // claim this generation; any older fetch will bail
    const p = prefs.current;
    try {
      const r = await ttsFn({ data: { text: text.slice(0, 600), voiceId: p.voiceId, speed: p.speed } });
      if (gen !== ttsGenRef.current) return;   // a newer call started — discard this result
      if (!r.audioBase64) return;
      const audio = new Audio(`data:audio/mpeg;base64,${r.audioBase64}`);
      audio.playbackRate = p.speed;
      audioRef.current = audio;
      setSpeaking(true);
      audio.play().catch(() => setSpeaking(false));
      audio.onended = () => { setSpeaking(false); audioRef.current = null; };
      audio.onerror = () => { setSpeaking(false); audioRef.current = null; };
    } catch { if (gen === ttsGenRef.current) setSpeaking(false); }
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
      const r = await aiFn({ data: { query: text.trim(), history: historyRef.current.slice(-6), personality: prefs.current.personality, userName: userName.current } });
      historyRef.current.push({ role: "assistant", content: r.response });
      const reply: Msg = { ...placeholder, content: r.response };
      setMessages(prev => prev.map(m => m.id === placeholder.id ? reply : m));
      playTTS(r.response);
    } catch (err: any) {
      const msg = err?.message ?? String(err ?? "Unknown error");
      console.error("[HiveMind send error]", msg);
      setMessages(prev => prev.map(m => m.id === placeholder.id
        ? { ...m, content: `Error: ${msg.slice(0, 200)}` }
        : m
      ));
    } finally { setThinking(false); }
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError("Not supported — use Chrome or Edge");
      setTimeout(() => setMicError(null), 4000);
      return;
    }
    if (recording) {
      recognRef.current?.stop();
      setRecording(false);
      return;
    }
    setMicError(null);
    const r = new SR();
    recognRef.current = r;
    r.continuous     = false;
    r.interimResults = false;
    r.lang           = "en-US";
    r.maxAlternatives = 1;
    r.onstart  = () => setRecording(true);
    r.onend    = () => setRecording(false);
    r.onerror  = (e: any) => {
      setRecording(false);
      const labels: Record<string, string> = {
        "not-allowed":    "Mic blocked — allow microphone in your browser settings",
        "no-speech":      "No speech heard — try again",
        "audio-capture":  "No mic found — check your device",
        "network":        "Network error — speech service unavailable",
        "aborted":        "",
      };
      const label = labels[e.error] ?? `Mic error: ${e.error}`;
      if (label) { setMicError(label); setTimeout(() => setMicError(null), 4000); }
    };
    r.onresult = (e: any) => {
      const t = (e.results[0]?.[0]?.transcript as string | undefined)?.trim();
      if (t) {
        // Put transcript in input box — visible + editable, auto-sends if idle
        setInput(t);
        setTimeout(() => {
          setInput(prev => {
            if (prev === t) { send(t); return ""; }
            return prev;
          });
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
      "absolute bottom-24 right-0 w-[340px] rounded-2xl border border-white/[0.08] bg-[hsl(var(--card))] shadow-2xl shadow-black/60 backdrop-blur-xl overflow-hidden transition-all duration-300",
      minimized ? "h-12" : "h-[440px]",
    )}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/[0.06] shrink-0">
        {/* Mini light orb in header */}
        <div className="relative h-5 w-5 shrink-0 flex items-center justify-center">
          <div className={cn(
            "h-2.5 w-2.5 rounded-full transition-all duration-300",
            speaking
              ? "bg-white shadow-[0_0_8px_3px_rgba(167,139,250,0.9),0_0_16px_6px_rgba(139,92,246,0.5)]"
              : "bg-violet-400 shadow-[0_0_6px_2px_rgba(139,92,246,0.6)]",
          )} />
          {speaking && <span className="absolute inset-0 rounded-full bg-violet-400/30 animate-ping" style={{ animationDuration: "0.9s" }} />}
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
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 h-[calc(440px-100px)]">
            {messages.map(m => (
              <div key={m.id} className={cn("flex gap-2 max-w-[88%]", m.role === "hm" ? "self-start" : "self-end flex-row-reverse ml-auto")}>
                <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5",
                  m.role === "hm" ? "bg-violet-500/10 ring-1 ring-violet-500/20" : "bg-white/[0.08]",
                )}>
                  {m.role === "hm"
                    ? <div className="h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_4px_2px_rgba(139,92,246,0.5)]" />
                    : <User className="h-2.5 w-2.5 text-muted-foreground" />
                  }
                </div>
                <div className={cn("rounded-xl px-2.5 py-1.5 text-xs leading-relaxed",
                  m.role === "hm" ? "bg-violet-500/[0.06] border border-violet-500/10" : "bg-white/[0.06] border border-white/[0.07]",
                )}>
                  {m.content === ""
                    ? <span className="flex gap-1 items-center py-0.5">
                        {[0,120,240].map(d => <span key={d} className="h-1.5 w-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                      </span>
                    : m.content
                  }
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {micError && (
            <div className="mx-3 mb-1 rounded-lg bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 text-[10px] text-red-400">
              {micError}
            </div>
          )}

          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-white/[0.06]">
            <button onClick={toggleMic} className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all",
              recording ? "border-red-500/40 bg-red-500/15 text-red-400 animate-pulse" : "border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}>
              {recording ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(input))}
              placeholder={recording ? "Listening…" : "Ask HiveMind…"}
              className="flex-1 bg-transparent text-xs placeholder:text-muted-foreground/40 focus:outline-none min-w-0"
            />
            <button onClick={() => send(input)} disabled={!input.trim() || thinking}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-400 hover:bg-violet-500/25 transition-all disabled:opacity-30"
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
  const pathname                = useRouterState({ select: s => s.location.pathname });
  const [open, setOpen]         = useState(false);
  const [speaking, setSpeaking] = useState(false);

  if (pathname.startsWith("/hivemind")) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end select-none">
      {open && <MiniChat onClose={() => setOpen(false)} speaking={speaking} setSpeaking={setSpeaking} />}

      <div className="relative flex items-center justify-center">

        {/* ── Starburst rays — speaking only ── */}
        {speaking && (
          <>
            {/* Fast violet rays */}
            <div className="absolute pointer-events-none" style={{
              width: 200, height: 200, borderRadius: "50%",
              background: "repeating-conic-gradient(from 0deg, rgba(167,139,250,0.5) 0deg 1.5deg, transparent 1.5deg 11deg)",
              animation: "hm-ray-spin 2.2s linear infinite",
              maskImage: "radial-gradient(circle, transparent 18%, black 38%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 18%, black 38%, transparent 100%)",
            }} />
            {/* Slow counter-spin rays */}
            <div className="absolute pointer-events-none" style={{
              width: 240, height: 240, borderRadius: "50%",
              background: "repeating-conic-gradient(from 5deg, rgba(124,58,237,0.3) 0deg 1deg, transparent 1deg 13deg)",
              animation: "hm-ray-spin-slow 3.8s linear infinite",
              maskImage: "radial-gradient(circle, transparent 22%, black 40%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(circle, transparent 22%, black 40%, transparent 100%)",
            }} />
            {/* Outer haze */}
            <div className="absolute pointer-events-none" style={{
              width: 160, height: 160, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(196,181,253,0.15) 0%, rgba(139,92,246,0.08) 50%, transparent 100%)",
              animation: "hm-glow-pulse 1.1s ease-in-out infinite",
            }} />
          </>
        )}

        {/* ── The orb itself — pure glowing light ── */}
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Open HiveMind assistant"
          className="relative cursor-pointer hover:scale-110 active:scale-95 transition-transform duration-300"
          style={{ background: "none", border: "none", padding: 0, width: 56, height: 56 }}
        >
          {/* Outer soft halo */}
          <span className={cn(
            "absolute inset-0 rounded-full transition-all duration-700",
            speaking
              ? "bg-violet-500/10 shadow-[0_0_40px_20px_rgba(139,92,246,0.35)]"
              : "bg-violet-500/5 shadow-[0_0_20px_8px_rgba(139,92,246,0.2)]",
          )} style={{ animation: speaking ? "hm-orb-breathe 1.2s ease-in-out infinite" : undefined }} />

          {/* Mid glow ring */}
          <span className={cn(
            "absolute inset-3 rounded-full transition-all duration-500",
            speaking
              ? "bg-violet-400/25 shadow-[0_0_20px_8px_rgba(167,139,250,0.5)]"
              : "bg-violet-400/10 shadow-[0_0_10px_4px_rgba(139,92,246,0.3)]",
          )} />

          {/* Bright core */}
          <span className={cn(
            "absolute rounded-full transition-all duration-300",
            speaking ? "inset-[14px]" : "inset-[18px]",
            speaking
              ? "bg-white shadow-[0_0_12px_6px_rgba(255,255,255,0.6),0_0_24px_12px_rgba(196,181,253,0.5)]"
              : "bg-violet-200 shadow-[0_0_8px_4px_rgba(196,181,253,0.4)]",
          )} />

          {/* Speaking ping rings */}
          {speaking && <>
            <span className="absolute inset-1 rounded-full bg-violet-400/20 animate-ping" style={{ animationDuration: "1.3s" }} />
            <span className="absolute inset-3 rounded-full bg-violet-300/25 animate-ping" style={{ animationDuration: "0.85s" }} />
          </>}
        </button>

        {/* Full HiveMind pill */}
        {open && (
          <a href="/hivemind/chat"
            className="absolute right-16 flex items-center gap-1 whitespace-nowrap rounded-full border border-white/[0.08] bg-[hsl(var(--card))]/90 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur-md hover:text-foreground transition-colors shadow-md"
          >
            Full HiveMind <ChevronRight className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
