import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, Send, Loader2, Bot, User, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import { getSystemMindData } from "@/lib/systemmind/systemmind.functions";
import { getSystemMindAIResponse } from "@/lib/systemmind/systemmind.ai";

type Message = { role: "user" | "assistant"; content: string };

const STARTERS = [
  "What are the highest-risk issues on the platform right now?",
  "Give me a reliability assessment for this week.",
  "How can I reduce our API error rate?",
  "Which providers should I prioritise connecting next?",
];

export function SystemMindChatPage() {
  const dataFn = useServerFn(getSystemMindData);
  const chatFn = useServerFn(getSystemMindAIResponse);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: platformData } = useQuery({
    queryKey: ["systemmind-data"],
    queryFn: () => dataFn(),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    const newMsgs: Message[] = [...messages, { role: "user", content }];
    setMessages(newMsgs);
    setInput("");
    setSending(true);
    try {
      const res = await chatFn({ data: { messages: newMsgs, platformData, personality: "professional" } });
      setMessages([...newMsgs, { role: "assistant", content: res.reply }]);
    } catch (e: any) {
      setMessages([...newMsgs, { role: "assistant", content: `⚠️ ${e?.message ?? "Request failed."}` }]);
    } finally {
      setSending(false);
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
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setMessages([])}>
              <RefreshCw className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>

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
                  {m.content}
                </div>
                {m.role === "user" && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] mt-0.5">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            ))
          )}
          {sending && (
            <div className="flex gap-3 justify-start">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 mt-0.5">
                <Bot className="h-3.5 w-3.5 text-sky-400" />
              </div>
              <div className="border border-white/[0.06] bg-white/[0.03] rounded-xl rounded-bl-sm px-3.5 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-white/[0.06] px-4 md:px-8 py-4 shrink-0">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask SystemMind anything about your platform…"
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
