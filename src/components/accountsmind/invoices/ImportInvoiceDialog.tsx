import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { importInvoice } from "@/lib/accountsmind/invoice-suite-extras.functions";
import { inputCls, selectCls } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

export function ImportInvoiceDialog({
  open,
  onClose,
  clients,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  clients: any[];
  onImported: () => void;
}) {
  const importFn = useServerFn(importInvoice);
  const [workspaceId, setWorkspaceId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceMonth, setInvoiceMonth] = useState(new Date().toISOString().slice(0, 7));
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [total, setTotal] = useState("");
  const [tax, setTax] = useState("");
  const [status, setStatus] = useState<"ready" | "sent" | "paid">("paid");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const totalCents = Math.round(Number(total) * 100);
      if (!(totalCents > 0)) throw new Error("Enter a total greater than zero.");
      let fileBase64: string | null = null;
      if (file) {
        if (file.size > 8 * 1024 * 1024) throw new Error("File must be under 8 MB.");
        const buf = await file.arrayBuffer();
        let bin = "";
        const bytes = new Uint8Array(buf);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
        fileBase64 = btoa(bin);
      }
      const res: any = await importFn({
        data: {
          workspaceId,
          invoiceNumber: invoiceNumber.trim(),
          invoiceMonth,
          issueDate: issueDate || null,
          dueDate: dueDate || null,
          currency: "GBP",
          totalCents,
          taxCents: Math.max(0, Math.round(Number(tax || 0) * 100)),
          status,
          notes,
          fileName: file?.name ?? null,
          fileBase64,
        },
      });
      if (!res?.ok) throw new Error(res?.error ?? "Import failed");
      return res;
    },
    onSuccess: (res: any) => {
      toast.success(`Imported invoice ${res.invoice?.invoice_number}`);
      setInvoiceNumber(""); setTotal(""); setTax(""); setNotes(""); setFile(null);
      onClose();
      onImported();
    },
    onError: (e: any) => toast.error(e?.message ?? "Import failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader><DialogTitle>Import an existing invoice</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Bring historical invoices into WEBEE so totals, VAT and client history are complete.
            Optionally attach the original PDF/DOCX.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Client</label>
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className={selectCls}>
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Invoice number</label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-2025-0042" className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Billing month</label>
              <Input type="month" value={invoiceMonth} onChange={(e) => setInvoiceMonth(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className={selectCls}>
                <option value="paid">Paid</option>
                <option value="sent">Sent (awaiting payment)</option>
                <option value="ready">Ready (not sent)</option>
              </select>
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
              <label className="text-xs text-slate-400">Total (GBP, inc. VAT)</label>
              <Input type="number" min="0.01" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} className={inputCls} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Of which VAT (optional)</label>
              <Input type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Original file (PDF or DOCX, optional)</label>
            <input
              type="file"
              accept=".pdf,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:text-white hover:file:bg-slate-600"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Notes (optional)</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button disabled={mut.isPending || !workspaceId || !invoiceNumber.trim() || !total} onClick={() => mut.mutate()} className="bg-purple-600 hover:bg-purple-500">
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Import invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
