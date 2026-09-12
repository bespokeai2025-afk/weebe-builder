import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Loader2, Megaphone, Phone, User, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AssignLeadsDialog } from "@/components/leads/AssignLeadsDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BuzzchatEmptyState } from "@/components/whatsapp/buzzchat-ui";
import { LeadWhatsAppPanel } from "@/components/leads/LeadWhatsAppPanel";
import {
  listListingPipelineLeads,
  updateListingPipelineOffer,
  updateListingPipelineStage,
  type ListingPipelineLeadRow,
} from "@/lib/whatsapp/campaign-leads.functions";
import {
  LISTING_PIPELINE_STAGE_LABELS,
  LISTING_PIPELINE_STAGES,
  type ListingPipelineStage,
} from "@/lib/whatsapp/campaign-leads.shared";

const STAGE_TONE: Record<ListingPipelineStage, string> = {
  agreed: "bg-blue-500",
  details_docs: "bg-violet-500",
  listing_created: "bg-orange-500",
  live: "bg-sky-500",
  viewings_offers: "bg-amber-500",
  negotiation: "bg-yellow-500",
  sold_by_us: "bg-green-500",
  closed: "bg-muted-foreground",
};

// ── Draggable card ────────────────────────────────────────────────────────────
function PipelineCard({
  lead,
  overlay = false,
  onOpen,
}: {
  lead: ListingPipelineLeadRow;
  overlay?: boolean;
  onOpen?: (lead: ListingPipelineLeadRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });

  // Distinguish a click (open details) from a drag (move stage) the same way
  // the Sales Pipeline board does. Important: dnd-kit's PointerSensor relies
  // on its own onPointerDown/onPointerMove from `listeners` actually firing —
  // spreading `listeners` and then declaring onPointerDown/onPointerMove
  // afterwards REPLACES dnd-kit's handlers (JSX props declared later win),
  // which silently breaks dragging entirely. Pull those two out, chain them
  // with our own tracking, and spread only the remaining listeners.
  const moved = useRef(false);
  const dndPointerDown = (listeners as any)?.onPointerDown as
    | ((e: React.PointerEvent) => void)
    | undefined;
  const dndPointerMove = (listeners as any)?.onPointerMove as
    | ((e: React.PointerEvent) => void)
    | undefined;
  const { onPointerDown: _pd, onPointerMove: _pm, ...restListeners } = (listeners ?? {}) as any;

  const style = overlay ? undefined : { transform: CSS.Translate.toString(transform) };

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={style}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : restListeners)}
      onPointerDown={(e) => {
        moved.current = false;
        if (!overlay) dndPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        moved.current = true;
        if (!overlay) dndPointerMove?.(e);
      }}
      onClick={() => {
        if (!moved.current && !overlay) onOpen?.(lead);
      }}
      className={cn(
        "flex items-start gap-2 rounded-md border border-white/[0.06] bg-card/80 py-2 pl-2 pr-2.5 text-xs cursor-pointer select-none",
        "transition-shadow hover:shadow-sm hover:border-primary/30",
        isDragging && "opacity-40 shadow-none",
        overlay && "w-52 shadow-xl ring-2 ring-primary/30 rotate-1 cursor-grabbing",
      )}
    >
      <span className={cn("mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full", STAGE_TONE[lead.stage])} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0">
            <p className="truncate font-medium leading-tight text-foreground">{lead.full_name || "Unknown"}</p>
            {lead.phone && <p className="truncate text-[10px] leading-tight text-muted-foreground">{lead.phone}</p>}
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
              lead.daysInStage >= 7 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground",
            )}
            title="Days in this stage"
          >
            {lead.daysInStage}d
          </span>
        </div>

        <p className="truncate text-[10px] text-muted-foreground">{lead.property || "No property on file"}</p>

        {(lead.askingPrice || lead.offerAmount) && (
          <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
            {lead.askingPrice && <span>Ask {lead.askingPrice}</span>}
            {lead.offerAmount && <span>Offer {lead.offerAmount}</span>}
          </div>
        )}

        {lead.nextAction && (
          <p className="truncate text-[10px] text-amber-500">→ {lead.nextAction}</p>
        )}

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <User className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{lead.assigned_name || "Unassigned"}</span>
        </div>
      </div>
    </div>
  );
}

// ── Droppable column ──────────────────────────────────────────────────────────
function PipelineColumn({
  stage,
  leads,
  onOpen,
}: {
  stage: ListingPipelineStage;
  leads: ListingPipelineLeadRow[];
  onOpen: (lead: ListingPipelineLeadRow) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });

  return (
    <div className="flex h-full w-52 shrink-0 flex-col">
      <div className="flex items-center justify-between gap-1.5 rounded-t-md border-t-2 border-transparent bg-muted/40 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STAGE_TONE[stage])} />
          <Label className="truncate text-[11px] font-semibold">{LISTING_PIPELINE_STAGE_LABELS[stage]}</Label>
        </div>
        <span className="shrink-0 rounded-full bg-background/60 px-1.5 text-[10px] text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto rounded-b-md border border-t-0 border-dashed border-transparent p-1.5 transition-colors",
          "bg-muted/20",
          isOver && "border-primary/40 bg-primary/5",
        )}
      >
        {leads.length === 0 ? (
          <p className="py-3 text-center text-[10px] text-muted-foreground/60">Drop here</p>
        ) : (
          leads.map((lead) => <PipelineCard key={lead.id} lead={lead} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}

// ── Detail sheet ──────────────────────────────────────────────────────────────
function PipelineLeadSheet({
  lead,
  open,
  onOpenChange,
  onStageChange,
  onOfferSave,
  onAssign,
}: {
  lead: ListingPipelineLeadRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStageChange: (leadId: string, stage: ListingPipelineStage) => void;
  onOfferSave: (leadId: string, offer: string) => void;
  onAssign: (leadId: string) => void;
}) {
  const [offerDraft, setOfferDraft] = useState("");

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o && lead) setOfferDraft(lead.offerAmount);
      }}
    >
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-6">{lead?.full_name || lead?.phone || "Listing"}</SheetTitle>
        </SheetHeader>
        {lead && (
          <div className="mt-4 space-y-5">
            {lead.phone && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />
                {lead.phone}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {lead.property || "No property on file"}
              {lead.area ? ` · ${lead.area}` : ""}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Stage
                </p>
                <Select
                  value={lead.stage}
                  onValueChange={(v) => onStageChange(lead.id, v as ListingPipelineStage)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTING_PIPELINE_STAGES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {LISTING_PIPELINE_STAGE_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Days in stage
                </p>
                <p
                  className={cn(
                    "flex h-8 items-center text-xs font-medium",
                    lead.daysInStage >= 7 ? "text-destructive" : "text-foreground",
                  )}
                >
                  {lead.daysInStage} day{lead.daysInStage === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Asking price
                </p>
                <p className="flex h-8 items-center text-xs">{lead.askingPrice || "—"}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Offer
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. AED 1.2M"
                    value={offerDraft}
                    onChange={(e) => setOfferDraft(e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => onOfferSave(lead.id, offerDraft)}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Agent
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full justify-start gap-1.5 text-xs"
                  onClick={() => onAssign(lead.id)}
                >
                  <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                  {lead.assigned_name || "Assign agent"}
                </Button>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Next action
                </p>
                <p className="flex h-8 items-center truncate text-xs text-amber-500">
                  {lead.nextAction || "—"}
                </p>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <LeadWhatsAppPanel leadId={lead.id} phone={lead.phone} contactName={lead.full_name} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Listing Pipeline — second stage after a listing converts. Tracks what
 * happened to it: Agreed → Details/Docs → Listing Created → Live →
 * Viewings/Offers → Negotiation → Sold/Rent → Closed. Separate from the
 * BuzzChat working board (CampaignLeadsBoard), which stops once a lead
 * converts and hands off here.
 */
export function ListingPipelineBoard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listListingPipelineLeads);
  const stageFn = useServerFn(updateListingPipelineStage);
  const offerFn = useServerFn(updateListingPipelineOffer);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ListingPipelineLeadRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [assignId, setAssignId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["listing-pipeline"],
    queryFn: () => listFn(),
    staleTime: 15_000,
    throwOnError: false,
  });

  const leads = data?.leads ?? [];

  const saveStage = useMutation({
    mutationFn: (input: { leadId: string; stage: ListingPipelineStage }) => stageFn({ data: input }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["listing-pipeline"] });
      const prev = qc.getQueryData<{ leads: ListingPipelineLeadRow[] }>(["listing-pipeline"]);
      qc.setQueryData<{ leads: ListingPipelineLeadRow[] }>(["listing-pipeline"], (old) =>
        old
          ? {
              leads: old.leads.map((l) =>
                l.id === input.leadId ? { ...l, stage: input.stage, daysInStage: 0 } : l,
              ),
            }
          : old,
      );
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["listing-pipeline"], ctx.prev);
      toast.error(e.message);
    },
    onSuccess: (_data, input) => {
      setSelected((cur) => (cur?.id === input.leadId ? { ...cur, stage: input.stage } : cur));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["listing-pipeline"] });
    },
  });

  const saveOffer = useMutation({
    mutationFn: (input: { leadId: string; offerAmount: string }) => offerFn({ data: input }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["listing-pipeline"] });
      setSelected((cur) => (cur?.id === input.leadId ? { ...cur, offerAmount: input.offerAmount } : cur));
      toast.success("Offer saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleOpen = useCallback((lead: ListingPipelineLeadRow) => {
    setSelected(lead);
    setSheetOpen(true);
  }, []);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = e;
      if (!over) return;
      const targetStage = String(over.id) as ListingPipelineStage;
      const lead = leads.find((l) => l.id === String(active.id));
      if (!lead || lead.stage === targetStage) return;
      saveStage.mutate({ leadId: lead.id, stage: targetStage });
    },
    [leads, saveStage],
  );

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (leads.length === 0) {
    return (
      <BuzzchatEmptyState
        icon={Megaphone}
        title="No listings in the pipeline yet"
        description="Once a client agrees to list with you, mark the lead 'Converted' in BuzzChat — it lands here automatically."
      />
    );
  }

  const byStage = new Map<ListingPipelineStage, ListingPipelineLeadRow[]>(
    LISTING_PIPELINE_STAGES.map((s) => [s, []]),
  );
  for (const lead of leads) {
    byStage.get(lead.stage)?.push(lead);
  }
  const activeLead = activeId ? leads.find((l) => l.id === activeId) ?? null : null;

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-2">
          {LISTING_PIPELINE_STAGES.map((stage) => (
            <PipelineColumn key={stage} stage={stage} leads={byStage.get(stage) ?? []} onOpen={handleOpen} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeLead ? <PipelineCard lead={activeLead} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <PipelineLeadSheet
        lead={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onStageChange={(leadId, stage) => saveStage.mutate({ leadId, stage })}
        onOfferSave={(leadId, offerAmount) => saveOffer.mutate({ leadId, offerAmount })}
        onAssign={(leadId) => setAssignId(leadId)}
      />

      <AssignLeadsDialog
        open={assignId != null}
        onOpenChange={(open) => !open && setAssignId(null)}
        leadIds={assignId ? [assignId] : []}
        currentAssignee={leads.find((l) => l.id === assignId)?.assigned_to}
        onAssigned={() => {
          qc.invalidateQueries({ queryKey: ["listing-pipeline"] });
        }}
      />

      {(saveStage.isPending || saveOffer.isPending) && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs shadow-lg">
          <Loader2 className="h-3 w-3 animate-spin" />
          Saving…
        </div>
      )}
    </>
  );
}
