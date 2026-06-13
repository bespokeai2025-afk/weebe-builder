import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Copy, CheckCheck, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWASettings, saveWASettings } from "@/lib/dashboard/whatsapp.functions";
import { toast } from "sonner";

export function WhatsAppSettings() {
  const qc = useQueryClient();
  const getSettingsFn  = useServerFn(getWASettings);
  const saveSettingsFn = useServerFn(saveWASettings);

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
      toast.success("WhatsApp settings saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Webhook URL */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Settings className="h-4 w-4" /> Webhook URL
          </CardTitle>
          <CardDescription className="text-xs">
            Paste this URL into your Twilio WhatsApp Sandbox or Phone Number settings as the "When a message comes in" webhook.
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
          <div className="flex items-start gap-2 rounded-md bg-blue-500/10 border border-blue-500/20 p-2.5">
            <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Set this as the webhook in your{" "}
              <a
                href="https://console.twilio.com/us1/develop/phone-numbers/manage/active"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
              >
                Twilio Console <ExternalLink className="h-2.5 w-2.5" />
              </a>.
              HTTP method: <strong>POST</strong>.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Twilio credentials */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Twilio Credentials</CardTitle>
          <CardDescription className="text-xs">
            Find these in your{" "}
            <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Twilio Console
            </a>. Your auth token is stored encrypted.
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
                  Include the + and country code. For Twilio Sandbox, this is the sandbox number (e.g. +14155238886).
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Status */}
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
            <span className="text-xs text-muted-foreground">AI Runtime</span>
            <Badge variant="outline" className="text-[10px]">GPT-4o mini</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
