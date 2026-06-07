import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Check, Loader2, LogOut, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import {
  getWorkspaceCalendarSettings,
  saveWorkspaceCalendarSettings,
  syncCalcomConnections,
  listCalendarConnections,
  listCalcomEventTypes,
  setCalendarFlags,
  setEventTypeActive,
  listMyBookings,
} from "@/lib/calendar/calendar.functions";

export const Route = createFileRoute("/_authenticated/settings/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar Connections — Webespoke AI" },
      {
        name: "description",
        content: "Connect Google Calendar through Cal.com for your voice agents.",
      },
    ],
  }),
  component: CalendarSettingsPage,
});

function CalendarSettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getSettings = useServerFn(getWorkspaceCalendarSettings);
  const saveSettings = useServerFn(saveWorkspaceCalendarSettings);
  const syncFn = useServerFn(syncCalcomConnections);
  const listCals = useServerFn(listCalendarConnections);
  const listEts = useServerFn(listCalcomEventTypes);
  const setFlags = useServerFn(setCalendarFlags);
  const setEtActive = useServerFn(setEventTypeActive);
  const getBookings = useServerFn(listMyBookings);

  const settingsQ = useQuery({ queryKey: ["wcs"], queryFn: () => getSettings() });
  const calsQ = useQuery({ queryKey: ["wcs-cals"], queryFn: () => listCals() });
  const etsQ = useQuery({ queryKey: ["wcs-ets"], queryFn: () => listEts() });
  const bookQ = useQuery({ queryKey: ["wcs-bookings"], queryFn: () => getBookings() });

  const [apiKey, setApiKey] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [defaultEt, setDefaultEt] = useState<string>("");
  const [buffer, setBuffer] = useState(0);
  const [minNotice, setMinNotice] = useState(2);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const s = settingsQ.data;
    if (!s) return;
    setApiKey(""); // never prefill the masked key
    setTimezone(s.timezone || "UTC");
    setDefaultEt(s.default_event_type_id ? String(s.default_event_type_id) : "");
    setBuffer(s.buffer_minutes ?? 0);
    setMinNotice(s.min_notice_hours ?? 2);
  }, [settingsQ.data]);

  async function handleSave() {
    setSaving(true);
    try {
      const result = await saveSettings({
        data: {
          ...(apiKey.trim() ? { calcomApiKey: apiKey.trim() } : {}),
          timezone,
          defaultEventTypeId: defaultEt ? Number(defaultEt) : null,
          bufferMinutes: Number(buffer) || 0,
          minNoticeHours: Number(minNotice) || 0,
        },
      });
      setApiKey("");
      toast.success("Calendar settings saved");
      if (result?.calcomWebhook) {
        const wh = result.calcomWebhook;
        if (wh.ok) {
          toast.success(
            wh.created ? "Cal.com webhook registered" : "Cal.com webhook already active",
            { description: wh.message },
          );
        } else {
          toast.warning("Cal.com webhook registration failed", { description: wh.message });
        }
      }
      qc.invalidateQueries({ queryKey: ["wcs"] });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await syncFn();
      toast.success("Synced from Cal.com", {
        description: `${r.calendars} calendars · ${r.eventTypes} event types`,
      });
      qc.invalidateQueries({ queryKey: ["wcs"] });
      qc.invalidateQueries({ queryKey: ["wcs-cals"] });
      qc.invalidateQueries({ queryKey: ["wcs-ets"] });
    } catch (e) {
      toast.error("Sync failed", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  const hasKey = Boolean(settingsQ.data?.calcom_api_key);

  return (
    <main className="min-h-screen bg-background flex flex-col">
      <header className="border-b shrink-0">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <Link
            to="/my-agents"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <Logo className="h-7" />
          </Link>
          <h1 className="text-sm font-medium hidden md:block">Calendar Connections</h1>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login", search: { redirect: "/settings/calendar" } });
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-8 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Calendar &amp; Bookings</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your Google Calendar through Cal.com. Your voice agents book through your
            backend — never directly into Google.
          </p>
        </div>

        {/* Cal.com workspace connection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Cal.com workspace connection
              {hasKey && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-green-700 dark:text-green-400">
                  <Check className="h-3 w-3" /> Connected
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Paste a Cal.com API key (Settings → Developer → API keys). To connect Google Calendar,
              link it from your Cal.com account first.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="apiKey">
                Cal.com API key{" "}
                {hasKey && (
                  <span className="text-xs text-muted-foreground">
                    (leave blank to keep current)
                  </span>
                )}
              </Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="cal_live_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="tz">Timezone</Label>
                <Input
                  id="tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Europe/London"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="buf">Buffer (min)</Label>
                <Input
                  id="buf"
                  type="number"
                  min={0}
                  value={buffer}
                  onChange={(e) => setBuffer(Number(e.target.value))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="not">Min notice (hours)</Label>
                <Input
                  id="not"
                  type="number"
                  min={0}
                  value={minNotice}
                  onChange={(e) => setMinNotice(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="def">Default event type ID</Label>
              <Input
                id="def"
                inputMode="numeric"
                placeholder="e.g. 12345"
                value={defaultEt}
                onChange={(e) => setDefaultEt(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-xs text-muted-foreground">
                Used when an agent doesn't have its own event type override. Sync first to see
                available IDs below.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" onClick={handleSync} disabled={syncing || !hasKey}>
                {syncing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Test &amp; Sync from Cal.com
              </Button>
              <Button asChild variant="ghost">
                <a
                  href="https://app.cal.com/apps/google-calendar"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Connect Google in Cal.com <ExternalLink className="h-3 w-3 ml-1" />
                </a>
              </Button>
            </div>
            {settingsQ.data?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Last synced {new Date(settingsQ.data.last_synced_at).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Connected calendars */}
        <Card>
          <CardHeader>
            <CardTitle>Connected calendars</CardTitle>
            <CardDescription>
              Pulled from Cal.com. Toggle which to read for availability and where to write
              bookings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {calsQ.isLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (calsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No calendars yet. Connect Google in Cal.com, then sync.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {(calsQ.data ?? []).map((c) => (
                  <div key={c.id} className="py-3 flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.email} · {c.provider}
                        {c.read_only ? " · read-only" : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <label className="flex items-center gap-2">
                        <Switch
                          checked={c.is_availability}
                          onCheckedChange={async (v) => {
                            await setFlags({ data: { id: c.id, isAvailability: v } });
                            qc.invalidateQueries({ queryKey: ["wcs-cals"] });
                          }}
                        />
                        Availability
                      </label>
                      <label className="flex items-center gap-2">
                        <Switch
                          checked={c.is_primary_booking}
                          disabled={c.read_only}
                          onCheckedChange={async (v) => {
                            await setFlags({ data: { id: c.id, isPrimaryBooking: v } });
                            qc.invalidateQueries({ queryKey: ["wcs-cals"] });
                          }}
                        />
                        Primary booking
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Event types */}
        <Card>
          <CardHeader>
            <CardTitle>Event types</CardTitle>
            <CardDescription>
              Synced from Cal.com. Disable any you don't want agents to book.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {etsQ.isLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (etsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No event types yet. Sync first.</p>
            ) : (
              <div className="divide-y divide-border">
                {(etsQ.data ?? []).map((et) => (
                  <div key={et.id} className="py-3 flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{et.title}</div>
                      <div className="text-xs text-muted-foreground">
                        ID {et.calcom_event_type_id} · {et.length_minutes} min
                        {et.slug ? ` · /${et.slug}` : ""}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDefaultEt(String(et.calcom_event_type_id));
                        toast.message("Set as default — remember to Save");
                      }}
                    >
                      Set default
                    </Button>
                    <Switch
                      checked={et.active}
                      onCheckedChange={async (v) => {
                        await setEtActive({ data: { id: et.id, active: v } });
                        qc.invalidateQueries({ queryKey: ["wcs-ets"] });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent bookings */}
        <Card>
          <CardHeader>
            <CardTitle>Recent bookings</CardTitle>
            <CardDescription>The last 20 bookings made by your voice agents.</CardDescription>
          </CardHeader>
          <CardContent>
            {bookQ.isLoading ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (bookQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No bookings yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {(bookQ.data ?? []).map((b) => (
                  <div key={b.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {b.attendee_name}{" "}
                        <span className="text-muted-foreground">· {b.attendee_email}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(b.start_at).toLocaleString()} →{" "}
                        {new Date(b.end_at).toLocaleTimeString()}
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded ${b.status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-green-500/10 text-green-700 dark:text-green-400"}`}
                    >
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Agent wiring instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Wire your voice agent</CardTitle>
            <CardDescription>
              Add these custom functions to your voice agent to enable booking via voice.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Endpoint base:{" "}
              <code className="px-1 py-0.5 rounded bg-muted">
                {typeof window !== "undefined" ? window.location.origin : ""}
                /api/public/retell
              </code>
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <code>POST /availability</code> — body{" "}
                <code>{`{ agent_id, start_date, end_date, timezone? }`}</code>
              </li>
              <li>
                <code>POST /book</code> — body{" "}
                <code>{`{ agent_id, start, name, email, phone?, notes?, timezone?, retell_call_id? }`}</code>
              </li>
              <li>
                <code>POST /cancel</code> — body <code>{`{ booking_id, reason? }`}</code>
              </li>
              <li>
                <code>POST /reschedule</code> — body <code>{`{ booking_id, new_start, reason? }`}</code>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Header <code>x-retell-signature</code>: HMAC-SHA256 hex of the raw body using the
              configured <code>RETELL_WEBHOOK_SECRET</code>. See{" "}
              <Link to="/settings/integrations" className="underline underline-offset-2">
                Integration Settings
              </Link>{" "}
              for setup.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
