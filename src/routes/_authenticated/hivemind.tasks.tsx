import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef } from "react";
import {
  Brain, Plus, RefreshCw, CheckCircle2, Clock, AlertTriangle,
  ChevronDown, ChevronUp, Trash2, User, CalendarDays, MessageSquare,
  Loader2, Bell, BellOff, Zap, X, Check, ArrowRight, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import {
  runHiveMindScan, getHiveMindTasksAndEvents,
  updateHiveMindTask, createHiveMindTask,
  addHiveMindTaskComment, deleteHiveMindTask, markHiveMindEventsRead,
  type HiveMindTask, type HiveMindEvent, type TaskStatus, type TaskPriority,
} from "@/lib/hivemind/hivemind.tasks";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";

export const Route = createFileRoute("/_authenticated/hivemind/tasks")({
  head: () => ({ meta: [{ title: "HiveMind Tasks — Webee" }] }),
  component: HiveMindTasks,
});

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUS_TABS: { key: TaskStatus; label: string; icon: React.ElementType; color: string }[] = [
  { key: "suggested",  label: "Suggested",   icon: Sparkles,     color: "text-violet-400" },
  { key: "approved",   label: "Approved",    icon: CheckCircle2, color: "text-blue-400" },
  { key: "in_progress",label: "In Progress", icon: Clock,        color: "text-amber-400" },
  { key: "completed",  label: "Completed",   icon: Check,        color: "text-emerald-400" },
];

const PRIORITY_STYLES: Record<TaskPriority, { badge: string; dot: string; label: string }> = {
  low:      { badge: "bg-slate-500/15 text-slate-400 ring-slate-500/20",    dot: "bg-slate-400",    label: "Low" },
  medium:   { badge: "bg-blue-500/15 text-blue-400 ring-blue-500/20",       dot: "bg-blue-400",     label: "Medium" },
  high:     { badge: "bg-orange-500/15 text-orange-400 ring-orange-500/20", dot: "bg-orange-400",   label: "High" },
  critical: { badge: "bg-red-500/15 text-red-400 ring-red-500/20",          dot: "bg-red-400",      label: "Critical" },
};

const SEVERITY_STYLES = {
  info:     { bar: "bg-blue-500/60",   icon: "text-blue-400",   bg: "bg-blue-500/[0.06] border-blue-500/20" },
  warning:  { bar: "bg-amber-500/60",  icon: "text-amber-400",  bg: "bg-amber-500/[0.06] border-amber-500/20" },
  critical: { bar: "bg-red-500/60",    icon: "text-red-400",    bg: "bg-red-500/[0.06] border-red-500/20" },
};

const TRIGGER_LABELS: Record<string, string> = {
  idle_leads:             "Idle Leads",
  agent_not_deployed:     "Agent Not Deployed",
  campaign_stalled:       "Campaign Stalled",
  document_no_kb:         "Document Without KB",
  whatsapp_not_configured:"WhatsApp",
  openai_missing:         "AI Setup",
  manual:                 "Manual",
};

function fmtDueDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function uid() { return Math.random().toString(36).slice(2, 10); }

// ── Event strip ───────────────────────────────────────────────────────────────
function EventStrip({ events, onMarkRead }: { events: HiveMindEvent[]; onMarkRead: () => void }) {
  const unread = events.filter(e => !e.is_read);
  const [dismissed, setDismissed] = useState(false);
  if (!unread.length || dismissed) return null;
  return (
    <div className="border-b border-white/[0.06] bg-[hsl(var(--card))] px-5 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-violet-400" />
          <p className="text-xs font-semibold text-foreground">
            {unread.length} new notification{unread.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onMarkRead} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            Mark all read
          </button>
          <button onClick={() => setDismissed(true)} className="p-0.5 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {unread.slice(0, 4).map(ev => {
          const s = SEVERITY_STYLES[ev.severity] ?? SEVERITY_STYLES.info;
          return (
            <div key={ev.id} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2", s.bg)}>
              <div className={cn("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", s.bar.replace("bg-", "bg-").replace("/60",""))} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{ev.title}</p>
                {ev.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{ev.description}</p>}
              </div>
              <span className="text-[10px] text-muted-foreground/60 shrink-0 mt-0.5"><RelativeTime date={ev.created_at} short /></span>
            </div>
          );
        })}
        {unread.length > 4 && (
          <p className="text-[11px] text-muted-foreground text-center">+{unread.length - 4} more</p>
        )}
      </div>
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onStatusChange,
  onDelete,
  onUpdate,
  onAddComment,
  isMutating,
}: {
  task:          HiveMindTask;
  onStatusChange:(id: string, s: TaskStatus) => void;
  onDelete:      (id: string) => void;
  onUpdate:      (id: string, fields: Partial<HiveMindTask>) => void;
  onAddComment:  (taskId: string, text: string) => void;
  isMutating:    boolean;
}) {
  const [open, setOpen]           = useState(false);
  const [editAssign, setEditAssign] = useState(false);
  const [editDue, setEditDue]     = useState(false);
  const [assignVal, setAssignVal] = useState(task.assigned_to ?? "");
  const [dueVal, setDueVal]       = useState(task.due_date ?? "");
  const [commentText, setComment] = useState("");
  const [editTitle, setEditTitle]   = useState(false);
  const [titleVal, setTitleVal]   = useState(task.title);
  const p = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.medium;

  const NEXT_STATUS: Record<TaskStatus, { label: string; next: TaskStatus } | null> = {
    suggested:   { label: "Approve",     next: "approved" },
    approved:    { label: "Start work",  next: "in_progress" },
    in_progress: { label: "Complete",    next: "completed" },
    completed:   null,
  };

  const nextAction = NEXT_STATUS[task.status];

  function saveAssign() {
    onUpdate(task.id, { assigned_to: assignVal || null });
    setEditAssign(false);
  }
  function saveDue() {
    onUpdate(task.id, { due_date: dueVal || null });
    setEditDue(false);
  }
  function saveTitle() {
    if (titleVal.trim() && titleVal !== task.title) onUpdate(task.id, { title: titleVal.trim() });
    setEditTitle(false);
  }
  function submitComment() {
    if (!commentText.trim()) return;
    onAddComment(task.id, commentText.trim());
    setComment("");
  }

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      task.status === "completed"
        ? "bg-white/[0.01] border-white/[0.05] opacity-60"
        : "bg-[hsl(var(--card))] border-white/[0.08]",
    )}>
      {/* Card header */}
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Priority dot */}
        <div className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", p.dot)} />

        <div className="flex-1 min-w-0">
          {editTitle ? (
            <div className="flex items-center gap-2 mb-1">
              <input
                autoFocus
                value={titleVal}
                onChange={e => setTitleVal(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => e.key === "Enter" && saveTitle()}
                className="flex-1 bg-white/[0.06] border border-white/[0.12] rounded px-2 py-1 text-xs focus:outline-none focus:border-violet-500/40"
              />
            </div>
          ) : (
            <p
              className="text-sm font-medium cursor-text hover:text-violet-300 transition-colors"
              onClick={() => setEditTitle(true)}
            >
              {task.title}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1", p.badge)}>
              {p.label}
            </span>
            {task.trigger_type && (
              <span className="text-[10px] text-muted-foreground/60 bg-white/[0.04] rounded-full px-1.5 py-0.5">
                {TRIGGER_LABELS[task.trigger_type] ?? task.trigger_type}
              </span>
            )}
            {task.entity_name && (
              <span className="text-[10px] text-muted-foreground/50 truncate max-w-[120px]">
                {task.entity_name}
              </span>
            )}
            {task.assigned_to && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <User className="h-2.5 w-2.5" />{task.assigned_to}
              </span>
            )}
            {task.due_date && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <CalendarDays className="h-2.5 w-2.5" />{fmtDueDate(task.due_date)}
              </span>
            )}
            {task.comments.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <MessageSquare className="h-2.5 w-2.5" />{task.comments.length}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {nextAction && (
            <button
              onClick={() => onStatusChange(task.id, nextAction.next)}
              disabled={isMutating}
              className="flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-40"
            >
              <ArrowRight className="h-3 w-3" />
              {nextAction.label}
            </button>
          )}
          <button
            onClick={() => setOpen(o => !o)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-4">
          {/* Description */}
          {task.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{task.description}</p>
          )}

          {/* Metadata */}
          {task.metadata && Object.keys(task.metadata).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(task.metadata).map(([k, v]) =>
                typeof v !== "object" ? (
                  <span key={k} className="text-[11px] bg-white/[0.04] rounded px-2 py-0.5 text-muted-foreground">
                    <span className="capitalize">{k.replace(/_/g," ")}</span>: <span className="text-foreground font-medium">{String(v)}</span>
                  </span>
                ) : null
              )}
            </div>
          )}

          {/* Assign + Due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block">Assigned to</label>
              {editAssign ? (
                <div className="flex gap-1">
                  <input
                    autoFocus
                    value={assignVal}
                    onChange={e => setAssignVal(e.target.value)}
                    placeholder="Name or email"
                    className="flex-1 bg-white/[0.06] border border-white/[0.12] rounded px-2 py-1 text-xs focus:outline-none focus:border-violet-500/40"
                    onKeyDown={e => e.key === "Enter" && saveAssign()}
                  />
                  <button onClick={saveAssign} className="px-2 py-1 rounded bg-violet-500/20 text-violet-400 text-xs hover:bg-violet-500/30">Save</button>
                </div>
              ) : (
                <button onClick={() => setEditAssign(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {task.assigned_to ?? <span className="italic opacity-50">Unassigned</span>}
                </button>
              )}
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 block">Due date</label>
              {editDue ? (
                <div className="flex gap-1">
                  <input
                    autoFocus
                    type="date"
                    value={dueVal}
                    onChange={e => setDueVal(e.target.value)}
                    className="flex-1 bg-white/[0.06] border border-white/[0.12] rounded px-2 py-1 text-xs focus:outline-none focus:border-violet-500/40"
                  />
                  <button onClick={saveDue} className="px-2 py-1 rounded bg-violet-500/20 text-violet-400 text-xs hover:bg-violet-500/30">Save</button>
                </div>
              ) : (
                <button onClick={() => setEditDue(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {task.due_date ? fmtDueDate(task.due_date) : <span className="italic opacity-50">No due date</span>}
                </button>
              )}
            </div>
          </div>

          {/* Priority selector */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 block">Priority</label>
            <div className="flex gap-1.5">
              {(["low","medium","high","critical"] as TaskPriority[]).map(pr => (
                <button
                  key={pr}
                  onClick={() => onUpdate(task.id, { priority: pr })}
                  className={cn(
                    "flex-1 py-1 rounded border text-[10px] font-medium capitalize transition-all",
                    task.priority === pr
                      ? PRIORITY_STYLES[pr].badge + " ring-1"
                      : "border-white/[0.08] text-muted-foreground hover:text-foreground",
                  )}
                >
                  {pr}
                </button>
              ))}
            </div>
          </div>

          {/* Status selector */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 block">Status</label>
            <div className="flex gap-1.5">
              {STATUS_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => onStatusChange(task.id, key)}
                  disabled={isMutating}
                  className={cn(
                    "flex-1 py-1 rounded border text-[10px] font-medium capitalize transition-all disabled:opacity-40",
                    task.status === key
                      ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                      : "border-white/[0.08] text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Comments */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2 block">
              Comments ({task.comments.length})
            </label>
            {task.comments.length > 0 && (
              <div className="space-y-2 mb-3">
                {task.comments.map(c => (
                  <div key={c.id} className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] font-medium">{c.author}</span>
                      <span className="text-[10px] text-muted-foreground/50"><RelativeTime date={c.ts} short /></span>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.text}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={commentText}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && submitComment()}
                placeholder="Add a comment…"
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-violet-500/30 placeholder:text-muted-foreground/40"
              />
              <button
                onClick={submitComment}
                disabled={!commentText.trim()}
                className="px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 text-xs hover:bg-violet-500/30 transition-all disabled:opacity-40"
              >
                Post
              </button>
            </div>
          </div>

          {/* Delete */}
          <div className="flex justify-end pt-1 border-t border-white/[0.04]">
            <button
              onClick={() => onDelete(task.id)}
              disabled={isMutating}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              Delete task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create task modal ─────────────────────────────────────────────────────────
function CreateTaskModal({ onClose, onCreate }: {
  onClose:  () => void;
  onCreate: (fields: { title: string; description?: string; priority: TaskPriority }) => void;
}) {
  const [title, setTitle]     = useState("");
  const [desc,  setDesc]      = useState("");
  const [pri,   setPri]       = useState<TaskPriority>("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");

  function submit() {
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: desc.trim() || undefined, priority: pri });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-white/[0.12] bg-[hsl(var(--card))] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <p className="text-sm font-semibold">Create Task</p>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">Title *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/40"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional context or steps…"
              rows={3}
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/40 resize-none"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">Priority</label>
            <div className="flex gap-1.5">
              {(["low","medium","high","critical"] as TaskPriority[]).map(pr => (
                <button key={pr} onClick={() => setPri(pr)} className={cn(
                  "flex-1 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all",
                  pri === pr ? PRIORITY_STYLES[pr].badge + " ring-1" : "border-white/[0.08] text-muted-foreground hover:text-foreground",
                )}>{pr}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1.5 block">Assign to</label>
              <input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Name or email" className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-violet-500/40" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground mb-1.5 block">Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-violet-500/40" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!title.trim()} className="bg-violet-600 hover:bg-violet-700 text-white">
            Create Task
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function HiveMindTasks() {
  const qc           = useQueryClient();
  const scanFn       = useServerFn(runHiveMindScan);
  const getFn        = useServerFn(getHiveMindTasksAndEvents);
  const updateFn     = useServerFn(updateHiveMindTask);
  const createFn     = useServerFn(createHiveMindTask);
  const commentFn    = useServerFn(addHiveMindTaskComment);
  const deleteFn     = useServerFn(deleteHiveMindTask);
  const markReadFn   = useServerFn(markHiveMindEventsRead);

  const [activeTab, setActiveTab] = useState<TaskStatus>("suggested");
  const [scanning,  setScanning]  = useState(false);
  const [mutating,  setMutating]  = useState(false);
  const [scanMsg,   setScanMsg]   = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["hivemind-tasks"],
    queryFn:  () => getFn(),
    staleTime: 30_000,
  });

  const tasks  = data?.tasks  ?? [];
  const events = data?.events ?? [];

  const tabCounts = STATUS_TABS.reduce((acc, { key }) => {
    acc[key] = tasks.filter(t => t.status === key).length;
    return acc;
  }, {} as Record<TaskStatus, number>);

  const visibleTasks = tasks.filter(t => t.status === activeTab);

  async function handleScan() {
    setScanning(true); setScanMsg(null);
    try {
      const r = await scanFn();
      setScanMsg(r.newTasks > 0
        ? `Scan complete — ${r.newTasks} new task${r.newTasks !== 1 ? "s" : ""} created`
        : "Scan complete — no new issues found");
      await refetch();
      setTimeout(() => setScanMsg(null), 5000);
    } finally { setScanning(false); }
  }

  async function handleStatusChange(id: string, status: TaskStatus) {
    setMutating(true);
    try { await updateFn({ data: { id, status } }); await refetch(); }
    finally { setMutating(false); }
  }

  async function handleUpdate(id: string, fields: Partial<HiveMindTask>) {
    setMutating(true);
    try { await updateFn({ data: { id, ...fields } as any }); await refetch(); }
    finally { setMutating(false); }
  }

  async function handleDelete(id: string) {
    setMutating(true);
    try { await deleteFn({ data: { id } }); await refetch(); }
    finally { setMutating(false); }
  }

  async function handleAddComment(taskId: string, text: string) {
    setMutating(true);
    try { await commentFn({ data: { taskId, author: "You", text } }); await refetch(); }
    finally { setMutating(false); }
  }

  async function handleCreate(fields: { title: string; description?: string; priority: TaskPriority }) {
    setMutating(true);
    try { await createFn({ data: fields }); await refetch(); }
    finally { setMutating(false); }
  }

  async function handleMarkRead() {
    await markReadFn({ data: {} });
    await refetch();
  }

  return (
    <HiveMindShell>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/[0.07] bg-[hsl(var(--background))]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 ring-1 ring-violet-500/30 shrink-0">
          <CheckCircle2 className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">HiveMind Tasks</p>
          <p className="text-[11px] text-muted-foreground">
            {tasks.length} task{tasks.length !== 1 ? "s" : ""} · {tabCounts.suggested} suggested · {tabCounts.in_progress} in progress
          </p>
        </div>
        <div className="flex items-center gap-2">
          {scanMsg && (
            <p className="text-[11px] text-emerald-400 hidden sm:block">{scanMsg}</p>
          )}
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Scan
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-xs font-medium text-white transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New Task
          </button>
        </div>
      </div>

      {/* Event notifications */}
      <EventStrip events={events} onMarkRead={handleMarkRead} />

      {/* Tabs */}
      <div className="border-b border-white/[0.06] px-5">
        <div className="flex gap-0">
          {STATUS_TABS.map(({ key, label, icon: Icon, color }) => {
            const count = tabCounts[key];
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                  activeTab === key
                    ? "border-violet-400 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", activeTab === key && color)} />
                {label}
                {count > 0 && (
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                    activeTab === key
                      ? "bg-violet-500/20 text-violet-400"
                      : "bg-white/[0.08] text-muted-foreground",
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Task list */}
      <div className="px-5 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading tasks…
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
              {activeTab === "suggested" ? <Sparkles className="h-5 w-5 text-violet-400" /> : <CheckCircle2 className="h-5 w-5 text-muted-foreground" />}
            </div>
            <p className="text-sm font-medium">No {activeTab.replace("_"," ")} tasks</p>
            <p className="text-xs text-muted-foreground mt-1">
              {activeTab === "suggested"
                ? "Click Scan to let HiveMind check your platform for issues"
                : `Tasks will appear here when you move them to ${activeTab.replace("_"," ")}`}
            </p>
            {activeTab === "suggested" && (
              <button
                onClick={handleScan}
                disabled={scanning}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 px-4 py-2 text-xs font-medium text-violet-400 hover:bg-violet-500/25 transition-all disabled:opacity-40"
              >
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Run scan now
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visibleTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                onAddComment={handleAddComment}
                isMutating={mutating}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </HiveMindShell>
  );
}
