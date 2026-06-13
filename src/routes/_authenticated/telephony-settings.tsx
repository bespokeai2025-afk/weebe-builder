import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Settings, Check, AlertCircle, RefreshCw, ExternalLink, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTelephonyConfig, saveTelephonyConfig } from "@/lib/telephony/telephony.functions";

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

  const { data: config, isFetching, refetch } = useQuery({
    queryKey: ["telephony-config"],
    queryFn: () => getFn({}),
  });

  const [provider, setProvider] = useState("twilio");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setProvider(config.provider ?? "twilio");
      setAccountSid(config.account_sid ?? "");
      setAuthToken(config.auth_token ?? "");
      setIsActive(config.is_active ?? true);
    }
  }, [config]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          provider: provider as any,
          account_sid: accountSid,
          auth_token: authToken || undefined,
          is_active: isActive,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telephony-config"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const webhookHost =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://your-app.replit.app";

  const webhooks = [
    {
      label: "Inbound Call Webhook",
      url: `${webhookHost}/api/public/telephony/inbound`,
      note: "Set this as the Voice webhook URL on your Twilio phone number.",
    },
    {
      label: "Call Status Callback",
      url: `${webhookHost}/api/public/telephony/status`,
      note: "Set this as the Status Callback URL on your Twilio phone number.",
    },
    {
      label: "Recording Callback",
      url: `${webhookHost}/api/public/telephony/recording`,
      note: "Set this on recordings configuration.",
    },
  ];

  return (
    <div className="flex flex-col gap-8 p-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Telephony Settings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configure your voice provider and webhook URLs.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

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
      </div>

      {provider === "twilio" && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <Settings className="h-4 w-4" /> Twilio Credentials
          </h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Account SID</label>
              <input
                value={accountSid}
                onChange={e => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Found in your{" "}
                <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary underline-offset-2 hover:underline">
                  Twilio Console <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Auth Token</label>
              <input
                type="password"
                value={authToken}
                onChange={e => setAuthToken(e.target.value)}
                placeholder={config?.auth_token ? "••••••••  (leave blank to keep existing)" : ""}
                className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Found next to your Account SID in the Twilio Console.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2">
                <div
                  onClick={() => setIsActive(v => !v)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${isActive ? "bg-primary" : "bg-muted"}`}
                >
                  <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${isActive ? "translate-x-4" : "translate-x-0.5"}`} />
                </div>
                <span className="text-sm">Provider active</span>
              </label>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !accountSid.trim()}>
                {saveMut.isPending ? "Saving…" : "Save Configuration"}
              </Button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                  <Check className="h-4 w-4" /> Saved
                </span>
              )}
              {saveMut.isError && (
                <span className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {String((saveMut.error as any)?.message ?? "Failed to save")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold">Webhook URLs</h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Configure these URLs in your Twilio phone number settings so Twilio can send call events to your platform.
        </p>
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
