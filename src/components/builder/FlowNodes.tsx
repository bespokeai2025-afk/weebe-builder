import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import { Pencil, Trash2, Flag, Plus, Hash, Globe, X } from "lucide-react";
import { useState } from "react";
import { useBuilderStore, type FlowNode } from "@/lib/builder/store";
import { cn } from "@/lib/utils";
import type { NodeKind, ExtractVariableItem } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Render text with {{variable}} tokens highlighted. */
function HighlightedPrompt({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span
            key={i}
            className="rounded px-1 py-0.5 text-[0.85em] font-mono font-medium bg-amber-200/80 text-amber-900 dark:bg-amber-400/25 dark:text-amber-200"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

interface Style {
  badge: string;
  badgeClass: string;
  headerClass: string;
  ringClass?: string;
}

const STYLES: Record<NodeKind, Style> = {
  conversation: {
    badge: "Conversation",
    badgeClass: "bg-rose-100 text-rose-700",
    headerClass: "bg-rose-50/70 border-rose-100",
  },
  function: {
    badge: "Function",
    badgeClass: "bg-violet-600 text-white shadow-sm",
    headerClass: "bg-violet-100 border-violet-300 dark:bg-violet-500/20 dark:border-violet-400/40",
    ringClass:
      "!ring-2 !ring-violet-500/70 !border-violet-500/70 shadow-[0_0_24px_-4px_rgba(139,92,246,0.55)] dark:shadow-[0_0_28px_-4px_rgba(167,139,250,0.6)]",
  },
  call_transfer: {
    badge: "Call Transfer",
    badgeClass: "bg-emerald-100 text-emerald-700",
    headerClass: "bg-emerald-50/70 border-emerald-100",
  },
  press_digit: {
    badge: "Press Digit",
    badgeClass: "bg-cyan-100 text-cyan-700",
    headerClass: "bg-cyan-50/70 border-cyan-100",
  },
  logic_split: {
    badge: "Logic Split",
    badgeClass: "bg-pink-100 text-pink-700",
    headerClass: "bg-pink-50/70 border-pink-100",
  },
  agent_transfer: {
    badge: "Agent Transfer",
    badgeClass: "bg-orange-100 text-orange-700",
    headerClass: "bg-orange-50/70 border-orange-100",
  },
  sms: {
    badge: "In-Call SMS",
    badgeClass: "bg-amber-100 text-amber-700",
    headerClass: "bg-amber-50/70 border-amber-100",
  },
  extract_variable: {
    badge: "Extract Variable",
    badgeClass: "bg-indigo-100 text-indigo-700",
    headerClass: "bg-indigo-50/70 border-indigo-100",
  },
  code: {
    badge: "Code",
    badgeClass: "bg-slate-200 text-slate-800",
    headerClass: "bg-slate-50 border-slate-200",
  },
  ending: {
    badge: "End Call",
    badgeClass: "bg-rose-100 text-rose-700",
    headerClass: "bg-rose-50/70 border-rose-100",
  },
  note: {
    badge: "Note",
    badgeClass: "bg-yellow-100 text-yellow-800",
    headerClass: "bg-yellow-50 border-yellow-200",
  },
  wa_start: {
    badge: "WA Start",
    badgeClass: "bg-green-600 text-white",
    headerClass: "bg-green-600/10 border-green-500/30",
  },
  wa_message: {
    badge: "WA Message",
    badgeClass: "bg-green-100 text-green-800",
    headerClass: "bg-green-50/70 border-green-200",
  },
  wa_delay: {
    badge: "WA Delay",
    badgeClass: "bg-teal-100 text-teal-800",
    headerClass: "bg-teal-50/70 border-teal-200",
  },
  wa_media: {
    badge: "WA Media",
    badgeClass: "bg-lime-100 text-lime-800",
    headerClass: "bg-lime-50/70 border-lime-200",
  },
  wa_booking: {
    badge: "WA Booking",
    badgeClass: "bg-sky-100 text-sky-800",
    headerClass: "bg-sky-50/70 border-sky-200",
  },
  wa_wait_reply: {
    badge: "WA Wait Reply",
    badgeClass: "bg-amber-100 text-amber-800",
    headerClass: "bg-amber-50/70 border-amber-200",
  },
  wa_extract_var: {
    badge: "WA Extract Var",
    badgeClass: "bg-indigo-100 text-indigo-800",
    headerClass: "bg-indigo-50/70 border-indigo-200",
  },
  wa_tag: {
    badge: "WA Tag",
    badgeClass: "bg-purple-100 text-purple-800",
    headerClass: "bg-purple-50/70 border-purple-200",
  },
  wa_template: {
    badge: "WA Template",
    badgeClass: "bg-blue-100 text-blue-800",
    headerClass: "bg-blue-50/70 border-blue-200",
  },
  check_documents: {
    badge: "Check Docs",
    badgeClass: "bg-teal-600 text-white shadow-sm",
    headerClass: "bg-teal-100 border-teal-300 dark:bg-teal-500/20 dark:border-teal-400/40",
    ringClass:
      "!ring-2 !ring-teal-500/70 !border-teal-500/70 shadow-[0_0_24px_-4px_rgba(20,184,166,0.55)] dark:shadow-[0_0_28px_-4px_rgba(45,212,191,0.6)]",
  },
  send_upload_link: {
    badge: "Send Link",
    badgeClass: "bg-sky-600 text-white shadow-sm",
    headerClass: "bg-sky-100 border-sky-300 dark:bg-sky-500/20 dark:border-sky-400/40",
    ringClass:
      "!ring-2 !ring-sky-500/70 !border-sky-500/70 shadow-[0_0_24px_-4px_rgba(14,165,233,0.55)] dark:shadow-[0_0_28px_-4px_rgba(56,189,248,0.6)]",
  },
  http_request: {
    badge: "HTTP Request",
    badgeClass: "bg-blue-600 text-white shadow-sm",
    headerClass: "bg-blue-100 border-blue-300 dark:bg-blue-500/20 dark:border-blue-400/40",
    ringClass:
      "!ring-2 !ring-blue-500/70 !border-blue-500/70 shadow-[0_0_24px_-4px_rgba(59,130,246,0.55)] dark:shadow-[0_0_28px_-4px_rgba(96,165,250,0.6)]",
  },
};

function resolveNodeKind(data: FlowNode["data"] | undefined): NodeKind {
  const kind = data?.kind;
  if (kind && Object.prototype.hasOwnProperty.call(STYLES, kind)) return kind;
  return "conversation";
}

function resolveNodeStyle(data: FlowNode["data"] | undefined): Style {
  return STYLES[resolveNodeKind(data)];
}

type FlowVisualState = "idle" | "connected" | "selected" | "active";

function flowVisualState({
  isConnected,
  isSelected,
  isActive,
}: {
  isConnected: boolean;
  isSelected: boolean;
  isActive: boolean;
}): FlowVisualState {
  if (isSelected) return "selected";
  if (isActive) return "active";
  if (isConnected) return "connected";
  return "idle";
}

function flowHandleState({
  isConnected,
  isSelected,
  isActive,
}: {
  isConnected: boolean;
  isSelected: boolean;
  isActive: boolean;
}): FlowVisualState {
  if (isSelected) return "selected";
  if (isActive) return "active";
  if (isConnected) return "connected";
  return "idle";
}

const NODE_SURFACE_CLASS =
  "webee-flow-node overflow-visible rounded-2xl border text-[#0a1220] transition-[border-color,box-shadow] duration-200";
const NODE_HEADER_CLASS = "webee-flow-node__header relative rounded-t-xl border-b px-3 py-2";
const NODE_SECTION_CLASS = "webee-flow-node__section mx-2 rounded-lg border";
const NODE_ITEM_CLASS =
  "webee-flow-node__item relative flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs";
const HANDLE_CLASS = "webee-flow-handle";

/**
 * Conversation-style node matching the dashboard UI:
 * - Ice-white header with # icon + node name
 * - Deep navy prompt body
 * - Separate "Transition" section with + and per-transition source handles
 */
function ConversationStyleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const isSelected = selected || selectedNodeId === id;
  const edges = useBuilderStore((s) => s.edges);
  const nodeData = data ?? ({} as FlowNode["data"]);
  const kind = resolveNodeKind(nodeData);
  const visualState = flowVisualState({
    isConnected: edges.some((edge) => edge.source === id || edge.target === id),
    isSelected,
    isActive,
  });
  const isTargetConnected = edges.some((edge) => edge.target === id);
  const connectedSourceHandles = new Set(
    edges
      .filter((edge) => edge.source === id && edge.sourceHandle)
      .map((edge) => edge.sourceHandle),
  );

  const addTransition = () =>
    updateNode(id, {
      transitions: [
        ...(nodeData.transitions ?? []),
        { id: `t-${Date.now().toString(36)}`, condition: "", target: null },
      ],
    });

  return (
    <div className="relative group">
      {nodeData.isStart && (
        <div className="absolute -top-7 -left-2 z-10 flex items-center gap-1 rounded-md bg-violet-500 px-2 py-0.5 text-[10px] font-medium text-white shadow">
          <Flag className="h-3 w-3" /> Begin
        </div>
      )}

      <div
        {...(data.isStart ? { "data-tour": "node-root" } : {})}
        data-flow-state={visualState}
        className={cn(NODE_SURFACE_CLASS, "w-72")}
      >
        {/* Header */}
        <div className={NODE_HEADER_CLASS}>
          <Handle
            type="target"
            position={Position.Left}
            data-flow-state={flowHandleState({
              isConnected: isTargetConnected,
              isSelected,
              isActive,
            })}
            className={cn(HANDLE_CLASS, "!h-2.5 !w-2.5 !-left-1.5 !top-3")}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <Hash className="h-3.5 w-3.5 text-[#087c9f]" />
              <span className="truncate text-sm font-semibold text-[#0b1627]">{data.label}</span>
              {data.isGlobalNode && (
                <span
                  title="Global node"
                  className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
                >
                  <Globe className="h-3 w-3" /> Global
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-100 transition-opacity">
              <button
                onClick={() => selectNode(id)}
                className="rounded p-1 text-[#1d4ed8] hover:bg-white hover:text-[#1e3a8a]"
                aria-label="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => deleteNode(id)}
                className="rounded p-1 text-rose-600 hover:bg-white hover:text-rose-700"
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Prompt body */}
        <div className="cursor-pointer px-3 py-3" onClick={() => selectNode(id)}>
          {data.dialogue || data.endingPrompt || data.smsMessage ? (
            <HighlightedPrompt
              text={data.dialogue || data.endingPrompt || data.smsMessage || ""}
              className="webee-flow-node__body-text line-clamp-4 whitespace-pre-wrap text-sm"
            />
          ) : (
            <p className="webee-flow-node__placeholder text-sm italic">Tap to add prompt…</p>
          )}
        </div>

        {/* Transitions section */}
        {kind !== "ending" && kind !== "note" && (
          <div className={cn(NODE_SECTION_CLASS, "mb-2")}>
            <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-1.5 text-xs">
              <span className="inline-flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-70">
                  <path
                    d="M2 2 L6 6 L2 10 M6 6 L10 6"
                    stroke="currentColor"
                    fill="none"
                    strokeWidth="1.5"
                  />
                </svg>
                Transition
              </span>
              <button
                onClick={addTransition}
                className="rounded p-0.5 hover:bg-background"
                aria-label="Add transition"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            {(nodeData.transitions ?? []).length > 0 && (
              <div className="px-1 pb-1 space-y-1">
                {(nodeData.transitions ?? []).map((t) => (
                  <div key={t.id} className={NODE_ITEM_CLASS}>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      className="text-muted-foreground shrink-0"
                    >
                      <circle cx="6" cy="6" r="2.5" fill="currentColor" />
                      <path d="M1 6 L3 6 M9 6 L11 6" stroke="currentColor" strokeWidth="1" />
                    </svg>
                    <span className="webee-flow-node__item-label flex-1 truncate">
                      {t.condition || "Set condition…"}
                    </span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={t.id}
                      data-flow-state={flowHandleState({
                        isConnected: connectedSourceHandles.has(t.id),
                        isSelected,
                        isActive,
                      })}
                      className={cn(HANDLE_CLASS, "!h-2.5 !w-2.5 !-right-1.5")}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact node for End Call / Note — no transitions section */
function SimpleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const isSelected = selected || selectedNodeId === id;
  const edges = useBuilderStore((s) => s.edges);
  const nodeData = data ?? ({} as FlowNode["data"]);
  const kind = resolveNodeKind(nodeData);
  const style = resolveNodeStyle(nodeData);
  const isNote = kind === "note";
  const isConnected = edges.some((edge) => edge.source === id || edge.target === id);
  const visualState = flowVisualState({ isConnected, isSelected, isActive });
  const isTargetConnected = edges.some((edge) => edge.target === id);

  return (
    <div className="relative group">
      <div data-flow-state={visualState} className={cn(NODE_SURFACE_CLASS, "w-56 rounded-xl")}>
        <div className={NODE_HEADER_CLASS}>
          {!isNote && (
            <Handle
              type="target"
              position={Position.Left}
              data-flow-state={flowHandleState({
                isConnected: isTargetConnected,
                isSelected,
                isActive,
              })}
              className={cn(HANDLE_CLASS, "!h-2.5 !w-2.5 !-left-1.5 !top-3")}
            />
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", style.badgeClass)}
              >
                {style.badge}
              </span>
              <span className="truncate text-sm font-semibold text-[#0b1627]">{data.label}</span>
              {data.isGlobalNode && (
                <span
                  title="Global node"
                  className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
                >
                  <Globe className="h-3 w-3" /> Global
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-100">
              <button
                onClick={() => selectNode(id)}
                className="rounded p-1 text-[#1d4ed8] hover:text-[#1e3a8a]"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => deleteNode(id)}
                className="rounded p-1 text-rose-600 hover:text-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="cursor-pointer px-3 py-3" onClick={() => selectNode(id)}>
          {data.dialogue || data.endingPrompt || data.smsMessage ? (
            <HighlightedPrompt
              text={data.dialogue || data.endingPrompt || data.smsMessage || ""}
              className="webee-flow-node__body-text line-clamp-3 whitespace-pre-wrap text-sm"
            />
          ) : (
            <p className="webee-flow-node__placeholder text-sm italic">Tap to configure…</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Floating variable edit panel — rendered as a NodeToolbar to the right of the node. */
function VarPanel({
  item,
  isNew,
  onSave,
  onClose,
}: {
  item: ExtractVariableItem;
  isNew: boolean;
  onSave: (v: ExtractVariableItem) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ExtractVariableItem>(item);

  const TYPE_LABELS: Record<string, string> = {
    string: "Text",
    number: "Number",
    boolean: "Boolean",
    date: "Date",
    enum: "Enum",
  };

  return (
    <div
      className="webee-flow-node__panel nodrag nopan w-80 rounded-xl border p-4 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">Variables</span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Variable Name</Label>
        <Input
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="e.g. callback_type"
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          placeholder="What should the agent extract?"
          rows={3}
          className="text-sm resize-none"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Variable Type <span className="text-muted-foreground font-normal">(Optional)</span>
        </Label>
        <Select
          value={draft.type}
          onValueChange={(v) => setDraft((d) => ({ ...d, type: v as ExtractVariableItem["type"] }))}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([val, label]) => (
              <SelectItem key={val} value={val} className="text-sm">
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(draft)}>
          Save
        </Button>
      </div>
    </div>
  );
}

/** Dedicated node for Extract Variable — shows Variables section + Transitions. */
function ExtractVariableNode({ id, data, selected }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const isSelected = selected || selectedNodeId === id;
  const edges = useBuilderStore((s) => s.edges);
  const isConnected = edges.some((edge) => edge.source === id || edge.target === id);
  const visualState = flowVisualState({ isConnected, isSelected, isActive });
  const isTargetConnected = edges.some((edge) => edge.target === id);
  const connectedSourceHandles = new Set(
    edges
      .filter((edge) => edge.source === id && edge.sourceHandle)
      .map((edge) => edge.sourceHandle),
  );

  const [panelVar, setPanelVar] = useState<ExtractVariableItem | null>(null);
  const [panelIsNew, setPanelIsNew] = useState(false);

  const vars: ExtractVariableItem[] =
    data.extractVariables && data.extractVariables.length > 0
      ? (data.extractVariables as ExtractVariableItem[])
      : data.variableName
        ? [
            {
              id: "legacy",
              name: data.variableName as string,
              description: (data.variableDescription as string) ?? "",
              type: "string" as const,
            },
          ]
        : [];

  const openNew = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelVar({ id: crypto.randomUUID(), name: "", description: "", type: "string" });
    setPanelIsNew(true);
  };

  const openEdit = (v: ExtractVariableItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setPanelVar({ ...v });
    setPanelIsNew(false);
  };

  const closePanel = () => {
    setPanelVar(null);
    setPanelIsNew(false);
  };

  const saveVar = (saved: ExtractVariableItem) => {
    const existing = (data.extractVariables ?? []) as ExtractVariableItem[];
    const updated = panelIsNew
      ? [...existing, saved]
      : existing.map((v) => (v.id === saved.id ? saved : v));
    updateNode(id, {
      extractVariables: updated,
      variableName: undefined,
      variableDescription: undefined,
    });
    closePanel();
  };

  const addTransition = () =>
    updateNode(id, {
      transitions: [
        ...data.transitions,
        { id: `t-${Date.now().toString(36)}`, condition: "", target: null },
      ],
    });

  return (
    <div className="relative group">
      {/* Floating variable panel anchored to the right of this node */}
      <NodeToolbar isVisible={!!panelVar} position={Position.Right} offset={12}>
        {panelVar && (
          <VarPanel item={panelVar} isNew={panelIsNew} onSave={saveVar} onClose={closePanel} />
        )}
      </NodeToolbar>

      {data.isStart && (
        <div className="absolute -top-7 -left-2 z-10 flex items-center gap-1 rounded-md bg-violet-500 px-2 py-0.5 text-[10px] font-medium text-white shadow">
          <Flag className="h-3 w-3" /> Begin
        </div>
      )}
      <div
        {...(data.isStart ? { "data-tour": "node-root" } : {})}
        data-flow-state={visualState}
        className={cn(NODE_SURFACE_CLASS, "w-72")}
      >
        {/* Header */}
        <div className={NODE_HEADER_CLASS}>
          <Handle
            type="target"
            position={Position.Left}
            data-flow-state={flowHandleState({
              isConnected: isTargetConnected,
              isSelected,
              isActive,
            })}
            className={cn(HANDLE_CLASS, "!h-2.5 !w-2.5 !-left-1.5 !top-3")}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                {"{}"}
              </span>
              <span className="truncate text-sm font-semibold text-[#0b1627]">{data.label}</span>
              {data.isGlobalNode && (
                <span className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                  <Globe className="h-3 w-3" /> Global
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => selectNode(id)}
                className="rounded p-1 text-[#1d4ed8] hover:bg-white hover:text-[#1e3a8a]"
                aria-label="Edit node"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => deleteNode(id)}
                className="rounded p-1 text-rose-600 hover:bg-white hover:text-rose-700"
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Variables section */}
        <div className={cn(NODE_SECTION_CLASS, "mt-2")}>
          <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-1.5 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-[11px] leading-none">≡</span>
              Variables
            </span>
            <button
              onClick={openNew}
              className="rounded p-0.5 hover:bg-background"
              aria-label="Add variable"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          {vars.length > 0 && (
            <div className="px-1 pb-1 space-y-1">
              {vars.map((v) => (
                <div
                  key={v.id}
                  onClick={(e) => openEdit(v, e)}
                  className="webee-flow-node__item flex cursor-pointer items-center gap-1.5 transition-colors"
                >
                  <span className="font-mono font-bold text-indigo-500 shrink-0">{"{}"}</span>
                  <span className="webee-flow-node__item-label truncate">
                    {v.name || "unnamed"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transitions section */}
        <div className={cn(NODE_SECTION_CLASS, "my-2")}>
          <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-1.5 text-xs">
            <span className="inline-flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-70">
                <path
                  d="M2 2 L6 6 L2 10 M6 6 L10 6"
                  stroke="currentColor"
                  fill="none"
                  strokeWidth="1.5"
                />
              </svg>
              Transition
            </span>
            <button
              onClick={addTransition}
              className="rounded p-0.5 hover:bg-background"
              aria-label="Add transition"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          {data.transitions.length > 0 && (
            <div className="px-1 pb-1 space-y-1">
              {data.transitions.map((t) => (
                <div key={t.id} className={NODE_ITEM_CLASS}>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    className="text-muted-foreground shrink-0"
                  >
                    <circle cx="6" cy="6" r="2.5" fill="currentColor" />
                    <path d="M1 6 L3 6 M9 6 L11 6" stroke="currentColor" strokeWidth="1" />
                  </svg>
                  <span className="webee-flow-node__item-label flex-1 truncate">
                    {t.condition || "Set condition…"}
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={t.id}
                    data-flow-state={flowHandleState({
                      isConnected: connectedSourceHandles.has(t.id),
                      isSelected,
                      isActive,
                    })}
                    className={cn(HANDLE_CLASS, "!h-2.5 !w-2.5 !-right-1.5")}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const NodeRenderers: Record<NodeKind, typeof ConversationStyleNode> = {
  conversation: ConversationStyleNode,
  function: ConversationStyleNode,
  call_transfer: ConversationStyleNode,
  press_digit: ConversationStyleNode,
  logic_split: ConversationStyleNode,
  agent_transfer: ConversationStyleNode,
  sms: ConversationStyleNode,
  extract_variable: ExtractVariableNode,
  code: ConversationStyleNode,
  ending: SimpleNode,
  note: SimpleNode,
  wa_start: ConversationStyleNode,
  wa_message: ConversationStyleNode,
  wa_delay: SimpleNode,
  wa_media: ConversationStyleNode,
  wa_booking: ConversationStyleNode,
  wa_wait_reply: ConversationStyleNode,
  wa_extract_var: SimpleNode,
  wa_tag: SimpleNode,
  wa_template: ConversationStyleNode,
  check_documents: ConversationStyleNode,
  send_upload_link: ConversationStyleNode,
};
