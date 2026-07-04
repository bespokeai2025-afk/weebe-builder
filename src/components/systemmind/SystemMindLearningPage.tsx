import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  GraduationCap, Loader2, Inbox, Lightbulb, Tag, CircleDot, Wand2, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listLearningQueueFn, listSuggestedImprovementsFn,
} from "@/lib/systemmind/intelligence.functions";
import type { LearningQueueItem, ImprovementSuggestion } from "@/lib/systemmind/deployment-planner.server";
import { SystemMindShell } from "./SystemMindShell";
import { Chip, MigrationNotice, ExecutionBanner, EmptyState } from "./intelligence/shared";

const SEV_CLS: Record<string, string> = {
  high: "border-red-500/30 bg-red-500/[0.08] text-red-400",
  medium: "border-amber-500/30 bg-amber-500/[0.08] text-amber-400",
  low: "border-white/[0.1] text-muted-foreground",
};

function QueueTab() {
  const fn = useServerFn(listLearningQueueFn);
  const { data, isLoading } = useQuery({ queryKey: ["systemmind-learning-queue"], queryFn: () => fn(), throwOnError: false });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading queue…</div>;
  if (data && data.applied === false) return <MigrationNotice what="The learning queue" />;
  const items: LearningQueueItem[] = data?.items ?? [];
  if (items.length === 0) return <EmptyState icon={Inbox} title="Queue is clear" hint="Every discovered workflow is classified and curated." />;

  const unclassified = items.filter((i) => i.reason === "unclassified");
  const notCurated = items.filter((i) => i.reason === "not_curated");

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Discovered workflows that still need attention before they can be planned with. {unclassified.length} to classify,{" "}
        {notCurated.length} to curate.
      </p>
      {items.map((it) => (
        <div key={it.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CircleDot className={cn("h-3 w-3 shrink-0", it.active ? "text-emerald-400" : "text-muted-foreground/40")} />
              <p className="text-[12px] font-medium truncate">{it.name}</p>
            </div>
            <p className="text-[11px] text-muted-foreground/70 mt-1 flex items-center gap-1.5">
              <ArrowRight className="h-3 w-3 text-sky-400/60" /> {it.suggested_action}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Chip className={it.reason === "unclassified" ? "text-amber-400/80 border-amber-500/20" : "text-sky-400/80 border-sky-500/20"}>
              {it.reason === "unclassified" ? "classify" : "curate"}
            </Chip>
            {it.workflow_category && <Chip><Tag className="h-2.5 w-2.5 inline mr-1" />{it.workflow_category}</Chip>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ImprovementsTab() {
  const fn = useServerFn(listSuggestedImprovementsFn);
  const { data, isLoading } = useQuery({ queryKey: ["systemmind-improvements"], queryFn: () => fn(), throwOnError: false });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Analysing…</div>;
  if (data && data.applied === false) return <MigrationNotice what="Suggested improvements" />;
  const items: ImprovementSuggestion[] = data?.items ?? [];
  if (items.length === 0) return <EmptyState icon={Lightbulb} title="No suggestions" hint="Recompute confidence scores first, or your templates are already in great shape." />;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground mb-1">
        Deterministic suggestions derived from confidence gaps. Improving these raises deployment readiness.
      </p>
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 flex items-start gap-3">
          <Wand2 className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-foreground/90">{it.suggestion}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <Chip className="capitalize">{it.dimension.replace(/_/g, " ")}</Chip>
              <span className={cn("text-[9px] rounded-full px-1.5 py-0.5 border capitalize", SEV_CLS[it.severity])}>{it.severity}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SystemMindLearningPage() {
  return (
    <SystemMindShell>
      <div className="p-5 max-w-5xl mx-auto">
        <div className="mb-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <GraduationCap className="h-4.5 w-4.5 text-sky-400" /> Learning
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            What SystemMind still needs to learn: workflows awaiting curation, and concrete ways to improve template quality.
          </p>
        </div>

        <div className="mb-4">
          <ExecutionBanner>
            These are descriptive recommendations only — acting on them is a human decision made elsewhere.
          </ExecutionBanner>
        </div>

        <Tabs defaultValue="queue" className="w-full">
          <TabsList>
            <TabsTrigger value="queue" className="text-xs gap-1.5"><Inbox className="h-3.5 w-3.5" /> Queue</TabsTrigger>
            <TabsTrigger value="improvements" className="text-xs gap-1.5"><Lightbulb className="h-3.5 w-3.5" /> Suggested Improvements</TabsTrigger>
          </TabsList>
          <TabsContent value="queue" className="mt-3"><QueueTab /></TabsContent>
          <TabsContent value="improvements" className="mt-3"><ImprovementsTab /></TabsContent>
        </Tabs>
      </div>
    </SystemMindShell>
  );
}
