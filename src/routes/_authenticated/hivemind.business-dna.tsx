import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useCallback } from "react";
import {
  Dna, RefreshCw, CheckCircle2, AlertCircle, Info, Loader2,
  ChevronDown, ChevronRight, Building2, Users, TrendingUp,
  Megaphone, Target, Palette, Edit3, Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import {
  getBusinessDnaFn, updateBusinessDnaFn, runDnaDiscoveryFn,
} from "@/lib/hivemind/business-dna.functions";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";

export const Route = createFileRoute("/_authenticated/hivemind/business-dna")({
  head: () => ({ meta: [{ title: "Business DNA — HiveMind" }] }),
  component: BusinessDnaPage,
});

// ── Confidence bar ────────────────────────────────────────────────────────────
function ConfidenceBar({ score, source }: { score: number; source?: string }) {
  const pct   = Math.min(100, Math.max(0, score));
  const color  = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : pct >= 20 ? "bg-orange-500" : "bg-red-500/60";
  const label  = pct >= 80 ? "High" : pct >= 50 ? "Medium" : pct >= 20 ? "Low" : "Unknown";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden" style={{ minWidth: 60 }}>
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[10px] font-medium shrink-0", pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-muted-foreground/60")}>
        {label}
      </span>
      {source && (
        <span className="text-[9px] text-muted-foreground/50 shrink-0 hidden lg:block truncate max-w-[80px]" title={source}>
          {source}
        </span>
      )}
    </div>
  );
}

// ── Single editable field ────────────────────────────────────────────────────
function DnaField({
  label, fieldKey, value, confidence, source, lastUpdated, multiline = false, numeric = false,
  onSave,
}: {
  label: string; fieldKey: string; value: string | number | null | undefined;
  confidence?: number; source?: string; lastUpdated?: string;
  multiline?: boolean; numeric?: boolean;
  onSave: (key: string, val: string) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState("");
  const confScore               = confidence ?? 0;
  const displayVal              = value != null && value !== "" ? String(value) : null;

  function startEdit() {
    setDraft(displayVal ?? "");
    setEditing(true);
  }
  function commitSave() {
    onSave(fieldKey, draft);
    setEditing(false);
  }

  return (
    <div className="group border border-white/[0.06] rounded-xl bg-white/[0.02] p-3 hover:bg-white/[0.035] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          {lastUpdated && (
            <span className="text-[9px] text-muted-foreground/40 hidden sm:block">
              <RelativeTime date={lastUpdated} />
            </span>
          )}
          {!editing && (
            <button
              onClick={startEdit}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/[0.08]"
            >
              <Edit3 className="h-3 w-3 text-muted-foreground/60" />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-1.5">
          {multiline ? (
            <textarea
              autoFocus
              className="w-full bg-white/[0.04] border border-violet-500/30 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-violet-500/60 resize-none"
              rows={3}
              value={draft}
              onChange={e => setDraft(e.target.value)}
            />
          ) : (
            <input
              autoFocus
              type={numeric ? "number" : "text"}
              className="w-full bg-white/[0.04] border border-violet-500/30 rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-violet-500/60"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") commitSave(); if (e.key === "Escape") setEditing(false); }}
            />
          )}
          <div className="flex gap-1.5">
            <Button size="sm" className="h-6 text-[10px] px-2" onClick={commitSave}>
              <Save className="h-2.5 w-2.5 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {displayVal ? (
            <p className="text-xs text-foreground leading-relaxed line-clamp-3">{displayVal}</p>
          ) : (
            <p className="text-xs text-muted-foreground/40 italic">Not set — click to add or run Re-discover</p>
          )}
          <ConfidenceBar score={confScore} source={source} />
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────
function DnaSection({
  title, icon: Icon, color, children, defaultOpen = true,
}: {
  title: string; icon: React.ElementType; color: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[hsl(var(--card))] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg shrink-0", color)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="text-sm font-semibold flex-1 text-left">{title}</p>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Completeness gauge ────────────────────────────────────────────────────────
function CompletenessRing({ pct, grade }: { pct: number; grade: string }) {
  const r     = 32;
  const circ  = 2 * Math.PI * r;
  const dash  = (pct / 100) * circ;
  const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : pct >= 30 ? "#f97316" : "#ef4444";
  return (
    <div className="relative flex items-center justify-center" style={{ width: 88, height: 88 }}>
      <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="44" cy="44" r={r} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute text-center">
        <p className="text-lg font-bold leading-none" style={{ color }}>{pct}%</p>
        <p className="text-[9px] text-muted-foreground/60 mt-0.5">Grade {grade}</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function BusinessDnaPage() {
  const qc = useQueryClient();

  const getDnaFn  = useServerFn(getBusinessDnaFn);
  const updateFn  = useServerFn(updateBusinessDnaFn);
  const discoverFn = useServerFn(runDnaDiscoveryFn);

  const { data, isLoading } = useQuery({
    queryKey: ["business-dna"],
    queryFn: () => getDnaFn(),
    staleTime: 60_000,
  });
  const dna = data?.dna ?? {};
  const conf: Record<string, { score: number; source?: string; last_updated?: string }> =
    dna.confidence_scores ?? {};

  // Completeness calculation (fields with ≥30 confidence)
  const FIELD_KEYS_ALL = [
    "company_name","website","industry","sub_industry","services","products","pricing","offers",
    "locations","country","target_countries","ideal_customer_profiles","target_job_titles",
    "target_company_sizes","target_industries","target_markets","lead_sources",
    "unique_selling_points","competitors_summary","qualification_criteria","revenue_goals",
    "monthly_marketing_budget","main_growth_objective","sales_process","average_deal_value",
    "profit_margin_pct","best_customers","worst_customers","case_studies","brand_voice",
    "tone_of_voice","brand_style","compliance_notes","business_goals","marketing_goals",
    "current_ad_platforms","risk_tolerance","growth_targets",
  ];
  const filled   = FIELD_KEYS_ALL.filter(k => dna[k] && String(dna[k]).length > 0).length;
  const highConf = FIELD_KEYS_ALL.filter(k => (conf[k]?.score ?? 0) >= 60).length;
  const pct      = Math.round((filled / FIELD_KEYS_ALL.length) * 100);
  const grade    = pct >= 90 ? "A" : pct >= 70 ? "B" : pct >= 50 ? "C" : pct >= 30 ? "D" : "F";

  const saveMut = useMutation({
    mutationFn: (fields: Record<string, string>) =>
      updateFn({ data: { fields } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["business-dna"] }),
  });

  const discoverMut = useMutation({
    mutationFn: () => discoverFn(),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["business-dna"] });
    },
  });

  const handleSave = useCallback((key: string, val: string) => {
    saveMut.mutate({ [key]: val });
  }, [saveMut]);

  function fieldProps(key: string) {
    return {
      fieldKey: key,
      value: dna[key],
      confidence: conf[key]?.score ?? 0,
      source: conf[key]?.source,
      lastUpdated: conf[key]?.last_updated,
      onSave: handleSave,
    };
  }

  if (isLoading) {
    return (
      <HiveMindShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </HiveMindShell>
    );
  }

  return (
    <HiveMindShell>
      <div className="p-5 md:p-7 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-500/25">
              <Dna className="h-4.5 w-4.5 text-violet-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Business DNA</h1>
              <p className="text-xs text-muted-foreground">
                Auto-discovered from your calls, leads, campaigns, and knowledge bases
              </p>
            </div>
          </div>
          <Button
            onClick={() => discoverMut.mutate()}
            disabled={discoverMut.isPending}
            className="gap-2 bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/20"
            variant="outline"
          >
            {discoverMut.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Re-discover
          </Button>
        </div>

        {/* Discovery result banner */}
        {discoverMut.isSuccess && (discoverMut.data as any)?.updatedFields?.length > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-300">
              Updated {(discoverMut.data as any).updatedFields.length} fields: {(discoverMut.data as any).updatedFields.join(", ")}
            </p>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-6 rounded-2xl border border-white/[0.07] bg-[hsl(var(--card))] px-6 py-5">
          <CompletenessRing pct={pct} grade={grade} />
          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Fields Filled</p>
              <p className="text-xl font-bold">{filled}<span className="text-sm text-muted-foreground font-normal">/{FIELD_KEYS_ALL.length}</span></p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">High Confidence</p>
              <p className="text-xl font-bold text-emerald-400">{highConf}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Discovery Runs</p>
              <p className="text-xl font-bold">{dna.discovery_run_count ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Last Discovered</p>
              <p className="text-xs font-medium">
                {dna.last_discovery_at
                  ? <RelativeTime date={dna.last_discovery_at} />
                  : <span className="text-muted-foreground/50">Never</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Sections */}
        <DnaSection title="Company Identity" icon={Building2} color="bg-violet-500/15 text-violet-400">
          <DnaField label="Company Name"   multiline={false} {...fieldProps("company_name")} />
          <DnaField label="Website"        multiline={false} {...fieldProps("website")} />
          <DnaField label="Industry"       multiline={false} {...fieldProps("industry")} />
          <DnaField label="Sub-Industry"   multiline={false} {...fieldProps("sub_industry")} />
          <DnaField label="Country"        multiline={false} {...fieldProps("country")} />
          <DnaField label="Target Countries" multiline={false} {...fieldProps("target_countries")} />
          <DnaField label="Products"       multiline={true}  {...fieldProps("products")} />
          <DnaField label="Services"       multiline={true}  {...fieldProps("services")} />
          <DnaField label="Current Offers" multiline={true}  {...fieldProps("offers")} />
          <DnaField label="Locations"      multiline={false} {...fieldProps("locations")} />
        </DnaSection>

        <DnaSection title="Ideal Customer" icon={Users} color="bg-blue-500/15 text-blue-400">
          <DnaField label="Ideal Customer Profiles" multiline={true}  {...fieldProps("ideal_customer_profiles")} />
          <DnaField label="Target Job Titles"       multiline={false} {...fieldProps("target_job_titles")} />
          <DnaField label="Target Company Sizes"    multiline={false} {...fieldProps("target_company_sizes")} />
          <DnaField label="Target Industries"       multiline={false} {...fieldProps("target_industries")} />
          <DnaField label="Target Markets"          multiline={false} {...fieldProps("target_markets")} />
          <DnaField label="Lead Sources"            multiline={false} {...fieldProps("lead_sources")} />
          <DnaField label="Qualification Criteria"  multiline={true}  {...fieldProps("qualification_criteria")} />
          <DnaField label="Best Customers"          multiline={true}  {...fieldProps("best_customers")} />
          <DnaField label="Worst Customers"         multiline={true}  {...fieldProps("worst_customers")} />
        </DnaSection>

        <DnaSection title="Sales & Revenue" icon={TrendingUp} color="bg-emerald-500/15 text-emerald-400">
          <DnaField label="Revenue Goals"         multiline={true}  {...fieldProps("revenue_goals")} />
          <DnaField label="Growth Targets"        multiline={false} {...fieldProps("growth_targets")} />
          <DnaField label="Average Deal Value (£)" numeric={true}  {...fieldProps("average_deal_value")} />
          <DnaField label="Monthly Marketing Budget (£)" numeric={true} {...fieldProps("monthly_marketing_budget")} />
          <DnaField label="Profit Margin %"       numeric={true}  {...fieldProps("profit_margin_pct")} />
          <DnaField label="Main Growth Objective" multiline={true}  {...fieldProps("main_growth_objective")} />
          <DnaField label="Business Goals"        multiline={true}  {...fieldProps("business_goals")} />
          <DnaField label="Sales Process"         multiline={true}  {...fieldProps("sales_process")} />
          <DnaField label="Case Studies"          multiline={true}  {...fieldProps("case_studies")} />
          <DnaField label="Risk Tolerance"        multiline={false} {...fieldProps("risk_tolerance")} />
        </DnaSection>

        <DnaSection title="Marketing Channels" icon={Megaphone} color="bg-amber-500/15 text-amber-400">
          <DnaField label="Current Ad Platforms"  multiline={false} {...fieldProps("current_ad_platforms")} />
          <DnaField label="Current CRM"           multiline={false} {...fieldProps("current_crm")} />
          <DnaField label="Current Telephony"     multiline={false} {...fieldProps("current_telephony")} />
          <DnaField label="Current Analytics"     multiline={false} {...fieldProps("current_analytics")} />
          <DnaField label="Marketing Goals"       multiline={true}  {...fieldProps("marketing_goals")} />
          <DnaField label="Pricing"               multiline={true}  {...fieldProps("pricing")} />
        </DnaSection>

        <DnaSection title="Competitive Intelligence" icon={Target} color="bg-red-500/15 text-red-400">
          <DnaField label="Unique Selling Points"  multiline={true}  {...fieldProps("unique_selling_points")} />
          <DnaField label="Competitors Summary"    multiline={true}  {...fieldProps("competitors_summary")} />
        </DnaSection>

        <DnaSection title="Brand & Voice" icon={Palette} color="bg-pink-500/15 text-pink-400">
          <DnaField label="Brand Voice"      multiline={true}  {...fieldProps("brand_voice")} />
          <DnaField label="Tone of Voice"    multiline={false} {...fieldProps("tone_of_voice")} />
          <DnaField label="Brand Style"      multiline={false} {...fieldProps("brand_style")} />
          <DnaField label="Compliance Notes" multiline={true}  {...fieldProps("compliance_notes")} />
        </DnaSection>
      </div>
    </HiveMindShell>
  );
}
