import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, PhoneForwarded, RotateCcw, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getWbahLiveTransferSettings,
  patchWbahLiveTransferSettings,
  resetWbahLiveTransferSettings,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE,
  buildLiveTransferWeeklySchedule,
  hydrateLiveTransferRows,
  liveTransferRowsEqual,
  validateLiveTransferRows,
  type WbahLiveTransferScheduleRow,
  type WbahLiveTransferSettingsState,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";
import { getMyPermissions } from "@/lib/permissions/team-access.functions";
import { hasPageAccess, type RolePermissions } from "@/lib/permissions/permissions.shared";

const QUERY_KEY = ["wbah-live-transfer-settings"];
const WEEKDAY_FROM_SHORT: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Luxon-style weekday (1 = Mon … 7 = Sun) in the schedule's own timezone. */
function todayWeekday(timezone: string): number {
  try {
    const short = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(new Date());
    return WEEKDAY_FROM_SHORT[short] ?? 0;
  } catch {
    return 0;
  }
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Thin 24-hour track with the open window filled in. */
function DayTrack({ row, className }: { row: WbahLiveTransferScheduleRow; className?: string }) {
  const start = minutesOf(row.start);
  const end = minutesOf(row.end);
  const valid = row.open && end > start;
  return (
    <div className={cn("relative h-1.5 rounded-full bg-muted dark:bg-white/[0.06]", className)}>
      {valid && (
        <div
          className="absolute inset-y-0 rounded-full bg-emerald-500/70"
          style={{ left: `${(start / 1440) * 100}%`, width: `${((end - start) / 1440) * 100}%` }}
        />
      )}
    </div>
  );
}

export function WbahLiveTransferHoursPanel() {
  const qc = useQueryClient();
  const getSettingsFn = useServerFn(getWbahLiveTransferSettings);
  const patchSettingsFn = useServerFn(patchWbahLiveTransferSettings);
  const resetSettingsFn = useServerFn(resetWbahLiveTransferSettings);
  const myPermsFn = useServerFn(getMyPermissions);

  const permsQ = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => myPermsFn(),
    staleTime: 5 * 60_000,
    throwOnError: false,
  });
  const perms = permsQ.data as RolePermissions | undefined;
  const canView = perms ? hasPageAccess(perms, "campaigns", "view") : false;
  const canEdit = perms ? hasPageAccess(perms, "campaigns", "edit") : false;

  const settingsQ = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getSettingsFn() as Promise<WbahLiveTransferSettingsState>,
    enabled: canView,
    staleTime: 30_000,
    throwOnError: false,
  });

  const data = settingsQ.data;
  const savedRows = useMemo(
    () => (data ? hydrateLiveTransferRows(data.settings.weekly_schedule) : null),
    [data],
  );

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WbahLiveTransferScheduleRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  function openEditor() {
    if (!savedRows) return;
    setDraft(savedRows.map((r) => ({ ...r })));
    setOpen(true);
  }

  function updateRow(weekday: number, patch: Partial<Pick<WbahLiveTransferScheduleRow, "open" | "start" | "end">>) {
    setDraft((prev) => prev?.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)) ?? prev);
  }

  function copyMondayToWeekdays() {
    const monday = draft?.find((r) => r.weekday === 1);
    if (!draft || !monday?.open) {
      toast.error("Open Monday and set its hours first");
      return;
    }
    setDraft(
      draft.map((row) =>
        row.weekday >= 2 && row.weekday <= 5 ? { ...row, open: true, start: monday.start, end: monday.end } : row,
      ),
    );
  }

  const dirty = draft && savedRows ? !liveTransferRowsEqual(draft, savedRows) : false;
  const draftError = draft ? validateLiveTransferRows(draft) : null;

  async function handleSave() {
    if (!draft || !data || saving || draftError) return;
    setSaving(true);
    try {
      const res = (await patchSettingsFn({
        data: {
          weekly_schedule: buildLiveTransferWeeklySchedule(draft),
          timezone: data.settings.timezone,
          fallback: "callback",
        },
      })) as WbahLiveTransferSettingsState;
      qc.setQueryData(QUERY_KEY, res);
      toast.success("Live transfer hours saved");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "Failed to save live transfer hours");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    try {
      const res = (await resetSettingsFn()) as WbahLiveTransferSettingsState;
      qc.setQueryData(QUERY_KEY, res);
      setDraft(hydrateLiveTransferRows(res.settings.weekly_schedule));
      toast.success("Live transfer hours reset to server defaults");
    } catch (e) {
      toast.error((e as Error).message || "Failed to reset live transfer hours");
    } finally {
      setResetting(false);
    }
  }

  if (permsQ.isLoading) {
    return (
      <div className="rounded-xl border border-border dark:border-white/[0.06] bg-card/50 p-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading permissions…
      </div>
    );
  }
  if (!canView) return null;

  const today = data ? todayWeekday(data.settings.timezone) : 0;
  const busy = saving || resetting;

  return (
    <div className="rounded-xl border border-border dark:border-white/[0.06] bg-card/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <PhoneForwarded className="h-4 w-4 text-sky-400" />
              Live Transfer Hours
            </div>
            {data && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  data.live.allowed
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    data.live.allowed ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-amber-500",
                  )}
                />
                {data.live.allowed ? "Open now" : "Closed now"}
              </span>
            )}
            {data && (
              <span className="text-[10px] text-muted-foreground">
                {data.source === "redis" ? "Custom hours" : "Server default hours"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data?.live.today_window
              ? `Today ${data.live.today_window.start}–${data.live.today_window.end}`
              : data
                ? "No transfers today"
                : ""}
            {data && !data.live.allowed && data.live.next_opens_at_label
              ? ` · Next opens ${data.live.next_opens_at_label}`
              : ""}
            {data ? " · Outside these hours the AI offers a callback" : ""}
          </p>
        </div>
        {data && (
          <Button
            variant={canEdit ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={openEditor}
          >
            <Settings2 className="h-3.5 w-3.5 mr-1" />
            {canEdit ? "Edit hours" : "View hours"}
          </Button>
        )}
      </div>

      {settingsQ.isError && (
        <p className="mt-3 text-[11px] text-destructive">
          {(settingsQ.error as Error)?.message || "Could not load live transfer hours"}
        </p>
      )}

      {settingsQ.isLoading && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading hours…
        </div>
      )}

      {savedRows && (
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {savedRows.map((row) => {
            const isToday = row.weekday === today;
            return (
              <div
                key={row.weekday}
                className={cn(
                  "min-w-0 rounded-lg border px-1.5 py-1.5 text-center",
                  isToday
                    ? "border-sky-500/40 bg-sky-500/[0.06]"
                    : "border-border dark:border-white/[0.06] bg-card/40",
                )}
              >
                <div
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider",
                    isToday ? "text-sky-500 dark:text-sky-400" : "text-muted-foreground",
                  )}
                >
                  {row.label.slice(0, 3)}
                </div>
                <div
                  className={cn(
                    "mt-0.5 truncate text-[11px] tabular-nums",
                    row.open ? "text-foreground" : "text-muted-foreground/70",
                  )}
                >
                  {row.open ? (
                    <>
                      <span className="hidden sm:inline">{row.start}–{row.end}</span>
                      <span className="sm:hidden">{row.start.slice(0, 2)}–{row.end.slice(0, 2)}</span>
                    </>
                  ) : (
                    "Closed"
                  )}
                </div>
                <DayTrack row={row} className="mt-1.5" />
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneForwarded className="h-4 w-4 text-sky-400" />
              Live transfer hours
            </DialogTitle>
            <DialogDescription>
              When the AI can warm-transfer a caller to your team. Outside these hours it offers a
              callback instead. End times are exclusive (17:00 means until 16:59).
            </DialogDescription>
          </DialogHeader>

          {draft && (
            <div className="space-y-3">
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy} onClick={copyMondayToWeekdays}>
                    <Copy className="h-3 w-3 mr-1" />
                    Copy Monday to Tue–Fri
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() => setDraft(hydrateLiveTransferRows(WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE))}
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    WBAH default
                  </Button>
                </div>
              )}

              <div className="divide-y divide-border dark:divide-white/[0.06] rounded-lg border border-border dark:border-white/[0.06]">
                {draft.map((row) => {
                  const rowError = row.open && minutesOf(row.end) <= minutesOf(row.start);
                  return (
                    <div key={row.weekday} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                      <div className="flex w-32 items-center gap-2.5">
                        <Switch
                          checked={row.open}
                          disabled={!canEdit || busy}
                          onCheckedChange={(v) => updateRow(row.weekday, { open: v === true })}
                          aria-label={`${row.label} open`}
                        />
                        <span className={cn("text-sm", row.weekday === today && "font-semibold")}>
                          {row.label}
                        </span>
                      </div>
                      {row.open ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="time"
                            aria-label={`${row.label} start`}
                            className={cn("h-8 w-[6.75rem] text-xs tabular-nums", rowError && "border-destructive")}
                            value={row.start}
                            disabled={!canEdit || busy}
                            onChange={(e) => updateRow(row.weekday, { start: e.target.value })}
                          />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input
                            type="time"
                            aria-label={`${row.label} end`}
                            className={cn("h-8 w-[6.75rem] text-xs tabular-nums", rowError && "border-destructive")}
                            value={row.end}
                            disabled={!canEdit || busy}
                            onChange={(e) => updateRow(row.weekday, { end: e.target.value })}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Closed — no transfers</span>
                      )}
                      <DayTrack row={row} className="hidden sm:block min-w-[5rem] flex-1" />
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-muted-foreground">
                Timezone: {data?.settings.timezone} · Outside hours: AI offers a callback
              </p>
              {draftError && canEdit && <p className="text-[11px] text-destructive">{draftError}</p>}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {canEdit ? (
              <Button variant="ghost" size="sm" className="text-xs" disabled={busy} onClick={() => void handleReset()}>
                {resetting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                Reset to server defaults
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                {canEdit ? "Cancel" : "Close"}
              </Button>
              {canEdit && (
                <Button size="sm" disabled={busy || !dirty || !!draftError} onClick={() => void handleSave()}>
                  {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Save hours
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
