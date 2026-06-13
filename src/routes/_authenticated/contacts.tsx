import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { BookUser, RefreshCw, Search, StickyNote } from "lucide-react";
import { KpiCard } from "@/components/dashboard/PageShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listDataRecords } from "@/lib/dashboard/data-records.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
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

function ContactsPage() {
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const listFn = useServerFn(listDataRecords);

  const { data: records = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => listFn({ data: { limit: 2000 } }),
    staleTime: 60_000,
  });

  // Deduplicate by mobile_number (keep first occurrence per phone)
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
      entityId: r.id,         // data_records.id — docs load directly from this
      entityName: displayName,
      defaultPhone: r.mobile_number ?? undefined,
      defaultEmail: r.email ?? undefined,
    });
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
                  <th className="px-3 py-2 w-16"></th>
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
                        <button
                          onClick={() => openPanel(r)}
                          title="Notes, documents & appointment"
                          className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors whitespace-nowrap"
                        >
                          <StickyNote className="h-3 w-3" />
                          <span>Notes & Docs</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes, Documents & Booking sheet */}
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
    </div>
  );
}
