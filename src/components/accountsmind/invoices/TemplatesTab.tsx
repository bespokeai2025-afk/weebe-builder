import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listInvoiceTemplates, uploadInvoiceTemplate, deleteInvoiceTemplate } from "@/lib/accountsmind/invoices.functions";
import { testRenderInvoiceTemplate } from "@/lib/accountsmind/invoice-suite-extras.functions";
import { inputCls } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, Trash2, Copy, Check, AlertTriangle, FileText, Search, Eye, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { PdfOverlayEditor } from "./PdfOverlayEditor";

/** Grouped placeholder reference — mirrors the payload built in generateInvoiceDocument. */
const FIELD_GROUPS: Array<{ group: string; fields: Array<{ tag: string; label: string }> }> = [
  {
    group: "Invoice",
    fields: [
      { tag: "{invoice_number}", label: "Invoice number" },
      { tag: "{invoice_date}", label: "Issue date" },
      { tag: "{due_date}", label: "Due date" },
      { tag: "{period}", label: "Billing period (e.g. July 2026)" },
      { tag: "{billing_month}", label: "Billing month (YYYY-MM)" },
      { tag: "{currency}", label: "Currency code" },
      { tag: "{payment_terms}", label: "Payment terms" },
      { tag: "{purchase_order_number}", label: "PO number" },
      { tag: "{client_reference}", label: "Client reference" },
      { tag: "{status}", label: "Invoice status" },
    ],
  },
  {
    group: "Your business",
    fields: [
      { tag: "{from_name}", label: "Business name" },
      { tag: "{from_legal_name}", label: "Legal name" },
      { tag: "{from_address}", label: "Address" },
      { tag: "{from_email}", label: "Email" },
      { tag: "{from_phone}", label: "Phone" },
      { tag: "{from_website}", label: "Website" },
      { tag: "{from_company_number}", label: "Company number" },
      { tag: "{from_vat_number}", label: "VAT number" },
      { tag: "{from_tax_number}", label: "Tax number" },
      { tag: "{footer}", label: "Invoice footer" },
    ],
  },
  {
    group: "Client",
    fields: [
      { tag: "{client_name}", label: "Client name" },
      { tag: "{to_address}", label: "Client billing address" },
    ],
  },
  {
    group: "Line items (repeat a table row)",
    fields: [
      { tag: "{#items}", label: "Start of repeating row" },
      { tag: "{description}", label: "Line description" },
      { tag: "{service_date}", label: "Service date / period" },
      { tag: "{quantity}", label: "Quantity" },
      { tag: "{unit}", label: "Unit" },
      { tag: "{unit_price}", label: "Unit price" },
      { tag: "{discount}", label: "Line discount" },
      { tag: "{tax}", label: "Line tax" },
      { tag: "{amount}", label: "Line total" },
      { tag: "{/items}", label: "End of repeating row" },
    ],
  },
  {
    group: "Totals",
    fields: [
      { tag: "{subtotal}", label: "Subtotal (ex tax)" },
      { tag: "{discount}", label: "Total discount" },
      { tag: "{tax_rate}", label: "Tax rate(s)" },
      { tag: "{tax}", label: "Total tax" },
      { tag: "{total}", label: "Total due" },
      { tag: "{amount_paid}", label: "Amount paid" },
      { tag: "{balance_due}", label: "Balance due" },
    ],
  },
  {
    group: "Payment details",
    fields: [
      { tag: "{bank_name}", label: "Bank name" },
      { tag: "{account_name}", label: "Account name" },
      { tag: "{account_number}", label: "Account number" },
      { tag: "{sort_code}", label: "Sort code" },
      { tag: "{iban}", label: "IBAN" },
      { tag: "{swift_bic}", label: "SWIFT / BIC" },
      { tag: "{routing_number}", label: "Routing number" },
      { tag: "{payment_link}", label: "Payment link" },
      { tag: "{payment_reference}", label: "Payment reference" },
      { tag: "{payment_details}", label: "All payment details (one block)" },
      { tag: "{notes}", label: "Customer notes" },
    ],
  },
];

const CORE_TAGS = ["invoice_number", "client_name", "total"];

export function TemplatesTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listInvoiceTemplates);
  const uploadFn = useServerFn(uploadInvoiceTemplate);
  const delFn = useServerFn(deleteInvoiceTemplate);
  const testFn = useServerFn(testRenderInvoiceTemplate);
  const [testingId, setTestingId] = useState<string | null>(null);

  const testRender = async (t: any) => {
    setTestingId(t.id);
    try {
      const res: any = await testFn({ data: { templateId: t.id } });
      if (res?.ok && res.downloadUrl) {
        toast.success("Sample invoice rendered — downloading");
        window.open(res.downloadUrl, "_blank");
      } else {
        toast.error(res?.error ?? "Test render failed");
      }
    } finally {
      setTestingId(null);
    }
  };

  const { data } = useQuery({ queryKey: ["am-invoice-templates"], queryFn: () => listFn(), throwOnError: false });
  const templates: any[] = (data as any)?.templates ?? (Array.isArray(data) ? (data as any) : []);

  const [tplName, setTplName] = useState("");
  const [tplFile, setTplFile] = useState<File | null>(null);
  const [copied, setCopied] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [designTpl, setDesignTpl] = useState<any | null>(null);

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!tplFile) throw new Error("Choose a .docx or .pdf file.");
      const bytes = new Uint8Array(await tplFile.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const res: any = await uploadFn({
        data: { name: tplName.trim() || tplFile.name.replace(/\.(docx|pdf)$/i, ""), fileName: tplFile.name, fileBase64: btoa(binary) },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Upload failed");
    },
    onSuccess: () => { toast.success("Template uploaded"); setTplName(""); setTplFile(null); qc.invalidateQueries({ queryKey: ["am-invoice-templates"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const copy = (tag: string) => {
    navigator.clipboard?.writeText(tag).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(""), 1200);
    });
  };

  const filteredGroups = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return FIELD_GROUPS;
    return FIELD_GROUPS.map((g) => ({ ...g, fields: g.fields.filter((f) => f.tag.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)) })).filter((g) => g.fields.length);
  }, [fieldSearch]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      {/* Left: upload + list */}
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <h2 className="text-sm font-medium text-white flex items-center gap-2"><FileText className="w-4 h-4 text-sky-400" /> Upload a template</h2>
          <p className="text-xs text-slate-500">Upload a <span className="text-slate-300">.docx</span> Word template with placeholders, or a <span className="text-slate-300">.pdf</span> invoice design — for PDFs you then drag dynamic fields onto the design with the layout designer.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Template name</label>
              <Input value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="Standard invoice" className={`w-52 ${inputCls}`} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">.docx or .pdf file</label>
              <Input type="file" accept=".docx,.pdf" onChange={(e) => setTplFile(e.target.files?.[0] ?? null)} className={`w-64 ${inputCls} text-slate-300 file:text-slate-300`} />
            </div>
            <Button size="sm" disabled={!tplFile || uploadMut.isPending} onClick={() => uploadMut.mutate()} className="bg-sky-600 hover:bg-sky-500">
              {uploadMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
          <h2 className="text-sm font-medium text-white">Your templates</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">No templates uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {templates.map((t) => {
                const found: string[] = Array.isArray(t.placeholders_json) ? t.placeholders_json : [];
                const missingCore = CORE_TAGS.filter((c) => !found.some((f) => f.replace(/[{}]/g, "") === c));
                return (
                  <li key={t.id} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">
                          {t.name}
                          <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 align-middle">
                            {t.template_type === "pdf_overlay" ? "PDF overlay" : "Word"}
                          </span>
                        </p>
                        <p className="text-xs text-slate-500 truncate">{t.file_name}</p>
                      </div>
                      {t.template_type === "pdf_overlay" && (
                        <Button size="sm" variant="ghost" title="Open layout designer" className="text-sky-300 hover:text-sky-200 shrink-0" onClick={() => setDesignTpl(t)}>
                          <LayoutTemplate className="w-4 h-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" title="Test render with sample data" className="text-teal-300 hover:text-teal-200 shrink-0" disabled={testingId === t.id} onClick={() => testRender(t)}>
                        {testingId === t.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 shrink-0"
                        onClick={async () => {
                          const res: any = await delFn({ data: { id: t.id } });
                          if (res?.ok) { toast.success("Template deleted"); qc.invalidateQueries({ queryKey: ["am-invoice-templates"] }); }
                          else toast.error(res?.error ?? "Delete failed");
                        }}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {found.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {found.slice(0, 12).map((p) => (
                          <span key={p} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 font-mono">{p}</span>
                        ))}
                        {found.length > 12 && <span className="text-[10px] text-slate-500">+{found.length - 12} more</span>}
                      </div>
                    )}
                    {found.length > 0 && missingCore.length > 0 && (
                      <p className="mt-1 text-[11px] text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Missing recommended fields: {missingCore.map((m) => `{${m}}`).join(", ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Right: field reference */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-white">Field reference</h2>
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <Input value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} placeholder="Search fields…" className={`pl-8 h-8 text-xs ${inputCls}`} />
          </div>
        </div>
        <p className="text-xs text-slate-500">Click any tag to copy it, then paste it into your Word document. For line items, put the item tags in one table row wrapped between <code className="text-slate-400">{"{#items}"}</code> and <code className="text-slate-400">{"{/items}"}</code>.</p>
        <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
          {filteredGroups.map((g) => (
            <div key={g.group}>
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">{g.group}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {g.fields.map((f) => (
                  <button
                    key={f.tag + f.label}
                    onClick={() => copy(f.tag)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-left hover:border-slate-600 transition-colors"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[11px] text-sky-300 truncate">{f.tag}</span>
                      <span className="block text-[10px] text-slate-500 truncate">{f.label}</span>
                    </span>
                    {copied === f.tag ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <Copy className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <PdfOverlayEditor
        template={designTpl}
        open={!!designTpl}
        onClose={() => setDesignTpl(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["am-invoice-templates"] })}
      />
    </div>
  );
}
