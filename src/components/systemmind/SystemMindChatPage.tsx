import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, Send, Loader2, Bot, User, RefreshCw, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import { getSystemMindData } from "@/lib/systemmind/systemmind.functions";
import { supabase } from "@/integrations/supabase/client";

type Message = { role: "user" | "assistant"; content: string; streaming?: boolean };

const STARTERS = [
  "What are the highest-risk issues on the platform right now?",
  "Give me a reliability assessment for this week.",
  "How can I reduce our API error rate?",
  "Which providers should I prioritise connecting next?",
];

export function SystemMindChatPage() {
  const dataFn = useServerFn(getSystemMindData);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const voiceEnabledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const { data: platformData } = useQuery({
    queryKey: ["systemmind-data"],
    queryFn: () => dataFn(),
    throwOnError: false,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (!voiceEnabled) {
      recognitionRef.current?.stop();
      setListening(false);
    }
  }, [voiceEnabled]);

  function startListening() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceEnabled(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onstart = () => setListening(true);
    recognition.onresult = (e: any) => {
      const transcript: string = e.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + transcript : transcript));
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognition.start();
    recognitionRef.current = recognition;
  }

  function toggleVoice() {
    if (voiceEnabled) {
      recognitionRef.current?.stop();
      setVoiceEnabled(false);
      setListening(false);
    } else {
      setVoiceEnabled(true);
      setTimeout(startListening, 50);
    }
  }

  function handleMicClick() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
    } else {
      startListening();
    }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    const userMsg: Message = { role: "user", content };
    const newMsgs: Message[] = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setSending(true);

    // Placeholder assistant bubble that will stream tokens into it
    const assistantIndex = newMsgs.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/public/systemmind/chat-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: newMsgs.map(({ role, content }) => ({ role, content })),
          platformData,
          personality: "professional",
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const dec = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "token" && evt.content) {
              accumulated += evt.content;
              const snap = accumulated;
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = { role: "assistant", content: snap, streaming: true };
                return updated;
              });
            } else if (evt.type === "done") {
              const final = accumulated;
              setMessages((prev) => {
                const updated = [...prev];
                updated[assistantIndex] = { role: "assistant", content: final || "…", streaming: false };
                return updated;
              });
            } else if (evt.type === "error") {
              throw new Error(evt.message ?? "Stream error");
            }
          } catch (parseErr: any) {
            if (parseErr?.message && !parseErr.message.startsWith("JSON")) throw parseErr;
          }
        }
      }

      // Finalize if done event was not explicit
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[assistantIndex]?.streaming) {
          updated[assistantIndex] = { role: "assistant", content: accumulated || "…", streaming: false };
        }
        return updated;
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIndex] = {
          role: "assistant",
          content: `⚠️ ${e?.message ?? "Request failed."}`,
          streaming: false,
        };
        return updated;
      });
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  return (
    <SystemMindShell>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-3 shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 ring-1 ring-sky-500/30">
            <MessageSquare className="h-4 w-4 text-sky-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">CTO Chat</h1>
            <p className="text-[11px] text-muted-foreground">Technical advisor grounded in live platform telemetry</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={toggleVoice}
              title={voiceEnabled ? "Disable voice input" : "Enable voice input"}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                voiceEnabled
                  ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40"
                  : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]",
              )}
            >
              {voiceEnabled ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{voiceEnabled ? "Voice on" : "Voice"}</span>
            </button>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { abortRef.current?.abort(); setMessages([]); setSending(false); }}>
                <RefreshCw className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </div>

        {/* Listening banner */}
        {listening && (
          <div className="border-b border-sky-500/20 bg-sky-500/[0.04] px-6 py-2 flex items-center gap-2 shrink-0">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
            <p className="text-[11px] text-sky-300">Listening… speak now</p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-sky-500/10 ring-1 ring-sky-500/20">
                <Bot className="h-7 w-7 text-sky-400" />
              </div>
              <div>
                <p className="text-sm font-medium">SystemMind CTO</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">Ask me about platform reliability, providers, infrastructure, cost, or security.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="text-left rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-sky-400" />
                  </div>
                )}
                <div className={cn(
                  "max-w-[80%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap",
                  m.role === "user"
                    ? "bg-sky-500/15 text-sky-100 rounded-br-sm"
                    : "border border-white/[0.06] bg-white/[0.03] text-foreground rounded-bl-sm",
                )}>
                  {m.content || (m.streaming ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Thinking…</span>
                    </span>
                  ) : "…")}
                  {m.streaming && m.content && (
                    <span className="inline-block w-[2px] h-[11px] ml-[1px] bg-sky-400 animate-pulse align-middle" />
                  )}
                </div>
                {m.role === "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] mt-0.5">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-white/[0.06] px-4 md:px-8 py-4 shrink-0">
          <div className="flex gap-2 max-w-3xl mx-auto">
            {voiceEnabled && (
              <button
                onClick={handleMicClick}
                title={listening ? "Stop recording" : "Start recording"}
                className={cn(
                  "self-end rounded-xl border px-3 py-2.5 transition-colors shrink-0",
                  listening
                    ? "border-sky-500/50 bg-sky-500/20 text-sky-400 animate-pulse"
                    : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-sky-400 hover:border-sky-500/30",
                )}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={voiceEnabled && listening ? "Listening…" : "Ask SystemMind anything about your platform…"}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50 min-h-[40px] max-h-32"
            />
            <Button size="sm" onClick={() => send()} disabled={!input.trim() || sending} className="self-end bg-sky-600 hover:bg-sky-500 text-white shrink-0">
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground/40 mt-2">Shift+Enter for new line · Enter to send</p>
        </div>
      </div>
    </SystemMindShell>
  );
}
