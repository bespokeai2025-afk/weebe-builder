/**
 * Webuyanyhouse — People (Call Output Data)
 * Searchable table of all call contacts with drawer for history details.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { Search, Phone, Mic, FileText, ChevronRight, X, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import {
  getWbahPeople,
  getWbahUserHistory,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, WbahCard, KpiCard, WbahLoading, WbahError, WbahEmpty,
  WbahTable, WbahTr, WbahTd, StatusBadge, SentimentBadge, safeArr, safeNum, formatDate,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/people")({
  component: WbahPeople,
});

type Person = Record<string, any>;

function WbahPeople() {
  const [tab, setTab] = useState<"people" | "callbacks">("people");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);

  const getFn = useServerFn(getWbahPeople);
  const historyFn = useServerFn(getWbahUserHistory);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wbah-people"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ["wbah-user-history", selected?._id ?? selected?.id],
    queryFn: () =>
      historyFn({ data: { userId: selected?._id ?? selected?.id ?? "", phone: selected?.phone ?? "" } }),
    enabled: !!selected,
    staleTime: 60_000,
  });

  const allPeople = safeArr(data?.callData);
  const callbacks  = safeArr(data?.callbacks);
  const callCount  = safeNum(data?.callCount);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (tab === "callbacks" ? callbacks : allPeople).filter(
      (r) =>
        !q ||
        [r.name, r.fullName, r.phone, r.email, r.status].some(
          (v) => v && String(v).toLowerCase().includes(q),
        ),
    );
  }, [tab, allPeople, callbacks, search]);

  return (
    <WbahPage
      title="People"
      subtitle="Property seller call data, contact history and pending callbacks"
    >
      {error && <WbahError message={(error as Error).message} />}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={Phone} label="Total Contacts" value={allPeople.length} color="text-emerald-400" />
        <KpiCard icon={Clock} label="Total Calls"    value={callCount}        color="text-blue-400" />
        <KpiCard icon={AlertCircle} label="Pending Callbacks" value={callbacks.length} color="text-yellow-400" />
        <KpiCard icon={Mic}   label="With Recordings" value={allPeople.filter((p) => p.recording || p.recordingUrl).length} color="text-purple-400" />
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
          {(["people", "callbacks"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                tab === t ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {t === "people" ? `People (${allPeople.length})` : `Callbacks (${callbacks.length})`}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
          <Input
            className="pl-8 h-8 text-xs bg-gray-800 border-gray-700 text-gray-300 w-64"
            placeholder="Search name, phone, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <WbahLoading label="Loading people…" />
      ) : filtered.length === 0 ? (
        <WbahEmpty />
      ) : (
        <WbahTable
          headers={["Name", "Phone", "Status", "Sentiment", "Last Called", "Media", ""]}
        >
          {filtered.map((p, i) => {
            const name    = p.name ?? p.fullName ?? p.contact_name ?? "Unknown";
            const phone   = p.phone ?? p.phoneNumber ?? p.mobile ?? "—";
            const status  = p.status ?? p.callStatus ?? p.leadStatus;
            const sent    = p.sentiment ?? p.callSentiment;
            const lastAt  = p.lastCalledAt ?? p.updatedAt ?? p.createdAt;
            const hasRec  = !!(p.recording ?? p.recordingUrl ?? p.recordingLink);
            const hasTrans = !!(p.transcript ?? p.transcriptUrl);

            return (
              <WbahTr key={p._id ?? p.id ?? i} onClick={() => setSelected(p)}>
                <WbahTd>
                  <span className="font-medium text-white">{name}</span>
                </WbahTd>
                <WbahTd className="font-mono text-xs">{phone}</WbahTd>
                <WbahTd><StatusBadge status={status} /></WbahTd>
                <WbahTd><SentimentBadge sentiment={sent} /></WbahTd>
                <WbahTd className="text-xs">{formatDate(lastAt)}</WbahTd>
                <WbahTd>
                  <div className="flex items-center gap-1.5">
                    {hasRec && (
                      <a
                        href={p.recording ?? p.recordingUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-purple-400"
                        title="Recording"
                      >
                        <Mic className="h-3 w-3" />
                      </a>
                    )}
                    {hasTrans && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelected(p); }}
                        className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-blue-400"
                        title="Transcript"
                      >
                        <FileText className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </WbahTd>
                <WbahTd>
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                </WbahTd>
              </WbahTr>
            );
          })}
        </WbahTable>
      )}

      {/* Detail drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent
          side="right"
          className="w-full max-w-xl bg-gray-950 border-gray-800 text-white overflow-y-auto"
        >
          <SheetHeader className="mb-4">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-white text-lg">
                {selected?.name ?? selected?.fullName ?? "Person Details"}
              </SheetTitle>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                  <X className="h-4 w-4" />
                </Button>
              </SheetClose>
            </div>
          </SheetHeader>

          {selected && (
            <div className="space-y-5">
              {/* Contact info */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Contact</h3>
                <dl className="space-y-1.5">
                  {[
                    ["Phone", selected.phone ?? selected.phoneNumber ?? selected.mobile],
                    ["Email", selected.email],
                    ["Address", selected.address ?? selected.propertyAddress],
                    ["Status", selected.status ?? selected.callStatus],
                    ["Sentiment", selected.sentiment],
                    ["Lead Source", selected.source ?? selected.leadSource],
                  ].map(([k, v]) =>
                    v ? (
                      <div key={k as string} className="flex gap-2 text-sm">
                        <dt className="text-gray-500 w-28 shrink-0">{k}</dt>
                        <dd className="text-gray-200">{v as string}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </section>

              {/* Transcript */}
              {(selected.transcript ?? selected.transcriptUrl) && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Transcript</h3>
                  <div className="text-xs text-gray-300 bg-gray-900 border border-gray-800 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {selected.transcript ?? (
                      <a href={selected.transcriptUrl} target="_blank" rel="noreferrer" className="text-emerald-400 underline">
                        View transcript →
                      </a>
                    )}
                  </div>
                </section>
              )}

              {/* Call history */}
              <section>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Call History</h3>
                {historyQuery.isLoading ? (
                  <WbahLoading label="Loading history…" />
                ) : safeArr(historyQuery.data).length === 0 ? (
                  <WbahEmpty label="No call history available" />
                ) : (
                  <div className="space-y-2">
                    {safeArr(historyQuery.data).map((h: any, i: number) => (
                      <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white font-medium">{h.outcome ?? h.callOutcome ?? "Call"}</span>
                          <span className="text-gray-500">{formatDate(h.date ?? h.calledAt ?? h.createdAt)}</span>
                        </div>
                        {h.duration && <div className="text-gray-400">Duration: {h.duration}s</div>}
                        {h.sentiment && <SentimentBadge sentiment={h.sentiment} />}
                        {h.summary && <div className="text-gray-400 mt-1">{h.summary}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Raw payload (collapsed) */}
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 hover:text-gray-400">View raw payload</summary>
                <pre className="mt-2 bg-gray-900 border border-gray-800 rounded-lg p-3 overflow-x-auto text-gray-400 max-h-48">
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </WbahPage>
  );
}
