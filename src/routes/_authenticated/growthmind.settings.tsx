// GrowthMind → Settings — autonomy mode (Observe / Recommend / Assistant /
// Operator) + operator permissions + activity log. Mirrors HiveMind settings.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings2, Loader2, Eye, Lightbulb, Wand2, Zap, ScrollText, ShieldAlert } from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getGrowthMindMode, setGrowthMindMode, getGrowthMindActivityLog,
  GROWTHMIND_MODE_LABELS, type GrowthMindMode,
} from "@/lib/growthmind/growthmind.mode";

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
