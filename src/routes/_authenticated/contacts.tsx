import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  BookUser, RefreshCw, Search, StickyNote, FolderOpen, Loader2,
  Building2, PlayCircle, ChevronRight, X, Phone,
} from "lucide-react";
import { KpiCard } from "@/components/dashboard/PageShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { listDataRecords } from "@/lib/dashboard/data-records.functions";
import {
  listContactDocuments,
  getContactUploadToken,
} from "@/lib/dashboard/documents.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import { ContactDocumentsPanel } from "@/components/contacts/ContactDocumentsPanel";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";
import { getWbahLeads } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { cn } from "@/lib/utils";
import { createClient } from "@supabase/supabase-js";

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
};

type DocsTarget = {
  contactId: string;
  contactName: string;
};

function ContactDocsDialog({
  target,
  onClose,
}: {
  target: DocsTarget | null;
  onClose: () => void;
}) {
  const listFn     = useServerFn(listContactDocuments);
  const getTokenFn = useServerFn(getContactUploadToken);

  const docsQ = useQuery({
    queryKey: ["contact-docs", target?.contactId],
    queryFn: () => listFn({ data: { contactId: target!.contactId } }),
    enabled: !!target,
    staleTime: 0,
  });

  const tokenQ = useQuery({
    queryKey: ["contact-upload-token", target?.contactId],
    queryFn: () => getTokenFn({ data: { contactId: target!.contactId } }),
    enabled: !!target,
    staleTime: Infinity,
    retry: 1,
  });

  const uploadToken = (tokenQ.data as any)?.uploadToken ?? null;

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-blue-400" />
            Documents — {target?.contactName}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Upload and manage documents for this contact.
          </DialogDescription>
        </DialogHeader>
        {docsQ.isLoading || tokenQ.isLoading ? (
          <div className="flex items-center gap-2 py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : target ? (
          <ContactDocumentsPanel
            contactId={target.contactId}
            contactName={target.contactName}
            uploadToken={uploadToken}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ── WeeBespoke Leads Section ──────────────────────────────────────────────────

function wbahLeadStatusBadge(s?: string | null) {
  if (!s) return <span className="text-[11px] text-muted-foreground">—</span>;
  const v = s.toLowerCase();
  const cls =
    v === "completed" || v === "answered" || v === "called"
      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
      : v === "not connected" || v === "not_connected" || v === "failed" || v === "no_answer" || v === "busy"
        ? "bg-destructive/20 text-destructive border border-destructive/30"
        : v === "callback" || v === "pending"
          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
          : v === "in_progress" || v === "ringing"
            ? "bg-primary/20 text-primary border border-primary/30"
            : "bg-muted/40 text-muted-foreground border border-white/[0.06]";
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${cls}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

function wbahLeadSentiment(v?: string | null) {
  if (!v || v === "N/A" || v === "n/a") return <span className="text-[11px] text-muted-foreground">—</span>;
  const cls =
    v.toLowerCase() === "positive" ? "text-emerald-400" :
    v.toLowerCase() === "negative" ? "text-destructive" :
    "text-muted-foreground";
  return <span className={`text-[11px] capitalize ${cls}`}>{v}</span>;
}

const WBAH_LEAD_PAGE_SIZE = 10;

function WbahLeadsSection() {
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState("");
  const [transcript, setTranscript] = useState<{ text: string; name: string } | null>(null);
  const getFn = useServerFn(getWbahLeads);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["wbah-leads", page],
    queryFn: () => getFn({ data: { page, limit: WBAH_LEAD_PAGE_SIZE } }),
    staleTime: 60_000,
    retry: 1,
    placeholderData: (prev) => prev,
  });

  const records = data?.records ?? [];
  const total   = data?.total  ?? 0;
  const pages   = data?.pages  ?? 1;
  const startNo = (page - 1) * WBAH_LEAD_PAGE_SIZE + 1;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r: any) =>
        r.name?.toLowerCase().includes(q) ||
        r.contact?.toLowerCase().includes(q),
    );
  }, [records, search]);

  const pageWindow = (() => {
    const half = 4;
    let start = Math.max(1, page - half);
    let end   = Math.min(pages, start + 9);
    start = Math.max(1, end - 9);
    const nums: number[] = [];
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  })();

  if (isLoading && !data) return (
    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
      <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading WeeBespoke leads…
    </div>
  );

  if (error) return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      {(error as Error).message}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Transcript modal */}
      {transcript && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setTranscript(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Transcript</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{transcript.name}</p>
              </div>
              <button onClick={() => setTranscript(null)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg bg-black/30 border border-white/[0.06] p-3 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {transcript.text || "No transcript available."}
            </div>
          </div>
        </div>
      )}

      {/* Header + search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name or number…"
            className="h-7 pl-8 text-xs"
          />
        </div>
        <p className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          {total > 0 ? `Showing ${startNo}–${Math.min(startNo + WBAH_LEAD_PAGE_SIZE - 1, total)} of ${total.toLocaleString()}` : "WeeBespoke leads"}
        </p>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setPage(1); refetch(); }} disabled={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* Table */}
      <div className={cn("rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden transition-opacity", isFetching && "opacity-60")}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16">
            <Phone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">{total === 0 ? "No leads found" : "No matches"}</p>
            <p className="text-xs text-muted-foreground">WeeBespoke lead data will appear here once available.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] bg-card/30">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground w-10">SR NO</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Contact</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Type</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Last Called At</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Call Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Call Duration</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recording</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentiment Analysis</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Transcript</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any, idx: number) => (
                  <tr key={r.id} className="h-10 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 py-2 text-[11px] text-muted-foreground tabular-nums">{r.srNo ?? startNo + idx}</td>
                    <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">{r.name ?? "—"}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{r.contact ?? "—"}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">{r.type ?? "Lead"}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                      {r.lastCalledAt
                        ? new Date(r.lastCalledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{wbahLeadStatusBadge(r.callStatus)}</td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
                      {r.callDuration ?? "N/A"}
                    </td>
                    <td className="px-3 py-2">
                      {r.recordingUrl ? (
                        <a
                          href={r.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline whitespace-nowrap"
                          onClick={e => e.stopPropagation()}
                        >
                          <PlayCircle className="h-3 w-3" /> Play
                        </a>
                      ) : <span className="text-[11px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">{wbahLeadSentiment(r.sentiment)}</td>
                    <td className="px-3 py-2">
                      {r.transcript ? (
                        <button
                          onClick={() => setTranscript({ text: r.transcript, name: r.name ?? "Lead" })}
                          className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:underline whitespace-nowrap"
                        >
                          <ChevronRight className="h-3 w-3" /> View
                        </button>
                      ) : <span className="text-[11px] text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Showing {startNo}–{Math.min(startNo + WBAH_LEAD_PAGE_SIZE - 1, total)} of {total.toLocaleString()} leads</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.06] bg-card/40 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            </button>
            {pageWindow[0] > 1 && (
              <>
                <button onClick={() => setPage(1)} className="flex h-7 min-w-[28px] items-center justify-center rounded-md border border-white/[0.06] bg-card/40 px-2 hover:bg-white/[0.06]">1</button>
                {pageWindow[0] > 2 && <span className="px-1">…</span>}
              </>
            )}
            {pageWindow.map(n => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={cn(
                  "flex h-7 min-w-[28px] items-center justify-center rounded-md border px-2 transition-colors",
                  n === page
                    ? "border-primary/40 bg-primary/15 text-primary font-semibold"
                    : "border-white/[0.06] bg-card/40 hover:bg-white/[0.06]",
                )}
              >{n}</button>
            ))}
            {pageWindow[pageWindow.length - 1] < pages && (
              <>
                {pageWindow[pageWindow.length - 1] < pages - 1 && <span className="px-1">…</span>}
                <button onClick={() => setPage(pages)} className="flex h-7 min-w-[28px] items-center justify-center rounded-md border border-white/[0.06] bg-card/40 px-2 hover:bg-white/[0.06]">{pages}</button>
              </>
            )}
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.06] bg-card/40 hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ContactsPage ─────────────────────────────────────────────────────────

function ContactsPage() {
  const [search, setSearch]       = useState("");
  const [notesPanel, setNotesPanel] = useState<PanelTarget | null>(null);
  const [docsTarget, setDocsTarget] = useState<DocsTarget | null>(null);
  const [activeTab, setActiveTab]   = useState<"contacts" | "wbah">("contacts");
  const [isWbah, setIsWbah]         = useState(false);
  const listFn = useServerFn(listDataRecords);

  // Detect webuyanyhouse workspace
  useEffect(() => {
    const sb = createClient(
      import.meta.env.VITE_SUPABASE_URL!,
      import.meta.env.VITE_SUPABASE_ANON_KEY!,
    );
    sb.auth.getUser().then(async ({ data: u }) => {
      if (!u.user) return;
      const { data: w } = await sb
        .from("workspaces")
        .select("slug")
        .eq("owner_id", u.user.id)
        .maybeSingle();
      if (w?.slug === "webuyanyhouse") setIsWbah(true);
    });
  }, []);

  const { data: records = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => listFn({ data: { limit: 2000 } }),
    staleTime: 60_000,
    enabled: activeTab === "contacts",
  });

  // Deduplicate by mobile_number
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

  const total       = deduped.length;
  const withAddress = deduped.filter((r: any) => r.address_line1).length;
  const withEmail   = deduped.filter((r: any) => r.email).length;

  function displayName(r: any) {
    return r.name || [r.first_name, r.last_name].filter(Boolean).join(" ") || r.mobile_number || "Contact";
  }

  function openNotes(r: any) {
    setNotesPanel({
      entityType: "contact",
      entityId:    r.id,
      entityName:  displayName(r),
      defaultPhone: r.mobile_number ?? undefined,
      defaultEmail: r.email ?? undefined,
    });
  }

  function openDocs(r: any) {
    setDocsTarget({ contactId: r.id, contactName: displayName(r) });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Page title + tabs */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">All Contacts</h1>
        {isWbah && (
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-card/40 p-0.5">
            <button
              onClick={() => setActiveTab("contacts")}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "contacts"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Contacts
            </button>
            <button
              onClick={() => setActiveTab("wbah")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "wbah"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Building2 className="h-3 w-3" />
              WeeBespoke Leads
            </button>
          </div>
        )}
      </div>

      {/* ── WeeBespoke Leads tab ── */}
      {activeTab === "wbah" && isWbah && <WbahLeadsSection />}

      {/* ── Standard contacts tab ── */}
      {activeTab === "contacts" && (
        <>
          {/* KPI strip */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <KpiCard label="Total Contacts" value={total} icon={BookUser} />
            <KpiCard label="With Address" value={withAddress} icon={BookUser}
              iconBg="bg-blue-500/15" iconColor="text-blue-400" />
            <KpiCard label="With Email" value={withEmail} icon={BookUser}
              iconBg="bg-violet-500/15" iconColor="text-violet-400" />
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
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => refetch()} disabled={isFetching}>
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
                <p className="text-sm font-medium">{total === 0 ? "No contacts yet" : "No matches"}</p>
                <p className="text-xs text-muted-foreground">
                  {total === 0 ? "Upload a CSV from the Data section to add contacts." : "Try a different search term."}
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
                      <th className="px-3 py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r: any) => (
                      <tr
                        key={r.id}
                        className="h-9 border-b border-white/[0.04] last:border-0 align-middle hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">{displayName(r)}</td>
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
                          {r.notes
                            ? <span className="line-clamp-1">{r.notes}</span>
                            : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openNotes(r)}
                              title="Notes & appointment"
                              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                            >
                              <StickyNote className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => openDocs(r)}
                              title="Documents"
                              className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-blue-400/80 hover:text-blue-400 hover:bg-blue-500/10 border border-blue-500/20 hover:border-blue-500/40 transition-colors"
                            >
                              <FolderOpen className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Notes sheet */}
      {notesPanel && (
        <NotesBookingSheet
          open={!!notesPanel}
          onOpenChange={(o) => { if (!o) setNotesPanel(null); }}
          entityType={notesPanel.entityType}
          entityId={notesPanel.entityId}
          entityName={notesPanel.entityName}
          defaultPhone={notesPanel.defaultPhone}
          defaultEmail={notesPanel.defaultEmail}
        />
      )}

      {/* Documents dialog */}
      <ContactDocsDialog
        target={docsTarget}
        onClose={() => setDocsTarget(null)}
      />
    </div>
  );
}
