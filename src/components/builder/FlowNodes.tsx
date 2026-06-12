import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Pencil, Trash2, Flag, Plus, Hash, Globe } from "lucide-react";
import { useBuilderStore, type FlowNode } from "@/lib/builder/store";
import { cn } from "@/lib/utils";
import type { NodeKind, ExtractVariableItem } from "@/lib/builder/types";

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
};

/**
 * Conversation-style node matching the dashboard UI:
 * - Pink-tinted header with # icon + node name
 * - White prompt card
 * - Separate "Transition" section with + and per-transition source handles
 */
function ConversationStyleNode({ id, data }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const style = STYLES[data.kind];

  const addTransition = () =>
    updateNode(id, {
      transitions: [
        ...data.transitions,
        { id: `t-${Date.now().toString(36)}`, condition: "", target: null },
      ],
    });

  return (
    <div className="relative group">
      {data.isStart && (
        <div className="absolute -top-7 -left-2 z-10 flex items-center gap-1 rounded-md bg-violet-500 px-2 py-0.5 text-[10px] font-medium text-white shadow">
          <Flag className="h-3 w-3" /> Begin
        </div>
      )}

      <div
        {...(data.isStart ? { "data-tour": "node-root" } : {})}
        className={cn(
          "w-72 rounded-2xl border bg-card text-card-foreground backdrop-blur-md shadow-[0_10px_30px_-10px_rgba(0,0,0,0.15)] ring-1 ring-border transition-all overflow-visible",
          "border-border hover:border-foreground/30 hover:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.25)]",
          "dark:bg-[rgba(17,24,39,0.85)] dark:border-white/10 dark:ring-white/5 dark:hover:border-[#4F8CFF]/40 dark:hover:shadow-[0_0_30px_-5px_rgba(79,140,255,0.35)]",
          !isActive && style.ringClass,
          isActive &&
            "!ring-4 !ring-emerald-500 !border-emerald-500 shadow-[0_0_40px_-2px_rgba(52,211,153,0.5)] animate-pulse",
        )}
      >
        {/* Header */}
        <div className={cn("relative rounded-t-xl border-b px-3 py-2", style.headerClass)}>
          <Handle
            type="target"
            position={Position.Left}
            className="!h-3 !w-3 !-left-1.5 !top-3 !bg-white !border !border-foreground/40"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <Hash className="h-3.5 w-3.5 text-foreground/60" />
              <span className="truncate text-sm font-medium">{data.label}</span>
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
        <div className="px-3 py-3 cursor-pointer" onClick={() => selectNode(id)}>
          {data.dialogue || data.endingPrompt || data.smsMessage ? (
            <HighlightedPrompt
              text={data.dialogue || data.endingPrompt || data.smsMessage || ""}
              className="text-sm text-foreground dark:text-white whitespace-pre-wrap line-clamp-4"
            />
          ) : (
            <p className="text-sm italic text-muted-foreground dark:text-white/60">
              Tap to add prompt…
            </p>
          )}
        </div>

        {/* Transitions section */}
        {data.kind !== "ending" && data.kind !== "note" && (
          <div className="mx-2 mb-2 rounded-lg bg-muted/40 border border-muted">
            <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
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
                  <div
                    key={t.id}
                    className="relative flex items-center gap-2 rounded-md bg-background border px-2 py-1.5 text-xs"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      className="text-muted-foreground shrink-0"
                    >
                      <circle cx="6" cy="6" r="2.5" fill="currentColor" />
                      <path d="M1 6 L3 6 M9 6 L11 6" stroke="currentColor" strokeWidth="1" />
                    </svg>
                    <span className="flex-1 truncate text-foreground/80">
                      {t.condition || "Set condition…"}
                    </span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={t.id}
                      className="!h-3 !w-3 !-right-1.5 !bg-white !border !border-foreground/40"
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
function SimpleNode({ id, data }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const style = STYLES[data.kind];
  const isNote = data.kind === "note";

  return (
    <div className="relative group">
      <div
        className={cn(
          "w-56 rounded-xl border bg-card shadow-sm overflow-visible",
          !isActive && style.ringClass,
          isActive &&
            "ring-4 ring-emerald-400 border-emerald-400 shadow-[0_0_30px_-2px_rgba(52,211,153,0.7)] animate-pulse",
        )}
      >
        <div className={cn("relative rounded-t-xl border-b px-3 py-2", style.headerClass)}>
          {!isNote && (
            <Handle
              type="target"
              position={Position.Left}
              className="!h-3 !w-3 !-left-1.5 !top-3 !bg-white !border !border-foreground/40"
            />
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", style.badgeClass)}
              >
                {style.badge}
              </span>
              <span className="truncate text-sm font-medium">{data.label}</span>
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
        <div className="px-3 py-3 cursor-pointer" onClick={() => selectNode(id)}>
          {data.dialogue || data.endingPrompt || data.smsMessage ? (
            <HighlightedPrompt
              text={data.dialogue || data.endingPrompt || data.smsMessage || ""}
              className="text-sm text-foreground whitespace-pre-wrap line-clamp-3"
            />
          ) : (
            <p className="text-sm italic text-muted-foreground">Tap to configure…</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Dedicated node for Extract Variable — shows Variables section + Transitions. */
function ExtractVariableNode({ id, data }: NodeProps<FlowNode>) {
  const selectNode = useBuilderStore((s) => s.selectNode);
  const selectNodeAddVar = useBuilderStore((s) => s.selectNodeAddVar);
  const deleteNode = useBuilderStore((s) => s.deleteNode);
  const updateNode = useBuilderStore((s) => s.updateNode);
  const isActive = useBuilderStore((s) => s.activeNodeId === id);
  const style = STYLES.extract_variable;

  const vars: ExtractVariableItem[] =
    data.extractVariables && data.extractVariables.length > 0
      ? (data.extractVariables as ExtractVariableItem[])
      : data.variableName
        ? [{ id: "legacy", name: data.variableName as string, description: (data.variableDescription as string) ?? "", type: "string" as const }]
        : [];

  const addTransition = () =>
    updateNode(id, {
      transitions: [
        ...data.transitions,
        { id: `t-${Date.now().toString(36)}`, condition: "", target: null },
      ],
    });

  return (
    <div className="relative group">
      {data.isStart && (
        <div className="absolute -top-7 -left-2 z-10 flex items-center gap-1 rounded-md bg-violet-500 px-2 py-0.5 text-[10px] font-medium text-white shadow">
          <Flag className="h-3 w-3" /> Begin
        </div>
      )}
      <div
        {...(data.isStart ? { "data-tour": "node-root" } : {})}
        className={cn(
          "w-72 rounded-2xl border bg-card text-card-foreground backdrop-blur-md shadow-[0_10px_30px_-10px_rgba(0,0,0,0.15)] ring-1 ring-border transition-all overflow-visible",
          "border-border hover:border-foreground/30 hover:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.25)]",
          "dark:bg-[rgba(17,24,39,0.85)] dark:border-white/10 dark:ring-white/5 dark:hover:border-[#4F8CFF]/40 dark:hover:shadow-[0_0_30px_-5px_rgba(79,140,255,0.35)]",
          isActive &&
            "!ring-4 !ring-emerald-500 !border-emerald-500 shadow-[0_0_40px_-2px_rgba(52,211,153,0.5)] animate-pulse",
        )}
      >
        {/* Header */}
        <div className={cn("relative rounded-t-xl border-b px-3 py-2", style.headerClass)}>
          <Handle
            type="target"
            position={Position.Left}
            className="!h-3 !w-3 !-left-1.5 !top-3 !bg-white !border !border-foreground/40"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">{"{}"}</span>
              <span className="truncate text-sm font-medium">{data.label}</span>
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

        {/* Variables section */}
        <div className="mx-2 mt-2 rounded-lg bg-muted/40 border border-muted">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-[11px] leading-none">≡</span>
              Variables
            </span>
            <button
              onClick={() => selectNodeAddVar(id)}
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
                  onClick={() => selectNode(id)}
                  className="flex items-center gap-1.5 rounded-md bg-background border px-2 py-1.5 text-xs cursor-pointer hover:border-indigo-300 transition-colors"
                >
                  <span className="font-mono font-bold text-indigo-500 shrink-0">{"{}"}</span>
                  <span className="truncate text-foreground/80">{v.name || "unnamed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transitions section */}
        <div className="mx-2 my-2 rounded-lg bg-muted/40 border border-muted">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-70">
                <path d="M2 2 L6 6 L2 10 M6 6 L10 6" stroke="currentColor" fill="none" strokeWidth="1.5" />
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
                <div
                  key={t.id}
                  className="relative flex items-center gap-2 rounded-md bg-background border px-2 py-1.5 text-xs"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" className="text-muted-foreground shrink-0">
                    <circle cx="6" cy="6" r="2.5" fill="currentColor" />
                    <path d="M1 6 L3 6 M9 6 L11 6" stroke="currentColor" strokeWidth="1" />
                  </svg>
                  <span className="flex-1 truncate text-foreground/80">
                    {t.condition || "Set condition…"}
                  </span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={t.id}
                    className="!h-3 !w-3 !-right-1.5 !bg-white !border !border-foreground/40"
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
};
