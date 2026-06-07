import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listCalendarBookings } from "@/lib/dashboard/bookings.functions";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar" }] }),
  component: CalendarPage,
});

type UnifiedBooking = {
  id: string;
  source: "calcom" | "local";
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  attendee_name: string | null;
  attendee_email: string | null;
  meeting_url: string | null;
};

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfMonth(anchor);
  const startWeekday = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function CalendarPage() {
  const fn = useServerFn(listCalendarBookings);
  const q = useQuery({
    queryKey: ["calendar-bookings"],
    queryFn: () => fn(),
  });
  const data = q.data;
  const bookings: UnifiedBooking[] = ((data?.bookings ?? []) as UnifiedBooking[]).filter(
    (b) => b.source === "calcom",
  );
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<Date>(() => new Date());
  const now = Date.now();
  const upcoming = bookings.filter(
    (b) => new Date(b.start_at).getTime() > now && b.status !== "cancelled",
  );
  const pending = bookings.filter((b) => b.status === "pending").length;
  const past = bookings.filter((b) => new Date(b.start_at).getTime() <= now);
  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
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
  const selectedKey = `${selected.getFullYear()}-${selected.getMonth()}-${selected.getDate()}`;
  const dayBookings = (byDay.get(selectedKey) ?? []).sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  const monthLabel = cursor.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar Manager</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.calcomConfigured ? "Live bookings from Cal.com" : "Bookings from your agents"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          <CalendarCheck className="mr-1.5 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {data?.calcomError && (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          Cal.com sync error: {data.calcomError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total bookings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{bookings.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-blue-500">{upcoming.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-500">{pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Past</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-500">{past.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{monthLabel}</h3>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const t = new Date();
                    setCursor(t);
                    setSelected(t);
                  }}
                >
                  Today
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))
                  }
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-white/[0.06] text-center text-[10px] uppercase tracking-wider text-muted-foreground">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="bg-card/80 py-1.5">
                  {d}
                </div>
              ))}
              {grid.map((d) => {
                const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
                const items = byDay.get(k) ?? [];
                const inMonth = d.getMonth() === cursor.getMonth();
                const isToday = sameDay(d, new Date());
                const isSelected = sameDay(d, selected);
                return (
                  <button
                    key={k}
                    onClick={() => setSelected(d)}
                    className={cn(
                      "relative flex h-20 flex-col items-start justify-start gap-1 bg-card/50 p-1.5 text-left transition-colors hover:bg-card",
                      !inMonth && "opacity-40",
                      isSelected && "ring-1 ring-inset ring-primary",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[11px] font-medium",
                        isToday && "rounded bg-primary px-1.5 text-primary-foreground",
                      )}
                    >
                      {d.getDate()}
                    </span>
                    <div className="flex w-full flex-col gap-0.5 overflow-hidden">
                      {items.slice(0, 2).map((b) => (
                        <div
                          key={b.id}
                          className={cn(
                            "truncate rounded px-1 py-[1px] text-[10px]",
                            b.status === "cancelled"
                              ? "bg-destructive/15 text-destructive line-through"
                              : b.status === "pending"
                                ? "bg-amber-500/15 text-amber-400"
                                : "bg-primary/20 text-primary",
                          )}
                        >
                          {new Date(b.start_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          · {b.title}
                        </div>
                      ))}
                      {items.length > 2 && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          +{items.length - 2} more
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">
              {selected.toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </h3>
            {dayBookings.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CalendarCheck className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium text-muted-foreground">No bookings</p>
                <p className="text-xs text-muted-foreground/70">Nothing scheduled for this day.</p>
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.05]">
                {dayBookings.map((b) => (
                  <li key={b.id} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{b.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(b.start_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {b.end_at &&
                            ` – ${new Date(b.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                        </p>
                        {(b.attendee_name || b.attendee_email) && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {b.attendee_name ?? b.attendee_email}
                          </p>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                          b.source === "calcom"
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {b.source === "calcom" ? "Cal.com" : "Manual"}
                      </span>
                    </div>
                    {b.meeting_url && (
                      <a
                        href={b.meeting_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Open meeting
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
