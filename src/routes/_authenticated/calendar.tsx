import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Clock,
  CheckCircle2,
  RefreshCw,
  CalendarDays,
  User,
  Mail,
  FileText,
  Save,
  Loader2,
  X,
  XCircle,
  Bot,
  PenLine,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { KpiCard } from "@/components/dashboard/PageShell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  listCalendarBookings,
  getBookingDetail,
  updateBookingNotes,
  cancelBookingFn,
} from "@/lib/dashboard/bookings.functions";
import type { UnifiedBooking } from "@/lib/dashboard/bookings.functions";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Webee" }] }),
  component: CalendarPage,
});

// ── Agent colour palette ──────────────────────────────────────────────────────
const AGENT_PALETTE = [
  { bg: "bg-violet-500/20",  text: "text-violet-300",  dot: "bg-violet-400",  ring: "ring-violet-500/30",  hex: "#a78bfa" },
  { bg: "bg-cyan-500/20",    text: "text-cyan-300",    dot: "bg-cyan-400",    ring: "ring-cyan-500/30",    hex: "#22d3ee" },
  { bg: "bg-emerald-500/20", text: "text-emerald-300", dot: "bg-emerald-400", ring: "ring-emerald-500/30", hex: "#34d399" },
  { bg: "bg-pink-500/20",    text: "text-pink-300",    dot: "bg-pink-400",    ring: "ring-pink-500/30",    hex: "#f472b6" },
  { bg: "bg-orange-500/20",  text: "text-orange-300",  dot: "bg-orange-400",  ring: "ring-orange-500/30", hex: "#fb923c" },
  { bg: "bg-yellow-500/20",  text: "text-yellow-300",  dot: "bg-yellow-400",  ring: "ring-yellow-500/30", hex: "#facc15" },
  { bg: "bg-sky-500/20",     text: "text-sky-300",     dot: "bg-sky-400",     ring: "ring-sky-500/30",    hex: "#38bdf8" },
];

const MANUAL_STYLE = { bg: "bg-slate-500/20", text: "text-slate-300", dot: "bg-slate-400", ring: "ring-slate-500/30", hex: "#94a3b8" };
const MANUAL_KEY   = "__manual__";

// ── Helpers ───────────────────────────────────────────────────────────────────
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const s = new Date(first);
  s.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return d; });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function statusBadge(status: string) {
  if (status === "confirmed") return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
  if (status === "pending")   return "bg-amber-500/15 text-amber-400 ring-amber-500/30";
  if (status === "cancelled") return "bg-red-500/15 text-red-400 ring-red-500/30";
  return "bg-muted text-muted-foreground ring-border";
}

/** Returns the colour token set for a given booking */
function bookingStyle(b: UnifiedBooking, agentColorMap: Map<string, typeof AGENT_PALETTE[0]>) {
  if (!b.agent_name) return MANUAL_STYLE;
  return agentColorMap.get(b.agent_name) ?? MANUAL_STYLE;
}

// ── Booking detail dialog ─────────────────────────────────────────────────────
function BookingDetailDialog({
  booking, open, onOpenChange, onNotesSaved, onCancelled,
}: {
  booking: UnifiedBooking | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNotesSaved: (id: string, notes: string) => void;
  onCancelled: (id: string) => void;
}) {
  const getDetailFn  = useServerFn(getBookingDetail);
  const updateNotesFn = useServerFn(updateBookingNotes);
  const cancelFn     = useServerFn(cancelBookingFn);

  const detailQ = useQuery({
    queryKey: ["booking-detail", booking?.id],
    queryFn: () => getDetailFn({ data: { db_id: booking?.db_id ?? undefined, external_id: booking?.external_id ?? undefined } }),
    enabled: open && booking != null && (!!booking.db_id || !!booking.external_id),
    throwOnError: false,
  });

  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (open && detailQ.data) setNotes(detailQ.data.notes ?? booking?.notes ?? "");
    else if (open && !detailQ.data) setNotes(booking?.notes ?? "");
  }, [open, detailQ.data, booking?.id]);

  async function handleSave() {
    if (!booking) return;
    setSaving(true);
    try {
      await updateNotesFn({ data: {
        db_id: detailQ.data?.db_id ?? booking.db_id ?? undefined,
        external_id: booking.external_id ?? undefined,
        title: booking.title, attendee_name: booking.attendee_name,
        attendee_email: booking.attendee_email, start_at: booking.start_at, notes,
      }});
      onNotesSaved(booking.id, notes);
      toast.success("Notes saved");
    } catch (e) {
      toast.error("Failed to save notes", { description: (e as Error).message });
    } finally { setSaving(false); }
  }

  async function handleCancel() {
    if (!booking) return;
    if (!window.confirm("Cancel this appointment? This cannot be undone.")) return;
    setCancelling(true);
    try {
      await cancelFn({ data: {
        db_id: detailQ.data?.db_id ?? booking.db_id ?? undefined,
        external_id: booking.external_id ?? undefined,
        reason: "Cancelled via dashboard",
      }});
      toast.success("Appointment cancelled");
      onCancelled(booking.id);
      onOpenChange(false);
    } catch (e) {
      toast.error("Failed to cancel appointment", { description: (e as Error).message });
    } finally { setCancelling(false); }
  }

  const summary   = detailQ.data?.summary;
  const isLoading = detailQ.isLoading && open;
  if (!booking) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-white/[0.06] px-6 py-4">
          <DialogTitle className="text-base font-semibold leading-snug pr-6">{booking.title}</DialogTitle>
          <DialogDescription className="sr-only">Booking details for {booking.title}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05]">
          {/* Appointment info */}
          <div className="px-6 py-4 space-y-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-3">Appointment</p>
            <div className="flex items-center gap-2.5 text-sm">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{fmtDateTime(booking.start_at)}</span>
              {booking.end_at && <span className="text-muted-foreground">– {fmtTime(booking.end_at)}</span>}
            </div>
            {(booking.attendee_name || booking.attendee_email) && (
              <div className="flex items-center gap-2.5 text-sm">
                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium">{booking.attendee_name ?? booking.attendee_email}</span>
                {booking.attendee_name && booking.attendee_email && (
                  <span className="text-muted-foreground text-xs">{booking.attendee_email}</span>
                )}
              </div>
            )}
            {booking.attendee_email && !booking.attendee_name && (
              <div className="flex items-center gap-2.5 text-sm">
                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">{booking.attendee_email}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1", statusBadge(booking.status))}>
                {booking.status}
              </span>
              {/* Appointment type badge */}
              {booking.agent_name ? (
                <span className="rounded-full px-2 py-0.5 text-[11px] ring-1 bg-blue-500/10 text-blue-400 ring-blue-500/20 flex items-center gap-1">
                  <Bot className="h-3 w-3" />
                  {booking.agent_name}
                </span>
              ) : (
                <span className="rounded-full px-2 py-0.5 text-[11px] ring-1 bg-slate-500/10 text-slate-400 ring-slate-500/20 flex items-center gap-1">
                  <PenLine className="h-3 w-3" />
                  Manual booking
                </span>
              )}
            </div>
            {booking.meeting_url && (
              <a href={booking.meeting_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 hover:underline">
                <ExternalLink className="h-3 w-3" />
                Open meeting link
              </a>
            )}
          </div>

          {/* Call summary */}
          {isLoading ? (
            <div className="flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading details…
            </div>
          ) : summary ? (
            <div className="px-6 py-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Call Summary</p>
              {summary.appointment_reason && (
                <div><p className="text-[10px] text-muted-foreground mb-0.5">Reason</p><p className="text-sm">{summary.appointment_reason}</p></div>
              )}
              {summary.summary && (
                <div>
                  <p className="text-[10px] text-muted-foreground mb-0.5">Summary</p>
                  <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">{summary.summary}</p>
                </div>
              )}
              {summary.customer_phone && (
                <div><p className="text-[10px] text-muted-foreground mb-0.5">Phone</p><p className="text-xs font-mono">{summary.customer_phone}</p></div>
              )}
              {summary.appointment_date && (
                <div><p className="text-[10px] text-muted-foreground mb-0.5">Confirmed date</p><p className="text-xs">{summary.appointment_date}</p></div>
              )}
            </div>
          ) : (booking.db_id || booking.external_id) && !detailQ.isLoading ? (
            <div className="px-6 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">Call Summary</p>
              <p className="text-xs text-muted-foreground">No call summary available for this booking.</p>
            </div>
          ) : null}

          {/* Notes */}
          <div className="px-6 py-4 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> Notes
            </p>
            <Textarea
              placeholder="Add meeting notes, follow-up actions, or anything relevant…"
              value={notes} onChange={(e) => setNotes(e.target.value)}
              className="min-h-[120px] text-sm resize-none border-white/[0.08] bg-white/[0.03] focus:border-blue-500/40"
              rows={5}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground shrink-0">Notes attach to this client's record</p>
              <div className="flex items-center gap-2">
                {booking.status !== "cancelled" && (
                  <Button size="sm" variant="outline"
                    className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={handleCancel} disabled={cancelling || saving}>
                    {cancelling ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <XCircle className="mr-1.5 h-3 w-3" />}
                    {cancelling ? "Cancelling…" : "Cancel Appt"}
                  </Button>
                )}
                <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving || cancelling}>
                  {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Save className="mr-1.5 h-3 w-3" />}
                  {saving ? "Saving…" : "Save Notes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Calendar page ─────────────────────────────────────────────────────────────
function CalendarPage() {
  const fn = useServerFn(listCalendarBookings);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["calendar-bookings"], queryFn: () => fn() ,
    throwOnError: false,
  });
  const data = q.data;

  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});

  const allBookings: UnifiedBooking[] = useMemo(() => {
    const raw = (data?.bookings ?? []) as UnifiedBooking[];
    return raw.map((b) => ({ ...b, notes: localNotes[b.id] !== undefined ? localNotes[b.id] : b.notes }));
  }, [data?.bookings, localNotes]);

  // ── Build agent colour map from all unique agent names ──
  const agentColorMap = useMemo(() => {
    const names = Array.from(new Set(allBookings.map((b) => b.agent_name).filter(Boolean))) as string[];
    const map = new Map<string, typeof AGENT_PALETTE[0]>();
    names.forEach((name, i) => map.set(name, AGENT_PALETTE[i % AGENT_PALETTE.length]));
    return map;
  }, [allBookings]);

  // ── Legend entries ──
  const legendEntries = useMemo(() => {
    const entries: { key: string; label: string; style: typeof MANUAL_STYLE; count: number; isManual: boolean }[] = [];
    agentColorMap.forEach((style, name) => {
      entries.push({ key: name, label: name, style, count: allBookings.filter((b) => b.agent_name === name).length, isManual: false });
    });
    const manualCount = allBookings.filter((b) => !b.agent_name).length;
    if (manualCount > 0) entries.push({ key: MANUAL_KEY, label: "Manual", style: MANUAL_STYLE, count: manualCount, isManual: true });
    return entries;
  }, [agentColorMap, allBookings]);

  // ── Agent filter: null = show all ──
  // selectedFilters is a Set of keys (agent name or MANUAL_KEY). Empty = all visible.
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());

  function toggleFilter(key: string) {
    setSelectedFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Filter bookings by active selection (empty set = all)
  const bookings = useMemo(() => {
    if (selectedFilters.size === 0) return allBookings;
    return allBookings.filter((b) => {
      const key = b.agent_name ?? MANUAL_KEY;
      return selectedFilters.has(key);
    });
  }, [allBookings, selectedFilters]);

  const [cursor,   setCursor]   = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [detailBooking, setDetailBooking] = useState<UnifiedBooking | null>(null);
  const [detailOpen,    setDetailOpen]    = useState(false);

  const now      = Date.now();
  const upcoming = bookings.filter((b) => new Date(b.start_at).getTime() > now && b.status !== "cancelled");
  const pending  = bookings.filter((b) => b.status === "pending").length;
  const past     = bookings.filter((b) => new Date(b.start_at).getTime() <= now);
  const grid     = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, UnifiedBooking[]>();
    for (const b of bookings) {
      const d = new Date(b.start_at);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return map;
  }, [bookings]);

  const selectedKey  = `${selected.getFullYear()}-${selected.getMonth()}-${selected.getDate()}`;
  const dayBookings  = (byDay.get(selectedKey) ?? []).sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  const monthLabel   = cursor.toLocaleString(undefined, { month: "long", year: "numeric" });

  function openDetail(b: UnifiedBooking) { setDetailBooking(b); setDetailOpen(true); }
  function handleNotesSaved(id: string, notes: string) {
    setLocalNotes((p) => ({ ...p, [id]: notes }));
    qc.invalidateQueries({ queryKey: ["calendar-bookings"] });
  }
  function handleCancelled(_id: string) { qc.invalidateQueries({ queryKey: ["calendar-bookings"] }); }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">

      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calendar Manager</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data?.calcomConfigured ? "Live bookings from Cal.com" : "Bookings from your agents"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", q.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {data?.calcomError && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
          Cal.com sync error: {data.calcomError}
        </div>
      )}

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total Bookings" value={bookings.length} icon={CalendarCheck} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
        <KpiCard label="Upcoming" value={upcoming.length} icon={CalendarDays} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
        <KpiCard label="Pending" value={pending} icon={Clock} iconBg="bg-amber-500/15" iconColor="text-amber-400" />
        <KpiCard label="Past" value={past.length} icon={CheckCircle2} iconBg="bg-emerald-500/15" iconColor="text-emerald-400" />
      </div>

      {/* ── Legend + Agent filter ── */}
      {legendEntries.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-card/40 px-4 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mr-1">Filter by</span>

          {legendEntries.map((entry) => {
            const active = selectedFilters.size === 0 || selectedFilters.has(entry.key);
            return (
              <button
                key={entry.key}
                onClick={() => toggleFilter(entry.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-all",
                  entry.style.bg, entry.style.text, entry.style.ring,
                  !active && "opacity-35 grayscale",
                )}
              >
                {entry.isManual
                  ? <PenLine className="h-2.5 w-2.5" />
                  : <Bot className="h-2.5 w-2.5" />
                }
                {entry.label}
                <span className="ml-0.5 rounded-full bg-white/10 px-1 text-[10px] tabular-nums">{entry.count}</span>
              </button>
            );
          })}

          {selectedFilters.size > 0 && (
            <button
              onClick={() => setSelectedFilters(new Set())}
              className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear filter
            </button>
          )}
        </div>
      )}

      {/* Calendar + Day panel */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">

        {/* Month grid */}
        <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold">{monthLabel}</h3>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2"
                onClick={() => { const t = new Date(); setCursor(t); setSelected(t); }}>
                Today
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-px bg-white/[0.04] text-center text-[10px] uppercase tracking-wider text-muted-foreground">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
              <div key={d} className="bg-card/80 py-1.5">{d}</div>
            ))}

            {grid.map((d) => {
              const k       = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
              const items   = byDay.get(k) ?? [];
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday    = sameDay(d, new Date());
              const isSelected = sameDay(d, selected);
              return (
                <button key={k} onClick={() => setSelected(d)}
                  className={cn(
                    "relative flex h-20 flex-col items-start justify-start gap-0.5 bg-card/50 p-1.5 text-left transition-colors hover:bg-white/[0.03]",
                    !inMonth && "opacity-35",
                    isSelected && "ring-1 ring-inset ring-primary/60",
                  )}
                >
                  <span className={cn("text-[11px] font-medium", isToday && "rounded bg-primary px-1.5 text-primary-foreground")}>
                    {d.getDate()}
                  </span>
                  <div className="flex w-full flex-col gap-0.5 overflow-hidden">
                    {items.slice(0, 2).map((b) => {
                      const style = bookingStyle(b, agentColorMap);
                      return (
                        <div key={b.id} role="button" tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); setSelected(d); openDetail(b); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); setSelected(d); openDetail(b); } }}
                          className={cn(
                            "w-full truncate rounded px-1 py-[1px] text-[10px] text-left cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1",
                            b.status === "cancelled" ? "bg-red-500/15 text-red-400 line-through" : `${style.bg} ${style.text}`,
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", b.status === "cancelled" ? "bg-red-400" : style.dot)} />
                          <span className="truncate">{fmtTime(b.start_at)} · {b.title}</span>
                        </div>
                      );
                    })}
                    {items.length > 2 && (
                      <span className="truncate text-[10px] text-muted-foreground">+{items.length - 2} more</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Day panel */}
        <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/[0.06]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {selected.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </p>
          </div>

          {dayBookings.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center px-6">
              <CalendarCheck className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">No bookings</p>
              <p className="text-xs text-muted-foreground/60">Nothing scheduled for this day.</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {dayBookings.map((b) => {
                const style = bookingStyle(b, agentColorMap);
                return (
                  <li key={b.id}>
                    <button onClick={() => openDetail(b)}
                      className="w-full text-left px-4 py-3 hover:bg-white/[0.02] transition-colors group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {/* Coloured source indicator */}
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={cn("h-2 w-2 rounded-full shrink-0", style.dot)} />
                            <span className={cn("text-[10px] font-medium", style.text)}>
                              {b.agent_name
                                ? <><Bot className="h-2.5 w-2.5 inline mr-0.5 -mt-0.5" />{b.agent_name}</>
                                : <><PenLine className="h-2.5 w-2.5 inline mr-0.5 -mt-0.5" />Manual</>
                              }
                            </span>
                          </div>
                          <p className="truncate text-sm font-medium group-hover:text-foreground">{b.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {fmtTime(b.start_at)}{b.end_at && ` – ${fmtTime(b.end_at)}`}
                          </p>
                          {(b.attendee_name || b.attendee_email) && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {b.attendee_name ?? b.attendee_email}
                            </p>
                          )}
                          {b.notes && (
                            <p className="mt-1 truncate text-[11px] text-muted-foreground/70 italic">📝 {b.notes}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 capitalize", statusBadge(b.status))}>
                            {b.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
                            Click for details →
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <BookingDetailDialog
        booking={detailBooking} open={detailOpen} onOpenChange={setDetailOpen}
        onNotesSaved={handleNotesSaved} onCancelled={handleCancelled}
      />
    </div>
  );
}
