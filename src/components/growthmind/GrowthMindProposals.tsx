import React, { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2, XCircle, Clock, Megaphone, Clapperboard, Rocket,
  Video, ChevronDown, ChevronUp, Loader2, Filter, Users, Target,
  DollarSign, RotateCcw, Hammer,
} from "lucide-react";
import { GrowthMindShell } from "./GrowthMindShell";
import { getAllProposals, updateProposalStatus } from "@/lib/executives/executive-bridge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type StatusFilter = "all" | "approved" | "draft" | "rejected" | "in_progress";

const STATUS_META: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  approved:    { label: "Approved",    icon: CheckCircle2, className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  draft:       { label: "Draft",       icon: Clock,        className: "bg-slate-500/15 text-slate-400 border-slate-500/20" },
  rejected:    { label: "Dismissed",   icon: XCircle,      className: "bg-red-500/15 text-red-400 border-red-500/20" },
  in_progress: { label: "In Progress", icon: Hammer,       className: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", meta.className)}>
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

type CampaignProposal = {
  id: string; type: "campaign"; title: string; reason: string; evidence: string;
  audience: string; expectedOutcome: string; budgetEstimate: string | null;
  contentPlan: string | null; videoPlan: string | null; channels: string[];
  status: "draft" | "approved" | "rejected" | "in_progress"; generatedAt: string;
};

type VideoProposal = {
  id: string; type: "video"; title: string; hook: string; platform: string;
  targetAudience: string; storyboard: string; creativeAngles: string[];
  expectedOutcome: string; duration: string; callToAction: string;
  status: "draft" | "approved" | "rejected"; generatedAt: string;
};

type AnyProposal = CampaignProposal | VideoProposal;

function CampaignCard({ proposal, onStatusChange, busy, highlighted }: {
  proposal: CampaignProposal;
  onStatusChange: (id: string, type: "campaign" | "video", status: "approved" | "rejected" | "draft") => void;
  busy: boolean;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    setIsHighlighted(true);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setIsHighlighted(false), 2000);
    return () => clearTimeout(t);
  }, [highlighted]);

  function launchInFactory() {
    const params = new URLSearchParams({ proposal: proposal.id, title: proposal.title });
    if (proposal.audience)    params.set("audience",    proposal.audience.slice(0, 200));
    if (proposal.contentPlan) params.set("contentPlan", proposal.contentPlan.slice(0, 400));
    if (proposal.channels?.length) params.set("channels", proposal.channels.join(","));
    window.location.assign(`/growthmind/campaign-factory?${params.toString()}`);
  }

  return (
    <div ref={cardRef} className={cn(
      "rounded-xl border overflow-hidden transition-all duration-300",
      isHighlighted && "ring-2 ring-amber-400/60",
      proposal.status === "approved"
        ? "border-emerald-500/20 bg-emerald-500/[0.02]"
        : proposal.status === "in_progress"
          ? "border-amber-500/20 bg-amber-500/[0.02]"
          : proposal.status === "rejected"
            ? "border-red-500/10 bg-red-500/[0.01] opacity-75"
            : "border-white/[0.06] bg-card/60",
    )}>
      <div className="px-4 py-3.5 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 ring-1 ring-amber-500/20 mt-0.5">
          <Megaphone className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-sm font-semibold leading-snug flex-1">{proposal.title}</p>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{proposal.reason}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {proposal.channels.slice(0, 4).map(ch => (
              <span key={ch} className="text-[9px] rounded border border-amber-500/20 bg-amber-500/[0.06] text-amber-300 px-1 py-0.5">{ch}</span>
            ))}
            {proposal.audience && (
              <span className="text-[9px] rounded border border-white/[0.08] bg-white/[0.03] text-muted-foreground px-1 py-0.5 flex items-center gap-0.5">
                <Users className="h-2 w-2" />{proposal.audience.slice(0, 30)}{proposal.audience.length > 30 ? "…" : ""}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(o => !o)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.04] px-4 py-3 space-y-3">
          {proposal.evidence && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1">Why This Will Work</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{proposal.evidence}</p>
            </div>
          )}
          {proposal.expectedOutcome && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1">Expected Outcome</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{proposal.expectedOutcome}</p>
            </div>
          )}
          {proposal.budgetEstimate && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3 w-3 text-emerald-400" />
              <p className="text-xs text-muted-foreground">{proposal.budgetEstimate}</p>
            </div>
          )}
          {proposal.contentPlan && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1">Content Plan</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{proposal.contentPlan}</p>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-white/[0.04] px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] text-muted-foreground/50">
          {new Date(proposal.generatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {proposal.status === "approved" && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-[11px] gap-1.5 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/10"
              onClick={launchInFactory}
            >
              <Rocket className="h-3 w-3" />
              Build in Campaign Factory
            </Button>
          )}
          {proposal.status === "in_progress" && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-[11px] gap-1.5 border-amber-500/25 text-amber-300 hover:bg-amber-500/10"
              onClick={launchInFactory}
            >
              <Hammer className="h-3 w-3" />
              View in Campaign Factory
            </Button>
          )}
          {proposal.status !== "approved" && proposal.status !== "in_progress" && (
            <Button
              size="sm" variant="ghost"
              disabled={busy}
              className="h-7 text-[11px] gap-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => onStatusChange(proposal.id, "campaign", "approved")}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Approve
            </Button>
          )}
          {(proposal.status === "approved" || proposal.status === "in_progress") && (
            <Button
              size="sm" variant="ghost"
              disabled={busy}
              className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => onStatusChange(proposal.id, "campaign", "draft")}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Move to Draft
            </Button>
          )}
          {proposal.status !== "rejected" && proposal.status !== "in_progress" && (
            <Button
              size="sm" variant="ghost"
              disabled={busy}
              className="h-7 text-[11px] gap-1 text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
              onClick={() => onStatusChange(proposal.id, "campaign", "rejected")}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function VideoCard({ proposal, onStatusChange, busy, highlighted }: {
  proposal: VideoProposal;
  onStatusChange: (id: string, type: "campaign" | "video", status: "approved" | "rejected" | "draft") => void;
  busy: boolean;
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    setIsHighlighted(true);
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setIsHighlighted(false), 2000);
    return () => clearTimeout(t);
  }, [highlighted]);

  function openInVideoStudio() {
    const params = new URLSearchParams({
      mode: "freeform",
      prompt: [proposal.hook, proposal.storyboard].filter(Boolean).join("\n\n").slice(0, 1200),
      title: proposal.title,
      videoType: "meta_video_ad",
    });
    window.location.assign(`/growthmind/video-studio?${params.toString()}`);
  }

  return (
    <div ref={cardRef} className={cn(
      "rounded-xl border overflow-hidden transition-all duration-300",
      isHighlighted && "ring-2 ring-amber-400/60",
      proposal.status === "approved"
        ? "border-pink-500/20 bg-pink-500/[0.02]"
        : proposal.status === "rejected"
          ? "border-red-500/10 bg-red-500/[0.01] opacity-75"
          : "border-white/[0.06] bg-card/60",
    )}>
      <div className="px-4 py-3.5 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pink-500/15 ring-1 ring-pink-500/20 mt-0.5">
          <Clapperboard className="h-3.5 w-3.5 text-pink-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-sm font-semibold leading-snug flex-1">{proposal.title}</p>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug italic line-clamp-2">{proposal.hook}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            <span className="text-[9px] rounded border border-pink-500/20 bg-pink-500/[0.06] text-pink-300 px-1 py-0.5">{proposal.platform}</span>
            {proposal.duration && (
              <span className="text-[9px] rounded border border-white/[0.08] bg-white/[0.03] text-muted-foreground px-1 py-0.5">{proposal.duration}</span>
            )}
            {proposal.targetAudience && (
              <span className="text-[9px] rounded border border-white/[0.08] bg-white/[0.03] text-muted-foreground px-1 py-0.5 flex items-center gap-0.5">
                <Target className="h-2 w-2" />{proposal.targetAudience.slice(0, 28)}{proposal.targetAudience.length > 28 ? "…" : ""}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(o => !o)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.04] px-4 py-3 space-y-3">
          {proposal.storyboard && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1">Storyboard</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{proposal.storyboard}</p>
            </div>
          )}
          {proposal.creativeAngles.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1.5">Creative Angles</p>
              <div className="flex flex-wrap gap-1">
                {proposal.creativeAngles.map((angle, i) => (
                  <span key={i} className="text-[11px] bg-white/[0.04] text-muted-foreground px-2 py-0.5 rounded">{angle}</span>
                ))}
              </div>
            </div>
          )}
          {proposal.expectedOutcome && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1">Expected Outcome</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{proposal.expectedOutcome}</p>
            </div>
          )}
          {proposal.callToAction && (
            <div>
              <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-muted-foreground mb-1">Call to Action</p>
              <p className="text-xs text-pink-300/80">{proposal.callToAction}</p>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-white/[0.04] px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] text-muted-foreground/50">
          {new Date(proposal.generatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {proposal.status === "approved" && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-[11px] gap-1.5 border-pink-500/25 text-pink-300 hover:bg-pink-500/10"
              onClick={openInVideoStudio}
            >
              <Video className="h-3 w-3" />
              Open in Video Studio
            </Button>
          )}
          {proposal.status !== "approved" && (
            <Button
              size="sm" variant="ghost"
              disabled={busy}
              className="h-7 text-[11px] gap-1 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => onStatusChange(proposal.id, "video", "approved")}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Approve
            </Button>
          )}
          {proposal.status === "approved" && (
            <Button
              size="sm" variant="ghost"
              disabled={busy}
              className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => onStatusChange(proposal.id, "video", "draft")}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Move to Draft
            </Button>
          )}
          {proposal.status !== "rejected" && (
            <Button
              size="sm" variant="ghost"
              disabled={busy}
              className="h-7 text-[11px] gap-1 text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
              onClick={() => onStatusChange(proposal.id, "video", "rejected")}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Dismiss
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

const FILTER_PILLS: { key: StatusFilter; label: string }[] = [
  { key: "all",         label: "All" },
  { key: "approved",    label: "Approved" },
  { key: "in_progress", label: "In Progress" },
  { key: "draft",       label: "Draft" },
  { key: "rejected",    label: "Dismissed" },
];

export function GrowthMindProposals() {
  const getProposalsFn     = useServerFn(getAllProposals);
  const updateStatusFn     = useServerFn(updateProposalStatus);
  const qc                 = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightConsumed  = useRef(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("highlight");
    if (id) setHighlightId(id);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-all-proposals"],
    queryFn:  () => getProposalsFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  useEffect(() => {
    if (!highlightId || !data || highlightConsumed.current) return;
    highlightConsumed.current = true;
    setStatusFilter("all");
    window.history.replaceState({}, "", window.location.pathname);
  }, [highlightId, data]);

  const allProposals: AnyProposal[] = [
    ...(data?.campaigns ?? []),
    ...(data?.videos ?? []),
  ].sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());

  const filtered = statusFilter === "all"
    ? allProposals
    : allProposals.filter(p => p.status === statusFilter);

  const counts = {
    all:         allProposals.length,
    approved:    allProposals.filter(p => p.status === "approved").length,
    draft:       allProposals.filter(p => p.status === "draft").length,
    rejected:    allProposals.filter(p => p.status === "rejected").length,
    in_progress: allProposals.filter(p => p.status === "in_progress").length,
  };

  async function handleStatusChange(
    id: string,
    type: "campaign" | "video",
    status: "approved" | "rejected" | "draft",
  ) {
    setBusyIds(s => new Set([...s, id]));
    try {
      await updateStatusFn({ data: { proposalType: type, proposalId: id, status } });
      await qc.invalidateQueries({ queryKey: ["growthmind-all-proposals"] });
      await qc.invalidateQueries({ queryKey: ["growthmind-cmo-dashboard"] });
      const label = status === "approved" ? "Approved" : status === "rejected" ? "Dismissed" : "Moved to draft";
      toast.success(label);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update");
    } finally {
      setBusyIds(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-3xl space-y-5">

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25">
            <Filter className="h-4 w-4 text-violet-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-semibold">All Proposals</h1>
              {counts.approved > 0 && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                  {counts.approved} approved
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Campaign and video proposals generated by the AI CMO. Approve ideas to track them and launch actions.
            </p>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTER_PILLS.filter(({ key }) => key !== "in_progress" || counts.in_progress > 0).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border",
                statusFilter === key
                  ? key === "in_progress"
                    ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                    : "border-violet-500/30 bg-violet-500/15 text-violet-300"
                  : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:border-white/[0.14]",
              )}
            >
              {label}
              <span className={cn(
                "rounded-full text-[9px] font-bold px-1.5 py-0.5 leading-none",
                statusFilter === key
                  ? key === "in_progress"
                    ? "bg-amber-500/25 text-amber-300"
                    : "bg-violet-500/25 text-violet-300"
                  : "bg-white/[0.07] text-muted-foreground",
              )}>
                {counts[key]}
              </span>
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.12] bg-card/40 flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <Filter className="h-8 w-8 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {statusFilter === "all"
                  ? "No proposals yet"
                  : statusFilter === "rejected"
                    ? "No dismissed proposals"
                    : statusFilter === "in_progress"
                      ? "No proposals in progress"
                      : `No ${statusFilter} proposals`}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {statusFilter === "all"
                  ? "Run CMO Analysis on the Overview page to generate campaign and video proposals."
                  : "Switch to a different filter above."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(proposal =>
              proposal.type === "campaign" ? (
                <CampaignCard
                  key={proposal.id}
                  proposal={proposal}
                  onStatusChange={handleStatusChange}
                  busy={busyIds.has(proposal.id)}
                  highlighted={proposal.id === highlightId}
                />
              ) : (
                <VideoCard
                  key={proposal.id}
                  proposal={proposal}
                  onStatusChange={handleStatusChange}
                  busy={busyIds.has(proposal.id)}
                  highlighted={proposal.id === highlightId}
                />
              )
            )}
          </div>
        )}

      </div>
    </GrowthMindShell>
  );
}
