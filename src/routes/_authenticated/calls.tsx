import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FlaskConical,
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
import { listCalls, listTestCalls } from "@/lib/dashboard/calls.functions";
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

function fmtCost(cents?: number | null) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(3)}`;
}

function channelLabel(fromNumber?: string | null, callType?: string | null) {
  // HyperStream web calls use from_number="web" as a proxy until the
  // provider column migration is applied (20260613_calls_provider_channel.sql).
  if (fromNumber === "web") return "web";
  if (callType === "inbound") return "phone_call";
  return "phone_call";
}

function TestCallRow({ c }: { c: ReturnType<typeof listTestCalls> extends Promise<infer T> ? T extends Array<infer U> ? U : never : never }) {
  const [expanded, setExpanded] = useState(false);
  const [recordingPlayer, setRecordingPlayer] = useState<{ url: string; contact: string } | null>(null);
  const label = c.agent_name ?? c.agent_id ?? "Builder test";
  const when = c.started_at ? new Date(c.started_at).toLocaleString() : "—";
  const sessionId = c.retell_call_id ?? "—";
  const shortSessionId = sessionId !== "—" && sessionId.length > 24
    ? sessionId.slice(0, 24) + "…"
    : sessionId;

  return (
    <>
      {recordingPlayer && (
        <RecordingDialog
          url={recordingPlayer.url}
          contact={recordingPlayer.contact}
          onClose={() => setRecordingPlayer(null)}
        />
      )}
      <tr
        className="h-9 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors cursor-pointer"
        onClick={() => c.transcript && setExpanded((p) => !p)}
      >
        <td className="px-3 py-1.5">
          {c.transcript ? (
            expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )
          ) : (
            <span className="h-3 w-3 inline-block" />
          )}
        </td>
        <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">{label}</td>
        <td className="px-3 py-1.5 text-muted-foreground tabular-nums text-[11px] whitespace-nowrap">
          {fmtDuration(c.duration_seconds)}
        </td>
        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {channelLabel(c.from_number, c.call_type)}
        </td>
        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
          {fmtCost(c.cost_cents)}
        </td>
        <td className="px-3 py-1.5 text-[11px] text-muted-foreground font-mono max-w-[200px] truncate" title={sessionId !== "—" ? sessionId : undefined}>
          {shortSessionId}
        </td>
        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {c.disconnection_reason
            ? String(c.disconnection_reason).replace(/_/g, " ")
            : "—"}
        </td>
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
        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {c.from_number ?? "—"}
        </td>
        <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
          {c.to_number ?? "—"}
        </td>
        <td className="px-3 py-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {c.call_type === "inbound" ? (
              <PhoneIncoming className="h-3 w-3 text-primary" />
            ) : (
              <PhoneOutgoing className="h-3 w-3" />
            )}
            {c.call_type === "inbound" ? "Inbound" : "Outbound"}
          </span>
        </td>
        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          {c.recording_url ? (
            <button
              onClick={() => setRecordingPlayer({ url: c.recording_url!, contact: label })}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <PlayCircle className="h-3 w-3" /> Play
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-muted-foreground text-[11px] whitespace-nowrap">{when}</td>
      </tr>
      {expanded && c.transcript && (
        <tr className="border-b border-white/[0.04]">
          <td colSpan={14} className="px-4 pb-3 pt-1">
            <div className="rounded-lg bg-black/30 border border-white/[0.06] p-3 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
              {c.transcript}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CallsPage() {
  const [tab, setTab] = useState<"live" | "test">("live");

  const fn = useServerFn(listCalls);
  const q = useQuery({
    queryKey: ["calls"],
    queryFn: () => fn({ data: {} }),
  });
  const rows = (q.data ?? []) as any[];

  const testFn = useServerFn(listTestCalls);
  const testQ = useQuery({
    queryKey: ["test-calls"],
    queryFn: () => testFn({ data: {} }),
  });
  const testRows = testQ.data ?? [];

  const completed = rows.filter((r) => r.call_status === "completed").length;
  const failed = rows.filter((r) => ["failed", "no_answer", "busy"].includes(r.call_status)).length;
  const totalSec = rows.reduce((a: number, r: any) => a + (r.duration_seconds ?? 0), 0);

  const [recordingPlayer, setRecordingPlayer] = useState<{ url: string; contact: string } | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);

  function openPanel(c: any) {
    const inbound = c.call_type === "inbound";
    const rawContact = c.lead?.full_name ?? (inbound ? c.from_number : c.to_number) ?? "Call";
    const contact = typeof rawContact === "string" && rawContact.startsWith("web:") ? "Web session" : rawContact;
    const rawPhone = inbound ? c.from_number : c.to_number;
    const phone = typeof rawPhone === "string" && rawPhone.startsWith("web:") ? undefined : rawPhone;
    setPanel({
      entityType: "call",
      entityId: c.id,
      entityName: contact,
      defaultPhone: phone ?? undefined,
      leadId: c.lead_id ?? null,
    });
  }

  const isRefetching = tab === "live" ? q.isRefetching : testQ.isRefetching;

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
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex items-center rounded-lg border border-white/[0.06] bg-card/40 p-0.5">
            <button
              onClick={() => setTab("live")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === "live"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Phone className="h-3 w-3" />
              Live Calls
            </button>
            <button
              onClick={() => setTab("test")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === "test"
                  ? "bg-violet-500/15 text-violet-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FlaskConical className="h-3 w-3" />
              Test Calls
              {testRows.length > 0 && (
                <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">
                  {testRows.length}
                </span>
              )}
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => (tab === "live" ? q.refetch() : testQ.refetch())}
            disabled={isRefetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {tab === "live" ? (
        <>
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
                      <th className="sticky right-0 bg-card/80 px-3 py-2 w-20 backdrop-blur-sm"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c: any) => {
                      const inbound = c.call_type === "inbound";
                      const rawContact = c.lead?.full_name ?? (inbound ? c.from_number : c.to_number) ?? "Unknown";
                      const contact = typeof rawContact === "string" && rawContact.startsWith("web:") ? "Web session" : rawContact;
                      return (
                        <tr key={c.id} onClick={() => openPanel(c)} className="h-9 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors cursor-pointer">
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
                            {(c.provider as string | null) === "ELEVENLABS" && (
                              <span className="ml-1 inline-block rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-400">
                                VoxStream
                              </span>
                            )}
                            {(c.to_number as string | null)?.startsWith("web:") && (
                              <span className="ml-1 inline-block rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-400">
                                Web
                              </span>
                            )}
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
                          <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
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
                          <td className="sticky right-0 bg-card/80 backdrop-blur-sm px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                            <div className="relative group/notes flex justify-center">
                              <button
                                onClick={() => openPanel(c)}
                                className="rounded p-1.5 text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                              >
                                <StickyNote className="h-3.5 w-3.5" />
                              </button>
                              <span className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-popover border border-border px-2 py-1 text-[10px] text-foreground shadow opacity-0 group-hover/notes:opacity-100 transition-opacity z-50">
                                Notes
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Test calls KPI strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 mb-5">
            <KpiCard
              label="Test Calls"
              value={testRows.length}
              icon={FlaskConical}
              iconBg="bg-violet-500/15"
              iconColor="text-violet-400"
            />
            <KpiCard
              label="With Recording"
              value={testRows.filter((r) => r.recording_url).length}
              icon={PlayCircle}
              iconBg="bg-sky-500/15"
              iconColor="text-sky-400"
            />
            <KpiCard
              label="Total Talk"
              value={fmtDuration(testRows.reduce((a, r) => a + (r.duration_seconds ?? 0), 0))}
              icon={Phone}
              iconBg="bg-emerald-500/15"
              iconColor="text-emerald-400"
            />
          </div>

          {/* Test calls table */}
          <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
            {testRows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <FlaskConical className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No test calls yet</p>
                <p className="text-xs text-muted-foreground">Calls made from the builder will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-card/30">
                      <th className="w-6 px-3 py-2" />
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Agent</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Duration</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Channel Type</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Cost</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Session ID</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">End Reason</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Session Status</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentiment</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">From</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">To</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Direction</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recording</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testRows.map((c) => (
                      <TestCallRow key={c.id} c={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

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
