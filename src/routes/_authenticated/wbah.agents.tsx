/**
 * Webuyanyhouse — Agents
 * View and configure the 3 Webuyanyhouse qualification calling agents.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Bot, Pencil, Check, X, Voicemail, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  getWbahAgents, renameWbahAgent, updateWbahAgentVoicemail,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, WbahCard, KpiCard, WbahLoading, WbahError, WbahEmpty,
  WbahTable, WbahTr, WbahTd, StatusBadge, safeArr,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/agents")({
  component: WbahAgents,
});

function WbahAgents() {
  const qc = useQueryClient();
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [voicemailId, setVoicemailId] = useState<string | null>(null);
  const [vmMsg, setVmMsg] = useState("");
  const [vmEnabled, setVmEnabled] = useState(false);

  const getFn    = useServerFn(getWbahAgents);
  const renameFn = useServerFn(renameWbahAgent);
  const vmFn     = useServerFn(updateWbahAgentVoicemail);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wbah-agents"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const agents         = safeArr(data?.agents);
  const voicemailAgents = safeArr(data?.voicemailAgents);
  const vmIds          = new Set(voicemailAgents.map((a: any) => a._id ?? a.id));

  const renameMutation = useMutation({
    mutationFn: () => renameFn({ data: { id: renameId!, name: renameVal } }),
    onSuccess: () => { toast.success("Agent renamed"); setRenameId(null); qc.invalidateQueries({ queryKey: ["wbah-agents"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to rename"),
  });

  const vmMutation = useMutation({
    mutationFn: () => vmFn({ data: { id: voicemailId!, enabled: vmEnabled, message: vmMsg } }),
    onSuccess: () => { toast.success("Voicemail settings saved"); setVoicemailId(null); qc.invalidateQueries({ queryKey: ["wbah-agents"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update voicemail"),
  });

  return (
    <WbahPage
      title="Agents"
      subtitle="Webuyanyhouse AI calling agents — configure, rename and manage voicemail"
    >
      {error && <WbahError message={(error as Error).message} />}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard icon={Bot}     label="Total Agents"     value={agents.length}         color="text-emerald-400" />
        <KpiCard icon={Volume2} label="With Voicemail"   value={voicemailAgents.length} color="text-blue-400" />
        <KpiCard icon={Check}   label="Active Agents"    value={agents.filter((a: any) => (a.status ?? "active").toLowerCase() === "active").length} color="text-purple-400" />
      </div>

      {isLoading ? (
        <WbahLoading label="Loading agents…" />
      ) : agents.length === 0 ? (
        <WbahEmpty label="No agents found — connect via admin panel" />
      ) : (
        <WbahTable headers={["Agent", "ID", "Status", "Voicemail", "Actions"]}>
          {agents.map((a: any, i) => {
            const id   = a._id ?? a.id ?? String(i);
            const name = a.name ?? a.agentName ?? `Agent ${i + 1}`;
            const hasVm = vmIds.has(id);

            return (
              <WbahTr key={id}>
                <WbahTd>
                  {renameId === id ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="h-7 text-xs bg-gray-800 border-gray-700 text-white w-36"
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && renameMutation.mutate()}
                        autoFocus
                      />
                      <button onClick={() => renameMutation.mutate()} className="text-emerald-400 hover:text-emerald-300">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setRenameId(null)} className="text-gray-500 hover:text-gray-400">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="font-medium text-white">{name}</span>
                    </div>
                  )}
                </WbahTd>
                <WbahTd className="font-mono text-xs text-gray-500">{id.slice(0, 16)}…</WbahTd>
                <WbahTd><StatusBadge status={a.status ?? "active"} /></WbahTd>
                <WbahTd>
                  {hasVm
                    ? <span className="text-emerald-400 text-xs flex items-center gap-1"><Voicemail className="h-3 w-3" /> Enabled</span>
                    : <span className="text-gray-600 text-xs">Disabled</span>}
                </WbahTd>
                <WbahTd>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 px-2 text-xs text-gray-400 hover:text-white"
                      onClick={() => { setRenameId(id); setRenameVal(name); }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 px-2 text-xs text-gray-400 hover:text-blue-400"
                      onClick={() => {
                        setVoicemailId(id);
                        setVmEnabled(hasVm);
                        setVmMsg(a.voicemailMessage ?? "");
                      }}
                    >
                      <Voicemail className="h-3 w-3" />
                    </Button>
                  </div>
                </WbahTd>
              </WbahTr>
            );
          })}
        </WbahTable>
      )}

      {/* Voicemail settings modal */}
      <Dialog open={!!voicemailId} onOpenChange={(o) => !o && setVoicemailId(null)}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Voicemail Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-300">Enable Voicemail</label>
              <button
                onClick={() => setVmEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  vmEnabled ? "bg-emerald-600" : "bg-gray-700"
                }`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${vmEnabled ? "translate-x-5" : "translate-x-1"}`} />
              </button>
            </div>
            {vmEnabled && (
              <div>
                <label className="text-xs text-gray-400">Voicemail Message</label>
                <textarea
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-md text-sm text-white px-3 py-2 h-24 resize-none"
                  placeholder="Hi, this is an AI assistant from Webuyanyhouse…"
                  value={vmMsg}
                  onChange={(e) => setVmMsg(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setVoicemailId(null)}>Cancel</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => vmMutation.mutate()}
              disabled={vmMutation.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WbahPage>
  );
}
