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

/**
 * Per-agent booking & calendar config. Lives next to the other right-panel
 * sections in the builder. Writes to settings.booking on the BuilderSettings
 * store; the deploy server fn reads it to decide whether to attach booking
 * tools, which event type to use, and whether to append booking instructions
 * to the global prompt.
 */
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
    <Collapsible className="rounded-lg border" defaultOpen>
      <CollapsibleTrigger className="flex w-full items-center justify-between p-2 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          Booking & Calendar
        </span>
        <ChevronDown className="h-4 w-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-2 pb-3">
        {!calConnected && (
          <div className="rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-2 text-[11px] text-amber-900 dark:text-amber-200">
            Cal.com is not connected.{" "}
            <Link to="/settings/calendar" className="font-medium underline underline-offset-2">
              Connect it in Settings → Calendar
            </Link>{" "}
            to enable booking tools. Your agent will still deploy without them.
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="space-y-0.5">
            <Label className="text-xs font-medium">Enable booking on this agent</Label>
            <p className="text-[11px] text-muted-foreground">
              Auto-attach check_availability, book_appointment, cancel_appointment.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => updateBooking({ enabled: v })} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium">Booking instructions (prompt)</Label>
          <Textarea
            className="min-h-[120px] text-xs"
            placeholder={
              "e.g. Only offer slots Mon–Fri between 9am and 5pm London time. " +
              "Always confirm the caller's full name and email before calling book_appointment. " +
              "If no slots are available in the next 7 days, ask if they want a callback."
            }
            value={booking.instructions ?? ""}
            onChange={(e) => updateBooking({ instructions: e.target.value })}
            disabled={!enabled}
          />
          <p className="text-[11px] text-muted-foreground">
            Appended to the agent's global prompt on deploy.
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium">Event type</Label>
          <Select
            value={booking.eventTypeId || ""}
            onValueChange={(v) => updateBooking({ eventTypeId: v === "__default__" ? "" : v })}
            disabled={!enabled || eventTypes.length === 0}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue
                placeholder={
                  eventTypes.length === 0
                    ? "No event types synced yet"
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
          <p className="text-[11px] text-muted-foreground">
            Override which Cal.com event type this agent books into.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Working hours (per weekday)</Label>
          <p className="text-[11px] text-muted-foreground">
            Overrides the workspace default for this agent. Use 24-hour HH:MM (caller's local time).
            Leave a day empty to mark it closed.
          </p>
          <div className="space-y-1.5">
            {DAYS.map(({ key, label }) => {
              const ranges = booking.workingHours?.[key] ?? [];
              const setDay = (next: Array<[string, string]>) => {
                updateBooking({
                  workingHours: { ...(booking.workingHours ?? {}), [key]: next },
                });
              };
              return (
                <div key={key} className="flex items-start gap-2">
                  <div className="w-9 pt-1.5 text-[11px] font-medium text-muted-foreground">
                    {label}
                  </div>
                  <div className="flex-1 space-y-1">
                    {ranges.length === 0 && (
                      <div className="text-[11px] italic text-muted-foreground py-1">Closed</div>
                    )}
                    {ranges.map((r, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input
                          type="time"
                          className="h-7 text-xs w-24"
                          value={r[0]}
                          disabled={!enabled}
                          onChange={(e) => {
                            const next = ranges.map((x, j) =>
                              j === i ? ([e.target.value, x[1]] as [string, string]) : x,
                            );
                            setDay(next);
                          }}
                        />
                        <span className="text-[11px] text-muted-foreground">–</span>
                        <Input
                          type="time"
                          className="h-7 text-xs w-24"
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
                          className="h-6 w-6"
                          disabled={!enabled}
                          onClick={() => setDay(ranges.filter((_, j) => j !== i))}
                          aria-label="Remove range"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      disabled={!enabled}
                      onClick={() => setDay([...ranges, ["09:00", "17:00"]])}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add range
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
