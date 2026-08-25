import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Copy, Loader2, PhoneForwarded, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

function rowsFromSettings(settings: WbahLiveTransferSettingsState["settings"]): WbahLiveTransferScheduleRow[] {
  return hydrateLiveTransferRows(settings.weekly_schedule);
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
    queryKey: ["wbah-live-transfer-settings"],
    queryFn: () => getSettingsFn() as Promise<WbahLiveTransferSettingsState>,
    enabled: canView,
    staleTime: 30_000,
    throwOnError: false,
  });

  const [rows, setRows] = useState<WbahLiveTransferScheduleRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const savedRows = useMemo(
    () => (settingsQ.data ? rowsFromSettings(settingsQ.data.settings) : null),
    [settingsQ.data],
  );

  useEffect(() => {
    if (settingsQ.data && rows == null) {
      setRows(rowsFromSettings(settingsQ.data.settings));
    }
  }, [settingsQ.data, rows]);

  const applyResponse = useCallback((next: WbahLiveTransferSettingsState) => {
    qc.setQueryData(["wbah-live-transfer-settings"], next);
    setRows(rowsFromSettings(next.settings));
  }, [qc]);

  const dirty = rows && savedRows ? !liveTransferRowsEqual(rows, savedRows) : false;

  function updateRow(weekday: number, patch: Partial<Pick<WbahLiveTransferScheduleRow, "open" | "start" | "end">>) {
    if (!canEdit) return;
    setRows((prev) =>
      prev?.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)) ?? prev,
    );
  }

  function applyWbahDefaultPreset() {
    if (!canEdit) return;
    setRows(hydrateLiveTransferRows(WBAH_LIVE_TRANSFER_DEFAULT_SCHEDULE));
  }

  function copyMondayToWeekdays() {
    if (!canEdit || !rows) return;
    const monday = rows.find((r) => r.weekday === 1);
    if (!monday?.open) {
      toast.error("Open Monday and set its hours first");
      return;
    }
    setRows(
      rows.map((row) =>
        row.weekday >= 2 && row.weekday <= 5
          ? { ...row, open: true, start: monday.start, end: monday.end }
          : row,
      ),
    );
  }

  async function handleSave() {
    if (!rows || !canEdit || saving || !settingsQ.data) return;
    const validationError = validateLiveTransferRows(rows);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const res = (await patchSettingsFn({
        data: {
          weekly_schedule: buildLiveTransferWeeklySchedule(rows),
          timezone: settingsQ.data.settings.timezone,
          fallback: "callback",
        },
      })) as WbahLiveTransferSettingsState;
      applyResponse(res);
      toast.success("Live transfer hours saved");
    } catch (e) {
      toast.error((e as Error).message || "Failed to save live transfer hours");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!canEdit || resetting) return;
    setResetting(true);
    try {
      const res = (await resetSettingsFn()) as WbahLiveTransferSettingsState;
      applyResponse(res);
      toast.success("Live transfer hours reset to server defaults");
    } catch (e) {
      toast.error((e as Error).message || "Failed to reset live transfer hours");
    } finally {
      setResetting(false);
    }
  }

  if (permsQ.isLoading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-card/50 p-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading permissions…
      </div>
    );
  }

  if (!canView) return null;

  const data = settingsQ.data;
  const busy = settingsQ.isLoading || saving || resetting;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/50 p-4">
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
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  data.live.allowed
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300",
                )}
              >
                Live transfer {data.live.allowed ? "OPEN" : "CLOSED"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground max-w-2xl">
            Each day can have different transfer hours. End time is exclusive (17:00 = transfers
            allowed until 16:59). Days toggled off are treated as closed. Outside these hours the AI
            offers a callback instead of transferring.
          </p>
          {data?.live.schedule_label && (
            <p className="mt-1 text-[11px] text-foreground/90">{data.live.schedule_label}</p>
          )}
          {data?.live.today_window && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Today: {data.live.today_window.start}–{data.live.today_window.end}
            </p>
          )}
          {data && !data.live.allowed && data.live.next_opens_at_label && (
            <p className="mt-1 text-[11px] text-amber-200/90">
              Next available: {data.live.next_opens_at_label}
            </p>
          )}
          {data && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              {data.source === "redis" ? "Using dashboard override" : "Using server env defaults"}
              {data.live.now_local ? ` · Local time now: ${data.live.now_local}` : ""}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={busy}
              onClick={() => void handleReset()}
            >
              {resetting ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
              )}
              Reset to server defaults
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </div>
        )}
      </div>

      {settingsQ.isError && (
        <p className="mt-3 text-[11px] text-destructive">
          {(settingsQ.error as Error)?.message || "Could not load live transfer hours"}
        </p>
      )}

      {settingsQ.isLoading && !rows && (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading settings…
        </div>
      )}

      {rows && data && (
        <div className="mt-4 space-y-3 rounded-lg border border-white/[0.06] bg-card/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-emerald-400" />
              Weekly schedule
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={busy}
                  onClick={copyMondayToWeekdays}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy Mon–Fri
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px]"
                  disabled={busy}
                  onClick={applyWbahDefaultPreset}
                >
                  WBAH default
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[11px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Day</th>
                  <th className="py-2 pr-3 font-medium w-16">Open</th>
                  <th className="py-2 pr-3 font-medium">Start</th>
                  <th className="py-2 font-medium">End</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.weekday} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">
                      {row.label}
                      <span className="ml-1 text-[10px] text-muted-foreground">({row.weekday})</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Switch
                        checked={row.open}
                        disabled={!canEdit || busy}
                        onCheckedChange={(open) => updateRow(row.weekday, { open: open === true })}
                        aria-label={`${row.label} open`}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      {row.open ? (
                        <Input
                          type="time"
                          className="h-8 w-[7.5rem] text-xs"
                          value={row.start}
                          disabled={!canEdit || busy}
                          onChange={(e) => updateRow(row.weekday, { start: e.target.value })}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2">
                      {row.open ? (
                        <Input
                          type="time"
                          className="h-8 w-[7.5rem] text-xs"
                          value={row.end}
                          disabled={!canEdit || busy}
                          onChange={(e) => updateRow(row.weekday, { end: e.target.value })}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">Timezone</Label>
              <Input
                className="mt-1 h-8 text-xs bg-muted/30"
                value={data.settings.timezone}
                readOnly
                disabled
              />
            </div>
            <div>
              <Label className="text-xs">Fallback behaviour</Label>
              <Input
                className="mt-1 h-8 text-xs bg-muted/30"
                value="Offer AI callback"
                readOnly
                disabled
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
