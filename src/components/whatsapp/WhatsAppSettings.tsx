import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings, Copy, CheckCheck, CheckCircle2, XCircle,
  RefreshCw, Loader2, Phone, Zap, ArrowRight, ChevronRight,
  Globe, ExternalLink, Eye, EyeOff, ShoppingCart, Search,
} from "lucide-react";
import { WatiIntegrationSettings } from "./WatiIntegrationSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getWASettings,
  saveWASettings,
  registerTwilioWebhook,
  saveMetaSettings,
  searchTwilioNumbers,
  purchaseTwilioNumber,
} from "@/lib/dashboard/whatsapp.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Provider = "twilio" | "wati" | "meta";

export function WhatsAppSettings() {
  const qc = useQueryClient();
  const getSettingsFn     = useServerFn(getWASettings);
  const saveSettingsFn    = useServerFn(saveWASettings);
  const registerWebhookFn = useServerFn(registerTwilioWebhook);
  const saveMetaFn        = useServerFn(saveMetaSettings);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-settings"],
    queryFn: () => getSettingsFn(),
  });

  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  // Twilio form state
  const [twilioForm, setTwilioForm] = useState({
    twilio_account_sid: "",
    twilio_auth_token: "",
    whatsapp_phone_id: "",
  });
  const [webhookStatus, setWebhookStatus] = useState<{ registered: boolean; note: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Buy-a-number panel state ──────────────────────────────────
  const searchNumbersFn  = useServerFn(searchTwilioNumbers);
  const purchaseNumberFn = useServerFn(purchaseTwilioNumber);
  const [showBuyPanel, setShowBuyPanel] = useState(false);
  const [buyCountry,   setBuyCountry]   = useState("US");
  const [buyAreaCode,  setBuyAreaCode]  = useState("");
  type TwilioNum = { phoneNumber: string; friendlyName: string; locality: string; region: string; sms: boolean; mms: boolean; voice: boolean };
  const [buyResults,   setBuyResults]   = useState<TwilioNum[]>([]);
  const [buySearched,  setBuySearched]  = useState(false);
  const [purchasing,   setPurchasing]   = useState<string | null>(null);

  const searchNumbers = useMutation({
    mutationFn: () =>
      searchNumbersFn({
        data: {
          accountSid:  twilioForm.twilio_account_sid,
          authToken:   twilioForm.twilio_auth_token,
          countryCode: buyCountry,
          areaCode:    buyAreaCode.trim() || undefined,
        },
      }),
    onSuccess: (results) => {
      setBuyResults(results as TwilioNum[]);
      setBuySearched(true);
    },
    onError: (e: any) => toast.error(`Search failed: ${e.message}`),
  });

  const buyNumber = useMutation({
    mutationFn: (phoneNumber: string) => {
      setPurchasing(phoneNumber);
      return purchaseNumberFn({
        data: {
          accountSid:  twilioForm.twilio_account_sid,
          authToken:   twilioForm.twilio_auth_token,
          phoneNumber,
        },
      });
    },
    onSuccess: (result: any) => {
      setTwilioForm((prev) => ({ ...prev, whatsapp_phone_id: result.phoneNumber }));
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
      setShowBuyPanel(false);
      setBuyResults([]);
      setBuySearched(false);
      setPurchasing(null);
      toast.success(`${result.phoneNumber} purchased — auto-filled below.`);
    },
    onError: (e: any) => {
      setPurchasing(null);
      toast.error(`Purchase failed: ${e.message}`);
    },
  });

  // Meta form state
  const [metaForm, setMetaForm] = useState({
    meta_phone_number_id: "",
    meta_waba_id: "",
    meta_access_token: "",
  });
  const [metaVerifyToken, setMetaVerifyToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const d = data as any;
    setTwilioForm({
      twilio_account_sid: d.twilio_account_sid ?? "",
      twilio_auth_token:  d.twilio_auth_token  ?? "",
      whatsapp_phone_id:  d.whatsapp_phone_id  ?? "",
    });
    setMetaForm({
      meta_phone_number_id: d.meta_phone_number_id ?? "",
      meta_waba_id:         d.meta_waba_id         ?? "",
      meta_access_token:    d.meta_access_token    ?? "",
    });
    if (d.meta_verify_token) setMetaVerifyToken(d.meta_verify_token);

    if (d.whatsapp_provider === "wati") {
      setSelectedProvider("wati");
    } else if (d.whatsapp_provider === "meta" || d.meta_phone_number_id) {
      setSelectedProvider("meta");
    } else if (d.whatsapp_provider === "twilio" || d.twilio_account_sid) {
      setSelectedProvider("twilio");
    }
  }, [data]);

  const webhookUrl   = (data as any)?.webhookUrl ?? "";
  const hasTwilio    = !!(twilioForm.twilio_account_sid && twilioForm.twilio_auth_token && twilioForm.whatsapp_phone_id);
  const hasMetaCreds = !!(metaForm.meta_phone_number_id && metaForm.meta_waba_id && metaForm.meta_access_token);

  // ── Twilio save ───────────────────────────────────────────────
  const saveTwilio = useMutation({
    mutationFn: () => saveSettingsFn({ data: { ...twilioForm, whatsapp_provider: "twilio" } }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
      qc.invalidateQueries({ queryKey: ["wa-provider-status"] });
      if (result?.webhookRegistered === true) {
        setWebhookStatus({ registered: true, note: result.webhookNote });
        toast.success("Settings saved — webhook registered on Twilio");
      } else if (result?.webhookNote) {
        setWebhookStatus({ registered: false, note: result.webhookNote });
        toast.success("Settings saved");
      } else {
        toast.success("Twilio settings saved");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reRegister = useMutation({
    mutationFn: () => registerWebhookFn(),
    onSuccess: (result: any) => {
      if (result?.webhookRegistered) {
        setWebhookStatus({ registered: true, note: result.webhookNote });
        toast.success("Webhook registered on Twilio");
      } else {
        setWebhookStatus({ registered: false, note: result?.webhookNote ?? "Registration failed" });
        toast.error(result?.webhookNote ?? "Registration failed");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Meta save ─────────────────────────────────────────────────
  const saveMeta = useMutation({
    mutationFn: () => saveMetaFn({
      data: { ...metaForm, meta_verify_token: metaVerifyToken || undefined },
    }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["wa-settings"] });
      qc.invalidateQueries({ queryKey: ["wa-provider-status"] });
      if (result?.meta_verify_token) setMetaVerifyToken(result.meta_verify_token);
      toast.success("Meta settings saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function copyText(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  }

  function copyWebhook() { copyText(webhookUrl, "webhook"); }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-2xl">

      {/* ── Step 1: Choose provider ───────────────────────────────────── */}
      <div>
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Step 1</p>
          <h2 className="text-sm font-semibold">Choose your WhatsApp provider</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect one provider to send and receive WhatsApp messages with your AI agents.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {/* Twilio */}
          <ProviderCard
            selected={selectedProvider === "twilio"}
            onClick={() => setSelectedProvider("twilio")}
            icon={<Phone className="h-4 w-4 text-red-400" />}
            iconBg="bg-red-500/10 border-red-500/20"
            name="Twilio"
            description="Your own Twilio number. Automated webhook setup — no manual steps."
          />
          {/* WATI */}
          <ProviderCard
            selected={selectedProvider === "wati"}
            onClick={() => setSelectedProvider("wati")}
            icon={<Zap className="h-4 w-4 text-green-500" />}
            iconBg="bg-green-500/10 border-green-500/20"
            name="WATI"
            description="Managed WhatsApp Business API with built-in templates and contacts."
          />
          {/* Meta */}
          <ProviderCard
            selected={selectedProvider === "meta"}
            onClick={() => setSelectedProvider("meta")}
            icon={<Globe className="h-4 w-4 text-blue-400" />}
            iconBg="bg-blue-500/10 border-blue-500/20"
            name="Meta"
            description="Direct WhatsApp Business API via Meta Developer Portal."
          />
        </div>
      </div>

      {/* ── Step 2: Provider setup ────────────────────────────────────── */}
      {selectedProvider ? (
        <div>
          <div className="mb-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Step 2</p>
            <h2 className="text-sm font-semibold">
              {selectedProvider === "twilio" && "Enter your Twilio credentials"}
              {selectedProvider === "wati"   && "Connect your WATI account"}
              {selectedProvider === "meta"   && "Enter your Meta credentials"}
            </h2>
          </div>

          {/* ── Twilio ── */}
          {selectedProvider === "twilio" && (
            <div className="space-y-4">

              {/* Buy-a-number card */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                        <ShoppingCart className="h-4 w-4 text-green-500" />
                        Buy a WhatsApp Number
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        Purchase directly from Twilio — auto-fills the phone number field below.
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowBuyPanel(!showBuyPanel); setBuySearched(false); setBuyResults([]); }}
                      className="shrink-0"
                    >
                      {showBuyPanel ? "Close" : "Browse numbers"}
                    </Button>
                  </div>
                </CardHeader>

                {showBuyPanel && (
                  <CardContent className="space-y-4 pt-0">
                    {!twilioForm.twilio_account_sid || !twilioForm.twilio_auth_token ? (
                      <p className="text-xs text-amber-500 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 p-2.5">
                        Enter your Account SID and Auth Token in the credentials card below first.
                      </p>
                    ) : (
                      <>
                        <div className="flex gap-2 flex-wrap">
                          <select
                            value={buyCountry}
                            onChange={(e) => setBuyCountry(e.target.value)}
                            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            {[
                              { code: "US", flag: "🇺🇸", name: "United States" },
                              { code: "CA", flag: "🇨🇦", name: "Canada" },
                              { code: "GB", flag: "🇬🇧", name: "United Kingdom" },
                              { code: "AU", flag: "🇦🇺", name: "Australia" },
                              { code: "DE", flag: "🇩🇪", name: "Germany" },
                              { code: "FR", flag: "🇫🇷", name: "France" },
                              { code: "ES", flag: "🇪🇸", name: "Spain" },
                              { code: "BR", flag: "🇧🇷", name: "Brazil" },
                              { code: "MX", flag: "🇲🇽", name: "Mexico" },
                              { code: "IN", flag: "🇮🇳", name: "India" },
                            ].map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.flag} {c.name}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={buyAreaCode}
                            onChange={(e) => setBuyAreaCode(e.target.value)}
                            placeholder="Area code (optional)"
                            className="w-44"
                            onKeyDown={(e) => e.key === "Enter" && searchNumbers.mutate()}
                          />
                          <Button
                            onClick={() => searchNumbers.mutate()}
                            disabled={searchNumbers.isPending}
                            className="gap-1.5"
                          >
                            {searchNumbers.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Search className="h-3.5 w-3.5" />
                            )}
                            Search
                          </Button>
                        </div>

                        {buySearched && buyResults.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No numbers found. Try a different area code or country.
                          </p>
                        )}

                        {buyResults.length > 0 && (
                          <div className="space-y-2">
                            {buyResults.map((n) => (
                              <div
                                key={n.phoneNumber}
                                className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5"
                              >
                                <div className="min-w-0">
                                  <p className="font-mono text-sm font-medium">{n.phoneNumber}</p>
                                  {(n.locality || n.region) && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {[n.locality, n.region].filter(Boolean).join(", ")}
                                    </p>
                                  )}
                                  <div className="flex gap-1 mt-1">
                                    {n.sms   && <Badge variant="secondary" className="text-[10px] px-1 py-0">SMS</Badge>}
                                    {n.mms   && <Badge variant="secondary" className="text-[10px] px-1 py-0">MMS</Badge>}
                                    {n.voice && <Badge variant="secondary" className="text-[10px] px-1 py-0">Voice</Badge>}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => buyNumber.mutate(n.phoneNumber)}
                                  disabled={!!purchasing}
                                  className="shrink-0 gap-1.5"
                                >
                                  {purchasing === n.phoneNumber ? (
                                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buying…</>
                                  ) : (
                                    <>Buy ~$1/mo</>
                                  )}
                                </Button>
                              </div>
                            ))}
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                              Purchasing provisions the number in your Twilio account. To enable WhatsApp on it, complete{" "}
                              <a
                                href="https://www.twilio.com/en-us/whatsapp/request-access"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                Twilio's WhatsApp Business onboarding <ExternalLink className="inline h-3 w-3" />
                              </a>{" "}
                              — typically takes 1–2 business days.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                )}
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Twilio Credentials</CardTitle>
                  <CardDescription className="text-xs">
                    Find these in your{" "}
                    <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Twilio Console <ExternalLink className="inline h-3 w-3" />
                    </a>
                    . WeeBee auto-registers the inbound webhook when you save.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Account SID">
                    <Input
                      value={twilioForm.twilio_account_sid}
                      onChange={(e) => setTwilioForm({ ...twilioForm, twilio_account_sid: e.target.value })}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="font-mono text-sm"
                    />
                  </Field>
                  <Field label="Auth Token">
                    <Input
                      type="password"
                      value={twilioForm.twilio_auth_token}
                      onChange={(e) => setTwilioForm({ ...twilioForm, twilio_auth_token: e.target.value })}
                      placeholder="••••••••••••••••••••••••••••••••"
                      className="font-mono text-sm"
                    />
                  </Field>
                  <Field label="WhatsApp Phone Number" hint="Include + and country code, e.g. +14155238886">
                    <Input
                      value={twilioForm.whatsapp_phone_id}
                      onChange={(e) => setTwilioForm({ ...twilioForm, whatsapp_phone_id: e.target.value })}
                      placeholder="+14155238886"
                      className="font-mono text-sm"
                    />
                  </Field>
                </CardContent>
              </Card>

              {webhookUrl && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Settings className="h-4 w-4" /> Inbound Webhook
                    </CardTitle>
                    <CardDescription className="text-xs">Auto-registered on save. Copy for manual setup if needed.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <CopyRow value={webhookUrl} copied={copiedField === "webhook"} onCopy={copyWebhook} />
                    {webhookStatus && <WebhookStatusBadge status={webhookStatus} />}
                    {hasTwilio && (
                      <Button variant="outline" size="sm" onClick={() => reRegister.mutate()} disabled={reRegister.isPending} className="gap-1.5">
                        {reRegister.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Re-register webhook
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              <StatusBar
                icon={<Phone className="h-3.5 w-3.5" />}
                label="Connection status"
                ok={hasTwilio}
                okLabel="Credentials entered"
                nokLabel="Not configured"
                extra={webhookStatus?.registered ? <Badge className="text-[10px] bg-green-500/20 text-green-600 border border-green-500/30">Webhook ✓</Badge> : null}
              />

              <div className="flex justify-end">
                <Button onClick={() => saveTwilio.mutate()} disabled={saveTwilio.isPending || !hasTwilio} className="gap-2">
                  {saveTwilio.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <>Save & Register Webhook <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          )}

          {/* ── WATI ── */}
          {selectedProvider === "wati" && <WatiIntegrationSettings />}

          {/* ── Meta ── */}
          {selectedProvider === "meta" && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Meta WhatsApp Business API</CardTitle>
                  <CardDescription className="text-xs">
                    Get these from your{" "}
                    <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      Meta Developer Portal <ExternalLink className="inline h-3 w-3" />
                    </a>
                    {" "}→ your App → WhatsApp → API Setup.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field
                    label="Phone Number ID"
                    hint="App → WhatsApp → API Setup → Phone Number ID"
                  >
                    <Input
                      value={metaForm.meta_phone_number_id}
                      onChange={(e) => setMetaForm({ ...metaForm, meta_phone_number_id: e.target.value })}
                      placeholder="123456789012345"
                      className="font-mono text-sm"
                    />
                  </Field>
                  <Field
                    label="WhatsApp Business Account ID (WABA ID)"
                    hint="Meta Business Settings → WhatsApp Accounts → your account ID"
                  >
                    <Input
                      value={metaForm.meta_waba_id}
                      onChange={(e) => setMetaForm({ ...metaForm, meta_waba_id: e.target.value })}
                      placeholder="987654321098765"
                      className="font-mono text-sm"
                    />
                  </Field>
                  <Field
                    label="Permanent Access Token"
                    hint="Meta Business Settings → System Users → Generate Token (never expires)"
                  >
                    <div className="relative">
                      <Input
                        type={showToken ? "text" : "password"}
                        value={metaForm.meta_access_token}
                        onChange={(e) => setMetaForm({ ...metaForm, meta_access_token: e.target.value })}
                        placeholder="EAAxxxxxxxxxxxxxxxx…"
                        className="font-mono text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                </CardContent>
              </Card>

              {/* Webhook config for Meta */}
              {webhookUrl && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Settings className="h-4 w-4" /> Webhook Configuration
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Save first to generate your verify token, then paste both values into{" "}
                      <strong>Meta Developer Portal → App → WhatsApp → Configuration → Webhook</strong>.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Callback URL — paste this into Meta</Label>
                      <CopyRow
                        value={webhookUrl}
                        copied={copiedField === "webhook"}
                        onCopy={copyWebhook}
                      />
                    </div>

                    {metaVerifyToken && (
                      <div className="space-y-1.5">
                        <Label className="text-xs">Verify Token — paste this into Meta</Label>
                        <CopyRow
                          value={metaVerifyToken}
                          copied={copiedField === "verifyToken"}
                          onCopy={() => copyText(metaVerifyToken, "verifyToken")}
                          mono
                        />
                        <p className="text-[11px] text-muted-foreground">
                          This is auto-generated. Paste it into the "Verify token" field in Meta's Webhook settings, then click Verify and Save.
                        </p>
                      </div>
                    )}

                    {!metaVerifyToken && (
                      <p className="text-[11px] text-amber-500">
                        Save your credentials below to generate the verify token.
                      </p>
                    )}

                    {/* Subscriptions reminder */}
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 space-y-1">
                      <p className="text-[11px] font-medium text-blue-400">After webhook is verified in Meta:</p>
                      <ol className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                        <li>Click <strong>Manage</strong> next to Webhook fields</li>
                        <li>Subscribe to <strong>messages</strong></li>
                        <li>That's it — WeeBee handles everything else</li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>
              )}

              <StatusBar
                icon={<Globe className="h-3.5 w-3.5" />}
                label="Connection status"
                ok={hasMetaCreds}
                okLabel="Credentials entered"
                nokLabel="Not configured"
                extra={metaVerifyToken ? <Badge className="text-[10px] bg-blue-500/20 text-blue-600 border border-blue-500/30">Token ready</Badge> : null}
              />

              <div className="flex justify-end">
                <Button onClick={() => saveMeta.mutate()} disabled={saveMeta.isPending || !hasMetaCreds} className="gap-2">
                  {saveMeta.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <>Save Meta Settings <ArrowRight className="h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 flex flex-col items-center justify-center py-12 text-center gap-2">
          <ChevronRight className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">Select a provider above to begin setup</p>
          <p className="text-xs text-muted-foreground/70">Twilio, WATI, or Meta — pick the one your business already uses</p>
        </div>
      )}
    </div>
  );
}

/* ── Small shared sub-components ─────────────────────────────────────────── */

function ProviderCard({
  selected, onClick, icon, iconBg, name, description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  description: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative rounded-xl border p-4 text-left transition-all hover:border-primary/50",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-card hover:bg-muted/30",
      )}
    >
      {selected && (
        <span className="absolute top-2.5 right-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
          <CheckCheck className="h-2.5 w-2.5 text-primary-foreground" />
        </span>
      )}
      <div className="flex items-center gap-2.5 mb-2">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", iconBg)}>{icon}</span>
        <span className="font-semibold text-sm">{name}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CopyRow({ value, copied, onCopy, mono = true }: { value: string; copied: boolean; onCopy: () => void; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={value} className={cn("bg-muted/50 text-xs", mono && "font-mono")} />
      <Button variant="outline" size="icon" onClick={onCopy} className="shrink-0">
        {copied ? <CheckCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function WebhookStatusBadge({ status }: { status: { registered: boolean; note: string } }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-md border p-2.5", status.registered ? "bg-green-500/10 border-green-500/20" : "bg-amber-500/10 border-amber-500/20")}>
      {status.registered
        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
        : <XCircle     className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
      <p className="text-xs text-muted-foreground leading-relaxed">{status.note}</p>
    </div>
  );
}

function StatusBar({
  icon, label, ok, okLabel, nokLabel, extra,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  okLabel: string;
  nokLabel: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge
          variant={ok ? "default" : "secondary"}
          className={cn("text-[10px]", ok && "bg-green-600 hover:bg-green-600 text-white")}
        >
          {ok ? okLabel : nokLabel}
        </Badge>
        {extra}
      </div>
    </div>
  );
}
