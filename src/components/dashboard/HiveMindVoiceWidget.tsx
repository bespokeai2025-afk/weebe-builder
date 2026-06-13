import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RetellWebClient } from "retell-client-js-sdk";
import { Mic, MicOff, PhoneOff, Brain, Loader2, X, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createRetellWebCall } from "@/lib/builder/retell.functions";
import { getHiveMindAgentId } from "@/lib/hivemind/hivemind.functions";

type TxEntry = { id: string; role: "user" | "agent"; text: string; partial: boolean };

export function HiveMindVoiceButton() {
  const getAgentFn  = useServerFn(getHiveMindAgentId);
  const startCallFn = useServerFn(createRetellWebCall);

  const [open,     setOpen]    = useState(false);
  const [starting, setStarting] = useState(false);
  const [inCall,   setInCall]   = useState(false);
  const [elapsed,  setElapsed]  = useState(0);
  const [transcript, setTx]    = useState<TxEntry[]>([]);
  const [agentId,  setAgentId]  = useState<string | null>(null);

  const clientRef  = useRef<RetellWebClient | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const txScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getAgentFn().then((r) => setAgentId(r.agentId)).catch(() => {});
  }, []);

  useEffect(() => {
    if (txScrollRef.current) {
      txScrollRef.current.scrollTop = txScrollRef.current.scrollHeight;
    }
  }, [transcript]);

  function fmtElapsed(s: number) {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${m}:${ss}`;
  }

  async function startCall() {
    if (!agentId) {
      toast.error("No HiveMind voice agent configured", {
        description: "Go to Settings → Integrations and select a voice agent.",
        action: { label: "Settings", onClick: () => { window.location.href = "/settings/integrations"; } },
      });
      return;
    }
    if (!agentId.startsWith("agent_")) {
      toast.error("Invalid agent ID — please configure a deployed Retell agent in Settings → Integrations.");
      return;
    }
    setStarting(true);
    setOpen(true);
    setTx([]);
    setElapsed(0);
    try {
      const { accessToken } = await startCallFn({ data: { agentId } });
      const client = new RetellWebClient();
      clientRef.current = client;

      client.on("call_started", () => {
        setInCall(true);
        setStarting(false);
        timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000);
      });

      client.on("call_ended", () => {
        setInCall(false);
        if (timerRef.current) clearInterval(timerRef.current);
        clientRef.current = null;
      });

      const retellClient = client as unknown as { on: (e: string, cb: (...a: any[]) => void) => void };

      retellClient.on("update", (payload: unknown) => {
        if (!payload || typeof payload !== "object") return;
        const obj = payload as Record<string, unknown>;
        const t = obj.transcript;
        if (!Array.isArray(t) || t.length === 0) return;
        setTx((t as Array<{ role: string; content: string }>).map((e, i) => ({
          id: `tx-${i}`,
          role: e.role === "agent" ? "agent" : "user",
          text: e.content ?? "",
          partial: false,
        })));
      });

      retellClient.on("agent_start_talking", () => {
        setTx((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "agent" && last.partial) return prev;
          return [...prev, { id: "partial-agent", role: "agent" as const, text: "…", partial: true }];
        });
      });
      retellClient.on("agent_stop_talking", () => {
        setTx((prev) => prev.filter((e) => e.id !== "partial-agent"));
      });

      client.on("error", (err: unknown) => {
        toast.error("Call error", { description: String((err as Error)?.message ?? err) });
        endCall();
      });

      await client.startCall({ accessToken, enableUpdate: true });
    } catch (e) {
      toast.error("Failed to start call", { description: (e as Error).message });
      setStarting(false);
      setOpen(false);
    }
  }

  function endCall() {
    clientRef.current?.stopCall();
    clientRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    setInCall(false);
    setStarting(false);
  }

  function dismiss() {
    endCall();
    setOpen(false);
    setTx([]);
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={startCall}
        disabled={starting}
        className={cn(
          "group flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
          "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30 hover:bg-violet-500/25 hover:ring-violet-500/50",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          inCall && "bg-violet-500/30 ring-violet-500/60",
        )}
      >
        {starting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : inCall ? (
          <Volume2 className="h-3.5 w-3.5 animate-pulse" />
        ) : (
          <Brain className="h-3.5 w-3.5" />
        )}
        {starting ? "Connecting…" : inCall ? "In call" : "Talk to HiveMind"}
      </button>

      {/* Floating call widget */}
      {open && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col w-80 rounded-2xl border border-violet-500/30 bg-card/95 shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-violet-500/5">
            <div className="flex items-center gap-2.5">
              <div className={cn("h-8 w-8 rounded-full flex items-center justify-center bg-violet-500/20 ring-1 ring-violet-500/40", inCall && "ring-2 ring-violet-400/60")}>
                <Brain className={cn("h-4 w-4 text-violet-400", inCall && "animate-pulse")} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">HiveMind</p>
                <p className="text-[10px] text-muted-foreground">
                  {starting ? "Connecting…" : inCall ? `${fmtElapsed(elapsed)} · Live` : "Call ended"}
                </p>
              </div>
            </div>
            <button onClick={dismiss} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Transcript */}
          <div ref={txScrollRef} className="h-48 overflow-y-auto px-4 py-3 space-y-2">
            {transcript.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                {starting ? (
                  <><Loader2 className="h-5 w-5 animate-spin text-violet-400" /><p className="text-xs text-muted-foreground">Starting call…</p></>
                ) : inCall ? (
                  <><Mic className="h-5 w-5 text-violet-400 animate-pulse" /><p className="text-xs text-muted-foreground">Say something to HiveMind…</p></>
                ) : (
                  <><MicOff className="h-5 w-5 text-muted-foreground/40" /><p className="text-xs text-muted-foreground">Call ended</p></>
                )}
              </div>
            )}
            {transcript.map((entry) => (
              <div key={entry.id} className={cn("flex", entry.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed",
                  entry.role === "agent"
                    ? "bg-violet-500/15 text-violet-100 rounded-tl-sm"
                    : "bg-white/10 text-foreground rounded-tr-sm",
                  entry.partial && "opacity-60 italic",
                )}>
                  {entry.text}
                </div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="px-4 py-3 border-t border-white/[0.06] flex items-center justify-center">
            {inCall ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-2 rounded-full px-4 text-xs"
                onClick={endCall}
              >
                <PhoneOff className="h-3.5 w-3.5" />
                End call
              </Button>
            ) : !starting ? (
              <p className="text-[11px] text-muted-foreground">Call ended · Transcript above</p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
