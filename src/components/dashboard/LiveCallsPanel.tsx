import { useEffect, useRef, useState, useCallback } from "react";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneOff,
  Globe,
  Mic,
  MicOff,
  Power,
  CheckCircle,
  GitBranch,
  Headphones,
} from "lucide-react";
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

type CallStatus = "ringing" | "in_progress" | "ended" | "failed";

function resolveStatus(call: LiveCall): CallStatus {
  if (call.call_status) return call.call_status;
  return call.status === "completed" ? "ended" : "in_progress";
}

function StatusBadge({ status }: { status: CallStatus }) {
  if (status === "ringing") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
        RINGING
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        LIVE
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-400">
        <PhoneOff className="h-2.5 w-2.5" />
        NO ANSWER
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-medium text-slate-400">
      <CheckCircle className="h-2.5 w-2.5" />
      ENDED
    </span>
  );
}

function CallCard({ call }: { call: LiveCall }) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [duration, setDuration] = useState("0s");
  const [transcriptOverdue, setTranscriptOverdue] = useState(false);
  const status = resolveStatus(call);
  const isCompleted = call.status === "completed";
  const isLive = !isCompleted;

  useEffect(() => {
    const tick = () => {
      setDuration(elapsed(call.start_timestamp));
      setTranscriptOverdue(
        call.start_timestamp != null && Date.now() - call.start_timestamp > 20_000,
      );
    };
    tick();
    if (!isLive) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [call.start_timestamp, isLive]);

  // Auto-scroll to the newest transcript line, but only when the user is
  // already near the bottom — so scrolling up to read stays put.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [call.transcript]);

  const onScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const isInbound = call.direction === "inbound";
  const isWebCall = call.call_type === "web_call" || call.call_type === "webcall";
  const phoneDisplay = isWebCall
    ? "Web call"
    : isInbound
      ? (call.from_number ?? "Unknown caller")
      : (call.to_number ?? "Unknown");
  const contactDisplay =
    call.lead_name && !isWebCall ? `${call.lead_name} · ${phoneDisplay}` : phoneDisplay;

  const accent = isCompleted ? "text-slate-400" : status === "ringing" ? "text-amber-400" : "text-emerald-400";
  const iconBg = isCompleted ? "bg-slate-500/15" : status === "ringing" ? "bg-amber-500/15" : "bg-emerald-500/15";

  return (
    <div className={`rounded-xl border overflow-hidden ${
      isCompleted
        ? "border-white/[0.06] bg-card/40"
        : "border-white/[0.08] bg-card/60"
    }`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
            {isWebCall ? (
              <Globe className={`h-3.5 w-3.5 ${accent}`} />
            ) : isInbound ? (
              <PhoneIncoming className={`h-3.5 w-3.5 ${accent}`} />
            ) : (
              <PhoneOutgoing className={`h-3.5 w-3.5 ${accent}`} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">{call.agent_name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{contactDisplay}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] tabular-nums text-muted-foreground">{duration}</span>
          <StatusBadge status={status} />
        </div>
      </div>

      {call.current_node_label && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-white/[0.04] bg-white/[0.02]">
          <GitBranch className="h-3 w-3 text-violet-400/80 shrink-0" />
          <span className="text-[10px] text-muted-foreground truncate">
            Step: <span className="text-foreground/80 font-medium">{call.current_node_label}</span>
          </span>
        </div>
      )}

      <div
        ref={transcriptRef}
        onScroll={onScroll}
        className="flex flex-col gap-1.5 overflow-y-auto px-4 py-3"
        style={{ maxHeight: 220 }}
      >
        {call.transcript.length === 0 ? (
          isCompleted ? (
            <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground/60">
              <Mic className="h-3.5 w-3.5" />
              No transcript recorded
            </div>
          ) : transcriptOverdue ? (
            // Live call, but no `transcript_updated` has reached us after 20s.
            // The usual cause is the agent's Retell webhook URL pointing somewhere
            // other than WEBEE (e.g. an external automation), so Retell never
            // delivers the live transcript to this app.
            <div className="flex items-start gap-2 py-3 text-[11px] text-amber-400/80">
              <Mic className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Live transcript unavailable:{" "}
                <code className="text-amber-300">transcript_updated</code> not received
                from Retell. Confirm this agent's Retell webhook URL points to WEBEE.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground">
              <span className="flex gap-0.5">
                <span className="h-3 w-0.5 rounded-full bg-emerald-400/60 animate-[bounce_1s_ease-in-out_0s_infinite]" />
                <span className="h-3 w-0.5 rounded-full bg-emerald-400/60 animate-[bounce_1s_ease-in-out_0.15s_infinite]" />
                <span className="h-3 w-0.5 rounded-full bg-emerald-400/60 animate-[bounce_1s_ease-in-out_0.3s_infinite]" />
              </span>
              <span>Waiting for Retell transcript_updated event…</span>
            </div>
          )
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
  const [enabled, setEnabled] = useState<boolean>(true);
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [status, setStatus] = useState<
    "connecting" | "live" | "off" | "error" | "session_expired"
  >("off");
  // True only while auto-reconnecting after "session expired" (user signed
  // back in). Drives a positive transitional banner instead of the red
  // expired copy; cleared as soon as we land in a terminal state.
  const [resuming, setResuming] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

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
      setResuming(false);
      setCalls([]);
      return;
    }

    let active = true;
    let failedAttempts = 0;
    let refreshFailures = 0;
    const MAX_REFRESH_FAILURES = 3;
    let connecting = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleRetry(delay: number) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (active) connect();
      }, delay);
    }

    async function connect() {
      // Single-flight guard: never allow overlapping attempts or a second
      // EventSource while one is being established.
      if (!active || connecting || esRef.current) return;
      connecting = true;
      setStatus("connecting");

      // After a failed attempt the cached token may be stale/revoked (the
      // server 401s and EventSource can't tell us why) — force a refresh so
      // reconnects never loop forever on a dead token.
      let token: string | undefined;
      if (failedAttempts > 0) {
        const { data: refreshed, error: refreshError } =
          await supabase.auth.refreshSession();
        token = refreshed.session?.access_token;
        if (refreshError || !token) {
          refreshFailures += 1;
        } else {
          refreshFailures = 0;
        }
      }
      if (!token) {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      }
      if (!active) {
        connecting = false;
        return;
      }
      // Session is truly gone (revoked / signed out elsewhere): after several
      // consecutive refresh failures, stop retrying and tell the user to sign
      // in again instead of showing "reconnecting…" forever.
      if (!token && refreshFailures >= MAX_REFRESH_FAILURES) {
        connecting = false;
        setStatus("session_expired");
        setResuming(false);
        return;
      }
      if (!token) {
        connecting = false;
        refreshFailures += 1;
        if (refreshFailures >= MAX_REFRESH_FAILURES) {
          setStatus("session_expired");
          setResuming(false);
          return;
        }
        setStatus("error");
        // No usable session yet — retry slowly (e.g. transient auth outage).
        scheduleRetry(15_000);
        return;
      }

      const es = new EventSource(`/api/dashboard/live-calls-sse?token=${encodeURIComponent(token)}`);
      esRef.current = es;
      connecting = false;

      es.onopen = () => {
        if (!active) return;
        setStatus("live");
        setResuming(false);
      };

      es.onmessage = (evt) => {
        if (!active) return;
        try {
          const payload = JSON.parse(evt.data);
          if (Array.isArray(payload?.calls)) {
            failedAttempts = 0;
            refreshFailures = 0;
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
        failedAttempts += 1;
        // Exponential backoff (3s → 6s → 12s → 24s → 30s cap) so a dead
        // server/DB isn't hammered every 3s indefinitely.
        const delay = Math.min(30_000, 3000 * 2 ** Math.min(failedAttempts - 1, 4));
        scheduleRetry(delay);
      };
    }

    // If the user signs back in (e.g. via another tab) or the session comes
    // back after we hit "session expired", reconnect automatically instead of
    // staying stuck until a full page reload. connect()'s single-flight guard
    // (connecting || esRef.current) makes routine TOKEN_REFRESHED events —
    // including ones triggered by our own refreshSession() — a no-op while a
    // stream is already up or being established.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        session?.access_token
      ) {
        if (connecting || esRef.current) return;
        if (statusRef.current === "session_expired") setResuming(true);
        failedAttempts = 0;
        refreshFailures = 0;
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        connect();
      }
    });

    connect();

    return () => {
      active = false;
      authSub.subscription.unsubscribe();
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [enabled]);

  const liveCalls = calls.filter((c) => c.status === "live");
  const completedCalls = calls.filter((c) => c.status === "completed");
  const liveCount = liveCalls.length;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2.5 mb-3">
        <Phone className="h-4 w-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-foreground">Live Calls</h2>

        {enabled && liveCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {liveCount} active
          </span>
        )}

        {enabled && status === "connecting" && (
          <span className="text-[10px] text-muted-foreground/60">connecting…</span>
        )}

        {enabled && status === "live" && liveCount === 0 && completedCalls.length === 0 && (
          <span className="text-[10px] text-muted-foreground/60">● streaming</span>
        )}

        {enabled && status === "error" && (
          <span className="text-[10px] text-amber-400/80">reconnecting…</span>
        )}

        {enabled && status === "session_expired" && (
          <span className="text-[10px] text-rose-400/90">session expired</span>
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

      {enabled && (
        <div className="flex items-center gap-1.5 mb-3 text-[10px] text-muted-foreground/60">
          <Headphones className="h-3 w-3 shrink-0" />
          <span>Transcript monitoring enabled · live audio not enabled in current setup</span>
        </div>
      )}

      {!enabled ? (
        <div className="rounded-xl border border-white/[0.06] bg-card/30 px-5 py-5 flex items-center gap-3 text-sm text-muted-foreground">
          <MicOff className="h-4 w-4 shrink-0" />
          <span>Live call monitoring is off. Press <strong>On</strong> to start streaming transcripts.</span>
        </div>
      ) : resuming && status !== "live" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-5 py-5 flex items-center gap-3 text-sm text-emerald-300/90">
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
          <span>Signed in again — reconnecting live calls…</span>
        </div>
      ) : status === "session_expired" ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-5 py-5 flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
          <div className="flex items-center gap-3 text-rose-300/90 min-w-0">
            <PhoneOff className="h-4 w-4 shrink-0" />
            <span>
              Session expired — please sign in again to resume live call monitoring.
            </span>
          </div>
          <a
            href="/login"
            className="shrink-0 sm:ml-auto rounded-full bg-rose-500/15 px-3.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/25 transition-colors text-center"
          >
            Sign in again
          </a>
        </div>
      ) : calls.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-card/30 px-5 py-5 flex items-center gap-3 text-sm text-muted-foreground">
          <MicOff className="h-4 w-4 shrink-0" />
          <span>No active calls right now. Transcripts appear here the moment a call starts.</span>
        </div>
      ) : (
        <div className="space-y-4">
          {liveCalls.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {liveCalls.map((call) => (
                <CallCard key={call.call_id} call={call} />
              ))}
            </div>
          )}
          {completedCalls.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2 px-0.5">
                Recent calls — last 20 min
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {completedCalls.map((call) => (
                  <CallCard key={call.call_id} call={call} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
