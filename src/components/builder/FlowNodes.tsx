import { Handle, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import {
  Trash2,
  Flag,
  Plus,
  Globe,
  X,
  MessageSquare,
  Pencil,
  Settings,
  Bot,
  Braces,
  FunctionSquare,
  Clock,
  PhoneForwarded,
  Hash,
} from "lucide-react";
import { useState } from "react";
import { useBuilderStore, type FlowNode } from "@/lib/builder/store";
import { cn } from "@/lib/utils";
import type { NodeKind, ExtractVariableItem, Transition, TransitionConditionType } from "@/lib/builder/types";
import { EquationConditionEditor, patchEquationTransition } from "./EquationConditionEditor";
import { emptyEquationClause } from "@/lib/voice/graph/equations.shared";
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
import { InstructionTypeTabs } from "./NodeEditorDialog";
import { useNodeIssue } from "./flow-validation-context";
import { Switch } from "@/components/ui/switch";
import { VariableBareTextarea, VariableTextarea } from "./VariableAutocompleteField";

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
  begin: {
    badge: "Begin",
    badgeClass: "bg-violet-600 text-white",
    headerClass: "bg-violet-100 border-violet-300 dark:bg-violet-500/20 dark:border-violet-400/40",
  },
  wait: {
    badge: "Wait",
    badgeClass: "bg-amber-100 text-amber-800",
    headerClass: "bg-amber-50/70 border-amber-100",
  },
  subagent: {
    badge: "Subagent",
    badgeClass: "bg-sky-600 text-white",
    headerClass: "bg-sky-100 border-sky-300 dark:bg-sky-500/20 dark:border-sky-400/40",
  },
  mcp: {
    badge: "MCP",
    badgeClass: "bg-fuchsia-600 text-white",
    headerClass: "bg-fuchsia-100 border-fuchsia-300 dark:bg-fuchsia-500/20 dark:border-fuchsia-400/40",
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
  if (isActive) return "active";
  if (isSelected) return "selected";
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
  if (isActive) return "active";
  if (isSelected) return "selected";
  if (isConnected) return "connected";
  return "idle";
}

const NODE_SURFACE_CLASS =
  "webee-flow-node overflow-visible rounded-2xl border text-[#f4f7fb] transition-[border-color,box-shadow] duration-200";
const NODE_HEADER_CLASS = "webee-flow-node__header relative rounded-t-xl border-b px-4 py-3";
const NODE_SECTION_CLASS = "webee-flow-node__section mx-3 rounded-lg border";
const NODE_ITEM_CLASS =
  "webee-flow-node__item relative flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs";
const HANDLE_CLASS = "webee-flow-handle";

function KindIcon({ kind, className }: { kind: NodeKind; className?: string }) {
  const cls = cn("h-4 w-4 shrink-0", className);
  switch (kind) {
    case "function":
      return <FunctionSquare className={cls} />;
    case "extract_variable":
    case "wa_extract_var":
      return <Braces className={cls} />;
    case "subagent":
      return <Bot className={cls} />;
    case "wait":
      return <Clock className={cls} />;
    case "call_transfer":
    case "agent_transfer":
      return <PhoneForwarded className={cls} />;
    case "conversation":
    case "begin":
      return <MessageSquare className={cls} />;
    default:
      return <Hash className={cls} />;
  }
}

function ConditionTypeIcon({ type }: { type: TransitionConditionType }) {
  if (type === "equation") {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-500/15 font-serif text-[13px] font-semibold text-violet-300"
        title="Equation"
      >
        Σ
      </span>
    );
  }
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-sky-300"
      title="Prompt"
    >
      <MessageSquare className="h-3.5 w-3.5" />
    </span>
  );
}

function TransitionRows({
  nodeId,
  transitions,
  connectedSourceHandles,
  isSelected,
  isActive,
  defaultEquation,
  onChange,
}: {
  nodeId: string;
  transitions: Transition[];
  connectedSourceHandles: Set<string | null | undefined>;
  isSelected: boolean;
  isActive: boolean;
  defaultEquation?: boolean;
  onChange: (next: Transition[]) => void;
}) {
  const deleteEdge = useBuilderStore((s) => s.deleteEdge);
  const edges = useBuilderStore((s) => s.edges);
  const [editingId, setEditingId] = useState<string | null>(null);

  const remove = (t: Transition) => {
    onChange(transitions.filter((x) => x.id !== t.id));
    for (const edge of edges) {
      if (edge.source === nodeId && edge.sourceHandle === t.id) deleteEdge(edge.id);
    }
  };

  return (
    <div className="px-1.5 pb-1.5 space-y-1.5">
      {transitions.map((t, i) => {
        const type = t.conditionType ?? (defaultEquation ? "equation" : "prompt");
        const editing = editingId === t.id;
        const summary =
          type === "equation"
            ? t.condition ||
              (t.equations ?? [])
                .map((c) => `${c.left} ${c.operator} ${c.right ?? ""}`.trim())
                .filter(Boolean)
                .join(t.equationJoin === "&&" ? " AND " : " OR ") ||
              "Set equation…"
            : t.condition || "Set condition…";
        return (
          <div key={t.id} className={cn(NODE_ITEM_CLASS, "group/row items-start")}>
            <button
              type="button"
              className="nodrag nopan mt-0.5"
              title={type === "equation" ? "Switch to prompt" : "Switch to equation"}
              onClick={(e) => {
                e.stopPropagation();
                const next = [...transitions];
                next[i] =
                  type === "equation"
                    ? { ...t, conditionType: "prompt" }
                    : patchEquationTransition(
                        { ...t, conditionType: "equation" },
                        {
                          equationJoin: t.equationJoin ?? "||",
                          equations: t.equations?.length ? t.equations : [emptyEquationClause()],
                        },
                      );
                onChange(next);
              }}
            >
              <ConditionTypeIcon type={type} />
            </button>
            {editing ? (
              type === "equation" ? (
                <div
                  className="nodrag nopan nowheel min-w-0 flex-1"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setEditingId(null);
                    }
                  }}
                >
                  <EquationConditionEditor
                    compact
                    transition={t}
                    onChange={(updated) => {
                      const next = [...transitions];
                      next[i] = updated;
                      onChange(next);
                    }}
                  />
                </div>
              ) : (
                <VariableBareTextarea
                  autoFocus
                  value={t.condition}
                  onValueChange={(v) => {
                    const next = [...transitions];
                    next[i] = { ...t, condition: v };
                    onChange(next);
                  }}
                  placeholder="Condition the caller might say…"
                  className="nodrag nopan nowheel min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-xs leading-snug text-[#f4f7fb] outline-none focus:border-sky-400/70 focus:bg-[#0b1627]"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      setEditingId(null);
                    }
                  }}
                />
              )
            ) : (
              <button
                type="button"
                className="nodrag nopan min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-0.5 text-left whitespace-pre-wrap break-words text-xs leading-snug text-[#d5e2ed]"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(t.id);
                }}
              >
                {summary}
              </button>
            )}
            <div className="nodrag nopan mt-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
              <button
                type="button"
                className="rounded p-0.5 text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label={editing ? "Done" : "Edit transition"}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(editing ? null : t.id);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-rose-400 hover:bg-rose-500/15 hover:text-rose-300"
                aria-label="Delete transition"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(t);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
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
        );
      })}
    </div>
  );
}

function issueRingClass(level: "error" | "warn" | undefined): string | undefined {
  if (level === "error") return "!border-rose-500/80 shadow-[0_0_18px_-4px_rgba(244,63,94,0.55)]";
  if (level === "warn") return "!border-amber-400/70 shadow-[0_0_16px_-4px_rgba(251,191,36,0.4)]";
  return undefined;
}

/**
 * Conversation-style node matching the dashboard UI:
 * Ice-white header, navy body, Prompt/Static on the card, inline transitions.
 */
function ConversationStyleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const isSelected = selected || selectedNodeId === id;
  const edges = useBuilderStore((s) => s.edges);
  const issueLevel = useNodeIssue(id);
  const nodeData = data ?? ({} as FlowNode["data"]);
  const kind = resolveNodeKind(nodeData);
  const style = resolveNodeStyle(nodeData);
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
  const isPromptNode =
    kind === "conversation" || kind === "begin" || kind === "wait" || kind === "subagent";
  const instructionType = nodeData.instructionType ?? "prompt";

  const addTransition = () =>
    updateNode(id, {
      transitions: [
        ...(nodeData.transitions ?? []),
        { id: `t-${Date.now().toString(36)}`, condition: "", target: null, conditionType: "prompt" },
      ],
    });

  const setTransitions = (transitions: Transition[]) => updateNode(id, { transitions });

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
        className={cn("min-w-[400px] max-w-[560px] w-[480px]", NODE_SURFACE_CLASS, issueRingClass(issueLevel))}
      >
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <KindIcon kind={kind} className="text-[#087c9f]" />
              <input
                value={nodeData.label}
                onChange={(e) => updateNode(id, { label: e.target.value })}
                className="nodrag nopan nowheel min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0b1627] outline-none"
                onClick={(e) => e.stopPropagation()}
              />
              {data.isGlobalNode && (
                <span
                  title="Global node"
                  className="inline-flex items-center gap-0.5 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
                >
                  <Globe className="h-3 w-3" /> Global
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectNode(id);
                }}
                className="rounded p-1 text-[#3d5a73] hover:bg-white"
                aria-label="Edit node"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNode(id);
                }}
                className="rounded p-1 text-rose-600 hover:bg-white hover:text-rose-700"
                aria-label="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="webee-flow-node__kind mt-1.5 text-[10px] font-semibold uppercase tracking-wide">
            {style.badge}
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          {isPromptNode && (
            <div className="nodrag nopan" onClick={(e) => e.stopPropagation()}>
              <InstructionTypeTabs
                compact
                value={instructionType}
                onChange={(v) => updateNode(id, { instructionType: v })}
              />
            </div>
          )}
          <VariableTextarea
            rows={isPromptNode ? 6 : 4}
            value={
              isPromptNode
                ? nodeData.dialogue
                : nodeData.dialogue || nodeData.endingPrompt || nodeData.smsMessage || ""
            }
            onValueChange={(v) => {
              if (isPromptNode) updateNode(id, { dialogue: v });
              else if (kind === "sms") updateNode(id, { smsMessage: v });
              else updateNode(id, { dialogue: v });
            }}
            placeholder={
              kind === "wait"
                ? "Optional line while waiting…"
                : isPromptNode
                  ? instructionType === "static_text"
                    ? "What the agent says, word for word…"
                    : instructionType === "template"
                      ? "Spoken line with {{variables}} — not an LLM instruction…"
                      : "Instructions for this turn — not read aloud…"
                  : kind === "mcp"
                    ? "When should this MCP tool run?"
                    : "Tap to add prompt…"
            }
            className="nodrag nopan nowheel text-sm leading-relaxed resize-none min-h-[128px]"
            onClick={(e) => e.stopPropagation()}
            onFocus={() => selectNode(id)}
          />
          {(kind === "wait" || kind === "mcp" || kind === "http_request" || kind === "function") && (
            <p className="text-[10px] text-muted-foreground leading-snug">
              {kind === "wait"
                ? `Wait ${nodeData.waitTimeoutMs ?? 8000}ms for ${nodeData.waitMode === "silence" ? "silence" : "speech"}`
                : kind === "mcp"
                  ? nodeData.mcpToolName || nodeData.mcpServerUrl || "Configure MCP server and tool"
                  : kind === "function"
                    ? `${nodeData.toolName || nodeData.label} ${nodeData.httpMethod ?? "POST"} ${nodeData.httpUrl || nodeData.toolId || ""}`.trim()
                    : `${nodeData.httpMethod ?? "POST"} ${nodeData.httpUrl || "no URL"}`}
            </p>
          )}
        </div>

        {kind !== "ending" && kind !== "note" && (
          <div className={cn(NODE_SECTION_CLASS, "mb-3")}>
            <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-2 text-xs">
              <span>Transitions</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  addTransition();
                }}
                className="rounded p-0.5 hover:bg-background"
                aria-label="Add transition"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            {(nodeData.transitions ?? []).length > 0 && (
              <TransitionRows
                nodeId={id}
                transitions={nodeData.transitions ?? []}
                connectedSourceHandles={connectedSourceHandles}
                isSelected={isSelected}
                isActive={isActive}
                onChange={setTransitions}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FunctionStyleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const isSelected = selected || selectedNodeId === id;
  const edges = useBuilderStore((s) => s.edges);
  const issueLevel = useNodeIssue(id);
  const nodeData = data ?? ({} as FlowNode["data"]);
  const visualState = flowVisualState({
    isConnected: edges.some((edge) => edge.source === id || edge.target === id),
    isSelected,
    isActive,
  });
  const isTargetConnected = edges.some((edge) => edge.target === id);
  const connectedSourceHandles = new Set(
    edges.filter((edge) => edge.source === id && edge.sourceHandle).map((edge) => edge.sourceHandle),
  );

  const addTransition = () =>
    updateNode(id, {
      transitions: [
        ...(nodeData.transitions ?? []),
        { id: `t-${Date.now().toString(36)}`, condition: "", target: null, conditionType: "equation" },
      ],
    });

  return (
    <div className="relative group">
      <div
        data-flow-state={visualState}
        className={cn("min-w-[400px] w-[480px] max-w-[560px]", NODE_SURFACE_CLASS, issueRingClass(issueLevel))}
      >
        <div className={cn(NODE_HEADER_CLASS, "bg-violet-100 border-violet-200")}>
          <Handle
            type="target"
            position={Position.Left}
            data-flow-state={flowHandleState({ isConnected: isTargetConnected, isSelected, isActive })}
            className={cn(HANDLE_CLASS, "!h-2.5 !w-2.5 !-left-1.5 !top-3")}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white">
                <FunctionSquare className="h-3.5 w-3.5" />
              </span>
              <input
                value={nodeData.label}
                onChange={(e) => updateNode(id, { label: e.target.value })}
                className="nodrag nopan nowheel min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0b1627] outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                className="rounded p-1 text-[#3d5a73] hover:bg-white"
                aria-label="Edit function"
                onClick={(e) => {
                  e.stopPropagation();
                  selectNode(id);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-rose-600 hover:bg-white"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNode(id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="webee-flow-node__kind mt-1.5 text-[10px] font-semibold uppercase tracking-wide">
            Function
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#d5e2ed]">
              <Settings className="h-3.5 w-3.5 text-violet-300" />
              Configure setting
            </span>
            <button
              type="button"
              className="nodrag nopan rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500"
              onClick={(e) => {
                e.stopPropagation();
                selectNode(id);
              }}
            >
              Open
            </button>
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {(nodeData.toolName || nodeData.label) +
              (nodeData.httpUrl ? ` · ${nodeData.httpMethod ?? "POST"} ${nodeData.httpUrl}` : "")}
          </p>
          <VariableTextarea
            rows={4}
            value={nodeData.dialogue}
            onValueChange={(v) => updateNode(id, { dialogue: v })}
            placeholder="When should this function run?"
            className="nodrag nopan nowheel min-h-[96px] resize-none text-sm leading-relaxed"
            onClick={(e) => e.stopPropagation()}
            onFocus={() => selectNode(id)}
          />
        </div>

        <div className={cn(NODE_SECTION_CLASS, "mb-3")}>
          <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-2 text-xs">
            <span>Transitions</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                addTransition();
              }}
              className="rounded p-0.5 hover:bg-background"
              aria-label="Add transition"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          {(nodeData.transitions ?? []).length > 0 && (
            <TransitionRows
              nodeId={id}
              transitions={nodeData.transitions ?? []}
              connectedSourceHandles={connectedSourceHandles}
              isSelected={isSelected}
              isActive={isActive}
              defaultEquation
              onChange={(transitions) => updateNode(id, { transitions })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SubagentStyleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const isSelected = selected || selectedNodeId === id;
  const edges = useBuilderStore((s) => s.edges);
  const issueLevel = useNodeIssue(id);
  const nodeData = data ?? ({} as FlowNode["data"]);
  const visualState = flowVisualState({
    isConnected: edges.some((edge) => edge.source === id || edge.target === id),
    isSelected,
    isActive,
  });
  const isTargetConnected = edges.some((edge) => edge.target === id);
  const connectedSourceHandles = new Set(
    edges.filter((edge) => edge.source === id && edge.sourceHandle).map((edge) => edge.sourceHandle),
  );
  const tools = String(nodeData.subagentToolIds ?? "")
    .split(/[,\s]+/)
    .filter(Boolean);
  const kbs = String(nodeData.subagentKbIds ?? "")
    .split(/[,\s]+/)
    .filter(Boolean);

  const addTransition = () =>
    updateNode(id, {
      transitions: [
        ...(nodeData.transitions ?? []),
        { id: `t-${Date.now().toString(36)}`, condition: "", target: null, conditionType: "prompt" },
      ],
    });

  return (
    <div className="relative group">
      <div
        data-flow-state={visualState}
        className={cn("min-w-[400px] w-[480px] max-w-[560px]", NODE_SURFACE_CLASS, issueRingClass(issueLevel))}
      >
        <div className={cn(NODE_HEADER_CLASS, "bg-sky-100 border-sky-200")}>
          <Handle
            type="target"
            position={Position.Left}
            data-flow-state={flowHandleState({ isConnected: isTargetConnected, isSelected, isActive })}
            className={cn(HANDLE_CLASS, "!h-2.5 !w-2.5 !-left-1.5 !top-3")}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-600 text-white">
                <Bot className="h-3.5 w-3.5" />
              </span>
              <input
                value={nodeData.label}
                onChange={(e) => updateNode(id, { label: e.target.value })}
                className="nodrag nopan nowheel min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0b1627] outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                className="rounded p-1 text-[#3d5a73] hover:bg-white"
                aria-label="Edit subagent"
                onClick={(e) => {
                  e.stopPropagation();
                  selectNode(id);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-rose-600 hover:bg-white"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNode(id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="webee-flow-node__kind mt-1.5 text-[10px] font-semibold uppercase tracking-wide">
            Subagent
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {tools.length === 0 && kbs.length === 0 && (
              <span className="text-[11px] text-muted-foreground">No tools or knowledge bases yet</span>
            )}
            {tools.map((t) => (
              <span
                key={t}
                className="rounded-md bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] text-sky-200"
              >
                {t}
              </span>
            ))}
            {kbs.map((k) => (
              <span
                key={k}
                className="rounded-md bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200"
              >
                kb:{k}
              </span>
            ))}
          </div>
          <VariableTextarea
            rows={4}
            value={nodeData.dialogue}
            onValueChange={(v) => updateNode(id, { dialogue: v })}
            placeholder="What this subagent should do…"
            className="nodrag nopan nowheel min-h-[96px] resize-none text-sm leading-relaxed"
            onClick={(e) => e.stopPropagation()}
            onFocus={() => selectNode(id)}
          />
        </div>

        <div className={cn(NODE_SECTION_CLASS, "mb-3")}>
          <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-2 text-xs">
            <span>Transitions</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                addTransition();
              }}
              className="rounded p-0.5 hover:bg-background"
              aria-label="Add transition"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          {(nodeData.transitions ?? []).length > 0 && (
            <TransitionRows
              nodeId={id}
              transitions={nodeData.transitions ?? []}
              connectedSourceHandles={connectedSourceHandles}
              isSelected={isSelected}
              isActive={isActive}
              onChange={(transitions) => updateNode(id, { transitions })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact node for End Call / Note — editable on the card, no pencil modal. */
function SimpleNode({ id, data, selected }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const selectedNodeId = useBuilderStore((s) => s.selectedNodeId);
  const isSelected = selected || selectedNodeId === id;
  const edges = useBuilderStore((s) => s.edges);
  const nodeData = data ?? ({} as FlowNode["data"]);
  const kind = resolveNodeKind(nodeData);
  const style = resolveNodeStyle(nodeData);
  const isNote = kind === "note";
  const issueLevel = useNodeIssue(id);
  const isConnected = edges.some((edge) => edge.source === id || edge.target === id);
  const visualState = flowVisualState({ isConnected, isSelected, isActive });
  const isTargetConnected = edges.some((edge) => edge.target === id);
  const isEnding = kind === "ending";
  const instructionType = nodeData.instructionType ?? "prompt";

  return (
    <div className="relative group">
      <div
        data-flow-state={visualState}
        className={cn("w-[320px]", NODE_SURFACE_CLASS, issueRingClass(issueLevel))}
      >
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
              <input
                value={nodeData.label}
                onChange={(e) => updateNode(id, { label: e.target.value })}
                className="nodrag nopan nowheel min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#0b1627] outline-none"
                onClick={(e) => e.stopPropagation()}
                onFocus={() => selectNode(id)}
              />
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteNode(id);
              }}
              className="rounded p-1 text-rose-600 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="px-4 py-3 space-y-3">
          {isEnding && (
            <div className="nodrag nopan" onClick={(e) => e.stopPropagation()}>
              <InstructionTypeTabs
                compact
                value={instructionType}
                onChange={(v) => updateNode(id, { instructionType: v })}
              />
            </div>
          )}
          <Textarea
            rows={4}
            value={isEnding ? (nodeData.endingPrompt ?? nodeData.dialogue ?? "") : (nodeData.dialogue ?? "")}
            onChange={(e) =>
              updateNode(id, isEnding ? { endingPrompt: e.target.value } : { dialogue: e.target.value })
            }
            placeholder={
              isEnding
                ? instructionType === "static_text"
                  ? "Goodbye text, spoken exactly…"
                  : "How to end the call…"
                : "Note…"
            }
            className="nodrag nopan nowheel text-sm leading-relaxed resize-none min-h-[96px]"
            onClick={(e) => e.stopPropagation()}
            onFocus={() => selectNode(id)}
          />
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
    json: "JSON",
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

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <Label className="text-xs">Required</Label>
        <Switch
          checked={!!draft.required}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, required: v }))}
        />
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
  const issueLevel = useNodeIssue(id);
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
        className={cn("w-[340px]", NODE_SURFACE_CLASS, issueRingClass(issueLevel))}
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
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectNode(id);
                }}
                className="rounded p-1 text-[#3d5a73] hover:bg-white"
                aria-label="Edit node"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
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
        <div className={cn(NODE_SECTION_CLASS, "mt-3")}>
          <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-2 text-xs">
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
                  className="webee-flow-node__item group/row flex cursor-pointer items-center gap-1.5 transition-colors"
                >
                  <span className="font-mono font-bold text-indigo-500 shrink-0">{"{}"}</span>
                  <span className="webee-flow-node__item-label truncate">
                    {v.name || "unnamed"}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100">
                    <Pencil className="h-3 w-3 text-slate-300" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transitions section */}
        <div className={cn(NODE_SECTION_CLASS, "my-3")}>
          <div className="webee-flow-node__section-label flex items-center justify-between px-3 py-2 text-xs">
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
            <TransitionRows
              nodeId={id}
              transitions={data.transitions}
              connectedSourceHandles={connectedSourceHandles}
              isSelected={isSelected}
              isActive={isActive}
              onChange={(transitions) => updateNode(id, { transitions })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export const NodeRenderers: Record<NodeKind, typeof ConversationStyleNode> = {
  begin: ConversationStyleNode,
  conversation: ConversationStyleNode,
  wait: ConversationStyleNode,
  subagent: SubagentStyleNode,
  function: FunctionStyleNode,
  call_transfer: ConversationStyleNode,
  press_digit: ConversationStyleNode,
  logic_split: ConversationStyleNode,
  agent_transfer: ConversationStyleNode,
  sms: ConversationStyleNode,
  extract_variable: ExtractVariableNode,
  code: ConversationStyleNode,
  mcp: ConversationStyleNode,
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
  http_request: ConversationStyleNode,
};
