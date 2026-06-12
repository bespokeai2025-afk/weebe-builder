import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronDown, Plus, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import {
  listCalcomEventTypes,
  getWorkspaceCalendarSettings,
} from "@/lib/calendar/calendar.functions";

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

export function BookingConfigSection() {
  const { settings, setSettings } = useBuilderStore();
  const booking = settings.booking ?? {};
  const enabled = booking.enabled !== false;

  const listEventTypes = useServerFn(listCalcomEventTypes);
  const getSettings = useServerFn(getWorkspaceCalendarSettings);

  const settingsQ = useQuery({
    queryKey: ["wcs-settings"],
    queryFn: () => getSettings(),
    refetchOnWindowFocus: false,
  });
  const eventTypesQ = useQuery({
    queryKey: ["wcs-event-types"],
    queryFn: () => listEventTypes(),
    refetchOnWindowFocus: false,
  });

  const calConnected = Boolean(settingsQ.data?.calcom_api_key);
  const defaultEt = settingsQ.data?.default_event_type_id
    ? String(settingsQ.data.default_event_type_id)
    : "";
  const eventTypes = eventTypesQ.data ?? [];

  const updateBooking = (patch: Partial<NonNullable<typeof settings.booking>>) => {
    setSettings({ booking: { ...booking, ...patch } });
  };

  return (
    <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
      <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="h-3 w-3" />
          Booking & Calendar
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-2.5 pb-2.5">
        {!calConnected && (
          <div className="rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-1.5 text-[10px] text-amber-900 dark:text-amber-200">
            Cal.com not connected.{" "}
            <Link to="/settings/calendar" className="font-medium underline underline-offset-2">
              Connect in Settings → Calendar
            </Link>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <Label className="text-[10px] font-medium">Enable booking</Label>
            <p className="text-[10px] text-muted-foreground leading-tight">
              Auto-attach check_availability, book_appointment, cancel_appointment.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => updateBooking({ enabled: v })} />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] font-medium">Booking instructions</Label>
          <Textarea
            className="min-h-[72px] text-[10px] leading-relaxed"
            placeholder="e.g. Only offer slots Mon–Fri 9am–5pm. Confirm name and email before booking."
            value={booking.instructions ?? ""}
            onChange={(e) => updateBooking({ instructions: e.target.value })}
            disabled={!enabled}
          />
          <p className="text-[10px] text-muted-foreground">Appended to global prompt on deploy.</p>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] font-medium">Event type</Label>
          <Select
            value={booking.eventTypeId || ""}
            onValueChange={(v) => updateBooking({ eventTypeId: v === "__default__" ? "" : v })}
            disabled={!enabled || eventTypes.length === 0}
          >
            <SelectTrigger className="h-6 text-[10px]">
              <SelectValue
                placeholder={
                  eventTypes.length === 0
                    ? "No event types synced"
                    : defaultEt
                      ? `Workspace default (${defaultEt})`
                      : "Pick an event type"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">
                Workspace default{defaultEt ? ` (${defaultEt})` : ""}
              </SelectItem>
              {eventTypes.map((et) => (
                <SelectItem key={et.id} value={String(et.calcom_event_type_id)}>
                  {et.title} · {et.length_minutes}m
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] font-medium">Working hours</Label>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Per weekday, 24h HH:MM. Leave empty = closed.
          </p>
          <div className="space-y-0.5">
            {DAYS.map(({ key, label }) => {
              const ranges = booking.workingHours?.[key] ?? [];
              const setDay = (next: Array<[string, string]>) => {
                updateBooking({
                  workingHours: { ...(booking.workingHours ?? {}), [key]: next },
                });
              };
              return (
                <div key={key} className="flex items-start gap-1.5">
                  <div className="w-8 pt-1 text-[10px] font-medium text-muted-foreground shrink-0">
                    {label}
                  </div>
                  <div className="flex-1 space-y-0.5">
                    {ranges.length === 0 && (
                      <div className="text-[10px] italic text-muted-foreground py-0.5">Closed</div>
                    )}
                    {ranges.map((r, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input
                          type="time"
                          className="h-6 text-[10px] w-20"
                          value={r[0]}
                          disabled={!enabled}
                          onChange={(e) => {
                            const next = ranges.map((x, j) =>
                              j === i ? ([e.target.value, x[1]] as [string, string]) : x,
                            );
                            setDay(next);
                          }}
                        />
                        <span className="text-[10px] text-muted-foreground">–</span>
                        <Input
                          type="time"
                          className="h-6 text-[10px] w-20"
                          value={r[1]}
                          disabled={!enabled}
                          onChange={(e) => {
                            const next = ranges.map((x, j) =>
                              j === i ? ([x[0], e.target.value] as [string, string]) : x,
                            );
                            setDay(next);
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5"
                          disabled={!enabled}
                          onClick={() => setDay(ranges.filter((_, j) => j !== i))}
                          aria-label="Remove range"
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px]"
                      disabled={!enabled}
                      onClick={() => setDay([...ranges, ["09:00", "17:00"]])}
                    >
                      <Plus className="h-2.5 w-2.5 mr-0.5" /> Add range
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
