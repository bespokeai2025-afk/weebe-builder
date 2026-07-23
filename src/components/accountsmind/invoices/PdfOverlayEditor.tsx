import { useServerFn } from "@tanstack/react-start";
import { getTemplateFileUrl, saveTemplateOverlayFields } from "@/lib/accountsmind/invoice-suite-phase3.functions";
import { PdfOverlayDesigner, type OverlayFieldSpec } from "@/components/documents/PdfOverlayDesigner";
import { toast } from "sonner";

const INVOICE_FIELDS: Array<{ tag: string; label: string }> = [
  { tag: "invoice_number", label: "Invoice number" },
  { tag: "invoice_date", label: "Issue date" },
  { tag: "due_date", label: "Due date" },
  { tag: "period", label: "Billing period" },
  { tag: "client_name", label: "Client name" },
  { tag: "to_address", label: "Client address" },
  { tag: "from_name", label: "Business name" },
  { tag: "from_address", label: "Business address" },
  { tag: "from_vat_number", label: "VAT number" },
  { tag: "items_table", label: "Line items block" },
  { tag: "subtotal", label: "Subtotal" },
  { tag: "tax", label: "Tax total" },
  { tag: "tax_rate", label: "Tax rate" },
  { tag: "discount", label: "Discount" },
  { tag: "total", label: "Total due" },
  { tag: "amount_paid", label: "Amount paid" },
  { tag: "balance_due", label: "Balance due" },
  { tag: "payment_details", label: "Payment details block" },
  { tag: "payment_terms", label: "Payment terms" },
  { tag: "payment_reference", label: "Payment reference" },
  { tag: "purchase_order_number", label: "PO number" },
  { tag: "client_reference", label: "Client reference" },
  { tag: "notes", label: "Notes" },
  { tag: "footer", label: "Footer" },
];

export function PdfOverlayEditor({ template, open, onClose, onSaved }: {
  template: { id: string; name: string; fields_json?: unknown } | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const urlFn = useServerFn(getTemplateFileUrl);
  const saveFn = useServerFn(saveTemplateOverlayFields);
  if (!template) return null;

  return (
    <PdfOverlayDesigner
      open={open}
      onClose={onClose}
      title={`Layout designer — ${template.name}`}
      availableFields={INVOICE_FIELDS}
      initialFields={Array.isArray(template.fields_json) ? (template.fields_json as OverlayFieldSpec[]) : []}
      loadPdfUrl={async () => {
        const res: any = await urlFn({ data: { templateId: template.id } });
        if (!res?.ok) throw new Error(res?.error ?? "Could not load template file");
        return res.url as string;
      }}
      onSave={async (fields) => {
        const res: any = await saveFn({ data: { templateId: template.id, fields } });
        if (res?.ok) { toast.success("Layout saved"); onSaved(); return true; }
        toast.error(res?.error ?? "Save failed");
        return false;
      }}
    />
  );
}
