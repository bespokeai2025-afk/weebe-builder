import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { BookUser, RefreshCw, Search, StickyNote, FolderOpen, Loader2 } from "lucide-react";
import { KpiCard } from "@/components/dashboard/PageShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listDataRecords } from "@/lib/dashboard/data-records.functions";
import { listContactDocsByPhone } from "@/lib/dashboard/documents.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import { ContactDocumentsPanel } from "@/components/contacts/ContactDocumentsPanel";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Contacts — Webee" }] }),
  component: ContactsPage,
});

function fmtAddress(r: any) {
  return (
    [r.address_line1, r.address_line2, r.city, r.postal_code]
      .filter(Boolean)
      .join(", ") || "—"
  );
}

type PanelTarget = {
  entityType: NotesEntityType;
  entityId: string;
  entityName: string;
  defaultPhone?: string;
  defaultEmail?: string;
  leadId?: string | null;
};

function ContactDocsDialog({
  contact,
  onClose,
}: {
  contact: { displayName: string; phone?: string } | null;
  onClose: () => void;
}) {
  const docsByPhoneFn = useServerFn(listContactDocsByPhone);

  const docsQ = useQuery({
    queryKey: ["contact-docs-phone", contact?.phone],
    queryFn: () => docsByPhoneFn({ data: { phone: contact!.phone! } }),
    enabled: !!contact?.phone,
    staleTime: 0,
  });

  const docsInfo = docsQ.data as
    | { docs: any[]; contactId: string | null; uploadToken: string | null }
    | undefined;

  return (
    <Dialog open={!!contact} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            Documents — {contact?.displayName}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Upload and manage documents for this contact.
          </DialogDescription>
        </DialogHeader>

        {docsQ.isLoading ? (
          <div className="flex items-center gap-2 py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : docsInfo?.contactId ? (
          <ContactDocumentsPanel
            contactId={docsInfo.contactId}
            contactName={contact?.displayName}
            uploadToken={docsInfo.uploadToken}
          />
        ) : (
          <p className="text-sm text-muted-foreground py-4">
            No WhatsApp contact found for {contact?.phone}. Add this number as a
            WhatsApp contact first to enable documents.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContactsPage() {
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [docsContact, setDocsContact] = useState<{
    displayName: string;
    phone?: string;
  } | null>(null);
  const listFn = useServerFn(listDataRecords);

  const { data: records = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => listFn({ data: { limit: 2000 } }),
    staleTime: 60_000,
  });

  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return (records as any[]).filter((r) => {
      const key = r.mobile_number?.trim()
        ? r.mobile_number.trim()
        : `__nophone__${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deduped;
    return deduped.filter(
      (r) =>
        r.name?.toLowerCase().includes(q) ||
        r.mobile_number?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.address_line1?.toLowerCase().includes(q) ||
        r.city?.toLowerCase().includes(q) ||
        r.first_name?.toLowerCase().includes(q) ||
        r.last_name?.toLowerCase().includes(q),
    );
  }, [deduped, search]);

  const total = deduped.length;
  const withAddress = deduped.filter((r: any) => r.address_line1).length;
  const withEmail = deduped.filter((r: any) => r.email).length;

  function openPanel(r: any) {
    const displayName =
      r.name ||
      [r.first_name, r.last_name].filter(Boolean).join(" ") ||
      r.mobile_number ||
      "Contact";
    setPanel({
      entityType: "contact",
      entityId: r.id,
      entityName: displayName,
      defaultPhone: r.mobile_number ?? undefined,
      defaultEmail: r.email ?? undefined,
    });
  }

  function openDocs(r: any) {
    const displayName =
      r.name ||
      [r.first_name, r.last_name].filter(Boolean).join(" ") ||
      r.mobile_number ||
      "Contact";
    setDocsContact({ displayName, phone: r.mobile_number ?? undefined });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      <h1 className="mb-4 text-xl font-semibold tracking-tight">All Contacts</h1>

      {/* KPI strip */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <KpiCard label="Total Contacts" value={total} icon={BookUser} />
        <KpiCard
          label="With Address"
          value={withAddress}
          icon={BookUser}
          iconBg="bg-blue-500/15"
          iconColor="text-blue-400"
        />
        <KpiCard
          label="With Email"
          value={withEmail}
          icon={BookUser}
          iconBg="bg-violet-500/15"
          iconColor="text-violet-400"
        />
      </div>

      {/* Table card */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06]">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, address…"
              className="h-7 pl-8 text-xs"
            />
          </div>
          <p className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {filtered.length.toLocaleString()} of {total.toLocaleString()}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading contacts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16">
            <BookUser className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {total === 0 ? "No contacts yet" : "No matches"}
            </p>
            <p className="text-xs text-muted-foreground">
              {total === 0
                ? "Upload a CSV from the Data section to add contacts."
                : "Try a different search term."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] bg-card/30">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Email</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Address</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Notes</th>
                  <th className="px-3 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any) => {
                  const displayName =
                    r.name ||
                    [r.first_name, r.last_name].filter(Boolean).join(" ") ||
                    "—";
                  return (
                    <tr
                      key={r.id}
                      className="h-9 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">{displayName}</td>
                      <td className="px-3 py-1.5 text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                        {r.mobile_number ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                        {r.email ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-muted-foreground max-w-[240px]">
                        <span className="line-clamp-1">{fmtAddress(r)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-muted-foreground max-w-[200px]">
                        {r.notes ? (
                          <span className="line-clamp-1">{r.notes}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => openPanel(r)}
                            title="Notes & appointment"
                            className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                          >
                            <StickyNote className="h-3 w-3" />
                            <span>Notes</span>
                          </button>
                          {r.mobile_number && (
                            <button
                              onClick={() => openDocs(r)}
                              title="Documents"
                              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 hover:border-blue-500/40 transition-colors"
                            >
                              <FolderOpen className="h-3 w-3" />
                              <span>Docs</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes & Booking sheet */}
      {panel && (
        <NotesBookingSheet
          open={!!panel}
          onOpenChange={(o) => { if (!o) setPanel(null); }}
          entityType={panel.entityType}
          entityId={panel.entityId}
          entityName={panel.entityName}
          defaultPhone={panel.defaultPhone}
          defaultEmail={panel.defaultEmail}
          leadId={panel.leadId}
        />
      )}

      {/* Documents dialog */}
      <ContactDocsDialog
        contact={docsContact}
        onClose={() => setDocsContact(null)}
      />
    </div>
  );
}
