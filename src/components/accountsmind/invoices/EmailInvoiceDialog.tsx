import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { sendInvoiceEmail } from "@/lib/accountsmind/invoice-suite-extras.functions";
import { money, inputCls } from "./invoice-ui.shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

export function EmailInvoiceDialog({
  invoice,
  onClose,
  onSent,
}: {
  invoice: any | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const sendFn = useServerFn(sendInvoiceEmail);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (invoice) {
      setTo(invoice.last_emailed_to ?? "");
      setSubject("");
      setMessage("");
    }
  }, [invoice?.id]);

  const mut = useMutation({
    mutationFn: async () => {
      const res: any = await sendFn({ data: { invoiceId: invoice.id, to: to.trim(), subject, message } });
      if (!res?.ok) throw new Error(res?.error ?? "Send failed");
      return res;
    },
    onSuccess: () => {
      toast.success(`Invoice emailed to ${to.trim()}`);
      onClose();
      onSent();
    },
    onError: (e: any) => toast.error(e?.message ?? "Send failed"),
  });

  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white">
        <DialogHeader><DialogTitle>Email invoice — {invoice?.invoice_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Total {money(invoice?.total_cents ?? 0, invoice?.currency ?? "GBP")}. The recipient gets a secure
            download link that expires in 7 days.
            {invoice?.last_emailed_at ? ` Last emailed ${new Date(invoice.last_emailed_at).toLocaleDateString("en-GB")} to ${invoice.last_emailed_to}.` : ""}
          </p>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Recipient email</label>
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Subject (optional — auto-filled if blank)</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`Invoice ${invoice?.invoice_number ?? ""}`} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-400">Message (optional)</label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={inputCls} placeholder="Add a short note for the client…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button disabled={mut.isPending || !to.trim()} onClick={() => mut.mutate()} className="bg-sky-600 hover:bg-sky-500">
            {mut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
