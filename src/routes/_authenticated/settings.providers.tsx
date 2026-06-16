import { useState, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, RefreshCw, CheckCircle2, XCircle, Clock, Loader2,
  Cpu, Mic, Phone, MessageSquare, Mail, Database, CalendarCheck,
  BookOpen, Video, Image, BarChart3, Megaphone, AlertTriangle,
  DollarSign, Zap, Star, ArrowDownToLine, PowerOff, ChevronDown,
  ChevronUp, FlaskConical, Save, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  getProviderRegistryData,
  getProviderUsageStats,
  updateProviderPriority,
  toggleProviderEnabled,
  saveProviderCredentials,
  testProviderConnection,
  refreshAllProviderHealth,
} from "@/lib/providers/providers.functions";
import type { ProviderUsageStat } from "@/lib/providers/providers.functions";
import {
  saveProviderCostRate,
} from "@/lib/cost-engine/cost-engine.functions";

export const Route = createFileRoute("/_authenticated/settings/providers")({
  head: () => ({ meta: [{ title: "Provider Settings — Webee" }] }),
  component: ProvidersSettingsPage,
});

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  llm:         { label: "LLM / AI Models",   icon: Cpu,           color: "text-violet-400" },
  voice:       { label: "Voice Engines",      icon: Mic,           color: "text-blue-400"   },
  telephony:   { label: "Telephony",          icon: Phone,         color: "text-emerald-400"},
  whatsapp:    { label: "WhatsApp",           icon: MessageSquare, color: "text-green-400"  },
  email:       { label: "Email",              icon: Mail,          color: "text-amber-400"  },
  crm:         { label: "CRM",                icon: Database,      color: "text-cyan-400"   },
  calendar:    { label: "Calendar",           icon: CalendarCheck, color: "text-rose-400"   },
  knowledge:   { label: "Knowledge Base",     icon: BookOpen,      color: "text-indigo-400" },
  video:       { label: "Video Generation",   icon: Video,         color: "text-pink-400"   },
  image:       { label: "Image Generation",   icon: Image,         color: "text-orange-400" },
  analytics:   { label: "Analytics",          icon: BarChart3,     color: "text-teal-400"   },
  advertising: { label: "Advertising",        icon: Megaphone,     color: "text-yellow-400" },
};

const STATUS_ORDER = ["connected", "disconnected", "error", "coming_soon"];

// ── Credential field definitions per category:provider ───────────────────────

interface CredField {
  key: string;
  label: string;
  type: "password" | "text";
  required: boolean;
  placeholder?: string;
}

const CREDENTIAL_FIELDS: Record<string, CredField[]> = {
  "llm:claude": [
    { key: "apiKey", label: "Anthropic API Key", type: "password", required: true, placeholder: "sk-ant-api03-..." },
  ],
  "llm:gemini": [
    { key: "apiKey", label: "Gemini API Key", type: "password", required: true, placeholder: "AIzaSy..." },
  ],
  "llm:openrouter": [
    { key: "apiKey", label: "OpenRouter API Key", type: "password", required: true, placeholder: "sk-or-v1-..." },
  ],
  "email:resend": [
    { key: "apiKey", label: "Resend API Key", type: "password", required: true, placeholder: "re_..." },
    { key: "fromAddress", label: "Default From Address", type: "text", required: false, placeholder: "noreply@yourdomain.com" },
  ],
  "email:sendgrid": [
    { key: "apiKey", label: "SendGrid API Key", type: "password", required: true, placeholder: "SG..." },
  ],
  "video:runway": [
    { key: "apiKey", label: "Runway API Key", type: "password", required: true, placeholder: "key_..." },
  ],
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
    { key: "developerToken", label: "Developer Token", type: "password", required: true },
    { key: "customerId", label: "Customer ID", type: "text", required: true, placeholder: "123-456-7890" },
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
  ],
  "advertising:meta_ads": [
    { key: "accessToken", label: "Access Token", type: "password", required: true },
    { key: "adAccountId", label: "Ad Account ID", type: "text", required: true, placeholder: "act_123456789" },
  ],
  "advertising:tiktok_ads": [
    { key: "accessToken",  label: "Access Token",  type: "password", required: true, placeholder: "Your TikTok Marketing API long-lived access token" },
    { key: "advertiserId", label: "Advertiser ID", type: "text",     required: true, placeholder: "1234567890123" },
  ],
  "knowledge:pinecone": [
    { key: "apiKey", label: "Pinecone API Key", type: "password", required: true },
    { key: "indexName", label: "Index Name", type: "text", required: true },
    { key: "indexHost", label: "Index Host URL (optional)", type: "text", required: false, placeholder: "https://my-index.svc.pinecone.io" },
  ],
  "calendar:google": [
    { key: "accessToken", label: "OAuth Access Token", type: "password", required: true },
    { key: "calendarId", label: "Calendar ID (optional)", type: "text", required: false, placeholder: "primary" },
  ],
  "voice:retell": [
    { key: "apiKey", label: "OmniVoice API Key", type: "password", required: false, placeholder: "Leave blank to use platform key" },
  ],
  "voice:openai": [
    { key: "apiKey", label: "OpenAI API Key", type: "password", required: true, placeholder: "sk-..." },
  ],
  "voice:elevenlabs": [
    { key: "apiKey", label: "ElevenLabs API Key", type: "password", required: true, placeholder: "sk_..." },
  ],
  "telephony:frejun": [
    { key: "apiKey", label: "FreJun API Key", type: "password", required: true, placeholder: "Token …" },
  ],
  "telephony:twilio": [
    { key: "accountSid", label: "Account SID", type: "text", required: true, placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { key: "authToken", label: "Auth Token", type: "password", required: true },
    { key: "from", label: "From Phone Number", type: "text", required: false, placeholder: "+15551234567" },
  ],
  "whatsapp:twilio": [
    { key: "accountSid", label: "Account SID", type: "text", required: true, placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { key: "authToken", label: "Auth Token", type: "password", required: true },
    { key: "from", label: "WhatsApp From Number", type: "text", required: false, placeholder: "+15551234567" },
  ],
  "whatsapp:meta": [
    { key: "accessToken",   label: "Permanent Access Token",     type: "password", required: true,  placeholder: "EAAxxxxx… (System User or Business token)" },
    { key: "phoneNumberId", label: "Phone Number ID",            type: "text",     required: true,  placeholder: "1234567890123456" },
    { key: "wabaId",        label: "WhatsApp Business Account ID (WABA)", type: "text", required: false, placeholder: "9876543210987654" },
    { key: "verifyToken",   label: "Webhook Verify Token",       type: "text",     required: false, placeholder: "any secret string you choose" },
  ],
  "image:gpt_image": [
    { key: "apiKey", label: "OpenAI API Key", type: "password", required: false, placeholder: "Leave blank to use LLM OpenAI key" },
  ],
  "crm:hubspot": [
    { key: "apiKey", label: "HubSpot Private App Token", type: "password", required: true, placeholder: "pat-na1-..." },
  ],
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
        <CheckCircle2 className="h-2.5 w-2.5" /> Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-400">
        <AlertTriangle className="h-2.5 w-2.5" /> Error
      </span>
    );
  }
  if (status === "coming_soon") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        <Clock className="h-2.5 w-2.5" /> Coming soon
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <XCircle className="h-2.5 w-2.5" /> Disconnected
    </span>
  );
}

function PriorityBadge({ isDefault, isFallback }: { isDefault?: boolean; isFallback?: boolean }) {
  if (isDefault) return (
    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] bg-violet-500/15 text-violet-400">Primary</span>
  );
  if (isFallback) return (
    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] bg-blue-500/15 text-blue-400">Fallback</span>
  );
  return null;
}

// ── Inline Credential Form ────────────────────────────────────────────────────

function CredentialForm({
  category,
  providerName,
  fields,
  onSaved,
  onClose,
}: {
  category: string;
  providerName: string;
  fields: CredField[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const saveFn   = useServerFn(saveProviderCredentials);
  const testFn   = useServerFn(testProviderConnection);
  const [values, setValues]       = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.key, ""])),
  );
  const [shown, setShown]         = useState<Record<string, boolean>>({});
  const [saving, setSaving]       = useState(false);
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; error?: string } | null>(null);

  async function handleSave() {
    setSaving(true);
    try {
      await saveFn({ data: { category, providerName, credentials: values } });
      toast.success("Credentials saved");
      onSaved();
    } catch (e: any) {
      toast.error("Save failed", { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // Save first so the health check can load the latest credentials
      await saveFn({ data: { category, providerName, credentials: values } });
      const result = await testFn({ data: { category, providerName } });
      setTestResult(result);
      if (result.ok) {
        toast.success(`Connection verified in ${result.latencyMs}ms`);
        onSaved();
      } else {
        toast.error("Connection failed", { description: result.error ?? "Check your credentials and try again." });
      }
    } catch (e: any) {
      setTestResult({ ok: false, latencyMs: 0, error: e?.message });
      toast.error("Test failed", { description: e?.message });
    } finally {
      setTesting(false);
    }
  }

  const requiredFilled = fields.filter(f => f.required).every(f => values[f.key]?.trim());

  return (
    <div className="mt-3 rounded-lg border border-white/[0.08] bg-black/20 p-3 space-y-2.5">
      {fields.map((field) => (
        <div key={field.key}>
          <Label className="text-[10px] font-medium text-muted-foreground mb-1 block">
            {field.label}{field.required && <span className="text-red-400 ml-0.5">*</span>}
          </Label>
          <div className="relative">
            <Input
              type={field.type === "password" && !shown[field.key] ? "password" : "text"}
              placeholder={field.placeholder ?? ""}
              value={values[field.key] ?? ""}
              onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
              className="h-7 text-xs pr-8 font-mono bg-background/60"
              autoComplete="off"
              data-1p-ignore
            />
            {field.type === "password" && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShown(s => ({ ...s, [field.key]: !s[field.key] }))}
              >
                {shown[field.key] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            )}
          </div>
        </div>
      ))}

      {testResult && (
        <div className={cn(
          "rounded px-2.5 py-1.5 text-[10px] flex items-center gap-1.5",
          testResult.ok
            ? "bg-emerald-500/10 text-emerald-400"
            : "bg-red-500/10 text-red-400",
        )}>
          {testResult.ok
            ? <><CheckCircle2 className="h-3 w-3" /> Connected — {testResult.latencyMs}ms</>
            : <><AlertTriangle className="h-3 w-3" /> {testResult.error ?? "Failed"}</>
          }
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-0.5">
        <Button
          size="sm"
          className="h-6 px-2 text-[10px] gap-1"
          disabled={!requiredFilled || saving || testing}
          onClick={handleTest}
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
          Test Connection
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px] gap-1"
          disabled={!requiredFilled || saving || testing}
          onClick={handleSave}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
        <button
          type="button"
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Usage Stats Mini-Grid ─────────────────────────────────────────────────────

function UsageStatsBar({ stats }: { stats: ProviderUsageStat }) {
  if (stats.requests === 0) {
    return (
      <p className="text-[10px] text-muted-foreground/50 mb-2 italic">No usage in the last 30 days</p>
    );
  }

  const fmtLatency = stats.avgLatencyMs >= 1000
    ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s`
    : `${stats.avgLatencyMs}ms`;

  const fmtCost = stats.totalCostUsd === 0
    ? "$0"
    : stats.totalCostUsd < 0.01
    ? `$${stats.totalCostUsd.toFixed(5)}`
    : `$${stats.totalCostUsd.toFixed(4)}`;

  return (
    <div className="mb-2">
      <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-1">Last 30 days</p>
    <div className="grid grid-cols-4 gap-px rounded-lg border border-white/[0.06] bg-white/[0.03] overflow-hidden">
      <div className="flex flex-col items-center py-1.5 px-1 bg-black/10">
        <span className="text-[11px] font-semibold tabular-nums leading-none">
          {stats.requests >= 1000
            ? `${(stats.requests / 1000).toFixed(1)}k`
            : stats.requests.toLocaleString()}
        </span>
        <span className="text-[9px] text-muted-foreground/70 mt-0.5">calls</span>
      </div>
      <div className="flex flex-col items-center py-1.5 px-1 bg-black/10">
        <span className="text-[11px] font-semibold tabular-nums leading-none text-emerald-400">
          {fmtCost}
        </span>
        <span className="text-[9px] text-muted-foreground/70 mt-0.5">cost</span>
      </div>
      <div className="flex flex-col items-center py-1.5 px-1 bg-black/10">
        <span className={cn(
          "text-[11px] font-semibold tabular-nums leading-none",
          stats.errorRatePct > 5 ? "text-red-400" : stats.errorRatePct > 1 ? "text-amber-400" : "text-foreground",
        )}>
          {stats.errorRatePct < 0.1 ? "0%" : `${stats.errorRatePct.toFixed(1)}%`}
        </span>
        <span className="text-[9px] text-muted-foreground/70 mt-0.5">errors</span>
      </div>
      <div className="flex flex-col items-center py-1.5 px-1 bg-black/10">
        <span className={cn(
          "text-[11px] font-semibold tabular-nums leading-none",
          stats.avgLatencyMs > 3000 ? "text-amber-400" : "text-foreground",
        )}>
          {stats.avgLatencyMs === 0 ? "—" : fmtLatency}
        </span>
        <span className="text-[9px] text-muted-foreground/70 mt-0.5">avg latency</span>
      </div>
    </div>
    </div>
  );
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  category,
  stats,
  onSetPrimary,
  onSetFallback,
  onDisable,
  isPending,
  onCredentialSaved,
}: {
  provider: any;
  category: string;
  stats: ProviderUsageStat | undefined;
  onSetPrimary: () => void;
  onSetFallback: () => void;
  onDisable: () => void;
  isPending: boolean;
  onCredentialSaved: () => void;
}) {
  const isConnected  = provider.status === "connected";
  const isComingSoon = provider.status === "coming_soon";
  const credKey      = `${category}:${provider.name}`;
  const credFields   = CREDENTIAL_FIELDS[credKey];
  const [formOpen,      setFormOpen]      = useState(false);
  const [costRateOpen,  setCostRateOpen]  = useState(false);

  // Test Connection button for already-connected providers
  const testFn = useServerFn(testProviderConnection);
  const [testing, setTesting] = useState(false);

  async function handleTestExisting() {
    setTesting(true);
    try {
      const result = await testFn({ data: { category, providerName: provider.name } });
      if (result.ok) {
        toast.success(`${provider.label} connected — ${result.latencyMs}ms`);
      } else {
        toast.error(`${provider.label} unreachable`, { description: result.error ?? "Check credentials." });
      }
      onCredentialSaved();
    } catch (e: any) {
      toast.error("Test failed", { description: e?.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5 transition-colors",
        isConnected  ? "border-emerald-500/15 bg-emerald-500/[0.03]" :
        isComingSoon ? "border-white/[0.04] bg-white/[0.01] opacity-60" :
        formOpen     ? "border-violet-500/20 bg-violet-500/[0.02]" :
        "border-white/[0.05] bg-white/[0.02]",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold leading-tight">{provider.label}</p>
          <PriorityBadge isDefault={provider.isDefault} isFallback={provider.isFallback} />
        </div>
        <StatusBadge status={provider.status} />
      </div>

      <p className="text-[11px] text-muted-foreground leading-snug mb-2">{provider.description}</p>

      {isConnected && (
        <UsageStatsBar stats={stats ?? { requests: 0, errors: 0, errorRatePct: 0, totalCostUsd: 0, avgLatencyMs: 0, lastUsedAt: null }} />
      )}

      {/* Controls for connected providers */}
      {isConnected && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.05]">
          <Button
            size="sm"
            variant={provider.isDefault ? "secondary" : "ghost"}
            className="h-5 px-1.5 text-[10px] gap-1"
            disabled={isPending || provider.isDefault}
            onClick={onSetPrimary}
          >
            <Star className="h-2.5 w-2.5" />
            {provider.isDefault ? "Primary" : "Set Primary"}
          </Button>
          <Button
            size="sm"
            variant={provider.isFallback ? "secondary" : "ghost"}
            className="h-5 px-1.5 text-[10px] gap-1"
            disabled={isPending || provider.isFallback}
            onClick={onSetFallback}
          >
            <ArrowDownToLine className="h-2.5 w-2.5" />
            {provider.isFallback ? "Fallback" : "Set Fallback"}
          </Button>
          {credFields && (
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px] gap-1"
              disabled={testing}
              onClick={handleTestExisting}
            >
              {testing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <FlaskConical className="h-2.5 w-2.5" />}
              Test
            </Button>
          )}
          <Button
            size="sm"
            variant={costRateOpen ? "secondary" : "ghost"}
            className="h-5 px-1.5 text-[10px] gap-1"
            onClick={() => setCostRateOpen(o => !o)}
          >
            <DollarSign className="h-2.5 w-2.5" />
            Cost Rate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[10px] gap-1 ml-auto text-red-400/70 hover:text-red-400"
            disabled={isPending}
            onClick={onDisable}
          >
            <PowerOff className="h-2.5 w-2.5" />
            Disable
          </Button>
        </div>
      )}
      {isConnected && costRateOpen && (
        <CostRateInline
          category={category}
          providerName={provider.name}
          onClose={() => setCostRateOpen(false)}
        />
      )}

      {/* Configure button for any non-connected provider with a credential form */}
      {!isConnected && credFields && (
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-0.5"
          onClick={() => setFormOpen(o => !o)}
        >
          {formOpen
            ? <><ChevronUp className="h-3 w-3" /> Close</>
            : <><ChevronDown className="h-3 w-3" /> Configure credentials</>
          }
        </button>
      )}

      {/* Redirect link for providers without inline form */}
      {!isConnected && !isComingSoon && !credFields && (
        <Link
          to={getSetupLink(category, provider.name)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-0.5"
        >
          <ChevronDown className="h-3 w-3" />
          Configure →
        </Link>
      )}

      {/* Inline credential form */}
      {formOpen && credFields && (
        <CredentialForm
          category={category}
          providerName={provider.name}
          fields={credFields}
          onSaved={() => { setFormOpen(false); onCredentialSaved(); }}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}

// ── Cost Rate Inline Form ──────────────────────────────────────────────────────

const UNIT_TYPE_OPTIONS = [
  { value: "email",         label: "per email" },
  { value: "image",         label: "per image" },
  { value: "video_seconds", label: "per video second" },
  { value: "whatsapp",      label: "per WhatsApp msg" },
  { value: "api_call",      label: "per API call" },
  { value: "sync",          label: "per sync" },
  { value: "minute",        label: "per minute" },
  { value: "token_1k",      label: "per 1k tokens" },
];

function CostRateInline({
  category,
  providerName,
  onClose,
}: {
  category: string;
  providerName: string;
  onClose: () => void;
}) {
  const saveFn = useServerFn(saveProviderCostRate);
  const [unitType, setUnitType]   = useState("api_call");
  const [costUsd, setCostUsd]     = useState("");
  const [notes,   setNotes]       = useState("");
  const [saving,  setSaving]      = useState(false);

  async function handleSave() {
    const cost = parseFloat(costUsd);
    if (isNaN(cost) || cost < 0) { toast.error("Enter a valid cost ≥ 0"); return; }
    setSaving(true);
    try {
      await saveFn({ data: {
        provider_category: category,
        provider_name:     providerName,
        unit_type:         unitType,
        cost_per_unit_usd: cost,
        notes:             notes || undefined,
      }});
      toast.success("Cost rate saved");
      onClose();
    } catch (e: any) {
      toast.error("Save failed", { description: e?.message });
    } finally { setSaving(false); }
  }

  return (
    <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/20 p-3 space-y-2">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Cost Rate Override</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-[10px] text-muted-foreground mb-1 block">Unit Type</Label>
          <select
            value={unitType}
            onChange={e => setUnitType(e.target.value)}
            className="w-full h-7 rounded-md border border-input bg-background/60 px-2 text-xs text-foreground"
          >
            {UNIT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="w-28">
          <Label className="text-[10px] text-muted-foreground mb-1 block">Cost (USD)</Label>
          <Input
            type="number" min="0" step="0.000001"
            value={costUsd}
            onChange={e => setCostUsd(e.target.value)}
            placeholder="0.0001"
            className="h-7 text-xs bg-background/60"
          />
        </div>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground mb-1 block">Notes (optional)</Label>
        <Input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Tier 2 plan rate"
          className="h-7 text-xs bg-background/60"
        />
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        <Button
          size="sm" className="h-6 px-2 text-[10px] gap-1"
          disabled={!costUsd || saving}
          onClick={handleSave}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save Rate
        </Button>
        <button type="button" className="ml-auto text-[10px] text-muted-foreground hover:text-foreground" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function getSetupLink(category: string, providerName: string): string {
  const overrides: Record<string, string> = {
    "telephony:twilio":  "/telephony-settings",
    "whatsapp:wati":     "/whatsapp",
    "crm:hubspot":       "/settings/crm",
    "crm:gohighlevel":   "/settings/crm",
    "calendar:calcom":   "/settings/calendar",
    "knowledge:retell_kb": "/builder",
    "knowledge:weebee_kb": "/builder",
  };
  const key = `${category}:${providerName}`;
  return overrides[key] ?? "/settings/integrations";
}

// ── Main Page ─────────────────────────────────────────────────────────────────

function ProvidersSettingsPage() {
  const getFn              = useServerFn(getProviderRegistryData);
  const getStatsFn         = useServerFn(getProviderUsageStats);
  const updatePriorityFn   = useServerFn(updateProviderPriority);
  const toggleEnabledFn    = useServerFn(toggleProviderEnabled);
  const refreshHealthFn    = useServerFn(refreshAllProviderHealth);
  const [sweeping, setSweeping] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["provider-registry"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const { data: usageStats } = useQuery({
    queryKey: ["provider-usage-stats"],
    queryFn: () => getStatsFn(),
    staleTime: 120_000,
  });

  const mutation = useMutation({
    mutationFn: async (
      action:
        | { type: "priority"; category: string; providerName: string; role: "primary" | "fallback" | "none" }
        | { type: "toggle";   category: string; providerName: string; enabled: boolean },
    ) => {
      if (action.type === "priority") {
        await updatePriorityFn({ data: { category: action.category, providerName: action.providerName, role: action.role } });
      } else {
        await toggleEnabledFn({ data: { category: action.category, providerName: action.providerName, enabled: action.enabled } });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["provider-registry"] });
      toast.success("Provider setting saved");
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Failed to update provider setting");
    },
  });

  const totalConnected = data?.totalConnected ?? 0;
  const totalProviders = data?.totalProviders ?? 0;
  const totalSpend     = data?.totalSpend     ?? 0;
  const recentErrors   = data?.recentErrors   ?? 0;
  const categoryOrder  = Object.keys(CATEGORY_META);

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">

        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/settings/integrations">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div className="flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Settings</p>
            <h1 className="text-2xl font-semibold tracking-tight">Provider Registry</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              All third-party integrations across every platform capability. Set primary and fallback providers per category.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={sweeping}
            onClick={async () => {
              setSweeping(true);
              try {
                const result = await refreshHealthFn();
                if (result.checked > 0) {
                  toast.success(`Health sweep: ${result.passed}/${result.checked} passed`);
                } else {
                  toast.info("No configured providers to sweep — save credentials first");
                }
              } catch {
                toast.info("Refreshing registry from database");
              } finally {
                setSweeping(false);
                qc.invalidateQueries({ queryKey: ["provider-registry"] });
                qc.invalidateQueries({ queryKey: ["provider-usage-stats"] });
              }
            }}
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", (isFetching || sweeping) && "animate-spin")} />
            {sweeping ? "Checking…" : "Refresh"}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-32 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
            <span className="text-sm">Loading provider registry…</span>
          </div>
        ) : (
          <div className="space-y-8">

            {/* Summary row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Providers",   value: `${totalConnected}/${totalProviders}`, sub: "connected",      icon: Zap,           color: "text-violet-400" },
                { label: "Categories",  value: String(categoryOrder.length),          sub: "capability areas", icon: Database,     color: "text-blue-400"   },
                { label: "Total Spend", value: `$${totalSpend.toFixed(4)}`,           sub: "all time",        icon: DollarSign,    color: "text-emerald-400" },
                { label: "Errors",      value: String(recentErrors),                  sub: "all time",        icon: AlertTriangle, color: recentErrors > 0 ? "text-red-400" : "text-muted-foreground" },
              ].map((card) => (
                <div key={card.label} className="rounded-xl border border-white/[0.06] bg-card/60 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <card.icon className={cn("h-3.5 w-3.5", card.color)} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{card.label}</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums">{card.value}</p>
                  <p className="text-[10px] text-muted-foreground">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Category sections */}
            {categoryOrder.map((cat) => {
              const meta    = CATEGORY_META[cat];
              const summary = data?.byCategory[cat];
              if (!summary) return null;
              const Icon   = meta.icon;
              const sorted = [...summary.providers].sort(
                (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
              );

              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06]">
                      <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                    </div>
                    <h2 className="text-sm font-semibold">{meta.label}</h2>
                    <span className="text-[10px] text-muted-foreground">
                      {summary.connectedCount}/{summary.totalCount} connected
                    </span>
                    {summary.totalSpend > 0 && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        ${summary.totalSpend.toFixed(4)} spend
                      </span>
                    )}
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {sorted.map((provider) => (
                      <ProviderCard
                        key={provider.name}
                        provider={provider}
                        category={cat}
                        stats={usageStats?.[`${cat}:${provider.name}`]}
                        isPending={mutation.isPending}
                        onCredentialSaved={() => {
                          qc.invalidateQueries({ queryKey: ["provider-registry"] });
                          qc.invalidateQueries({ queryKey: ["provider-usage-stats"] });
                        }}
                        onSetPrimary={() =>
                          mutation.mutate({ type: "priority", category: cat, providerName: provider.name, role: "primary" })
                        }
                        onSetFallback={() =>
                          mutation.mutate({ type: "priority", category: cat, providerName: provider.name, role: "fallback" })
                        }
                        onDisable={() =>
                          mutation.mutate({ type: "toggle", category: cat, providerName: provider.name, enabled: false })
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}


          </div>
        )}
      </div>
    </main>
  );
}
