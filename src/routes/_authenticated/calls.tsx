import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Download,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PlayCircle,
  RefreshCw,
  StickyNote,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard, SummaryTooltip } from "@/components/dashboard/PageShell";
import { cn } from "@/lib/utils";
import { listCalls } from "@/lib/dashboard/calls.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({ meta: [{ title: "Calls — Webee" }] }),
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
        <audio controls autoPlay={false} className="w-full" src={url} style={{ colorScheme: "dark" }}>
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

type PanelTarget = {
  entityType: NotesEntityType;
  entityId: string;
  entityName: string;
  defaultPhone?: string;
  defaultEmail?: string;
  leadId?: string | null;
};

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

  const [recordingPlayer, setRecordingPlayer] = useState<{ url: string; contact: string } | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);

  function openPanel(c: any) {
    const inbound = c.call_type === "inbound";
    const contact = c.lead?.full_name ?? (inbound ? c.from_number : c.to_number) ?? "Call";
    const phone = inbound ? c.from_number : c.to_number;
    setPanel({
      entityType: "call",
      entityId: c.id,
      entityName: contact,
      defaultPhone: phone ?? undefined,
      leadId: c.lead_id ?? null,
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

      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Calls</h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Call activity, transcripts and outcomes</p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => q.refetch()} disabled={q.isRefetching}>
          <RefreshCw className={cn("h-3.5 w-3.5", q.isRefetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-5">
        <KpiCard label="Total Calls" value={rows.length} icon={Phone} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
        <KpiCard label="Completed" value={completed} icon={Phone} iconBg="bg-emerald-500/15" iconColor="text-emerald-400" />
        <KpiCard label="Failed" value={failed} icon={Phone} iconBg="bg-red-500/15" iconColor="text-red-400" />
        <KpiCard label="Total Talk" value={fmtDuration(totalSec)} icon={Phone} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
      </div>

      {/* Calls table */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16">
            <Phone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No calls yet</p>
            <p className="text-xs text-muted-foreground">Outbound and inbound calls will be logged here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] bg-card/30">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Contact</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Type</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentiment</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Duration</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Rec</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">When</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c: any) => {
                  const inbound = c.call_type === "inbound";
                  const contact = c.lead?.full_name ?? (inbound ? c.from_number : c.to_number) ?? "Unknown";
                  return (
                    <tr key={c.id} className="h-9 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">{contact}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          {inbound ? (
                            <PhoneIncoming className="h-3 w-3 text-primary" />
                          ) : (
                            <PhoneOutgoing className="h-3 w-3" />
                          )}
                          {inbound ? "Inbound" : "Outbound"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground text-[11px] whitespace-nowrap">{c.agent_name ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] capitalize", statusClass(c.call_status))}>
                          {String(c.call_status ?? "").replace(/_/g, " ").trim() || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {c.sentiment ? (
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] capitalize", sentimentClass(c.sentiment))}>
                            {c.sentiment}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="max-w-[300px] px-3 py-1.5 text-xs text-muted-foreground align-middle">
                        <SummaryTooltip text={c.call_summary} lines={2} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums text-[11px]">{fmtDuration(c.duration_seconds)}</td>
                      <td className="px-3 py-1.5">
                        {c.recording_url ? (
                          <button
                            onClick={() => setRecordingPlayer({ url: c.recording_url, contact })}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                          >
                            <PlayCircle className="h-3 w-3" /> Play
                          </button>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground text-[11px]">
                        {c.started_at ? new Date(c.started_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => openPanel(c)}
                          title="Notes & appointment"
                          className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                        >
                          <StickyNote className="h-3 w-3" />
                          <span>Notes</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes & Booking sheet */}
      {panel && (
        <NotesBookingSheet
          open={!!panel}
          onOpenChange={(o) => { if (!o) setPanel(null); }}
          entityType={panel.entityType}
          entityId={panel.entityId}
          entityName={panel.entityName}
          defaultPhone={panel.defaultPhone}
          defaultEmail={panel.defaultEmail}
          leadId={panel.leadId}
        />
      )}
    </div>
  );
}
