import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PlayCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listCalls } from "@/lib/dashboard/calls.functions";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({ meta: [{ title: "Calls" }] }),
  component: CallsPage,
});

function fmtDuration(s?: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function sentimentClass(v?: string | null) {
  if (v === "positive") return "bg-emerald-500/15 text-emerald-400";
  if (v === "negative") return "bg-destructive/15 text-destructive";
  if (v === "neutral") return "bg-muted text-muted-foreground";
  return "bg-muted/40 text-muted-foreground";
}

function statusClass(s?: string | null) {
  if (s === "completed") return "bg-emerald-500/15 text-emerald-400";
  if (s === "in_progress" || s === "ringing") return "bg-primary/15 text-primary";
  if (s === "failed" || s === "no_answer" || s === "busy")
    return "bg-destructive/15 text-destructive";
  if (s === "voicemail") return "bg-amber-500/15 text-amber-400";
  return "bg-muted text-muted-foreground";
}

function RecordingDialog({
  url,
  contact,
  onClose,
}: {
  url: string;
  contact: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Call Recording</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{contact}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <audio
          controls
          autoPlay={false}
          className="w-full"
          src={url}
          style={{ colorScheme: "dark" }}
        >
          Your browser does not support audio playback.
        </audio>

        <a
          href={url}
          download
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          Download recording
        </a>
      </div>
    </div>
  );
}

function CallsPage() {
  const fn = useServerFn(listCalls);
  const q = useQuery({
    queryKey: ["calls"],
    queryFn: () => fn({ data: {} }),
  });
  const rows = (q.data ?? []) as any[];
  const completed = rows.filter((r) => r.call_status === "completed").length;
  const failed = rows.filter((r) => ["failed", "no_answer", "busy"].includes(r.call_status)).length;
  const totalSec = rows.reduce((a, r) => a + (r.duration_seconds ?? 0), 0);

  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const [recordingPlayer, setRecordingPlayer] = useState<{ url: string; contact: string } | null>(
    null,
  );

  function toggleSummary(id: string) {
    setExpandedSummaries((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {recordingPlayer && (
        <RecordingDialog
          url={recordingPlayer.url}
          contact={recordingPlayer.contact}
          onClose={() => setRecordingPlayer(null)}
        />
      )}

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calls</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Call activity, transcripts and outcomes
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => q.refetch()} disabled={q.isRefetching}>
          <RefreshCw className={cn("h-4 w-4", q.isRefetching && "animate-spin")} />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total calls</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
            <Phone className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
            <Phone className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{failed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total talk</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{fmtDuration(totalSec)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16">
              <Phone className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No calls yet</p>
              <p className="text-xs text-muted-foreground">
                Outbound and inbound calls will be logged here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">Contact</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Sentiment</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Recording</th>
                    <th className="px-3 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c: any) => {
                    const inbound = c.call_type === "inbound";
                    const contact =
                      c.lead?.full_name ?? (inbound ? c.from_number : c.to_number) ?? "Unknown";
                    const expanded = expandedSummaries.has(c.id);
                    const hasLongSummary = c.call_summary && c.call_summary.length > 120;
                    return (
                      <tr key={c.id} className="border-b border-border/40 align-top">
                        <td className="px-3 py-2 font-medium">{contact}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            {inbound ? (
                              <PhoneIncoming className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <PhoneOutgoing className="h-3.5 w-3.5" />
                            )}
                            {inbound ? "Inbound · Receptionist" : "Outbound · Lead gen"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.agent_name ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] capitalize",
                              statusClass(c.call_status),
                            )}
                          >
                            {String(c.call_status ?? "").replace(/_/g, " ").trim() || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {c.sentiment ? (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] capitalize",
                                sentimentClass(c.sentiment),
                              )}
                            >
                              {c.sentiment}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Summary — expandable */}
                        <td className="max-w-[420px] px-3 py-2 text-xs text-muted-foreground">
                          {c.call_summary ? (
                            <div>
                              <p className={cn(!expanded && hasLongSummary && "line-clamp-2")}>
                                {c.call_summary}
                              </p>
                              {hasLongSummary && (
                                <button
                                  onClick={() => toggleSummary(c.id)}
                                  className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
                                >
                                  {expanded ? (
                                    <>
                                      <ChevronUp className="h-3 w-3" /> Show less
                                    </>
                                  ) : (
                                    <>
                                      <ChevronDown className="h-3 w-3" /> Show more
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtDuration(c.duration_seconds)}
                        </td>

                        {/* Recording — opens player dialog */}
                        <td className="px-3 py-2">
                          {c.recording_url ? (
                            <button
                              onClick={() =>
                                setRecordingPlayer({ url: c.recording_url, contact })
                              }
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <PlayCircle className="h-3.5 w-3.5" /> Play
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {c.started_at ? new Date(c.started_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
