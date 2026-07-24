import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  TrendingUp, Mic, MicOff, Send, Settings2,
  Loader2, Square, Play, Pause, X, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import {
  getGrowthMindAIResponse, getGrowthMindBriefing,
  getGrowthMindTTS, listGrowthMindVoices,
} from "@/lib/growthmind/growthmind.ai";
import { useMindConversation } from "@/hooks/useMindConversation";

type Role = "user" | "growthmind";
type ChatMessage = {
  id:           string;
  role:         Role;
  content:      string;
  ts:           Date;
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
  voiceId:     "21m00Tcm4TlvDq8ikWAM",
  voiceName:   "Rachel",
  speed:       1.0,
  personality: "professional",
  autoPlay:    false,
};
const SPEED_OPTIONS = [0.7, 0.85, 1.0, 1.15, 1.3, 1.5];
const PERSONALITIES = ["professional", "friendly", "concise"] as const;
const SUGGESTED = [
  "How are my ads doing?",
  "What's my biggest growth opportunity right now?",
  "Which leads are most likely to convert?",
  "How can I improve my conversion rate?",
  "What campaigns should I be running?",
];

function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function loadVoiceSettings(): VoiceSettings {
  try {
    const s = localStorage.getItem("growthmind-voice-settings");
    return s ? { ...DEFAULT_VOICE, ...JSON.parse(s) } : DEFAULT_VOICE;
  } catch { return DEFAULT_VOICE; }
}
function saveVoiceSettings(s: VoiceSettings) {
  try { localStorage.setItem("growthmind-voice-settings", JSON.stringify(s)); } catch {}
}

function MessageText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="text-sm leading-relaxed space-y-1">
      {lines.map((line, i) => {
        const parts    = line.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**")
            ? <strong key={j} className="font-semibold">{p.slice(2, -2)}</strong>
            : <span key={j}>{p}</span>
        );
        if (line.startsWith("• ") || line.startsWith("- ")) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="text-emerald-400 shrink-0 mt-0.5">•</span>
              <span>{rendered.slice(1)}</span>
            </div>
          );
        }
        return <div key={i}>{rendered}</div>;
      })}
    </div>
  );
}

function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const play = useCallback((id: string, base64: string, speed: number) => {
    audioRef.current?.pause();
    const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
    audio.playbackRate = speed;
    audioRef.current = audio;
    setPlayingId(id);
    audio.play().catch(() => {});
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
  }, []);
  const stop = useCallback(() => { audioRef.current?.pause(); setPlayingId(null); }, []);
  return { playingId, play, stop };
}

function VoiceSettingsPanel({ settings, onChange, onClose, voices }: {
  settings: VoiceSettings;
  onChange: (s: VoiceSettings) => void;
  onClose:  () => void;
  voices:   { id: string; name: string; category: string }[];
}) {
  return (
    <div className="border-b border-white/[0.07] bg-[hsl(var(--card))] px-5 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.1em]">Voice Settings</p>
        <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Voice</label>
        {voices.length === 0
          ? <p className="text-[11px] text-muted-foreground/60 italic">Add an ElevenLabs API key in Settings → Integrations to unlock voices</p>
          : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-1">
              {voices.slice(0, 18).map(v => (
                <button
                  key={v.id}
                  onClick={() => onChange({ ...settings, voiceId: v.id, voiceName: v.name })}
                  className={cn(
                    "text-left px-2.5 py-1.5 rounded-lg border text-xs transition-all",
                    settings.voiceId === v.id
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground",
                  )}
                >
                  <p className="font-medium truncate">{v.name}</p>
                  <p className="text-[10px] opacity-60 capitalize">{v.category}</p>
                </button>
              ))}
            </div>
          )
        }
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1.5 flex justify-between">
          Speed <span className="text-foreground font-medium">{settings.speed}×</span>
        </label>
        <div className="flex gap-1.5">
          {SPEED_OPTIONS.map(s => (
            <button key={s} onClick={() => onChange({ ...settings, speed: s })} className={cn(
              "flex-1 py-1 rounded-md border text-xs transition-all",
              settings.speed === s ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}>{s}×</button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Personality</label>
        <div className="flex gap-1.5">
          {PERSONALITIES.map(p => (
            <button key={p} onClick={() => onChange({ ...settings, personality: p })} className={cn(
              "flex-1 py-1.5 rounded-lg border text-xs capitalize transition-all",
              settings.personality === p ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}>{p}</button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-white/[0.05]">
        <div>
          <p className="text-xs font-medium">Auto-play responses</p>
          <p className="text-[11px] text-muted-foreground">Speak each reply automatically</p>
        </div>
        <button
          onClick={() => onChange({ ...settings, autoPlay: !settings.autoPlay })}
          className={cn("w-9 h-5 rounded-full relative transition-all", settings.autoPlay ? "bg-emerald-500" : "bg-white/[0.1]")}
        >
          <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", settings.autoPlay ? "left-[18px]" : "left-0.5")} />
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ msg, onPlay, onStop, isPlaying, ttsLoading }: {
  msg:        ChatMessage;
  onPlay:     (id: string, b64: string) => void;
  onStop:     () => void;
  isPlaying:  boolean;
  ttsLoading: boolean;
}) {
  const isGM   = msg.role === "growthmind";
  const isEmpty = msg.content === "";
  return (
    <div className={cn("flex gap-2.5 max-w-[85%]", isGM ? "self-start" : "self-end flex-row-reverse")}>
      <div className={cn(
        "h-7 w-7 shrink-0 rounded-full flex items-center justify-center mt-0.5",
        isGM ? "bg-emerald-500/20 ring-1 ring-emerald-500/30" : "bg-white/[0.08]",
      )}>
        {isGM ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : <User className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>

      <div className={cn("flex flex-col gap-0.5", isGM ? "items-start" : "items-end")}>
        <div className={cn(
          "rounded-xl px-3.5 py-2.5",
          isGM ? "bg-emerald-500/[0.08] border border-emerald-500/15" : "bg-white/[0.07] border border-white/[0.08]",
        )}>
          {isEmpty
            ? <div className="flex gap-1 items-center py-1">
                {[0, 150, 300].map(d => (
                  <span key={d} className="h-1.5 w-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            : <MessageText text={msg.content} />
          }
        </div>

        <div className={cn("flex items-center gap-1.5", isGM ? "flex-row" : "flex-row-reverse")}>
          <span className="text-[10px] text-muted-foreground/50">{fmtTime(msg.ts)}</span>
          {isGM && !isEmpty && (
            <button
              onClick={() => isPlaying ? onStop() : msg.audioBase64 && onPlay(msg.id, msg.audioBase64)}
              disabled={ttsLoading && !msg.audioBase64}
              className="text-muted-foreground/40 hover:text-emerald-400 transition-colors disabled:opacity-30"
            >
              {ttsLoading && !msg.audioBase64
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

function useSpeechRecognition(onResult: (text: string) => void) {
  const recognRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);

  const start = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recog = new SpeechRecognition();
    recog.continuous = false;
    recog.interimResults = false;
    recog.lang = "en-US";
    recog.onresult = (e: any) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      if (text) onResult(text);
    };
    recog.onend = () => setIsRecording(false);
    recog.onerror = () => setIsRecording(false);
    recognRef.current = recog;
    recog.start();
    setIsRecording(true);
  }, [onResult]);

  const stop = useCallback(() => {
    recognRef.current?.stop();
    setIsRecording(false);
  }, []);

  return { isRecording, start, stop };
}

export function GrowthMindChat() {
  const dataFn     = useServerFn(getGrowthMindData);
  const aiFn       = useServerFn(getGrowthMindAIResponse);
  const briefingFn = useServerFn(getGrowthMindBriefing);
  const ttsFn      = useServerFn(getGrowthMindTTS);
  const voicesFn   = useServerFn(listGrowthMindVoices);

  const [messages, setMessages]           = useState<ChatMessage[]>([]);
  const [input, setInput]                 = useState("");
  const [isThinking, setIsThinking]       = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [voices, setVoices]               = useState<{ id: string; name: string; category: string }[]>([]);
  const [ttsLoadingId, setTtsLoadingId]   = useState<string | null>(null);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  const { playingId, play: playAudio, stop: stopAudio } = useAudioPlayer();

  // ── Server-side conversation persistence (per workspace + user) ─────────────
  const { initialMessages, historyLoaded, persist } = useMindConversation("growthmind");
  const seededRef    = useRef(false);
  const persistedIds = useRef<Set<string>>(new Set());

  // Seed chat from server history once it loads (server is authoritative).
  // Don't latch while history is empty — cache-seeded messages can arrive a
  // render later than historyLoaded.
  useEffect(() => {
    if (!historyLoaded || seededRef.current) return;
    if (initialMessages.length === 0) return;
    seededRef.current = true;
    const restored: ChatMessage[] = initialMessages.map(m => ({
      id:      m.id,
      role:    m.role === "user" ? "user" as const : "growthmind" as const,
      content: m.content,
      ts:      new Date(m.createdAt),
    }));
    restored.forEach(m => persistedIds.current.add(m.id));
    historyRef.current = initialMessages
      .filter(m => m.role === "user" || m.role === "assistant")
      .slice(-12)
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    setMessages(prev => {
      const liveOnly = prev.filter(p => p.id !== "briefing");
      return [...restored, ...liveOnly];
    });
  }, [historyLoaded, initialMessages]);

  /** Persist finished, not-yet-saved messages (idempotent via clientMsgId). */
  const persistNewMessages = useCallback((msgs: ChatMessage[]) => {
    const fresh = msgs.filter(m =>
      !persistedIds.current.has(m.id) && m.id !== "briefing" && m.content.trim() !== "",
    );
    if (fresh.length === 0) return;
    fresh.forEach(m => persistedIds.current.add(m.id));
    void persist(fresh.map(m => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
      clientMsgId: m.id,
    }))).then(ok => {
      // Un-mark on failure so a later call retries (clientMsgId keeps it idempotent).
      if (!ok) fresh.forEach(m => persistedIds.current.delete(m.id));
    });
  }, [persist]);

  const { data: platformData } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => dataFn(),
    staleTime: 120_000,
    throwOnError: false,
  });

  useEffect(() => {
    setVoiceSettings(loadVoiceSettings());
    voicesFn().then(r => {
      if (r.voices?.length) {
        setVoices(r.voices);
        setVoiceSettings(prev => {
          if (prev.voiceId === DEFAULT_VOICE.voiceId) {
            const first   = r.voices[0];
            const updated = { ...prev, voiceId: first.id, voiceName: first.name };
            saveVoiceSettings(updated);
            return updated;
          }
          return prev;
        });
      }
    }).catch(() => {});
  }, []);

  // Briefing — only when there is no stored conversation history to show.
  useEffect(() => {
    if (!historyLoaded || initialMessages.length > 0) return;
    let active = true;
    briefingFn({ data: { platformData } }).then(r => {
      if (!active) return;
      const msg: ChatMessage = { id: "briefing", role: "growthmind", content: r.briefing, ts: new Date() };
      setMessages(prev => (prev.length === 0 ? [msg] : prev));
    }).catch(() => {
      const fallback: ChatMessage = {
        id: "briefing", role: "growthmind", ts: new Date(),
        content: "Good morning! I'm GrowthMind, your AI Chief Marketing Officer. Ask me anything about your pipeline, campaigns, or where to focus for maximum growth.",
      };
      if (active) setMessages(prev => (prev.length === 0 ? [fallback] : prev));
    });
    return () => { active = false; };
  }, [historyLoaded, initialMessages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function fetchTTS(msgId: string, text: string) {
    setTtsLoadingId(msgId);
    try {
      const r = await ttsFn({ data: { text, voiceId: voiceSettings.voiceId, speed: voiceSettings.speed } });
      if (r.audioBase64) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, audioBase64: r.audioBase64 } : m));
        if (voiceSettings.autoPlay) playAudio(msgId, r.audioBase64, voiceSettings.speed);
      }
    } catch {} finally {
      setTtsLoadingId(null);
    }
  }

  async function send(text?: string) {
    const userText = (text ?? input).trim();
    if (!userText || isThinking) return;
    setInput("");

    const userMsg: ChatMessage  = { id: uid(), role: "user",        content: userText, ts: new Date() };
    const thinkMsg: ChatMessage = { id: uid(), role: "growthmind",  content: "",       ts: new Date() };
    setMessages(prev => [...prev, userMsg, thinkMsg]);
    historyRef.current.push({ role: "user", content: userText });
    setIsThinking(true);

    try {
      const r = await aiFn({
        data: {
          messages:     historyRef.current.slice(-12),
          platformData: platformData,
          personality:  voiceSettings.personality,
        },
      });
      const reply = r.reply ?? "";
      historyRef.current.push({ role: "assistant", content: reply });

      setMessages(prev => prev.map(m => m.id === thinkMsg.id ? { ...m, content: reply } : m));
      persistNewMessages([userMsg, { ...thinkMsg, content: reply }]);
      await fetchTTS(thinkMsg.id, reply);
    } catch (e: any) {
      const errMsg = e?.message?.includes("API key") ? e.message : "Something went wrong. Please try again.";
      setMessages(prev => prev.map(m => m.id === thinkMsg.id ? { ...m, content: errMsg } : m));
    } finally {
      setIsThinking(false);
    }
  }

  const { isRecording, start: startSpeech, stop: stopSpeech } = useSpeechRecognition(
    useCallback((text: string) => {
      setInput(text);
      send(text);
    }, [])
  );

  function handleVoiceChange(s: VoiceSettings) {
    setVoiceSettings(s);
    saveVoiceSettings(s);
  }

  return (
    <GrowthMindShell>
      <div className="flex flex-col h-full">

        <div className="border-b border-white/[0.06] px-5 py-3 flex items-center gap-3 shrink-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/20 ring-1 ring-emerald-500/30">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">GrowthMind AI Assistant</p>
            <p className="text-[11px] text-muted-foreground">AI-powered marketing advisor</p>
          </div>
          <button
            onClick={() => setSettingsOpen(o => !o)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
              settingsOpen ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground",
            )}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Voice</span>
          </button>
        </div>

        {settingsOpen && (
          <VoiceSettingsPanel
            settings={voiceSettings}
            onChange={handleVoiceChange}
            onClose={() => setSettingsOpen(false)}
            voices={voices}
          />
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onPlay={(id, b64) => playAudio(id, b64, voiceSettings.speed)}
              onStop={stopAudio}
              isPlaying={playingId === msg.id}
              ttsLoading={ttsLoadingId === msg.id}
            />
          ))}

          {messages.length <= 1 && !isThinking && (
            <div className="self-start mt-4">
              <p className="text-[11px] text-muted-foreground mb-2">Suggested questions:</p>
              <div className="flex flex-col gap-1.5">
                {SUGGESTED.map(q => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="text-left text-xs px-3 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-emerald-500/[0.08] hover:border-emerald-500/20 hover:text-foreground text-muted-foreground transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-white/[0.06] px-4 py-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about your pipeline, campaigns, conversion rate…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30 transition-colors min-h-[42px] max-h-32"
              style={{ height: "auto" }}
              onInput={e => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = "auto";
                t.style.height = Math.min(t.scrollHeight, 128) + "px";
              }}
              disabled={isThinking}
            />
            <button
              onClick={() => isRecording ? stopSpeech() : startSpeech()}
              className={cn(
                "h-[42px] w-[42px] shrink-0 rounded-xl border flex items-center justify-center transition-all",
                isRecording
                  ? "border-red-500/40 bg-red-500/15 text-red-400 animate-pulse"
                  : "border-white/[0.08] text-muted-foreground hover:text-foreground hover:border-white/20",
              )}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              onClick={() => send()}
              disabled={!input.trim() || isThinking}
              className={cn(
                "h-[42px] w-[42px] shrink-0 rounded-xl border flex items-center justify-center transition-all",
                input.trim() && !isThinking
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                  : "border-white/[0.06] text-muted-foreground/30 cursor-not-allowed",
              )}
            >
              {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-center">
            GrowthMind analyses your live platform data to give marketing advice
          </p>
        </div>

      </div>
    </GrowthMindShell>
  );
}
