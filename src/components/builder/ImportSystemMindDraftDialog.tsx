import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GitBranch, Loader2, CheckCircle2, AlertTriangle, Layers, Variable, Cpu, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuilderStore } from "@/lib/builder/store";
import {
  listGeneratorDrafts,
  updateGeneratorDraftStatus,
} from "@/lib/systemmind/systemmind-workflow-generator.functions";
import type { WorkflowDraftFull } from "@/lib/systemmind/systemmind-workflow-generator.server";

function DraftRow({
  draft,
  selected,
  onSelect,
}: {
  draft: WorkflowDraftFull;
  selected: boolean;
  onSelect: () => void;
}) {
  const missingCount    = draft.missing_capabilities_json?.length ?? 0;
  const validationFails = (draft.validation_results_json ?? []).filter((v) => !v.passed).length;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border p-3 transition-colors",
        selected
          ? "border-sky-500/50 bg-sky-500/[0.08]"
          : "border-white/[0.06] bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded mt-0.5",
          selected ? "bg-sky-500/20" : "bg-white/[0.04]",
        )}>
          <GitBranch className={cn("h-3 w-3", selected ? "text-sky-400" : "text-muted-foreground")} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{draft.title}</p>
          {draft.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{draft.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <Badge variant="outline" className="text-[9px]">
              <Layers className="mr-1 h-2 w-2" />{draft.nodes.length}
            </Badge>
            <Badge variant="outline" className="text-[9px]">
              <Variable className="mr-1 h-2 w-2" />{draft.variables.length}
            </Badge>
            <Badge variant="outline" className="text-[9px]">
              <Cpu className="mr-1 h-2 w-2" />{draft.tools.length}
            </Badge>
            {missingCount > 0 && (
              <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400">
                <AlertTriangle className="mr-1 h-2 w-2" />{missingCount} gaps
              </Badge>
            )}
            {missingCount === 0 && validationFails === 0 && (
              <Badge variant="outline" className="text-[9px] border-green-500/30 text-green-400">
                <CheckCircle2 className="mr-1 h-2 w-2" />ready
              </Badge>
            )}
            <Badge variant="outline" className={cn(
              "text-[9px]",
              draft.status === "sent_to_builder" && "border-sky-500/30 text-sky-400",
              draft.status === "approved"         && "border-green-500/30 text-green-400",
            )}>
              {draft.status.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>
      </div>
    </button>
  );
}

export function ImportSystemMindDraftDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { loadFlow } = useBuilderStore();
  const qc            = useQueryClient();
  const listFn        = useServerFn(listGeneratorDrafts);
  const updateFn      = useServerFn(updateGeneratorDraftStatus);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: allDrafts = [], isLoading } = useQuery({
    queryKey: ["generator-drafts"],
    queryFn:  () => listFn(),
    enabled:  open,
  });

  const importable = (allDrafts as WorkflowDraftFull[]).filter(
    (d) => ["draft", "needs_review", "approved", "sent_to_builder"].includes(d.status),
  );

  const selectedDraft = importable.find((d) => d.id === selectedId) ?? null;

  const doImport = useMutation({
    mutationFn: async () => {
      if (!selectedDraft) throw new Error("No draft selected");
      if (!selectedDraft.nodes.length) throw new Error("Draft has no nodes.");
      loadFlow({
        nodes:    selectedDraft.nodes,
        edges:    selectedDraft.edges,
        variables: (selectedDraft.variables ?? []).map((v: any) => ({
          name:        v.name,
          description: v.description ?? "",
          type:        v.type ?? "string",
        })),
      });
      await updateFn({ data: { draftId: selectedDraft.id, status: "sent_to_builder" } });
      qc.invalidateQueries({ queryKey: ["generator-drafts"] });
    },
    onSuccess: () => {
      toast.success(`Draft "${selectedDraft!.title}" loaded into Builder.`);
      setConfirmOpen(false);
      onOpenChange(false);
      setSelectedId(null);
    },
    onError: (e: any) => {
      toast.error(e.message ?? "Import failed");
      setConfirmOpen(false);
    },
  });

  const handleImportClick = () => {
    if (!selectedDraft) return;
    setConfirmOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-sky-400" />
              Import SystemMind Draft
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            Select a SystemMind workflow draft to load into the Builder canvas.
            This will <strong>replace</strong> your current canvas.
          </p>

          <div className="flex-1 overflow-y-auto space-y-2 min-h-0 max-h-80 pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : importable.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
                <GitBranch className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">No workflow drafts available.</p>
                <p className="text-[11px] text-muted-foreground/60">
                  Go to SystemMind → Workflow Generator to create one.
                </p>
              </div>
            ) : (
              importable.map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  selected={selectedId === draft.id}
                  onSelect={() => setSelectedId(draft.id)}
                />
              ))
            )}
          </div>

          {selectedDraft?.missing_capabilities_json.length ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300/80">
                This draft has {selectedDraft.missing_capabilities_json.length} capability gap(s).
                You can still import it and configure the tools manually in Builder.
              </p>
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImportClick}
              disabled={!selectedDraft}
              className="bg-sky-600 hover:bg-sky-500 text-white"
            >
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              Import to Canvas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              This will load <strong>"{selectedDraft?.title}"</strong> ({selectedDraft?.nodes.length} nodes)
              onto the canvas, replacing everything currently there. Any unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => doImport.mutate()}
              disabled={doImport.isPending}
              className="bg-sky-600 hover:bg-sky-500"
            >
              {doImport.isPending ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Importing…</>
              ) : (
                "Import Draft"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
