/**
 * n8n-style hub: workflow list (published + drafts), editor, and executions.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  FileEdit,
  History,
  Loader2,
  Layers,
  Play,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatUserFacingError } from "@/lib/format-error.shared";
import { WbahPostCallExecutionsPanel } from "@/components/wbah/WbahPostCallExecutionsPanel";
import { WbahPostCallReadinessStrip } from "@/components/wbah/WbahPostCallReadinessStrip";
import { WbahPostCallWorkflowStudio } from "@/components/wbah/WbahPostCallWorkflowStudio";
import { deleteBuildSession } from "@/lib/systemmind/build-workspace.functions";
import {
  activateWbahWorkflowFn,
  getWbahPostCallQueueStatsFn,
  listWbahPostCallDraftsFn,
  listWbahWorkflowsFn,
  startWbahWorkflowWizardFn,
} from "@/lib/systemmind/wbah-workflow-wizard.functions";

type HubTab = "editor" | "executions";

export function WbahPostCallHub() {
  const qc = useQueryClient();
  const listFn = useServerFn(listWbahWorkflowsFn);
  const draftsFn = useServerFn(listWbahPostCallDraftsFn);
  const startFn = useServerFn(startWbahWorkflowWizardFn);
  const activateFn = useServerFn(activateWbahWorkflowFn);
  const deleteDraftFn = useServerFn(deleteBuildSession);
  const statsFn = useServerFn(getWbahPostCallQueueStatsFn);

  const [mainTab, setMainTab] = useState<HubTab>("editor");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const { data: workflows } = useQuery({
    queryKey: ["wbah-workflows"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const { data: drafts } = useQuery({
    queryKey: ["wbah-post-call-drafts"],
    queryFn: () => draftsFn(),
    throwOnError: false,
  });

  const { data: queueStats } = useQuery({
    queryKey: ["wbah-queue-stats"],
    queryFn: () => statsFn(),
    refetchInterval: 30_000,
    throwOnError: false,
  });

  const start = useMutation({
    mutationFn: (mode: "blank" | "template" | "template_rebook" = "blank") =>
      startFn({ data: { mode } } as any),
    onSuccess: (res, mode) => {
      setSessionId(res.sessionId);
      setSelectedWorkflowId(null);
      setMainTab("editor");
      qc.invalidateQueries({ queryKey: ["wbah-post-call-drafts"] });
      toast.success(
        mode === "template"
          ? "WBAH New Leads template created"
          : mode === "template_rebook"
            ? "WBAH Rebook template created"
            : "Blank workflow created",
      );
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  const activate = useMutation({
    mutationFn: (workflowId: string) => activateFn({ data: { workflowId } }),
    onSuccess: () => {
      toast.success("Workflow is now active");
      qc.invalidateQueries({ queryKey: ["wbah-workflows"] });
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  const deleteDraft = useMutation({
    mutationFn: (draftSessionId: string) =>
      deleteDraftFn({ data: { sessionId: draftSessionId } }),
    onSuccess: (_res, deletedId) => {
      toast.success("Draft deleted");
      qc.invalidateQueries({ queryKey: ["wbah-post-call-drafts"] });
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      if (sessionId === deletedId) {
        const remaining = (drafts ?? []).filter((d) => d.sessionId !== deletedId);
        setSessionId(remaining[0]?.sessionId ?? null);
        setSelectedWorkflowId(null);
      }
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  useEffect(() => {
    if (sessionId || start.isPending) return;
    const firstDraft = drafts?.[0];
    if (firstDraft) {
      setSessionId(firstDraft.sessionId);
    }
  }, [drafts, sessionId, start.isPending]);

  function openDraft(id: string) {
    setSessionId(id);
    setSelectedWorkflowId(null);
    setMainTab("editor");
  }

  function openPublished(wf: NonNullable<typeof workflows>[number]) {
    setSelectedWorkflowId(wf.id);
    if (wf.sourceBuildSessionId) {
      setSessionId(wf.sourceBuildSessionId);
      setMainTab("editor");
    }
  }

  const activeWorkflow = (workflows ?? []).find((w) => w.status === "active");
  const failedCount = queueStats?.failed ?? 0;

  return (
    <div className="flex flex-col lg:flex-row gap-0 min-h-[calc(100vh-140px)] rounded-xl border border-gray-800/80 overflow-hidden bg-gray-950/40">
      {/* Sidebar */}
      <aside className="w-full lg:w-52 shrink-0 border-b lg:border-b-0 lg:border-r border-gray-800/80 bg-gray-950/60 p-3 space-y-4">
        <div className="space-y-1.5">
          <Button
            size="sm"
            className="w-full h-8 text-xs bg-violet-600 hover:bg-violet-500"
            disabled={start.isPending}
            onClick={() => start.mutate("blank")}
          >
            {start.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Plus className="h-3.5 w-3.5 mr-1" />
            )}
            New blank
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs border-gray-700 text-gray-300 hover:bg-gray-900"
            disabled={start.isPending}
            onClick={() => start.mutate("template")}
          >
            <Layers className="h-3.5 w-3.5 mr-1" />
            New Leads template
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs border-emerald-800/60 text-emerald-200/90 hover:bg-emerald-950/40"
            disabled={start.isPending}
            onClick={() => start.mutate("template_rebook")}
          >
            <Layers className="h-3.5 w-3.5 mr-1" />
            Rebook template
          </Button>
          <p className="text-[9px] text-gray-600 px-1 leading-relaxed">
            New Leads: full graph (~40 nodes) with Calendly + Lead PATCH. Rebook: Opportunity-only (~13 nodes), no Calendly.
          </p>
        </div>

        <section className="space-y-1">
          <h2 className="text-[10px] font-medium text-gray-500 px-1">Published</h2>
          {(workflows ?? []).length === 0 ? (
            <p className="text-[10px] text-gray-600 px-1">None yet — save, test, then apply.</p>
          ) : (
            <ul className="space-y-0.5">
              {(workflows ?? []).map((wf) => (
                <li key={wf.id}>
                  <button
                    type="button"
                    onClick={() => openPublished(wf)}
                    className={cn(
                      "group w-full rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
                      selectedWorkflowId === wf.id
                        ? "bg-violet-500/10 text-violet-100"
                        : "text-gray-300 hover:bg-gray-900/80",
                    )}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Workflow className="h-3 w-3 shrink-0 text-violet-400/80" />
                      <span className="truncate flex-1">{wf.name}</span>
                      {wf.status === "active" ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="Active" />
                      ) : (
                        <button
                          type="button"
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-500 hover:text-violet-300 shrink-0"
                          disabled={activate.isPending}
                          title="Activate"
                          onClick={(e) => {
                            e.stopPropagation();
                            activate.mutate(wf.id);
                          }}
                        >
                          <Play className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-1">
          <h2 className="text-[10px] font-medium text-gray-500 px-1">Drafts</h2>
          {(drafts ?? []).length === 0 ? (
            <p className="text-[10px] text-gray-600 px-1">No drafts.</p>
          ) : (
            <ul className="space-y-0.5 max-h-40 overflow-y-auto">
              {(drafts ?? []).map((d) => (
                <li key={d.sessionId}>
                  <div
                    className={cn(
                      "group flex items-center gap-0.5 rounded-md pr-1 transition-colors",
                      sessionId === d.sessionId && !selectedWorkflowId
                        ? "bg-gray-800 text-gray-100"
                        : "text-gray-500 hover:bg-gray-900/80 hover:text-gray-300",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openDraft(d.sessionId)}
                      className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-[11px] truncate"
                    >
                      <FileEdit className="h-3 w-3 inline mr-1.5 -mt-px opacity-60" />
                      {d.title.replace(/^Post-Call — /i, "")}
                      {d.versionNumber != null && (
                        <span className="text-gray-600 ml-1">v{d.versionNumber}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-rose-400 shrink-0 disabled:opacity-40"
                      disabled={deleteDraft.isPending}
                      title="Delete draft"
                      onClick={() => {
                        const label = d.title.replace(/^Post-Call — /i, "");
                        if (
                          window.confirm(
                            `Delete draft "${label}"? Its versions and chat history will be removed. Published workflows stay untouched.`,
                          )
                        ) {
                          deleteDraft.mutate(d.sessionId);
                        }
                      }}
                    >
                      {deleteDraft.isPending && deleteDraft.variables === d.sessionId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {activeWorkflow && (
          <p className="text-[10px] text-gray-600 px-1 pt-2 border-t border-gray-800/80 truncate">
            Live: <span className="text-emerald-400/90">{activeWorkflow.name}</span>
          </p>
        )}
      </aside>

      {/* Main panel */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Tabs
          value={mainTab}
          onValueChange={(v) => setMainTab(v as HubTab)}
          className="flex flex-col flex-1"
        >
          <div className="flex flex-col gap-2 border-b border-gray-800/80 px-3 pt-2 pb-2">
            <div className="flex items-center">
              <TabsList className="h-8 bg-transparent border-0 p-0 gap-1">
              <TabsTrigger
                value="editor"
                className="text-xs h-7 px-3 rounded-md data-[state=active]:bg-gray-800 data-[state=active]:shadow-none"
              >
                Editor
              </TabsTrigger>
              <TabsTrigger
                value="executions"
                className="text-xs h-7 px-3 rounded-md data-[state=active]:bg-gray-800 data-[state=active]:shadow-none"
              >
                <History className="h-3 w-3 mr-1" />
                Executions
                {failedCount > 0 && (
                  <Badge className="ml-1.5 h-4 min-w-4 px-1 text-[9px] bg-red-500/20 text-red-300 border-0">
                    {failedCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            </div>
            <WbahPostCallReadinessStrip />
          </div>

          <TabsContent value="editor" className="flex-1 m-0 p-3 min-h-0 flex flex-col data-[state=inactive]:hidden">
            {sessionId ? (
              <div className="flex-1 min-h-0 flex flex-col">
                <WbahPostCallWorkflowStudio
                  key={sessionId}
                  sessionId={sessionId}
                  hidePublishedSection
                  onOpenExecutions={() => setMainTab("executions")}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 gap-4 text-center px-6">
                <p className="text-sm text-gray-400">No workflow open</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-violet-600 hover:bg-violet-500"
                    disabled={start.isPending}
                    onClick={() => start.mutate("blank")}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    New blank
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-gray-700"
                    disabled={start.isPending}
                    onClick={() => start.mutate("template")}
                  >
                    <Layers className="h-3.5 w-3.5 mr-1" />
                    WBAH base template
                  </Button>
                </div>
                <p className="text-[11px] text-gray-600 max-w-sm">
                  Blank starts empty. Template loads the production n8n replacement workflow we built.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="executions" className="flex-1 m-0 p-3 data-[state=inactive]:hidden">
            <WbahPostCallExecutionsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
