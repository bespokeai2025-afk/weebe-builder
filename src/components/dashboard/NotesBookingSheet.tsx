import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  StickyNote,
  Trash2,
  Plus,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";

export type NotesEntityType = "lead" | "contact" | "call";

export interface NotesBookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: NotesEntityType;
  entityId: string;
  entityName: string;
  defaultPhone?: string | null;
  defaultEmail?: string | null;
  leadId?: string | null;
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const DURATION_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
];

export function NotesBookingSheet({
  open,
  onOpenChange,
  entityType,
  entityId,
  entityName,
  defaultPhone,
  defaultEmail,
  leadId,
}: NotesBookingSheetProps) {
  const qc = useQueryClient();
  const addFn    = useServerFn(addEntityNote);
  const deleteFn = useServerFn(deleteEntityNote);
  const bookFn   = useServerFn(createManualBooking);
  const listFn   = useServerFn(listEntityNotes);

  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);

  const [bTitle, setBTitle] = useState("");
  const [bDate, setBDate] = useState("");
  const [bDuration, setBDuration] = useState("30");
  const [bName, setBName] = useState("");
  const [bPhone, setBPhone] = useState("");
  const [bEmail, setBEmail] = useState("");
  const [bNotes, setBNotes] = useState("");
  const [booking, setBooking] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const notesQ = useQuery({
    queryKey: ["entity-notes", entityType, entityId],
    queryFn: () => listFn({ data: { entityType, entityId } }),
    enabled: open,
    staleTime: 0,
  });

  useEffect(() => {
    if (open) {
      setBName(entityName);
      setBPhone(defaultPhone ?? "");
      setBEmail(defaultEmail ?? "");
      setBTitle(`Meeting with ${entityName}`);
      const now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      setBDate(now.toISOString().slice(0, 16));
      setNoteText("");
      setBookingOpen(false);
    }
  }, [open, entityName, defaultPhone, defaultEmail]);

  const notes = (notesQ.data ?? []) as { id: string; body: string; created_at: string }[];
  const noteQueryKey = ["entity-notes", entityType, entityId];

  async function handleAddNote() {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    setAddingNote(true);
    try {
      await addFn({ data: { entityType, entityId, body: trimmed } });
      setNoteText("");
      qc.invalidateQueries({ queryKey: noteQueryKey });
    } catch (e) {
      toast.error("Failed to save note", { description: (e as Error).message });
    } finally {
      setAddingNote(false);
    }
  }

  async function handleDeleteNote(id: string) {
    setDeletingId(id);
    try {
      await deleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: noteQueryKey });
    } catch (e) {
      toast.error("Failed to delete note", { description: (e as Error).message });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleBookAppointment() {
    if (!bTitle.trim() || !bDate) {
      toast.error("Title and date are required");
      return;
    }
    setBooking(true);
    try {
      const startAt = new Date(bDate).toISOString();
      const endAt = new Date(new Date(bDate).getTime() + parseInt(bDuration) * 60_000).toISOString();
      await bookFn({
        data: {
          title: bTitle.trim(),
          attendeeName: bName || null,
          attendeePhone: bPhone || null,
          attendeeEmail: bEmail || null,
          startAt,
          endAt,
          notes: bNotes || null,
          leadId: leadId ?? null,
        },
      });
      toast.success("Appointment booked", {
        description: `${bTitle} on ${new Date(bDate).toLocaleString()}`,
      });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["calendar-bookings"] });
      setBookingOpen(false);
      setBTitle(`Meeting with ${entityName}`);
      setBNotes("");
    } catch (e) {
      toast.error("Failed to book appointment", { description: (e as Error).message });
    } finally {
      setBooking(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[460px] sm:max-w-[460px] flex flex-col gap-0 p-0 overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <StickyNote className="h-4 w-4 text-amber-400 flex-shrink-0" />
            <span className="truncate">{entityName}</span>
          </SheetTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">{entityType} notes &amp; appointments</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* ── Add Note ───────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Add Note
            </Label>
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

          {/* ── Notes List ─────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Notes {notes.length > 0 && <span className="normal-case font-normal tracking-normal">({notes.length})</span>}
            </Label>
            {notesQ.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : notes.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60 py-3 text-center">
                No notes yet — add one above.
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
          </div>

          <Separator className="bg-white/[0.06]" />

          {/* ── Book Appointment ───────────────────────────── */}
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setBookingOpen((v) => !v)}
              className="flex items-center justify-between w-full group"
            >
              <Label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground cursor-pointer group-hover:text-foreground transition-colors flex items-center gap-1.5">
                <CalendarPlus className="h-3.5 w-3.5 text-primary/70" />
                Book Appointment
              </Label>
              {bookingOpen ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>

            {bookingOpen && (
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
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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
                    placeholder="Appointment reason or notes…"
                    rows={2}
                    className="mt-1 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 leading-relaxed"
                  />
                </div>

                <Button
                  className="w-full gap-2"
                  size="sm"
                  onClick={handleBookAppointment}
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
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
