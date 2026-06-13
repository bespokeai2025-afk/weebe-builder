import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";
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
import { CSS } from "@dnd-kit/utilities";
import { User, Phone, Mail, Building2, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getPipelineLeads,
  setLeadPipelineStage,
  PIPELINE_STAGES,
  type PipelineLead,
  type PipelineStage,
} from "@/lib/pipeline/pipeline.functions";

export const Route = createFileRoute("/_authenticated/pipeline")({
  head: () => ({ meta: [{ title: "Sales Pipeline — Webee" }] }),
  component: PipelinePage,
});

// ── Interest level badge ──────────────────────────────────────────────────────
const INTEREST_COLORS: Record<string, string> = {
  high:   "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  low:    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

// ── Draggable card ────────────────────────────────────────────────────────────
function LeadCard({ lead, overlay = false }: { lead: PipelineLead; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });

  const style = overlay
    ? undefined
    : { transform: CSS.Translate.toString(transform) };

  const initials = (lead.full_name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      className={cn(
        "group relative rounded-lg border bg-card px-3 py-3 shadow-sm cursor-grab active:cursor-grabbing select-none",
        "transition-shadow hover:shadow-md",
        isDragging && "opacity-40 shadow-none",
        overlay && "shadow-xl ring-2 ring-primary/30 rotate-1 cursor-grabbing",
      )}
    >
      {/* Name */}
      <p className="font-semibold text-sm leading-tight text-foreground line-clamp-2">
        {lead.full_name ?? "Unknown"}
      </p>

      {/* Company */}
      {lead.company_name && (
        <p className="mt-0.5 text-xs text-muted-foreground truncate flex items-center gap-1">
          <Building2 className="h-3 w-3 shrink-0" />
          {lead.company_name}
        </p>
      )}

      {/* Amount placeholder */}
      <p className="mt-1 text-xs text-muted-foreground font-medium">$0</p>

      {/* Footer row */}
      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Avatar */}
        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0">
          {initials}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {lead.interest_level && (
            <span
              className={cn(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                INTEREST_COLORS[lead.interest_level] ?? INTEREST_COLORS.low,
              )}
            >
              {lead.interest_level}
            </span>
          )}
          {lead.phone && (
            <Phone className="h-3 w-3 text-muted-foreground/60" />
          )}
        </div>
      </div>

      {/* Link overlay (non-dragging state) */}
      <Link
        to="/leads"
        search={{ leadId: lead.id } as any}
        className="absolute inset-0 rounded-lg opacity-0"
        aria-label={`View ${lead.full_name}`}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ── Droppable column ──────────────────────────────────────────────────────────
function PipelineColumn({
  stage,
  leads,
  activeId,
}: {
  stage: (typeof PIPELINE_STAGES)[number];
  leads: PipelineLead[];
  activeId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex flex-col w-64 shrink-0">
      {/* Column header */}
      <div className="mb-3">
        <div className={cn("h-1 w-12 rounded-full mb-2", stage.color)} />
        <h3 className="font-semibold text-sm text-foreground">{stage.label}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          $0 · {leads.length} deal{leads.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Cards area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-2 min-h-32 rounded-lg p-2 transition-colors",
          "bg-muted/40 border border-dashed border-transparent",
          isOver && "border-primary/40 bg-primary/5",
        )}
      >
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} />
        ))}

        {leads.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 text-center">
            <p className="text-xs text-muted-foreground/50">Drop here</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function PipelinePage() {
  const qc = useQueryClient();
  const fetchLeads = useServerFn(getPipelineLeads);
  const updateStage  = useServerFn(setLeadPipelineStage);

  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const { data: leads = [], isLoading, isError, error } = useQuery({
    queryKey: ["pipeline-leads"],
    queryFn: () => fetchLeads(),
    refetchOnWindowFocus: false,
  });

  // Optimistic + server update on drag-end
  const { mutate: moveCard } = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      updateStage({ data: { leadId, stage } }),
    onMutate: async ({ leadId, stage }) => {
      await qc.cancelQueries({ queryKey: ["pipeline-leads"] });
      const prev = qc.getQueryData<PipelineLead[]>(["pipeline-leads"]);
      qc.setQueryData<PipelineLead[]>(["pipeline-leads"], (old = []) =>
        old.map((l) =>
          l.id === leadId
            ? { ...l, pipeline_stage: stage as PipelineStage, effective_stage: stage as PipelineStage }
            : l,
        ),
      );
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["pipeline-leads"], ctx.prev);
      const msg = (err as Error)?.message ?? "";
      if (msg.includes("MIGRATION_NEEDED")) {
        toast.warning("Apply the pipeline migration in Supabase Dashboard to persist stage changes.", {
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

  // Group leads by effective stage
  const grouped = PIPELINE_STAGES.reduce<Record<string, PipelineLead[]>>(
    (acc, s) => {
      acc[s.id] = leads.filter((l) => l.effective_stage === s.id);
      return acc;
    },
    {},
  );

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over) return;
      const targetStage = String(over.id) as PipelineStage;
      const lead = leads.find((l) => l.id === String(active.id));
      if (!lead || lead.effective_stage === targetStage) return;
      moveCard({ leadId: lead.id, stage: targetStage });
    },
    [leads, moveCard],
  );

  const totalLeads = leads.length;
  const stageCount = PIPELINE_STAGES.length;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-6 py-4 border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Sales Pipeline</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {totalLeads} lead{totalLeads !== 1 ? "s" : ""} across {stageCount} stages
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/leads">
              <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                <ExternalLink className="h-3 w-3" />
                Manage Leads
              </button>
            </Link>
          </div>
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
            <p className="text-sm text-muted-foreground">
              {(error as Error)?.message?.includes("column")
                ? 'Run the pipeline migration in Supabase Dashboard first: supabase/migrations/20260613160000_pipeline_stage.sql'
                : (error as Error)?.message ?? "Failed to load leads"}
            </p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 p-6 h-full">
              {PIPELINE_STAGES.map((stage) => (
                <PipelineColumn
                  key={stage.id}
                  stage={stage}
                  leads={grouped[stage.id] ?? []}
                  activeId={activeId}
                />
              ))}
            </div>

            <DragOverlay dropAnimation={null}>
              {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
