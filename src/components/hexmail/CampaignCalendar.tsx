import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Mail,
  Loader2,
  CalendarDays,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listHexmailCampaigns,
  saveHexmailCampaign,
  type HexmailCampaign,
} from "@/lib/hexmail/campaigns.functions";

// ── Helpers ────────────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const STATUS_COLORS: Record<HexmailCampaign["status"], string> = {
  draft:    "bg-muted text-muted-foreground",
  active:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paused:   "bg-amber-500/15 text-amber-400 border-amber-500/30",
  archived: "bg-muted/60 text-muted-foreground",
};

const PILL_COLORS = [
  "bg-violet-500/20 text-violet-300 border-violet-500/25",
  "bg-orange-500/20 text-orange-300 border-orange-500/25",
  "bg-emerald-500/20 text-emerald-300 border-emerald-500/25",
  "bg-sky-500/20 text-sky-300 border-sky-500/25",
  "bg-pink-500/20 text-pink-300 border-pink-500/25",
  "bg-yellow-500/20 text-yellow-300 border-yellow-500/25",
  "bg-indigo-500/20 text-indigo-300 border-indigo-500/25",
  "bg-teal-500/20 text-teal-300 border-teal-500/25",
];

function pillColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PILL_COLORS[hash % PILL_COLORS.length];
}

function toLocalDateStr(isoStr: string) {
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return toLocalDateStr(new Date().toISOString());
}

function formatDisplayDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

// ── New Campaign Dialog ────────────────────────────────────────────────────────

interface NewCampaignDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
  isPending: boolean;
}

function NewCampaignDialog({ open, onClose, onCreate, isPending }: NewCampaignDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) { setName(""); setDescription(""); }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), description.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Campaign</DialogTitle>
          <DialogDescription>
            Give your follow-up campaign a name to get started.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Campaign Name</Label>
            <Input
              autoFocus
              placeholder="e.g. 30-Day Warm Nurture"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Description{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              placeholder="What is this campaign for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isPending} className="gap-2">
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create Campaign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Campaign Card (right panel) ────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: HexmailCampaign }) {
  const color = pillColor(campaign.id);
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer">
      <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border", color)}>
        <Mail className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight">{campaign.name}</p>
        {campaign.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.description}</p>
        )}
      </div>
      <Badge
        variant="outline"
        className={cn("shrink-0 border text-[10px] font-medium capitalize px-1.5 py-0.5", STATUS_COLORS[campaign.status])}
      >
        {campaign.status}
      </Badge>
    </div>
  );
}

// ── Calendar Cell ──────────────────────────────────────────────────────────────

function CalendarCell({
  dateStr,
  dayNum,
  campaigns,
  isSelected,
  isToday,
  isCurrentMonth,
  onClick,
}: {
  dateStr: string;
  dayNum: number;
  campaigns: HexmailCampaign[];
  isSelected: boolean;
  isToday: boolean;
  isCurrentMonth: boolean;
  onClick: () => void;
}) {
  const MAX_PILLS = 2;
  const visible = campaigns.slice(0, MAX_PILLS);
  const overflow = campaigns.length - MAX_PILLS;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex min-h-[80px] flex-col items-start gap-1 rounded-lg border p-2 text-left transition-colors",
        isCurrentMonth ? "bg-card hover:bg-muted/30" : "bg-muted/10 hover:bg-muted/20",
        isSelected && "border-primary/60 bg-primary/5 hover:bg-primary/8",
        !isSelected && "border-border",
      )}
    >
      {/* Day number */}
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
          isToday
            ? "bg-primary text-primary-foreground"
            : isCurrentMonth
            ? "text-foreground"
            : "text-muted-foreground/50",
        )}
      >
        {dayNum}
      </span>

      {/* Campaign pills */}
      <div className="flex w-full flex-col gap-0.5">
        {visible.map((c) => (
          <span
            key={c.id}
            className={cn(
              "flex items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none",
              pillColor(c.id),
            )}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
            <span className="truncate">{c.name}</span>
          </span>
        ))}
        {overflow > 0 && (
          <span className="pl-1 text-[10px] text-muted-foreground">+{overflow} more</span>
        )}
      </div>
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface CampaignCalendarProps {
  initialCampaignId?: string;
}

export function CampaignCalendar({ initialCampaignId: _initialCampaignId }: CampaignCalendarProps) {
  const qc = useQueryClient();
  const today = todayStr();

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);

  const campaignsQ = useQuery<HexmailCampaign[]>({
    queryKey: ["hexmail-campaigns"],
    queryFn: () => listHexmailCampaigns({ data: {} }),
  });

  const createMut = useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      saveHexmailCampaign({ data: { name, description, steps: [] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      setNewCampaignOpen(false);
      toast.success("Campaign created");
    },
    onError: (e: any) => toast.error(e?.message ?? "Create failed"),
  });

  const campaigns = campaignsQ.data ?? [];

  // Group campaigns by their created_at date string (YYYY-MM-DD)
  const byDate = new Map<string, HexmailCampaign[]>();
  for (const c of campaigns) {
    const ds = toLocalDateStr(c.created_at);
    const arr = byDate.get(ds) ?? [];
    arr.push(c);
    byDate.set(ds, arr);
  }

  const { year, month } = currentMonth;
  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);

  // Build grid cells (leading blanks + days + trailing blanks)
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const cells: { dateStr: string; dayNum: number; isCurrentMonth: boolean }[] = [];

  // Leading days from previous month
  const prevMonthDays = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1);
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const pm = month - 1 < 0 ? 11 : month - 1;
    const py = month - 1 < 0 ? year - 1 : year;
    cells.push({
      dateStr: `${py}-${String(pm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      dayNum: d,
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      dateStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      dayNum: d,
      isCurrentMonth: true,
    });
  }

  // Trailing days from next month
  let trailDay = 1;
  while (cells.length < totalCells) {
    const nm = month + 1 > 11 ? 0 : month + 1;
    const ny = month + 1 > 11 ? year + 1 : year;
    cells.push({
      dateStr: `${ny}-${String(nm + 1).padStart(2, "0")}-${String(trailDay).padStart(2, "0")}`,
      dayNum: trailDay,
      isCurrentMonth: false,
    });
    trailDay++;
  }

  const prevMonth = () =>
    setCurrentMonth(({ year: y, month: m }) =>
      m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 },
    );

  const nextMonth = () =>
    setCurrentMonth(({ year: y, month: m }) =>
      m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 },
    );

  const selectedCampaigns = byDate.get(selectedDate) ?? [];

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* ── Left: Calendar ── */}
      <div className="flex-1 min-w-0 flex flex-col gap-3">
        {/* Month header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {MONTH_NAMES[month]} {year}
          </h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 gap-1">
          {DAYS_OF_WEEK.map((d) => (
            <div
              key={d}
              className="py-1.5 text-center text-xs font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1 flex-1">
          {cells.map((cell) => (
            <CalendarCell
              key={cell.dateStr}
              dateStr={cell.dateStr}
              dayNum={cell.dayNum}
              campaigns={byDate.get(cell.dateStr) ?? []}
              isSelected={cell.dateStr === selectedDate}
              isToday={cell.dateStr === today}
              isCurrentMonth={cell.isCurrentMonth}
              onClick={() => setSelectedDate(cell.dateStr)}
            />
          ))}
        </div>
      </div>

      {/* ── Right: Date detail panel ── */}
      <div className="w-64 shrink-0 flex flex-col gap-3">
        {/* Panel header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            {selectedDate === today ? "Today" : formatDisplayDate(selectedDate)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full border border-dashed border-primary/50 text-primary hover:bg-primary/10"
            onClick={() => setNewCampaignOpen(true)}
            title="New campaign"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Campaign list for selected date */}
        <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto">
          {campaignsQ.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedCampaigns.length > 0 ? (
            selectedCampaigns.map((c) => <CampaignCard key={c.id} campaign={c} />)
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No campaigns on this date</p>
            </div>
          )}
        </div>

        {/* All campaigns summary */}
        {campaigns.length > 0 && (
          <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              All Campaigns
            </p>
            {campaigns.slice(0, 5).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  const ds = toLocalDateStr(c.created_at);
                  setSelectedDate(ds);
                  setCurrentMonth({ year: Number(ds.split("-")[0]), month: Number(ds.split("-")[1]) - 1 });
                }}
                className="flex w-full items-center gap-2 rounded text-left hover:bg-muted/40 px-1 py-0.5 transition-colors"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", pillColor(c.id).split(" ")[0])} />
                <span className="truncate text-xs">{c.name}</span>
              </button>
            ))}
            {campaigns.length > 5 && (
              <p className="text-[11px] text-muted-foreground pl-1">+{campaigns.length - 5} more</p>
            )}
          </div>
        )}

        {/* Create button */}
        <Button
          className="w-full gap-2 shrink-0"
          onClick={() => setNewCampaignOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Create New Campaign
        </Button>

        {/* Empty state (no campaigns at all) */}
        {!campaignsQ.isLoading && campaigns.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center">
            <Zap className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">No campaigns yet. Create your first one.</p>
          </div>
        )}
      </div>

      {/* New Campaign dialog */}
      <NewCampaignDialog
        open={newCampaignOpen}
        onClose={() => setNewCampaignOpen(false)}
        onCreate={(name, description) => createMut.mutate({ name, description })}
        isPending={createMut.isPending}
      />
    </div>
  );
}
