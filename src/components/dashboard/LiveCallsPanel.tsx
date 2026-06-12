import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Phone, PhoneIncoming, PhoneOutgoing, Globe, Mic, MicOff } from "lucide-react";
import { getLiveCalls } from "@/lib/dashboard/analytics.functions";
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
    // Set on mount (avoids SSR/client hydration mismatch)
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
      {/* Header */}
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

      {/* Transcript */}
      <div
        ref={transcriptRef}
        className="flex flex-col gap-1.5 overflow-y-auto px-4 py-3"
        style={{ maxHeight: 220 }}
      >
        {call.transcript.length === 0 ? (
          <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground">
            <Mic className="h-3.5 w-3.5 animate-pulse" />
            Listening…
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
  const fn = useServerFn(getLiveCalls);

  const q = useQuery({
    queryKey: ["live-calls"],
    queryFn: () => fn({ data: undefined }),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
  });

  const calls = q.data?.calls ?? [];
  const count = calls.length;

  return (
    <div className="px-6 pt-5">
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-3">
        <Phone className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-foreground">Live Calls</h2>
        {count > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {count} active
          </span>
        )}
        {q.isFetching && (
          <span className="text-[10px] text-muted-foreground/60">refreshing…</span>
        )}
      </div>

      {count === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-card/30 px-5 py-5 flex items-center gap-3 text-sm text-muted-foreground">
          <MicOff className="h-4 w-4 shrink-0" />
          <span>No active calls right now. This panel refreshes every 3 seconds.</span>
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
