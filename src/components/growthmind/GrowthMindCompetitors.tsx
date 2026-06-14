import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Swords, Loader2, RefreshCw, Plus, Trash2, Edit2,
  Save, X, Sparkles, ExternalLink, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { HiveMindReportBanner } from "./HiveMindReportBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  analyseCompetitors,
  getCompetitors,
  saveCompetitor,
  deleteCompetitor,
  type Competitor,
} from "@/lib/growthmind/growthmind.competitors";

// ── Empty form ───────────────────────────────────────────────────────────────

const EMPTY: Omit<Competitor, "id" | "createdAt" | "updatedAt"> = {
  name: "", website: "", services: "", offers: "", positioning: "", observations: "",
};

// ── Competitor card ───────────────────────────────────────────────────────────

function CompetitorCard({
  competitor, onEdit, onDelete,
}: {
  competitor: Competitor;
  onEdit: (c: Competitor) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const fields = [
    { label: "Services",       value: competitor.services },
    { label: "Offers",         value: competitor.offers },
    { label: "Positioning",    value: competitor.positioning },
    { label: "Observations",   value: competitor.observations },
  ].filter(f => f.value.trim());

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/[0.05] shrink-0">
          <Swords className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{competitor.name}</p>
          {competitor.website && (
            <a
              href={competitor.website.startsWith("http") ? competitor.website : "https://" + competitor.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-emerald-400/70 hover:text-emerald-400 flex items-center gap-0.5 w-fit"
              onClick={e => e.stopPropagation()}
            >
              {competitor.website}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(competitor)}
          >
            <Edit2 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-red-400"
            onClick={() => onDelete(competitor.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </div>

      {/* Expanded details */}
      {open && fields.length > 0 && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
          {fields.map(f => (
            <div key={f.label}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60 mb-1">
                {f.label}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                {f.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {open && fields.length === 0 && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <p className="text-xs text-muted-foreground">No details added yet. Click edit to add competitive intelligence.</p>
        </div>
      )}
    </div>
  );
}

// ── Competitor form ────────────────────────────────────────────────────────

function CompetitorForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: typeof EMPTY & { id?: string };
  onSave:  (data: typeof EMPTY & { id?: string }) => void;
  onCancel: () => void;
  saving:  boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-card/60 p-5 space-y-4">
      <p className="text-sm font-semibold">{initial.id ? "Edit Competitor" : "Add Competitor"}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Competitor Name *</Label>
          <Input
            placeholder="e.g. Acme Corp"
            value={form.name}
            onChange={set("name")}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Website</Label>
          <Input
            placeholder="https://acmecorp.com"
            value={form.website}
            onChange={set("website")}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Services (comma-separated)</Label>
        <Input
          placeholder="e.g. CRM, Email Marketing, Social Media Management"
          value={form.services}
          onChange={set("services")}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Offers / Pricing</Label>
        <Input
          placeholder="e.g. £199/mo starter plan, free trial, no contracts"
          value={form.offers}
          onChange={set("offers")}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Positioning Notes</Label>
        <Textarea
          placeholder="How do they position themselves in the market? What's their unique angle?"
          value={form.positioning}
          onChange={set("positioning")}
          className="text-xs min-h-[72px] resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Marketing Observations</Label>
        <Textarea
          placeholder="What have you noticed about their marketing? Ads, content, messaging, channels..."
          value={form.observations}
          onChange={set("observations")}
          className="text-xs min-h-[72px] resize-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim()}
        >
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          {initial.id ? "Save changes" : "Add competitor"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1.5 h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GrowthMindCompetitors() {
  const qc             = useQueryClient();
  const getCompsFn     = useServerFn(getCompetitors);
  const saveCompFn     = useServerFn(saveCompetitor);
  const deleteCompFn   = useServerFn(deleteCompetitor);
  const analyseFn      = useServerFn(analyseCompetitors);

  const [showForm, setShowForm]           = useState(false);
  const [editingComp, setEditingComp]     = useState<Competitor | null>(null);
  const [saving, setSaving]               = useState(false);
  const [msg, setMsg]                     = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis]       = useState<string | null>(null);
  const [aiLoading, setAiLoading]         = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-competitors"],
    queryFn:  () => getCompsFn(),
    staleTime: 60_000,
  });

  const competitors = data?.competitors ?? [];

  async function handleSave(form: typeof EMPTY & { id?: string }) {
    setSaving(true);
    try {
      await saveCompFn(form);
      setShowForm(false);
      setEditingComp(null);
      setMsg("Saved!");
      setTimeout(() => setMsg(null), 2500);
      qc.invalidateQueries({ queryKey: ["growthmind-competitors"] });
    } catch (e: any) {
      setMsg("Error: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCompFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["growthmind-competitors"] });
    } catch {}
  }

  async function handleAnalyse() {
    if (competitors.length === 0) return;
    setAiLoading(true);
    setAiAnalysis(null);
    try {
      const { analysis } = await analyseFn({ data: { personality: "professional" } });
      setAiAnalysis(analysis);
    } catch (e: any) {
      setAiAnalysis("Unable to generate analysis: " + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Swords className="h-5 w-5 text-emerald-400" />
              Competitor Intelligence
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Track competitor positioning, offers, and marketing observations
            </p>
          </div>
          <div className="flex items-center gap-2">
            {msg && (
              <span className={cn("text-xs font-medium", msg.startsWith("Error") ? "text-red-400" : "text-emerald-400")}>
                {msg}
              </span>
            )}
            <Button
              variant="outline" size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-competitors"] })}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoading && "animate-spin")} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => { setShowForm(true); setEditingComp(null); }}
              disabled={showForm && !editingComp}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add competitor
            </Button>
          </div>
        </div>

        <HiveMindReportBanner domain="Competitors" briefing={aiAnalysis} />

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading competitors…</span>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Add form */}
            {showForm && !editingComp && (
              <CompetitorForm
                initial={EMPTY}
                onSave={handleSave}
                onCancel={() => setShowForm(false)}
                saving={saving}
              />
            )}

            {/* Competitor cards */}
            {competitors.length === 0 && !showForm ? (
              <div className="rounded-xl border border-white/[0.06] bg-card/60 px-6 py-16 text-center">
                <Swords className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm font-semibold text-muted-foreground">No competitors tracked yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Add your first competitor to start building your competitive intelligence.
                </p>
                <Button size="sm" className="mt-4" onClick={() => setShowForm(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add first competitor
                </Button>
              </div>
            ) : (
              competitors.map(comp =>
                editingComp?.id === comp.id ? (
                  <CompetitorForm
                    key={comp.id}
                    initial={editingComp}
                    onSave={handleSave}
                    onCancel={() => setEditingComp(null)}
                    saving={saving}
                  />
                ) : (
                  <CompetitorCard
                    key={comp.id}
                    competitor={comp}
                    onEdit={c => { setEditingComp(c); setShowForm(false); }}
                    onDelete={handleDelete}
                  />
                )
              )
            )}

            {/* AI analysis panel */}
            {competitors.length > 0 && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
                    <p className="text-sm font-semibold">AI Competitive Analysis</p>
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={handleAnalyse}
                    disabled={aiLoading}
                    className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  >
                    {aiLoading
                      ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Analysing…</>
                      : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Analyse competitors</>
                    }
                  </Button>
                </div>

                {!aiAnalysis && !aiLoading && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    GrowthMind will analyse your {competitors.length} competitor{competitors.length !== 1 ? "s" : ""} and
                    identify differentiators, gaps, and threats in your competitive landscape.
                  </p>
                )}
                {aiLoading && (
                  <p className="mt-3 text-sm text-muted-foreground animate-pulse">
                    Analysing competitive landscape…
                  </p>
                )}
                {aiAnalysis && !aiLoading && (
                  <p className="mt-3 text-sm leading-relaxed whitespace-pre-line">{aiAnalysis}</p>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
