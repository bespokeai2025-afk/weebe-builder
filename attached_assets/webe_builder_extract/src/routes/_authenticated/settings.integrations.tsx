import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardSyncSettings,
  saveDashboardSyncSettings,
  testDashboardSync,
} from "@/lib/integrations/dashboard-sync.functions";

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — Webespoke AI" },
      {
        name: "description",
        content: "Push every published agent into your WE BE SMART DASH dashboard.",
      },
    ],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getDashboardSyncSettings);
  const saveFn = useServerFn(saveDashboardSyncSettings);
  const testFn = useServerFn(testDashboardSync);

  const settingsQ = useQuery({
    queryKey: ["dashboard-sync-settings"],
    queryFn: () => getFn(),
  });

  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    status: number;
    body: string;
  } | null>(null);

  useEffect(() => {
    const s = settingsQ.data;
    if (!s) return;
    setEndpoint(s.endpoint_url);
    setEnabled(s.sync_enabled);
  }, [settingsQ.data]);

  const hasToken = settingsQ.data?.has_token ?? false;
  const last4 = settingsQ.data?.api_token_last4;

  async function handleSave() {
    setSaving(true);
    try {
      const tokenChange = token.trim() ? { api_token: token.trim() } : {};
      await saveFn({
        data: {
          endpoint_url: endpoint.trim() || undefined,
          sync_enabled: enabled,
          ...tokenChange,
        },
      });
      toast.success("Saved");
      setToken("");
      qc.invalidateQueries({ queryKey: ["dashboard-sync-settings"] });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleClearToken() {
    setSaving(true);
    try {
      await saveFn({ data: { api_token: null } });
      toast.success("Token cleared");
      qc.invalidateQueries({ queryKey: ["dashboard-sync-settings"] });
    } catch (e) {
      toast.error("Clear failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testFn({
        data: {
          endpoint_url: endpoint.trim() || undefined,
          api_token: token.trim() || undefined,
        },
      });
      setTestResult(r);
      if (r.ok) toast.success(`Connection OK (${r.status})`);
      else toast.error(`Connection failed${r.status ? ` (${r.status})` : ""}`);
    } catch (e) {
      const message = (e as Error).message;
      setTestResult({ ok: false, status: 0, body: message });
      toast.error("Test failed", { description: message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/my-agents">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Integrations
            </h1>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>WE BE SMART DASH</CardTitle>
            <CardDescription>
              Automatically push every agent you create, update or redeploy
              into your WE BE SMART DASH dashboard. Sync is best-effort —
              failures never block a Retell publish.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="endpoint">Endpoint URL</Label>
              <Input
                id="endpoint"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://project--5ac2a13e-280d-409c-99e9-989a09464b56.lovable.app/api/public/agents/register"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the WE BE SMART DASH endpoint — it's wired automatically whenever sync is enabled.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="token">API Token</Label>
              <div className="flex gap-2">
                <Input
                  id="token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    hasToken
                      ? `•••••••• ${last4 ? `(last 4: ${last4})` : ""}`
                      : "Paste your WE BE SMART DASH workspace API token"
                  }
                />
                {hasToken && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleClearToken}
                    disabled={saving}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Generate this in WE BE SMART DASH → Settings → API Tokens. The token is
                stored encrypted and never shown again after saving.
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border border-white/10 p-3">
              <div>
                <p className="text-sm font-medium">Sync enabled</p>
                <p className="text-xs text-muted-foreground">
                  When on, agents are pushed to the dashboard on every save and
                  deploy.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!hasToken && !token.trim()}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
              <Button
                variant="secondary"
                onClick={handleTest}
                disabled={testing || (!hasToken && !token.trim())}
              >
                {testing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Test connection
              </Button>
            </div>

            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  testResult.ok
                    ? "border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                {testResult.ok ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <X className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {testResult.ok
                      ? `Success (${testResult.status})`
                      : `Failed${testResult.status ? ` (${testResult.status})` : ""}`}
                  </p>
                  {testResult.body && (
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs opacity-80">
                      {testResult.body}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {settingsQ.data?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Last sync:{" "}
                {new Date(settingsQ.data.last_synced_at).toLocaleString()} —{" "}
                {settingsQ.data.last_sync_status}
                {settingsQ.data.last_sync_error
                  ? ` · ${settingsQ.data.last_sync_error}`
                  : ""}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Retell Webhook Endpoints</CardTitle>
            <CardDescription>
              Paste these URLs into the matching custom-function nodes in your
              Retell agent. Every endpoint is signed with{" "}
              <code>x-retell-signature</code> using your{" "}
              <code>RETELL_WEBHOOK_SECRET</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Check availability", path: "/api/public/retell/availability" },
              { label: "Book appointment", path: "/api/public/retell/book" },
              { label: "Reschedule", path: "/api/public/retell/reschedule" },
              { label: "Cancel", path: "/api/public/retell/cancel" },
              { label: "Call analyzed (post-call)", path: "/api/public/retell/call-analyzed" },
            ].map((row) => {
              const url =
                (typeof window !== "undefined" ? window.location.origin : "") + row.path;
              return (
                <div key={row.path} className="space-y-1">
                  <Label className="text-xs">{row.label}</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={url} className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success("Copied");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
