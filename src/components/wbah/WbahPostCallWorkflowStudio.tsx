/**
 * WBAH Post-Call Workflow Studio — SystemMind chat + fullscreen n8n-style flow editor.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bot,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Maximize2,
  Play,
  Plus,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  WbahPostCallFlowCanvas,
  WbahPostCallFlowEditorFullscreen,
} from "@/components/wbah/WbahPostCallFlowCanvas";
import {
  activateWbahWorkflowFn,
  executeWbahNodeStepFn,
  getWbahPostCallQueueStatsFn,
  getWbahWorkflowSessionFn,
  listWbahWorkflowsFn,
  promptWbahWorkflowCopilotFn,
  saveWbahPipelineFn,
  startWbahWorkflowWizardFn,
} from "@/lib/systemmind/wbah-workflow-wizard.functions";
import {
  WBAH_POST_CALL_STEP_CATALOG,
  emptyWbahPostCallWorkflowConfig,
  type WbahPostCallWorkflowConfig,
} from "@/lib/wbah/workflow/wbah-workflow-steps.shared";
import {
  addN8nNodeToGraph,
  addStepToConfig,
  type WbahFlowGraphMeta,
} from "@/lib/wbah/workflow/wbah-workflow-graph.shared";
import type { WbahN8nNodeKind } from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import { formatUserFacingError } from "@/lib/format-error.shared";
import { applyNodeExecutionToPipeline } from "@/lib/wbah/workflow/wbah-node-execution.shared";
import { WbahGoLiveRunbook } from "@/components/wbah/WbahGoLiveRunbook";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

type ChatMsg = { id?: string; role: string; content: string; createdAt?: string };

type WbahPostCallWorkflowStudioProps = {
  /** When set by hub, skip auto-start and load this build session. */
  sessionId?: string | null;
  hidePublishedSection?: boolean;
  onOpenExecutions?: () => void;
};

export function WbahPostCallWorkflowStudio({
  sessionId: sessionIdProp,
  hidePublishedSection = false,
  onOpenExecutions,
}: WbahPostCallWorkflowStudioProps = {}) {
  const qc = useQueryClient();
  const startFn = useServerFn(startWbahWorkflowWizardFn);
  const sessionFn = useServerFn(getWbahWorkflowSessionFn);
  const promptFn = useServerFn(promptWbahWorkflowCopilotFn);
  const saveFn = useServerFn(saveWbahPipelineFn);
  const executeNodeFn = useServerFn(executeWbahNodeStepFn);
  const listFn = useServerFn(listWbahWorkflowsFn);
  const activateFn = useServerFn(activateWbahWorkflowFn);
  const queueFn = useServerFn(getWbahPostCallQueueStatsFn);

  const [sessionId, setSessionId] = useState<string | null>(sessionIdProp ?? null);
  const [pipeline, setPipeline] = useState<WbahPostCallWorkflowConfig>(() =>
    emptyWbahPostCallWorkflowConfig(),
  );
  const [graphMeta, setGraphMeta] = useState<WbahFlowGraphMeta | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [localMessages, setLocalMessages] = useState<ChatMsg[]>([]);
  const [studioTab, setStudioTab] = useState<"chat" | "flow">("flow");
  const [flowFullscreen, setFlowFullscreen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const start = useMutation({
    mutationFn: () => startFn(),
    onSuccess: (res) => {
      setSessionId(res.sessionId);
      toast.success("Workflow studio ready");
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  useEffect(() => {
    if (sessionIdProp) setSessionId(sessionIdProp);
  }, [sessionIdProp]);

  useEffect(() => {
    if (sessionIdProp || sessionId) return;
    if (!start.isPending && !start.isSuccess) {
      start.mutate();
    }
  }, [sessionIdProp, sessionId, start.isPending, start.isSuccess]);

  const { data: sessionData, refetch: refetchSession } = useQuery({
    queryKey: ["wbah-workflow-session", sessionId],
    queryFn: async () => {
      const res = await sessionFn({ data: { sessionId: sessionId! } } as any);
      return res as {
        sessionId: string;
        title: string;
        pipeline: WbahPostCallWorkflowConfig;
        graphMeta: WbahFlowGraphMeta | null;
        messages: ChatMsg[];
        versionNumber: number | null;
      };
    },
    enabled: !!sessionId,
    throwOnError: false,
  });

  useEffect(() => {
    if (sessionData?.pipeline) {
      setPipeline(sessionData.pipeline);
      setGraphMeta(sessionData.graphMeta);
    }
    if (sessionData?.messages?.length) {
      setLocalMessages(sessionData.messages);
    }
  }, [sessionData?.sessionId, sessionData?.versionNumber]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const { data: workflows } = useQuery({
    queryKey: ["wbah-workflows"],
    queryFn: () => listFn(),
    enabled: !hidePublishedSection,
    throwOnError: false,
  });

  const { data: queueStats } = useQuery({
    queryKey: ["wbah-queue-stats"],
    queryFn: () => queueFn(),
    refetchInterval: 30_000,
    enabled: !hidePublishedSection,
    throwOnError: false,
  });

  const copilot = useMutation({
    mutationFn: async (prompt: string) => {
      if (!sessionId) throw new Error("No session");
      setLocalMessages((m) => [...m, { role: "user", content: prompt }]);
      return promptFn({ data: { sessionId, prompt } });
    },
    onSuccess: async (res) => {
      setLocalMessages((m) => [
        ...m,
        { role: "systemmind", content: res.assistantSummary ?? "Workflow updated." },
      ]);
      if (res.mode === "build") {
        await refetchSession();
        toast.success(`Workflow updated (v${res.versionNumber})`);
      } else {
        toast.message("Copilot needs a few details", {
          description: "Answer the questions below, then send your reply.",
        });
      }
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  const save = useMutation({
    mutationFn: () => {
      if (!sessionId) throw new Error("No session");
      const meta = pipeline.n8n_graph?.nodes?.length
        ? {
            nodes: pipeline.n8n_graph.nodes.map((n) => ({ id: n.id, position: n.position })),
            edges: pipeline.n8n_graph.edges ?? [],
          }
        : graphMeta;
      return saveFn({ data: { sessionId, pipeline, graphMeta: meta } });
    },
    onSuccess: (res) => {
      toast.success(
        res?.automationValidation?.valid === false
          ? "Saved — automation validation has warnings"
          : "Workflow saved",
      );
      refetchSession();
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  const executeNode = useMutation({
    mutationFn: async ({ nodeId, pinData }: { nodeId: string; pinData?: unknown }) => {
      const res = await executeNodeFn({
        data: { pipeline, nodeId, pinData, dryRun: true },
      } as any);
      return res as {
        nodeId: string;
        status: "success" | "error" | "waiting";
        error: string | null;
        branch: string | null;
      };
    },
    onSuccess: (res) => {
      setPipeline((prev) => applyNodeExecutionToPipeline(prev, res.nodeId, res as any));
      if (res.status === "success") {
        toast.success(res.branch ? `Node ran (${res.branch} branch)` : "Node executed");
      } else if (res.status === "waiting") {
        toast.message("Node is waiting", { description: "Resume not supported in step execute yet." });
      } else {
        toast.error(res.error ?? "Node execution failed");
      }
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  const activate = useMutation({
    mutationFn: (workflowId: string) => activateFn({ data: { workflowId } }),
    onSuccess: () => {
      toast.success("Workflow activated");
      qc.invalidateQueries({ queryKey: ["wbah-workflows"] });
    },
    onError: (e) => toast.error(formatUserFacingError(e)),
  });

  function sendChat() {
    const p = chatInput.trim();
    if (!p || copilot.isPending) return;
    setChatInput("");
    copilot.mutate(p);
  }

  function addNode(catalogId: string) {
    setPipeline((prev) => {
      const next = addStepToConfig(prev, catalogId);
      setGraphMeta({
        nodes: (next.n8n_graph?.nodes ?? []).map((n) => ({ id: n.id, position: n.position })),
        edges: next.n8n_graph?.edges ?? [],
      });
      return next;
    });
  }

  function addN8nNode(kind: WbahN8nNodeKind) {
    setPipeline((prev) => {
      const next = addN8nNodeToGraph(prev, kind, {
        x: 400 + Math.random() * 120,
        y: 200 + Math.random() * 120,
      });
      setGraphMeta({
        nodes: (next.n8n_graph?.nodes ?? []).map((n) => ({ id: n.id, position: n.position })),
        edges: next.n8n_graph?.edges ?? [],
      });
      return next;
    });
  }

  function handleFlowChange(cfg: WbahPostCallWorkflowConfig, meta: WbahFlowGraphMeta) {
    setPipeline(cfg);
    setGraphMeta(meta);
  }

  const n8nNodeCount = pipeline.n8n_graph?.nodes?.length ?? 0;
  const enabledCount = pipeline.steps.filter((s) => s.enabled).length;
  const isGeneralWorkflow = pipeline.workflow_kind === "general" || enabledCount === 0;
  const req = pipeline.copilot_requirements;
  const compact = hidePublishedSection;

  const flowEditorProps = {
    config: pipeline,
    graphMeta,
    syncKey: sessionData?.versionNumber ?? sessionId,
    onChange: handleFlowChange,
    onSave: sessionId ? () => save.mutate() : undefined,
    savePending: save.isPending,
    onExecuteNode: sessionId
      ? async ({ nodeId, pinData }: { nodeId: string; pinData?: unknown }) => {
          await executeNode.mutateAsync({ nodeId, pinData });
        }
      : undefined,
    executeNodePending: executeNode.isPending,
  };

  return (
    <div className={cn("flex flex-col flex-1 min-h-0", compact ? "space-y-2" : "space-y-3")}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-100 truncate">{pipeline.name}</p>
          {!compact && (
            <p className="text-[10px] text-gray-500">
              {isGeneralWorkflow ? `${n8nNodeCount} nodes` : `${enabledCount} steps · ${n8nNodeCount} nodes`}
              {sessionData?.versionNumber != null && ` · v${sessionData.versionNumber}`}
            </p>
          )}
          {compact && sessionData?.versionNumber != null && (
            <p className="text-[10px] text-gray-500">v{sessionData.versionNumber}</p>
          )}
        </div>
        {!compact && queueStats && (
          <Badge variant="outline" className="text-[10px] border-gray-700 text-gray-400">
            {queueStats.pending} queued
          </Badge>
        )}
        <div className="flex gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs border-gray-700"
            disabled={save.isPending || !sessionId}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {!compact && <span className="ml-1">Save</span>}
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs bg-violet-600 hover:bg-violet-500"
            onClick={() => setFlowFullscreen(true)}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            {!compact && <span className="ml-1">Expand</span>}
          </Button>
          {sessionId && (
            <Button size="sm" variant="outline" className="h-8 text-xs border-gray-700" asChild>
              <a href={`/systemmind/build?session=${sessionId}`}>
                <FlaskConical className="h-3.5 w-3.5" />
                {!compact && <span className="ml-1">Test</span>}
              </a>
            </Button>
          )}
        </div>
      </div>

      {compact && sessionId && (
        <WbahGoLiveRunbook
          sessionId={sessionId}
          versionNumber={sessionData?.versionNumber ?? null}
          pipeline={pipeline}
          onSave={() => save.mutate()}
          savePending={save.isPending}
          onOpenExecutions={onOpenExecutions}
        />
      )}

      <Tabs value={studioTab} onValueChange={(v) => setStudioTab(v as "chat" | "flow")} className="flex flex-col flex-1 min-h-0">
        <TabsList className={cn("h-8", compact ? "bg-transparent border-0 p-0 gap-1" : "bg-gray-900/80 border border-gray-800")}>
          <TabsTrigger value="flow" className="text-xs h-7 px-3">
            Canvas
          </TabsTrigger>
          <TabsTrigger value="chat" className="text-xs h-7 px-3">
            <Sparkles className="h-3 w-3 mr-1" /> Copilot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="flow" className="mt-2 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
          <div className="flex-1 min-h-0 flex flex-col">
            <WbahPostCallFlowCanvas {...flowEditorProps} />
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] text-gray-500 hover:text-gray-300 px-2"
              >
                <ChevronDown className="h-3 w-3 mr-1" />
                Add steps or nodes
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              <div className="flex flex-wrap gap-1">
                {WBAH_POST_CALL_STEP_CATALOG.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] border-gray-800 px-2"
                    onClick={() => addNode(s.id)}
                  >
                    <Plus className="h-2.5 w-2.5 mr-0.5" />
                    {s.title}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {(["filter", "if", "merge", "code", "http", "wait"] as WbahN8nNodeKind[]).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px] border-gray-800 px-2 capitalize"
                    onClick={() => addN8nNode(kind)}
                  >
                    <Plus className="h-2.5 w-2.5 mr-0.5" />
                    {kind}
                  </Button>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>

        <TabsContent value="chat" className="mt-3">
          <div className="flex flex-col rounded-xl border border-violet-500/20 bg-gray-950/80 overflow-hidden min-h-[420px]">
            <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <p className="text-xs font-semibold text-violet-200">SystemMind Copilot</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[280px] max-h-[360px]">
              {localMessages.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-800 p-3 text-[11px] text-gray-500 space-y-2">
                  <p>
                    Describe any workflow — copilot guides you step-by-step, asks for env vars and links,
                    and builds nodes incrementally (never copies a template).
                  </p>
                  <div className="flex flex-col gap-1.5 pt-1">
                    {[
                      "I want a workflow that runs when a lead is added — help me design it step by step",
                      "Build an HTTP webhook workflow that posts JSON to an external API",
                      "When a Retell call ends, normalize the transcript and update our CRM",
                    ].map((example) => (
                      <button
                        key={example}
                        type="button"
                        className="text-left rounded-md border border-gray-800 bg-gray-900/60 px-2.5 py-2 text-[10px] text-gray-400 hover:border-violet-500/30 hover:text-gray-200 transition-colors"
                        onClick={() => setChatInput(example)}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(req?.env_vars?.length || req?.links?.length || req?.credentials?.length) ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-[10px] space-y-1.5">
                  <p className="font-medium text-amber-200/90">Setup requirements</p>
                  {req.env_vars?.map((e) => (
                    <p key={e.name} className="text-gray-400">
                      <span className="text-amber-300/90 font-mono">{e.name}</span> — {e.description}
                    </p>
                  ))}
                  {req.links?.map((l) => (
                    <p key={l.label} className="text-gray-400">
                      <span className="text-amber-300/90">{l.label}</span> — {l.description}
                    </p>
                  ))}
                  {req.credentials?.map((c) => (
                    <p key={c} className="text-gray-400">
                      Credential: <span className="text-amber-300/90">{c}</span>
                    </p>
                  ))}
                </div>
              ) : null}
              {localMessages.map((m, i) => (
                <div
                  key={m.id ?? i}
                  className={cn(
                    "rounded-lg px-2.5 py-2 text-[11px] leading-relaxed",
                    m.role === "user"
                      ? "bg-violet-500/10 border border-violet-500/20 text-gray-200 ml-4"
                      : "bg-gray-900 border border-gray-800 text-gray-400 mr-4",
                  )}
                >
                  {m.role === "systemmind" && (
                    <span className="flex items-center gap-1 text-[9px] text-violet-400 mb-1">
                      <Bot className="h-3 w-3" /> SystemMind
                    </span>
                  )}
                  {m.content}
                </div>
              ))}
              {copilot.isPending && (
                <div className="flex items-center gap-2 text-[11px] text-gray-500 px-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                  Building…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="border-t border-gray-800 p-2 flex gap-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                placeholder="Describe your post-call flow…"
                className="min-h-[52px] text-xs bg-gray-900 border-gray-800 resize-none"
              />
              <Button
                size="icon"
                className="shrink-0 h-[52px] w-[52px] bg-violet-600 hover:bg-violet-500"
                disabled={copilot.isPending || !chatInput.trim()}
                onClick={sendChat}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Fullscreen editor overlay */}
      <WbahPostCallFlowEditorFullscreen
        {...flowEditorProps}
        open={flowFullscreen}
        onCloseFullscreen={() => setFlowFullscreen(false)}
      />

      {/* Published workflows — shown when not using hub sidebar */}
      {!hidePublishedSection && (
        <div className="rounded-xl border border-gray-800 bg-gray-950/50 p-3 space-y-2">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Published workflows</p>
          {(workflows ?? []).length === 0 ? (
            <p className="text-[10px] text-gray-600">
              Save → Test & Apply in Build → Activate here for production.
            </p>
          ) : (
            <ul className="space-y-1">
              {(workflows ?? []).map((wf) => (
                <li key={wf.id} className="flex items-center gap-2 text-[11px]">
                  <span className="text-gray-300 truncate flex-1">{wf.name}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px]",
                      wf.status === "active" ? "border-emerald-500/40 text-emerald-300" : "border-gray-700",
                    )}
                  >
                    {wf.status}
                  </Badge>
                  {wf.status !== "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px]"
                      disabled={activate.isPending}
                      onClick={() => activate.mutate(wf.id)}
                    >
                      <Play className="h-3 w-3 mr-0.5" /> Activate
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-gray-600 flex items-center gap-1 pt-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            Production: each campaign call triggers the active workflow via webhook.
          </p>
        </div>
      )}
    </div>
  );
}
