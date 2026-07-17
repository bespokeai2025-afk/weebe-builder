import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  uploadInvoiceTemplate,
  listInvoiceTemplates,
  deleteInvoiceTemplate,
  generateInvoice,
  listInvoices,
  getInvoiceDownloadUrl,
  deleteInvoice,
  updateInvoiceStatus,
  INVOICE_STATUSES,
} from "@/lib/accountsmind/invoices.functions";
import { listAccountsClients } from "@/lib/accountsmind/accountsmind.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  FileText, Upload, Trash2, Download, Loader2, Plus, X, Receipt, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

type ExtraItem = { description: string; quantity: number; unit_price: number };

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<string, string> = {
  unpaid:    "bg-amber-500/15 text-amber-300 border-amber-500/30",
  sent:      "bg-sky-500/15 text-sky-300 border-sky-500/30",
  paid:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  overdue:   "bg-red-500/15 text-red-300 border-red-500/30",
  cancelled: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

const PLACEHOLDER_HELP = [
  "{invoice_number}", "{invoice_date}", "{due_date}", "{client_name}",
  "{period}", "{currency}", "{subtotal}", "{tax_rate}", "{tax}", "{total}", "{notes}",
];

export function AccountsMindInvoices() {
  const qc = useQueryClient();
  const uploadFn = useServerFn(uploadInvoiceTemplate);
  const listTplFn = useServerFn(listInvoiceTemplates);
  const delTplFn = useServerFn(deleteInvoiceTemplate);
  const genFn = useServerFn(generateInvoice);
  const listInvFn = useServerFn(listInvoices);
  const dlFn = useServerFn(getInvoiceDownloadUrl);
  const delInvFn = useServerFn(deleteInvoice);
  const statusFn = useServerFn(updateInvoiceStatus);
  const clientsFn = useServerFn(listAccountsClients);

  const { data: tplData } = useQuery({
    queryKey: ["am-invoice-templates"],
    queryFn: () => listTplFn(),
    throwOnError: false,
  });
  const { data: invData } = useQuery({
    queryKey: ["am-invoices"],
    queryFn: () => listInvFn(),
    throwOnError: false,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["accountsmind-clients"],
    queryFn: () => clientsFn(),
    throwOnError: false,
  });

  const templates: any[] = (tplData as any)?.templates ?? [];
  const invoices: any[] = (invData as any)?.invoices ?? [];

  // ── Upload state ──
  const [tplName, setTplName] = useState("");
  const [tplFile, setTplFile] = useState<File | null>(null);

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!tplFile) throw new Error("Choose a .docx file first.");
      const buf = await tplFile.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const res: any = await uploadFn({
        data: {
          name: tplName.trim() || tplFile.name.replace(/\.docx$/i, ""),
          fileName: tplFile.name,
          fileBase64: btoa(binary),
        },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Upload failed");
      return res;
    },
    onSuccess: () => {
      toast.success("Template uploaded");
      setTplName(""); setTplFile(null);
      qc.invalidateQueries({ queryKey: ["am-invoice-templates"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  // ── Generate state ──
  const [templateId, setTemplateId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [taxRate, setTaxRate] = useState("20");
  const [dueDays, setDueDays] = useState("30");
  const [includeUsage, setIncludeUsage] = useState(false);
  const [notes, setNotes] = useState("");
  const [extras, setExtras] = useState<ExtraItem[]>([]);

  const genMut = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error("Pick a template.");
      if (!workspaceId) throw new Error("Pick a client.");
      const res: any = await genFn({
        data: {
          templateId,
          workspaceId,
          month,
          taxRatePercent: Number(taxRate) || 0,
          dueInDays: Number(dueDays) || 30,
          includeUsageCosts: includeUsage,
          extraLineItems: extras.filter((e) => e.description.trim()),
          notes: notes.trim() || null,
        },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Generation failed");
      return res;
    },
    onSuccess: (res: any) => {
      toast.success(`Invoice ${res.invoice?.invoice_number} generated`);
      qc.invalidateQueries({ queryKey: ["am-invoices"] });
      if (res.downloadUrl) window.open(res.downloadUrl, "_blank");
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const download = async (id: string) => {
    const res: any = await dlFn({ data: { id } });
    if (res?.ok && res.downloadUrl) window.open(res.downloadUrl, "_blank");
    else toast.error(res?.error ?? "Download failed");
  };

  const money = (cents: number, cur: string) =>
    `${cur === "GBP" ? "£" : cur === "USD" ? "$" : cur === "EUR" ? "€" : cur + " "}${(cents / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res: any = await statusFn({ data: { id, status } });
      if (!res?.ok) throw new Error(res?.error ?? "Status update failed");
      return res;
    },
    onSuccess: (res: any) => {
      toast.success(res.invoice?.status === "paid" ? "Invoice marked as paid" : "Invoice status updated");
      qc.invalidateQueries({ queryKey: ["am-invoices"] });
      qc.invalidateQueries({ queryKey: ["accountsmind-dashboard"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Status update failed"),
  });

  // ── KPI totals — from the full-table server aggregate (the invoice listing
  // itself is capped at 200 rows and must not be used for totals).
  const summary: any = (invData as any)?.summary ?? null;
  const kpiCurrency = summary?.currency ?? invoices[0]?.currency ?? "GBP";
  const totalInvoiced = summary?.totalInvoicedCents ?? 0;
  const paidTotal = summary?.paidSalesCents ?? 0;
  const outstandingTotal = summary?.outstandingCents ?? 0;
  const overdueTotal = summary?.overdueCents ?? 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <Receipt className="w-5 h-5 text-emerald-400" /> Invoices
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Upload a Word (.docx) invoice template with placeholders, then generate filled invoices per client and month.
        </p>
      </div>

      {/* KPIs */}
      {invoices.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total invoiced", value: money(totalInvoiced, kpiCurrency), cls: "text-white" },
            { label: "Paid (total sales)", value: money(paidTotal, kpiCurrency), cls: "text-emerald-400" },
            { label: "Outstanding", value: money(outstandingTotal, kpiCurrency), cls: "text-amber-400" },
            { label: "Overdue", value: money(overdueTotal, kpiCurrency), cls: overdueTotal > 0 ? "text-red-400" : "text-slate-400" },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className={`text-lg font-semibold mt-1 ${k.cls}`}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Templates */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-sky-400" /> Invoice templates
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Template name</label>
            <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Standard invoice" className="w-56 bg-slate-950 border-slate-700 text-white" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">.docx file</label>
            <Input type="file" accept=".docx" onChange={(e) => setTplFile(e.target.files?.[0] ?? null)} className="w-72 bg-slate-950 border-slate-700 text-slate-300 file:text-slate-300" />
          </div>
          <Button size="sm" disabled={!tplFile || uploadMut.isPending} onClick={() => uploadMut.mutate()} className="bg-sky-600 hover:bg-sky-500">
            {uploadMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
          </Button>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Use these placeholders in your Word document: {PLACEHOLDER_HELP.join(" ")} — and a repeating line-item table row wrapped in{" "}
          <code className="text-slate-400">{"{#items}"}</code> … <code className="text-slate-400">{"{/items}"}</code> with{" "}
          <code className="text-slate-400">{"{description} {quantity} {unit_price} {amount}"}</code>.
        </p>
        {templates.length === 0 ? (
          <p className="text-sm text-slate-500">No templates uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {templates.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{t.name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {t.file_name}
                    {Array.isArray(t.placeholders_json) && t.placeholders_json.length > 0 && (
                      <> · found: {t.placeholders_json.slice(0, 8).join(" ")}{t.placeholders_json.length > 8 ? " …" : ""}</>
                    )}
                  </p>
                </div>
                <Button
                  size="sm" variant="ghost" className="text-red-400 hover:text-red-300 shrink-0"
                  onClick={async () => {
                    const res: any = await delTplFn({ data: { id: t.id } });
                    if (res?.ok) { toast.success("Template deleted"); qc.invalidateQueries({ queryKey: ["am-invoice-templates"] }); }
                    else toast.error(res?.error ?? "Delete failed");
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Generate */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-emerald-400" /> Generate an invoice
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Template</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full h-9 rounded-md bg-slate-950 border border-slate-700 text-sm text-white px-2">
              <option value="">Select template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {templates.length === 0 && (
              <p className="text-[11px] text-amber-400">
                No templates yet — upload a .docx template in the “Invoice templates” section above first.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Client</label>
            <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="w-full h-9 rounded-md bg-slate-950 border border-slate-700 text-sm text-white px-2">
              <option value="">Select client…</option>
              {(clients as any[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Billing month</label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-slate-950 border-slate-700 text-white" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Tax / VAT rate (%)</label>
            <Input type="number" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="bg-slate-950 border-slate-700 text-white" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Due in (days)</label>
            <Input type="number" min="0" max="365" value={dueDays} onChange={(e) => setDueDays(e.target.value)} className="bg-slate-950 border-slate-700 text-white" />
          </div>
          <div className="space-y-1 flex flex-col justify-end pb-1">
            <label className="text-xs text-slate-400 flex items-center gap-2">
              <Switch checked={includeUsage} onCheckedChange={setIncludeUsage} />
              Add usage costs for the month as line items
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-400">Extra line items (optional)</label>
            <Button size="sm" variant="ghost" className="text-sky-400" onClick={() => setExtras((x) => [...x, { description: "", quantity: 1, unit_price: 0 }])}>
              <Plus className="w-4 h-4" /> Add line
            </Button>
          </div>
          {extras.map((li, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input placeholder="Description" value={li.description} onChange={(e) => setExtras((x) => x.map((v, j) => j === i ? { ...v, description: e.target.value } : v))} className="flex-1 bg-slate-950 border-slate-700 text-white" />
              <Input type="number" placeholder="Qty" value={li.quantity} onChange={(e) => setExtras((x) => x.map((v, j) => j === i ? { ...v, quantity: Number(e.target.value) || 0 } : v))} className="w-20 bg-slate-950 border-slate-700 text-white" />
              <Input type="number" placeholder="Unit price" value={li.unit_price} onChange={(e) => setExtras((x) => x.map((v, j) => j === i ? { ...v, unit_price: Number(e.target.value) || 0 } : v))} className="w-28 bg-slate-950 border-slate-700 text-white" />
              <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setExtras((x) => x.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-xs text-slate-400">Notes (shown via {"{notes}"} placeholder)</label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-slate-950 border-slate-700 text-white" />
        </div>

        <Button disabled={genMut.isPending || !templateId || !workspaceId} onClick={() => genMut.mutate()} className="bg-emerald-600 hover:bg-emerald-500">
          {genMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />} Generate invoice
        </Button>
      </section>

      {/* History */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-sm font-medium text-white">Generated invoices</h2>
        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">No invoices generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">Number</th>
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Period</th>
                  <th className="py-2 pr-4">Total</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-800/60">
                    <td className="py-2 pr-4 text-white">{inv.invoice_number}</td>
                    <td className="py-2 pr-4 text-slate-300">{inv.client_name}</td>
                    <td className="py-2 pr-4 text-slate-400">{inv.invoice_month}</td>
                    <td className="py-2 pr-4 text-slate-300">{money(inv.total_cents ?? 0, inv.currency ?? "GBP")}</td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={inv.status ?? "unpaid"}
                          disabled={statusMut.isPending}
                          onChange={(e) => statusMut.mutate({ id: inv.id, status: e.target.value })}
                          className={`h-7 rounded-md border px-2 text-xs capitalize bg-slate-950 ${STATUS_STYLES[inv.status ?? "unpaid"] ?? STATUS_STYLES.unpaid}`}
                          title={inv.paid_at ? `Paid ${new Date(inv.paid_at).toLocaleDateString("en-GB")}` : inv.due_date ? `Due ${new Date(inv.due_date).toLocaleDateString("en-GB")}` : undefined}
                        >
                          {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {inv.status !== "paid" && inv.status !== "cancelled" && (
                          <Button
                            size="sm" variant="ghost" className="h-7 px-1.5 text-emerald-400 hover:text-emerald-300"
                            title="Mark as paid"
                            disabled={statusMut.isPending}
                            onClick={() => statusMut.mutate({ id: inv.id, status: "paid" })}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{new Date(inv.created_at).toLocaleDateString("en-GB")}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="text-sky-400" onClick={() => download(inv.id)}><Download className="w-4 h-4" /></Button>
                      <Button
                        size="sm" variant="ghost" className="text-red-400"
                        onClick={async () => {
                          const res: any = await delInvFn({ data: { id: inv.id } });
                          if (res?.ok) { toast.success("Invoice deleted"); qc.invalidateQueries({ queryKey: ["am-invoices"] }); }
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
          </div>
        )}
      </section>
    </div>
  );
}
