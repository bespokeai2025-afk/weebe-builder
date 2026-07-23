import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  saveInvoiceDraft,
  generateInvoiceDocument,
  getInvoiceDetail,
  listInvoiceServices,
  listClientServicePrices,
  listPaymentProfiles,
  getInvoiceBusinessProfile,
} from "@/lib/accountsmind/invoice-suite.functions";
import { listInvoiceTemplates } from "@/lib/accountsmind/invoices.functions";
import { listAccountsClients } from "@/lib/accountsmind/accountsmind.functions";
import {
  computeInvoiceTotals,
  INVOICE_UNITS,
  type InvoiceLineInput,
  type TaxMode,
} from "@/lib/accountsmind/invoice-totals.shared";
import { money, fmtDate, inputCls, selectCls, currentMonth } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, X, Save, FileDown, FileText } from "lucide-react";
import { toast } from "sonner";

interface LineDraft extends InvoiceLineInput {
  _key: number;
}

let keySeq = 1;
const newLine = (partial: Partial<InvoiceLineInput> = {}): LineDraft => ({
  _key: keySeq++,
  description: "",
  quantity: 1,
  unit: "each",
  unit_price_cents: 0,
  discount_percent: 0,
  tax_rate_percent: 20,
  service_id: null,
  service_date: "",
  ...partial,
});

export function CreateInvoiceTab({
  editingId,
  onSaved,
  onDoneEditing,
}: {
  editingId: string | null;
  onSaved: () => void;
  onDoneEditing: () => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveInvoiceDraft);
  const genFn = useServerFn(generateInvoiceDocument);
  const detailFn = useServerFn(getInvoiceDetail);
  const servicesFn = useServerFn(listInvoiceServices);
  const pricesFn = useServerFn(listClientServicePrices);
  const payProfilesFn = useServerFn(listPaymentProfiles);
  const bizFn = useServerFn(getInvoiceBusinessProfile);
  const templatesFn = useServerFn(listInvoiceTemplates);
  const clientsFn = useServerFn(listAccountsClients);

  const { data: clients = [] } = useQuery({ queryKey: ["accountsmind-clients"], queryFn: () => clientsFn(), throwOnError: false });
  const { data: svcData } = useQuery({ queryKey: ["am-inv-services"], queryFn: () => servicesFn({ data: {} }), throwOnError: false });
  const { data: payData } = useQuery({ queryKey: ["am-payment-profiles"], queryFn: () => payProfilesFn(), throwOnError: false });
  const { data: bizData } = useQuery({ queryKey: ["am-inv-business"], queryFn: () => bizFn(), throwOnError: false });
  const { data: tplData } = useQuery({ queryKey: ["am-invoice-templates"], queryFn: () => templatesFn(), throwOnError: false });

  const services: any[] = (svcData as any)?.services ?? [];
  const payProfiles: any[] = ((payData as any)?.profiles ?? []).filter((p: any) => !p.archived);
  const biz: any = (bizData as any)?.profile ?? null;
  const templates: any[] = (tplData as any)?.templates ?? (Array.isArray(tplData) ? (tplData as any) : []);

  // ── Form state ──
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceMonth, setInvoiceMonth] = useState(currentMonth());
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [taxMode, setTaxMode] = useState<TaxMode>("exclusive");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [clientReference, setClientReference] = useState("");
  const [paymentProfileId, setPaymentProfileId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [items, setItems] = useState<LineDraft[]>([newLine()]);
  const [loadedEditId, setLoadedEditId] = useState<string | null>(null);

  // Defaults from business profile.
  useEffect(() => {
    if (!biz) return;
    setPaymentTerms((v) => v || String(biz.default_payment_terms ?? ""));
    if (!dueDate && biz.default_due_days != null) {
      const d = new Date();
      d.setDate(d.getDate() + Number(biz.default_due_days ?? 30));
      setDueDate(d.toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biz?.id]);

  // Load a draft for editing.
  useEffect(() => {
    if (!editingId || editingId === loadedEditId) return;
    (async () => {
      const res: any = await detailFn({ data: { id: editingId } });
      const inv = res?.invoice;
      if (!inv) { toast.error(res?.error ?? "Draft not found"); return; }
      if (inv.status !== "draft") { toast.error("Only drafts can be edited — duplicate this invoice instead."); onDoneEditing(); return; }
      setLoadedEditId(editingId);
      setInvoiceId(inv.id);
      setWorkspaceId(inv.workspace_id ?? "");
      setInvoiceNumber(inv.invoice_number ?? "");
      setInvoiceMonth(inv.invoice_month ?? currentMonth());
      setIssueDate(inv.issue_date ?? new Date().toISOString().slice(0, 10));
      setDueDate(inv.due_date ?? "");
      setTaxMode(inv.data_json?.tax_mode === "inclusive" ? "inclusive" : "exclusive");
      setPaymentTerms(inv.payment_terms ?? "");
      setPoNumber(inv.po_number ?? "");
      setClientReference(inv.client_reference ?? "");
      setPaymentProfileId(inv.payment_profile_id ?? "");
      setTemplateId(inv.template_id ?? "");
      setCustomerNotes(inv.customer_notes ?? "");
      setInternalNotes(inv.internal_notes ?? "");
      const lines: any[] = Array.isArray(inv.line_items_json) ? inv.line_items_json : [];
      setItems(lines.length ? lines.map((l) => newLine(l)) : [newLine()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // Client-specific prices for the selected client.
  const { data: cspData } = useQuery({
    queryKey: ["am-client-service-prices", workspaceId],
    queryFn: () => pricesFn({ data: { workspaceId } }),
    enabled: !!workspaceId,
    throwOnError: false,
  });
  const clientPrices: any[] = (cspData as any)?.prices ?? [];

  const selectedClient: any = (clients as any[]).find((c: any) => c.id === workspaceId) ?? null;
  const currency = selectedClient?.billing_profile?.currency ?? biz?.default_currency ?? "GBP";

  const totals = useMemo(
    () => computeInvoiceTotals(items.filter((i) => i.description.trim()), { taxMode }),
    [items, taxMode],
  );

  const addService = (svcId: string) => {
    const svc = services.find((s) => s.id === svcId);
    if (!svc) return;
    const override = clientPrices.find((p) => p.service_id === svcId);
    const line = newLine({
      service_id: svc.id,
      description: svc.public_description ? `${svc.name} — ${svc.public_description}` : svc.name,
      unit: svc.unit ?? "each",
      unit_price_cents: Number(override?.unit_price_cents ?? svc.unit_price_cents ?? 0),
      tax_rate_percent: Number(svc.tax_rate_percent ?? 20),
    });
    // Drop empty placeholder lines when adding a real one.
    setItems((x) => [...x.filter((l) => l.description.trim()), line]);
    if (override) toast.info(`Client-specific price applied: ${money(override.unit_price_cents, currency)}`);
  };

  const setLine = (key: number, patch: Partial<LineDraft>) =>
    setItems((x) => x.map((l) => (l._key === key ? { ...l, ...patch } : l)));

  const validation: string[] = [];
  if (!workspaceId) validation.push("Pick a client.");
  if (!items.some((i) => i.description.trim())) validation.push("Add at least one line item.");
  if (items.some((i) => i.description.trim() && !(i.quantity > 0))) validation.push("Every line needs a quantity above zero.");

  const buildPayload = () => ({
    id: invoiceId,
    workspaceId,
    invoiceNumber: invoiceNumber.trim() || null,
    invoiceMonth,
    issueDate: issueDate || null,
    dueDate: dueDate || null,
    currency,
    taxMode,
    paymentTerms,
    poNumber,
    clientReference,
    paymentProfileId: paymentProfileId || null,
    templateId: templateId || null,
    customerNotes,
    internalNotes,
    items: items
      .filter((i) => i.description.trim())
      .map(({ _key, ...l }) => ({ ...l, service_date: l.service_date || null })),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (validation.length) throw new Error(validation[0]);
      const res: any = await saveFn({ data: buildPayload() });
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
      return res;
    },
    onSuccess: (res: any) => {
      setInvoiceId(res.invoice.id);
      setInvoiceNumber(res.invoice.invoice_number ?? "");
      toast.success(`Draft ${res.invoice.invoice_number} saved`);
      qc.invalidateQueries({ queryKey: ["am-invoices-v2"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const genMut = useMutation({
    mutationFn: async (format: "pdf" | "docx") => {
      if (validation.length) throw new Error(validation[0]);
      if (format === "docx" && !templateId) throw new Error("Pick a Word template first (Templates tab), or generate a PDF.");
      // Always save first so the document matches what's on screen.
      const saved: any = await saveFn({ data: buildPayload() });
      if (!saved?.ok) throw new Error(saved?.error ?? "Save failed");
      setInvoiceId(saved.invoice.id);
      setInvoiceNumber(saved.invoice.invoice_number ?? "");
      const res: any = await genFn({ data: { id: saved.invoice.id, format } });
      if (!res?.ok) throw new Error(res?.error ?? "Generation failed");
      return res;
    },
    onSuccess: (res: any) => {
      toast.success(`Invoice ${res.invoice?.invoice_number} generated`);
      if (res.downloadUrl) window.open(res.downloadUrl, "_blank");
      qc.invalidateQueries({ queryKey: ["am-invoices-v2"] });
      qc.invalidateQueries({ queryKey: ["am-invoices"] });
      resetForm();
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const resetForm = () => {
    setInvoiceId(null); setLoadedEditId(null); setWorkspaceId(""); setInvoiceNumber("");
    setInvoiceMonth(currentMonth()); setIssueDate(new Date().toISOString().slice(0, 10));
    setDueDate(""); setPoNumber(""); setClientReference(""); setCustomerNotes(""); setInternalNotes("");
    setItems([newLine()]);
    onDoneEditing();
  };

  const payProfile = payProfiles.find((p) => p.id === paymentProfileId) ?? null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start">
      {/* ── Form ── */}
      <div className="space-y-4">
        {editingId && (
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200 flex items-center justify-between">
            <span>Editing draft {invoiceNumber || "…"}</span>
            <Button size="sm" variant="ghost" className="h-6 text-indigo-300" onClick={resetForm}>Start a new invoice instead</Button>
          </div>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <h2 className="text-sm font-medium text-white">Invoice details</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-1 col-span-2 md:col-span-1">
              <label className="text-xs text-slate-400">Client</label>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className={selectCls}>
                <option value="">Select client…</option>
                {(clients as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Invoice number</label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Auto-assigned" className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Billing month</label>
              <Input type="month" value={invoiceMonth} onChange={(e) => setInvoiceMonth(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Issue date</label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Due date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Tax mode</label>
              <select value={taxMode} onChange={(e) => setTaxMode(e.target.value as TaxMode)} className={selectCls}>
                <option value="exclusive">Prices exclude tax (tax added)</option>
                <option value="inclusive">Prices include tax</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">PO number (optional)</label>
              <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Client reference (optional)</label>
              <Input value={clientReference} onChange={(e) => setClientReference(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Payment terms</label>
              <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Payment due within 30 days" className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Bank details on invoice</label>
              <select value={paymentProfileId} onChange={(e) => setPaymentProfileId(e.target.value)} className={selectCls}>
                <option value="">No bank details</option>
                {payProfiles.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.currency})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Word template (for .docx)</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectCls}>
                <option value="">None — PDF only</option>
                {templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Line items */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-white">Line items</h2>
            <div className="flex items-center gap-2">
              <select defaultValue="" onChange={(e) => { if (e.target.value) { addService(e.target.value); e.target.value = ""; } }} className="h-8 rounded-md bg-slate-950 border border-slate-700 text-xs text-white px-2">
                <option value="">+ Add saved service…</option>
                {services.map((s) => <option key={s.id} value={s.id}>{s.name} — {money(s.unit_price_cents, s.currency ?? "GBP")}/{s.unit}</option>)}
              </select>
              <Button size="sm" variant="ghost" className="text-sky-400 h-8" onClick={() => setItems((x) => [...x, newLine()])}>
                <Plus className="w-4 h-4" /> Custom line
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {items.map((li) => (
              <div key={li._key} className="grid grid-cols-[minmax(0,1fr)_repeat(5,auto)_auto] gap-2 items-start">
                <div className="space-y-1 min-w-[180px]">
                  <Input placeholder="Description" value={li.description} onChange={(e) => setLine(li._key, { description: e.target.value })} className={inputCls} />
                  <Input placeholder="Service date / period (optional)" value={li.service_date ?? ""} onChange={(e) => setLine(li._key, { service_date: e.target.value })} className={`${inputCls} h-7 text-xs`} />
                </div>
                <div className="space-y-1 w-20">
                  <label className="text-[10px] text-slate-500">Qty</label>
                  <Input type="number" min="0" step="0.25" value={li.quantity} onChange={(e) => setLine(li._key, { quantity: Number(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div className="space-y-1 w-24">
                  <label className="text-[10px] text-slate-500">Unit</label>
                  <select value={li.unit ?? "each"} onChange={(e) => setLine(li._key, { unit: e.target.value })} className="w-full h-9 rounded-md bg-slate-950 border border-slate-700 text-xs text-white px-1.5">
                    {INVOICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="space-y-1 w-28">
                  <label className="text-[10px] text-slate-500">Unit price ({currency})</label>
                  <Input type="number" step="0.01" value={(li.unit_price_cents / 100).toString()} onChange={(e) => setLine(li._key, { unit_price_cents: Math.round((Number(e.target.value) || 0) * 100) })} className={inputCls} />
                </div>
                <div className="space-y-1 w-20">
                  <label className="text-[10px] text-slate-500">Disc %</label>
                  <Input type="number" min="0" max="100" value={li.discount_percent ?? 0} onChange={(e) => setLine(li._key, { discount_percent: Number(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div className="space-y-1 w-20">
                  <label className="text-[10px] text-slate-500">Tax %</label>
                  <Input type="number" min="0" max="100" value={li.tax_rate_percent ?? 0} onChange={(e) => setLine(li._key, { tax_rate_percent: Number(e.target.value) || 0 })} className={inputCls} />
                </div>
                <div className="pt-5">
                  <Button size="sm" variant="ghost" className="text-red-400 h-9 px-2" onClick={() => setItems((x) => (x.length > 1 ? x.filter((l) => l._key !== li._key) : [newLine()]))}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Notes */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Customer notes (shown on invoice)</label>
            <Textarea value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={2} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Internal notes (never shown to client)</label>
            <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} className={inputCls} />
          </div>
        </section>

        {validation.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {validation.join(" ")}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button disabled={saveMut.isPending || validation.length > 0} onClick={() => saveMut.mutate()} variant="outline" className="border-slate-600 text-slate-200">
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save draft
          </Button>
          <Button disabled={genMut.isPending || validation.length > 0} onClick={() => genMut.mutate("pdf")} className="bg-emerald-600 hover:bg-emerald-500">
            {genMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Generate PDF
          </Button>
          <Button disabled={genMut.isPending || validation.length > 0 || !templateId} onClick={() => genMut.mutate("docx")} className="bg-sky-600 hover:bg-sky-500">
            {genMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Generate Word
          </Button>
        </div>
      </div>

      {/* ── Live preview ── */}
      <div className="xl:sticky xl:top-4">
        <div className="rounded-xl border border-slate-700 bg-white text-slate-900 p-6 shadow-xl text-[13px] leading-snug">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-bold text-emerald-700">INVOICE</p>
              <p className="font-semibold">{invoiceNumber || "(number assigned on save)"}</p>
            </div>
            <div className="text-right text-xs text-slate-600">
              <p><span className="text-slate-400">Issued:</span> {fmtDate(issueDate)}</p>
              <p><span className="text-slate-400">Due:</span> {fmtDate(dueDate)}</p>
            </div>
          </div>
          <hr className="my-3 border-slate-200" />
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-slate-400 uppercase text-[10px]">From</p>
              <p className="font-semibold">{biz?.from_name || "Your business"}</p>
              {biz?.from_address && <p className="whitespace-pre-line text-slate-600">{biz.from_address}</p>}
              {biz?.from_vat_number && <p className="text-slate-600">VAT: {biz.from_vat_number}</p>}
            </div>
            <div>
              <p className="text-slate-400 uppercase text-[10px]">Billed to</p>
              <p className="font-semibold">{selectedClient?.name || "—"}</p>
              {selectedClient?.billing_profile?.billing_address && (
                <p className="whitespace-pre-line text-slate-600">{selectedClient.billing_profile.billing_address}</p>
              )}
              {poNumber && <p className="text-slate-600 mt-1">PO: {poNumber}</p>}
            </div>
          </div>
          <table className="w-full mt-4 text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-200">
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2 text-right">Price</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {totals.lines.length === 0 ? (
                <tr><td colSpan={4} className="py-3 text-center text-slate-400">Add line items to see the invoice…</td></tr>
              ) : (
                totals.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2">
                      {l.description}
                      {l.service_date ? <span className="text-slate-400"> ({l.service_date})</span> : null}
                      {l.discount_cents ? <span className="text-emerald-600"> −{l.discount_percent}%</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{l.quantity}{l.unit && l.unit !== "each" && l.unit !== "fixed" ? ` ${l.unit}` : ""}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.unit_price_cents, currency)}</td>
                    <td className="py-1.5 text-right tabular-nums font-medium">{money(l.total_cents, currency)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="mt-3 ml-auto w-56 space-y-1 text-xs">
            <div className="flex justify-between text-slate-600"><span>Subtotal</span><span className="tabular-nums">{money(totals.subtotal_cents, currency)}</span></div>
            {totals.discount_cents > 0 && (
              <div className="flex justify-between text-emerald-700"><span>Discount</span><span className="tabular-nums">−{money(totals.discount_cents, currency)}</span></div>
            )}
            {totals.tax_breakdown.map((b) => (
              <div key={b.rate_percent} className="flex justify-between text-slate-600"><span>Tax ({b.rate_percent}%{taxMode === "inclusive" ? " incl." : ""})</span><span className="tabular-nums">{money(b.tax_cents, currency)}</span></div>
            ))}
            <div className="flex justify-between font-bold text-sm border-t border-slate-300 pt-1"><span>Total due</span><span className="tabular-nums">{money(totals.total_cents, currency)}</span></div>
          </div>
          {(paymentTerms || payProfile) && (
            <div className="mt-4 text-[11px] text-slate-600 space-y-1">
              {paymentTerms && <p><span className="font-semibold">Terms:</span> {paymentTerms}</p>}
              {payProfile && (
                <p className="whitespace-pre-line">
                  <span className="font-semibold">Payment:</span> {payProfile.bank_name}{payProfile.account_number ? ` · Acc ${payProfile.account_number}` : ""}{payProfile.sort_code ? ` · Sort ${payProfile.sort_code}` : ""}
                  {"\n"}<span className="text-slate-400">(full details appear unmasked on the generated document)</span>
                </p>
              )}
            </div>
          )}
          {customerNotes && <p className="mt-3 text-[11px] text-slate-600 whitespace-pre-line">{customerNotes}</p>}
          {biz?.invoice_footer && <p className="mt-4 pt-2 border-t border-slate-200 text-[10px] text-slate-400 text-center">{biz.invoice_footer}</p>}
        </div>
        <p className="mt-2 text-[11px] text-slate-500 text-center">Live preview — totals are recomputed on the server before anything is saved.</p>
      </div>
    </div>
  );
}
