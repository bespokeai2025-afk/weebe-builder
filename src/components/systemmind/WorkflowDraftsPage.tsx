import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  GitBranch, Wand2, Loader2, Trash2, CheckCircle2, AlertTriangle,
  Clock, Send, Eye, XCircle, ArrowRight, ChevronDown, ChevronUp,
  Variable, Cpu, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listGeneratorDrafts,
  updateGeneratorDraftStatus,
  proposeSendDraftToBuilder,
} from "@/lib/systemmind/systemmind-workflow-generator.functions";
import type { WorkflowDraftFull } from "@/lib/systemmind/systemmind-workflow-generator.server";

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:            { label: "Draft",            color: "text-muted-foreground border-white/10"  },
  needs_review:     { label: "Needs Review",     color: "text-amber-400 border-amber-500/30"     },
  approved:         { label: "Approved",          color: "text-green-400 border-green-500/30"     },
  sent_to_builder:  { label: "Sent to Builder",  color: "text-sky-400 border-sky-500/30"         },
  rejected:         { label: "Rejected",          color: "text-red-400 border-red-500/30"         },
  archived:         { label: "Archived",          color: "text-muted-foreground border-white/10"  },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: "text-muted-foreground border-white/10" };
  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold", meta.color)}>
      {meta.label}
    </Badge>
  );
}

function DraftCard({
  draft,
  onPropose,
  onArchive,
  proposing,
}: {
  draft: WorkflowDraftFull;
  onPropose: (d: WorkflowDraftFull) => void;
  onArchive: (d: WorkflowDraftFull) => void;
  proposing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const validationFails = draft.validation_results_json.filter((v) => !v.passed).length;
  const missingCount    = draft.missing_capabilities_json.length;
  const canPropose = ["draft", "needs_review"].includes(draft.status);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 ring-1 ring-sky-500/20">
            <GitBranch className="h-3.5 w-3.5 text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold">{draft.title}</p>
                {draft.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{draft.description}</p>
                )}
              </div>
              <StatusBadge status={draft.status} />
            </div>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                <Layers className="mr-1 h-2.5 w-2.5" />{draft.nodes.length} nodes
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <Variable className="mr-1 h-2.5 w-2.5" />{draft.variables.length} vars
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <Cpu className="mr-1 h-2.5 w-2.5" />{draft.tools.length} tools
              </Badge>
              {missingCount > 0 && (
                <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                  <AlertTriangle className="mr-1 h-2.5 w-2.5" />{missingCount} gaps
                </Badge>
              )}
              {validationFails > 0 && (
                <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">
                  <XCircle className="mr-1 h-2.5 w-2.5" />{validationFails} validation issue(s)
                </Badge>
              )}
              {validationFails === 0 && missingCount === 0 && (
                <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400">
                  <CheckCircle2 className="mr-1 h-2.5 w-2.5" />Ready
                </Badge>
              )}
              {draft.workflow_type && (
                <Badge variant="outline" className="text-[10px] capitalize">
                  {draft.workflow_type.replace(/_/g, " ")}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {canPropose && (
                <Button
                  size="sm"
                  className="h-7 text-xs bg-sky-600 hover:bg-sky-500 text-white"
                  onClick={() => onPropose(draft)}
                  disabled={proposing}
                >
                  {proposing ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="mr-1.5 h-3 w-3" />
                  )}
                  Send to HiveMind
                </Button>
              )}
              {draft.status === "sent_to_builder" && (
                <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                  <a href="/builder">
                    <ArrowRight className="mr-1.5 h-3 w-3" />Open Builder
                  </a>
                </Button>
              )}
              {draft.status !== "archived" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-red-400"
                  onClick={() => onArchive(draft)}
                >
                  <Trash2 className="mr-1.5 h-3 w-3" />Archive
                </Button>
              )}
              <button
                className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setExpanded((x) => !x)}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {expanded ? "Less" : "Details"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/[0.06] p-4 space-y-4">
          {/* Validation */}
          {draft.validation_results_json.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold mb-2">Validation</p>
              <div className="space-y-1">
                {draft.validation_results_json.map((r, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {r.passed ? (
                      <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <p className="text-[11px] text-muted-foreground">{r.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Missing capabilities */}
          {draft.missing_capabilities_json.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold mb-2">
                Capability Gaps
              </p>
              <div className="space-y-2">
                {draft.missing_capabilities_json.map((cap, i) => (
                  <div key={i} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-amber-300">{cap.name}</p>
                      <Badge variant="outline" className={cn("text-[9px]",
                        cap.risk === "high"   ? "border-red-500/40 text-red-400" :
                        cap.risk === "medium" ? "border-amber-500/40 text-amber-400" :
                        "border-green-500/40 text-green-400"
                      )}>{cap.risk}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{cap.suggested_fix}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Required integrations */}
          {draft.required_integrations_json.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold mb-2">
                Required Integrations
              </p>
              <div className="flex flex-wrap gap-1.5">
                {draft.required_integrations_json.map((ri, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{ri}</Badge>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/50">
            Created {new Date(draft.created_at).toLocaleDateString()} · Generated by {draft.generated_by}
          </p>
        </div>
      )}
    </div>
  );
}

export function WorkflowDraftsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const listFn   = useServerFn(listGeneratorDrafts);
  const proposeFn = useServerFn(proposeSendDraftToBuilder);
  const updateFn  = useServerFn(updateGeneratorDraftStatus);

  const [proposingId, setProposingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ["generator-drafts"],
    queryFn:  () => listFn(),
    throwOnError: false,
  });

  const propose = useMutation({
    mutationFn: async (draft: WorkflowDraftFull) => {
      setProposingId(draft.id);
      await updateFn({ data: { draftId: draft.id, status: "needs_review" } });
      return proposeFn({
        data: {
          draftId:                  draft.id,
          draftTitle:               draft.title,
          nodeCount:                draft.nodes.length,
          variableCount:            draft.variables.length,
          toolCount:                draft.tools.length,
          missingCapabilitiesCount: draft.missing_capabilities_json.length,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generator-drafts"] });
      toast.success("Sent to HiveMind for approval.");
      navigate({ to: "/hivemind/actions" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
    onSettled: () => setProposingId(null),
  });

  const archive = useMutation({
    mutationFn: (draft: WorkflowDraftFull) =>
      updateFn({ data: { draftId: draft.id, status: "archived" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generator-drafts"] });
      toast.success("Draft archived.");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const filtered = statusFilter === "all"
    ? (drafts as WorkflowDraftFull[])
    : (drafts as WorkflowDraftFull[]).filter((d) => d.status === statusFilter);

  const counts = {
    all:            drafts.length,
    draft:          (drafts as WorkflowDraftFull[]).filter((d) => d.status === "draft").length,
    needs_review:   (drafts as WorkflowDraftFull[]).filter((d) => d.status === "needs_review").length,
    sent_to_builder:(drafts as WorkflowDraftFull[]).filter((d) => d.status === "sent_to_builder").length,
    approved:       (drafts as WorkflowDraftFull[]).filter((d) => d.status === "approved").length,
    rejected:       (drafts as WorkflowDraftFull[]).filter((d) => d.status === "rejected").length,
    archived:       (drafts as WorkflowDraftFull[]).filter((d) => d.status === "archived").length,
  };

  const Wrapper = embedded ? DraftsEmbedded : SystemMindShell;
  return (
    <Wrapper>
      <div className="p-6 max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <GitBranch className="h-4 w-4 text-sky-400" />
              <h1 className="text-lg font-semibold">Workflow Drafts</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              AI-generated Builder workflow drafts awaiting review and approval.
            </p>
          </div>
          <Button
            size="sm"
            className="shrink-0 bg-sky-600 hover:bg-sky-500 text-white"
            onClick={() => navigate({ to: "/systemmind/build" })}
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Generate New
          </Button>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 overflow-x-auto">
          {(["all","draft","needs_review","sent_to_builder","approved","rejected","archived"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                statusFilter === s
                  ? "bg-sky-500/15 text-sky-300"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              {s === "all"            && `All (${counts.all})`}
              {s === "draft"          && `Draft (${counts.draft})`}
              {s === "needs_review"   && `Needs Review (${counts.needs_review})`}
              {s === "sent_to_builder"&& `In Builder (${counts.sent_to_builder})`}
              {s === "approved"       && `Approved (${counts.approved})`}
              {s === "rejected"       && `Rejected (${counts.rejected})`}
              {s === "archived"       && `Archived (${counts.archived})`}
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <div className="h-10 w-10 rounded-xl bg-sky-500/10 flex items-center justify-center">
              <GitBranch className="h-5 w-5 text-sky-400" />
            </div>
            <p className="text-sm font-medium">No workflow drafts yet</p>
            <p className="text-xs text-muted-foreground">Use the Workflow Generator to create your first draft.</p>
            <Button
              size="sm"
              className="mt-2 bg-sky-600 hover:bg-sky-500 text-white"
              onClick={() => navigate({ to: "/systemmind/build" })}
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />Generate Workflow
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                onPropose={(d) => propose.mutate(d)}
                onArchive={(d) => archive.mutate(d)}
                proposing={proposingId === draft.id && propose.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </Wrapper>
  );
}

function DraftsEmbedded({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
