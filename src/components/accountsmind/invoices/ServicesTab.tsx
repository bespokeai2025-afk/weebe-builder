import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listInvoiceServices,
  saveInvoiceService,
  archiveInvoiceService,
  duplicateInvoiceService,
  listClientServicePrices,
  saveClientServicePrice,
  deleteClientServicePrice,
} from "@/lib/accountsmind/invoice-suite.functions";
import { listAccountsClients } from "@/lib/accountsmind/accountsmind.functions";
import { INVOICE_UNITS } from "@/lib/accountsmind/invoice-totals.shared";
import { money, inputCls, selectCls } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Copy, Archive, ArchiveRestore, Pencil, Users, Trash2, FileDown, FileUp } from "lucide-react";
import { toast } from "sonner";
import { useRef } from "react";
import { exportServicesCsv, importServicesCsv } from "@/lib/accountsmind/invoice-suite-phase3.functions";

const emptySvc = () => ({
  id: null as string | null,
  name: "",
  public_description: "",
  internal_description: "",
  category: "",
  sku: "",
  unit: "each",
  unit_price: "",
  cost_price: "",
  currency: "GBP",
  tax_rate_percent: "20",
  tax_inclusive: false,
  recurring: false,
  billing_frequency: "",
});

export function ServicesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listInvoiceServices);
  const saveFn = useServerFn(saveInvoiceService);
  const archiveFn = useServerFn(archiveInvoiceService);
  const dupFn = useServerFn(duplicateInvoiceService);
  const pricesFn = useServerFn(listClientServicePrices);
  const savePriceFn = useServerFn(saveClientServicePrice);
  const delPriceFn = useServerFn(deleteClientServicePrice);
  const clientsFn = useServerFn(listAccountsClients);
  const exportCsvFn = useServerFn(exportServicesCsv);
  const importCsvFn = useServerFn(importServicesCsv);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const exportCsv = async () => {
    setCsvBusy(true);
    try {
      const res: any = await exportCsvFn();
      if (!res?.ok) { toast.error(res?.error ?? "Export failed"); return; }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `services-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${res.count} services`);
    } finally { setCsvBusy(false); }
  };

  const parseCsvLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };

  const importCsv = async (file: File) => {
    setCsvBusy(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) { toast.error("CSV needs a header row plus at least one service row."); return; }
      const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
      const col = (name: string) => header.indexOf(name);
      const iName = col("name"), iSku = col("sku"), iCat = col("category"), iUnit = col("unit"),
        iPrice = header.findIndex((h) => h.includes("price")), iCur = col("currency"),
        iTax = header.findIndex((h) => h.includes("tax") || h.includes("vat"));
      if (iName < 0 || iPrice < 0) { toast.error('CSV must have "name" and a price column (e.g. "unit_price").'); return; }
      const rows = lines.slice(1).map((l) => {
        const c = parseCsvLine(l);
        const priceRaw = (c[iPrice] ?? "0").replace(/[£$€,\s]/g, "");
        return {
          name: (c[iName] ?? "").trim(),
          sku: iSku >= 0 ? (c[iSku] ?? "").trim() : "",
          category: iCat >= 0 ? (c[iCat] ?? "").trim() : "",
          unit: iUnit >= 0 && (c[iUnit] ?? "").trim() ? (c[iUnit] ?? "").trim() : "each",
          unitPriceCents: Math.round(Number(priceRaw || 0) * 100),
          currency: iCur >= 0 && (c[iCur] ?? "").trim() ? (c[iCur] ?? "").trim().toUpperCase() : "GBP",
          taxRatePercent: iTax >= 0 && (c[iTax] ?? "").trim() !== "" ? Number(c[iTax]) : 20,
        };
      }).filter((r) => r.name && Number.isFinite(r.unitPriceCents) && r.unitPriceCents >= 0);
      if (rows.length === 0) { toast.error("No valid service rows found in the CSV."); return; }
      const res: any = await importCsvFn({ data: { rows } });
      if (!res?.ok) { toast.error(res?.error ?? "Import failed"); return; }
      toast.success(`Imported: ${res.created} new, ${res.updated} updated${res.failed?.length ? `, ${res.failed.length} failed` : ""}`);
      if (res.failed?.length) console.warn("Service CSV import failures:", res.failed);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setCsvBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const [showArchived, setShowArchived] = useState(false);
  const { data } = useQuery({
    queryKey: ["am-inv-services-admin", showArchived],
    queryFn: () => listFn({ data: { includeArchived: showArchived } }),
    throwOnError: false,
  });
  const services: any[] = (data as any)?.services ?? [];
  const { data: clients = [] } = useQuery({ queryKey: ["accountsmind-clients"], queryFn: () => clientsFn(), throwOnError: false });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["am-inv-services-admin"] });
    qc.invalidateQueries({ queryKey: ["am-inv-services"] });
  };

  // ── Edit dialog ──
  const [editing, setEditing] = useState<any>(null);
  const openEdit = (svc?: any) =>
    setEditing(
      svc
        ? {
            id: svc.id,
            name: svc.name ?? "",
            public_description: svc.public_description ?? "",
            internal_description: svc.internal_description ?? "",
            category: svc.category ?? "",
            sku: svc.sku ?? "",
            unit: svc.unit ?? "each",
            unit_price: (Number(svc.unit_price_cents ?? 0) / 100).toFixed(2),
            cost_price: svc.cost_price_cents == null ? "" : (Number(svc.cost_price_cents) / 100).toFixed(2),
            currency: svc.currency ?? "GBP",
            tax_rate_percent: String(svc.tax_rate_percent ?? 20),
            tax_inclusive: !!svc.tax_inclusive,
            recurring: !!svc.recurring,
            billing_frequency: svc.billing_frequency ?? "",
          }
        : emptySvc(),
    );

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!editing.name.trim()) throw new Error("Give the service a name.");
      const res: any = await saveFn({
        data: {
          id: editing.id,
          name: editing.name.trim(),
          public_description: editing.public_description,
          internal_description: editing.internal_description,
          category: editing.category,
          sku: editing.sku,
          unit: editing.unit,
          unit_price_cents: Math.round((Number(editing.unit_price) || 0) * 100),
          cost_price_cents: editing.cost_price === "" ? null : Math.round((Number(editing.cost_price) || 0) * 100),
          currency: editing.currency,
          tax_rate_percent: Number(editing.tax_rate_percent) || 0,
          tax_inclusive: editing.tax_inclusive,
          recurring: editing.recurring,
          billing_frequency: editing.recurring ? editing.billing_frequency : "",
        },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
    },
    onSuccess: () => { toast.success("Service saved"); setEditing(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  // ── Client pricing dialog ──
  const [pricingSvc, setPricingSvc] = useState<any>(null);
  const { data: cspData } = useQuery({
    queryKey: ["am-client-prices", pricingSvc?.id],
    queryFn: () => pricesFn({ data: { serviceId: pricingSvc.id } }),
    enabled: !!pricingSvc,
    throwOnError: false,
  });
  const clientPrices: any[] = (cspData as any)?.prices ?? [];
  const [priceWs, setPriceWs] = useState("");
  const [priceVal, setPriceVal] = useState("");
  const priceMut = useMutation({
    mutationFn: async () => {
      if (!priceWs) throw new Error("Pick a client.");
      const cents = Math.round((Number(priceVal) || 0) * 100);
      const res: any = await savePriceFn({ data: { serviceId: pricingSvc.id, workspaceId: priceWs, unitPriceCents: cents, note: "" } });
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
    },
    onSuccess: () => { toast.success("Client price saved"); setPriceWs(""); setPriceVal(""); qc.invalidateQueries({ queryKey: ["am-client-prices"] }); qc.invalidateQueries({ queryKey: ["am-client-service-prices"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white">Services & pricing</h2>
          <p className="text-xs text-slate-500 mt-0.5">Reusable line items with standard prices — override per client where agreed.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
          </label>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }} />
          <Button size="sm" variant="outline" disabled={csvBusy} className="border-slate-700 text-slate-300 hover:bg-slate-800" onClick={() => fileRef.current?.click()}>
            {csvBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />} Import CSV
          </Button>
          <Button size="sm" variant="outline" disabled={csvBusy} className="border-slate-700 text-slate-300 hover:bg-slate-800" onClick={exportCsv}>
            <FileDown className="w-4 h-4" /> Export CSV
          </Button>
          <Button size="sm" onClick={() => openEdit()} className="bg-emerald-600 hover:bg-emerald-500"><Plus className="w-4 h-4" /> New service</Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        {services.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No services yet — add your first reusable service above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-3">Service</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3 text-right">Price</th>
                  <th className="py-2 pr-3">Unit</th>
                  <th className="py-2 pr-3 text-right">Tax</th>
                  <th className="py-2 pr-3">Recurring</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className={`border-b border-slate-800/60 ${s.archived ? "opacity-50" : ""}`}>
                    <td className="py-2 pr-3">
                      <p className="text-white">{s.name}{s.sku ? <span className="ml-1.5 text-[10px] text-slate-500">{s.sku}</span> : null}</p>
                      {s.public_description && <p className="text-xs text-slate-500 truncate max-w-[280px]">{s.public_description}</p>}
                    </td>
                    <td className="py-2 pr-3 text-slate-400">{s.category || "—"}</td>
                    <td className="py-2 pr-3 text-right text-slate-200 tabular-nums">{money(s.unit_price_cents ?? 0, s.currency ?? "GBP")}</td>
                    <td className="py-2 pr-3 text-slate-400">{s.unit}</td>
                    <td className="py-2 pr-3 text-right text-slate-400">{Number(s.tax_rate_percent ?? 0)}%{s.tax_inclusive ? " incl." : ""}</td>
                    <td className="py-2 pr-3 text-slate-400">{s.recurring ? s.billing_frequency || "yes" : "—"}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" title="Client-specific prices" className="text-teal-300 h-7 px-1.5" onClick={() => setPricingSvc(s)}><Users className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" title="Edit" className="text-slate-300 h-7 px-1.5" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" title="Duplicate" className="text-slate-400 h-7 px-1.5" onClick={async () => { const r: any = await dupFn({ data: { id: s.id } }); if (r?.ok) { toast.success("Duplicated"); invalidate(); } else toast.error(r?.error ?? "Failed"); }}><Copy className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" title={s.archived ? "Restore" : "Archive"} className="text-amber-400 h-7 px-1.5" onClick={async () => { const r: any = await archiveFn({ data: { id: s.id, archived: !s.archived } }); if (r?.ok) { toast.success(s.archived ? "Restored" : "Archived"); invalidate(); } else toast.error(r?.error ?? "Failed"); }}>
                        {s.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit service" : "New service"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-400">Name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Category</label>
                <Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="Setup, Support…" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">SKU / code (optional)</label>
                <Input value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-400">Public description (appears on invoices)</label>
                <Textarea value={editing.public_description} onChange={(e) => setEditing({ ...editing, public_description: e.target.value })} rows={2} className={inputCls} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-400">Internal notes (never on invoices)</label>
                <Textarea value={editing.internal_description} onChange={(e) => setEditing({ ...editing, internal_description: e.target.value })} rows={2} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Unit price</label>
                <Input type="number" step="0.01" value={editing.unit_price} onChange={(e) => setEditing({ ...editing, unit_price: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Cost price (optional, internal)</label>
                <Input type="number" step="0.01" value={editing.cost_price} onChange={(e) => setEditing({ ...editing, cost_price: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Currency</label>
                <select value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} className={selectCls}>
                  {["GBP", "USD", "EUR", "AED"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Unit</label>
                <select value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} className={selectCls}>
                  {INVOICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Tax rate (%)</label>
                <Input type="number" min="0" max="100" value={editing.tax_rate_percent} onChange={(e) => setEditing({ ...editing, tax_rate_percent: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1 flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-xs text-slate-400"><Switch checked={editing.tax_inclusive} onCheckedChange={(v) => setEditing({ ...editing, tax_inclusive: v })} /> Price includes tax</label>
                <label className="flex items-center gap-2 text-xs text-slate-400"><Switch checked={editing.recurring} onCheckedChange={(v) => setEditing({ ...editing, recurring: v })} /> Recurring</label>
              </div>
              {editing.recurring && (
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Billing frequency</label>
                  <select value={editing.billing_frequency} onChange={(e) => setEditing({ ...editing, billing_frequency: e.target.value })} className={selectCls}>
                    <option value="">Select…</option>
                    {["monthly", "quarterly", "annually"].map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className="bg-emerald-600 hover:bg-emerald-500">
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Client pricing dialog */}
      <Dialog open={!!pricingSvc} onOpenChange={(o) => !o && setPricingSvc(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader><DialogTitle>Client prices — {pricingSvc?.name}</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-400">Standard price: {pricingSvc ? money(pricingSvc.unit_price_cents ?? 0, pricingSvc.currency ?? "GBP") : ""} per {pricingSvc?.unit}. Overrides apply automatically when invoicing that client.</p>
          <div className="space-y-2">
            {clientPrices.length === 0 ? (
              <p className="text-sm text-slate-500">No client-specific prices yet.</p>
            ) : (
              clientPrices.map((p) => {
                const ws = (clients as any[]).find((c: any) => c.id === p.workspace_id);
                return (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <span className="text-sm text-slate-200">{ws?.name ?? p.workspace_id}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm tabular-nums text-teal-300">{money(p.unit_price_cents, p.currency ?? pricingSvc?.currency ?? "GBP")}</span>
                      <Button size="sm" variant="ghost" className="text-red-400 h-7 px-1.5" onClick={async () => { const r: any = await delPriceFn({ data: { id: p.id } }); if (r?.ok) { qc.invalidateQueries({ queryKey: ["am-client-prices"] }); qc.invalidateQueries({ queryKey: ["am-client-service-prices"] }); } else toast.error(r?.error ?? "Failed"); }}><Trash2 className="w-4 h-4" /></Button>
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex items-end gap-2 pt-2 border-t border-slate-800">
            <div className="space-y-1 flex-1">
              <label className="text-xs text-slate-400">Client</label>
              <select value={priceWs} onChange={(e) => setPriceWs(e.target.value)} className={selectCls}>
                <option value="">Select client…</option>
                {(clients as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1 w-28">
              <label className="text-xs text-slate-400">Price</label>
              <Input type="number" step="0.01" value={priceVal} onChange={(e) => setPriceVal(e.target.value)} className={inputCls} />
            </div>
            <Button size="sm" disabled={priceMut.isPending || !priceWs} onClick={() => priceMut.mutate()} className="bg-teal-600 hover:bg-teal-500">
              {priceMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Set
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
