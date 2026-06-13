import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Copy, CheckCheck, ExternalLink, CheckCircle2, XCircle, RefreshCw, Loader2 } from "lucide-react";
import { WatiIntegrationSettings } from "./WatiIntegrationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWASettings, saveWASettings, registerTwilioWebhook } from "@/lib/dashboard/whatsapp.functions";
import { toast } from "sonner";

export function WhatsAppSettings() {
  const qc = useQueryClient();
  const getSettingsFn      = useServerFn(getWASettings);
  const saveSettingsFn     = useServerFn(saveWASettings);
  const registerWebhookFn  = useServerFn(registerTwilioWebhook);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-settings"],
    queryFn: () => getSettingsFn(),
  });

  const [form, setForm] = useState({
    twilio_account_sid: "",
    twilio_auth_token: "",
    whatsapp_phone_id: "",
    whatsapp_provider: "twilio",
  });
  const [copied, setCopied] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    registered: boolean;
    note: string;
  } | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        twilio_account_sid: (data as any).twilio_account_sid ?? "",
        twilio_auth_token:  (data as any).twilio_auth_token  ?? "",
        whatsapp_phone_id:  (data as any).whatsapp_phone_id  ?? "",
        whatsapp_provider:  (data as any).whatsapp_provider  ?? "twilio",
      });
    }
  }, [data]);

  const webhookUrl = (data as any)?.webhookUrl ?? "Connect your workspace first";

  const save = useMutation({
    mutationFn: () => saveSettingsFn({ data: form }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
      if (result?.webhookRegistered === true) {
        setWebhookStatus({ registered: true, note: result.webhookNote });
        toast.success("Settings saved — webhook registered automatically on Twilio");
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

  const hasAllCreds = !!(form.twilio_account_sid && form.twilio_auth_token && form.whatsapp_phone_id);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Twilio credentials */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Twilio Credentials</CardTitle>
          <CardDescription className="text-xs">
            Find these in your{" "}
            <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Twilio Console
            </a>. When you save, WeeBee will automatically register the webhook on your phone number — no manual copy-paste needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
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
                  Include the + and country code. For Twilio Sandbox, use the sandbox number (e.g. +14155238886).
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Webhook status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Settings className="h-4 w-4" /> Webhook
          </CardTitle>
          <CardDescription className="text-xs">
            WeeBee registers this URL on your Twilio number automatically when you save. You can also copy it for manual setup.
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
              {copied ? <CheckCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          {/* Webhook registration result */}
          {webhookStatus && (
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
                <XCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              )}
              <p className="text-xs text-muted-foreground leading-relaxed">
                {webhookStatus.note}
              </p>
            </div>
          )}

          {!webhookStatus && hasAllCreds && (
            <p className="text-[11px] text-muted-foreground">
              Save your settings to auto-register the webhook on your Twilio number.
            </p>
          )}

          {/* Re-register button (shown after a failed attempt, or always when connected) */}
          {hasAllCreds && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => reRegister.mutate()}
              disabled={reRegister.isPending}
              className="gap-1.5"
            >
              {reRegister.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Re-register webhook on Twilio
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Connection Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Connection Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Provider</span>
            <Badge variant="outline" className="text-[10px]">Twilio</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Credentials</span>
            <Badge
              variant={form.twilio_account_sid && form.twilio_auth_token ? "default" : "secondary"}
              className="text-[10px]"
            >
              {form.twilio_account_sid && form.twilio_auth_token ? "Configured" : "Not configured"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Phone number</span>
            <Badge
              variant={form.whatsapp_phone_id ? "default" : "secondary"}
              className="text-[10px]"
            >
              {form.whatsapp_phone_id || "Not set"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Webhook</span>
            <Badge
              variant={webhookStatus?.registered ? "default" : "secondary"}
              className={`text-[10px] ${webhookStatus?.registered ? "bg-green-500/20 text-green-600 border-green-500/30" : ""}`}
            >
              {webhookStatus?.registered ? "Auto-registered" : "Manual setup needed"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">AI Runtime</span>
            <Badge variant="outline" className="text-[10px]">GPT-4o mini</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              Saving & registering webhook…
            </>
          ) : (
            "Save & Register Webhook"
          )}
        </Button>
      </div>

      {/* Optional integrations */}
      <div className="pt-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Optional Integrations</p>
        <WatiIntegrationSettings />
      </div>
    </div>
  );
}
