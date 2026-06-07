import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Phone, PhoneIncoming, PhoneOutgoing, PlayCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listCalls } from "@/lib/dashboard/calls.functions";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({ meta: [{ title: "Calls" }] }),
  component: CallsPage,
});

function fmtDuration(s?: number | null) {
  if (!s) return "\u2014";
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

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground mt-1">
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
            <p className="text-3xl font-bold">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
            <Phone className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed</CardTitle>
            <Phone className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{failed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total talk</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{fmtDuration(totalSec)}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
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
                            {inbound ? "Inbound \u00B7 Receptionist" : "Outbound \u00B7 Lead gen"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.agent_name ?? "\u2014"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] capitalize",
                              statusClass(c.call_status),
                            )}
                          >
                            {String(c.call_status ?? "")
                              .replace(/_/g, " ")
                              .trim() || "\u2014"}
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
                            <span className="text-xs text-muted-foreground">\u2014</span>
                          )}
                        </td>
                        <td className="max-w-[280px] px-3 py-2 text-xs text-muted-foreground">
                          {c.call_summary ? (
                            <span className="line-clamp-3">{c.call_summary}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground tabular-nums">
                          {fmtDuration(c.duration_seconds)}
                        </td>
                        <td className="px-3 py-2">
                          {c.recording_url ? (
                            <a
                              href={c.recording_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <PlayCircle className="h-3.5 w-3.5" /> Play
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">\u2014</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {c.started_at ? new Date(c.started_at).toLocaleString() : "\u2014"}
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
