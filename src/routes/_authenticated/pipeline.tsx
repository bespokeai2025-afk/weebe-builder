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
}: {
  lead: PipelineLead;
  overlay?: boolean;
  onSelect?: (lead: PipelineLead) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: lead.id, data: { lead } });

  // Distinguish a tap from a drag: track pointer movement
  const hasMoved = useRef(false);

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
      {...(overlay ? {} : listeners)}
      onPointerDown={() => { hasMoved.current = false; }}
      onPointerMove={() => { hasMoved.current = true; }}
      onClick={() => {
        if (!hasMoved.current && !overlay && onSelect) onSelect(lead);
      }}
      className={cn(
        "group relative rounded-lg border bg-card px-3 py-3 shadow-sm cursor-pointer select-none",
        "transition-shadow hover:shadow-md hover:border-primary/30",
        isDragging && "opacity-40 shadow-none",
        overlay && "shadow-xl ring-2 ring-primary/30 rotate-1 cursor-grabbing",
      )}
    >
      {/* Header: avatar + name + sentiment */}
      <div className="flex items-start gap-2">
        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-muted-foreground shrink-0 mt-0.5">
          {initials(lead.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight text-foreground line-clamp-1">
            {lead.full_name ?? "Unknown"}
          </p>
          {lead.company_name && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate flex items-center gap-1">
              <Building2 className="h-3 w-3 shrink-0" />
              {lead.company_name}
            </p>
          )}
        </div>
        {/* Interest level score badge */}
        {score && (
          <div className="shrink-0 flex flex-col items-end gap-0.5">
            <span className={cn("text-[10px] font-semibold", score.cls)}>{score.label}</span>
            <div className="w-10 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full rounded-full", score.bar)} style={{ width: `${score.pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Funding / Revenue */}
      {(funding || revenue) && (
        <div className="mt-2 flex items-center gap-2">
          {funding && (
            <div className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <TrendingUp className="h-3 w-3 text-green-500" />
              {funding}
              <span className="text-muted-foreground font-normal">ask</span>
            </div>
          )}
          {revenue && (
            <div className="text-xs text-muted-foreground">{revenue}/mo</div>
          )}
        </div>
      )}

      {/* Contact info */}
      <div className="mt-2 space-y-0.5">
        {lead.phone && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.phone}</span>
          </div>
        )}
        {lead.email && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </div>
        )}
        {lead.state_name && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{lead.state_name}</span>
          </div>
        )}
      </div>

      {/* Footer: status + attempts + last contact + indicators */}
      <div className="mt-2.5 flex items-center justify-between gap-1.5 flex-wrap">
        <span
          className={cn(
            "inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full",
            statusCls,
          )}
        >
          {statusLabel}
        </span>

        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {(lead.attempt_count ?? 0) > 0 && (
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <PhoneCall className="h-3 w-3" />
              {lead.attempt_count}
            </div>
          )}
          {lastContact && (
            <span className="text-[10px] text-muted-foreground">{lastContact}</span>
          )}
          {lead.hasNotes && (
            <StickyNote className="h-3 w-3 text-amber-500" title="Has notes" />
          )}
          {lead.hasBooking && (
            <CalendarCheck className="h-3 w-3 text-green-500" title="Appointment booked" />
          )}
        </div>
      </div>

      {/* Call outcome */}
      {lead.call_outcome && (
        <p className="mt-1.5 text-[10px] text-muted-foreground/70 line-clamp-1 italic">
          "{lead.call_outcome}"
        </p>
      )}

      {/* Click hint on hover */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 rounded-b-lg bg-primary/0 group-hover:bg-primary/20 transition-colors" />
    </div>
  );
}

// ── Droppable column ──────────────────────────────────────────────────────────
function PipelineColumn({
  stage,
  leads,
  activeId,
  onSelectLead,
}: {
  stage: (typeof PIPELINE_STAGES)[number];
  leads: PipelineLead[];
  activeId: string | null;
  onSelectLead: (lead: PipelineLead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  const totalFunding = leads.reduce((sum, l) => sum + (l.funding_amount ?? 0), 0);

  return (
    <div className="flex flex-col w-64 shrink-0">
      {/* Column header */}
      <div className="mb-3">
        <div className={cn("h-1 w-12 rounded-full mb-2", stage.color)} />
        <h3 className="font-semibold text-sm text-foreground">{stage.label}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {totalFunding > 0 ? `${fmt$(totalFunding)} · ` : ""}
          {leads.length} lead{leads.length !== 1 ? "s" : ""}
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
          <LeadCard
            key={lead.id}
            lead={lead}
            onSelect={onSelectLead}
          />
        ))}

        {leads.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <p className="text-xs text-muted-foreground/40">Drop here</p>
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
            <div className="flex gap-4 p-6 h-full">
              {PIPELINE_STAGES.map((stage) => (
                <PipelineColumn
                  key={stage.id}
                  stage={stage}
                  leads={grouped[stage.id] ?? []}
                  activeId={activeId}
                  onSelectLead={handleSelectLead}
                />
              ))}
            </div>

            <DragOverlay dropAnimation={null}>
              {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
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
