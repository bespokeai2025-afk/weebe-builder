import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { RelativeTime } from "@/components/ui/relative-time";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PlayCircle,
  RefreshCw,
  X,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { listTelephonyCalls } from "@/lib/telephony/telephony.functions";

export const Route = createFileRoute("/_authenticated/telephony-calls")({
  head: () => ({ meta: [{ title: "Telephony Calls — Webee" }] }),
  component: TelephonyCallsPage,
});

function fmtDuration(s?: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}


function statusBadge(s: string) {
  const map: Record<string, string> = {
    completed: "bg-emerald-500/15 text-emerald-400",
    active: "bg-primary/15 text-primary",
    answered: "bg-primary/15 text-primary",
    ringing: "bg-amber-500/15 text-amber-400",
    initiated: "bg-muted text-muted-foreground",
    voicemail: "bg-amber-500/15 text-amber-400",
    failed: "bg-destructive/15 text-destructive",
    transferred: "bg-violet-500/15 text-violet-400",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[s] ?? "bg-muted text-muted-foreground"}`}>
      {s}
    </span>
  );
}

function outcomeBadge(o?: string | null) {
  if (!o) return null;
  const map: Record<string, string> = {
    booked: "bg-emerald-500/15 text-emerald-400",
    qualified: "bg-blue-500/15 text-blue-400",
    voicemail: "bg-amber-500/15 text-amber-400",
    callback: "bg-violet-500/15 text-violet-400",
    no_answer: "bg-muted text-muted-foreground",
    failed: "bg-destructive/15 text-destructive",
    other: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[o] ?? "bg-muted text-muted-foreground"}`}>
      {o.replace("_", " ")}
    </span>
  );
}

function RecordingModal({ url, contact, onClose }: { url: string; contact: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Recording</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{contact}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <audio controls autoPlay={false} className="w-full" src={url} style={{ colorScheme: "dark" }} />
        <a
          href={url}
          download
          className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
      </div>
    </div>
  );
}

function TranscriptModal({ call, onClose }: { call: any; onClose: () => void }) {
  const entries: any[] = call.transcript ?? [];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Transcript</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3 max-h-[60vh]">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transcript available.</p>
          ) : (
            entries.map((e, i) => (
              <div key={i} className={`flex gap-3 ${e.role === "agent" ? "" : "flex-row-reverse"}`}>
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${e.role === "agent" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {e.role === "agent" ? "A" : "U"}
                </div>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${e.role === "agent" ? "bg-muted/60" : "bg-primary/10"}`}>
                  {e.text}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TelephonyCallsPage() {
  const listFn = useServerFn(listTelephonyCalls);
  const [direction, setDirection] = useState<"" | "inbound" | "outbound">("");
  const [status, setStatus] = useState("all");
  const [recording, setRecording] = useState<{ url: string; contact: string } | null>(null);
  const [transcript, setTranscript] = useState<any | null>(null);

  const { data: calls = [], isFetching, refetch } = useQuery({
    queryKey: ["telephony-calls", direction, status],
    queryFn: () =>
      listFn({
        data: {
          direction: (direction as "inbound" | "outbound") || undefined,
          status: status !== "all" ? status : undefined,
          limit: 200,
        },
      }),
    throwOnError: false,
  });

  const totalCalls = calls.length;
  const answered = calls.filter((c: any) => c.status === "completed" || c.status === "answered").length;
  const totalDuration = calls.reduce((acc: number, c: any) => acc + (c.duration_seconds ?? 0), 0);
  const callsPag = useTablePagination(calls, 50);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Telephony Calls</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Inbound & outbound call history via your telephony provider.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Calls", value: totalCalls },
          { label: "Answered", value: answered },
          { label: "Total Duration", value: fmtDuration(totalDuration) },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
            <p className="mt-1 text-2xl font-bold">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <select
          value={direction}
          onChange={e => setDirection(e.target.value as any)}
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {["all", "initiated", "ringing", "answered", "active", "transferred", "voicemail", "completed", "failed"].map(s => (
            <option key={s} value={s}>{s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {calls.length === 0 && !isFetching ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <Phone className="h-10 w-10 opacity-30" />
          <p className="text-sm">No calls yet. Configure a phone number and start receiving calls.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Dir", "From", "To", "Agent", "Status", "Outcome", "Duration", "Started", "Actions"].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {callsPag.sliced.map((c: any) => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    {c.direction === "inbound"
                      ? <PhoneIncoming className="h-3.5 w-3.5 text-emerald-400" />
                      : <PhoneOutgoing className="h-3.5 w-3.5 text-blue-400" />}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{c.from_number ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{c.to_number ?? "—"}</td>
                  <td className="px-4 py-3">{c.agent?.name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  <td className="px-4 py-3">{outcomeBadge(c.outcome) ?? "—"}</td>
                  <td className="px-4 py-3">{fmtDuration(c.duration_seconds)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    <RelativeTime date={c.started_at} fallback="—" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {c.recording_url && (
                        <button
                          onClick={() => setRecording({ url: c.recording_url, contact: c.from_number ?? "Unknown" })}
                          title="Play recording"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <PlayCircle className="h-4 w-4" />
                        </button>
                      )}
                      {c.transcript && c.transcript.length > 0 && (
                        <button
                          onClick={() => setTranscript(c)}
                          title="View transcript"
                          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          Transcript
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagBar {...callsPag} />
        </div>
      )}

      {recording && <RecordingModal url={recording.url} contact={recording.contact} onClose={() => setRecording(null)} />}
      {transcript && <TranscriptModal call={transcript} onClose={() => setTranscript(null)} />}
    </div>
  );
}
