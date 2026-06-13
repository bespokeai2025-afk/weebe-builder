import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  addEntityNote,
  listEntityNotes,
  deleteEntityNote,
  createManualBooking,
} from "@/lib/dashboard/notes.functions";
import {
  getLeadDetail,
  setLeadPipelineStage,
  setSaleDoneAmount,
  PIPELINE_STAGES,
  type PipelineLead,
  type PipelineStage,
} from "@/lib/pipeline/pipeline.functions";
import {
  Phone,
  Mail,
  Building2,
  Loader2,
  Trash2,
  Plus,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  FileText,
  CalendarCheck,
  ExternalLink,
  MapPin,
  DollarSign,
  Pencil,
  Check,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listContactDocsByPhone } from "@/lib/dashboard/documents.functions";
import { ContactDocumentsPanel } from "@/components/contacts/ContactDocumentsPanel";

// ── helpers ───────────────────────────────────────────────────────────────────
function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtDatetime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmtDuration(start: string, end: string) {
  const mins = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 60_000,
  );
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const SENTIMENT_MAP = {
  positive: { label: "Positive", cls: "text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30" },
  neutral:  { label: "Neutral",  cls: "text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30" },
  negative: { label: "Negative", cls: "text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30" },
} as const;

const INTEREST_SCORE: Record<string, { label: string; bar: string; pct: number; cls: string }> = {
  high:   { label: "High",   bar: "bg-green-500", pct: 90, cls: "text-green-700 dark:text-green-400" },
  medium: { label: "Medium", bar: "bg-amber-500",  pct: 55, cls: "text-amber-700 dark:text-amber-400" },
  low:    { label: "Low",    bar: "bg-red-500",    pct: 20, cls: "text-red-700 dark:text-red-400" },
};

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

const DURATION_OPTIONS = [
  { value: "15",  label: "15 min" },
  { value: "30",  label: "30 min" },
  { value: "45",  label: "45 min" },
  { value: "60",  label: "1 hour" },
  { value: "90",  label: "1.5 hours" },
  { value: "120", label: "2 hours" },
];

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  lead: PipelineLead | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaleAmountSaved?: () => void;
}

export function PipelineLeadDrawer({ lead, open, onOpenChange, onSaleAmountSaved }: Props) {
  const qc = useQueryClient();
  const detailFn    = useServerFn(getLeadDetail);
  const addFn       = useServerFn(addEntityNote);
  const deleteFn    = useServerFn(deleteEntityNote);
  const listFn      = useServerFn(listEntityNotes);
  const bookFn      = useServerFn(createManualBooking);
  const moveFn      = useServerFn(setLeadPipelineStage);
  const saleAmtFn   = useServerFn(setSaleDoneAmount);

  // ── notes state ────────────────────────────────────────────────────────────
  const [noteText,   setNoteText]   = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── stage state ────────────────────────────────────────────────────────────
  const [movingStage, setMovingStage] = useState(false);

  // ── sale amount state ───────────────────────────────────────────────────────
  const [saleAmtEditing, setSaleAmtEditing] = useState(false);
  const [saleAmtInput,   setSaleAmtInput]   = useState("");
  const [savingSaleAmt,  setSavingSaleAmt]  = useState(false);

  // ── booking form state ─────────────────────────────────────────────────────
  const [bookOpen,   setBookOpen]   = useState(false);
  const [bTitle,     setBTitle]     = useState("");
  const [bDate,      setBDate]      = useState("");
  const [bDuration,  setBDuration]  = useState("30");
  const [bName,      setBName]      = useState("");
  const [bPhone,     setBPhone]     = useState("");
  const [bEmail,     setBEmail]     = useState("");
  const [bNotes,     setBNotes]     = useState("");
  const [booking,    setBooking]    = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const docsByPhoneFn = useServerFn(listContactDocsByPhone);

  // ── documents state ────────────────────────────────────────────────────────
  const [docsOpen, setDocsOpen] = useState(false);

  // Reset form when lead changes
  useEffect(() => {
    if (!lead || !open) return;
    setNoteText("");
    setBookOpen(false);
    setBName(lead.full_name ?? "");
    setBPhone(lead.phone ?? "");
    setBEmail(lead.email ?? "");
    setBTitle(`Meeting with ${lead.full_name ?? "Lead"}`);
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    setBDate(now.toISOString().slice(0, 16));
    setBNotes("");
  }, [lead?.id, open]);

  // ── data queries ───────────────────────────────────────────────────────────
  const detailQ = useQuery({
    queryKey: ["pipeline-lead-detail", lead?.id],
    queryFn: () =>
      detailFn({ data: { leadId: lead!.id, phone: lead!.phone } }),
    enabled: open && !!lead,
    staleTime: 30_000,
  });

  const notesQ = useQuery({
    queryKey: ["entity-notes", "lead", lead?.id],
    queryFn: () =>
      listFn({ data: { entityType: "lead", entityId: lead!.id } }),
    enabled: open && !!lead,
    staleTime: 0,
  });

  const docsQ = useQuery({
    queryKey: ["contact-docs-phone", lead?.phone],
    queryFn:  () => docsByPhoneFn({ data: { phone: lead!.phone! } }),
    enabled:  open && !!lead?.phone,
    staleTime: 0,
  });

  const detail  = detailQ.data ?? null;
  const notes   = (notesQ.data ?? []) as { id: string; body: string; created_at: string }[];
  const docsInfo = docsQ.data as { docs: any[]; contactId: string | null; uploadToken: string | null } | undefined;

  // ── handlers ───────────────────────────────────────────────────────────────
  async function handleAddNote() {
    if (!lead || !noteText.trim()) return;
    setAddingNote(true);
    try {
      await addFn({ data: { entityType: "lead", entityId: lead.id, body: noteText.trim() } });
      setNoteText("");
      qc.invalidateQueries({ queryKey: ["entity-notes", "lead", lead.id] });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
    } catch (e) {
      toast.error("Failed to save note", { description: (e as Error).message });
    } finally {
      setAddingNote(false);
    }
  }

  async function handleDeleteNote(id: string) {
    if (!lead) return;
    setDeletingId(id);
    try {
      await deleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["entity-notes", "lead", lead.id] });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
    } catch (e) {
      toast.error("Failed to delete note", { description: (e as Error).message });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleMoveStage(stage: PipelineStage) {
    if (!lead || movingStage) return;
    setMovingStage(true);
    try {
      await moveFn({ data: { leadId: lead.id, stage } });
      toast.success(`Moved to ${PIPELINE_STAGES.find((s) => s.id === stage)?.label ?? stage}`);
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
      if (stage === "sale_done") {
        setSaleAmtEditing(true);
        setSaleAmtInput(lead.sale_amount != null ? String(lead.sale_amount) : "");
      }
    } catch (e) {
      toast.error("Failed to move lead", { description: (e as Error).message });
    } finally {
      setMovingStage(false);
    }
  }

  async function handleSaveSaleAmount() {
    if (!lead) return;
    const amount = parseFloat(saleAmtInput.replace(/[^0-9.]/g, ""));
    if (isNaN(amount) || amount < 0) return;
    setSavingSaleAmt(true);
    try {
      await saleAmtFn({ data: { leadId: lead.id, amount } });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
      onSaleAmountSaved?.();
      toast.success(`Sale amount saved — $${amount.toLocaleString()}`);
      setSaleAmtEditing(false);
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (msg.includes("MIGRATION_NEEDED")) {
        toast.warning("Apply the sale_amount migration to save amounts.", {
          description: "supabase/migrations/20260613180000_sale_amount.sql",
          duration: 8000,
        });
        setSaleAmtEditing(false);
      } else {
        toast.error("Failed to save amount", { description: msg });
      }
    } finally {
      setSavingSaleAmt(false);
    }
  }

  async function handleBook() {
    if (!lead || !bTitle.trim() || !bDate) {
      toast.error("Title and date are required");
      return;
    }
    setBooking(true);
    try {
      const startAt = new Date(bDate).toISOString();
      const endAt = new Date(
        new Date(bDate).getTime() + parseInt(bDuration) * 60_000,
      ).toISOString();
      await bookFn({
        data: {
          title: bTitle.trim(),
          attendeeName: bName || null,
          attendeePhone: bPhone || null,
          attendeeEmail: bEmail || null,
          startAt,
          endAt,
          notes: bNotes || null,
          leadId: lead.id,
        },
      });
      toast.success("Appointment booked", {
        description: `${bTitle} on ${new Date(bDate).toLocaleString()}`,
      });
      qc.invalidateQueries({ queryKey: ["pipeline-lead-detail", lead.id] });
      setBookOpen(false);
    } catch (e) {
      toast.error("Failed to book", { description: (e as Error).message });
    } finally {
      setBooking(false);
    }
  }

  if (!lead) return null;

  const sentiment = lead.sentiment ? SENTIMENT_MAP[lead.sentiment] : null;
  const existingBooking = detail?.booking ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] flex flex-col gap-0 p-0 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-start gap-3">
            {/* Avatar */}
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0">
              {(lead.full_name ?? "?")
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase()}
            </div>

            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-semibold leading-tight line-clamp-1">
                {lead.full_name ?? "Unknown Lead"}
              </SheetTitle>

              {lead.company_name && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                  <Building2 className="h-3 w-3 shrink-0" />
                  {lead.company_name}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Phone className="h-3 w-3" />
                    {lead.phone}
                  </a>
                )}
                {lead.email && (
                  <a
                    href={`mailto:${lead.email}`}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors truncate max-w-[180px]"
                  >
                    <Mail className="h-3 w-3 shrink-0" />
                    {lead.email}
                  </a>
                )}
                {lead.state_name && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {lead.state_name}
                  </span>
                )}
              </div>
            </div>

            {/* Sentiment + interest level */}
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              {sentiment && (
                <span
                  className={cn(
                    "inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full",
                    sentiment.cls,
                  )}
                >
                  {sentiment.label}
                </span>
              )}
              {lead.interest_level && INTEREST_SCORE[lead.interest_level] && (
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-[11px] font-semibold", INTEREST_SCORE[lead.interest_level].cls)}>
                    {INTEREST_SCORE[lead.interest_level].label} interest
                  </span>
                  <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", INTEREST_SCORE[lead.interest_level].bar)}
                      style={{ width: `${INTEREST_SCORE[lead.interest_level].pct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stage selector */}
          <div className="mt-3">
            <Select
              value={lead.effective_stage}
              onValueChange={(v) => handleMoveStage(v as PipelineStage)}
              disabled={movingStage}
            >
              <SelectTrigger className="h-7 text-xs w-full">
                <SelectValue placeholder="Move to stage…" />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full shrink-0", s.color)} />
                      {s.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SheetHeader>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

          {/* ── Sale Amount (Sale Done leads only) ────────────────────────── */}
          {lead.effective_stage === "sale_done" && (
            <>
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <SectionLabel>Sale Amount</SectionLabel>
                  {!saleAmtEditing && (
                    <button
                      onClick={() => {
                        setSaleAmtEditing(true);
                        setSaleAmtInput(lead.sale_amount != null ? String(lead.sale_amount) : "");
                      }}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      {lead.sale_amount != null ? "Edit" : "Add amount"}
                    </button>
                  )}
                </div>

                {!saleAmtEditing ? (
                  lead.sale_amount != null ? (
                    <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                        <DollarSign className="h-4 w-4 text-green-500" />
                      </div>
                      <div>
                        <p className="text-lg font-bold text-green-600 dark:text-green-400">
                          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(lead.sale_amount)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">Total sale value</p>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setSaleAmtEditing(true); setSaleAmtInput(""); }}
                      className="w-full rounded-lg border border-dashed border-green-500/30 bg-green-500/5 px-4 py-3 flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400 hover:border-green-500/60 transition-colors"
                    >
                      <DollarSign className="h-4 w-4" />
                      Add sale amount
                    </button>
                  )
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        className="pl-7 h-9"
                        placeholder="0"
                        type="number"
                        min={0}
                        step={1}
                        value={saleAmtInput}
                        onChange={(e) => setSaleAmtInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveSaleAmount();
                          if (e.key === "Escape") setSaleAmtEditing(false);
                        }}
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
                        onClick={handleSaveSaleAmount}
                        disabled={savingSaleAmt || !saleAmtInput}
                      >
                        {savingSaleAmt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => setSaleAmtEditing(false)}
                        disabled={savingSaleAmt}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              <Separator className="bg-white/[0.06]" />
            </>
          )}

          {/* ── Call Summary ───────────────────────────────────────────────── */}
          <section className="space-y-2">
            <SectionLabel>Call Summary</SectionLabel>
            {detailQ.isLoading ? (
              <div className="flex items-center gap-2 py-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading…</span>
              </div>
            ) : detail?.callSummary ? (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="flex items-start gap-2">
                  <FileText className="h-3.5 w-3.5 text-primary/60 shrink-0 mt-0.5" />
                  <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {detail.callSummary}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/60 py-2">
                No call summary yet — summary appears after the first AI call.
              </p>
            )}
          </section>

          <Separator className="bg-white/[0.06]" />

          {/* ── Notes ─────────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionLabel>Notes {notes.length > 0 && `(${notes.length})`}</SectionLabel>

            {/* Add note */}
            <div className="space-y-2">
              <textarea
                ref={textareaRef}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddNote();
                }}
                placeholder="Write a note… (⌘↵ to save)"
                rows={3}
                className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 leading-relaxed"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={handleAddNote}
                  disabled={!noteText.trim() || addingNote}
                >
                  {addingNote ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3" />
                  )}
                  Add Note
                </Button>
              </div>
            </div>

            {/* Notes list */}
            {notesQ.isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : notes.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 text-center py-2">
                No notes yet.
              </p>
            ) : (
              <div className="space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="group relative rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                        {relTime(note.created_at)}
                      </span>
                      <button
                        onClick={() => handleDeleteNote(note.id)}
                        disabled={deletingId === note.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-destructive p-0.5 rounded"
                      >
                        {deletingId === note.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                      {note.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Separator className="bg-white/[0.06]" />

          {/* ── Documents ─────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setDocsOpen((v) => !v)}
              className="flex items-center justify-between w-full group"
            >
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
                <FolderOpen className="h-3.5 w-3.5 text-primary/70" />
                Documents
                {docsInfo && docsInfo.docs.length > 0 && (
                  <span className="ml-1 text-primary font-bold">({docsInfo.docs.length})</span>
                )}
              </span>
              {docsOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>

            {docsOpen && (
              docsQ.isLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading…</span>
                </div>
              ) : docsInfo?.contactId ? (
                <ContactDocumentsPanel
                  contactId={docsInfo.contactId}
                  contactName={lead?.full_name}
                  uploadToken={docsInfo.uploadToken}
                />
              ) : (
                <p className="text-xs text-muted-foreground/60 py-2">
                  No WhatsApp contact found for {lead?.phone} — add this number as a contact first to enable documents.
                </p>
              )
            )}
          </section>

          <Separator className="bg-white/[0.06]" />

          {/* ── Calendar Appointment ───────────────────────────────────────── */}
          <section className="space-y-3">
            <SectionLabel>Calendar Appointment</SectionLabel>

            {detailQ.isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading…</span>
              </div>
            ) : existingBooking ? (
              /* ── Existing booking ── */
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-green-500 shrink-0" />
                  <p className="text-sm font-semibold text-foreground line-clamp-1">
                    {existingBooking.title}
                  </p>
                  <span
                    className={cn(
                      "ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize",
                      existingBooking.status === "cancelled"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                    )}
                  >
                    {existingBooking.status}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground">
                  {fmtDatetime(existingBooking.start_at)}
                  {" · "}
                  {fmtDuration(existingBooking.start_at, existingBooking.end_at)}
                </p>

                {existingBooking.attendee_name && (
                  <p className="text-xs text-muted-foreground">
                    Attendee: {existingBooking.attendee_name}
                    {existingBooking.attendee_phone
                      ? ` · ${existingBooking.attendee_phone}`
                      : ""}
                  </p>
                )}

                {existingBooking.notes && (
                  <p className="text-xs text-muted-foreground/80 italic line-clamp-2">
                    {existingBooking.notes}
                  </p>
                )}

                {existingBooking.meeting_url && (
                  <a
                    href={existingBooking.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Join meeting
                  </a>
                )}

                {/* Option to book another */}
                <button
                  onClick={() => setBookOpen((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  + Book another appointment
                </button>
              </div>
            ) : (
              /* ── No booking yet ── */
              <p className="text-xs text-muted-foreground/60">
                No appointment booked yet.
              </p>
            )}

            {/* Book appointment collapsible */}
            {!existingBooking && (
              <button
                type="button"
                onClick={() => setBookOpen((v) => !v)}
                className="flex items-center justify-between w-full group"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground group-hover:text-foreground transition-colors">
                  <CalendarPlus className="h-3.5 w-3.5 text-primary/70" />
                  Book Appointment
                </span>
                {bookOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            )}

            {bookOpen && (
              <div className="space-y-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Title</Label>
                  <Input
                    value={bTitle}
                    onChange={(e) => setBTitle(e.target.value)}
                    placeholder="e.g. Discovery call"
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Date &amp; Time</Label>
                    <Input
                      type="datetime-local"
                      value={bDate}
                      onChange={(e) => setBDate(e.target.value)}
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Duration</Label>
                    <Select value={bDuration} onValueChange={setBDuration}>
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATION_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="text-[11px] text-muted-foreground">Attendee Name</Label>
                  <Input
                    value={bName}
                    onChange={(e) => setBName(e.target.value)}
                    placeholder="Full name"
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Phone</Label>
                    <Input
                      value={bPhone}
                      onChange={(e) => setBPhone(e.target.value)}
                      placeholder="+1 555 000 0000"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Email</Label>
                    <Input
                      type="email"
                      value={bEmail}
                      onChange={(e) => setBEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-[11px] text-muted-foreground">Notes / Reason</Label>
                  <textarea
                    value={bNotes}
                    onChange={(e) => setBNotes(e.target.value)}
                    placeholder="Reason for the appointment…"
                    rows={2}
                    className="mt-1 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 leading-relaxed"
                  />
                </div>

                <Button
                  className="w-full gap-2"
                  size="sm"
                  onClick={handleBook}
                  disabled={!bTitle.trim() || !bDate || booking}
                >
                  {booking ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CalendarPlus className="h-3.5 w-3.5" />
                  )}
                  Book Appointment
                </Button>
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
