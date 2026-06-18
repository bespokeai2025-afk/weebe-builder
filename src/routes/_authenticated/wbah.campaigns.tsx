/**
 * Webuyanyhouse — Campaigns
 * Create, manage, pause/resume calling campaigns for lead buckets.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Megaphone, Plus, Pause, Play, Trash2, Settings, Voicemail,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  getWbahCampaigns, createWbahCampaign, pauseWbahCampaign,
  resumeWbahCampaign, deleteWbahCampaign, updateWbahCampaign,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, WbahCard, WbahLoading, WbahError, WbahEmpty,
  StatusBadge, safeArr,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/campaigns")({
  component: WbahCampaigns,
});

const LEAD_BUCKETS = [
  "New Leads", "Tried To Contact", "Disqualified Leads", "Positive / Neutral", "Callback Queue",
];

const BLANK = {
  name: "", description: "", bucket: LEAD_BUCKETS[0], agentId: "", callsPerDay: "50",
};

function WbahCampaigns() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);

  const getFn    = useServerFn(getWbahCampaigns);
  const createFn = useServerFn(createWbahCampaign);
  const pauseFn  = useServerFn(pauseWbahCampaign);
  const resumeFn = useServerFn(resumeWbahCampaign);
  const delFn    = useServerFn(deleteWbahCampaign);

  const { data: raw, isLoading, error } = useQuery({
    queryKey: ["wbah-campaigns"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const campaigns = safeArr(raw);

  const createMutation = useMutation({
    mutationFn: () => createFn({ data: { ...form } }),
    onSuccess: () => { toast.success("Campaign created"); setCreateOpen(false); setForm(BLANK); qc.invalidateQueries({ queryKey: ["wbah-campaigns"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create"),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseFn({ data: { id } }),
    onSuccess: () => { toast.success("Campaign paused"); qc.invalidateQueries({ queryKey: ["wbah-campaigns"] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeFn({ data: { id } }),
    onSuccess: () => { toast.success("Campaign resumed"); qc.invalidateQueries({ queryKey: ["wbah-campaigns"] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Campaign deleted"); setDeleteId(null); qc.invalidateQueries({ queryKey: ["wbah-campaigns"] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  return (
    <WbahPage
      title="Campaigns"
      subtitle="Outbound calling campaigns targeting Webuyanyhouse lead buckets"
      actions={
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-3 w-3" /> Create Campaign
        </Button>
      }
    >
      {error && <WbahError message={(error as Error).message} />}

      {isLoading ? (
        <WbahLoading label="Loading campaigns…" />
      ) : campaigns.length === 0 ? (
        <WbahEmpty label="No campaigns yet — create one to start dialling" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaigns.map((c: any, i) => {
            const id     = c._id ?? c.id ?? String(i);
            const name   = c.name ?? c.campaignName ?? `Campaign ${i + 1}`;
            const status = (c.status ?? c.campaignStatus ?? "").toLowerCase();
            const isPaused = status === "paused";
            const bucket = c.bucket ?? c.leadBucket ?? c.segment ?? "—";

            return (
              <WbahCard key={id} className="p-5 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="font-semibold text-white truncate">{name}</span>
                  </div>
                  <StatusBadge status={c.status ?? "active"} />
                </div>

                {/* Meta */}
                <div className="space-y-1 text-xs text-gray-400">
                  <div><span className="text-gray-600">Bucket:</span> {bucket}</div>
                  {c.description && <div><span className="text-gray-600">Desc:</span> {c.description}</div>}
                  {c.agentId && <div><span className="text-gray-600">Agent ID:</span> {c.agentId}</div>}
                  {c.callsPerDay && <div><span className="text-gray-600">Calls/day:</span> {c.callsPerDay}</div>}
                  {c.totalLeads !== undefined && <div><span className="text-gray-600">Total leads:</span> {c.totalLeads}</div>}
                </div>

                {/* Stats */}
                {(c.called !== undefined || c.answered !== undefined) && (
                  <div className="grid grid-cols-3 gap-2 bg-gray-800/50 rounded-lg p-2">
                    {[["Called", c.called], ["Answered", c.answered], ["Failed", c.failed]].map(([k, v]) => (
                      <div key={k as string} className="text-center">
                        <div className="text-xs font-bold text-white">{v ?? "—"}</div>
                        <div className="text-[10px] text-gray-500">{k}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1">
                  {isPaused ? (
                    <Button
                      size="sm" variant="outline"
                      className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 h-7 text-xs gap-1 flex-1"
                      onClick={() => resumeMutation.mutate(id)}
                      disabled={resumeMutation.isPending}
                    >
                      <Play className="h-3 w-3" /> Resume
                    </Button>
                  ) : (
                    <Button
                      size="sm" variant="outline"
                      className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 h-7 text-xs gap-1 flex-1"
                      onClick={() => pauseMutation.mutate(id)}
                      disabled={pauseMutation.isPending}
                    >
                      <Pause className="h-3 w-3" /> Pause
                    </Button>
                  )}
                  <Button
                    size="sm" variant="outline"
                    className="border-gray-700 text-gray-400 hover:bg-gray-800 h-7 text-xs gap-1"
                    onClick={() => setDeleteId(id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </WbahCard>
            );
          })}
        </div>
      )}

      {/* Create Campaign modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-gray-400">Campaign Name *</label>
              <Input
                className="mt-1 bg-gray-900 border-gray-700 text-white text-sm"
                placeholder="e.g. New Leads Jan 2026"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Lead Bucket</label>
              <select
                className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-md text-sm text-white px-3 py-2"
                value={form.bucket}
                onChange={(e) => setForm((f) => ({ ...f, bucket: e.target.value }))}
              >
                {LEAD_BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400">Description</label>
              <Input
                className="mt-1 bg-gray-900 border-gray-700 text-white text-sm"
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Agent ID</label>
              <Input
                className="mt-1 bg-gray-900 border-gray-700 text-white text-sm"
                placeholder="WeeBespoke agent ID"
                value={form.agentId}
                onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Calls Per Day</label>
              <Input
                type="number"
                className="mt-1 bg-gray-900 border-gray-700 text-white text-sm"
                value={form.callsPerDay}
                onChange={(e) => setForm((f) => ({ ...f, callsPerDay: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !form.name}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete Campaign?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-400 py-2">This campaign will be permanently removed.</p>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WbahPage>
  );
}
