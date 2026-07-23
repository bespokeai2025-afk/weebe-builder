import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listRecurringInvoices,
  saveRecurringInvoice,
  deleteRecurringInvoice,
} from "@/lib/accountsmind/invoice-suite-extras.functions";
import { computeInvoiceTotals } from "@/lib/accountsmind/invoice-totals.shared";
import { money, inputCls, selectCls } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Repeat, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type ItemDraft = { description: string; quantity: string; unit: string; unitPrice: string; taxRate: string };

const EMPTY_ITEM: ItemDraft = { description: "", quantity: "1", unit: "month", unitPrice: "", taxRate: "20" };

function toItemsPayload(items: ItemDraft[]) {
  return items
    .filter((it) => it.description.trim() && Number(it.unitPrice) > 0)
    .map((it) => ({
      description: it.description.trim(),
      quantity: Number(it.quantity) || 1,
      unit: it.unit,
      unit_price_cents: Math.round(Number(it.unitPrice) * 100),
      tax_rate_percent: Number(it.taxRate) || 0,
      discount_cents: 0,
    }));
}

export function RecurringInvoicesSection({ clients }: { clients: any[] }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listRecurringInvoices);
  const saveFn = useServerFn(saveRecurringInvoice);
  const delFn = useServerFn(deleteRecurringInvoice);

  const { data, isLoading } = useQuery({
    queryKey: ["am-recurring-invoices"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const schedules: any[] = (data as any)?.schedules ?? [];

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [name, setName] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [dueDays, setDueDays] = useState("30");
  const [active, setActive] = useState(true);
  const [paymentTerms, setPaymentTerms] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...EMPTY_ITEM }]);

  const openNew = () => {
    setEditId(null); setWorkspaceId(""); setName(""); setDayOfMonth("1"); setDueDays("30");
    setActive(true); setPaymentTerms(""); setCustomerNotes(""); setItems([{ ...EMPTY_ITEM }]);
    setEditOpen(true);
  };
  const openEdit = (s: any) => {
    setEditId(s.id); setWorkspaceId(s.workspace_id); setName(s.name);
    setDayOfMonth(String(s.day_of_month)); setDueDays(String(s.due_days)); setActive(!!s.active);
    setPaymentTerms(s.payment_terms ?? ""); setCustomerNotes(s.customer_notes ?? "");
    const its = Array.isArray(s.items_json) ? s.items_json : [];
    setItems(
      its.length
        ? its.map((it: any) => ({
            description: it.description ?? "",
            quantity: String(it.quantity ?? 1),
            unit: it.unit ?? "",
            unitPrice: ((Number(it.unit_price_cents) || 0) / 100).toFixed(2),
            taxRate: String(it.tax_rate_percent ?? 20),
          }))
        : [{ ...EMPTY_ITEM }],
    );
    setEditOpen(true);
  };

  const payloadItems = toItemsPayload(items);
  let previewTotal = 0;
  try {
    previewTotal = payloadItems.length ? computeInvoiceTotals(payloadItems as any, { taxMode: "exclusive" }).total_cents : 0;
  } catch {
    previewTotal = 0;
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!payloadItems.length) throw new Error("Add at least one line item with a description and price.");
      const res: any = await saveFn({
        data: {
          id: editId,
          workspaceId,
          name,
          dayOfMonth: Math.min(28, Math.max(1, Number(dayOfMonth) || 1)),
          currency: "GBP",
          taxMode: "exclusive",
          items: payloadItems,
          paymentTerms,
          customerNotes,
          dueDays: Math.min(365, Math.max(0, Number(dueDays) || 30)),
          active,
        },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
      return res;
    },
    onSuccess: () => {
      toast.success(editId ? "Recurring invoice updated" : "Recurring invoice created — a draft will be generated each month");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["am-recurring-invoices"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4 text-teal-400" />
          <h3 className="text-sm font-semibold text-white">Recurring invoices</h3>
          <span className="text-xs text-slate-500">drafts are generated monthly — nothing is sent automatically</span>
        </div>
        <Button size="sm" onClick={openNew} className="bg-teal-600 hover:bg-teal-500 h-8">
          <Plus className="w-4 h-4" /> New schedule
        </Button>
      </div>

      {isLoading ? (
        <div className="h-8 rounded bg-slate-800/50 animate-pulse" />
      ) : schedules.length === 0 ? (
        <p className="text-xs text-slate-500 py-2">No recurring invoices yet. Create one to auto-draft a monthly invoice for a client.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Client</th>
              <th className="py-2 pr-3">Day</th>
              <th className="py-2 pr-3">Last generated</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-slate-800/60">
                <td className="py-2 pr-3 text-white">{s.name}</td>
                <td className="py-2 pr-3 text-slate-300">{s.workspace_name}</td>
                <td className="py-2 pr-3 text-slate-400">{s.day_of_month}<span className="text-slate-600"> of month</span></td>
                <td className="py-2 pr-3 text-slate-400">{s.last_generated_month ?? "—"}</td>
                <td className="py-2 pr-3">
                  <span className={`inline-block rounded-md border px-2 py-0.5 text-xs ${s.active ? "border-teal-700 bg-teal-950/40 text-teal-300" : "border-slate-700 bg-slate-800/60 text-slate-400"}`}>
                    {s.active ? "Active" : "Paused"}
                  </span>
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" title="Edit" className="text-slate-300 h-7 px-1.5" onClick={() => openEdit(s)}><Pencil className="w-4 h-4" /></Button>
                  <Button
                    size="sm" variant="ghost" title="Delete schedule" className="text-red-400 h-7 px-1.5"
                    onClick={async () => {
                      if (!window.confirm(`Delete recurring schedule "${s.name}"? Already-generated invoices are kept.`)) return;
                      const res: any = await delFn({ data: { id: s.id } });
                      if (res?.ok) { toast.success("Schedule deleted"); qc.invalidateQueries({ queryKey: ["am-recurring-invoices"] }); }
                      else toast.error(res?.error ?? "Delete failed");
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit recurring invoice" : "New recurring invoice"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Client</label>
                <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className={selectCls} disabled={!!editId}>
                  <option value="">Select client…</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Schedule name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly retainer" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Generate on day (1–28)</label>
                <Input type="number" min="1" max="28" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Due after (days)</label>
                <Input type="number" min="0" max="365" value={dueDays} onChange={(e) => setDueDays(e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400">Line items (prices ex-VAT)</label>
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <Input className={`${inputCls} col-span-5`} placeholder="Description" value={it.description} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <Input className={`${inputCls} col-span-2`} type="number" min="0" step="any" placeholder="Qty" value={it.quantity} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                  <Input className={`${inputCls} col-span-2`} type="number" min="0" step="0.01" placeholder="Price £" value={it.unitPrice} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} />
                  <Input className={`${inputCls} col-span-2`} type="number" min="0" max="100" placeholder="VAT %" value={it.taxRate} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, taxRate: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" className="col-span-1 text-red-400 h-9" disabled={items.length === 1} onClick={() => setItems((p) => p.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button size="sm" variant="ghost" className="text-teal-300 h-7" onClick={() => setItems((p) => [...p, { ...EMPTY_ITEM }])}><Plus className="w-4 h-4" /> Add line</Button>
                <p className="text-xs text-slate-400">Monthly total (inc. VAT): <span className="text-white font-semibold tabular-nums">{money(previewTotal, "GBP")}</span></p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Payment terms (optional)</label>
                <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Payment due within 30 days" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Customer notes (optional)</label>
                <Input value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} className={inputCls} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-teal-500" />
              Active — generate a draft invoice each month
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Close</Button>
            <Button disabled={saveMut.isPending || !workspaceId || !name.trim() || !payloadItems.length} onClick={() => saveMut.mutate()} className="bg-teal-600 hover:bg-teal-500">
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Repeat className="w-4 h-4" />} Save schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
