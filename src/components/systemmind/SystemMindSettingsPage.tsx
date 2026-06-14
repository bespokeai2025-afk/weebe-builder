import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Settings2, Loader2, CheckCircle2, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import {
  getSystemMindCTOSettings,
  saveSystemMindCTOSettings,
} from "@/lib/systemmind/systemmind-cto.functions";

type Settings = {
  persona: "professional" | "concise" | "friendly";
  morningBriefing: boolean;
  autoScanInterval: "off" | "daily" | "weekly";
  errorRateThreshold: number;
  costDailyThreshold: number;
  defaultAiModel: "gpt-4o-mini" | "gpt-4o" | "gpt-3.5-turbo";
  notificationsEnabled: boolean;
  providerPriority: string[];
};

const DEFAULT_PROVIDER_PRIORITY = [
  "openai", "retell", "elevenlabs", "twilio", "whatsapp", "wati",
  "hubspot", "ghl", "stripe", "calcom", "resend",
];

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI", retell: "Retell AI", elevenlabs: "ElevenLabs",
  twilio: "Twilio", whatsapp: "WhatsApp (Meta)", wati: "WATI (WhatsApp)",
  hubspot: "HubSpot CRM", ghl: "GoHighLevel", stripe: "Stripe",
  calcom: "Cal.com", resend: "Resend (email)",
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3 py-4 border-b border-white/[0.05] last:border-0">
      <div className="sm:w-52 shrink-0">
        <p className="text-xs font-medium">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function SelectField({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        checked ? "bg-sky-500" : "bg-white/[0.12]",
      )}
    >
      <span className={cn(
        "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
        checked ? "translate-x-5" : "translate-x-0.5",
      )} />
    </button>
  );
}

function ProviderPriorityList({
  priority, onChange,
}: { priority: string[]; onChange: (p: string[]) => void }) {
  function move(idx: number, dir: -1 | 1) {
    const next = [...priority];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  }

  const list = priority.length ? priority : DEFAULT_PROVIDER_PRIORITY;

  return (
    <div className="space-y-1.5 max-w-sm">
      {list.map((id, idx) => (
        <div key={id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <span className="text-[10px] text-muted-foreground/50 w-5 shrink-0 text-right">{idx + 1}</span>
          <span className="flex-1 text-xs truncate">{PROVIDER_LABELS[id] ?? id}</span>
          <div className="flex gap-0.5 shrink-0">
            <button
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => move(idx, 1)}
              disabled={idx === list.length - 1}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SystemMindSettingsPage() {
  const getFn = useServerFn(getSystemMindCTOSettings);
  const saveFn = useServerFn(saveSystemMindCTOSettings);
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings>({
    persona: "professional",
    morningBriefing: false,
    autoScanInterval: "off",
    errorRateThreshold: 5,
    costDailyThreshold: 50,
    defaultAiModel: "gpt-4o-mini",
    notificationsEnabled: true,
    providerPriority: DEFAULT_PROVIDER_PRIORITY,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["systemmind-cto-settings"],
    queryFn: () => getFn(),
  });

  useEffect(() => {
    if (settings) setForm((f) => ({ ...f, ...(settings as Settings) }));
  }, [settings]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await saveFn({ data: form });
      qc.invalidateQueries({ queryKey: ["systemmind-cto-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/15 ring-1 ring-slate-500/25">
              <Settings2 className="h-5 w-5 text-slate-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">CTO Settings</h1>
              <p className="text-xs text-muted-foreground">SystemMind preferences, thresholds, and behaviour</p>
            </div>
          </div>
          <Button size="sm" onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-500 text-white">
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : saved ? <><CheckCircle2 className="h-3.5 w-3.5" /> Saved!</> : "Save Settings"}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* AI Persona */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 pt-4 pb-2">AI Persona</p>

              <Row label="Chat style" hint="How SystemMind responds in the Chat view.">
                <SelectField
                  value={form.persona}
                  onChange={(v) => set("persona", v as Settings["persona"])}
                  options={[
                    { value: "professional", label: "Professional — technical, risk-aware" },
                    { value: "concise",      label: "Concise — direct, bullet-pointed" },
                    { value: "friendly",     label: "Friendly — warm and practical" },
                  ]}
                />
              </Row>

              <Row label="Default AI model" hint="Model used for CTO chat and report generation.">
                <SelectField
                  value={form.defaultAiModel}
                  onChange={(v) => set("defaultAiModel", v as Settings["defaultAiModel"])}
                  options={[
                    { value: "gpt-4o-mini", label: "GPT-4o-mini — fast & economical (default)" },
                    { value: "gpt-4o",      label: "GPT-4o — most capable" },
                    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo — legacy" },
                  ]}
                />
              </Row>
            </div>

            {/* Automation */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 pt-4 pb-2">Automation</p>

              <Row label="Morning briefing" hint="Generate a daily technical briefing on first login.">
                <Toggle checked={form.morningBriefing} onChange={(v) => set("morningBriefing", v)} />
              </Row>

              <Row label="Auto-scan interval" hint="Automatically scan workflows and surface new issues.">
                <SelectField
                  value={form.autoScanInterval}
                  onChange={(v) => set("autoScanInterval", v as Settings["autoScanInterval"])}
                  options={[
                    { value: "off",    label: "Off — manual only" },
                    { value: "daily",  label: "Daily" },
                    { value: "weekly", label: "Weekly" },
                  ]}
                />
              </Row>

              <Row label="Notifications" hint="Show in-app alerts for critical issues and audit completions.">
                <Toggle checked={form.notificationsEnabled} onChange={(v) => set("notificationsEnabled", v)} />
              </Row>
            </div>

            {/* Alert Thresholds */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 pt-4 pb-2">Alert Thresholds</p>

              <Row label="Error rate threshold" hint="Flag providers with an error rate above this percentage.">
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} max={100}
                    value={form.errorRateThreshold}
                    onChange={(e) => set("errorRateThreshold", Number(e.target.value))}
                    className="w-20 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
              </Row>

              <Row label="Daily cost threshold" hint="Alert if runtime cost exceeds this amount per day.">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">$</span>
                  <input
                    type="number" min={1}
                    value={form.costDailyThreshold}
                    onChange={(e) => set("costDailyThreshold", Number(e.target.value))}
                    className="w-24 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
                  />
                  <span className="text-xs text-muted-foreground">per day</span>
                </div>
              </Row>
            </div>

            {/* Provider Priority */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 pt-4 pb-2">Provider Priority</p>
              <div className="pb-4">
                <p className="text-[11px] text-muted-foreground mb-3">
                  Ordered list of providers for fallback resolution. Use the arrows to reorder.
                </p>
                <ProviderPriorityList
                  priority={form.providerPriority}
                  onChange={(p) => set("providerPriority", p)}
                />
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
          <p className="text-xs font-semibold mb-1">About SystemMind</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            SystemMind is your AI Chief Technology Officer. It monitors platform reliability, provider health, agent workflows, runtime costs, and security posture. It reports to HiveMind (COO) and coordinates technical recommendations across the executive layer.
          </p>
        </div>
      </div>
    </SystemMindShell>
  );
}
