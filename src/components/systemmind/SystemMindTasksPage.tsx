import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckSquare, Plus, Loader2, Trash2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import {
  listSystemMindTasks,
  createSystemMindTask,
  updateSystemMindTask,
  deleteSystemMindTask,
} from "@/lib/systemmind/systemmind-cto.functions";

const PRIORITY_BADGE: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high:     "bg-orange-500/15 text-orange-400",
  medium:   "bg-amber-500/15 text-amber-400",
  low:      "bg-slate-500/15 text-slate-400",
};

const COLUMNS = [
  { key: "open",        label: "Open",        color: "text-slate-400",   dot: "bg-slate-400" },
  { key: "in_progress", label: "In Progress",  color: "text-sky-400",     dot: "bg-sky-400" },
  { key: "done",        label: "Done",         color: "text-emerald-400", dot: "bg-emerald-400" },
] as const;

type Status = "open" | "in_progress" | "done";

function TaskCard({ task, onMove, onDelete }: {
  task: any;
  onMove: (id: string, status: Status) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const statuses: Status[] = ["open", "in_progress", "done"];
  const nextStatus = statuses[(statuses.indexOf(task.status) + 1) % statuses.length];

  async function move() {
    setMoving(true);
    try { await onMove(task.id, nextStatus); } finally { setMoving(false); }
  }
  async function del() {
    setDeleting(true);
    try { await onDelete(task.id); } finally { setDeleting(false); }
  }

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 group">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize", PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.medium)}>
              {task.priority}
            </span>
            {task.due_date && (
              <span className="text-[10px] text-muted-foreground">
                Due {new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          <p className="text-xs font-semibold leading-snug">{task.title}</p>
          {task.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{task.description}</p>}
        </div>
        <button onClick={del} disabled={deleting} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400">
          {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </div>
      <button onClick={move} disabled={moving}
        className="mt-2 w-full rounded text-[10px] text-muted-foreground hover:text-sky-300 hover:bg-sky-500/[0.08] py-1 transition-colors text-center">
        {moving ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : `→ Move to ${nextStatus.replace("_", " ")}`}
      </button>
    </div>
  );
}

export function SystemMindTasksPage() {
  const listFn = useServerFn(listSystemMindTasks);
  const createFn = useServerFn(createSystemMindTask);
  const updateFn = useServerFn(updateSystemMindTask);
  const deleteFn = useServerFn(deleteSystemMindTask);
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", due_date: "" });
  const [saving, setSaving] = useState(false);

  const { data: tasks, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-tasks"],
    queryFn: () => listFn(),
  });

  function byStatus(status: string) {
    return (tasks as any[] ?? []).filter((t) => t.status === status);
  }

  async function create() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await createFn({ data: { ...form, due_date: form.due_date || null } });
      setForm({ title: "", description: "", priority: "medium", due_date: "" });
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["systemmind-tasks"] });
    } finally {
      setSaving(false);
    }
  }

  async function move(id: string, status: Status) {
    await updateFn({ data: { id, status } });
    qc.invalidateQueries({ queryKey: ["systemmind-tasks"] });
  }

  async function del(id: string) {
    await deleteFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["systemmind-tasks"] });
  }

  return (
    <SystemMindShell>
      <div className="px-4 py-6 md:px-8 h-full flex flex-col">
        <div className="flex items-start justify-between gap-4 mb-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
              <CheckSquare className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Tasks</h1>
              <p className="text-xs text-muted-foreground">CTO task board — track technical work across open, in-progress, and done</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)} className="bg-sky-600 hover:bg-sky-500 text-white">
              {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showForm ? "Cancel" : "Add Task"}
            </Button>
          </div>
        </div>

        {showForm && (
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-4 mb-5 shrink-0 space-y-3">
            <p className="text-xs font-semibold text-sky-300">New Task</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Task title"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
              />
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description (optional)"
              rows={2}
              className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
            />
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500/50"
              />
              <div className="ml-auto">
                <Button size="sm" onClick={create} disabled={saving || !form.title.trim()} className="bg-sky-600 hover:bg-sky-500 text-white">
                  {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Create Task"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0">
            {COLUMNS.map((col) => {
              const items = byStatus(col.key);
              return (
                <div key={col.key} className="flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-3 shrink-0">
                    <div className={cn("h-2 w-2 rounded-full", col.dot)} />
                    <p className={cn("text-xs font-semibold", col.color)}>{col.label}</p>
                    <span className="ml-auto text-[10px] text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 rounded-xl border border-white/[0.04] bg-white/[0.01] p-2">
                    {items.length === 0 && (
                      <div className="py-8 text-center text-xs text-muted-foreground/40">No tasks</div>
                    )}
                    {items.map((task: any) => (
                      <TaskCard key={task.id} task={task} onMove={move} onDelete={del} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
