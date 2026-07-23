import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getInvoiceBusinessProfile, saveInvoiceBusinessProfile } from "@/lib/accountsmind/invoice-suite.functions";
import { inputCls, selectCls } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Hash } from "lucide-react";
import { toast } from "sonner";

export function InvoiceSettingsTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getInvoiceBusinessProfile);
  const saveFn = useServerFn(saveInvoiceBusinessProfile);

  const { data } = useQuery({ queryKey: ["am-inv-business"], queryFn: () => getFn(), throwOnError: false });

  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    const p = (data as any)?.profile;
    if (p && !form) {
      setForm({
        number_prefix: p.number_prefix ?? "INV",
        number_include_year: p.number_include_year ?? true,
        number_pad_width: String(p.number_pad_width ?? 4),
        default_currency: p.default_currency ?? "GBP",
        default_tax_rate_percent: String(p.default_tax_rate_percent ?? 20),
        default_due_days: String(p.default_due_days ?? 30),
        default_payment_terms: p.default_payment_terms ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const p = (data as any)?.profile ?? {};
      const res: any = await saveFn({
        data: {
          // Preserve business-details fields managed on the Business tab.
          from_name: p.from_name ?? "",
          from_legal_name: p.from_legal_name ?? "",
          from_address: p.from_address ?? "",
          from_email: p.from_email ?? "",
          from_phone: p.from_phone ?? "",
          from_website: p.from_website ?? "",
          from_company_number: p.from_company_number ?? "",
          from_vat_number: p.from_vat_number ?? "",
          from_tax_number: p.from_tax_number ?? "",
          invoice_footer: p.invoice_footer ?? "",
          signatory_name: p.signatory_name ?? "",
          number_prefix: form.number_prefix.trim() || "INV",
          number_include_year: form.number_include_year,
          number_pad_width: Math.min(8, Math.max(1, Number(form.number_pad_width) || 4)),
          default_currency: form.default_currency,
          default_tax_rate_percent: Number(form.default_tax_rate_percent) || 0,
          default_due_days: Number(form.default_due_days) || 30,
          default_payment_terms: form.default_payment_terms,
        },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["am-inv-business"] });
      qc.invalidateQueries({ queryKey: ["am-invoices-v2"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const exampleNumber = form
    ? `${form.number_prefix.trim() || "INV"}-${form.number_include_year ? `${new Date().getFullYear()}-` : ""}${"1".padStart(Math.min(8, Math.max(1, Number(form.number_pad_width) || 4)), "0")}`
    : "";

  if (!form) return <div className="h-48 rounded-xl bg-slate-800/40 animate-pulse" />;

  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-sm font-medium text-white flex items-center gap-2"><Hash className="w-4 h-4 text-indigo-400" /> Invoice numbering</h2>
        <p className="text-xs text-slate-500">
          Numbers are assigned automatically and never reused — voided or cancelled invoice numbers stay reserved for your records.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Prefix</label>
            <Input value={form.number_prefix} onChange={(e) => setForm({ ...form, number_prefix: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Digits</label>
            <Input type="number" min="1" max="8" value={form.number_pad_width} onChange={(e) => setForm({ ...form, number_pad_width: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1 flex items-end pb-2">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <Switch checked={form.number_include_year} onCheckedChange={(v) => setForm({ ...form, number_include_year: v })} /> Include year
            </label>
          </div>
        </div>
        <p className="text-xs text-slate-400">Example next number: <span className="font-mono text-indigo-300">{exampleNumber}</span></p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-sm font-medium text-white">Invoice defaults</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Default currency</label>
            <select value={form.default_currency} onChange={(e) => setForm({ ...form, default_currency: e.target.value })} className={selectCls}>
              {["GBP", "USD", "EUR", "AED"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Default tax rate (%)</label>
            <Input type="number" min="0" max="100" value={form.default_tax_rate_percent} onChange={(e) => setForm({ ...form, default_tax_rate_percent: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Due in (days)</label>
            <Input type="number" min="0" max="365" value={form.default_due_days} onChange={(e) => setForm({ ...form, default_due_days: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1 col-span-3">
            <label className="text-xs text-slate-400">Default payment terms text</label>
            <Input value={form.default_payment_terms} onChange={(e) => setForm({ ...form, default_payment_terms: e.target.value })} placeholder="Payment due within 30 days" className={inputCls} />
          </div>
        </div>
      </section>

      <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className="bg-indigo-600 hover:bg-indigo-500">
        {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save settings
      </Button>
    </div>
  );
}
