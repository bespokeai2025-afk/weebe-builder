// Marketing Autonomy settings — level selector + guardrails editor.
// Self-contained: loads and saves via the marketing-actions server fns.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Lightbulb, ShieldCheck, Zap, Lock, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getMarketingAutonomy, setMarketingAutonomy } from "@/lib/marketing/marketing-actions.functions";
import {
  MARKETING_AUTONOMY_LEVELS,
  MARKETING_AUTONOMY_META,
  DEFAULT_MARKETING_GUARDRAILS,
  type MarketingAutonomyLevel,
  type MarketingGuardrails,
} from "@/lib/marketing/action-engine.shared";

const LEVEL_ICONS: Record<MarketingAutonomyLevel, React.ElementType> = {
  observe: Eye, recommend: Lightbulb, approval: ShieldCheck, autopilot: Zap,
};
const LEVEL_COLORS: Record<MarketingAutonomyLevel, { color: string; ring: string; bg: string }> = {
  observe:   { color: "text-slate-400",  ring: "ring-slate-500/30",  bg: "bg-slate-500/10" },
  recommend: { color: "text-blue-400",   ring: "ring-blue-500/30",   bg: "bg-blue-500/10" },
  approval:  { color: "text-violet-400", ring: "ring-violet-500/30", bg: "bg-violet-500/10" },
  autopilot: { color: "text-amber-400",  ring: "ring-amber-500/30",  bg: "bg-amber-500/10" },
};

function NumberField({ label, suffix, value, onChange, disabled, placeholder }: {
  label: string; suffix?: string; value: number | null;
  onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          className="w-28 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm outline-none focus:border-violet-500/50 disabled:opacity-50"
          value={value ?? ""}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value.trim();
            onChange(raw === "" ? null : Number(raw));
          }}
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

function ListField({ label, desc, value, onChange, disabled }: {
  label: string; desc: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <p className="text-[11px] text-muted-foreground">{desc}</p>
      <textarea
        rows={2}
        className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-sm outline-none focus:border-violet-500/50 disabled:opacity-50"
        value={value.join("\n")}
        disabled={disabled}
        placeholder="One per line"
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
      />
    </label>
  );
}

export function MarketingAutonomyCard() {
  const getFn = useServerFn(getMarketingAutonomy);
  const setFn = useServerFn(setMarketingAutonomy);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["marketing-autonomy"],
    queryFn: () => getFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const canManage = data?.canManage === true;
  const [level, setLevel] = useState<MarketingAutonomyLevel>("recommend");
  const [guardrails, setGuardrails] = useState<MarketingGuardrails>(DEFAULT_MARKETING_GUARDRAILS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data && !dirty) {
      setLevel(data.level);
      setGuardrails(data.guardrails);
    }
  }, [data, dirty]);

  function patchGuardrails(patch: Partial<MarketingGuardrails>) {
    setGuardrails((g) => ({ ...g, ...patch }));
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      await setFn({ data: { level, guardrails } });
      setDirty(false);
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["marketing-autonomy"] });
    } catch (e: any) {
      setError(e?.message || "Could not save marketing autonomy settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canManage && (
        <div className="flex items-center gap-2 rounded-md bg-white/[0.04] px-3 py-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> Only a workspace owner or admin can change these settings.
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {MARKETING_AUTONOMY_LEVELS.map((lv) => {
          const Icon = LEVEL_ICONS[lv];
          const c = LEVEL_COLORS[lv];
          const active = level === lv;
          return (
            <button
              key={lv}
              type="button"
              disabled={!canManage}
              onClick={() => { setLevel(lv); setDirty(true); setSaved(false); }}
              className={cn(
                "rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60",
                active ? cn("border-transparent ring-2", c.ring, c.bg) : "border-white/[0.08] hover:bg-white/[0.03]",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn("h-4 w-4", c.color)} />
                <span className="text-sm font-medium">{MARKETING_AUTONOMY_META[lv].label}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{MARKETING_AUTONOMY_META[lv].desc}</p>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-white/[0.08] p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold">Guardrails</p>
          <p className="text-xs text-muted-foreground">
            Hard limits on automated changes. High-risk actions (deleting campaigns, large targeting changes,
            site-wide SEO changes, tracking or attribution changes) always require your approval regardless of these settings.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Max daily budget per change" suffix="GBP per action (blank = no cap)" placeholder="No cap"
            value={guardrails.max_daily_ad_spend} disabled={!canManage}
            onChange={(v) => patchGuardrails({ max_daily_ad_spend: v })} />
          <NumberField label="Max automated actions per day" suffix="actions"
            value={guardrails.max_auto_actions_per_day} disabled={!canManage}
            onChange={(v) => patchGuardrails({ max_auto_actions_per_day: v ?? 0 })} />
          <NumberField label="Max auto budget increase" suffix="%"
            value={guardrails.max_auto_budget_increase_pct} disabled={!canManage}
            onChange={(v) => patchGuardrails({ max_auto_budget_increase_pct: v ?? 0 })} />
          <NumberField label="Max auto budget decrease" suffix="%"
            value={guardrails.max_auto_budget_decrease_pct} disabled={!canManage}
            onChange={(v) => patchGuardrails({ max_auto_budget_decrease_pct: v ?? 0 })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <ListField label="Protected campaigns" desc="Never auto-changed" value={guardrails.protected_campaigns}
            disabled={!canManage} onChange={(v) => patchGuardrails({ protected_campaigns: v })} />
          <ListField label="Protected keywords" desc="Never auto-changed" value={guardrails.protected_keywords}
            disabled={!canManage} onChange={(v) => patchGuardrails({ protected_keywords: v })} />
          <ListField label="Protected pages" desc="Never auto-changed" value={guardrails.protected_pages}
            disabled={!canManage} onChange={(v) => patchGuardrails({ protected_pages: v })} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canManage || !dirty || saving}
          onClick={save}
          className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save marketing autonomy
        </button>
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
        {data?.setBy && data?.setAt && (
          <span className="text-[11px] text-muted-foreground">
            Last set by {data.setBy} on {new Date(data.setAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
