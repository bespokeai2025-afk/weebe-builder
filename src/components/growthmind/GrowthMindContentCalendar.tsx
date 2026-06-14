import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Loader2,
  RefreshCw, Trash2, Edit2, X, Save, Filter, Tag, List, Grid3X3,
  Repeat, Calendar, LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { HiveMindReportBanner } from "./HiveMindReportBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getCalendarEntries, saveCalendarEntry, deleteCalendarEntry,
  getCampaigns, saveCampaign, deleteCampaign,
  getSeries, saveSeries, deleteSeries,
  CONTENT_TYPES, CONTENT_STATUSES, CAMPAIGN_TYPES, CADENCES,
  CONTENT_TYPE_COLORS,
  type CalendarEntry, type GrowthCampaign, type ContentSeries,
  type ContentType, type ContentStatus,
} from "@/lib/growthmind/growthmind.content-calendar";

// ── Helpers ──────────────────────────────────────────────────────────────────

type CalView = "month" | "week" | "day" | "quarter" | "90day";

const VIEW_LABELS: Record<CalView, string> = {
  month:   "Month",
  week:    "Week",
  day:     "Day",
  quarter: "Quarter",
  "90day": "90-Day Plan",
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtMonthYear(d: Date) {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_COLORS: Record<string, string> = {
  Draft:     "bg-zinc-500/20 text-zinc-400 ring-zinc-500/20",
  Planned:   "bg-blue-500/20 text-blue-400 ring-blue-500/20",
  Scheduled: "bg-amber-500/20 text-amber-400 ring-amber-500/20",
  Published: "bg-emerald-500/20 text-emerald-400 ring-emerald-500/20",
  Archived:  "bg-zinc-600/20 text-zinc-500 ring-zinc-600/20",
  Cancelled: "bg-red-500/20 text-red-400 ring-red-500/20",
};

// ── Entry chip ────────────────────────────────────────────────────────────────

function EntryChip({ entry, onClick }: { entry: CalendarEntry; onClick: () => void }) {
  const color = CONTENT_TYPE_COLORS[entry.contentType] ?? "#10b981";
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 w-full rounded text-[10px] font-medium px-1 py-0.5 text-left truncate transition-opacity hover:opacity-80"
      style={{ backgroundColor: color + "22", color, border: `1px solid ${color}33` }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="truncate">{entry.title}</span>
    </button>
  );
}

// ── Entry modal ───────────────────────────────────────────────────────────────

const EMPTY_ENTRY = {
  id:            undefined as string | undefined,
  title:         "",
  contentType:   "Blog" as ContentType,
  channel:       "",
  status:        "Draft" as ContentStatus,
  campaignId:    null as string | null,
  seriesId:      null as string | null,
  owner:         "",
  scheduledDate: "",
  description:   "",
  notes:         "",
};

function EntryModal({
  initial, campaigns, series, onClose, onSave, saving,
}: {
  initial: typeof EMPTY_ENTRY;
  campaigns: GrowthCampaign[];
  series: ContentSeries[];
  onClose: () => void;
  onSave: (v: typeof EMPTY_ENTRY) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-white/[0.08] bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <p className="text-sm font-semibold">{form.id ? "Edit Content" : "Add Content"}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <Label className="text-xs mb-1.5 block">Title *</Label>
            <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Content title…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Content Type</Label>
              <select
                value={form.contentType}
                onChange={e => set("contentType", e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Status</Label>
              <select
                value={form.status}
                onChange={e => set("status", e.target.value as ContentStatus)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {CONTENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Channel</Label>
              <Input value={form.channel} onChange={e => set("channel", e.target.value)} placeholder="e.g. LinkedIn, Website…" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Owner</Label>
              <Input value={form.owner} onChange={e => set("owner", e.target.value)} placeholder="e.g. Marketing Team" />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Scheduled Date</Label>
            <Input type="datetime-local" value={form.scheduledDate} onChange={e => set("scheduledDate", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Campaign</Label>
              <select
                value={form.campaignId ?? ""}
                onChange={e => set("campaignId", e.target.value || null)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">No campaign</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Series</Label>
              <select
                value={form.seriesId ?? ""}
                onChange={e => set("seriesId", e.target.value || null)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">No series</option>
                {series.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Description</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} placeholder="What is this content about?" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Notes</Label>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} placeholder="Internal notes…" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-white/[0.06]">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave(form)} disabled={!form.title.trim() || saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({
  pivot, entries, onAddDay, onEdit,
}: {
  pivot: Date;
  entries: CalendarEntry[];
  onAddDay: (date: Date) => void;
  onEdit: (e: CalendarEntry) => void;
}) {
  const first  = startOfMonth(pivot);
  const last   = endOfMonth(pivot);
  const startDow = first.getDay();

  const days: Date[] = [];
  for (let i = startDow - 1; i >= 0; i--) days.push(addDays(first, -i - 1));
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(new Date(d));
  while (days.length % 7 !== 0) days.push(addDays(days[days.length - 1], 1));

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    entries.forEach(e => {
      if (!e.scheduledDate) return;
      const k = dateKey(new Date(e.scheduledDate));
      if (!map[k]) map[k] = [];
      map[k].push(e);
    });
    return map;
  }, [entries]);

  const today = new Date();

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {DOW.map(d => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60 py-2">
            {d}
          </div>
        ))}
      </div>
      {/* Weeks */}
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const k = dateKey(day);
          const dayEntries = byDay[k] ?? [];
          const isCurrentMonth = day.getMonth() === pivot.getMonth();
          const isToday = isSameDay(day, today);
          return (
            <div
              key={i}
              className={cn(
                "border-b border-r border-white/[0.04] min-h-[96px] p-1 group",
                !isCurrentMonth && "opacity-40",
                i % 7 === 6 && "border-r-0",
                i >= days.length - 7 && "border-b-0",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn(
                  "text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded-full",
                  isToday && "bg-emerald-500 text-white",
                  !isToday && isCurrentMonth && "text-foreground",
                  !isToday && !isCurrentMonth && "text-muted-foreground",
                )}>
                  {day.getDate()}
                </span>
                <button
                  onClick={() => onAddDay(day)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-emerald-400 transition-opacity"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <div className="space-y-0.5">
                {dayEntries.slice(0, 3).map(e => (
                  <EntryChip key={e.id} entry={e} onClick={() => onEdit(e)} />
                ))}
                {dayEntries.length > 3 && (
                  <p className="text-[9px] text-muted-foreground/60 pl-1">+{dayEntries.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekView({ pivot, entries, onAddDay, onEdit }: { pivot: Date; entries: CalendarEntry[]; onAddDay: (d: Date) => void; onEdit: (e: CalendarEntry) => void }) {
  const monday = addDays(pivot, -(pivot.getDay() || 7) + 1);
  const days: Date[] = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const today = new Date();

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      <div className="grid grid-cols-7 border-b border-white/[0.06]">
        {days.map((d, i) => (
          <div key={i} className={cn("text-center py-2 border-r border-white/[0.04] last:border-r-0", isSameDay(d, today) && "bg-emerald-500/5")}>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">{DOW[d.getDay()]}</p>
            <p className={cn("text-sm font-semibold mt-0.5", isSameDay(d, today) && "text-emerald-400")}>{d.getDate()}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 min-h-[200px]">
        {days.map((d, i) => {
          const k = dateKey(d);
          const dayEntries = entries.filter(e => e.scheduledDate && isSameDay(new Date(e.scheduledDate), d));
          return (
            <div key={i} className={cn("border-r border-white/[0.04] last:border-r-0 p-2 space-y-1 group", isSameDay(d, today) && "bg-emerald-500/[0.03]")}>
              <button onClick={() => onAddDay(d)} className="opacity-0 group-hover:opacity-100 w-full flex items-center justify-center gap-1 text-[10px] text-emerald-400/60 hover:text-emerald-400 py-1 rounded border border-dashed border-emerald-500/20 transition-all hover:border-emerald-500/40">
                <Plus className="h-2.5 w-2.5" /> Add
              </button>
              {dayEntries.map(e => <EntryChip key={e.id} entry={e} onClick={() => onEdit(e)} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── List view (90 day / quarter) ──────────────────────────────────────────────

function ListView({ entries, onEdit, onDelete }: { entries: CalendarEntry[]; onEdit: (e: CalendarEntry) => void; onDelete: (id: string) => void }) {
  const groups = useMemo(() => {
    const m: Record<string, CalendarEntry[]> = {};
    entries.forEach(e => {
      if (!e.scheduledDate) {
        const k = "Unscheduled";
        if (!m[k]) m[k] = [];
        m[k].push(e);
        return;
      }
      const d = new Date(e.scheduledDate);
      const wk = `Week of ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
      const k = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, "0")} — ${wk}`;
      if (!m[k]) m[k] = [];
      m[k].push(e);
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  return (
    <div className="space-y-4">
      {groups.map(([week, items]) => (
        <div key={week}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60 mb-2">{week.split(" — ")[1] ?? week}</p>
          <div className="space-y-1">
            {items.map(e => {
              const color = CONTENT_TYPE_COLORS[e.contentType] ?? "#10b981";
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-card/40 px-3 py-2 group hover:bg-card/70 transition-colors">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{e.title}</p>
                    <p className="text-[11px] text-muted-foreground">{e.contentType}{e.channel ? ` · ${e.channel}` : ""}{e.scheduledDate ? ` · ${fmtDate(e.scheduledDate)}` : ""}</p>
                  </div>
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1", STATUS_COLORS[e.status] ?? "bg-zinc-500/20 text-zinc-400 ring-zinc-500/20")}>
                    {e.status}
                  </span>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                    <button onClick={() => onEdit(e)} className="text-muted-foreground hover:text-foreground"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onDelete(e.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">No content in this period.</p>
      )}
    </div>
  );
}

function getISOWeek(d: Date) {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
}

// ── Campaigns panel ───────────────────────────────────────────────────────────

function CampaignPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const saveCampaignFn = useServerFn(saveCampaign);
  const deleteCampaignFn = useServerFn(deleteCampaign);

  const { data } = useQuery({ queryKey: ["growthmind-campaigns"], queryFn: () => getCampaigns() });
  const campaigns = data?.campaigns ?? [];

  const [form, setForm] = useState({ name: "", campaignType: "Brand Awareness", description: "", color: "#10b981" });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await saveCampaignFn({ name: form.name.trim(), campaignType: form.campaignType, description: form.description, color: form.color });
      qc.invalidateQueries({ queryKey: ["growthmind-campaigns"] });
      setForm({ name: "", campaignType: "Brand Awareness", description: "", color: "#10b981" });
    } catch {}
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    await deleteCampaignFn({ id });
    qc.invalidateQueries({ queryKey: ["growthmind-campaigns"] });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <p className="text-sm font-semibold">Campaigns</p>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            <Input placeholder="Campaign name…" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <select value={form.campaignType} onChange={e => setForm(f => ({ ...f, campaignType: e.target.value }))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
              {CAMPAIGN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={!form.name.trim() || saving} className="flex-1">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Add Campaign
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            {campaigns.map(c => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-card/40 px-3 py-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground">{c.campaignType}</p>
                </div>
                <button onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {campaigns.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No campaigns yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Series panel ──────────────────────────────────────────────────────────────

function SeriesPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const saveSeriesFn  = useServerFn(saveSeries);
  const deleteSeriesFn = useServerFn(deleteSeries);

  const { data } = useQuery({ queryKey: ["growthmind-series"], queryFn: () => getSeries() });
  const seriesList = data?.series ?? [];

  const [form, setForm] = useState({ name: "", contentType: "Blog", cadence: "weekly" as "daily" | "weekly" | "biweekly" | "monthly", channel: "" });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await saveSeriesFn({ name: form.name.trim(), contentType: form.contentType, cadence: form.cadence, channel: form.channel });
      qc.invalidateQueries({ queryKey: ["growthmind-series"] });
      setForm({ name: "", contentType: "Blog", cadence: "weekly", channel: "" });
    } catch {}
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
          <p className="text-sm font-semibold flex items-center gap-2"><Repeat className="h-4 w-4 text-emerald-400" />Content Series</p>
          <button onClick={onClose}><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            <Input placeholder="Series name (e.g. Weekly CEO Insights)…" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.contentType} onChange={e => setForm(f => ({ ...f, contentType: e.target.value }))}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select value={form.cadence} onChange={e => setForm(f => ({ ...f, cadence: e.target.value as "daily" | "weekly" | "biweekly" | "monthly" }))}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none">
                {CADENCES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <Button size="sm" onClick={handleSave} disabled={!form.name.trim() || saving} className="w-full">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Add Series
            </Button>
          </div>
          <div className="space-y-1.5">
            {seriesList.map(s => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-card/40 px-3 py-2">
                <Repeat className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.contentType} · {s.cadence}</p>
                </div>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full", s.isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-500/20 text-zinc-400")}>{s.isActive ? "Active" : "Paused"}</span>
                <button onClick={() => deleteSeriesFn({ id: s.id }).then(() => qc.invalidateQueries({ queryKey: ["growthmind-series"] }))}
                  className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {seriesList.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No series yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GrowthMindContentCalendar() {
  const qc = useQueryClient();
  const saveEntryFn   = useServerFn(saveCalendarEntry);
  const deleteEntryFn = useServerFn(deleteCalendarEntry);

  const [view, setView]   = useState<CalView>("month");
  const [pivot, setPivot] = useState(new Date());
  const [msg, setMsg]     = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [showSeries, setShowSeries]       = useState(false);
  const [editEntry, setEditEntry] = useState<typeof EMPTY_ENTRY>(EMPTY_ENTRY);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType]     = useState("");

  // Date range for current view
  const { startDate, endDate } = useMemo(() => {
    const now = pivot;
    if (view === "month") {
      return { startDate: startOfMonth(now).toISOString(), endDate: endOfMonth(now).toISOString() };
    }
    if (view === "week") {
      const mon = addDays(now, -(now.getDay() || 7) + 1);
      return { startDate: mon.toISOString(), endDate: addDays(mon, 6).toISOString() };
    }
    if (view === "day") {
      return { startDate: now.toISOString(), endDate: addDays(now, 1).toISOString() };
    }
    if (view === "quarter") {
      return { startDate: now.toISOString(), endDate: addDays(now, 90).toISOString() };
    }
    // 90day
    return { startDate: now.toISOString(), endDate: addDays(now, 90).toISOString() };
  }, [view, pivot]);

  const { data: calData, isLoading } = useQuery({
    queryKey: ["growthmind-calendar", startDate, endDate, filterStatus, filterType],
    queryFn:  () => getCalendarEntries({ startDate, endDate, status: filterStatus || undefined, contentType: filterType || undefined }),
    staleTime: 60_000,
  });
  const entries = calData?.entries ?? [];

  const { data: campaignData } = useQuery({ queryKey: ["growthmind-campaigns"], queryFn: () => getCampaigns(), staleTime: 120_000 });
  const { data: seriesData }   = useQuery({ queryKey: ["growthmind-series"],    queryFn: () => getSeries(),    staleTime: 120_000 });
  const campaigns = campaignData?.campaigns ?? [];
  const series    = seriesData?.series     ?? [];

  function openAdd(date?: Date) {
    const sd = date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T09:00` : "";
    setEditEntry({ ...EMPTY_ENTRY, scheduledDate: sd });
    setShowModal(true);
  }

  function openEdit(e: CalendarEntry) {
    setEditEntry({
      id:            e.id,
      title:         e.title,
      contentType:   e.contentType,
      channel:       e.channel,
      status:        e.status,
      campaignId:    e.campaignId,
      seriesId:      e.seriesId,
      owner:         e.owner,
      scheduledDate: e.scheduledDate ? e.scheduledDate.slice(0, 16) : "",
      description:   e.description,
      notes:         e.notes,
    });
    setShowModal(true);
  }

  async function handleSave(form: typeof EMPTY_ENTRY) {
    setSaving(true);
    try {
      await saveEntryFn({
        id:            form.id,
        title:         form.title,
        contentType:   form.contentType,
        channel:       form.channel,
        status:        form.status,
        campaignId:    form.campaignId,
        seriesId:      form.seriesId,
        owner:         form.owner,
        scheduledDate: form.scheduledDate ? new Date(form.scheduledDate).toISOString() : null,
        description:   form.description,
        notes:         form.notes,
      });
      qc.invalidateQueries({ queryKey: ["growthmind-calendar"] });
      setShowModal(false);
      setMsg("Saved!");
      setTimeout(() => setMsg(null), 2500);
    } catch (err: any) {
      setMsg("Error: " + err.message);
    }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    await deleteEntryFn({ id });
    qc.invalidateQueries({ queryKey: ["growthmind-calendar"] });
  }

  function navigate(dir: 1 | -1) {
    setPivot(p => {
      if (view === "month")   return new Date(p.getFullYear(), p.getMonth() + dir, 1);
      if (view === "week")    return addDays(p, dir * 7);
      if (view === "day")     return addDays(p, dir);
      if (view === "quarter") return addDays(p, dir * 90);
      return addDays(p, dir * 90);
    });
  }

  function pivotLabel() {
    if (view === "month")   return fmtMonthYear(pivot);
    if (view === "week") {
      const mon = addDays(pivot, -(pivot.getDay() || 7) + 1);
      return `${mon.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDays(mon, 6).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    if (view === "day")     return pivot.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return `${pivot.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDays(pivot, 89).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }

  // Count by status for summary
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    entries.forEach(e => { m[e.status] = (m[e.status] ?? 0) + 1; });
    return m;
  }, [entries]);

  const briefing = entries.length > 0
    ? `${entries.length} pieces of content in this period — ${statusCounts["Published"] ?? 0} published, ${statusCounts["Scheduled"] ?? 0} scheduled, ${statusCounts["Planned"] ?? 0} planned. ${statusCounts["Draft"] ?? 0} drafts still need attention.`
    : null;

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-6xl">

        {/* Header */}
        <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-400" />
              Content Calendar
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Plan, schedule and track all your marketing content</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {msg && <span className={cn("text-xs font-medium", msg.startsWith("Error") ? "text-red-400" : "text-emerald-400")}>{msg}</span>}
            <Button variant="outline" size="sm" onClick={() => setShowSeries(true)}>
              <Repeat className="mr-1.5 h-3.5 w-3.5" />Series
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowCampaigns(true)}>
              <Tag className="mr-1.5 h-3.5 w-3.5" />Campaigns
            </Button>
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-calendar"] })}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoading && "animate-spin")} />Refresh
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5" onClick={() => openAdd()}>
              <Plus className="h-3.5 w-3.5" />Add Content
            </Button>
          </div>
        </div>

        <HiveMindReportBanner domain="Content Calendar" briefing={briefing} />

        {/* View switcher */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-card/40 p-0.5">
            {(["month", "week", "day", "quarter", "90day"] as CalView[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                  view === v ? "bg-emerald-600 text-white" : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                )}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Filters */}
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none">
              <option value="">All statuses</option>
              {CONTENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none">
              <option value="">All types</option>
              {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Nav */}
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-card/40">
              <button onClick={() => navigate(-1)} className="px-2 py-1.5 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-medium px-1 min-w-[140px] text-center">{pivotLabel()}</span>
              <button onClick={() => navigate(1)} className="px-2 py-1.5 text-muted-foreground hover:text-foreground">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPivot(new Date())}>Today</Button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap mb-4">
          {Object.entries(CONTENT_TYPE_COLORS).slice(0, 8).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[10px] text-muted-foreground">{type}</span>
            </div>
          ))}
        </div>

        {/* Calendar body */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading calendar…</span>
          </div>
        ) : (
          <>
            {view === "month" && (
              <MonthView pivot={pivot} entries={entries} onAddDay={openAdd} onEdit={openEdit} />
            )}
            {view === "week" && (
              <WeekView pivot={pivot} entries={entries} onAddDay={openAdd} onEdit={openEdit} />
            )}
            {view === "day" && (
              <div className="rounded-xl border border-white/[0.06] p-6 min-h-[300px]">
                <p className="text-sm font-semibold mb-4">{pivot.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                <div className="space-y-2">
                  {entries.filter(e => e.scheduledDate && isSameDay(new Date(e.scheduledDate), pivot)).map(e => (
                    <div key={e.id} className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-card/40 hover:bg-card/70 cursor-pointer" onClick={() => openEdit(e)}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CONTENT_TYPE_COLORS[e.contentType] ?? "#10b981" }} />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{e.title}</p>
                        <p className="text-xs text-muted-foreground">{e.contentType}{e.channel ? ` · ${e.channel}` : ""}</p>
                      </div>
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1", STATUS_COLORS[e.status])}>{e.status}</span>
                    </div>
                  ))}
                  {entries.filter(e => e.scheduledDate && isSameDay(new Date(e.scheduledDate), pivot)).length === 0 && (
                    <div className="text-center py-12">
                      <p className="text-sm text-muted-foreground mb-3">No content scheduled for this day.</p>
                      <Button size="sm" variant="outline" onClick={() => openAdd(pivot)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />Add Content
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {(view === "quarter" || view === "90day") && (
              <ListView entries={entries} onEdit={openEdit} onDelete={handleDelete} />
            )}
          </>
        )}

        {/* Status summary */}
        {!isLoading && entries.length > 0 && (
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {CONTENT_STATUSES.map(s => {
              const count = statusCounts[s] ?? 0;
              if (!count) return null;
              return (
                <div key={s} className={cn("flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ring-1", STATUS_COLORS[s])}>
                  <span className="font-semibold">{count}</span>
                  <span>{s}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Modals */}
        {showModal && (
          <EntryModal
            initial={editEntry}
            campaigns={campaigns}
            series={series}
            onClose={() => setShowModal(false)}
            onSave={handleSave}
            saving={saving}
          />
        )}
        {showCampaigns && <CampaignPanel onClose={() => setShowCampaigns(false)} />}
        {showSeries    && <SeriesPanel   onClose={() => setShowSeries(false)} />}

      </div>
    </GrowthMindShell>
  );
}
