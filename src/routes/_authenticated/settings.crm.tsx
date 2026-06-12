import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, LogOut, Unplug, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import {
  getCrmSettings,
  saveCrmSettings,
  validateHubspotKey,
  validateGhlKey,
} from "@/lib/crm/crm-settings.functions";

export const Route = createFileRoute("/_authenticated/settings/crm")({
  head: () => ({
    meta: [
      { title: "CRM Integrations — Webee" },
      { name: "description", content: "Connect HubSpot or GoHighLevel to auto-sync call data." },
    ],
  }),
  component: CrmSettingsPage,
});

type ValidationState = "idle" | "validating" | "connected" | "error";

function ConnectedBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
      <Check className="h-3 w-3" /> Connected
    </span>
  );
}

function CrmSettingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getSettings = useServerFn(getCrmSettings);
  const saveSettings = useServerFn(saveCrmSettings);
  const validateHs = useServerFn(validateHubspotKey);
  const validateGhl = useServerFn(validateGhlKey);

  const settingsQ = useQuery({ queryKey: ["crm-settings"], queryFn: () => getSettings() });

  const [hsKey, setHsKey] = useState("");
  const [hsState, setHsState] = useState<ValidationState>("idle");
  const [hsSaving, setHsSaving] = useState(false);

  const [ghlKey, setGhlKey] = useState("");
  const [ghlLocationId, setGhlLocationId] = useState("");
  const [ghlState, setGhlState] = useState<ValidationState>("idle");
  const [ghlSaving, setGhlSaving] = useState(false);

  async function handleSaveHubspot() {
    const key = hsKey.trim();
    if (!key) return;
    setHsSaving(true);
    setHsState("validating");
    try {
      const { ok } = await validateHs({ data: { apiKey: key } });
      if (!ok) {
        setHsState("error");
        toast.error("HubSpot key validation failed", {
          description: "Check that the Private App token is correct and has CRM scopes.",
        });
        return;
      }
      await saveSettings({ data: { hubspot_api_key: key } });
      setHsState("connected");
      setHsKey("");
      toast.success("HubSpot connected");
      qc.invalidateQueries({ queryKey: ["crm-settings"] });
    } catch (e) {
      setHsState("error");
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setHsSaving(false);
    }
  }

  async function handleDisconnectHubspot() {
    setHsSaving(true);
    try {
      await saveSettings({ data: { hubspot_api_key: null } });
      setHsState("idle");
      setHsKey("");
      toast.success("HubSpot disconnected");
      qc.invalidateQueries({ queryKey: ["crm-settings"] });
    } catch (e) {
      toast.error("Failed to disconnect", { description: (e as Error).message });
    } finally {
      setHsSaving(false);
    }
  }

  async function handleSaveGhl() {
    const key = ghlKey.trim();
    const locId = ghlLocationId.trim();
    if (!key || !locId) {
      toast.error("Both API key and Location ID are required");
      return;
    }
    setGhlSaving(true);
    setGhlState("validating");
    try {
      const { ok } = await validateGhl({ data: { apiKey: key, locationId: locId } });
      if (!ok) {
        setGhlState("error");
        toast.error("GoHighLevel key validation failed", {
          description: "Check that your API key and Location ID are correct.",
        });
        return;
      }
      await saveSettings({ data: { ghl_api_key: key, ghl_location_id: locId } });
      setGhlState("connected");
      setGhlKey("");
      setGhlLocationId("");
      toast.success("GoHighLevel connected");
      qc.invalidateQueries({ queryKey: ["crm-settings"] });
    } catch (e) {
      setGhlState("error");
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setGhlSaving(false);
    }
  }

  async function handleDisconnectGhl() {
    setGhlSaving(true);
    try {
      await saveSettings({ data: { ghl_api_key: null, ghl_location_id: null } });
      setGhlState("idle");
      setGhlKey("");
      setGhlLocationId("");
      toast.success("GoHighLevel disconnected");
      qc.invalidateQueries({ queryKey: ["crm-settings"] });
    } catch (e) {
      toast.error("Failed to disconnect", { description: (e as Error).message });
    } finally {
      setGhlSaving(false);
    }
  }

  const isHsConnected = settingsQ.data?.hasHubspot && hsState !== "error";
  const isGhlConnected = settingsQ.data?.hasGhl && ghlState !== "error";

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
          <h1 className="text-sm font-medium hidden md:block">CRM Integrations</h1>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/login", search: { redirect: "/settings/crm" } });
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
          <h2 className="text-2xl font-semibold tracking-tight">CRM Integrations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            After every completed call, Webee automatically creates or updates a contact and logs a
            call note in your connected CRM — no manual export needed.
          </p>
        </div>

        {/* HubSpot */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-orange-500" />
              HubSpot
              {isHsConnected && <ConnectedBadge />}
              {hsState === "error" && (
                <span className="text-xs font-medium text-destructive">Invalid key</span>
              )}
            </CardTitle>
            <CardDescription>
              Paste a HubSpot Private App token with{" "}
              <strong>crm.objects.contacts</strong> and <strong>crm.objects.calls</strong> scopes.
              Find it under Settings → Integrations → Private Apps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isHsConnected ? (
              <div className="flex items-center gap-4">
                <p className="text-sm text-muted-foreground flex-1">
                  HubSpot is active. Every completed call will upsert a contact and log a call note.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={hsSaving}
                  onClick={handleDisconnectHubspot}
                  className="gap-1 text-destructive hover:text-destructive"
                >
                  {hsSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Unplug className="h-4 w-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2">
                  <Label htmlFor="hs-key">
                    Private App token{" "}
                    {settingsQ.data?.hasHubspot && (
                      <span className="text-xs text-muted-foreground">(leave blank to keep current)</span>
                    )}
                  </Label>
                  <Input
                    id="hs-key"
                    type="password"
                    placeholder="pat-na1-..."
                    value={hsKey}
                    onChange={(e) => {
                      setHsKey(e.target.value);
                      setHsState("idle");
                    }}
                  />
                </div>
                <Button onClick={handleSaveHubspot} disabled={hsSaving || !hsKey.trim()}>
                  {hsState === "validating" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Validating…
                    </>
                  ) : (
                    "Connect HubSpot"
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* GoHighLevel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-500" />
              GoHighLevel
              {isGhlConnected && <ConnectedBadge />}
              {ghlState === "error" && (
                <span className="text-xs font-medium text-destructive">Invalid key</span>
              )}
            </CardTitle>
            <CardDescription>
              Paste your GoHighLevel Agency or Location API key and the Location ID you want contacts
              synced into. Find both under Settings → Business Info / API Keys.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isGhlConnected ? (
              <div className="flex items-center gap-4">
                <p className="text-sm text-muted-foreground flex-1">
                  GoHighLevel is active. Location:{" "}
                  <code className="text-xs bg-muted px-1 rounded">
                    {settingsQ.data?.ghl_location_id ?? "—"}
                  </code>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ghlSaving}
                  onClick={handleDisconnectGhl}
                  className="gap-1 text-destructive hover:text-destructive"
                >
                  {ghlSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Unplug className="h-4 w-4" />
                  )}
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="ghl-key">API key</Label>
                    <Input
                      id="ghl-key"
                      type="password"
                      placeholder="eyJhbGciOiJIUzI1NiJ9..."
                      value={ghlKey}
                      onChange={(e) => {
                        setGhlKey(e.target.value);
                        setGhlState("idle");
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ghl-loc">Location ID</Label>
                    <Input
                      id="ghl-loc"
                      placeholder="ve9EPM428h8vShlRW1KT"
                      value={ghlLocationId}
                      onChange={(e) => {
                        setGhlLocationId(e.target.value);
                        setGhlState("idle");
                      }}
                    />
                  </div>
                </div>
                <Button
                  onClick={handleSaveGhl}
                  disabled={ghlSaving || !ghlKey.trim() || !ghlLocationId.trim()}
                >
                  {ghlState === "validating" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Validating…
                    </>
                  ) : (
                    "Connect GoHighLevel"
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Need calendar bookings?{" "}
          <Link to="/settings/calendar" className="underline underline-offset-2">
            Calendar settings
          </Link>
        </p>
      </div>
    </main>
  );
}
