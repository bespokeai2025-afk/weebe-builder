import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Bot,
  CalendarCheck,
  ChevronRight,
  PhoneCall,
  Wrench,
  ExternalLink,
} from "lucide-react";
import { DashboardPage, KpiCard } from "@/components/dashboard/PageShell";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getReceptionistDashboard } from "@/lib/dnr/dnr-receptionist-dashboard.functions";
import { RelativeTime } from "@/components/ui/relative-time";

export const Route = createFileRoute("/_authenticated/receptionist")({
  head: () => ({ meta: [{ title: "Receptionist — Webee" }] }),
  component: ReceptionistHubPage,
});

function fmtDuration(s?: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function fmtWhen(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ReceptionistHubPage() {
  const fn = useServerFn(getReceptionistDashboard);
  const q = useQuery({
    queryKey: ["receptionist-dashboard"],
    queryFn: () => fn({ data: { limit: 40 } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const [transcriptCall, setTranscriptCall] = useState<{
    summary: string | null;
    transcript: string | null;
    from: string | null;
  } | null>(null);

  if (q.isLoading) {
    return (
      <DashboardPage title="Receptionist" subtitle="Dr Nyla voice receptionist activity">
        <LoadingProgress label="Loading receptionist data" estimatedMs={5000} />
      </DashboardPage>
    );
  }

  const d = q.data;
  const calls = d?.calls ?? [];
  const bookings = d?.bookings ?? [];
  const toolEvents = d?.toolEvents ?? [];
  const successfulBookings = toolEvents.filter((t) => t.tool_name === "book_appointment" && t.ok).length;

  return (
    <DashboardPage
      title="Receptionist"
      subtitle={`${d?.brand ?? "Medispa"} · ${d?.location ?? "Cheshire"} — calls, Pabau bookings, and tool activity`}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/calls">All calls</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link to="/calendar">Calendar</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a
            href="https://dashboard.retellai.com/agents/agent_b2afcd65c127f79126ea57deb2"
            target="_blank"
            rel="noreferrer"
          >
            Retell agent <ExternalLink className="ml-1 h-3 w-3" />
          </a>
        </Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard title="Recent calls" value={String(calls.length)} icon={PhoneCall} />
        <KpiCard title="Bookings (calendar)" value={String(bookings.length)} icon={CalendarCheck} />
        <KpiCard title="Tool events" value={String(toolEvents.length)} icon={Wrench} />
        <KpiCard title="book_appointment OK" value={String(successfulBookings)} icon={Bot} />
      </div>

      {!d?.toolEventsAvailable && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Tool activity log is not available yet — run in Supabase SQL Editor:{" "}
          <code className="text-xs">node scripts/apply-receptionist-migration.mjs</code> (prints the
          migration SQL).
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Calls */}
        <section className="rounded-xl border border-border/60 bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent calls</h2>
            <Link to="/calls" className="text-xs text-muted-foreground hover:text-foreground">
              View all <ChevronRight className="inline h-3 w-3" />
            </Link>
          </div>
          {calls.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No calls yet. Point the Retell agent webhook at WEBEE{" "}
              <code className="text-xs">/api/public/voice-webhook</code>. Retell web tests for
              this agent are stored here; live inbound phone calls appear under All calls too.
            </p>
          ) : (
            <ul className="space-y-2">
              {calls.slice(0, 12).map((c) => (
                <li
                  key={c.id}
                  className="flex cursor-pointer items-start justify-between gap-2 rounded-lg border border-border/40 px-3 py-2 text-sm hover:bg-muted/30"
                  onClick={() =>
                    setTranscriptCall({
                      summary: c.call_summary,
                      transcript: c.transcript,
                      from: c.from_number,
                    })
                  }
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{c.from_number ?? "Unknown caller"}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.call_summary ?? c.agent_name ?? "Call"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <RelativeTime date={c.started_at} />
                    <div>{fmtDuration(c.duration_seconds)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Bookings */}
        <section className="rounded-xl border border-border/60 bg-card/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Bookings (Pabau → WEBEE calendar)</h2>
            <Link to="/calendar" className="text-xs text-muted-foreground hover:text-foreground">
              Calendar <ChevronRight className="inline h-3 w-3" />
            </Link>
          </div>
          {bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bookings synced yet. Successful <code className="text-xs">book_appointment</code> tool
              calls will appear here and in Calendar.
            </p>
          ) : (
            <ul className="space-y-2">
              {bookings.slice(0, 12).map((b) => (
                <li
                  key={b.id}
                  className="rounded-lg border border-border/40 px-3 py-2 text-sm"
                >
                  <p className="font-medium">{b.title}</p>
                  <p className="text-xs text-muted-foreground">{fmtWhen(b.start_at)}</p>
                  {(b.attendee_name || b.attendee_phone) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[b.attendee_name, b.attendee_phone].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {b.source}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Tool events */}
        <section className="rounded-xl border border-border/60 bg-card/40 p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Pabau tool activity</h2>
          {toolEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tool calls will log here after the agent uses list_services, check_availability,
              find_or_create_client, or book_appointment during a call.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-xs text-muted-foreground">
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">Tool</th>
                    <th className="py-2 pr-3">Result</th>
                    <th className="py-2 pr-3">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {toolEvents.slice(0, 20).map((t) => (
                    <tr key={t.id} className="border-b border-border/30 align-top">
                      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                        <RelativeTime date={t.created_at} />
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{t.tool_name}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={t.ok ? "default" : "destructive"} className="text-[10px]">
                          {t.ok ? "OK" : "Fail"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground max-w-md truncate">
                        {String(
                          (t.response_summary as { message?: string }).message ??
                            (t.request_summary as { service_name?: string }).service_name ??
                            JSON.stringify(t.response_summary).slice(0, 80),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Dialog open={!!transcriptCall} onOpenChange={() => setTranscriptCall(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Call transcript · {transcriptCall?.from ?? ""}</DialogTitle>
          </DialogHeader>
          {transcriptCall?.summary && (
            <p className="text-sm text-muted-foreground mb-3">{transcriptCall.summary}</p>
          )}
          <pre className="whitespace-pre-wrap text-xs leading-relaxed">
            {transcriptCall?.transcript ?? "No transcript stored for this call."}
          </pre>
        </DialogContent>
      </Dialog>
    </DashboardPage>
  );
}
