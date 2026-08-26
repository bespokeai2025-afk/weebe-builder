import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState, useNavigate } from "@tanstack/react-router";
import { Send, Mic, MicOff, X, Minus, Loader2, ChevronRight, User, ExternalLink, ClipboardList, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { getHiveMindAIResponse, getHiveMindTTS } from "@/lib/hivemind/hivemind.ai";
import { streamHiveMindChat } from "@/lib/hivemind/use-hivemind-stream";
import { useMindConversation } from "@/hooks/useMindConversation";
import { loadHiveMindVoiceSettings, loadHiveMindUserName } from "@/lib/hivemind/voice-profile";
import { AvaSignal } from "./AvaSignal.portable";
import {
  calculateHiveMindAnchor,
  HIVE_MIND_SHELL_GUTTER,
} from "./hiveMindPositioning";

// ── Types ──────────────────────────────────────────────────────────────────────
import { readinessLabel } from "@/lib/minds/intelligence-packet-ui.shared";

type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";
type WorkOrderProposal = {
  workOrderId: string;
  taskId:      string;
  taskTitle:   string;
  focusCampaign: { campaignId: string; campaignName: string } | null;
  days:        number;
  readinessState?: string | null;
  objective?: string | null;
  approvalScopeSummary?: string | null;
};
type Msg = { id: string; role: "user" | "hm"; content: string; workOrders?: WorkOrderProposal[] };

function uid() { return Math.random().toString(36).slice(2, 9); }

const ORB_LABEL: Record<OrbState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

// ── Orb visual ────────────────────────────────────────────────────────────────
function OrbVisual({ state, notifCount, alertMode, hovered }: {
  state: OrbState;
  notifCount: number;
  alertMode: boolean;
  hovered: boolean;
}) {
  return (
    <div
      className="relative flex h-[105px] w-[126px] items-center justify-center sm:h-[124px] sm:w-[154px] lg:h-[145px] lg:w-[180px]"
      style={{ willChange: "transform" }}
    >
      <AvaSignal
        className="h-[105px] w-[126px] sm:h-[124px] sm:w-[154px] lg:h-[145px] lg:w-[180px]"
        dark
        step={state === "thinking" ? "connecting" : state === "speaking" || state === "listening" ? "live" : state === "error" ? "error" : "idle"}
        agentSpeaking={state === "speaking"}
        hovered={hovered}
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
      {alertMode && (
        <span
          className="absolute right-4 top-7 h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_2px_rgba(248,113,113,0.7)]"
          aria-label="HiveMind alert"
        />
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
  const navigate = useNavigate();

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
  const prefs      = useRef(loadHiveMindVoiceSettings());
  const userName   = useRef(loadHiveMindUserName());

  // ── Shared conversation store (same mind_conversations record as the full
  //    Assistant page, so history follows the user between both interfaces) ──
  const { initialMessages, historyLoaded, persist } = useMindConversation("hivemind");
  const seededRef    = useRef(false);
  const persistedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!historyLoaded || seededRef.current) return;
    if (initialMessages.length === 0) return;
    seededRef.current = true;
    const restored: Msg[] = initialMessages.slice(-30).map(m => ({
      id:      m.id,
      role:    m.role === "user" ? "user" as const : "hm" as const,
      content: m.content,
    }));
    restored.forEach(m => persistedIds.current.add(m.id));
    historyRef.current = initialMessages
      .filter(m => m.role === "user" || m.role === "assistant")
      .slice(-6)
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    setMessages(prev => {
      const liveOnly = prev.filter(p => p.id !== "greet");
      return [...restored, ...liveOnly];
    });
  }, [historyLoaded, initialMessages]);

  const persistNewMessages = useCallback((msgs: Msg[]) => {
    const fresh = msgs.filter(m =>
      !persistedIds.current.has(m.id) && m.id !== "greet" && m.content.trim() !== "",
    );
    if (fresh.length === 0) return;
    fresh.forEach(m => persistedIds.current.add(m.id));
    void persist(fresh.map(m => ({
      role: m.role === "user" ? "user" as const : "assistant" as const,
      content: m.content,
      clientMsgId: m.id,
    }))).then(ok => {
      if (!ok) fresh.forEach(m => persistedIds.current.delete(m.id));
    });
  }, [persist]);

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

  const streamAbortRef = useRef<AbortController | null>(null);
  async function send(text: string) {
    if (!text.trim() || thinking) return;
    const userMsg: Msg     = { id: uid(), role: "user", content: text.trim() };
    const placeholder: Msg = { id: uid(), role: "hm",   content: "" };
    setMessages(prev => [...prev, userMsg, placeholder]);
    historyRef.current.push({ role: "user", content: text.trim() });
    setInput("");
    setThinking(true);
    const abort = new AbortController();
    streamAbortRef.current = abort;
    try {
      const args = { query: text.trim(), history: historyRef.current.slice(-6), personality: prefs.current.personality, userName: userName.current };
      // Stream tokens so the reply renders as it's generated; fall back to the
      // non-streaming server fn if the stream can't be established.
      let r: { response: string; workOrderProposals?: any[] };
      try {
        r = await streamHiveMindChat({
          ...args,
          signal: abort.signal,
          onToken: (fullText) => {
            setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, content: fullText } : m));
          },
        });
      } catch (streamErr) {
        if (abort.signal.aborted) throw streamErr;
        r = await aiFn({ data: args });
      }
      historyRef.current.push({ role: "assistant", content: r.response });
      const reply: Msg = {
        ...placeholder,
        content: r.response,
        workOrders: r.workOrderProposals?.length ? (r.workOrderProposals as any) : undefined,
      };
      setMessages(prev => prev.map(m => m.id === placeholder.id ? reply : m));
      persistNewMessages([userMsg, reply]);
      playTTS(r.response);
    } catch (err: any) {
      if (abort.signal.aborted) {
        // Keep whatever streamed so far and mark the message as stopped.
        setMessages(prev => prev.map(m => m.id === placeholder.id
          ? { ...m, content: m.content ? `${m.content}\n\n(Stopped)` : "Stopped." } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === placeholder.id
          ? { ...m, content: "Sorry — I couldn't get an answer just now. Please try again in a moment." }
          : m
        ));
      }
    } finally {
      streamAbortRef.current = null;
      setThinking(false);
    }
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
        <button onClick={() => { stopAudio(); onClose(); }} aria-label="Close"
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
                  {m.role === "hm" && m.workOrders?.map(wo => (
                    <div key={wo.workOrderId} className="mt-2 rounded-lg px-2.5 py-2"
                      style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
                        <ClipboardList className="h-3 w-3" />
                        Work order ready
                        {wo.readinessState && (
                          <span className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                            style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
                            {readinessLabel(wo.readinessState)}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] text-emerald-100/80">{wo.taskTitle}</div>
                      {wo.objective && (
                        <div className="mt-0.5 text-[10px] text-emerald-100/60 leading-relaxed">{wo.objective}</div>
                      )}
                      {wo.approvalScopeSummary && (
                        <div className="mt-0.5 text-[10px] text-emerald-200/70 leading-relaxed">
                          Approval scope: {wo.approvalScopeSummary}
                        </div>
                      )}
                      <button
                        onClick={() => { onClose(); navigate({ to: "/hivemind/chat" }); }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-emerald-200 transition-colors hover:text-emerald-100"
                        style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)" }}
                      >
                        Review &amp; approve in Assistant <ExternalLink className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
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

            {thinking ? (
              <button onClick={() => { ttsGenRef.current++; stopAudio(); streamAbortRef.current?.abort(); }}
                title="Stop generating"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all"
                style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "#f87171" }}
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            ) : (
              <button onClick={() => send(input)}
                disabled={!input.trim()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all disabled:opacity-25"
                style={{ background: "rgba(14,165,233,0.12)", border: "1px solid rgba(14,165,233,0.25)", color: "#38bdf8" }}
              >
                <Send className="h-3 w-3" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared shell placement ──────────────────────────────────────────────────────
type LayoutAnchor = {
  right: number;
  bottom: number;
  maxRight: number;
  maxBottom: number;
};

type DragState = {
  startX: number;
  startY: number;
  right: number;
  bottom: number;
  maxRight: number;
  maxBottom: number;
  moved: boolean;
};

type DragOffset = { x: number; y: number };

const ORB_OFFSET_STORAGE_KEY = "hm-orb-offset";
const COLLISION_GUTTER = 18;

function viewportOrbSize() {
  if (window.innerWidth < 640) return { width: 126, height: 105 };
  if (window.innerWidth < 1024) return { width: 154, height: 124 };
  return { width: 180, height: 145 };
}

function isVisibleLayoutElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

function getLayoutReserves(
  orbRoot: HTMLElement,
  mainRect: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
) {
  let rightReserve = 0;
  let bottomReserve = 0;
  let cornerBottomReserve = 0;
  const selectors = [
    "[class~='fixed']",
    "[class~='sticky']",
    "aside",
    "[role='complementary']",
    "[data-hivemind-avoid]",
  ].join(",");

  document.querySelectorAll<HTMLElement>(selectors).forEach((element) => {
    if (
      element === orbRoot ||
      orbRoot.contains(element) ||
      element.closest("[data-sidebar='sidebar'], [data-sidebar='sidebar'] *")
    ) {
      return;
    }
    const style = window.getComputedStyle(element);
    const isRail = element.matches("aside, [role='complementary'], [data-hivemind-avoid]");
    if (!isRail && style.position !== "fixed" && style.position !== "sticky") return;
    if (!isVisibleLayoutElement(element)) return;

    const rect = element.getBoundingClientRect();
    const nearMainRight = rect.right >= mainRect.right - 80;
    const tallEnoughForRail = rect.height >= Math.min(viewportHeight * 0.28, 280);
    if (isRail && nearMainRight && tallEnoughForRail && rect.left < mainRect.right) {
      rightReserve = Math.max(rightReserve, viewportWidth - rect.left + COLLISION_GUTTER);
    }

    const touchesBottom = rect.bottom >= viewportHeight - 24 && rect.top < viewportHeight;
    const broadEnoughForBottomBar =
      rect.width >= Math.min(viewportWidth * 0.35, Math.max(260, mainRect.width * 0.35));
    if (
      (style.position === "fixed" || style.position === "sticky") &&
      touchesBottom &&
      broadEnoughForBottomBar &&
      rect.top > 0
    ) {
      bottomReserve = Math.max(bottomReserve, viewportHeight - rect.top + COLLISION_GUTTER);
    }

    const bottomRightFloat =
      (style.position === "fixed" || style.position === "sticky") &&
      rect.right >= viewportWidth - 24 &&
      rect.bottom >= viewportHeight - 24 &&
      rect.width >= 150 &&
      rect.height >= 48;
    if (bottomRightFloat) {
      rightReserve = Math.max(rightReserve, viewportWidth - rect.left + COLLISION_GUTTER);
      cornerBottomReserve = Math.max(
        cornerBottomReserve,
        viewportHeight - rect.top + COLLISION_GUTTER,
      );
    }
  });

  return { rightReserve, bottomReserve, cornerBottomReserve };
}

// ── Main Orb ───────────────────────────────────────────────────────────────────
export function HiveMindOrb() {
  const pathname   = useRouterState({ select: s => s.location.pathname });
  const navigate   = useNavigate();
  const orbRootRef = useRef<HTMLDivElement>(null);

  const [open, setOpen]         = useState(false);
  const [hovered, setHovered]   = useState(false);
  const [notifCount]            = useState(0); // future: wire to hivemind_tasks count
  const [alertMode]             = useState(false); // future: wire to critical system alerts
  const [chatState, setChatState] = useState<{ thinking: boolean; speaking: boolean; listening: boolean }>({
    thinking: false, speaking: false, listening: false,
  });

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Placement is anchored to the authenticated shell's main content area. The
  // persisted value is an offset from that safe anchor, not an arbitrary
  // viewport coordinate, so route/layout changes can still move the entity.
  const [anchor, setAnchor] = useState<LayoutAnchor>({
    right: HIVE_MIND_SHELL_GUTTER,
    bottom: HIVE_MIND_SHELL_GUTTER,
    maxRight: HIVE_MIND_SHELL_GUTTER,
    maxBottom: HIVE_MIND_SHELL_GUTTER,
  });
  const [dragOffset, setDragOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Restore the shell-relative position after mount (avoids SSR/client
  // hydration mismatch). The old viewport-coordinate key is intentionally not
  // reused because it would defeat layout-aware positioning.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(ORB_OFFSET_STORAGE_KEY) ?? "");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        setDragOffset({ x: saved.x, y: saved.y });
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(ORB_OFFSET_STORAGE_KEY, JSON.stringify(dragOffset)); } catch {}
  }, [dragOffset]);

  useLayoutEffect(() => {
    const root = orbRootRef.current;
    if (!root || typeof window === "undefined") return;

    let frame = 0;
    const recalculate = () => {
      frame = 0;
      const main = root.parentElement?.closest<HTMLElement>(".app-shell-main")
        ?? document.querySelector<HTMLElement>(".app-shell-main");
      const mainRect = main?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const { width: orbWidth, height: orbHeight } = viewportOrbSize();
      const { rightReserve, bottomReserve, cornerBottomReserve } = getLayoutReserves(
        root,
        mainRect,
        window.innerWidth,
        window.innerHeight,
      );
      const { right, bottom, maxRight, maxBottom } = calculateHiveMindAnchor({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        mainLeft: mainRect.left,
        mainRight: mainRect.right,
        mainTop: mainRect.top,
        orbWidth,
        orbHeight,
        rightReserve,
        bottomReserve,
        cornerBottomReserve,
      });
      setAnchor((current) => (
        current.right === right &&
        current.bottom === bottom &&
        current.maxRight === maxRight &&
        current.maxBottom === maxBottom
          ? current
          : { right, bottom, maxRight, maxBottom }
      ));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(recalculate);
    };

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedule)
      : null;
    const main = root.parentElement?.closest<HTMLElement>(".app-shell-main")
      ?? document.querySelector<HTMLElement>(".app-shell-main");
    if (main) resizeObserver?.observe(main);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });

    // Observe only the authenticated shell host (which also contains its
    // shell-level overlays), rather than the entire document. This catches
    // rails and bars being mounted/toggled without subscribing HiveMind to
    // unrelated page-wide mutation churn.
    const shellHost = main?.closest(".app-shell-root")?.parentElement ?? main;
    const mutationObserver = typeof MutationObserver !== "undefined" && shellHost
      ? new MutationObserver(schedule)
      : null;
    if (mutationObserver && shellHost) {
      mutationObserver.observe(shellHost, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "style", "data-state", "data-open"],
      });
    }

    recalculate();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, [pathname]);

  const displayedRight = Math.min(
    Math.max(anchor.right - dragOffset.x, anchor.right),
    anchor.maxRight,
  );
  const displayedBottom = Math.min(
    Math.max(anchor.bottom - dragOffset.y, anchor.bottom),
    anchor.maxBottom,
  );
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  function onDragPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      right: displayedRight,
      bottom: displayedBottom,
      maxRight: anchor.maxRight,
      maxBottom: anchor.maxBottom,
      moved: false,
    };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    d.moved = true;
    const right = Math.min(Math.max(d.right - dx, anchor.right), d.maxRight);
    const bottom = Math.min(Math.max(d.bottom - dy, anchor.bottom), d.maxBottom);
    setDragOffset({
      x: anchor.right - right,
      y: anchor.bottom - bottom,
    });
  }
  function onDragPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (d?.moved) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  }

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
      ref={orbRootRef}
      data-hivemind-orb
      className="fixed z-50 flex flex-col items-end select-none"
      style={{
        right: displayedRight,
        bottom: displayedBottom,
        touchAction: "none",
        transition: dragging ? "none" : "right 260ms ease-out, bottom 260ms ease-out",
      }}
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
                boxShadow: `0 0 4px 2px ${orbState === "speaking" ? "rgba(6,182,212,0.6)" : "rgba(99,102,241,0.5)"}`,
              }}
            />
              {ORB_LABEL[orbState]}
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
            hovered={hovered}
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
