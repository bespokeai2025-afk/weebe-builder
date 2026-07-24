import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { createCreditNote } from "@/lib/accountsmind/invoice-suite-phase3.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { inputCls, selectCls, money } from "./invoice-ui.shared";
import { Loader2, FileMinus2 } from "lucide-react";
import { toast } from "sonner";

export function CreditNoteDialog({ invoice, onClose, onDone }: {
  invoice: any | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const fn = useServerFn(createCreditNote);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"credit_note" | "write_off">("credit_note");

  const cur = invoice?.currency ?? "GBP";
  const outstanding = invoice
    ? Math.max(0, Number(invoice.total_cents ?? 0) - Number(invoice.amount_paid_cents ?? 0) - Number(invoice.credited_cents ?? 0))
    : 0;

  const mut = useMutation({
    mutationFn: async () => {
      const cents = Math.round(Number(amount) * 100);
      if (!(cents > 0)) throw new Error("Enter an amount greater than zero.");
      if (reason.trim().length < 3) throw new Error("Enter a reason — it goes on the audit trail.");
      const res: any = await fn({ data: { invoiceId: invoice.id, amountCents: cents, reason: reason.trim(), kind } });
      if (!res?.ok) throw new Error(res?.error ?? "Failed");
      return res;
    },
    onSuccess: (res: any) => {
      toast.success(`${kind === "write_off" ? "Write-off" : "Credit note"} ${res.creditNote?.credit_note_number ?? ""} issued`);
      setAmount(""); setReason(""); onDone(); onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white">
        <DialogHeader><DialogTitle>Credit note — {invoice?.invoice_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Outstanding balance: <span className="text-amber-300">{money(outstanding, cur)}</span>. The invoice itself is never altered — a numbered credit note is issued and audited.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Type</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as any)} className={selectCls}>
                <option value="credit_note">Credit note</option>
                <option value="write_off">Write-off (bad debt)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Amount ({cur})</label>
              <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Reason (required, audited)</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={inputCls} placeholder="e.g. Service credit for outage on 12 July" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()} className="bg-amber-600 hover:bg-amber-500">
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileMinus2 className="w-4 h-4" />} Issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
