import { useState, useRef } from "react";
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
  { key: "open",        label: "Open",        color: "text-slate-400",   dot: "bg-slate-400",   dropColor: "ring-slate-400/30" },
  { key: "in_progress", label: "In Progress",  color: "text-sky-400",     dot: "bg-sky-400",     dropColor: "ring-sky-400/30" },
  { key: "done",        label: "Done",         color: "text-emerald-400", dot: "bg-emerald-400", dropColor: "ring-emerald-400/30" },
] as const;

type Status = "open" | "in_progress" | "done";

function TaskCard({ task, onMove, onDelete }: {
  task: any;
  onMove: (id: string, status: Status) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  async function del() {
    setDeleting(true);
    try { await onDelete(task.id); } finally { setDeleting(false); }
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("taskId", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 group cursor-grab active:cursor-grabbing active:opacity-60 transition-opacity"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize", PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.medium)}>
              {task.priority}
            </span>
            {task.due_at && (
              <span className="text-[10px] text-muted-foreground">
                Due {new Date(task.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", due_at: "" });
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

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
      await createFn({ data: { ...form, due_at: form.due_at || null } });
      setForm({ title: "", description: "", priority: "medium", due_at: "" });
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

  function handleDragOver(e: React.DragEvent, colKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(colKey);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(null);
    }
  }

  function handleDrop(e: React.DragEvent, colKey: string) {
    e.preventDefault();
    setDragOver(null);
    const taskId = e.dataTransfer.getData("taskId");
    if (taskId) move(taskId, colKey as Status);
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
              <p className="text-xs text-muted-foreground">CTO task board — drag cards between columns to change status</p>
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
                value={form.due_at}
                onChange={(e) => setForm({ ...form, due_at: e.target.value })}
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
              const isOver = dragOver === col.key;
              return (
                <div key={col.key} className="flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-3 shrink-0">
                    <div className={cn("h-2 w-2 rounded-full", col.dot)} />
                    <p className={cn("text-xs font-semibold", col.color)}>{col.label}</p>
                    <span className="ml-auto text-[10px] text-muted-foreground">{items.length}</span>
                  </div>
                  <div
                    className={cn(
                      "flex-1 overflow-y-auto space-y-2 rounded-xl border bg-white/[0.01] p-2 transition-all",
                      isOver
                        ? `border-sky-500/40 bg-sky-500/[0.03] ring-1 ${col.dropColor}`
                        : "border-white/[0.04]",
                    )}
                    onDragOver={(e) => handleDragOver(e, col.key)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col.key)}
                  >
                    {items.length === 0 && (
                      <div className={cn(
                        "py-8 text-center text-xs rounded-lg border-2 border-dashed transition-colors",
                        isOver ? "border-sky-500/30 text-sky-400/60" : "border-white/[0.04] text-muted-foreground/40",
                      )}>
                        {isOver ? "Drop here" : "No tasks"}
                      </div>
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
