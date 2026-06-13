import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, AlertCircle, Loader2, Unplug, Plug, RefreshCw,
  Users, FileText, Megaphone, ExternalLink, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  getWatiConnection,
  connectWati,
  disconnectWati,
  testWatiConnection,
  syncWatiTemplates,
  syncWatiCampaigns,
  syncWatiContacts,
  registerWatiWebhookFn,
} from "@/lib/whatsapp/wati.functions";

function relTime(iso: string | null | undefined) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function WatiIntegrationSettings() {
  const qc = useQueryClient();

  const getConnFn        = useServerFn(getWatiConnection);
  const connectFn        = useServerFn(connectWati);
  const disconnectFn     = useServerFn(disconnectWati);
  const testFn           = useServerFn(testWatiConnection);
  const syncTmplFn       = useServerFn(syncWatiTemplates);
  const syncCampFn       = useServerFn(syncWatiCampaigns);
  const syncContactsFn   = useServerFn(syncWatiContacts);
  const reRegisterWHFn   = useServerFn(registerWatiWebhookFn);

  const { data: conn, isLoading } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => getConnFn(),
    refetchInterval: 30000,
  });

  const isConnected = !!conn && conn.status === "connected";

  const [form, setForm] = useState({ apiKey: "", tenantId: "", webhookSecret: "" });
  const [showForm, setShowForm] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    registered: boolean;
    note: string;
    url?: string;
  } | null>(null);

  const connect = useMutation({
    mutationFn: () => connectFn({ data: { apiKey: form.apiKey, tenantId: form.tenantId, webhookSecret: form.webhookSecret || undefined } }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["wati-connection"] });
      setForm({ apiKey: "", tenantId: "", webhookSecret: "" });
      setShowForm(false);
      if (result?.webhookRegistered === true) {
        setWebhookStatus({ registered: true, note: result.webhookNote, url: result.webhookUrl });
        toast.success("WATI connected — webhook registered automatically");
      } else {
        setWebhookStatus({ registered: false, note: result?.webhookNote ?? "", url: result?.webhookUrl });
        toast.success("WATI connected");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reRegisterWH = useMutation({
    mutationFn: () => reRegisterWHFn(),
    onSuccess: (result: any) => {
      if (result?.webhookRegistered === true) {
        setWebhookStatus({ registered: true, note: result.webhookNote, url: result.webhookUrl });
        toast.success("Webhook re-registered in WATI");
      } else {
        setWebhookStatus({ registered: false, note: result?.webhookNote ?? "Registration failed", url: result?.webhookUrl });
        toast.error(result?.webhookNote ?? "Registration failed");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wati-connection"] });
      qc.invalidateQueries({ queryKey: ["wati-templates"] });
      qc.invalidateQueries({ queryKey: ["wati-campaigns"] });
      qc.invalidateQueries({ queryKey: ["wati-contacts"] });
      toast.success("WATI disconnected");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wati-connection"] });
      toast.success("WATI connection is healthy ✓");
    },
    onError: (e: any) => {
      qc.invalidateQueries({ queryKey: ["wati-connection"] });
      toast.error(e.message);
    },
  });

  const syncTemplates = useMutation({
    mutationFn: () => syncTmplFn(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["wati-connection"] });
      qc.invalidateQueries({ queryKey: ["wati-templates"] });
      toast.success(`Synced ${d.count} WATI templates`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncCampaigns = useMutation({
    mutationFn: () => syncCampFn(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["wati-connection"] });
      qc.invalidateQueries({ queryKey: ["wati-campaigns"] });
      toast.success(`Synced ${d.count} WATI campaigns`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncContacts = useMutation({
    mutationFn: () => syncContactsFn(),
    onSuccess: (d: any) => {
      qc.invalidateQueries({ queryKey: ["wati-connection"] });
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      toast.success(`Synced ${d.count} WATI contacts`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncing = syncTemplates.isPending || syncCampaigns.isPending || syncContacts.isPending;

  function syncAll() {
    syncTemplates.mutate();
    syncCampaigns.mutate();
    syncContacts.mutate();
  }

  return (
    <Card className="border-dashed border-purple-500/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-purple-500/15 text-purple-500 text-[10px] font-bold">W</span>
              WATI Integration
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-purple-500/30 text-purple-400">Optional</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Connect WATI to enable additional broadcast, template sync, and campaign management capabilities.
              Your existing Twilio/Meta setup is unaffected.{" "}
              <a
                href="https://wati.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                wati.io <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </CardDescription>
          </div>

          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
          ) : isConnected ? (
            <Badge className="bg-green-500/15 text-green-500 border-green-500/30 gap-1 shrink-0">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : conn?.status === "error" ? (
            <Badge variant="destructive" className="gap-1 shrink-0">
              <XCircle className="h-3 w-3" /> Error
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground gap-1 shrink-0">
              <AlertCircle className="h-3 w-3" /> Not connected
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isConnected && (
          <>
            {/* Status row */}
            <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Tenant ID</span>
                <span className="font-mono text-foreground">{conn.tenantId}</span>
              </div>
              {conn.lastTestedAt && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Last tested</span>
                  <span className="text-foreground">{relTime(conn.lastTestedAt)}</span>
                </div>
              )}
            </div>

            {/* Webhook registration status */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Inbound Webhook</p>
              {webhookStatus ? (
                <div
                  className={`flex items-start gap-2 rounded-md border p-2.5 ${
                    webhookStatus.registered
                      ? "bg-green-500/10 border-green-500/20"
                      : "bg-amber-500/10 border-amber-500/20"
                  }`}
                >
                  {webhookStatus.registered ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                  )}
                  <div className="space-y-1 min-w-0">
                    <p className="text-xs text-muted-foreground leading-relaxed">{webhookStatus.note}</p>
                    {webhookStatus.url && !webhookStatus.registered && (
                      <p className="text-[10px] font-mono text-muted-foreground break-all">{webhookStatus.url}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Click "Re-register Webhook" to auto-configure the inbound webhook in WATI.
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-8"
                disabled={reRegisterWH.isPending}
                onClick={() => reRegisterWH.mutate()}
              >
                {reRegisterWH.isPending
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <RefreshCw className="h-3 w-3" />}
                Re-register Webhook in WATI
              </Button>
            </div>

            {/* Sync status */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Data Sync</p>
              {(
                [
                  { key: "templates", label: "Templates", icon: FileText, mut: syncTemplates, queryKey: ["wati-templates"] },
                  { key: "campaigns", label: "Campaigns", icon: Megaphone, mut: syncCampaigns, queryKey: ["wati-campaigns"] },
                  { key: "contacts",  label: "Contacts",  icon: Users,     mut: syncContacts,  queryKey: ["wa-contacts"] },
                ] as const
              ).map(({ key, label, icon: Icon, mut }) => (
                <div key={key} className="flex items-center justify-between rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs">{label}</span>
                    {(conn.lastSync as any)?.[key] && (
                      <span className="text-[10px] text-muted-foreground">
                        synced {relTime((conn.lastSync as any)[key])}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px] gap-1"
                    disabled={mut.isPending}
                    onClick={() => mut.mutate()}
                  >
                    {mut.isPending
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <RefreshCw className="h-3 w-3" />}
                    Sync
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-8"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Test Connection
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-8"
                disabled={syncing}
                onClick={syncAll}
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync All
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive ml-auto"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                {disconnect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>

            {conn.errorMessage && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
                {conn.errorMessage}
              </div>
            )}
          </>
        )}

        {!isConnected && !isLoading && (
          <>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">What you get with WATI:</p>
              <ul className="space-y-1 ml-2">
                {["WATI Broadcasts & Campaign Sync", "Template Sync from WATI", "Contact Import from WATI", "WATI Campaign Statistics"].map((f) => (
                  <li key={f} className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> {f}
                  </li>
                ))}
              </ul>
            </div>

            <button
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showForm ? "Hide connection form" : "Connect WATI account"}
            </button>

            {showForm && (
              <div className="space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.01] p-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    placeholder="eyJhbGciOi…"
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-[11px] text-muted-foreground">Found in WATI Dashboard → Settings → API</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tenant ID</Label>
                  <Input
                    value={form.tenantId}
                    onChange={(e) => setForm({ ...form, tenantId: e.target.value })}
                    placeholder="your-tenant-id"
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-[11px] text-muted-foreground">The subdomain or tenant path used in your WATI API URL</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Webhook Secret <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    type="password"
                    value={form.webhookSecret}
                    onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                    placeholder="••••••••"
                    className="font-mono text-xs h-8"
                  />
                </div>
                <Button
                  size="sm"
                  className="w-full gap-1.5"
                  disabled={!form.apiKey || !form.tenantId || connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  {connect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                  Connect WATI
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
