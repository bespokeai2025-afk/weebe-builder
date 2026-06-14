import React, { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, CheckCircle2, XCircle, AlertCircle, Clock,
  Loader2, FlaskConical, Eye, EyeOff, Save, PowerOff,
  Cpu, Mic, Phone, MessageSquare, Mail, Database,
  CalendarCheck, BookOpen, Video, Image, BarChart3, Megaphone,
} from "lucide-react";
import {
  getProviderRegistryData,
  saveProviderCredentials,
  testProviderConnection,
  toggleProviderEnabled,
} from "@/lib/providers/providers.functions";

export const Route = createFileRoute("/_authenticated/settings/providers/$category")({
  component: CategoryProvidersPage,
});

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string; description: string }> = {
  llm:         { label: "LLM / AI Models",   icon: Cpu,           color: "text-violet-400", description: "Language models powering agent conversations, classification, and content generation." },
  voice:       { label: "Voice Engines",      icon: Mic,           color: "text-blue-400",   description: "Text-to-speech and speech-to-text engines for real-time voice agents." },
  telephony:   { label: "Telephony",          icon: Phone,         color: "text-emerald-400", description: "SIP/PSTN carriers for inbound and outbound phone call handling." },
  whatsapp:    { label: "WhatsApp",           icon: MessageSquare, color: "text-green-400",  description: "WhatsApp Business API providers for messaging and broadcast campaigns." },
  email:       { label: "Email",              icon: Mail,          color: "text-amber-400",  description: "Transactional email delivery providers." },
  crm:         { label: "CRM",                icon: Database,      color: "text-cyan-400",   description: "Customer relationship management integrations for contact and call logging." },
  calendar:    { label: "Calendar",           icon: CalendarCheck, color: "text-rose-400",   description: "Calendar scheduling and availability management." },
  knowledge:   { label: "Knowledge Base",     icon: BookOpen,      color: "text-indigo-400", description: "Vector stores and retrieval systems for agent knowledge retrieval." },
  video:       { label: "Video Generation",   icon: Video,         color: "text-pink-400",   description: "AI video generation providers for content creation." },
  image:       { label: "Image Generation",   icon: Image,         color: "text-orange-400", description: "AI image generation providers." },
  analytics:   { label: "Analytics",          icon: BarChart3,     color: "text-teal-400",   description: "Web and product analytics integrations." },
  advertising: { label: "Advertising",        icon: Megaphone,     color: "text-yellow-400", description: "Ad platform integrations for campaign performance data." },
};

interface CredField {
  key: string;
  label: string;
  type: "password" | "text";
  required: boolean;
  placeholder?: string;
}

const CREDENTIAL_FIELDS: Record<string, CredField[]> = {
  "llm:claude": [{ key: "apiKey", label: "Anthropic API Key", type: "password", required: true, placeholder: "sk-ant-api03-..." }],
  "llm:gemini": [{ key: "apiKey", label: "Gemini API Key", type: "password", required: true, placeholder: "AIzaSy..." }],
  "llm:openrouter": [{ key: "apiKey", label: "OpenRouter API Key", type: "password", required: true, placeholder: "sk-or-v1-..." }],
  "email:resend": [
    { key: "apiKey", label: "Resend API Key", type: "password", required: true, placeholder: "re_..." },
    { key: "fromAddress", label: "Default From Address", type: "text", required: false, placeholder: "noreply@yourdomain.com" },
  ],
  "email:sendgrid": [{ key: "apiKey", label: "SendGrid API Key", type: "password", required: true, placeholder: "SG..." }],
  "video:runway": [{ key: "apiKey", label: "Runway API Key", type: "password", required: true, placeholder: "key_..." }],
  "video:google_veo": [
    { key: "gcpProject", label: "GCP Project ID", type: "text", required: true },
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
  ],
  "image:imagen": [
    { key: "gcpProject", label: "GCP Project ID", type: "text", required: true },
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
  ],
  "analytics:google_analytics": [
    { key: "propertyId", label: "GA4 Property ID", type: "text", required: true, placeholder: "123456789" },
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
  ],
  "advertising:google_ads": [
    { key: "developerToken", label: "Developer Token", type: "password", required: true },
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
    { key: "customerId", label: "Customer ID", type: "text", required: true, placeholder: "123-456-7890" },
  ],
  "advertising:meta_ads": [
    { key: "accessToken", label: "Access Token", type: "password", required: true },
    { key: "adAccountId", label: "Ad Account ID", type: "text", required: true, placeholder: "act_123456789" },
  ],
  "knowledge:pinecone": [
    { key: "apiKey", label: "Pinecone API Key", type: "password", required: true },
    { key: "indexName", label: "Index Name", type: "text", required: true },
  ],
  "calendar:google": [
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
    { key: "calendarId", label: "Calendar ID", type: "text", required: false, placeholder: "primary" },
  ],
  "voice:retell": [{ key: "apiKey", label: "Retell API Key", type: "password", required: true, placeholder: "key_..." }],
  "voice:openai": [{ key: "apiKey", label: "OpenAI API Key", type: "password", required: true, placeholder: "sk-..." }],
  "voice:elevenlabs": [{ key: "apiKey", label: "ElevenLabs API Key", type: "password", required: true, placeholder: "sk_..." }],
  "telephony:frejun": [{ key: "apiKey", label: "FreJun API Key", type: "password", required: true }],
  "telephony:twilio": [
    { key: "accountSid", label: "Account SID", type: "text", required: true, placeholder: "ACxxxx" },
    { key: "authToken", label: "Auth Token", type: "password", required: true },
  ],
  "image:gpt_image": [{ key: "apiKey", label: "OpenAI API Key", type: "password", required: true, placeholder: "sk-..." }],
  "crm:hubspot": [{ key: "apiKey", label: "HubSpot Access Token", type: "password", required: true, placeholder: "pat-na1-..." }],
};

const REDIRECT_PROVIDERS: Record<string, string> = {
  "crm:gohighlevel": "/settings/crm",
  "whatsapp:meta":   "/settings/integrations",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "connected")    return <Badge className="text-[9px] h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Connected</Badge>;
  if (status === "error")        return <Badge className="text-[9px] h-4 bg-red-500/10 text-red-400 border-red-500/20"><XCircle className="h-2.5 w-2.5 mr-0.5" />Error</Badge>;
  if (status === "coming_soon")  return <Badge className="text-[9px] h-4 bg-muted/40 text-muted-foreground border-border"><Clock className="h-2.5 w-2.5 mr-0.5" />Coming Soon</Badge>;
  return <Badge className="text-[9px] h-4 bg-muted/40 text-muted-foreground border-border"><AlertCircle className="h-2.5 w-2.5 mr-0.5" />Disconnected</Badge>;
}

function ProviderPanel({
  category,
  provider,
  onRefresh,
}: {
  category: string;
  provider: any;
  onRefresh: () => void;
}) {
  const credKey    = `${category}:${provider.name}`;
  const credFields = CREDENTIAL_FIELDS[credKey];
  const redirectTo = REDIRECT_PROVIDERS[credKey];

  const saveFn   = useServerFn(saveProviderCredentials);
  const testFn   = useServerFn(testProviderConnection);
  const toggleFn = useServerFn(toggleProviderEnabled);

  const [open,    setOpen]    = useState(false);
  const [creds,   setCreds]   = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);

  const isConnected  = provider.status === "connected";
  const isComingSoon = provider.status === "coming_soon";

  async function handleSave() {
    setSaving(true);
    try {
      await saveFn({ data: { category, providerName: provider.name, credentials: creds } });
      toast.success(`${provider.label} credentials saved`);
      setOpen(false);
      onRefresh();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await testFn({ data: { category, providerName: provider.name, credentials: creds } }) as any;
      if (res.ok) { toast.success("Connection successful"); onRefresh(); }
      else         toast.error(res.error ?? "Connection failed");
    } catch (e: any) { toast.error(e.message); }
    setTesting(false);
  }

  async function handleDisable() {
    try {
      await toggleFn({ data: { category, providerName: provider.name, enabled: false } });
      toast.success(`${provider.label} disabled`);
      onRefresh();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{provider.label}</span>
            <StatusBadge status={provider.status} />
            {provider.isDefault  && <Badge className="text-[9px] h-4 bg-primary/10 text-primary border-primary/20">Primary</Badge>}
            {provider.isFallback && <Badge className="text-[9px] h-4 bg-amber-500/10 text-amber-400 border-amber-500/20">Fallback</Badge>}
          </div>
          {provider.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{provider.description}</p>}
        </div>
      </div>

      {isConnected && (
        <div className="flex gap-1.5 flex-wrap text-[10px]">
          {credFields && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" disabled={testing} onClick={() => { setOpen(o => !o); handleTest(); }}>
              {testing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <FlaskConical className="h-2.5 w-2.5" />}
              Test Connection
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 text-red-400/70 hover:text-red-400" onClick={handleDisable}>
            <PowerOff className="h-2.5 w-2.5" />
            Disable
          </Button>
        </div>
      )}

      {!isConnected && !isComingSoon && (
        <>
          {redirectTo ? (
            <Link to={redirectTo}>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1 w-full justify-start">
                Configure in dedicated settings →
              </Button>
            </Link>
          ) : credFields ? (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setOpen(o => !o)}>
              {open ? "Hide" : "Configure"}
            </Button>
          ) : null}

          {open && credFields && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              {credFields.map(f => (
                <div key={f.key} className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {f.label}{f.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  <div className="relative">
                    <Input
                      type={f.type === "password" && !visible[f.key] ? "password" : "text"}
                      placeholder={f.placeholder}
                      value={creds[f.key] ?? ""}
                      onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
                      className="h-7 text-xs pr-7"
                    />
                    {f.type === "password" && (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setVisible(v => ({ ...v, [f.key]: !v[f.key] }))}
                      >
                        {visible[f.key] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex gap-1.5">
                <Button size="sm" variant="default" className="h-6 px-3 text-[10px] gap-1" disabled={saving} onClick={handleSave}>
                  {saving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" className="h-6 px-3 text-[10px] gap-1" disabled={testing} onClick={handleTest}>
                  {testing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <FlaskConical className="h-2.5 w-2.5" />}
                  Test Connection
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CategoryProvidersPage() {
  const { category } = useParams({ from: "/_authenticated/settings/providers/$category" });
  const getDataFn    = useServerFn(getProviderRegistryData);

  const [providers, setProviders] = useState<any[]>([]);
  const [loading,   setLoading]   = useState(true);

  const meta = CATEGORY_META[category];
  const Icon = meta?.icon ?? Cpu;

  async function load() {
    setLoading(true);
    try {
      const res  = await getDataFn({ data: {} }) as any;
      const list = res.byCategory?.[category]?.providers ?? [];
      setProviders(list);
    } catch { /* graceful */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, [category]);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/settings/providers">
          <Button variant="ghost" size="sm" className="gap-1 text-xs">
            <ArrowLeft className="h-3.5 w-3.5" /> All Providers
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className={`p-2.5 rounded-lg bg-muted/50 ${meta?.color ?? "text-muted-foreground"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{meta?.label ?? category}</h1>
          {meta?.description && <p className="text-sm text-muted-foreground mt-0.5">{meta.description}</p>}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
        </div>
      ) : providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No providers found for this category.</p>
      ) : (
        <div className="grid gap-3">
          {providers.map((p: any) => (
            <ProviderPanel
              key={p.name}
              category={category}
              provider={p}
              onRefresh={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}
