import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInvoiceBusinessProfile,
  saveInvoiceBusinessProfile,
  listPaymentProfiles,
  savePaymentProfile,
  archivePaymentProfile,
  revealPaymentProfile,
} from "@/lib/accountsmind/invoice-suite.functions";
import { inputCls, selectCls } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Save, Plus, Pencil, Archive, ArchiveRestore, Eye, Landmark, Building2 } from "lucide-react";
import { toast } from "sonner";

const emptyPay = () => ({
  id: null as string | null,
  label: "",
  currency: "GBP",
  bank_name: "",
  account_name: "",
  account_number: "",
  sort_code: "",
  iban: "",
  swift_bic: "",
  routing_number: "",
  bank_address: "",
  payment_link: "",
  payment_instructions: "",
  is_default: false,
});

export function BusinessDetailsTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getInvoiceBusinessProfile);
  const saveFn = useServerFn(saveInvoiceBusinessProfile);
  const listPayFn = useServerFn(listPaymentProfiles);
  const savePayFn = useServerFn(savePaymentProfile);
  const archivePayFn = useServerFn(archivePaymentProfile);
  const revealFn = useServerFn(revealPaymentProfile);

  const { data } = useQuery({ queryKey: ["am-inv-business"], queryFn: () => getFn(), throwOnError: false });
  const { data: payData } = useQuery({ queryKey: ["am-payment-profiles"], queryFn: () => listPayFn(), throwOnError: false });
  const profiles: any[] = (payData as any)?.profiles ?? [];

  const [form, setForm] = useState<any>(null);
  useEffect(() => {
    const p = (data as any)?.profile;
    if (p && !form) {
      setForm({
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
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const p = (data as any)?.profile ?? {};
      const res: any = await saveFn({
        data: {
          ...form,
          // Preserve numbering/default fields managed on the Settings tab.
          default_currency: p.default_currency ?? "GBP",
          default_tax_rate_percent: Number(p.default_tax_rate_percent ?? 20),
          default_payment_terms: p.default_payment_terms ?? "",
          default_due_days: Number(p.default_due_days ?? 30),
          number_prefix: p.number_prefix ?? "INV",
          number_include_year: p.number_include_year ?? true,
          number_pad_width: Number(p.number_pad_width ?? 4),
        },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
    },
    onSuccess: () => { toast.success("Business details saved"); qc.invalidateQueries({ queryKey: ["am-inv-business"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  // ── Payment profile dialog ──
  const [editing, setEditing] = useState<any>(null);
  const payMut = useMutation({
    mutationFn: async () => {
      if (!editing.label.trim()) throw new Error("Give this profile a label (e.g. \"UK GBP account\").");
      const res: any = await savePayFn({ data: editing });
      if (!res?.ok) throw new Error(res?.error ?? "Save failed");
    },
    onSuccess: () => { toast.success("Payment profile saved"); setEditing(null); qc.invalidateQueries({ queryKey: ["am-payment-profiles"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const openEditPay = async (p?: any) => {
    if (!p) { setEditing(emptyPay()); return; }
    // Reveal real values so editing doesn't round-trip masks (reveals are audited).
    const res: any = await revealFn({ data: { id: p.id } });
    if (!res?.ok) { toast.error(res?.error ?? "Could not load profile"); return; }
    const r = res.profile;
    setEditing({
      id: r.id, label: r.label ?? "", currency: r.currency ?? "GBP", bank_name: r.bank_name ?? "",
      account_name: r.account_name ?? "", account_number: r.account_number ?? "", sort_code: r.sort_code ?? "",
      iban: r.iban ?? "", swift_bic: r.swift_bic ?? "", routing_number: r.routing_number ?? "",
      bank_address: r.bank_address ?? "", payment_link: r.payment_link ?? "", payment_instructions: r.payment_instructions ?? "",
      is_default: !!r.is_default,
    });
  };

  const field = (label: string, key: string, placeholder = "", type: "input" | "area" = "input") => (
    <div className={`space-y-1 ${type === "area" ? "col-span-2" : ""}`}>
      <label className="text-xs text-slate-400">{label}</label>
      {type === "area" ? (
        <Textarea value={form?.[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} rows={3} className={inputCls} />
      ) : (
        <Input value={form?.[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} className={inputCls} />
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      {/* Business profile */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-sm font-medium text-white flex items-center gap-2"><Building2 className="w-4 h-4 text-emerald-400" /> Business details</h2>
        <p className="text-xs text-slate-500">Shown on every invoice — PDF From-block and Word template placeholders.</p>
        {!form ? (
          <div className="h-40 rounded bg-slate-800/40 animate-pulse" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {field("Trading name", "from_name", "WEBEE")}
              {field("Legal name", "from_legal_name", "WEBEE Ltd")}
              {field("Address", "from_address", "1 Example Road\nLondon\nSW1A 1AA", "area")}
              {field("Email", "from_email")}
              {field("Phone", "from_phone")}
              {field("Website", "from_website")}
              {field("Company number", "from_company_number")}
              {field("VAT number", "from_vat_number")}
              {field("Tax number (other)", "from_tax_number")}
              {field("Signatory name", "signatory_name")}
              {field("Invoice footer", "invoice_footer", "Thank you for your business.", "area")}
            </div>
            <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className="bg-emerald-600 hover:bg-emerald-500">
              {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save details
            </Button>
          </>
        )}
      </section>

      {/* Payment profiles */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-white flex items-center gap-2"><Landmark className="w-4 h-4 text-teal-400" /> Bank / payment profiles</h2>
          <Button size="sm" onClick={() => openEditPay()} className="bg-teal-600 hover:bg-teal-500"><Plus className="w-4 h-4" /> Add profile</Button>
        </div>
        <p className="text-xs text-slate-500">Account numbers are masked here and only appear in full on generated invoices. Viewing full details is logged.</p>
        {profiles.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No payment profiles yet — add your bank details to show them on invoices.</p>
        ) : (
          <ul className="space-y-2">
            {profiles.map((p) => (
              <li key={p.id} className={`rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5 ${p.archived ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white">
                      {p.label} <span className="text-xs text-slate-500">({p.currency})</span>
                      {p.is_default && <span className="ml-2 rounded bg-teal-500/15 border border-teal-500/30 px-1.5 py-0.5 text-[10px] text-teal-300">default</span>}
                      {p.archived && <span className="ml-2 text-[10px] text-slate-500">archived</span>}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {[p.bank_name, p.account_number && `Acc ${p.account_number}`, p.sort_code && `Sort ${p.sort_code}`, p.iban && `IBAN ${p.iban}`].filter(Boolean).join(" · ") || "No account details yet"}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <Button size="sm" variant="ghost" title="Edit (reveals full details — logged)" className="text-slate-300 h-7 px-1.5" onClick={() => openEditPay(p)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" title={p.archived ? "Restore" : "Archive"} className="text-amber-400 h-7 px-1.5"
                      onClick={async () => { const r: any = await archivePayFn({ data: { id: p.id, archived: !p.archived } }); if (r?.ok) qc.invalidateQueries({ queryKey: ["am-payment-profiles"] }); else toast.error(r?.error ?? "Failed"); }}>
                      {p.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Payment profile dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit payment profile" : "New payment profile"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Label</label>
                <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="UK GBP account" className={inputCls} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Currency</label>
                <select value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} className={selectCls}>
                  {["GBP", "USD", "EUR", "AED"].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              {(
                [
                  ["Bank name", "bank_name"], ["Account name", "account_name"],
                  ["Account number", "account_number"], ["Sort code", "sort_code"],
                  ["IBAN", "iban"], ["SWIFT / BIC", "swift_bic"],
                  ["Routing number (US)", "routing_number"], ["Payment link (Stripe/PayPal…)", "payment_link"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs text-slate-400">{label}</label>
                  <Input value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} className={inputCls} />
                </div>
              ))}
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-400">Bank address (optional)</label>
                <Input value={editing.bank_address} onChange={(e) => setEditing({ ...editing, bank_address: e.target.value })} className={inputCls} />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-slate-400">Extra payment instructions (shown on invoice)</label>
                <Textarea value={editing.payment_instructions} onChange={(e) => setEditing({ ...editing, payment_instructions: e.target.value })} rows={2} className={inputCls} />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400 col-span-2">
                <Switch checked={editing.is_default} onCheckedChange={(v) => setEditing({ ...editing, is_default: v })} /> Use as the default profile on new invoices
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={payMut.isPending} onClick={() => payMut.mutate()} className="bg-teal-600 hover:bg-teal-500">
              {payMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
