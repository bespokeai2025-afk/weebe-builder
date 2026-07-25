// GrowthMind → Settings — autonomy mode (Observe / Recommend / Assistant /
// Operator) + operator permissions + activity log. Mirrors HiveMind settings.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings2, Loader2, Eye, Lightbulb, Wand2, Zap, ScrollText, ShieldAlert, ShieldCheck, X, Plus } from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getGrowthMindMode, setGrowthMindMode, getGrowthMindActivityLog,
  GROWTHMIND_MODE_LABELS, type GrowthMindMode,
} from "@/lib/growthmind/growthmind.mode";
import { getContentApprovalRules, setContentApprovalRules } from "@/lib/growthmind/growthmind.content-projects";
import { DEFAULT_APPROVAL_RULES, type ApprovalRuleConfig } from "@/lib/growthmind/content-approval.shared";

export const Route = createFileRoute("/_authenticated/growthmind/settings")({
  component: () => (
    <GrowthMindShell>
      <GrowthMindSettingsPage />
    </GrowthMindShell>
  ),
});

const MODE_ICONS: Record<GrowthMindMode, any> = {
  observe: Eye, recommend: Lightbulb, assistant: Wand2, operator: Zap,
};

const OPERATOR_PERMISSION_LABELS: Record<string, { label: string; description: string }> = {
  auto_schedule_low_risk: {
    label: "Auto-schedule low-risk content",
    description: "GrowthMind may schedule approved, low-risk content into the calendar without asking each time.",
  },
  auto_publish_approved: {
    label: "Auto-publish pre-approved content",
    description: "GrowthMind may publish content you have already approved, at the scheduled time.",
  },
};

const APPROVAL_RULE_LABELS: { key: keyof Omit<ApprovalRuleConfig, "restricted_terms">; label: string; description: string }[] = [
  {
    key: "always_require_approval",
    label: "Always require approval",
    description: "Every publish needs explicit human approval, regardless of content or autonomy mode.",
  },
  {
    key: "claims_require_approval",
    label: "Marketing claims",
    description: "Content containing product, health or income claims (e.g. \"guaranteed\", \"clinically proven\") requires approval.",
  },
  {
    key: "pricing_require_approval",
    label: "Pricing & offers",
    description: "Content mentioning prices, discounts or offers requires approval.",
  },
  {
    key: "ai_media_require_approval",
    label: "AI-generated media",
    description: "Content using an AI-generated spokesperson, voice or media requires approval.",
  },
];

function GrowthMindSettingsPage() {
  const modeFn     = useServerFn(getGrowthMindMode);
  const setModeFn  = useServerFn(setGrowthMindMode);
  const activityFn = useServerFn(getGrowthMindActivityLog);
  const qc = useQueryClient();

  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: modeData } = useQuery({
    queryKey: ["growthmind-mode"],
    queryFn:  () => modeFn(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const mode: GrowthMindMode = modeData?.mode ?? "recommend";
  const operatorPermissions  = modeData?.operatorPermissions ?? {};

  const { data: activityData } = useQuery({
    queryKey: ["growthmind-activity-log"],
    queryFn:  () => activityFn({ data: { limit: 50 } }),
    staleTime: 60_000,
    throwOnError: false,
  });
  const entries = activityData?.entries ?? [];

  const rulesFn    = useServerFn(getContentApprovalRules);
  const setRulesFn = useServerFn(setContentApprovalRules);
  const [savingRules, setSavingRules] = useState(false);
  const [newTerm, setNewTerm] = useState("");

  const { data: rulesData } = useQuery({
    queryKey: ["growthmind-approval-rules"],
    queryFn:  () => rulesFn(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const rules: ApprovalRuleConfig = rulesData?.rules ?? DEFAULT_APPROVAL_RULES;

  async function saveRules(next: ApprovalRuleConfig) {
    setSavingRules(true);
    try {
      await setRulesFn({ data: next });
      await qc.invalidateQueries({ queryKey: ["growthmind-approval-rules"] });
      toast.success("Approval rules updated");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update approval rules");
    } finally {
      setSavingRules(false);
    }
  }

  function addTerm() {
    const term = newTerm.trim();
    if (!term) return;
    if (term.length > 100) { toast.error("Terms must be 100 characters or fewer"); return; }
    if (rules.restricted_terms.some(t => t.toLowerCase() === term.toLowerCase())) {
      toast.error("That term is already in the list");
      return;
    }
    if (rules.restricted_terms.length >= 50) { toast.error("You can add up to 50 restricted terms"); return; }
    setNewTerm("");
    void saveRules({ ...rules, restricted_terms: [...rules.restricted_terms, term] });
  }

  async function applyMode(m: GrowthMindMode, perms?: Record<string, boolean>) {
    setSaving(true);
    try {
      await setModeFn({ data: { mode: m, ...(m === "operator" ? { operatorPermissions: perms ?? operatorPermissions } : {}) } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["growthmind-mode"] }),
        qc.invalidateQueries({ queryKey: ["growthmind-activity-log"] }),
      ]);
      toast.success(`GrowthMind mode set to ${GROWTHMIND_MODE_LABELS[m].label}`);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to change mode");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
          <Settings2 className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold">GrowthMind Settings</h1>
          <p className="text-xs text-muted-foreground">Control how autonomously GrowthMind is allowed to act</p>
        </div>
      </div>

      {/* Autonomy mode */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold">Autonomy Mode</p>
          <p className="text-xs text-muted-foreground mt-0.5">Default is Recommend. GrowthMind never publishes anything without approval unless Operator mode is explicitly enabled.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {(Object.keys(GROWTHMIND_MODE_LABELS) as GrowthMindMode[]).map(key => {
            const Icon = MODE_ICONS[key];
            const meta = GROWTHMIND_MODE_LABELS[key];
            const active = mode === key;
            return (
              <button key={key} type="button" disabled={saving}
                onClick={() => applyMode(key)}
                className={cn(
                  "text-left rounded-lg border p-4 transition-colors",
                  active ? "border-emerald-500/50 bg-emerald-500/[0.08]" : "border-white/[0.06] bg-background/40 hover:bg-white/[0.03]",
                )}>
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", active ? "text-emerald-400" : "text-muted-foreground")} />
                  <p className="text-sm font-medium">{meta.label}</p>
                  {key === "operator" && <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />}
                  {saving && active && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">{meta.description}</p>
              </button>
            );
          })}
        </div>

        {mode === "operator" && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-4 space-y-3">
            <p className="text-xs font-medium text-amber-300">Operator permissions — each is OFF until you enable it</p>
            {Object.entries(OPERATOR_PERMISSION_LABELS).map(([key, meta]) => (
              <div key={key} className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{meta.description}</p>
                </div>
                <Switch
                  checked={operatorPermissions[key] === true}
                  disabled={saving}
                  onCheckedChange={(checked) => applyMode("operator", { ...operatorPermissions, [key]: checked })}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content approval rules */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <div>
            <p className="text-sm font-semibold">Content Approval Rules</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When a rule triggers, that content always requires explicit human approval before publishing — regardless of autonomy mode. Only workspace owners and admins can change these.
            </p>
          </div>
          {savingRules && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />}
        </div>

        <div className="space-y-3">
          {APPROVAL_RULE_LABELS.map(({ key, label, description }) => (
            <div key={key} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium">{label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
              </div>
              <Switch
                checked={rules[key] === true}
                disabled={savingRules}
                onCheckedChange={(checked) => void saveRules({ ...rules, [key]: checked })}
              />
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-white/[0.06] bg-background/40 p-4 space-y-3">
          <div>
            <p className="text-xs font-medium">Restricted terms</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Extra words or phrases that force approval whenever they appear in content (case-insensitive). Up to 50 terms.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTerm(); } }}
              placeholder="Add a term, e.g. FDA approved"
              maxLength={100}
              disabled={savingRules}
              className="h-8 text-xs"
            />
            <Button size="sm" variant="secondary" className="h-8 px-3" disabled={savingRules || !newTerm.trim()} onClick={addTerm}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          {rules.restricted_terms.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No restricted terms yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {rules.restricted_terms.map((term) => (
                <span key={term} className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11px]">
                  {term}
                  <button
                    type="button"
                    disabled={savingRules}
                    aria-label={`Remove restricted term ${term}`}
                    onClick={() => void saveRules({ ...rules, restricted_terms: rules.restricted_terms.filter(t => t !== term) })}
                    className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity log */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Activity Log</p>
        </div>
        {entries.length === 0 && <p className="text-xs text-muted-foreground">No GrowthMind activity recorded yet.</p>}
        <div className="space-y-1.5">
          {entries.map((e: any) => (
            <div key={e.id} className="flex items-center justify-between gap-3 text-xs py-1 border-b border-white/[0.03] last:border-0">
              <div className="min-w-0">
                <p className="truncate">{e.summary ?? e.action}</p>
                <p className="text-[11px] text-muted-foreground">{e.actor} · {e.category}{e.mode_at_time ? ` · ${e.mode_at_time} mode` : ""}</p>
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{mounted ? new Date(e.created_at).toLocaleString() : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
