import { useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Copy, Check,
  RefreshCw, Loader2, ChevronDown, ChevronRight, ExternalLink, Zap,
  Globe, Shield, Server, Webhook, ClipboardList, Download,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  getProductionReadinessData, runWebhookAutoUpdate, getWebhookUpdateLog,
  type WebhookEntry,
} from "@/lib/production/production-readiness.server";

export const Route = createFileRoute("/_authenticated/settings/production-readiness")({
  head: () => ({ meta: [{ title: "Production Readiness — Webee" }] }),
  component: ProductionReadinessPage,
});

// ── Copy button ────────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      className="ml-2 shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ── Health badge ───────────────────────────────────────────────────────────────
function HealthBadge({ route, base }: { route: string | null; base: string }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["health", route],
    queryFn: async () => {
      if (!route) return null;
      const r = await fetch(route);
      return r.ok ? await r.json() : { status: "error" };
    },
    enabled: !!route,
    retry: false,
    staleTime: 30_000,
    throwOnError: false,
  });

  if (!route) return <Badge variant="outline" className="text-[10px]">No health check</Badge>;
  if (isLoading) return <Badge variant="outline" className="text-[10px] gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" />Checking</Badge>;

  const ok = data?.status === "ok";
  return (
    <button onClick={() => refetch()} title="Click to recheck">
      <Badge
        variant="outline"
        className={cn(
          "text-[10px] gap-1 cursor-pointer transition-colors",
          ok ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10"
             : "border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/10",
        )}
      >
        {ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
        {ok ? "Live" : "Unreachable"}
      </Badge>
    </button>
  );
}

// ── Env var row ────────────────────────────────────────────────────────────────
function EnvRow({ k, present, required }: { k: string; present: boolean; required: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <code className="text-xs font-mono text-sky-300/80">{k}</code>
      <div className="flex items-center gap-2">
        {required && !present && (
          <span className="text-[10px] text-amber-400">Required</span>
        )}
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] gap-1",
            present
              ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
              : required
              ? "border-red-500/30 text-red-400 bg-red-500/5"
              : "border-white/10 text-muted-foreground",
          )}
        >
          {present ? <Check className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
          {present ? "Set" : "Missing"}
        </Badge>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
function ProductionReadinessPage() {
  const getDataFn   = useServerFn(getProductionReadinessData);
  const updateFn    = useServerFn(runWebhookAutoUpdate);
  const getLogFn    = useServerFn(getWebhookUpdateLog);
  const queryClient = useQueryClient();

  const [confirmOpen, setConfirmOpen]           = useState(false);
  const [pendingProviders, setPendingProviders]  = useState<string[]>([]);
  const [expandedLog, setExpandedLog]           = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["production-readiness"],
    queryFn: () => getDataFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const { data: updateLog } = useQuery({
    queryKey: ["webhook-update-log"],
    queryFn: () => getLogFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const updateMutation = useMutation({
    mutationFn: (providers: string[]) => updateFn({ data: { providers } }),
    onSuccess: (results) => {
      const success = results.filter(r => r.status === "success").length;
      const failed  = results.filter(r => r.status === "failed").length;
      const skipped = results.filter(r => r.status === "skipped").length;
      toast.success(`Webhook update complete: ${success} updated, ${skipped} already current, ${failed} failed`);
      queryClient.invalidateQueries({ queryKey: ["webhook-update-log"] });
    },
    onError: (err: any) => toast.error(`Update failed: ${err.message}`),
  });

  function askUpdate(providerIds: string[]) {
    setPendingProviders(providerIds);
    setConfirmOpen(true);
  }

  function confirmUpdate() {
    setConfirmOpen(false);
    updateMutation.mutate(pendingProviders);
  }

  function exportChecklist() {
    if (!data) return;
    const lines = [
      `# Webee Production Go-Live Checklist`,
      `Generated: ${new Date().toISOString()}`,
      `Production URL: ${data.productionUrl}`,
      ``,
      `## Environment Variables`,
      ...data.envStatus.map(e => `- [${e.present ? "x" : " "}] ${e.key}${e.required ? " (REQUIRED)" : ""}`),
      ``,
      `## Webhook URLs`,
      ...data.webhooks.map(w => `- ${w.label}\n  URL: ${w.fullUrl}\n  Health: ${w.healthRoute ? data.productionUrl + w.healthRoute : "none"}`),
      ``,
      `## Manual Steps`,
      `### Supabase`,
      `- [ ] Add Site URL: ${data.productionUrl}`,
      `- [ ] Add Redirect URL: ${data.productionUrl}/auth/callback`,
      `- [ ] Add Redirect URL: ${data.productionUrl}/login`,
      ``,
      `### DNS (webeebuilder.com)`,
      `- [ ] CNAME www → <your-replit-deployment-domain>`,
      `- [ ] Verify DNS propagation`,
      ``,
      `### Stripe`,
      `- [ ] Update webhook URL in Stripe Dashboard → Developers → Webhooks`,
      `  New URL: ${data.productionUrl}/api/public/payments/webhook`,
      ``,
      `### Meta WhatsApp`,
      `- [ ] Update Callback URL in Meta Business → WhatsApp → Configuration`,
      `  New URL: ${data.productionUrl}/api/public/whatsapp-webhook/{workspaceId}`,
      ``,
      `### FreJun`,
      `- [ ] Update Status webhook: ${data.productionUrl}/api/public/frejun/status`,
      `- [ ] Update Flow webhook: ${data.productionUrl}/api/public/frejun/flow`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "webee-production-checklist.md";
    a.click();
  }

  const autoUpdatable = (data?.webhooks ?? []).filter(w => w.canAutoUpdate);
  const missingRequired = (data?.envStatus ?? []).filter(e => e.required && !e.present);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-5">
      {/* Header */}
      <div className="mb-6">
        <Link to="/settings/integrations" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors">
          <ArrowLeft className="h-3 w-3" /> Back to Settings
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold tracking-tight flex items-center gap-2">
              <Server className="h-4 w-4 text-sky-400" />
              Production Readiness
            </h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Verify deployment config, update webhook URLs, and generate your go-live checklist.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={exportChecklist} disabled={!data} className="gap-1.5 text-xs">
            <Download className="h-3 w-3" /> Export Checklist
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : data ? (
        <div className="space-y-4">

          {/* Production URL Banner */}
          <Card className={cn(
            "border",
            data.isProduction
              ? "border-emerald-500/20 bg-emerald-500/5"
              : "border-amber-500/20 bg-amber-500/5",
          )}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Globe className={cn("h-5 w-5 shrink-0", data.isProduction ? "text-emerald-400" : "text-amber-400")} />
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {data.isProduction ? "Production domain detected" : "Dev/preview domain detected"}
                    </p>
                    <code className="text-sm font-mono text-foreground">{data.productionUrl}</code>
                  </div>
                </div>
                <CopyBtn text={data.productionUrl} />
              </div>
              {!data.isProduction && (
                <p className="mt-2 text-[11px] text-amber-400/80">
                  Set <code className="font-mono bg-amber-500/10 px-1 rounded">PUBLIC_BASE_URL=https://www.webeebuilder.com</code> in Replit Secrets to activate production mode.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Missing required env vars warning */}
          {missingRequired.length > 0 && (
            <Card className="border-red-500/20 bg-red-500/5">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-red-300">Missing required secrets</p>
                    <p className="text-[11px] text-red-400/70 mt-0.5">
                      {missingRequired.map(e => e.key).join(", ")} — add these in Replit Secrets before going live.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Deployment Config */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="h-4 w-4 text-sky-400" /> Deployment Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[
                { label: "Deployment Type",  value: "Autoscale (Replit)", note: "Reserved VM available for dedicated compute" },
                { label: "Build Command",    value: "npm run build",      note: "vite build" },
                { label: "Start Command",    value: "npm run start",      note: "srvx --static=../client --host 0.0.0.0 (use start:aws for 0.0.0.0)" },
                { label: "Port",             value: "5000 → 80",          note: "Replit proxies 5000 to external 80" },
                { label: "WebSocket / SSE",  value: "✓ Supported",        note: "srvx preserves WS upgrade + SSE streams" },
                { label: "Static Assets",    value: "dist/client",        note: "Served via srvx --static=../client" },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between gap-4 py-1 border-b border-white/[0.04] last:border-0">
                  <span className="text-muted-foreground w-36 shrink-0">{row.label}</span>
                  <code className="font-mono text-[11px] bg-white/[0.04] px-2 py-0.5 rounded">{row.value}</code>
                  <span className="text-[10px] text-muted-foreground/60 text-right min-w-0 truncate">{row.note}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Environment Variables */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-sky-400" /> Environment Variables
              </CardTitle>
              <CardDescription className="text-[11px]">
                Secrets checked server-side. Values are never exposed to the browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.envStatus.map(e => (
                <EnvRow key={e.key} k={e.key} present={e.present} required={e.required} />
              ))}
            </CardContent>
          </Card>

          {/* Webhook Endpoints Table */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Webhook className="h-4 w-4 text-sky-400" /> Webhook Endpoints
                  </CardTitle>
                  <CardDescription className="text-[11px] mt-1">
                    All production webhook URLs. Click <strong>Live</strong> badge to re-ping.
                  </CardDescription>
                </div>
                {autoUpdatable.length > 0 && (
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs shrink-0"
                    disabled={updateMutation.isPending}
                    onClick={() => askUpdate(autoUpdatable.map(w => w.id))}
                  >
                    {updateMutation.isPending
                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Updating…</>
                      : <><Zap className="h-3 w-3" /> Update Supported Webhooks</>
                    }
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.webhooks.map(w => (
                <div key={w.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">{w.label}</span>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">{w.provider}</Badge>
                      {w.perWorkspace && <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-sky-500/20 text-sky-400">per-workspace</Badge>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <HealthBadge route={w.healthRoute} base={data.productionUrl} />
                      {w.canAutoUpdate && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 px-2 text-[9px] gap-1"
                          disabled={updateMutation.isPending}
                          onClick={() => askUpdate([w.id])}
                        >
                          <Zap className="h-2.5 w-2.5" /> Update
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center min-w-0">
                    <code className="text-[11px] font-mono text-sky-300/80 truncate">{w.fullUrl}</code>
                    <CopyBtn text={w.fullUrl} />
                  </div>
                  {w.manualNote && (
                    <p className="mt-1.5 text-[10px] text-amber-400/70 flex items-start gap-1">
                      <AlertTriangle className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                      {w.manualNote}
                    </p>
                  )}
                  {w.canAutoUpdate && w.autoUpdateNote && (
                    <p className="mt-1.5 text-[10px] text-emerald-400/60">
                      Auto-update: {w.autoUpdateNote}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Manual Checklists */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-sky-400" /> Manual Steps Required
              </CardTitle>
              <CardDescription className="text-[11px]">
                These providers require manual dashboard updates. Never auto-update Stripe or Meta.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Accordion type="multiple" className="w-full">

                {/* Supabase */}
                <AccordionItem value="supabase" className="border-b border-white/[0.05] px-6">
                  <AccordionTrigger className="text-xs py-3 hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="text-emerald-400 font-semibold">Supabase</span>
                      — Auth redirect URLs
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 space-y-2 text-[11px]">
                    <p className="text-muted-foreground">Go to <strong>Supabase Dashboard → Authentication → URL Configuration</strong></p>
                    {[
                      { label: "Site URL", value: data.productionUrl },
                      { label: "Redirect URL", value: `${data.productionUrl}/auth/callback` },
                      { label: "Redirect URL", value: `${data.productionUrl}/login` },
                      { label: "Redirect URL", value: `${data.productionUrl}/signup` },
                    ].map((row, i) => (
                      <div key={i} className="flex items-center justify-between rounded bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5">
                        <span className="text-muted-foreground w-24 shrink-0">{row.label}</span>
                        <code className="font-mono text-sky-300/80 flex-1 mx-2">{row.value}</code>
                        <CopyBtn text={row.value} />
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>

                {/* DNS */}
                <AccordionItem value="dns" className="border-b border-white/[0.05] px-6">
                  <AccordionTrigger className="text-xs py-3 hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="text-sky-400 font-semibold">DNS</span>
                      — webeebuilder.com
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 space-y-2 text-[11px]">
                    <p className="text-muted-foreground">
                      In your DNS provider, point <code className="font-mono">www.webeebuilder.com</code> to your Replit deployment domain. Exact records are shown in <strong>Replit → Deploy → Custom Domain</strong>.
                    </p>
                    <div className="rounded bg-white/[0.03] border border-white/[0.06] p-3 space-y-1.5 font-mono text-[10px]">
                      <div><span className="text-muted-foreground">Type:</span> CNAME</div>
                      <div><span className="text-muted-foreground">Name:</span> www</div>
                      <div><span className="text-muted-foreground">Value:</span> &lt;shown in Replit Deploy settings&gt;</div>
                      <div className="mt-1 border-t border-white/[0.06] pt-1">
                        <span className="text-muted-foreground">Also add:</span> CNAME @ (apex) or A record if your registrar supports ALIAS
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                {/* Stripe */}
                <AccordionItem value="stripe" className="border-b border-white/[0.05] px-6">
                  <AccordionTrigger className="text-xs py-3 hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="text-violet-400 font-semibold">Stripe</span>
                      — Webhook endpoint
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 space-y-2 text-[11px]">
                    <p className="text-muted-foreground">
                      Go to <strong>Stripe Dashboard → Developers → Webhooks → Add endpoint</strong>
                    </p>
                    <div className="flex items-center rounded bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5">
                      <code className="font-mono text-sky-300/80 flex-1">{data.productionUrl}/api/public/payments/webhook</code>
                      <CopyBtn text={`${data.productionUrl}/api/public/payments/webhook`} />
                    </div>
                    <p className="text-amber-400/70">Copy the new <strong>Signing Secret</strong> and save it as <code className="font-mono">STRIPE_WEBHOOK_SECRET</code> in Replit Secrets.</p>
                  </AccordionContent>
                </AccordionItem>

                {/* Meta WhatsApp */}
                <AccordionItem value="meta" className="border-b border-white/[0.05] px-6">
                  <AccordionTrigger className="text-xs py-3 hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="text-green-400 font-semibold">Meta</span>
                      — WhatsApp Business webhook
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 space-y-2 text-[11px]">
                    <p className="text-muted-foreground">
                      Go to <strong>Meta for Developers → Your App → WhatsApp → Configuration</strong>
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                      <li>Set Callback URL to your workspace URL:</li>
                    </ol>
                    <div className="flex items-center rounded bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5">
                      <code className="font-mono text-sky-300/80 flex-1">{data.productionUrl}/api/public/whatsapp-webhook/<span className="text-amber-300">{"{workspaceId}"}</span></code>
                      <CopyBtn text={`${data.productionUrl}/api/public/whatsapp-webhook/{workspaceId}`} />
                    </div>
                    <p className="text-muted-foreground">2. Set <strong>Verify Token</strong> to your <code className="font-mono">META_WA_VERIFY_TOKEN</code> secret value.</p>
                    <p className="text-muted-foreground">3. Subscribe to: <code className="font-mono">messages, message_deliveries, messaging_postbacks</code></p>
                  </AccordionContent>
                </AccordionItem>

                {/* FreJun */}
                <AccordionItem value="frejun" className="px-6">
                  <AccordionTrigger className="text-xs py-3 hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="text-orange-400 font-semibold">FreJun</span>
                      — Teler webhooks
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3 space-y-2 text-[11px]">
                    <p className="text-muted-foreground">
                      Go to <strong>FreJun Account Settings → Webhooks</strong> and paste both URLs:
                    </p>
                    {[
                      { label: "Status callback", value: `${data.productionUrl}/api/public/frejun/status` },
                      { label: "Flow events",     value: `${data.productionUrl}/api/public/frejun/flow` },
                    ].map((row, i) => (
                      <div key={i} className="flex items-center rounded bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5">
                        <span className="text-muted-foreground w-28 shrink-0">{row.label}</span>
                        <code className="font-mono text-sky-300/80 flex-1 min-w-0 truncate">{row.value}</code>
                        <CopyBtn text={row.value} />
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>

              </Accordion>
            </CardContent>
          </Card>

          {/* Update Audit Log */}
          {updateLog && updateLog.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Webhook Update Log</CardTitle>
                  <button onClick={() => setExpandedLog(v => !v)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                    {expandedLog ? "Show less" : `Show all ${updateLog.length}`}
                    {expandedLog ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {(expandedLog ? updateLog : updateLog.slice(0, 5)).map((row: any) => (
                  <div key={row.id} className="flex items-center gap-3 text-[10px] rounded bg-white/[0.02] border border-white/[0.04] px-2.5 py-1.5">
                    <span className={cn(
                      "shrink-0 font-semibold",
                      row.status === "success" ? "text-emerald-400" : row.status === "skipped" ? "text-muted-foreground" : "text-red-400",
                    )}>
                      {row.status.toUpperCase()}
                    </span>
                    <span className="text-muted-foreground shrink-0">{row.provider}</span>
                    <code className="font-mono text-sky-300/70 truncate flex-1">{row.new_url}</code>
                    {row.error && <span className="text-red-400/70 truncate max-w-[200px]">{row.error}</span>}
                    <span className="text-muted-foreground/40 shrink-0">{new Date(row.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

        </div>
      ) : null}

      {/* Confirm update dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Webhook URLs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will call provider APIs to register{" "}
              <code className="font-mono text-sky-300">{data?.productionUrl}</code> as the webhook destination
              for <strong>{pendingProviders.length}</strong> provider{pendingProviders.length !== 1 ? "s" : ""}.
              Every change is logged to the audit table. This cannot be undone automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUpdate}>
              Yes, update webhooks
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
