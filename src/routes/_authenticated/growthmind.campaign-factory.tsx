import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Rocket, Loader2, Send, Trash2, ChevronDown, ChevronUp,
  RefreshCw, DollarSign, Target, Copy, CheckCheck, Clapperboard,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  getCampaignDrafts, generateCampaignDraft, deleteCampaignDraft,
  sendCampaignToHiveMind, CAMPAIGN_TYPES, type CampaignDraft, type CampaignTypeId,
} from "@/lib/growthmind/growthmind.campaign-factory";

export const Route = createFileRoute("/_authenticated/growthmind/campaign-factory")({
  head: () => ({ meta: [{ title: "Campaign Factory — GrowthMind" }] }),
  component: CampaignFactoryPage,
});

const STATUS_BADGE: Record<CampaignDraft["status"], { label: string; className: string }> = {
  draft:              { label: "Draft",         className: "bg-slate-500/15 text-slate-400" },
  sent_for_approval:  { label: "Sent to HiveMind", className: "bg-amber-500/15 text-amber-400" },
  approved:           { label: "Approved",      className: "bg-emerald-500/15 text-emerald-400" },
  rejected:           { label: "Rejected",      className: "bg-red-500/15 text-red-400" },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function doCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button type="button" onClick={doCopy}
      className="text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <CheckCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function DraftCard({ draft, onDelete, onSend }: {
  draft: CampaignDraft; onDelete: () => void; onSend: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sending,  setSending]  = useState(false);
  const badge = STATUS_BADGE[draft.status];
  const typeLabel = CAMPAIGN_TYPES.find(t => t.id === draft.campaignType)?.label ?? draft.campaignType;
  const typeIcon  = CAMPAIGN_TYPES.find(t => t.id === draft.campaignType)?.icon ?? "📋";

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-base">{typeIcon}</span>
            <span className="text-sm font-semibold truncate">{draft.name}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{draft.targetAudience}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", badge.className)}>
              {badge.label}
            </span>
            <span className="text-[10px] bg-white/[0.04] text-muted-foreground px-1.5 py-0.5 rounded">
              {typeLabel}
            </span>
            {draft.budget && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                <DollarSign className="h-2.5 w-2.5" />£{draft.budget.toLocaleString()}/mo
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/50">
              {Math.round(draft.confidenceScore * 100)}% confidence
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {draft.status === "draft" && (
            <Button
              variant="ghost" size="sm"
              onClick={async () => { setSending(true); try { onSend(); } finally { setTimeout(() => setSending(false), 2000); } }}
              disabled={sending}
              className="text-xs gap-1.5 text-emerald-400 hover:text-emerald-300"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send to HiveMind
            </Button>
          )}
          <button type="button" onClick={() => setExpanded(o => !o)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            title="Generate video ad in Video Studio"
            onClick={() => {
              const params = new URLSearchParams({
                mode:     "freeform",
                prompt:   [
                  draft.coreOffer,
                  draft.targetAudience ? `Target audience: ${draft.targetAudience}` : "",
                  draft.copyBlocks?.[0]?.content ?? "",
                ].filter(Boolean).join("\n\n").slice(0, 1200),
                title:    draft.name,
                videoType: "meta_video_ad",
              });
              window.location.assign(`/growthmind/video-studio?${params.toString()}`);
            }}
            className="p-1.5 text-muted-foreground hover:text-violet-400 rounded transition-colors">
            <Clapperboard className="h-4 w-4" />
          </button>
          <button type="button"
            onClick={async () => { setDeleting(true); try { onDelete(); } finally { setDeleting(false); } }}
            disabled={deleting}
            className="p-1.5 text-muted-foreground hover:text-red-400 rounded">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/[0.04] px-5 py-4 space-y-4">

          {/* Core offer + audience */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Core Offer</p>
              <p className="text-xs text-muted-foreground">{draft.coreOffer || "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Target Audience</p>
              <p className="text-xs text-muted-foreground">{draft.targetAudience || "—"}</p>
            </div>
          </div>

          {/* Copy blocks */}
          {draft.copyBlocks.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">Copy</p>
              <div className="space-y-2">
                {draft.copyBlocks.map((block, i) => (
                  <div key={i} className="rounded-lg bg-white/[0.03] px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{block.label}</span>
                      <CopyButton text={block.content} />
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">{block.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sequence */}
          {draft.sequence.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">Outreach Sequence</p>
              <div className="space-y-1.5">
                {draft.sequence.map((step, i) => (
                  <div key={i} className="flex items-start gap-3 text-xs">
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-medium shrink-0 w-12 text-center">
                      Day {step.day}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-muted-foreground/70 text-[10px]">{step.channel} · {step.action}</p>
                      <p className="text-foreground/80 mt-0.5 leading-relaxed">{step.copy}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* KPIs */}
          {draft.kpis.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">KPIs</p>
              <div className="flex flex-wrap gap-2">
                {draft.kpis.map((kpi, i) => (
                  <span key={i} className="text-[11px] bg-white/[0.04] text-muted-foreground px-2 py-1 rounded">
                    {kpi}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Expected outcome + evidence */}
          {draft.expectedOutcome && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Expected Outcome</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{draft.expectedOutcome}</p>
            </div>
          )}
          {draft.evidence && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Why This Will Work</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{draft.evidence}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CampaignFactoryPage() {
  const getDraftsFn  = useServerFn(getCampaignDrafts);
  const generateFn   = useServerFn(generateCampaignDraft);
  const deleteFn     = useServerFn(deleteCampaignDraft);
  const sendFn       = useServerFn(sendCampaignToHiveMind);
  const qc           = useQueryClient();

  const [selected,   setSelected]   = useState<CampaignTypeId | null>(null);
  const [budget,     setBudget]     = useState<string>("");
  const [goal,       setGoal]       = useState<string>("");
  const [generating, setGenerating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-campaign-drafts"],
    queryFn:  () => getDraftsFn(),
    staleTime: 30_000,
  });

  const drafts = data?.drafts ?? [];

  async function handleGenerate() {
    if (!selected) return toast.error("Select a campaign type first");
    setGenerating(true);
    try {
      await generateFn({ data: {
        campaignType: selected,
        budget: budget ? Number(budget) : null,
        goal,
      }});
      await qc.invalidateQueries({ queryKey: ["growthmind-campaign-drafts"] });
      toast.success("Campaign draft generated");
    } catch (err: any) {
      toast.error(err.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(draftId: string) {
    try {
      await deleteFn({ data: { draftId } });
      await qc.invalidateQueries({ queryKey: ["growthmind-campaign-drafts"] });
      toast.success("Draft deleted");
    } catch (err: any) {
      toast.error(err.message ?? "Delete failed");
    }
  }

  async function handleSend(draftId: string) {
    try {
      await sendFn({ data: { draftId } });
      await qc.invalidateQueries({ queryKey: ["growthmind-campaign-drafts"] });
      toast.success("Campaign sent to HiveMind for approval");
    } catch (err: any) {
      toast.error(err.message ?? "Failed to send");
    }
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-3xl space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
            <Rocket className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Campaign Factory</h1>
            <p className="text-xs text-muted-foreground">Generate campaign plans from your Business DNA · Drafts only — nothing auto-launches</p>
          </div>
        </div>

        {/* Generator panel */}
        <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 space-y-4">
          <p className="text-sm font-medium">Create New Campaign Draft</p>

          {/* Campaign type grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {CAMPAIGN_TYPES.map(t => (
              <button
                key={t.id} type="button"
                onClick={() => setSelected(t.id === selected ? null : t.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-all",
                  selected === t.id
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/[0.1] hover:text-foreground",
                )}
              >
                <span className="text-lg">{t.icon}</span>
                <span className="text-center leading-tight">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Budget + Goal */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Monthly Budget (£) <span className="text-muted-foreground font-normal">optional</span></Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input type="number" min={0} value={budget} onChange={e => setBudget(e.target.value)}
                  placeholder="e.g. 1000" className="pl-8 bg-background/50 h-9 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Campaign Goal <span className="text-muted-foreground font-normal">optional</span></Label>
              <div className="relative">
                <Target className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={goal} onChange={e => setGoal(e.target.value)}
                  placeholder="e.g. 20 new leads in 30 days" className="pl-8 bg-background/50 h-9 text-sm" />
              </div>
            </div>
          </div>

          <Button
            onClick={handleGenerate} disabled={generating || !selected}
            className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {generating ? "Generating…" : selected
              ? `Generate ${CAMPAIGN_TYPES.find(t => t.id === selected)?.label} Draft`
              : "Select a campaign type above"}
          </Button>

          {generating && (
            <p className="text-center text-xs text-muted-foreground animate-pulse">
              Writing real copy tailored to your Business DNA…
            </p>
          )}
        </div>

        {/* Drafts list */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Campaign Drafts
              {drafts.length > 0 && <span className="ml-2 text-xs text-muted-foreground font-normal">{drafts.length} total</span>}
            </h2>
            {drafts.filter(d => d.status === "draft").length > 0 && (
              <p className="text-[11px] text-amber-400">
                {drafts.filter(d => d.status === "draft").length} awaiting review
              </p>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : drafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.12] bg-card/40 flex flex-col items-center justify-center py-12 gap-3">
              <Rocket className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No campaign drafts yet — generate your first above</p>
            </div>
          ) : (
            <div className="space-y-3">
              {drafts.map(draft => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  onDelete={() => handleDelete(draft.id)}
                  onSend={() => handleSend(draft.id)}
                />
              ))}
            </div>
          )}
        </div>

      </div>
    </GrowthMindShell>
  );
}
