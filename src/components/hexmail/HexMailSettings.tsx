import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Zap,
  AlertCircle,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getHexmailSettings,
  saveHexmailSettings,
  testHexmailProvider,
  type HexmailProvider,
  type HexmailSettings,
} from "@/lib/hexmail/settings.functions";
import {
  getLeadAutoEmailSettings,
  saveLeadAutoEmailSettings,
} from "@/lib/lead-gen/lead-email.server";
import { listHexmailTemplates } from "@/lib/hexmail/templates.functions";

type TestState = "idle" | "testing" | "ok" | "error";

const PROVIDERS: {
  id: HexmailProvider;
  name: string;
  description: string;
  color: string;
  keyLabel: string;
  keyPlaceholder: string;
  docsUrl: string;
}[] = [
  {
    id: "resend",
    name: "Resend",
    description: "Modern email API built for developers. Simple, fast, reliable.",
    color: "text-black dark:text-white",
    keyLabel: "API Key",
    keyPlaceholder: "re_••••••••••••••••••••••••",
    docsUrl: "https://resend.com/api-keys",
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    description: "Twilio SendGrid — proven deliverability at scale.",
    color: "text-[#1a82e2]",
    keyLabel: "API Key",
    keyPlaceholder: "SG.••••••••••••••••••••••••••••••",
    docsUrl: "https://app.sendgrid.com/settings/api_keys",
  },
  {
    id: "postmark",
    name: "Postmark",
    description: "Fast, reliable transactional email with detailed delivery stats.",
    color: "text-[#ffde00] dark:text-yellow-400",
    keyLabel: "Server API Token",
    keyPlaceholder: "••••••••-••••-••••-••••-••••••••••••",
    docsUrl: "https://account.postmarkapp.com/servers",
  },
];

function ProviderLogo({ id }: { id: HexmailProvider }) {
  const logos: Record<HexmailProvider, string> = {
    resend:   "✉",
    sendgrid: "✉",
    postmark: "✉",
  };
  const colors: Record<HexmailProvider, string> = {
    resend:   "bg-black/10 dark:bg-white/10 text-foreground",
    sendgrid: "bg-[#1a82e2]/10 text-[#1a82e2]",
    postmark: "bg-yellow-400/10 text-yellow-600 dark:text-yellow-400",
  };
  return (
    <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center text-base font-bold", colors[id])}>
      {logos[id]}
    </div>
  );
}

interface ProviderFormState {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

function emptyForm(): ProviderFormState {
  return { apiKey: "", fromEmail: "", fromName: "" };
}

export function HexMailSettings() {
  const qc = useQueryClient();

  const { data: saved, isLoading } = useQuery({
    queryKey: ["hexmail-settings"],
    queryFn: () => getHexmailSettings(),
    throwOnError: false,
  });

  const [activeProvider, setActiveProvider] = useState<HexmailProvider | null>(null);
  const [sendgrid, setSendgrid]   = useState<ProviderFormState>(emptyForm());
  const [resend,   setResend]     = useState<ProviderFormState>(emptyForm());
  const [postmark, setPostmark]   = useState<{ apiKey: string; fromEmail: string; fromName: string }>(emptyForm());

  const [showKey, setShowKey] = useState<Record<HexmailProvider, boolean>>({
    sendgrid: false, resend: false, postmark: false,
  });
  const [testState, setTestState] = useState<Record<HexmailProvider, TestState>>({
    sendgrid: "idle", resend: "idle", postmark: "idle",
  });
  const [testMsg, setTestMsg] = useState<Record<HexmailProvider, string>>({
    sendgrid: "", resend: "", postmark: "",
  });

  useEffect(() => {
    if (!saved) return;
    setActiveProvider(saved.activeProvider);
    setSendgrid({
      apiKey:    saved.sendgrid.apiKey,
      fromEmail: saved.sendgrid.fromEmail,
      fromName:  saved.sendgrid.fromName,
    });
    setResend({
      apiKey:    saved.resend.apiKey,
      fromEmail: saved.resend.fromEmail,
      fromName:  saved.resend.fromName,
    });
    setPostmark({
      apiKey:    saved.postmark.serverToken,
      fromEmail: saved.postmark.fromEmail,
      fromName:  saved.postmark.fromName,
    });
  }, [saved]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveHexmailSettings({
        data: {
          activeProvider,
          sendgrid: { apiKey: sendgrid.apiKey, fromEmail: sendgrid.fromEmail, fromName: sendgrid.fromName },
          resend:   { apiKey: resend.apiKey,   fromEmail: resend.fromEmail,   fromName: resend.fromName },
          postmark: { serverToken: postmark.apiKey, fromEmail: postmark.fromEmail, fromName: postmark.fromName },
        },
      }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["hexmail-settings"] });
      qc.invalidateQueries({ queryKey: ["resend-webhook-status"] });
      if (result?.webhookRegistered) {
        toast.success("Settings saved — Resend webhook registered automatically");
      } else {
        toast.success("Settings saved");
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const handleTest = async (provider: HexmailProvider) => {
    const key =
      provider === "sendgrid" ? sendgrid.apiKey
      : provider === "resend"   ? resend.apiKey
      : postmark.apiKey;

    if (!key.trim()) {
      toast.error("Enter an API key first");
      return;
    }

    setTestState((p) => ({ ...p, [provider]: "testing" }));
    setTestMsg((p) => ({ ...p, [provider]: "" }));

    try {
      const result = await testHexmailProvider({ data: { provider, apiKey: key } });
      setTestState((p) => ({ ...p, [provider]: result.ok ? "ok" : "error" }));
      setTestMsg((p) => ({ ...p, [provider]: result.message }));
      if (result.ok) toast.success(`${provider} connection verified`);
      else toast.error(result.message);
    } catch (e: any) {
      setTestState((p) => ({ ...p, [provider]: "error" }));
      setTestMsg((p) => ({ ...p, [provider]: e?.message ?? "Error" }));
    }
  };

  const getForm = (id: HexmailProvider) =>
    id === "sendgrid" ? sendgrid : id === "resend" ? resend : postmark;
  const setForm = (id: HexmailProvider) =>
    id === "sendgrid" ? setSendgrid : id === "resend" ? setResend : setPostmark;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Active provider banner */}
      <div className="rounded-lg border bg-muted/30 p-4 flex items-center gap-3">
        <Zap className="h-5 w-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Active Email Provider</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeProvider
              ? `Campaigns will be sent via ${activeProvider.charAt(0).toUpperCase() + activeProvider.slice(1)}.`
              : "No provider is set as active — emails will not be sent until one is selected."}
          </p>
        </div>
        {activeProvider && (
          <Badge variant="default" className="capitalize shrink-0">
            {activeProvider}
          </Badge>
        )}
      </div>

      {/* Provider cards */}
      {PROVIDERS.map((p) => {
        const form = getForm(p.id);
        const ts = testState[p.id];
        const msg = testMsg[p.id];
        const isActive = activeProvider === p.id;
        const hasKey = !!form.apiKey.trim();

        return (
          <Card
            key={p.id}
            className={cn(
              "transition-all",
              isActive && "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.2),0_0_20px_-6px_hsl(var(--primary)/0.3)]",
            )}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ProviderLogo id={p.id} />
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      {isActive && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0">
                          Active
                        </Badge>
                      )}
                      {ts === "ok" && (
                        <span className="flex items-center gap-1 text-[11px] text-green-500">
                          <CheckCircle2 className="h-3 w-3" /> Connected
                        </span>
                      )}
                    </div>
                    <CardDescription className="text-xs mt-0.5">{p.description}</CardDescription>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {!isActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setActiveProvider(p.id)}
                    >
                      Set as Active
                    </Button>
                  )}
                  {isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => setActiveProvider(null)}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* API key */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{p.keyLabel}</Label>
                  <a
                    href={p.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-primary hover:underline"
                  >
                    Get API key →
                  </a>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey[p.id] ? "text" : "password"}
                      placeholder={p.keyPlaceholder}
                      value={form.apiKey}
                      onChange={(e) => setForm(p.id)((prev: any) => ({ ...prev, apiKey: e.target.value }))}
                      className="pr-9 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showKey[p.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 gap-1.5 text-xs min-w-[110px]"
                    disabled={!hasKey || ts === "testing"}
                    onClick={() => handleTest(p.id)}
                  >
                    {ts === "testing" ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Testing…</>
                    ) : ts === "ok" ? (
                      <><CheckCircle2 className="h-3 w-3 text-green-500" /> Verified</>
                    ) : ts === "error" ? (
                      <><XCircle className="h-3 w-3 text-destructive" /> Retry</>
                    ) : (
                      <><Zap className="h-3 w-3" /> Test Connection</>
                    )}
                  </Button>
                </div>
                {ts === "error" && msg && (
                  <p className="flex items-center gap-1.5 text-[11px] text-destructive">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {msg}
                  </p>
                )}
              </div>

              {/* From fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">From Email</Label>
                  <Input
                    type="email"
                    placeholder="hello@yourdomain.com"
                    value={form.fromEmail}
                    onChange={(e) => setForm(p.id)((prev: any) => ({ ...prev, fromEmail: e.target.value }))}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">From Name</Label>
                  <Input
                    placeholder="Your Company"
                    value={form.fromName}
                    onChange={(e) => setForm(p.id)((prev: any) => ({ ...prev, fromName: e.target.value }))}
                    className="text-xs"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="gap-2 min-w-[130px]"
        >
          {saveMut.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
          ) : (
            <><Save className="h-4 w-4" /> Save Settings</>
          )}
        </Button>
      </div>

      <LeadAutoEmailCard />
    </div>
  );
}

function LeadAutoEmailCard() {
  const qc = useQueryClient();
  const getSettingsFn = useServerFn(getLeadAutoEmailSettings);
  const saveSettingsFn = useServerFn(saveLeadAutoEmailSettings);
  const listTemplatesFn = useServerFn(listHexmailTemplates);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["lead-auto-email-settings"],
    queryFn: () => getSettingsFn(),
    throwOnError: false,
  });

  const templatesQ = useQuery({
    queryKey: ["hexmail-templates", "email"],
    queryFn: () => listTemplatesFn({ data: { type: "email" } }),
    throwOnError: false,
  });

  const [enabled, setEnabled] = useState(false);
  const [templateId, setTemplateId] = useState<string>("");

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setTemplateId(settings.templateId ?? "");
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (vars: { enabled: boolean; templateId: string | null }) =>
      saveSettingsFn({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-auto-email-settings"] });
      toast.success("Automation settings saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const templates = templatesQ.data ?? [];

  function handleToggle(next: boolean) {
    setEnabled(next);
    if (next && !templateId) {
      toast.error("Choose an email template below, then save.");
      return;
    }
    saveMut.mutate({ enabled: next, templateId: templateId || null });
  }

  function handleTemplateChange(id: string) {
    setTemplateId(id);
    if (enabled) saveMut.mutate({ enabled: true, templateId: id });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading automation settings…
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center bg-orange-500/10 text-orange-400">
            <Mail className="h-4.5 w-4.5" />
          </div>
          <div>
            <CardTitle className="text-base">Lead Auto-Email</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Automatically send an email template whenever a new lead selects "email" as their
              preferred contact method.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Enable automation</p>
            <p className="text-xs text-muted-foreground">
              Sends once per lead, using the active email provider above.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} disabled={saveMut.isPending} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Email template</Label>
          {templates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No email templates yet — create one in HexMail → Templates first.
            </p>
          ) : (
            <Select value={templateId} onValueChange={handleTemplateChange}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
