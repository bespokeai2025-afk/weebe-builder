import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings, Copy, CheckCheck, CheckCircle2, XCircle,
  RefreshCw, Loader2, Phone, Zap, ArrowRight, ChevronRight,
} from "lucide-react";
import { WatiIntegrationSettings } from "./WatiIntegrationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWASettings, saveWASettings, registerTwilioWebhook } from "@/lib/dashboard/whatsapp.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Provider = "twilio" | "wati";

export function WhatsAppSettings() {
  const qc = useQueryClient();
  const getSettingsFn     = useServerFn(getWASettings);
  const saveSettingsFn    = useServerFn(saveWASettings);
  const registerWebhookFn = useServerFn(registerTwilioWebhook);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-settings"],
    queryFn: () => getSettingsFn(),
  });

  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [form, setForm] = useState({
    twilio_account_sid: "",
    twilio_auth_token: "",
    whatsapp_phone_id: "",
  });
  const [copied, setCopied] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    registered: boolean;
    note: string;
  } | null>(null);

  useEffect(() => {
    if (data) {
      const d = data as any;
      setForm({
        twilio_account_sid: d.twilio_account_sid ?? "",
        twilio_auth_token:  d.twilio_auth_token  ?? "",
        whatsapp_phone_id:  d.whatsapp_phone_id  ?? "",
      });
      if (d.whatsapp_provider === "wati") {
        setSelectedProvider("wati");
      } else if (d.whatsapp_provider === "twilio" || d.twilio_account_sid) {
        setSelectedProvider("twilio");
      }
    }
  }, [data]);

  const webhookUrl = (data as any)?.webhookUrl ?? "";
  const hasAllCreds = !!(form.twilio_account_sid && form.twilio_auth_token && form.whatsapp_phone_id);

  const save = useMutation({
    mutationFn: () => saveSettingsFn({ data: { ...form, whatsapp_provider: "twilio" } }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
      qc.invalidateQueries({ queryKey: ["wa-provider-status"] });
      if (result?.webhookRegistered === true) {
        setWebhookStatus({ registered: true, note: result.webhookNote });
        toast.success("Settings saved — webhook registered automatically");
      } else if (result?.webhookRegistered === false && result?.webhookNote) {
        setWebhookStatus({ registered: false, note: result.webhookNote });
        toast.success("Settings saved");
      } else {
        toast.success("WhatsApp settings saved");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reRegister = useMutation({
    mutationFn: () => registerWebhookFn(),
    onSuccess: (result: any) => {
      if (result?.webhookRegistered === true) {
        setWebhookStatus({ registered: true, note: result.webhookNote });
        toast.success("Webhook registered on Twilio");
      } else {
        setWebhookStatus({ registered: false, note: result?.webhookNote ?? "Registration failed" });
        toast.error(result?.webhookNote ?? "Registration failed");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Step 1: Choose provider ───────────────────────────────── */}
      <div>
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
            Step 1
          </p>
          <h2 className="text-sm font-semibold">Choose your WhatsApp provider</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect one provider to start sending and receiving WhatsApp messages with your AI agents.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Twilio card */}
          <button
            onClick={() => setSelectedProvider("twilio")}
            className={cn(
              "relative rounded-xl border p-4 text-left transition-all hover:border-primary/50",
              selectedProvider === "twilio"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-muted/30"
            )}
          >
            {selectedProvider === "twilio" && (
              <span className="absolute top-2.5 right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                <CheckCheck className="h-2.5 w-2.5 text-primary-foreground" />
              </span>
            )}
            <div className="flex items-center gap-2.5 mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20">
                <Phone className="h-4 w-4 text-red-400" />
              </span>
              <span className="font-semibold text-sm">Twilio</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Use your own Twilio number. Full control over the number, messaging and webhook setup — all automated.
            </p>
          </button>

          {/* WATI card */}
          <button
            onClick={() => setSelectedProvider("wati")}
            className={cn(
              "relative rounded-xl border p-4 text-left transition-all hover:border-primary/50",
              selectedProvider === "wati"
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-muted/30"
            )}
          >
            {selectedProvider === "wati" && (
              <span className="absolute top-2.5 right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                <CheckCheck className="h-2.5 w-2.5 text-primary-foreground" />
              </span>
            )}
            <div className="flex items-center gap-2.5 mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 border border-green-500/20">
                <Zap className="h-4 w-4 text-green-500" />
              </span>
              <span className="font-semibold text-sm">WATI</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Connect your WATI account for managed WhatsApp Business API with built-in templates and contacts.
            </p>
          </button>
        </div>
      </div>

      {/* ── Step 2: Provider-specific setup ──────────────────────── */}
      {selectedProvider ? (
        <div>
          <div className="mb-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
              Step 2
            </p>
            <h2 className="text-sm font-semibold">
              {selectedProvider === "twilio" ? "Enter your Twilio credentials" : "Connect your WATI account"}
            </h2>
          </div>

          {/* ── Twilio setup ── */}
          {selectedProvider === "twilio" && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Twilio Credentials</CardTitle>
                  <CardDescription className="text-xs">
                    Find these in your{" "}
                    <a
                      href="https://console.twilio.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Twilio Console
                    </a>
                    . WeeBee will automatically register the inbound webhook when you save — no copy-paste needed.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Account SID</Label>
                    <Input
                      value={form.twilio_account_sid}
                      onChange={(e) => setForm({ ...form, twilio_account_sid: e.target.value })}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Auth Token</Label>
                    <Input
                      type="password"
                      value={form.twilio_auth_token}
                      onChange={(e) => setForm({ ...form, twilio_auth_token: e.target.value })}
                      placeholder="••••••••••••••••••••••••••••••••"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">WhatsApp Phone Number</Label>
                    <Input
                      value={form.whatsapp_phone_id}
                      onChange={(e) => setForm({ ...form, whatsapp_phone_id: e.target.value })}
                      placeholder="+14155238886"
                      className="font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Include the + and country code (e.g. +14155238886 for the Twilio sandbox).
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Webhook card */}
              {webhookUrl && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Settings className="h-4 w-4" /> Inbound Webhook
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Auto-registered on save. Copy for manual setup if needed.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={webhookUrl}
                        className="font-mono text-xs bg-muted/50"
                      />
                      <Button variant="outline" size="icon" onClick={copyWebhook} className="shrink-0">
                        {copied
                          ? <CheckCheck className="h-4 w-4 text-green-500" />
                          : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>

                    {webhookStatus && (
                      <div
                        className={cn(
                          "flex items-start gap-2 rounded-md border p-2.5",
                          webhookStatus.registered
                            ? "bg-green-500/10 border-green-500/20"
                            : "bg-amber-500/10 border-amber-500/20"
                        )}
                      >
                        {webhookStatus.registered
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                          : <XCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
                        <p className="text-xs text-muted-foreground leading-relaxed">{webhookStatus.note}</p>
                      </div>
                    )}

                    {hasAllCreds && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reRegister.mutate()}
                        disabled={reRegister.isPending}
                        className="gap-1.5"
                      >
                        {reRegister.isPending
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <RefreshCw className="h-3.5 w-3.5" />}
                        Re-register webhook on Twilio
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Status summary */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  <span>Connection status</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={hasAllCreds ? "default" : "secondary"}
                    className={cn(
                      "text-[10px]",
                      hasAllCreds && "bg-green-600 hover:bg-green-600 text-white"
                    )}
                  >
                    {hasAllCreds ? "Credentials entered" : "Not configured"}
                  </Badge>
                  {webhookStatus?.registered && (
                    <Badge className="text-[10px] bg-green-500/20 text-green-600 border border-green-500/30 hover:bg-green-500/20">
                      Webhook ✓
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={() => save.mutate()}
                  disabled={save.isPending || !hasAllCreds}
                  className="gap-2"
                >
                  {save.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving & registering webhook…
                    </>
                  ) : (
                    <>
                      Save & Register Webhook
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* ── WATI setup ── */}
          {selectedProvider === "wati" && (
            <WatiIntegrationSettings />
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 flex flex-col items-center justify-center py-12 text-center gap-2">
          <ChevronRight className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Select a provider above to begin setup</p>
          <p className="text-xs text-muted-foreground/70">Twilio or WATI — pick the one your team already uses</p>
        </div>
      )}
    </div>
  );
}
