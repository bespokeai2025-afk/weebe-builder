import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listInvoicesV2,
  transitionInvoiceStatus,
  recordInvoicePayment,
  duplicateInvoice,
  deleteDraftInvoice,
  generateInvoiceDocument,
} from "@/lib/accountsmind/invoice-suite.functions";
import { getInvoiceDownloadUrl } from "@/lib/accountsmind/invoices.functions";
import { listAccountsClients } from "@/lib/accountsmind/accountsmind.functions";
import { STATUS_TRANSITIONS } from "@/lib/accountsmind/invoice-totals.shared";
import { money, fmtDate, inputCls, selectCls, STATUS_STYLES, STATUS_LABELS } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Download, Loader2, Copy, Trash2, Banknote, Send, Ban, Pencil, CheckCircle2, Mail, Upload, FileMinus2, FileDown } from "lucide-react";
import { toast } from "sonner";
import { EmailInvoiceDialog } from "./EmailInvoiceDialog";
import { ImportInvoiceDialog } from "./ImportInvoiceDialog";
import { RecurringInvoicesSection } from "./RecurringInvoicesSection";
import { CreditNoteDialog } from "./CreditNoteDialog";
import { InvoiceInsightsPanel } from "./InvoiceInsightsPanel";
import { exportInvoicesCsv } from "@/lib/accountsmind/invoice-suite-phase3.functions";

const FILTER_STATUSES = ["draft", "ready", "sent", "viewed", "partially_paid", "paid", "overdue", "cancelled", "void", "refunded"];

export function InvoicesDashboardTab({ onEditDraft }: { onEditDraft: (id: string) => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listInvoicesV2);
  const statusFn = useServerFn(transitionInvoiceStatus);
  const payFn = useServerFn(recordInvoicePayment);
  const dupFn = useServerFn(duplicateInvoice);
  const delDraftFn = useServerFn(deleteDraftInvoice);
  const genFn = useServerFn(generateInvoiceDocument);
  const dlFn = useServerFn(getInvoiceDownloadUrl);
  const clientsFn = useServerFn(listAccountsClients);

  const [status, setStatus] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [unpaidOnly, setUnpaidOnly] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ["accountsmind-clients"],
    queryFn: () => clientsFn(),
    throwOnError: false,
  });

  const filterArgs = {
    status: status || null,
    workspaceId: workspaceId || null,
    search: search || null,
    overdueOnly,
    unpaidOnly,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["am-invoices-v2", filterArgs],
    queryFn: () => listFn({ data: filterArgs }),
    throwOnError: false,
  });
  const invoices: any[] = (data as any)?.invoices ?? [];
  const kpis: any = (data as any)?.kpis ?? null;
  const nextNumber: string = (data as any)?.nextNumber ?? "";

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["am-invoices-v2"] });
    qc.invalidateQueries({ queryKey: ["am-invoices"] });
    qc.invalidateQueries({ queryKey: ["accountsmind-dashboard"] });
  };

  // ── Record payment dialog ──
  const [payInv, setPayInv] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Bank transfer");
  const [payRef, setPayRef] = useState("");
  const payMut = useMutation({
    mutationFn: async () => {
      const cents = Math.round(Number(payAmount) * 100);
      if (!(cents > 0)) throw new Error("Enter a payment amount greater than zero.");
      const res: any = await payFn({ data: { invoiceId: payInv.id, amountCents: cents, method: payMethod, reference: payRef, notes: "" } });
      if (!res?.ok) throw new Error(res?.error ?? "Payment failed");
      return res;
    },
    onSuccess: (res: any) => {
      toast.success(res.status === "paid" ? "Invoice fully paid" : "Partial payment recorded");
      setPayInv(null); setPayAmount(""); setPayRef("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Payment failed"),
  });

  // ── Email + import + credit note dialogs ──
  const [emailInv, setEmailInv] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [creditInv, setCreditInv] = useState<any>(null);
  const [exporting, setExporting] = useState(false);
  const csvFn = useServerFn(exportInvoicesCsv);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res: any = await csvFn({ data: { status: status || null, workspaceId: workspaceId || null } });
      if (!res?.ok) { toast.error(res?.error ?? "Export failed"); return; }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Exported ${res.count} invoices`);
    } finally { setExporting(false); }
  };

  // ── Cancel/void dialog ──
  const [voidInv, setVoidInv] = useState<any>(null);
  const [voidMode, setVoidMode] = useState<"cancelled" | "void">("cancelled");
  const [voidReason, setVoidReason] = useState("");
  const voidMut = useMutation({
    mutationFn: async () => {
      const res: any = await statusFn({ data: { id: voidInv.id, status: voidMode, reason: voidReason } });
      if (!res?.ok) throw new Error(res?.error ?? "Update failed");
    },
    onSuccess: () => { toast.success(`Invoice ${voidMode}`); setVoidInv(null); setVoidReason(""); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const quickStatus = async (inv: any, to: string) => {
    const res: any = await statusFn({ data: { id: inv.id, status: to, reason: "" } });
    if (res?.ok) { toast.success(`Marked ${STATUS_LABELS[to] ?? to}`); invalidate(); }
    else toast.error(res?.error ?? "Update failed");
  };

  const download = async (inv: any) => {
    if (inv.status === "draft" || ["draft", "pending"].includes(inv.storage_path)) {
      // Draft with no file yet — generate a PDF on the fly.
      const res: any = await genFn({ data: { id: inv.id, format: "pdf" } });
      if (res?.ok && res.downloadUrl) { window.open(res.downloadUrl, "_blank"); invalidate(); }
      else toast.error(res?.error ?? "Generation failed");
      return;
    }
    const res: any = await dlFn({ data: { id: inv.id } });
    if (res?.ok && res.downloadUrl) window.open(res.downloadUrl, "_blank");
    else toast.error(res?.error ?? "Download failed");
  };

  const kpiCards = kpis
    ? [
        { label: "Invoiced this month", value: money(kpis.invoiced_this_month_cents, "GBP"), cls: "text-white" },
        { label: "Paid this month", value: money(kpis.paid_this_month_cents, "GBP"), cls: "text-emerald-400" },
        { label: "Outstanding", value: money(kpis.outstanding_cents, "GBP"), cls: "text-amber-400" },
        { label: "Overdue", value: money(kpis.overdue_cents, "GBP"), cls: kpis.overdue_cents > 0 ? "text-red-400" : "text-slate-400" },
        { label: "Draft invoices", value: String(kpis.draft_count), cls: "text-slate-300" },
        { label: "Avg payment time", value: kpis.avg_payment_days == null ? "—" : `${kpis.avg_payment_days} days`, cls: "text-slate-300" },
        { label: "VAT collected", value: money(kpis.vat_collected_cents, "GBP"), cls: "text-sky-300" },
        { label: "Next invoice no.", value: nextNumber || "—", cls: "text-slate-300" },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(kpiCards.length ? kpiCards : Array.from({ length: 8 }, (_, i) => ({ label: "…", value: "", cls: "", key: i }))).map((k: any, i) => (
          <div key={k.label + i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
            <p className="text-xs text-slate-500">{k.label}</p>
            <p className={`text-base font-semibold mt-1 tabular-nums ${k.cls}`}>{k.value || (isLoading ? "…" : "—")}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
        <div className="space-y-1 w-48">
          <label className="text-xs text-slate-400">Search</label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number or client…" className={inputCls} />
        </div>
        <div className="space-y-1 w-44">
          <label className="text-xs text-slate-400">Client</label>
          <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className={selectCls}>
            <option value="">All clients</option>
            {(clients as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1 w-40">
          <label className="text-xs text-slate-400">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="">All statuses</option>
            {FILTER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400 pb-2">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} className="accent-red-500" /> Overdue only
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400 pb-2">
          <input type="checkbox" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} className="accent-amber-500" /> Unpaid only
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 h-9" disabled={exporting} onClick={exportCsv}>
          {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Export CSV
        </Button>
        <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 hover:bg-slate-800 h-9" onClick={() => setImportOpen(true)}>
          <Upload className="w-4 h-4" /> Import invoice
        </Button>
      </div>

      {/* AccountsMind intelligence */}
      <InvoiceInsightsPanel />

      {/* Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-8 rounded bg-slate-800/50 animate-pulse" />)}</div>
        ) : invoices.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-slate-400">No invoices match these filters.</p>
            <p className="text-xs text-slate-500 mt-1">Create your first invoice from the “Create Invoice” tab.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-3">Number</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Issued</th>
                  <th className="py-2 pr-3">Due</th>
                  <th className="py-2 pr-3 text-right">Total</th>
                  <th className="py-2 pr-3 text-right">Paid</th>
                  <th className="py-2 pr-3 text-right">Balance</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const cur = inv.currency ?? "GBP";
                  const paid = Number(inv.amount_paid_cents ?? 0);
                  const credited = Number(inv.credited_cents ?? 0);
                  const balance = Math.max(0, Number(inv.total_cents ?? 0) - paid - credited);
                  const allowed: string[] = STATUS_TRANSITIONS[inv.status] ?? [];
                  return (
                    <tr key={inv.id} className="border-b border-slate-800/60">
                      <td className="py-2 pr-3 text-white whitespace-nowrap">{inv.invoice_number}{inv.is_imported ? <span className="ml-1.5 text-[10px] text-purple-300">imported</span> : null}</td>
                      <td className="py-2 pr-3 text-slate-300 max-w-[160px] truncate">{inv.client_name}</td>
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{fmtDate(inv.issue_date ?? inv.created_at)}</td>
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{fmtDate(inv.due_date)}</td>
                      <td className="py-2 pr-3 text-right text-slate-200 tabular-nums">{money(inv.total_cents ?? 0, cur)}</td>
                      <td className="py-2 pr-3 text-right text-emerald-300/90 tabular-nums">{paid ? money(paid, cur) : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{money(balance, cur)}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${STATUS_STYLES[inv.status] ?? STATUS_STYLES.draft}`}>
                          {STATUS_LABELS[inv.status] ?? inv.status}
                        </span>
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {inv.status === "draft" && (
                          <Button size="sm" variant="ghost" title="Edit draft" className="text-slate-300 h-7 px-1.5" onClick={() => onEditDraft(inv.id)}><Pencil className="w-4 h-4" /></Button>
                        )}
                        <Button size="sm" variant="ghost" title={inv.status === "draft" ? "Generate PDF" : "Download"} className="text-sky-400 h-7 px-1.5" onClick={() => download(inv)}><Download className="w-4 h-4" /></Button>
                        {!["draft", "cancelled", "void"].includes(inv.status) && (
                          <Button size="sm" variant="ghost" title={inv.last_emailed_at ? `Emailed ${new Date(inv.last_emailed_at).toLocaleDateString("en-GB")}` : "Email to client"} className={`h-7 px-1.5 ${inv.last_emailed_at ? "text-emerald-300" : "text-indigo-300"}`} onClick={() => setEmailInv(inv)}><Mail className="w-4 h-4" /></Button>
                        )}
                        {allowed.includes("sent") && (
                          <Button size="sm" variant="ghost" title="Mark sent" className="text-sky-300 h-7 px-1.5" onClick={() => quickStatus(inv, "sent")}><Send className="w-4 h-4" /></Button>
                        )}
                        {!["draft", "paid", "cancelled", "void", "refunded"].includes(inv.status) && (
                          <>
                            <Button size="sm" variant="ghost" title="Record payment" className="text-teal-300 h-7 px-1.5" onClick={() => { setPayInv(inv); setPayAmount((balance / 100).toFixed(2)); }}><Banknote className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" title="Mark paid" className="text-emerald-400 h-7 px-1.5" onClick={() => quickStatus(inv, "paid")}><CheckCircle2 className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" title="Credit note / write-off" className="text-amber-300 h-7 px-1.5" onClick={() => setCreditInv(inv)}><FileMinus2 className="w-4 h-4" /></Button>
                          </>
                        )}
                        <Button
                          size="sm" variant="ghost" title="Duplicate" className="text-slate-400 h-7 px-1.5"
                          onClick={async () => {
                            const res: any = await dupFn({ data: { id: inv.id } });
                            if (res?.ok) { toast.success(`Duplicated as ${res.invoice?.invoice_number} (draft)`); invalidate(); }
                            else toast.error(res?.error ?? "Duplicate failed");
                          }}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                        {inv.status === "draft" ? (
                          <Button
                            size="sm" variant="ghost" title="Delete draft" className="text-red-400 h-7 px-1.5"
                            onClick={async () => {
                              if (!window.confirm(`Delete draft ${inv.invoice_number}? This cannot be undone.`)) return;
                              const res: any = await delDraftFn({ data: { id: inv.id } });
                              if (res?.ok) { toast.success("Draft deleted"); invalidate(); }
                              else toast.error(res?.error ?? "Delete failed");
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        ) : !["cancelled", "void"].includes(inv.status) ? (
                          <Button size="sm" variant="ghost" title="Cancel / void" className="text-red-400 h-7 px-1.5" onClick={() => { setVoidInv(inv); setVoidMode("cancelled"); }}><Ban className="w-4 h-4" /></Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recurring invoices */}
      <RecurringInvoicesSection clients={clients as any[]} />

      <EmailInvoiceDialog invoice={emailInv} onClose={() => setEmailInv(null)} onSent={invalidate} />
      <ImportInvoiceDialog open={importOpen} onClose={() => setImportOpen(false)} clients={clients as any[]} onImported={invalidate} />
      <CreditNoteDialog invoice={creditInv} onClose={() => setCreditInv(null)} onDone={() => { invalidate(); qc.invalidateQueries({ queryKey: ["am-invoice-insights"] }); }} />

      {/* Record payment dialog */}
      <Dialog open={!!payInv} onOpenChange={(o) => !o && setPayInv(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader><DialogTitle>Record payment — {payInv?.invoice_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Total {money(payInv?.total_cents ?? 0, payInv?.currency ?? "GBP")} · already paid {money(payInv?.amount_paid_cents ?? 0, payInv?.currency ?? "GBP")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Amount ({payInv?.currency ?? "GBP"})</label>
                <Input type="number" min="0.01" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={selectCls}>
                  {["Bank transfer", "Card", "Stripe", "PayPal", "Cash", "Other"].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Reference (optional)</label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank ref, transaction ID…" className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayInv(null)}>Close</Button>
            <Button disabled={payMut.isPending} onClick={() => payMut.mutate()} className="bg-emerald-600 hover:bg-emerald-500">
              {payMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />} Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel / void dialog */}
      <Dialog open={!!voidInv} onOpenChange={(o) => !o && setVoidInv(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader><DialogTitle>Cancel or void — {voidInv?.invoice_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-400">Issued invoices are never deleted — they are cancelled or voided with an audit entry.</p>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Action</label>
              <select value={voidMode} onChange={(e) => setVoidMode(e.target.value as any)} className={selectCls}>
                <option value="cancelled">Cancel (client was told; no longer due)</option>
                <option value="void">Void (issued in error)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Reason (required)</label>
              <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={2} className={inputCls} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setVoidInv(null)}>Close</Button>
            <Button disabled={voidMut.isPending || !voidReason.trim()} onClick={() => voidMut.mutate()} className="bg-red-600 hover:bg-red-500">
              {voidMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
