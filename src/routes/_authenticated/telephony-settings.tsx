import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Settings, Check, AlertCircle, RefreshCw, ExternalLink, Phone, Zap, X, ShieldCheck, ShieldOff, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTelephonyConfig, saveTelephonyConfig, saveTelephonyCredentials, autoConfigureWebhooks } from "@/lib/telephony/telephony.functions";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/telephony-settings")({
  head: () => ({ meta: [{ title: "Telephony Settings — Webee" }] }),
  component: TelephonySettingsPage,
});

const PROVIDERS = [
  {
    id: "twilio",
    label: "Twilio",
    url: "https://console.twilio.com",
    description: "Industry-leading voice API with global coverage. Supports inbound/outbound calls, recordings, and real-time transcription.",
  },
  {
    id: "frejun",
    label: "FreJun Teler",
    url: "https://app.frejun.ai",
    description: "CPaaS with WebSocket audio streaming and Call Flow JSON system. Optimised for HyperStream (OpenAI Realtime) agents.",
  },
  {
    id: "telnyx",
    label: "Telnyx",
    url: "https://portal.telnyx.com",
    description: "Cost-effective carrier-grade SIP with low-latency global network. Coming soon.",
    disabled: true,
  },
  {
    id: "plivo",
    label: "Plivo",
    url: "https://console.plivo.com",
    description: "Reliable cloud telephony platform with competitive pricing. Coming soon.",
    disabled: true,
  },
  {
    id: "vonage",
    label: "Vonage (Nexmo)",
    url: "https://dashboard.nexmo.com",
    description: "Enterprise-grade communications API. Coming soon.",
    disabled: true,
  },
];

function TelephonySettingsPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getTelephonyConfig);
  const saveFn = useServerFn(saveTelephonyConfig);
  const saveCredsFn = useServerFn(saveTelephonyCredentials);
  const autoConfigFn = useServerFn(autoConfigureWebhooks);

  const { data: config, isFetching, refetch } = useQuery({
    queryKey: ["telephony-config"],
    queryFn: () => getFn({}),
    throwOnError: false,
  });

  const [provider, setProvider] = useState("twilio");
  const [isActive, setIsActive] = useState(true);
  const [saved, setSaved] = useState(false);
  const [credsSaved, setCredsSaved] = useState(false);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [autoResult, setAutoResult] = useState<Awaited<ReturnType<typeof autoConfigFn>> | null>(null);

  const autoConfigMut = useMutation({
    mutationFn: () => autoConfigFn({}),
    onSuccess: (data) => setAutoResult(data),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({ data: { provider: provider as any, is_active: isActive } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telephony-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const saveCredsMut = useMutation({
    mutationFn: () =>
      saveCredsFn({ data: { accountSid, authToken } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telephony-config"] });
      setCredsSaved(true);
      setAuthToken("");
      setTimeout(() => setCredsSaved(false), 2500);
    },
  });

  const credentialsReady = config?.credentials_ready ?? false;
  const credentialSource = config?.credential_source ?? "none";
  const workspaceSidOk = config?.workspace_sid_configured ?? false;
  const workspaceTokenOk = config?.workspace_token_configured ?? false;
  const envSidOk = config?.env_sid_configured ?? false;
  const envTokenOk = config?.env_token_configured ?? false;
  const frejunOk = config?.frejun_configured ?? false;
  const activeProvider = config?.provider ?? "twilio";

  useEffect(() => {
    if (config?.workspace_account_sid) {
      setAccountSid(config.workspace_account_sid);
    }
  }, [config?.workspace_account_sid]);

  const webhookHost =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-app.replit.app";

  const webhooks = [
    {
      label: "Inbound Call Webhook",
      url: `${webhookHost}/api/public/telephony/inbound`,
      note: "Set as the Voice webhook URL on your Twilio phone number.",
    },
    {
      label: "Call Status Callback",
      url: `${webhookHost}/api/public/telephony/status`,
      note: "Set as the Status Callback URL on your Twilio phone number.",
    },
    {
      label: "Recording Callback",
      url: `${webhookHost}/api/public/telephony/recording`,
      note: "Set on recordings configuration.",
    },
  ];

  const frejunWebhooks = [
    {
      label: "Call Flow URL",
      url: `${webhookHost}/api/public/frejun/flow`,
      note: "Set as the Incoming Call URL on your FreJun Voice App.",
    },
    {
      label: "Status Callback URL",
      url: `${webhookHost}/api/public/frejun/status`,
      note: "Set as the Status Callback on your FreJun Voice App.",
    },
  ];

  return (
    <div className="flex flex-col gap-8 p-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Telephony Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configure Twilio for live phone calls in this workspace. Workspace credentials take precedence over platform env vars.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Twilio Credentials */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          {credentialsReady
            ? <ShieldCheck className="h-4 w-4 text-emerald-400" />
            : <ShieldOff className="h-4 w-4 text-amber-400" />}
          <h2 className="text-sm font-semibold">Twilio Credentials</h2>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${credentialsReady ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
            {credentialsReady ? "Ready" : "Incomplete"}
          </span>
        </div>

        <p className="mb-4 text-xs text-muted-foreground leading-relaxed">
          Save your Twilio Account SID and Auth Token here for this workspace, or configure{" "}
          <code className="bg-black/20 rounded px-1">TWILIO_ACCOUNT_SID</code> /{" "}
          <code className="bg-black/20 rounded px-1">TWILIO_AUTH_TOKEN</code> in the server environment as a platform fallback.
          You can also manage these under{" "}
          <Link to="/settings/providers/telephony" className="underline">Settings → Providers → Telephony</Link>.
        </p>

        {credentialSource !== "none" && (
          <p className="mb-4 text-xs text-emerald-400">
            Active source: {credentialSource === "workspace" ? "workspace settings" : "platform environment variables"}
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Account SID</Label>
            <Input
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Auth Token</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={config?.workspace_auth_token_set ? "••••••••  (saved — enter to replace)" : "Your Twilio auth token"}
                className="font-mono text-xs pr-9"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => saveCredsMut.mutate()}
              disabled={saveCredsMut.isPending || !accountSid.trim() || !authToken.trim()}
            >
              {saveCredsMut.isPending ? "Saving…" : "Save credentials"}
            </Button>
            {credsSaved && (
              <span className="flex items-center gap-1 text-sm text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            {saveCredsMut.isError && (
              <span className="text-sm text-destructive">
                {String((saveCredsMut.error as any)?.message ?? "Failed to save")}
              </span>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Status</p>
          {[
            { label: "Workspace Account SID", ok: workspaceSidOk },
            { label: "Workspace Auth Token", ok: workspaceTokenOk },
            { label: "Env TWILIO_ACCOUNT_SID", ok: envSidOk },
            { label: "Env TWILIO_AUTH_TOKEN", ok: envTokenOk },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
              {ok
                ? <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />
                : <AlertCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
              <code className="flex-1 text-xs font-mono">{label}</code>
              <span className={`text-xs ${ok ? "text-emerald-400" : "text-muted-foreground"}`}>
                {ok ? "Configured" : "Not set"}
              </span>
            </div>
          ))}
        </div>

        {!credentialsReady && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              Add workspace credentials above or set <strong>TWILIO_ACCOUNT_SID</strong> and{" "}
              <strong>TWILIO_AUTH_TOKEN</strong> in your server environment before placing live calls.
            </span>
          </div>
        )}
      </div>

      {/* FreJun Credentials Status */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          {frejunOk
            ? <ShieldCheck className="h-4 w-4 text-emerald-400" />
            : <ShieldOff className="h-4 w-4 text-muted-foreground" />}
          <h2 className="text-sm font-semibold">FreJun Teler Credentials</h2>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${frejunOk ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
            {frejunOk ? "Ready" : "Not configured"}
          </span>
        </div>

        <p className="mb-4 text-xs text-muted-foreground leading-relaxed">
          Required when FreJun Teler is your active telephony provider. Set <code className="bg-black/20 rounded px-1">FREJUN_API_KEY</code> in Replit Secrets.
          Numbers must be purchased in the{" "}
          <a href="https://app.frejun.ai" target="_blank" rel="noreferrer" className="underline">FreJun dashboard</a>
          {" "}and entered here manually.
        </p>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
            {frejunOk
              ? <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />
              : <AlertCircle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
            <code className="flex-1 text-xs font-mono">FREJUN_API_KEY</code>
            <span className={`text-xs ${frejunOk ? "text-emerald-400" : "text-muted-foreground"}`}>
              {frejunOk ? "Configured" : "Not set"}
            </span>
          </div>
        </div>

        {activeProvider === "frejun" && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs font-medium text-muted-foreground">FreJun Webhook URLs — set these on your FreJun Voice App:</p>
            {frejunWebhooks.map(w => (
              <div key={w.label} className="rounded-lg bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">{w.label}</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded bg-black/20 px-2 py-1 text-xs font-mono text-foreground break-all">
                    {w.url}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(w.url)}
                    className="flex-shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{w.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Provider selector */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Phone className="h-4 w-4" /> Voice Provider
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              type="button"
              disabled={p.disabled}
              onClick={() => !p.disabled && setProvider(p.id)}
              className={`relative rounded-lg border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                provider === p.id && !p.disabled
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40"
              }`}
            >
              {provider === p.id && !p.disabled && (
                <Check className="absolute right-3 top-3 h-4 w-4 text-primary" />
              )}
              <p className="font-medium text-sm">{p.label}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">{p.description}</p>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <label className="flex cursor-pointer items-center gap-2">
            <div
              onClick={() => setIsActive(v => !v)}
              className={`relative h-5 w-9 rounded-full transition-colors ${isActive ? "bg-primary" : "bg-muted"}`}
            >
              <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${isActive ? "translate-x-4" : "translate-x-0.5"}`} />
            </div>
            <span className="text-sm">Provider active</span>
          </label>

          <div className="flex items-center gap-3">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="sm">
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
            {saved && (
              <span className="flex items-center gap-1 text-sm text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            {saveMut.isError && (
              <span className="flex items-center gap-1 text-sm text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {String((saveMut.error as any)?.message ?? "Failed")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Webhook URLs */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Webhook URLs</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These endpoints receive call events from Twilio. Use <strong>Auto-Configure</strong> to set them on every phone number automatically.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="flex-shrink-0 gap-1.5"
            onClick={() => { setAutoResult(null); autoConfigMut.mutate(); }}
            disabled={autoConfigMut.isPending || !credentialsReady}
          >
            <Zap className={`h-3.5 w-3.5 ${autoConfigMut.isPending ? "animate-pulse" : ""}`} />
            {autoConfigMut.isPending ? "Configuring…" : "Auto-Configure"}
          </Button>
        </div>

        {autoConfigMut.isError && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{String((autoConfigMut.error as any)?.message ?? "Failed to auto-configure")}</span>
          </div>
        )}

        {autoResult && (
          <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold">
                {autoResult.configured} of {autoResult.configured + autoResult.failed} number{autoResult.configured + autoResult.failed !== 1 ? "s" : ""} configured
              </p>
              <button onClick={() => setAutoResult(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {autoResult.results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {r.ok
                    ? <Check className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                    : <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
                  <span className="font-mono">{r.number}</span>
                  {r.error && <span className="text-muted-foreground">— {r.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {webhooks.map(w => (
            <div key={w.label} className="rounded-lg bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">{w.label}</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 rounded bg-black/20 px-2 py-1 text-xs font-mono text-foreground break-all">
                  {w.url}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(w.url)}
                  className="flex-shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Copy
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{w.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
