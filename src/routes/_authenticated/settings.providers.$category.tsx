import React, { useEffect, useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft, CheckCircle2, XCircle, AlertCircle, Clock,
  Loader2, FlaskConical, Eye, EyeOff, Save, PowerOff,
  Cpu, Mic, Phone, MessageSquare, Mail, Database,
  CalendarCheck, BookOpen, Video, Image, BarChart3, Megaphone, Zap,
} from "lucide-react";
import {
  getProviderRegistryData,
  saveProviderCredentials,
  testProviderConnection,
  toggleProviderEnabled,
} from "@/lib/providers/providers.functions";
import { startGoogleAdsOAuth, getGoogleAdsOAuthStatus } from "@/lib/providers/advertising/google-ads-oauth.functions";

// Trigger an ad sync after connecting an ads provider so campaigns appear immediately
const triggerAdsSyncForWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) return { ok: false };
    try {
      const { runAdsSyncTick } = await import("@/lib/growthmind/growthmind.ads-sync-tick");
      const summary = await runAdsSyncTick({ workspaceId });
      return { ok: true, synced: summary.synced, errors: summary.errors };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  });

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
  "llm:openai": [{ key: "apiKey", label: "OpenAI API Key", type: "password", required: true, placeholder: "sk-..." }],
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
    { key: "geminiApiKey",  label: "Gemini API Key (recommended)", type: "password", required: false, placeholder: "AIzaSy…" },
    { key: "gcpProject",    label: "GCP Project ID",               type: "text",     required: false, placeholder: "my-project-id" },
    { key: "accessToken",   label: "GCP OAuth Access Token",       type: "password", required: false, placeholder: "ya29.…" },
    { key: "refreshToken",  label: "OAuth Refresh Token",          type: "password", required: false, placeholder: "1//0g…" },
    { key: "clientId",      label: "OAuth Client ID",              type: "text",     required: false, placeholder: "12345-abc.apps.googleusercontent.com" },
    { key: "clientSecret",  label: "OAuth Client Secret",          type: "password", required: false, placeholder: "GOCSPX-…" },
    { key: "location",      label: "GCP Location",                 type: "text",     required: false, placeholder: "us-central1" },
    { key: "veoModel",      label: "Veo Model (leave blank for Veo 3 default)", type: "text", required: false, placeholder: "veo-3.0-generate-preview" },
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
    { key: "developerToken", label: "Developer Token", type: "password", required: true,  placeholder: "ABCdef123..." },
    { key: "customerId",     label: "Customer ID (client account)", type: "text", required: true,  placeholder: "123-456-7890" },
    { key: "refreshToken",   label: "OAuth Refresh Token", type: "password", required: true,  placeholder: "1//0g…" },
    { key: "clientId",       label: "OAuth Client ID", type: "text",     required: true,  placeholder: "12345-abc.apps.googleusercontent.com" },
    { key: "clientSecret",   label: "OAuth Client Secret", type: "password", required: true,  placeholder: "GOCSPX-…" },
    { key: "managerId",      label: "Manager Account ID (MCC — leave blank if not using a manager account)", type: "text", required: false, placeholder: "123-456-7890" },
    { key: "accessToken",    label: "Static Access Token (fallback only — expires in 1 hour)", type: "password", required: false, placeholder: "ya29.…" },
  ],
  "advertising:meta_ads": [
    { key: "accessToken", label: "Access Token", type: "password", required: true, placeholder: "EAAxxxxx…" },
    { key: "adAccountId", label: "Ad Account ID", type: "text", required: true, placeholder: "act_123456789 or 123456789" },
  ],
  "advertising:tiktok_ads": [
    { key: "accessToken",   label: "Access Token",   type: "password", required: true,  placeholder: "Your TikTok Marketing API long-lived access token" },
    { key: "advertiserId",  label: "Advertiser ID",  type: "text",     required: true,  placeholder: "1234567890123" },
  ],
  "advertising:linkedin_ads": [
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true, placeholder: "AQV..." },
    { key: "accountId",   label: "Sponsored Account ID", type: "text", required: true,  placeholder: "123456789 (from Campaign Manager URL)" },
  ],
  "knowledge:pinecone": [
    { key: "apiKey", label: "Pinecone API Key", type: "password", required: true },
    { key: "indexName", label: "Index Name", type: "text", required: true },
  ],
  "calendar:google": [
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
    { key: "calendarId", label: "Calendar ID", type: "text", required: false, placeholder: "primary" },
  ],
  "voice:retell": [{ key: "apiKey", label: "OmniVoice API Key", type: "password", required: true, placeholder: "key_..." }],
  "voice:openai": [{ key: "apiKey", label: "OpenAI API Key", type: "password", required: true, placeholder: "sk-..." }],
  "voice:elevenlabs": [{ key: "apiKey", label: "ElevenLabs API Key", type: "password", required: true, placeholder: "sk_..." }],
  "whatsapp:meta": [
    { key: "accessToken",   label: "Permanent Access Token",     type: "password", required: true,  placeholder: "EAAxxxxx… (System User or Business token)" },
    { key: "phoneNumberId", label: "Phone Number ID",            type: "text",     required: true,  placeholder: "1234567890123456" },
    { key: "wabaId",        label: "WhatsApp Business Account ID (WABA)", type: "text", required: false, placeholder: "9876543210987654" },
    { key: "verifyToken",   label: "Webhook Verify Token",       type: "text",     required: false, placeholder: "any secret string you choose" },
  ],
  "telephony:frejun": [{ key: "apiKey", label: "FreJun API Key", type: "password", required: true }],
  "telephony:twilio": [
    { key: "accountSid", label: "Account SID", type: "text", required: true, placeholder: "ACxxxx" },
    { key: "authToken", label: "Auth Token", type: "password", required: true },
  ],
  "whatsapp:wati": [
    { key: "apiKey",        label: "WATI API Key",      type: "password", required: true,  placeholder: "your_wati_api_key" },
    { key: "tenantId",      label: "WATI Tenant URL",   type: "text",     required: true,  placeholder: "yourcompany.wati.io" },
    { key: "webhookSecret", label: "Webhook Secret",    type: "password", required: false, placeholder: "optional secret string" },
  ],
  "whatsapp:twilio": [
    { key: "accountSid", label: "Twilio Account SID", type: "text",     required: true, placeholder: "ACxxxx" },
    { key: "authToken",  label: "Twilio Auth Token",  type: "password", required: true },
  ],
  "calendar:calcom": [
    { key: "apiKey", label: "Cal.com API Key", type: "password", required: true, placeholder: "cal_live_..." },
  ],
  "image:gpt_image": [{ key: "apiKey", label: "OpenAI API Key", type: "password", required: true, placeholder: "sk-..." }],
  "crm:hubspot": [{ key: "apiKey", label: "HubSpot Access Token", type: "password", required: true, placeholder: "pat-na1-..." }],
};

const REDIRECT_PROVIDERS: Record<string, string> = {
  "crm:gohighlevel": "/settings/crm",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "connected")    return <Badge className="text-[9px] h-4 bg-emerald-500/10 text-emerald-400 border-emerald-500/20"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Connected</Badge>;
  if (status === "error")        return <Badge className="text-[9px] h-4 bg-red-500/10 text-red-400 border-red-500/20"><XCircle className="h-2.5 w-2.5 mr-0.5" />Error</Badge>;
  if (status === "coming_soon")  return <Badge className="text-[9px] h-4 bg-muted/40 text-muted-foreground border-border"><Clock className="h-2.5 w-2.5 mr-0.5" />Coming Soon</Badge>;
  return <Badge className="text-[9px] h-4 bg-muted/40 text-muted-foreground border-border"><AlertCircle className="h-2.5 w-2.5 mr-0.5" />Disconnected</Badge>;
}

// ── "Connect with Google" OAuth block for Google Ads ─────────────────────────
function GoogleAdsOAuthConnect({ creds }: { creds: Record<string, string> }) {
  const startFn  = useServerFn(startGoogleAdsOAuth);
  const statusFn = useServerFn(getGoogleAdsOAuthStatus);

  const [status,     setStatus]     = useState<any>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    statusFn().then(setStatus).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clientIdReady     = !!(creds.clientId?.trim()     || status?.hasClientId);
  const clientSecretReady = !!(creds.clientSecret?.trim() || status?.hasClientSecret);
  const ready = clientIdReady && clientSecretReady;

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await startFn({
        data: {
          source:         "provider" as const,
          origin:         window.location.origin,
          returnTo:       window.location.pathname,
          clientId:       creds.clientId?.trim()       || undefined,
          clientSecret:   creds.clientSecret?.trim()   || undefined,
          developerToken: creds.developerToken?.trim() || undefined,
          customerId:     creds.customerId?.trim()     || undefined,
          managerId:      creds.managerId?.trim()      || undefined,
        },
      }) as any;
      if (res?.url) window.location.href = res.url;
      else { toast.error("Could not start Google sign-in"); setConnecting(false); }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start Google sign-in");
      setConnecting(false);
    }
  }

  return (
    <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-2">
      <p className="text-[11px] font-medium">Connect with Google (recommended)</p>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Instead of pasting a refresh token manually, sign in with the Google account
        that manages your Google Ads. We securely receive a long-lived refresh token
        automatically. You still need your <b>OAuth Client ID</b>, <b>Client Secret</b> and{" "}
        <b>Developer Token</b> from Google (enter them above first, then click Connect).
      </p>
      {status?.hasRefreshToken && (
        <p className="text-[10px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Google account connected — refresh token on file
        </p>
      )}
      <Button
        size="sm"
        className="h-7 px-3 text-[11px] gap-1.5 bg-white text-black hover:bg-white/90"
        disabled={!ready || connecting}
        onClick={handleConnect}
      >
        {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : (
          <svg className="h-3 w-3" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
        )}
        {status?.hasRefreshToken ? "Reconnect with Google" : "Connect with Google"}
      </Button>
      {!ready && (
        <p className="text-[10px] text-muted-foreground/70">
          Enter your OAuth Client ID and Client Secret above to enable this button.
        </p>
      )}
    </div>
  );
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
  const syncFn   = useServerFn(triggerAdsSyncForWorkspace);

  const [open,     setOpen]    = useState(false);
  const [creds,    setCreds]   = useState<Record<string, string>>({});
  const [visible,  setVisible] = useState<Record<string, boolean>>({});
  const [saving,   setSaving]  = useState(false);
  const [testing,  setTesting] = useState(false);
  const [syncing,  setSyncing] = useState(false);

  const isConnected  = provider.status === "connected";
  const isComingSoon = provider.status === "coming_soon";
  const isAds        = category === "advertising";

  async function handleSave() {
    setSaving(true);
    try {
      await saveFn({ data: { category, providerName: provider.name, credentials: creds } });
      toast.success(`${provider.label} credentials saved`);
      setOpen(false);
      onRefresh();

      // For advertising providers, auto-trigger a sync so campaigns appear immediately
      if (isAds) {
        setSyncing(true);
        try {
          const res = await syncFn() as any;
          if (res?.synced > 0) {
            toast.success(`Synced ${res.synced} platform(s) — check Ads Performance for live data`);
          } else {
            toast.info("Credentials saved — Sync Now in Ads Performance to pull campaign data");
          }
        } catch { /* sync errors are non-fatal */ }
        setSyncing(false);
        onRefresh();
      }
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  }

  async function handleTest() {
    setTesting(true);
    try {
      // Persist credentials first so the server-side health check reads the latest values
      if (Object.keys(creds).length > 0) {
        await saveFn({ data: { category, providerName: provider.name, credentials: creds } });
      }
      const res = await testFn({ data: { category, providerName: provider.name } }) as any;
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
          {credFields && (
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1" onClick={() => setOpen(o => !o)}>
              <Save className="h-2.5 w-2.5" />
              {open ? "Hide" : "Update Key"}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 text-red-400/70 hover:text-red-400" onClick={handleDisable}>
            <PowerOff className="h-2.5 w-2.5" />
            Disable
          </Button>
        </div>
      )}

      {isConnected && open && credFields && (
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
          <Button size="sm" variant="default" className="h-6 px-3 text-[10px] gap-1" disabled={saving || syncing} onClick={handleSave}>
            {syncing ? <><Zap className="h-2.5 w-2.5 animate-pulse" />Syncing…</> : saving ? <><Loader2 className="h-2.5 w-2.5 animate-spin" />Saving…</> : <><Save className="h-2.5 w-2.5" />Save</>}
          </Button>
          {credKey === "advertising:google_ads" && <GoogleAdsOAuthConnect creds={creds} />}
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
          ) : null}

          {!redirectTo && credFields && (
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
              <div className="flex gap-1.5 flex-wrap">
                <Button size="sm" variant="default" className="h-6 px-3 text-[10px] gap-1" disabled={saving || syncing} onClick={handleSave}>
                  {syncing ? <><Zap className="h-2.5 w-2.5 animate-pulse" />Syncing…</> : saving ? <><Loader2 className="h-2.5 w-2.5 animate-spin" />Saving…</> : <><Save className="h-2.5 w-2.5" />Save & Connect</>}
                </Button>
                <Button size="sm" variant="outline" className="h-6 px-3 text-[10px] gap-1" disabled={testing} onClick={handleTest}>
                  {testing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <FlaskConical className="h-2.5 w-2.5" />}
                  Test Connection
                </Button>
              </div>
              {credKey === "advertising:google_ads" && <GoogleAdsOAuthConnect creds={creds} />}
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
      const res  = await getDataFn() as any;
      const list = res.byCategory?.[category]?.providers ?? [];
      setProviders(list);
    } catch { /* graceful */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, [category]);

  // Show the result of a "Connect with Google" round-trip (?gads=connected / error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gads = params.get("gads");
    if (!gads) return;
    if (gads === "connected") {
      toast.success("Google Ads connected via Google sign-in — refresh token saved");
    } else {
      toast.error(params.get("gads_msg") ?? "Google Ads connection failed");
    }
    params.delete("gads"); params.delete("gads_msg");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

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
