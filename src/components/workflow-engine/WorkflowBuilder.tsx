import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type Connection,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  X, Save, Plus, Zap, GitBranch, Square, ChevronRight, Trash2,
  PhoneCall, Database, MessageSquare, Mail, Bell, CheckCircle2,
  Calendar, UserCheck, RotateCcw, ArrowRight, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Step library ───────────────────────────────────────────────────────────────

export const STEP_LIBRARY = [
  {
    group: "Triggers",
    steps: [
      { type: "trigger", label: "Trigger",            icon: Zap,         color: "emerald", config: ["trigger_type"] },
    ],
  },
  {
    group: "Actions",
    steps: [
      { type: "call_lead",           label: "Call Lead",          icon: PhoneCall,   color: "blue",   config: ["agent_assignment"] },
      { type: "update_lead_status",  label: "Update Lead Status", icon: UserCheck,   color: "blue",   config: ["status"] },
      { type: "push_to_crm",         label: "Push to CRM",        icon: Database,    color: "blue",   config: [] },
      { type: "create_callback",     label: "Create Callback",    icon: RotateCcw,   color: "blue",   config: ["delay_hours"] },
      { type: "create_task",         label: "Create Task",        icon: CheckCircle2,color: "blue",   config: ["title"] },
      { type: "send_whatsapp",       label: "Send WhatsApp",      icon: MessageSquare,color:"green",  config: ["template"] },
      { type: "send_email",          label: "Send Email",         icon: Mail,        color: "violet", config: [] },
      { type: "create_booking",      label: "Create Booking",     icon: Calendar,    color: "blue",   config: [] },
      { type: "notify_user",         label: "Notify User",        icon: Bell,        color: "amber",  config: ["title"] },
      { type: "trigger_campaign",    label: "Trigger Campaign",   icon: ArrowRight,  color: "blue",   config: [] },
      { type: "assign_agent",        label: "Assign Agent",       icon: UserCheck,   color: "blue",   config: ["agent_assignment"] },
    ],
  },
  {
    group: "Logic",
    steps: [
      { type: "branch",        label: "Condition Branch", icon: GitBranch, color: "amber", config: ["conditions"] },
      { type: "stop_workflow", label: "Stop Workflow",    icon: Square,    color: "red",   config: [] },
    ],
  },
];

export const ALL_STEP_META = STEP_LIBRARY.flatMap(g => g.steps);
export function getStepMeta(type: string) {
  return ALL_STEP_META.find(s => s.type === type) ?? { type, label: type, icon: Zap, color: "muted", config: [] };
}

const LEAD_STATUSES = ["new","contacted","qualified","disqualified","callback","tried_to_contact","not_interested","pending_call"];
const TRIGGER_TYPES = [
  "manual","scheduled","lead_added","lead_status_changed",
  "callback_due","campaign_started","webhook_received","inbound_call","outbound_call_completed",
];

// ── Node colours ───────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, string> = {
  emerald: "#10b981",
  blue:    "#3b82f6",
  green:   "#22c55e",
  violet:  "#8b5cf6",
  amber:   "#f59e0b",
  red:     "#ef4444",
  muted:   "#64748b",
};

// ── Custom Nodes ───────────────────────────────────────────────────────────────

function StepNode({ data, selected }: NodeProps) {
  const meta = getStepMeta((data as any).step_type as string);
  const Icon = meta.icon;
  const color = COLOR_MAP[meta.color] ?? "#64748b";
  const isTrigger = meta.type === "trigger";
  const isEnd     = meta.type === "stop_workflow";
  const isBranch  = meta.type === "branch";

  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-card shadow-lg min-w-[180px] max-w-[220px] transition-all",
        selected ? "border-primary shadow-primary/20 shadow-xl" : "border-border/50",
      )}
      style={{ borderColor: selected ? color : undefined }}
    >
      {!isTrigger && <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-muted-foreground/50 !border-0" />}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 rounded-lg shrink-0" style={{ background: color + "20" }}>
            <Icon className="h-3.5 w-3.5" style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-foreground truncate">{(data as any).label as string}</div>
            <div className="text-[10px] text-muted-foreground truncate">{meta.label}</div>
          </div>
        </div>
        {(data as any).subtitle && (
          <div className="text-[10px] text-muted-foreground/70 truncate mt-0.5 pl-8">{(data as any).subtitle as string}</div>
        )}
      </div>
      {!isEnd && !isBranch && <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-muted-foreground/50 !border-0" />}
      {isBranch && (
        <>
          <Handle type="source" position={Position.Bottom} id="true"  className="!w-3 !h-3 !bg-emerald-500/70 !border-0 !left-[35%]" />
          <Handle type="source" position={Position.Bottom} id="false" className="!w-3 !h-3 !bg-red-500/70 !border-0 !left-[65%]" />
        </>
      )}
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

// ── Flow <-> definition converters ────────────────────────────────────────────

function stepsToFlow(steps: any[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const colWidth = 260;
  const rowHeight = 130;

  steps.forEach((step, i) => {
    const meta = getStepMeta(step.type);
    let subtitle = "";
    if (step.status)           subtitle = `Status: ${step.status}`;
    else if (step.title)       subtitle = step.title;
    else if (step.delay_hours) subtitle = `Delay: ${step.delay_hours}h`;
    else if (step.trigger_type) subtitle = step.trigger_type;

    nodes.push({
      id:       step.id,
      type:     "step",
      position: { x: 300, y: i * rowHeight + 40 },
      data:     { label: step.id, step_type: step.type, subtitle, raw: step },
    });

    if (step.next) {
      edges.push({ id: `e-${step.id}-${step.next}`, source: step.id, target: step.next, animated: true, style: { stroke: "#3b82f6", strokeWidth: 2 } });
    }
    if (step.conditions) {
      step.conditions.forEach((cond: any, ci: number) => {
        if (cond.next) {
          edges.push({
            id:     `e-${step.id}-${cond.next}-${ci}`,
            source: step.id,
            target: cond.next,
            label:  `${cond.field} ${cond.op} ${cond.value}`,
            animated: true,
            style: { stroke: "#f59e0b", strokeWidth: 1.5, strokeDasharray: "4 2" },
            labelStyle: { fontSize: 9, fill: "#f59e0b" },
          });
        }
      });
    }
  });

  return { nodes, edges };
}

function flowToSteps(nodes: Node[], edges: Edge[]): any[] {
  return nodes.map(node => {
    const raw = (node.data as any).raw ?? {};
    const outEdges = edges.filter(e => e.source === node.id);
    const result: any = { id: node.id, type: (node.data as any).step_type, ...raw };
    if (outEdges.length === 1 && !raw.conditions) result.next = outEdges[0].target;
    return result;
  });
}

// ── Step config panel ──────────────────────────────────────────────────────────

function StepConfigPanel({
  node,
  onClose,
  onUpdate,
  onDelete,
  allNodes,
}: {
  node: Node;
  onClose: () => void;
  onUpdate: (id: string, raw: any) => void;
  onDelete: (id: string) => void;
  allNodes: Node[];
}) {
  const raw: any = (node.data as any).raw ?? {};
  const meta = getStepMeta((node.data as any).step_type as string);
  const [form, setForm] = useState<any>({ ...raw });

  function save() {
    onUpdate(node.id as string, form);
    onClose();
  }

  const otherNodes = allNodes.filter(n => n.id !== node.id);

  return (
    <div className="absolute top-0 right-0 h-full w-72 bg-card border-l border-border/50 shadow-xl z-10 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div>
          <div className="text-sm font-semibold">{meta.label}</div>
          <div className="text-xs text-muted-foreground font-mono">{node.id}</div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Step ID</Label>
          <Input className="text-xs h-7" value={form.id ?? node.id} onChange={e => setForm((f: any) => ({ ...f, id: e.target.value }))} />
        </div>

        {/* trigger_type */}
        {meta.type === "trigger" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Trigger Type</Label>
            <Select value={form.trigger_type ?? "manual"} onValueChange={v => setForm((f: any) => ({ ...f, trigger_type: v }))}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* status */}
        {meta.config.includes("status") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Lead Status</Label>
            <Select value={form.status ?? ""} onValueChange={v => setForm((f: any) => ({ ...f, status: v }))}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select status" /></SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* title */}
        {meta.config.includes("title") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input className="text-xs h-7" placeholder="Task or notification title" value={form.title ?? ""} onChange={e => setForm((f: any) => ({ ...f, title: e.target.value }))} />
          </div>
        )}

        {/* delay_hours */}
        {meta.config.includes("delay_hours") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Delay (hours)</Label>
            <Input type="number" className="text-xs h-7" value={form.delay_hours ?? 0} onChange={e => setForm((f: any) => ({ ...f, delay_hours: Number(e.target.value) }))} />
          </div>
        )}

        {/* template */}
        {meta.config.includes("template") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Template name</Label>
            <Input className="text-xs h-7" placeholder="e.g. booking_confirmation" value={form.template ?? ""} onChange={e => setForm((f: any) => ({ ...f, template: e.target.value }))} />
          </div>
        )}

        {/* agent_assignment */}
        {meta.config.includes("agent_assignment") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Agent Assignment</Label>
            <Input className="text-xs h-7" placeholder="auto / agent name" value={form.agent_assignment ?? ""} onChange={e => setForm((f: any) => ({ ...f, agent_assignment: e.target.value }))} />
          </div>
        )}

        {/* next step (single-output) */}
        {meta.type !== "branch" && meta.type !== "stop_workflow" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Next Step</Label>
            <Select value={form.next ?? ""} onValueChange={v => setForm((f: any) => ({ ...f, next: v || undefined }))}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="(end)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="" className="text-xs">(none / end)</SelectItem>
                {otherNodes.map(n => <SelectItem key={n.id} value={n.id} className="text-xs">{n.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* branch conditions */}
        {meta.type === "branch" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Conditions</Label>
              <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() =>
                setForm((f: any) => ({ ...f, conditions: [...(f.conditions ?? []), { field: "call_outcome", op: "equals", value: "", next: "" }] }))
              }><Plus className="h-3 w-3 mr-1" />Add</Button>
            </div>
            {(form.conditions ?? []).map((cond: any, i: number) => (
              <div key={i} className="space-y-1.5 p-2 rounded border border-border/50 bg-muted/20">
                <div className="flex gap-1.5">
                  <Input className="text-[10px] h-6 flex-1" placeholder="field" value={cond.field} onChange={e => {
                    const c = [...(form.conditions ?? [])]; c[i] = { ...c[i], field: e.target.value }; setForm((f: any) => ({ ...f, conditions: c }));
                  }} />
                  <Select value={cond.op} onValueChange={v => {
                    const c = [...(form.conditions ?? [])]; c[i] = { ...c[i], op: v }; setForm((f: any) => ({ ...f, conditions: c }));
                  }}>
                    <SelectTrigger className="h-6 text-[10px] w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["equals","not_equals","greater_than","less_than","contains"].map(op => <SelectItem key={op} value={op} className="text-[10px]">{op}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-1.5">
                  <Input className="text-[10px] h-6 flex-1" placeholder="value" value={cond.value} onChange={e => {
                    const c = [...(form.conditions ?? [])]; c[i] = { ...c[i], value: e.target.value }; setForm((f: any) => ({ ...f, conditions: c }));
                  }} />
                  <Select value={cond.next ?? ""} onValueChange={v => {
                    const c = [...(form.conditions ?? [])]; c[i] = { ...c[i], next: v }; setForm((f: any) => ({ ...f, conditions: c }));
                  }}>
                    <SelectTrigger className="h-6 text-[10px] w-24"><SelectValue placeholder="→ step" /></SelectTrigger>
                    <SelectContent>
                      {otherNodes.map(n => <SelectItem key={n.id} value={n.id} className="text-[10px]">{n.id}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => {
                    const c = (form.conditions ?? []).filter((_: any, j: number) => j !== i); setForm((f: any) => ({ ...f, conditions: c }));
                  }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-border/50 flex gap-2">
        <Button className="flex-1 h-7 text-xs" onClick={save}><Save className="h-3 w-3 mr-1" />Save Step</Button>
        <Button size="icon" variant="outline" className="h-7 w-7 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => { onDelete(node.id as string); onClose(); }}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Main WorkflowBuilder ────────────────────────────────────────────────────────

interface WorkflowBuilderProps {
  initialFlow: Record<string, unknown>;
  onSave: (flow: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  workflowName: string;
}

export function WorkflowBuilder({ initialFlow, onSave, onClose, workflowName }: WorkflowBuilderProps) {
  const { nodes: initNodes, edges: initEdges } = stepsToFlow((initialFlow as any)?.steps ?? []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes.length ? initNodes : [
    { id: "trigger", type: "step", position: { x: 300, y: 40 },  data: { label: "trigger", step_type: "trigger", subtitle: "manual", raw: { id: "trigger", type: "trigger", trigger_type: "manual" } } },
    { id: "end",     type: "step", position: { x: 300, y: 200 }, data: { label: "end", step_type: "stop_workflow", subtitle: "", raw: { id: "end", type: "stop_workflow" } } },
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges.length ? initEdges : [
    { id: "e-trigger-end", source: "trigger", target: "end", animated: true, style: { stroke: "#3b82f6", strokeWidth: 2 } },
  ]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [saving, setSaving] = useState(false);
  const idCounter = useRef(nodes.length + 1);

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({ ...params, animated: true, style: { stroke: "#3b82f6", strokeWidth: 2 } }, eds));
  }, [setEdges]);

  function addStep(stepDef: typeof ALL_STEP_META[0]) {
    const id = `${stepDef.type}_${idCounter.current++}`;
    const raw = { id, type: stepDef.type };
    setNodes(ns => [...ns, {
      id,
      type: "step",
      position: { x: 300 + Math.random() * 40 - 20, y: 40 + ns.length * 130 },
      data: { label: id, step_type: stepDef.type, subtitle: "", raw },
    }]);
  }

  function updateNode(nodeId: string, raw: any) {
    setNodes(ns => ns.map(n => n.id !== nodeId ? n : {
      ...n,
      data: { ...n.data, raw, label: raw.id ?? n.id, step_type: raw.type ?? (n.data as any).step_type, subtitle: raw.status ?? raw.title ?? raw.delay_hours ? `${raw.delay_hours}h` : raw.trigger_type ?? "" },
    }));
  }

  function deleteNode(nodeId: string) {
    setNodes(ns => ns.filter(n => n.id !== nodeId));
    setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const steps = flowToSteps(nodes, edges);
      await onSave({ steps });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-card shrink-0">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose}><X className="h-4 w-4" /></Button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{workflowName}</div>
          <div className="text-xs text-muted-foreground">Workflow Builder</div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{nodes.length} steps</span>
          <span>·</span>
          <span>{edges.length} connections</span>
        </div>
        <Button className="gap-1.5 h-8" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</> : <><Save className="h-3.5 w-3.5" />Save Flow</>}
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Step Library */}
        <div className="w-52 border-r border-border/50 bg-card flex flex-col overflow-y-auto shrink-0">
          <div className="px-3 pt-3 pb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Step Library</p>
          </div>
          {STEP_LIBRARY.map(group => (
            <div key={group.group} className="mb-2">
              <p className="px-3 py-1 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">{group.group}</p>
              <div className="px-2 space-y-0.5">
                {group.steps.map(step => {
                  const Icon = step.icon;
                  const color = COLOR_MAP[step.color] ?? "#64748b";
                  return (
                    <button
                      key={step.type}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-muted/50 transition-colors group"
                      onClick={() => addStep(step)}
                    >
                      <div className="p-1 rounded shrink-0" style={{ background: color + "20" }}>
                        <Icon className="h-3 w-3" style={{ color }} />
                      </div>
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate">{step.label}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/50 ml-auto shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="p-3 mt-auto border-t border-border/30">
            <p className="text-[10px] text-muted-foreground/60">Click a step to add it to the canvas. Drag to connect steps.</p>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.04)" />
            <Controls className="!border-border/50 !bg-card !shadow-lg" />
            <MiniMap
              className="!border-border/50 !bg-card/80"
              nodeColor={n => COLOR_MAP[getStepMeta((n.data as any)?.step_type).color] + "60" ?? "#3b82f660"}
              maskColor="rgba(0,0,0,0.6)"
            />
            <Panel position="top-right" className="!m-2">
              <div className="flex gap-1.5">
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Trigger
                </Badge>
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Action
                </Badge>
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Logic
                </Badge>
              </div>
            </Panel>
          </ReactFlow>

          {/* Step config panel */}
          {selectedNode && (
            <StepConfigPanel
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onUpdate={updateNode}
              onDelete={deleteNode}
              allNodes={nodes}
            />
          )}
        </div>
      </div>
    </div>
  );
}
