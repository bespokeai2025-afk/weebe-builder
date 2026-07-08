import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Phone,
  Plus,
  Trash2,
  RefreshCw,
  Check,
  Mic,
  MessageSquare,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import {
  listPhoneNumbers,
  savePhoneNumber,
  deletePhoneNumber,
} from "@/lib/telephony/telephony.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/phone-numbers")({
  head: () => ({ meta: [{ title: "Phone Numbers — Webee" }] }),
  component: PhoneNumbersPage,
});

function badge(text: string, cls: string) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {text}
    </span>
  );
}

function PhoneNumbersPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPhoneNumbers);
  const saveFn = useServerFn(savePhoneNumber);
  const deleteFn = useServerFn(deletePhoneNumber);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: numbers = [], isFetching, refetch } = useQuery({
    queryKey: ["phone-numbers"],
    queryFn: () => listFn({}),
    throwOnError: false,
  });
  const numbersPag = useTablePagination(numbers);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-list"],
    queryFn: async () => {
      const { data } = await supabase.from("agents").select("id, name").order("name");
      return data ?? [];
    },
    throwOnError: false,
  });

  const saveMut = useMutation({
    mutationFn: (v: Parameters<typeof saveFn>[0]["data"]) => saveFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["phone-numbers"] }); setShowAdd(false); setEditId(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["phone-numbers"] }); setDeleting(null); },
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Phone Numbers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage inbound numbers and their agent assignments.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add Number
          </Button>
        </div>
      </div>

      {(showAdd || editId) && (
        <AddNumberDialog
          existing={editId ? numbers.find((n: any) => n.id === editId) : undefined}
          agents={agents}
          onSave={(v) => saveMut.mutate(v as any)}
          onClose={() => { setShowAdd(false); setEditId(null); }}
          saving={saveMut.isPending}
        />
      )}

      {numbers.length === 0 && !isFetching ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <Phone className="h-10 w-10 opacity-30" />
          <p className="text-sm">No phone numbers yet.</p>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" /> Add your first number
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Number</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Friendly Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Capabilities</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Assigned Agent</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {numbersPag.sliced.map((n: any) => (
                <tr key={n.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono">{n.phone_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{n.friendly_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {n.capabilities?.voice && <span title="Voice" className="flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"><Mic className="h-3 w-3" /> Voice</span>}
                      {n.capabilities?.sms && <span title="SMS" className="flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"><MessageSquare className="h-3 w-3" /> SMS</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {n.agent ? (
                      <span className="flex items-center gap-1"><User className="h-3.5 w-3.5 text-muted-foreground" />{n.agent.name}</span>
                    ) : (
                      <span className="text-muted-foreground italic">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {n.is_active
                      ? badge("Active", "bg-emerald-500/15 text-emerald-400")
                      : badge("Inactive", "bg-muted text-muted-foreground")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditId(n.id)}>
                        Edit
                      </Button>
                      {deleting === n.id ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" onClick={() => deleteMut.mutate(n.id)} disabled={deleteMut.isPending}>
                            {deleteMut.isPending ? "…" : "Confirm"}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(n.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagBar {...numbersPag} />
        </div>
      )}
    </div>
  );
}

function AddNumberDialog({
  existing,
  agents,
  onSave,
  onClose,
  saving,
}: {
  existing?: any;
  agents: any[];
  onSave: (v: any) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [phone, setPhone] = useState(existing?.phone_number ?? "");
  const [friendly, setFriendly] = useState(existing?.friendly_name ?? "");
  const [agentId, setAgentId] = useState(existing?.agent_id ?? "");
  const [provider, setProvider] = useState<"twilio" | "frejun">(existing?.provider ?? "twilio");
  const [voice, setVoice] = useState(existing?.capabilities?.voice ?? true);
  const [sms, setSms] = useState(existing?.capabilities?.sms ?? false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      ...(existing?.id ? { id: existing.id } : {}),
      phone_number: phone.trim(),
      friendly_name: friendly.trim() || undefined,
      provider,
      agent_id: agentId || null,
      capabilities: { voice, sms },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <h2 className="mb-4 text-base font-semibold">{existing ? "Edit Number" : "Add Phone Number"}</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">E.164 Number *</label>
            <input
              required
              disabled={!!existing}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+14155552671"
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Friendly Name</label>
            <input
              value={friendly}
              onChange={e => setFriendly(e.target.value)}
              placeholder="Sales Hotline"
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Assign Agent</label>
            <select
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">— None —</option>
              {agents.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Provider</label>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value as "twilio" | "frejun")}
              disabled={!!existing}
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              <option value="twilio">Twilio</option>
              <option value="frejun">FreJun Teler</option>
            </select>
            {provider === "frejun" && !existing && (
              <p className="mt-1 text-xs text-muted-foreground">
                Purchase numbers in your{" "}
                <a href="https://app.frejun.ai" target="_blank" rel="noreferrer" className="underline">FreJun dashboard</a>,
                assign them to a Voice App there, then enter the number above.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Capabilities</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={voice} onChange={e => setVoice(e.target.checked)} className="rounded" />
                <span className="text-sm">Voice</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sms} onChange={e => setSms(e.target.checked)} className="rounded" />
                <span className="text-sm">SMS</span>
              </label>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !phone.trim()}>
            {saving ? "Saving…" : existing ? "Save Changes" : "Add Number"}
          </Button>
        </div>
      </form>
    </div>
  );
}
