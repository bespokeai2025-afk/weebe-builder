import { useEffect, useRef, useState, useCallback } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing, Globe, Mic, MicOff, Power } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { LiveCall } from "@/lib/dashboard/analytics.functions";

function elapsed(startMs: number | null): string {
  if (!startMs) return "0s";
  const s = Math.floor((Date.now() - startMs) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function CallCard({ call }: { call: LiveCall }) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState("0s");

  useEffect(() => {
    setDuration(elapsed(call.start_timestamp));
    const id = setInterval(() => setDuration(elapsed(call.start_timestamp)), 1000);
    return () => clearInterval(id);
  }, [call.start_timestamp]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [call.transcript]);

  const isInbound = call.direction === "inbound";
  const isWebCall = call.call_type === "web_call" || call.call_type === "webcall";
  const phoneDisplay = isWebCall
    ? "Web call"
    : isInbound
      ? (call.from_number ?? "Unknown caller")
      : (call.to_number ?? "Unknown");

  return (
    <div className="rounded-xl border border-white/[0.08] bg-card/60 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
            {isWebCall ? (
              <Globe className="h-3.5 w-3.5 text-emerald-400" />
            ) : isInbound ? (
              <PhoneIncoming className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <PhoneOutgoing className="h-3.5 w-3.5 text-emerald-400" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{call.agent_name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{phoneDisplay}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] tabular-nums text-muted-foreground">{duration}</span>
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
        </div>
      </div>

      <div
        ref={transcriptRef}
        className="flex flex-col gap-1.5 overflow-y-auto px-4 py-3"
        style={{ maxHeight: 220 }}
      >
        {call.transcript.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground">
            <Mic className="h-3.5 w-3.5 animate-pulse" />
            Waiting for first utterance…
          </div>
        ) : (
          call.transcript.map((line, i) => (
            <div
              key={i}
              className={`flex gap-2 text-[11px] leading-relaxed ${
                line.role === "agent" ? "text-violet-300" : "text-foreground/80"
              }`}
            >
              <span className="shrink-0 font-semibold uppercase tracking-wide text-[9px] pt-0.5 w-9 text-right">
                {line.role === "agent" ? "Agent" : "User"}
              </span>
              <span>{line.content}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function LiveCallsPanel() {
  // Always starts enabled when the analytics page mounts — the SSE closes
  // automatically when the page is left (component unmounts).
  const [enabled, setEnabled] = useState<boolean>(true);
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "off" | "error">("off");

  const esRef = useRef<EventSource | null>(null);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setStatus("off");
      setCalls([]);
      return;
    }

    let active = true;

    async function connect() {
      if (!active) return;
      setStatus("connecting");

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || !active) {
        setStatus("error");
        return;
      }

      const es = new EventSource(`/api/dashboard/live-calls-sse?token=${encodeURIComponent(token)}`);
      esRef.current = es;

      es.onopen = () => { if (active) setStatus("live"); };

      es.onmessage = (evt) => {
        if (!active) return;
        try {
          const payload = JSON.parse(evt.data);
          if (Array.isArray(payload?.calls)) {
            setCalls(payload.calls);
            setStatus("live");
          }
        } catch { /* ignore malformed */ }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!active) return;
        setStatus("error");
        // auto-reconnect after 3s
        setTimeout(() => { if (active) connect(); }, 3000);
      };
    }

    connect();

    return () => {
      active = false;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [enabled]);

  const count = calls.length;

  return (
    <div className="px-6 pt-5">
      <div className="flex items-center gap-2.5 mb-3">
        <Phone className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-foreground">Live Calls</h2>

        {enabled && count > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {count} active
          </span>
        )}

        {enabled && status === "connecting" && (
          <span className="text-[10px] text-muted-foreground/60">connecting…</span>
        )}

        {enabled && status === "live" && count === 0 && (
          <span className="text-[10px] text-muted-foreground/60">● streaming</span>
        )}

        {enabled && status === "error" && (
          <span className="text-[10px] text-amber-400/80">reconnecting…</span>
        )}

        <button
          onClick={toggle}
          title={enabled ? "Turn off live monitoring" : "Turn on live monitoring"}
          className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
            enabled
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-white/5 text-muted-foreground hover:bg-white/10"
          }`}
        >
          <Power className="h-3 w-3" />
          {enabled ? "On" : "Off"}
        </button>
      </div>

      {!enabled ? (
        <div className="rounded-xl border border-white/[0.06] bg-card/30 px-5 py-5 flex items-center gap-3 text-sm text-muted-foreground">
          <MicOff className="h-4 w-4 shrink-0" />
          <span>Live call monitoring is off. Press <strong>On</strong> to start streaming transcripts.</span>
        </div>
      ) : count === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-card/30 px-5 py-5 flex items-center gap-3 text-sm text-muted-foreground">
          <MicOff className="h-4 w-4 shrink-0" />
          <span>No active calls right now. Transcripts appear here the moment a call starts.</span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {calls.map((call) => (
            <CallCard key={call.call_id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}
