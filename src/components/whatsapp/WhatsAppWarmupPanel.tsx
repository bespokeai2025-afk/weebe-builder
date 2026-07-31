import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Flame, Loader2, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  WATI_WARMUP_SCHEDULE,
  formatWarmupScheduleDayRange,
} from "@/lib/whatsapp/wati-warmup.shared";
import {
  getWatiWarmupDashboard,
  updateWatiWarmupConfig,
  listWatiChannelPhonesFn,
} from "@/lib/whatsapp/wati.functions";

export function WhatsAppWarmupPanel() {
  const qc = useQueryClient();
  const dashFn = useServerFn(getWatiWarmupDashboard);
  const updateFn = useServerFn(updateWatiWarmupConfig);
  const phonesFn = useServerFn(listWatiChannelPhonesFn);

  const { data: dash, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["wati-warmup"],
    queryFn: () => dashFn(),
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const { data: phonesData } = useQuery({
    queryKey: ["wati-channel-phones"],
    queryFn: () => phonesFn(),
    throwOnError: false,
  });

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateFn>[0]["data"]) => updateFn({ data: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wati-warmup"] });
      toast.success("Warm-up settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !dash) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading warm-up status…
        </CardContent>
      </Card>
    );
  }

  const {
    config,
    warmupDay,
    dailyCap,
    sentToday,
    remaining,
    failedToday,
    schedule,
    channelStatuses = [],
    numberCount = 1,
    discoveredPhones = [],
  } = dash;
  const phones =
    discoveredPhones.length > 0 ? discoveredPhones : (phonesData?.phones ?? []);
  const activeSet = new Set(
    config.activeChannels?.length > 0 ? config.activeChannels : phones,
  );

  function toggleChannel(phone: string, enabled: boolean) {
    const base =
      config.activeChannels.length > 0 ? config.activeChannels : [...phones];
    const next = enabled
      ? [...new Set([...base, phone])]
      : base.filter((p) => p !== phone);
    if (next.length === 0) {
      toast.error("Keep at least one number enabled for outreach");
      return;
    }
    save.mutate({ activeChannels: next });
  }

  const pct = dailyCap > 0 ? Math.min(100, Math.round((sentToday / dailyCap) * 100)) : 0;

  return (
    <Card className="border-amber-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-amber-500" />
              WhatsApp number warm-up
            </CardTitle>
            <CardDescription className="mt-1 max-w-xl">
              Stepped ramp per WhatsApp number: 50/day (days 1–2), 100 (3–4), 200 (5–6), 500
              (7–8), then 1,000/day from day 9. Multiple numbers multiply capacity — 2 numbers on
              days 1–2 ≈ 100 sends total.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-white/10 bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Warm-up day</p>
            <p className="text-2xl font-semibold tabular-nums">{warmupDay}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Today&apos;s cap</p>
            <p className="text-2xl font-semibold tabular-nums">{dailyCap}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sent today</p>
            <p className="text-2xl font-semibold tabular-nums">{sentToday}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining</p>
            <p className="text-2xl font-semibold tabular-nums text-emerald-400">{remaining}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-muted/30 p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Numbers active</p>
            <p className="text-2xl font-semibold tabular-nums">{numberCount}</p>
          </div>
        </div>

        {phones.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs">WhatsApp numbers (WATI channels)</Label>
            <p className="text-[11px] text-muted-foreground">
              Enable each number you want to send from. Campaigns round-robin across enabled
              numbers, each with its own warm-up limit.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {phones.map((phone) => {
                const stat = channelStatuses.find((c) => c.phone === phone);
                const enabled = activeSet.has(phone);
                return (
                  <div
                    key={phone}
                    className={`rounded-lg border p-3 ${enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/10 bg-muted/20 opacity-70"}`}
                  >
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Checkbox
                        checked={enabled}
                        onCheckedChange={(v) => toggleChannel(phone, v === true)}
                      />
                      +{phone}
                    </label>
                    {stat && enabled && (
                      <p className="mt-2 text-[10px] text-muted-foreground tabular-nums">
                        Day {stat.warmupDay} · {stat.sentToday}/{stat.dailyCap} sent ·{" "}
                        <span className="text-emerald-400">{stat.remaining} left</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span>Daily usage (all numbers)</span>
            <span>
              {sentToday} / {dailyCap} ({pct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${pct >= 90 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {failedToday > 0 && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {failedToday} failed send(s) today — slow down if failures continue.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={config.enabled}
              onCheckedChange={(v) => save.mutate({ enabled: v === true })}
            />
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            Enforce daily warm-up cap on campaign launch
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={config.paused}
              onCheckedChange={(v) => save.mutate({ paused: v === true })}
            />
            Pause warm-up (no cap — use with care)
          </label>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Safe warm-up schedule</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WATI_WARMUP_SCHEDULE.map((step) => {
              const inTier =
                step.toDay == null
                  ? warmupDay >= step.fromDay
                  : warmupDay >= step.fromDay && warmupDay <= step.toDay;
              return (
                <div
                  key={`${step.fromDay}-${step.toDay ?? "plus"}`}
                  className={`rounded-lg border px-3 py-2 ${inTier ? "border-amber-500/40 bg-amber-500/10" : "border-white/10 bg-muted/20"}`}
                >
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {formatWarmupScheduleDayRange(step)}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">{step.cap}/day</p>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Day-by-day preview</p>
          <div className="flex flex-wrap gap-1.5">
            {schedule.map((row) => (
              <Badge
                key={row.day}
                variant={row.day === warmupDay ? "default" : "secondary"}
                className="tabular-nums text-[10px]"
              >
                D{row.day}: {row.cap}
              </Badge>
            ))}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ resetStartDate: true })}
        >
          Reset warm-up to day 1 (today)
        </Button>
      </CardContent>
    </Card>
  );
}
