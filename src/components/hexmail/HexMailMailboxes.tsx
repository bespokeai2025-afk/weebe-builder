import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSenderDomains, getMailboxes, addMailbox, updateMailbox, deleteMailbox } from "@/lib/hexmail/deliverability.server";

const STATUS_STYLES: Record<string, string> = {
  pending:   "border-white/10 text-muted-foreground/50",
  warming:   "border-amber-500/20 text-amber-400",
  active:    "border-emerald-500/20 text-emerald-400",
  paused:    "border-white/10 text-muted-foreground/40",
  suspended: "border-red-500/20 text-red-400",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "active")  return <CheckCircle  className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === "warming") return <Flame         className="h-3.5 w-3.5 text-amber-400" />;
  if (status === "suspended" || status === "paused") return <XCircle className="h-3.5 w-3.5 text-red-400" />;
  return <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground/40" />;
}

export function HexMailMailboxes() {
  const [showAdd, setShowAdd]     = useState(false);
  const [domainId, setDomainId]   = useState("");
  const [email, setEmail]         = useState("");
  const [limit, setLimit]         = useState(50);
  const [editId, setEditId]       = useState<string | null>(null);
  const [editLimit, setEditLimit] = useState(50);
  const qc = useQueryClient();

  const getDomainsFn  = useServerFn(getSenderDomains);
  const getMailFn     = useServerFn(getMailboxes);
  const addMailFn     = useServerFn(addMailbox);
  const updateMailFn  = useServerFn(updateMailbox);
  const deleteMailFn  = useServerFn(deleteMailbox);

  const { data: domains = [] } = useQuery({ queryKey: ["sender-domains"], queryFn: () => getDomainsFn() ,
    throwOnError: false,
  });
  const { data: mailboxes = [], isLoading } = useQuery({ queryKey: ["mailboxes"], queryFn: () => getMailFn() ,
    throwOnError: false,
  });

  const addMut = useMutation({
    mutationFn: () => addMailFn({ data: { domainId, emailAddress: email, dailySendLimit: limit } }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["mailboxes"] }); setShowAdd(false); setEmail(""); },
  });

  const updateMut = useMutation({
    mutationFn: (vars: { mailboxId: string; status?: string; dailySendLimit?: number }) =>
      updateMailFn({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mailboxes"] }); setEditId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (mailboxId: string) => deleteMailFn({ data: { mailboxId } }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["mailboxes"] }),
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mailboxes</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage sending mailboxes, daily send limits, and warmup stages.</p>
        </div>
        <Button onClick={() => setShowAdd(v => !v)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Add Mailbox
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Add Mailbox</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Sender Domain *</Label>
              <select value={domainId} onChange={(e) => setDomainId(e.target.value)}
                className="w-full h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-foreground">
                <option value="">Select domain…</option>
                {domains.map((d: any) => <option key={d.id} value={d.id}>{d.domain}</option>)}
              </select>
            </div>
            <div className="sm:col-span-1">
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Email Address *</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="hello@yourdomain.com" className="bg-white/[0.03] border-white/[0.08]" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Daily Send Limit</Label>
              <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} min={1} max={10000}
                className="bg-white/[0.03] border-white/[0.08]" />
            </div>
          </div>
          {addMut.error && <p className="text-xs text-red-400">{(addMut.error as any).message}</p>}
          <div className="flex gap-2">
            <Button onClick={() => addMut.mutate()} disabled={!domainId || !email || addMut.isPending} size="sm">
              {addMut.isPending ? "Adding…" : "Add Mailbox"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />)}
        </div>
      ) : mailboxes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.10] p-10 text-center flex flex-col items-center gap-2">
          <Inbox className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium">No mailboxes configured</p>
          <p className="text-xs text-muted-foreground/50">Add a mailbox to manage daily send limits and warmup.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
          <div className="grid grid-cols-12 px-4 py-2 text-[10px] text-muted-foreground/40 uppercase tracking-widest">
            <span className="col-span-4">Email</span>
            <span className="col-span-2">Status</span>
            <span className="col-span-2 text-right">Sends Today</span>
            <span className="col-span-2 text-right">Daily Limit</span>
            <span className="col-span-2 text-right">Warmup Stage</span>
          </div>
          {mailboxes.map((m: any) => (
            <div key={m.id} className="group">
              <div className="grid grid-cols-12 px-4 py-3 items-center text-sm">
                <div className="col-span-4 flex items-center gap-2 min-w-0">
                  <Inbox className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                  <span className="truncate text-xs">{m.email_address}</span>
                </div>
                <div className="col-span-2">
                  <span className={cn("inline-flex items-center gap-1 text-[10px] border rounded-full px-2 py-0.5 capitalize", STATUS_STYLES[m.status] ?? STATUS_STYLES.pending)}>
                    <StatusIcon status={m.status} /> {m.status}
                  </span>
                </div>
                <div className="col-span-2 text-right text-xs tabular-nums">
                  <span className={cn(m.sends_today >= m.daily_send_limit * 0.9 ? "text-amber-400 font-medium" : "text-muted-foreground/70")}>
                    {m.sends_today}
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  {editId === m.id ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input type="number" value={editLimit} onChange={(e) => setEditLimit(Number(e.target.value))}
                        className="w-20 h-6 text-xs text-right bg-white/[0.03] border-white/[0.08]" />
                      <Button size="sm" className="h-6 px-2 text-[10px]"
                        onClick={() => updateMut.mutate({ mailboxId: m.id, dailySendLimit: editLimit })}>
                        Save
                      </Button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditId(m.id); setEditLimit(m.daily_send_limit); }}
                      className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors tabular-nums">
                      {m.daily_send_limit}
                    </button>
                  )}
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2">
                  <span className="text-xs text-muted-foreground/50 tabular-nums">{m.warmup_stage}/10</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <select value={m.status} onChange={(e) => updateMut.mutate({ mailboxId: m.id, status: e.target.value })}
                      className="h-6 text-[10px] rounded border border-white/[0.08] bg-white/[0.03] px-1">
                      {["pending","warming","active","paused","suspended"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                    <button onClick={() => { if (confirm("Delete mailbox?")) deleteMut.mutate(m.id); }}
                      className="rounded p-1 hover:text-red-400 text-muted-foreground/30 transition-colors">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Safety rule reminder */}
      <div className="rounded-xl border border-white/[0.06] bg-amber-500/[0.03] p-4 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 text-amber-400/70 shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground/60 leading-relaxed">
          <strong className="text-foreground/70">Safety rules:</strong> Campaigns are blocked if a mailbox exceeds its daily limit, is paused or suspended,
          or if the sender domain fails SPF/DKIM checks. Only send to opted-in contacts.
        </div>
      </div>
    </div>
  );
}
