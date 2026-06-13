import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Phone,
  Mail,
  Building2,
  ExternalLink,
  Loader2,
  AlertCircle,
  TrendingUp,
  MapPin,
  PhoneCall,
  CalendarCheck,
  StickyNote,
  ChevronLeft,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getPipelineLeads,
  setLeadPipelineStage,
  PIPELINE_STAGES,
  type PipelineLead,
  type PipelineStage,
} from "@/lib/pipeline/pipeline.functions";
import { PipelineLeadDrawer } from "@/components/pipeline/PipelineLeadDrawer";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Sales Pipeline — Webee" }] }),
  component: PipelinePage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n: number | null | undefined) {
  if (!n) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function initials(name: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

const STATUS_LABEL: Record<string, string> = {
  need_to_call:  "New",
  calling:       "Calling",
  interested:    "Interested",
  not_connected: "No Answer",
  qualified:     "Qualified",
  completed:     "Completed",
  not_interested:"Not Interested",
  do_not_call:   "Do Not Call",
};

const STATUS_COLOR: Record<string, string> = {
  need_to_call:  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  calling:       "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  interested:    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  not_connected: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  qualified:     "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  completed:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  not_interested:"bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  do_not_call:   "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const INTEREST_SCORE: Record<string, { label: string; cls: string; bar: string; pct: number }> = {
  high:   { label: "High",   cls: "text-green-700 dark:text-green-400",  bar: "bg-green-500",  pct: 90 },
  medium: { label: "Medium", cls: "text-amber-700 dark:text-amber-400",  bar: "bg-amber-500",  pct: 55 },
  low:    { label: "Low",    cls: "text-red-700 dark:text-red-400",      bar: "bg-red-500",    pct: 20 },
};

// ── Draggable card ────────────────────────────────────────────────────────────
function LeadCard({
  lead,
  overlay = false,
  onSelect,
  onMove,
}: {
  lead: PipelineLead;
  overlay?: boolean;
  onSelect?: (lead: PipelineLead) => void;
  onMove?: (lead: PipelineLead, stage: PipelineStage) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: lead.id, data: { lead } });

  // Distinguish a tap from a drag without overriding dnd-kit's listeners
  const hasMoved = useRef(false);
  const dndDown  = (listeners as any)?.onPointerDown as ((e: React.PointerEvent) => void) | undefined;
  const dndMove  = (listeners as any)?.onPointerMove as ((e: React.PointerEvent) => void) | undefined;
  const { onPointerDown: _d, onPointerMove: _m, ...restListeners } = (listeners ?? {}) as any;

  const style = overlay
    ? undefined
    : { transform: CSS.Translate.toString(transform) };

  const funding     = fmt$(lead.funding_amount);
  const revenue     = fmt$(lead.monthly_revenue);
  const lastContact = fmtDate(lead.last_contacted_at);
  const statusLabel = STATUS_LABEL[lead.status ?? ""] ?? lead.status ?? "";
  const statusCls   = STATUS_COLOR[lead.status ?? ""] ?? "";
  const score       = lead.interest_level ? INTEREST_SCORE[lead.interest_level] ?? null : null;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : restListeners)}
      onPointerDown={(e) => { hasMoved.current = false; if (!overlay) dndDown?.(e); }}
      onPointerMove={(e) => { hasMoved.current = true;  if (!overlay) dndMove?.(e); }}
      onClick={() => {
        if (!hasMoved.current && !overlay && onSelect) onSelect(lead);
      }}
      className={cn(
        "group relative rounded-md border bg-card px-2 py-2 shadow-sm cursor-pointer select-none",
        "transition-shadow hover:shadow-md hover:border-primary/30",
        isDragging && "opacity-40 shadow-none",
        overlay && "shadow-xl ring-2 ring-primary/30 rotate-1 cursor-grabbing",
      )}
    >
      {/* Header: avatar + name + score */}
      <div className="flex items-start gap-1.5">
        <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground shrink-0 mt-0.5">
          {initials(lead.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[11px] leading-tight text-foreground line-clamp-1">
            {lead.full_name ?? "Unknown"}
          </p>
          {lead.company_name && (
            <p className="text-[10px] text-muted-foreground truncate">{lead.company_name}</p>
          )}
        </div>
        {score && (
          <div className="shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
            <span className={cn("text-[9px] font-bold leading-none", score.cls)}>{score.label}</span>
            <div className="w-8 h-1 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full rounded-full", score.bar)} style={{ width: `${score.pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Funding */}
      {funding && (
        <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-foreground">
          <TrendingUp className="h-2.5 w-2.5 text-green-500 shrink-0" />
          {funding}
          <span className="text-muted-foreground font-normal">ask</span>
        </div>
      )}

      {/* Contact info */}
      <div className="mt-1 space-y-0.5">
        {lead.phone && (
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <Phone className="h-2 w-2 shrink-0" />
            <span className="truncate">{lead.phone}</span>
          </div>
        )}
        {lead.email && (
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <Mail className="h-2 w-2 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </div>
        )}
        {lead.state_name && (
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <MapPin className="h-2 w-2 shrink-0" />
            <span className="truncate">{lead.state_name}</span>
          </div>
        )}
      </div>

      {/* Footer: status + meta icons + stage arrows */}
      <div className="mt-1.5 flex items-center justify-between gap-1 flex-wrap">
        <span className={cn("inline-flex items-center text-[9px] font-medium px-1 py-0.5 rounded-full", statusCls)}>
          {statusLabel}
        </span>

        <div className="flex items-center gap-1 ml-auto shrink-0">
          {(lead.attempt_count ?? 0) > 0 && (
            <div className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
              <PhoneCall className="h-2.5 w-2.5" />
              {lead.attempt_count}
            </div>
          )}
          {lastContact && (
            <span className="text-[9px] text-muted-foreground">{lastContact}</span>
          )}
          {lead.hasNotes && (
            <StickyNote className="h-3.5 w-3.5 text-amber-500" title="Has notes" />
          )}
          {lead.hasBooking && (
            <CalendarCheck className="h-3.5 w-3.5 text-green-500" title="Appointment booked" />
          )}
          {onMove && !overlay && (() => {
            const idx = PIPELINE_STAGES.findIndex((s) => s.id === lead.effective_stage);
            const prev = PIPELINE_STAGES[idx - 1];
            const next = PIPELINE_STAGES[idx + 1];
            return (
              <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  title={prev ? `Move to ${prev.label}` : undefined}
                  disabled={!prev}
                  onClick={(e) => { e.stopPropagation(); if (prev) onMove(lead, prev.id); }}
                  className="h-3.5 w-3.5 flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-2.5 w-2.5" />
                </button>
                <button
                  title={next ? `Move to ${next.label}` : undefined}
                  disabled={!next}
                  onClick={(e) => { e.stopPropagation(); if (next) onMove(lead, next.id); }}
                  className="h-3.5 w-3.5 flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })()}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-md bg-primary/0 group-hover:bg-primary/20 transition-colors" />
    </div>
  );
}

// ── Droppable + sortable column ───────────────────────────────────────────────
function PipelineColumn({
  stage,
  leads,
  onSelectLead,
  onMoveLead,
  isDraggingColumn,
}: {
  stage: (typeof PIPELINE_STAGES)[number];
  leads: PipelineLead[];
  onSelectLead: (lead: PipelineLead) => void;
  onMoveLead: (lead: PipelineLead, stage: PipelineStage) => void;
  isDraggingColumn: boolean;
}) {
  // Droppable: receives cards
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: stage.id });

  // Sortable: allows this column to be reordered
  const {
    attributes,
    listeners,
    setNodeRef: setSortRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `col::${stage.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const totalFunding = leads.reduce((sum, l) => sum + (l.funding_amount ?? 0), 0);

  return (
    <div
      ref={setSortRef}
      style={style}
      className={cn(
        "flex flex-col w-44 shrink-0",
        isDragging && "opacity-40",
      )}
    >
      {/* Column header with drag handle */}
      <div className="mb-2 group/col">
        <div className="flex items-center gap-1 mb-1.5">
          <div className={cn("h-0.5 flex-1 rounded-full", stage.color)} />
          <button
            {...attributes}
            {...listeners}
            className="opacity-0 group-hover/col:opacity-60 hover:!opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-0.5 rounded"
            title="Drag to reorder column"
          >
            <GripVertical className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
        <h3 className="font-semibold text-xs text-foreground">{stage.label}</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {totalFunding > 0 ? `${fmt$(totalFunding)} · ` : ""}
          {leads.length} lead{leads.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Cards area */}
      <div
        ref={setDropRef}
        className={cn(
          "flex flex-col gap-1.5 min-h-20 rounded-md p-1.5 transition-colors",
          "bg-muted/40 border border-dashed border-transparent",
          isOver && !isDraggingColumn && "border-primary/40 bg-primary/5",
        )}
      >
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onSelect={onSelectLead}
            onMove={onMoveLead}
          />
        ))}

        {leads.length === 0 && (
          <div className="flex items-center justify-center h-16">
            <p className="text-[10px] text-muted-foreground/40">Drop here</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function PipelinePage() {
  const qc = useQueryClient();
  const fetchLeads  = useServerFn(getPipelineLeads);
  const updateStage = useServerFn(setLeadPipelineStage);

  const [activeId,      setActiveId]      = useState<string | null>(null);
  const [selectedLead,  setSelectedLead]  = useState<PipelineLead | null>(null);
  const [drawerOpen,    setDrawerOpen]    = useState(false);

  // Column order — persisted to localStorage so rearrangements survive refresh
  const [columnOrder, setColumnOrder] = useState<PipelineStage[]>(() => {
    if (typeof window === "undefined") return PIPELINE_STAGES.map((s) => s.id);
    try {
      const saved = localStorage.getItem("pipeline-column-order");
      if (saved) {
        const parsed: PipelineStage[] = JSON.parse(saved);
        const validIds = new Set(PIPELINE_STAGES.map((s) => s.id));
        const filtered = parsed.filter((id) => validIds.has(id));
        // Add any new stages not yet in saved order
        const missing = PIPELINE_STAGES.map((s) => s.id).filter((id) => !filtered.includes(id));
        return [...filtered, ...missing];
      }
    } catch {}
    return PIPELINE_STAGES.map((s) => s.id);
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const {
    data: leads = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["pipeline-leads"],
    queryFn: () => fetchLeads(),
    refetchOnWindowFocus: false,
  });

  const { mutate: moveCard } = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      updateStage({ data: { leadId, stage } }),
    onMutate: async ({ leadId, stage }) => {
      await qc.cancelQueries({ queryKey: ["pipeline-leads"] });
      const prev = qc.getQueryData<PipelineLead[]>(["pipeline-leads"]);
      qc.setQueryData<PipelineLead[]>(["pipeline-leads"], (old = []) =>
        old.map((l) =>
          l.id === leadId
            ? {
                ...l,
                pipeline_stage: stage as PipelineStage,
                effective_stage: stage as PipelineStage,
              }
            : l,
        ),
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["pipeline-leads"], ctx.prev);
      const msg = (err as Error)?.message ?? "";
      if (msg.includes("MIGRATION_NEEDED")) {
        toast.warning("Apply the pipeline migration to persist stage changes.", {
          description: "supabase/migrations/20260613160000_pipeline_stage.sql",
          duration: 8000,
        });
      } else {
        toast.error("Failed to move lead");
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
    },
  });

  const orderedStages = columnOrder
    .map((id) => PIPELINE_STAGES.find((s) => s.id === id))
    .filter(Boolean) as (typeof PIPELINE_STAGES)[number][];

  const grouped = orderedStages.reduce<Record<string, PipelineLead[]>>(
    (acc, s) => {
      acc[s.id] = leads.filter((l) => l.effective_stage === s.id);
      return acc;
    },
    {},
  );

  const isColDrag  = activeId?.startsWith("col::") ?? false;
  const activeLead = !isColDrag && activeId ? leads.find((l) => l.id === activeId) : null;
  const activeColStage = isColDrag
    ? PIPELINE_STAGES.find((s) => `col::${s.id}` === activeId) ?? null
    : null;

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over) return;

      const activeStr = String(active.id);
      const overStr   = String(over.id);

      // ── Column reorder ──────────────────────────────────────────────────────
      if (activeStr.startsWith("col::") && overStr.startsWith("col::")) {
        const fromId = activeStr.replace("col::", "") as PipelineStage;
        const toId   = overStr.replace("col::", "")   as PipelineStage;
        if (fromId === toId) return;
        setColumnOrder((prev) => {
          const next = arrayMove(prev, prev.indexOf(fromId), prev.indexOf(toId));
          try { localStorage.setItem("pipeline-column-order", JSON.stringify(next)); } catch {}
          return next;
        });
        return;
      }

      // ── Card move ───────────────────────────────────────────────────────────
      if (!activeStr.startsWith("col::")) {
        const targetStage = overStr as PipelineStage;
        const lead = leads.find((l) => l.id === activeStr);
        if (!lead || lead.effective_stage === targetStage) return;
        moveCard({ leadId: lead.id, stage: targetStage });
      }
    },
    [leads, moveCard],
  );

  const handleSelectLead = useCallback((lead: PipelineLead) => {
    setSelectedLead(lead);
    setDrawerOpen(true);
  }, []);

  const totalFunding = leads.reduce((s, l) => s + (l.funding_amount ?? 0), 0);

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Sales Pipeline
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {leads.length} lead{leads.length !== 1 ? "s" : ""}
              {totalFunding > 0 && ` · ${fmt$(totalFunding)} total ask`}
              {" · "}
              {PIPELINE_STAGES.length} stages
            </p>
          </div>

          <Link to="/leads">
            <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <ExternalLink className="h-3 w-3" />
              Manage Leads
            </button>
          </Link>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {(error as Error)?.message ?? "Failed to load leads"}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={columnOrder.map((id) => `col::${id}`)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex gap-3 p-4 h-full">
                {orderedStages.map((stage) => (
                  <PipelineColumn
                    key={stage.id}
                    stage={stage}
                    leads={grouped[stage.id] ?? []}
                    onSelectLead={handleSelectLead}
                    onMoveLead={(lead, s) => moveCard({ leadId: lead.id, stage: s })}
                    isDraggingColumn={isColDrag}
                  />
                ))}
              </div>
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeLead ? (
                <LeadCard lead={activeLead} overlay />
              ) : activeColStage ? (
                <div className="flex flex-col w-44 shrink-0 opacity-90 rotate-1">
                  <div className="mb-2">
                    <div className={cn("h-0.5 w-8 rounded-full mb-1.5", activeColStage.color)} />
                    <h3 className="font-semibold text-xs text-foreground">{activeColStage.label}</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {(grouped[activeColStage.id] ?? []).length} lead{(grouped[activeColStage.id] ?? []).length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 min-h-20 rounded-md p-1.5 bg-muted/60 border border-dashed border-primary/30 shadow-xl" />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Lead detail drawer */}
      <PipelineLeadDrawer
        lead={selectedLead}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </div>
  );
}
