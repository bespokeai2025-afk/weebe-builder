import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Play, Pause, Trash2, BarChart3, CheckCircle2, XCircle, Clock,
  Zap, RefreshCw, ChevronRight, AlertCircle, Loader2, Settings,
  Activity, TrendingUp, Search, GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  listWorkflowTemplates,
  listWorkspaceWorkflows,
  createWorkspaceWorkflow,
  updateWorkspaceWorkflow,
  deleteWorkspaceWorkflow,
  listWorkflowRuns,
  manualTriggerWorkflow,
  getWorkflowEngineStats,
  type WorkspaceWorkflow,
  type WorkflowRun,
} from "@/lib/workflow-engine/workflow-engine.functions";
import { WorkflowBuilder } from "@/components/workflow-engine/WorkflowBuilder";

const TRIGGER_LABELS: Record<string, string> = {
  manual:                   "Manual",
  scheduled:                "Scheduled",
  lead_added:               "Lead Added",
  lead_status_changed:      "Lead Status Changed",
  callback_due:             "Callback Due",
  campaign_started:         "Campaign Started",
  webhook_received:         "Webhook",
  inbound_call:             "Inbound Call",
  outbound_call_completed:  "Outbound Call Completed",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  active:   { label: "Active",   color: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5",   icon: CheckCircle2 },
  inactive: { label: "Inactive", color: "border-muted-foreground/30 text-muted-foreground",           icon: Clock },
  paused:   { label: "Paused",   color: "border-amber-500/30 text-amber-400 bg-amber-500/5",          icon: Pause },
  error:    { label: "Error",    color: "border-red-500/30 text-red-400 bg-red-500/5",                icon: AlertCircle },
};

const RUN_STATUS_CONFIG: Record<string, { color: string; icon: React.ElementType }> = {
  running:   { color: "text-blue-400",         icon: Loader2 },
  completed: { color: "text-emerald-400",      icon: CheckCircle2 },
  failed:    { color: "text-red-400",          icon: XCircle },
  skipped:   { color: "text-muted-foreground", icon: Clock },
};

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", color)}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-2xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkflowEnginePage() {
  const qc = useQueryClient();

  const listTemplatesFn = useServerFn(listWorkflowTemplates);
  const listWfFn        = useServerFn(listWorkspaceWorkflows);
  const createFn        = useServerFn(createWorkspaceWorkflow);
  const updateFn        = useServerFn(updateWorkspaceWorkflow);
  const deleteFn        = useServerFn(deleteWorkspaceWorkflow);
  const listRunsFn      = useServerFn(listWorkflowRuns);
  const triggerFn       = useServerFn(manualTriggerWorkflow);
  const statsFn         = useServerFn(getWorkflowEngineStats);

  const templatesQ = useQuery({ queryKey: ["workflow-templates-pub"],  queryFn: () => listTemplatesFn(), throwOnError: false });
  const workflowsQ = useQuery({ queryKey: ["workspace-workflows"],      queryFn: () => listWfFn(),        throwOnError: false });
  const runsQ      = useQuery({ queryKey: ["workflow-runs"],            queryFn: () => listRunsFn(),      throwOnError: false });
  const statsQ     = useQuery({ queryKey: ["workflow-engine-stats"],    queryFn: () => statsFn(),         throwOnError: false });

  const [search,        setSearch]        = useState("");
  const [createOpen,    setCreateOpen]    = useState(false);
  const [newForm,       setNewForm]       = useState({ name: "", description: "", trigger_type: "manual", template_id: "" });
  const [triggeringId,  setTriggeringId]  = useState<string | null>(null);
  const [builderWf,     setBuilderWf]     = useState<WorkspaceWorkflow | null>(null);

  const templates: any[]          = (templatesQ.data ?? []).filter((t: any) => t.status === "published");
  const workflows: WorkspaceWorkflow[] = workflowsQ.data ?? [];
  const runs: WorkflowRun[]       = runsQ.data ?? [];
  const stats                     = statsQ.data;

  const filtered = workflows.filter(w =>
    !search || w.name.toLowerCase().includes(search.toLowerCase()),
  );

  const createMut = useMutation({
    mutationFn: () => createFn({ data: {
      name:         newForm.name.trim(),
      description:  newForm.description.trim() || undefined,
      trigger_type: newForm.trigger_type,
      template_id:  newForm.template_id || undefined,
    }}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow-engine-stats"] });
      setCreateOpen(false);
      setNewForm({ name: "", description: "", trigger_type: "manual", template_id: "" });
      toast.success("Workflow created");
    },
    onError: (e: any) => toast.error("Failed to create workflow", { description: e?.message }),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, current }: { id: string; current: string }) =>
      updateFn({ data: { id, status: current === "active" ? "inactive" : "active" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow-engine-stats"] });
    },
    onError: (e: any) => toast.error("Failed to update", { description: e?.message }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-workflows"] });
      qc.invalidateQueries({ queryKey: ["workflow-engine-stats"] });
      toast.success("Workflow deleted");
    },
    onError: (e: any) => toast.error("Failed to delete", { description: e?.message }),
  });

  async function handleTrigger(id: string) {
    setTriggeringId(id);
    try {
      const { run_id } = await triggerFn({ data: { workflow_id: id } });
      toast.success("Workflow triggered", { description: `Run ${run_id.slice(0, 8)}…` });
      qc.invalidateQueries({ queryKey: ["workflow-runs"] });
      qc.invalidateQueries({ queryKey: ["workspace-workflows"] });
    } catch (e: any) {
      toast.error("Trigger failed", { description: e?.message });
    } finally {
      setTriggeringId(null);
    }
  }

  async function handleSaveFlow(wfId: string, flow: Record<string, unknown>) {
    await updateFn({ data: { id: wfId, flow_definition: flow } });
    qc.invalidateQueries({ queryKey: ["workspace-workflows"] });
    toast.success("Flow saved");
  }

  // ── WorkflowBuilder fullscreen overlay ────────────────────────────────────
  if (builderWf) {
    return (
      <WorkflowBuilder
        workflowName={builderWf.name}
        initialFlow={builderWf.flow_definition}
        onSave={async (flow) => { await handleSaveFlow(builderWf.id, flow); setBuilderWf(null); }}
        onClose={() => setBuilderWf(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflow Engine</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automate lead management, calling, follow-ups, and CRM updates.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> New Workflow
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Workflows"     value={stats.total_workflows}     icon={Zap}          color="bg-primary/10 text-primary" />
          <StatCard label="Active"              value={stats.active_workflows}    icon={Activity}     color="bg-emerald-500/10 text-emerald-500" />
          <StatCard label="Total Runs"          value={stats.total_runs}          icon={Play}         color="bg-blue-500/10 text-blue-500" />
          <StatCard label="Successful"          value={stats.successful_runs}     icon={CheckCircle2} color="bg-emerald-500/10 text-emerald-500" />
          <StatCard label="Failed"              value={stats.failed_runs}         icon={XCircle}      color="bg-red-500/10 text-red-500" />
          <StatCard label="Templates Available" value={stats.published_templates} icon={TrendingUp}   color="bg-violet-500/10 text-violet-500" />
        </div>
      )}

      <Tabs defaultValue="workflows">
        <TabsList>
          <TabsTrigger value="workflows" className="gap-2">
            <Zap className="h-3.5 w-3.5" />Workflows ({workflows.length})
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2">
            <BarChart3 className="h-3.5 w-3.5" />Run History
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <Settings className="h-3.5 w-3.5" />Templates
          </TabsTrigger>
        </TabsList>

        {/* ── Workflows Tab ── */}
        <TabsContent value="workflows" className="space-y-4 mt-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8 w-64" placeholder="Search workflows…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {workflowsQ.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading workflows…
            </div>
          )}

          {!workflowsQ.isLoading && filtered.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No workflows yet</p>
              <p className="text-sm mt-1">Create your first workflow from a template or from scratch.</p>
              <Button className="mt-4 gap-2" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> New Workflow
              </Button>
            </div>
          )}

          <div className="space-y-3">
            {filtered.map(wf => {
              const sc = STATUS_CONFIG[wf.status] ?? STATUS_CONFIG.inactive;
              const Icon = sc.icon;
              return (
                <Card key={wf.id}>
                  <div className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{wf.name}</span>
                        <Badge variant="outline" className={cn("text-[10px] gap-1", sc.color)}>
                          <Icon className={cn("h-2.5 w-2.5")} />
                          {sc.label}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {TRIGGER_LABELS[wf.trigger_type] ?? wf.trigger_type}
                        </Badge>
                      </div>
                      <div className="flex gap-4 mt-0.5 text-xs text-muted-foreground">
                        {wf.description && <span className="truncate max-w-xs">{wf.description}</span>}
                        <span>{wf.run_count ?? 0} run{wf.run_count !== 1 ? "s" : ""}</span>
                        {wf.last_run_at && (
                          <span>Last: {formatDistanceToNow(new Date(wf.last_run_at), { addSuffix: true })}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Edit flow builder */}
                      <Button
                        size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                        onClick={() => setBuilderWf(wf)}
                      >
                        <GitBranch className="h-3 w-3" /> Edit Flow
                      </Button>
                      {/* Run */}
                      <Button
                        size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                        onClick={() => handleTrigger(wf.id)}
                        disabled={triggeringId === wf.id}
                      >
                        {triggeringId === wf.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Play className="h-3 w-3" />}
                        Run
                      </Button>
                      {/* Activate/Pause */}
                      <Button
                        size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                        onClick={() => toggleMut.mutate({ id: wf.id, current: wf.status })}
                        disabled={toggleMut.isPending}
                      >
                        {wf.status === "active"
                          ? <><Pause className="h-3 w-3" /> Pause</>
                          : <><Play className="h-3 w-3" /> Activate</>}
                      </Button>
                      {/* Delete */}
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => { if (confirm(`Delete "${wf.name}"?`)) deleteMut.mutate(wf.id); }}
                        disabled={deleteMut.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Run History Tab ── */}
        <TabsContent value="runs" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">Last 100 workflow runs across all workflows.</p>
            <Button
              size="sm" variant="outline"
              onClick={() => qc.invalidateQueries({ queryKey: ["workflow-runs"] })}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>

          {runsQ.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
            </div>
          )}
          {!runsQ.isLoading && runs.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No runs yet</p>
              <p className="text-sm mt-1">Trigger a workflow to see execution history here.</p>
            </div>
          )}
          <div className="space-y-2">
            {runs.map(run => {
              const rc = RUN_STATUS_CONFIG[run.status] ?? RUN_STATUS_CONFIG.skipped;
              const Ico = rc.icon;
              return (
                <div key={run.id} className="flex items-center gap-3 px-4 py-2.5 rounded-lg border bg-card">
                  <Ico className={cn("h-4 w-4 shrink-0", rc.color, run.status === "running" && "animate-spin")} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium truncate">{run.workflow?.name ?? "Unknown"}</span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {run.trigger_type ?? "manual"}
                      </Badge>
                    </div>
                    {run.error && <p className="text-xs text-destructive mt-0.5 truncate">{run.error}</p>}
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Templates Tab ── */}
        <TabsContent value="templates" className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            Published platform templates — click to deploy to your workspace.
          </p>
          {templatesQ.isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => (
              <Card
                key={t.id}
                className="hover:border-primary/40 transition-colors cursor-pointer"
                onClick={() => {
                  setNewForm({
                    name:         t.name,
                    description:  t.description ?? "",
                    trigger_type: t.trigger_type,
                    template_id:  t.id,
                  });
                  setCreateOpen(true);
                }}
              >
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm">{t.name}</CardTitle>
                  {t.description && <CardDescription className="text-xs">{t.description}</CardDescription>}
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">
                      {TRIGGER_LABELS[t.trigger_type] ?? t.trigger_type}
                    </Badge>
                    {t.category && (
                      <Badge variant="outline" className="text-[10px]">{t.category.name}</Badge>
                    )}
                    {(t.tags ?? []).slice(0, 2).map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Workflow Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Workflow</DialogTitle>
            <DialogDescription>
              {newForm.template_id
                ? "Deploy this template to your workspace."
                : "Create a workflow from scratch."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Workflow Name *</Label>
              <Input
                value={newForm.name}
                onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. New Lead Qualification"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={newForm.description}
                onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What does this workflow do?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={newForm.trigger_type} onValueChange={v => setNewForm(f => ({ ...f, trigger_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TRIGGER_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newForm.template_id && (
              <div className="p-2 rounded-md border bg-muted/30 text-xs text-muted-foreground">
                Flow definition will be copied from the selected template.
                You can edit it visually after creating.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !newForm.name.trim()}
            >
              {createMut.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Creating…</>
                : "Create Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
