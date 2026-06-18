/**
 * Webuyanyhouse — Credits
 * Balance overview, monthly usage chart, Retell billing, history and allocation.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { CreditCard, TrendingUp, Coins, Zap, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  getWbahCredits, allocateWbahCredits, deleteWbahAllocation,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, WbahCard, KpiCard, WbahLoading, WbahError, WbahEmpty,
  WbahTable, WbahTr, WbahTd, safeArr, safeNum, formatDate,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/credits")({
  component: WbahCredits,
});

function WbahCredits() {
  const qc = useQueryClient();
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocForm, setAllocForm] = useState({ amount: "", description: "", userId: "" });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const getFn   = useServerFn(getWbahCredits);
  const allocFn = useServerFn(allocateWbahCredits);
  const delFn   = useServerFn(deleteWbahAllocation);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wbah-credits"],
    queryFn: () => getFn(),
    staleTime: 60_000,
  });

  const summary     = data?.summary as any;
  const history     = safeArr(data?.history);
  const monthly     = safeArr(data?.monthlyUsage);
  const retellUsage = data?.retellUsage as any;

  const allocMutation = useMutation({
    mutationFn: () => allocFn({ data: { ...allocForm, amount: parseFloat(allocForm.amount) } }),
    onSuccess: () => { toast.success("Credits allocated"); setAllocOpen(false); qc.invalidateQueries({ queryKey: ["wbah-credits"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to allocate"),
  });

  const delMutation = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Allocation deleted"); setDeleteId(null); qc.invalidateQueries({ queryKey: ["wbah-credits"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to delete"),
  });

  return (
    <WbahPage
      title="Credits"
      subtitle="Credit balance, usage breakdown and Retell billing"
      actions={
        <Button
          size="sm"
          className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs gap-1.5"
          onClick={() => setAllocOpen(true)}
        >
          <Plus className="h-3 w-3" /> Allocate Credits
        </Button>
      }
    >
      {error && <WbahError message={(error as Error).message} />}
      {isLoading && <WbahLoading label="Loading credits…" />}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard icon={CreditCard} label="Balance"    value={safeNum(summary?.balance ?? summary?.total)}    sub="credits remaining" color="text-emerald-400" />
            <KpiCard icon={Coins}      label="Allocated"  value={safeNum(summary?.allocated)}  sub="credits allocated" color="text-blue-400" />
            <KpiCard icon={TrendingUp} label="Used"       value={safeNum(summary?.used ?? summary?.consumed)}       sub="credits consumed"  color="text-yellow-400" />
            <KpiCard icon={Zap}        label="Retell Mins" value={safeNum(retellUsage?.minutes ?? retellUsage?.totalMinutes)} sub="minutes billed" color="text-purple-400" />
          </div>

          {/* Monthly usage chart */}
          {monthly.length > 0 && (
            <WbahCard className="p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Monthly Usage</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="month" tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
                    itemStyle={{ color: "#10b981" }}
                  />
                  <Bar dataKey="credits" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </WbahCard>
          )}

          {/* Retell breakdown */}
          {retellUsage && typeof retellUsage === "object" && (
            <WbahCard className="p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Retell Billing Breakdown</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(retellUsage)
                  .filter(([, v]) => typeof v === "number" || typeof v === "string")
                  .map(([k, v]) => (
                    <div key={k} className="bg-gray-800/50 rounded-lg p-2">
                      <div className="text-xs text-gray-500 capitalize">{k.replace(/([A-Z])/g, " $1")}</div>
                      <div className="text-sm font-bold text-white mt-0.5">{String(v)}</div>
                    </div>
                  ))}
              </div>
            </WbahCard>
          )}

          {/* Transaction history */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Credit History</h3>
            {history.length === 0 ? (
              <WbahEmpty label="No credit transactions recorded" />
            ) : (
              <WbahTable headers={["Date", "Type", "Amount", "Description", ""]}>
                {history.map((h: any, i) => (
                  <WbahTr key={h._id ?? h.id ?? i}>
                    <WbahTd className="text-xs">{formatDate(h.createdAt ?? h.date)}</WbahTd>
                    <WbahTd>
                      <span className={`text-xs font-medium ${h.type === "allocation" ? "text-blue-400" : h.type === "debit" ? "text-red-400" : "text-emerald-400"}`}>
                        {h.type ?? h.transactionType ?? "—"}
                      </span>
                    </WbahTd>
                    <WbahTd>
                      <span className={`font-mono text-sm ${(h.amount ?? 0) > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {(h.amount ?? 0) > 0 ? "+" : ""}{h.amount ?? "—"}
                      </span>
                    </WbahTd>
                    <WbahTd className="text-xs">{h.description ?? h.note ?? "—"}</WbahTd>
                    <WbahTd>
                      {h.deletable !== false && (
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-gray-500 hover:text-red-400"
                          onClick={() => setDeleteId(h._id ?? h.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </WbahTd>
                  </WbahTr>
                ))}
              </WbahTable>
            )}
          </div>
        </>
      )}

      {/* Allocate modal */}
      <Dialog open={allocOpen} onOpenChange={setAllocOpen}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-sm">
          <DialogHeader><DialogTitle>Allocate Credits</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-gray-400">Amount</label>
              <Input type="number" className="mt-1 bg-gray-900 border-gray-700 text-white text-sm" value={allocForm.amount}
                onChange={(e) => setAllocForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400">User ID (optional)</label>
              <Input className="mt-1 bg-gray-900 border-gray-700 text-white text-sm" value={allocForm.userId}
                onChange={(e) => setAllocForm((f) => ({ ...f, userId: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-400">Description</label>
              <Input className="mt-1 bg-gray-900 border-gray-700 text-white text-sm" value={allocForm.description}
                onChange={(e) => setAllocForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setAllocOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => allocMutation.mutate()}
              disabled={allocMutation.isPending || !allocForm.amount}>
              Allocate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="bg-gray-950 border-gray-800 text-white sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-red-400">Delete Allocation?</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-400 py-2">This credit allocation will be permanently removed.</p>
          <DialogFooter>
            <Button variant="outline" className="border-gray-700 text-gray-300" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && delMutation.mutate(deleteId)}
              disabled={delMutation.isPending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WbahPage>
  );
}
