/**
 * Webuyanyhouse — Phone Numbers
 * View, select, and configure voicemail for assigned calling numbers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Phone, Voicemail, CheckSquare, Square, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  getWbahPhoneNumbers, saveWbahPhoneNumbers, updateWbahPhoneVoicemail,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, KpiCard, WbahLoading, WbahError, WbahEmpty,
  WbahTable, WbahTr, WbahTd, safeArr,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/phone-numbers")({
  component: WbahPhoneNumbers,
});

function WbahPhoneNumbers() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [vmId, setVmId] = useState<string | null>(null);
  const [vmEnabled, setVmEnabled] = useState(false);
  const [vmMsg, setVmMsg] = useState("");

  const getFn    = useServerFn(getWbahPhoneNumbers);
  const saveFn   = useServerFn(saveWbahPhoneNumbers);
  const vmFn     = useServerFn(updateWbahPhoneVoicemail);

  const { data: raw, isLoading, error } = useQuery({
    queryKey: ["wbah-phone-numbers"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const numbers = safeArr(raw);
  const withVm  = numbers.filter((n: any) => n.voicemailEnabled || n.hasVoicemail);

  const saveMutation = useMutation({
    mutationFn: () => saveFn({ data: { phoneNumberIds: Array.from(selected) } }),
    onSuccess: () => { toast.success("Phone numbers saved"); qc.invalidateQueries({ queryKey: ["wbah-phone-numbers"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const vmMutation = useMutation({
    mutationFn: () => vmFn({ data: { id: vmId!, enabled: vmEnabled, message: vmMsg } }),
    onSuccess: () => { toast.success("Voicemail settings saved"); setVmId(null); qc.invalidateQueries({ queryKey: ["wbah-phone-numbers"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update voicemail"),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <WbahPage
      title="Phone Numbers"
      subtitle="Manage calling numbers from Retell — select, save and configure voicemail"
      actions={
        selected.size > 0 ? (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Save className="h-3 w-3" /> Save Selection ({selected.size})
          </Button>
        ) : undefined
      }
    >
      {error && <WbahError message={(error as Error).message} />}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard icon={Phone}    label="Total Numbers" value={numbers.length}  color="text-emerald-400" />
        <KpiCard icon={CheckSquare} label="Selected"  value={selected.size}   color="text-blue-400" />
        <KpiCard icon={Voicemail} label="With Voicemail" value={withVm.length} color="text-purple-400" />
      </div>

      {isLoading ? (
        <WbahLoading label="Loading phone numbers…" />
      ) : numbers.length === 0 ? (
        <WbahEmpty label="No phone numbers available from Retell" />
      ) : (
        <WbahTable headers={["", "Number", "Friendly Name", "Country", "Status", "Voicemail", ""]}>
          {numbers.map((n: any, i) => {
            const id = n._id ?? n.id ?? n.phoneNumberId ?? String(i);
            const num = n.phoneNumber ?? n.number ?? n.phone ?? "—";
            const hasVm = !!(n.voicemailEnabled || n.hasVoicemail);

            return (
              <WbahTr key={id}>
                <WbahTd className="w-10">
                  <button onClick={() => toggle(id)} className="text-gray-400 hover:text-white">
                    {selected.has(id)
                      ? <CheckSquare className="h-4 w-4 text-emerald-400" />
                      : <Square className="h-4 w-4" />}
                  </button>
                </WbahTd>
                <WbahTd>
                  <span className="font-mono font-medium text-white">{num}</span>
                </WbahTd>
                <WbahTd className="text-xs">{n.friendlyName ?? n.label ?? "—"}</WbahTd>
                <WbahTd className="text-xs">{n.country ?? n.countryCode ?? "UK"}</WbahTd>
                <WbahTd>
                  <span className={`text-xs font-medium ${n.active || n.status === "active" ? "text-emerald-400" : "text-gray-500"}`}>
                    {n.status ?? (n.active ? "active" : "available")}
                  </span>
                </WbahTd>
                <WbahTd>
                  {hasVm
                    ? <span className="text-xs text-emerald-400 flex items-center gap-1"><Voicemail className="h-3 w-3" /> On</span>
                    : <span className="text-xs text-gray-600">Off</span>}
                </WbahTd>
                <WbahTd>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 px-2 text-xs text-gray-400 hover:text-blue-400"
                    onClick={() => { setVmId(id); setVmEnabled(hasVm); setVmMsg(n.voicemailMessage ?? ""); }}
                  >
                    <Voicemail className="h-3 w-3" />
                  </Button>
                </WbahTd>
              </WbahTr>
            );
          })}
        </WbahTable>
      )}

      {/* Voicemail modal */}
      <Dialog open={!!vmId} onOpenChange={(o) => !o && setVmId(null)}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Voicemail Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-300">Enable Voicemail</label>
              <button
                onClick={() => setVmEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${vmEnabled ? "bg-emerald-600" : "bg-gray-700"}`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${vmEnabled ? "translate-x-5" : "translate-x-1"}`} />
              </button>
            </div>
            {vmEnabled && (
              <div>
                <label className="text-xs text-gray-400">Voicemail Message</label>
                <textarea
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-md text-sm text-white px-3 py-2 h-24 resize-none"
                  value={vmMsg}
                  onChange={(e) => setVmMsg(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setVmId(null)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => vmMutation.mutate()} disabled={vmMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WbahPage>
  );
}
