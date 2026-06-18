import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  listAccountsClients,
  upsertBillingProfile,
  getBillingProfile,
} from "@/lib/accountsmind/accountsmind.functions";
import { getWebespokeEnterpriseStatus } from "@/lib/integrations/webespokeEnterprise/enterprise.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Users, Settings, ChevronRight, RefreshCw, PoundSterling, Building2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface BillingForm {
  monthlyChargeCents: number;
  currency: string;
  billingCycle: string;
  includedMinutes: number;
  includedMessages: number;
  includedVideoSeconds: number;
  includedEmailSends: number;
  includedStorageMb: number;
  contractStartDate: string;
  contractEndDate: string;
  status: string;
  notes: string;
}

const DEFAULTS: BillingForm = {
  monthlyChargeCents: 0,
  currency: "GBP",
  billingCycle: "monthly",
  includedMinutes: 0,
  includedMessages: 0,
  includedVideoSeconds: 0,
  includedEmailSends: 0,
  includedStorageMb: 0,
  contractStartDate: "",
  contractEndDate: "",
  status: "active",
  notes: "",
};

export function AccountsMindClients() {
  const listFn    = useServerFn(listAccountsClients);
  const getProfileFn = useServerFn(getBillingProfile);
  const upsertFn  = useServerFn(upsertBillingProfile);
  const qc        = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<BillingForm>(DEFAULTS);
  const [saving, setSaving]       = useState(false);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["accountsmind-clients"],
    queryFn:  () => listFn(),
  });

  const openEdit = async (workspaceId: string) => {
    const profile = await getProfileFn({ data: { workspaceId } });
    if (profile) {
      setForm({
        monthlyChargeCents:   profile.monthly_charge_cents ?? 0,
        currency:             profile.currency ?? "GBP",
        billingCycle:         profile.billing_cycle ?? "monthly",
        includedMinutes:      profile.included_minutes ?? 0,
        includedMessages:     profile.included_messages ?? 0,
        includedVideoSeconds: profile.included_video_seconds ?? 0,
        includedEmailSends:   profile.included_email_sends ?? 0,
        includedStorageMb:    profile.included_storage_mb ?? 0,
        contractStartDate:    profile.contract_start_date ?? "",
        contractEndDate:      profile.contract_end_date ?? "",
        status:               profile.status ?? "active",
        notes:                profile.notes ?? "",
      });
    } else {
      setForm(DEFAULTS);
    }
    setEditingId(workspaceId);
  };

  const save = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await upsertFn({
        data: {
          workspaceId:          editingId,
          monthlyChargeCents:   form.monthlyChargeCents,
          currency:             form.currency,
          billingCycle:         form.billingCycle,
          includedMinutes:      form.includedMinutes,
          includedMessages:     form.includedMessages,
          includedVideoSeconds: form.includedVideoSeconds,
          includedEmailSends:   form.includedEmailSends,
          includedStorageMb:    form.includedStorageMb,
          overageRates:         {},
          contractStartDate:    form.contractStartDate || null,
          contractEndDate:      form.contractEndDate   || null,
          status:               form.status,
          notes:                form.notes,
        },
      });
      qc.invalidateQueries({ queryKey: ["accountsmind-clients"] });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const field = <K extends keyof BillingForm>(key: K, val: BillingForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const getWbsStatusFn = useServerFn(getWebespokeEnterpriseStatus);
  const wbsStatusQ = useQuery({
    queryKey: ["wbs-enterprise-status"],
    queryFn: () => getWbsStatusFn(),
    refetchInterval: 60_000,
  });
  const wbsConnected = wbsStatusQ.data?.status === "connected";
  const wbs = wbsStatusQ.data;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" /> Clients
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Active clients and enterprise integrations</p>
        </div>
      </div>

      {/* ── Enterprise Clients section ── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Enterprise Clients</p>
        <Link to="/admin/accounts/clients/webuyanyhouse" className="block group">
          <div className="bg-gray-900 border border-gray-800 group-hover:border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-4 transition-colors">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <Building2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-white">Webuyanyhouse</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Enterprise</span>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium",
                  wbsConnected ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-800 text-gray-500",
                )}>
                  {wbsConnected ? "● Connected" : "○ Disconnected"}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">Real estate client · Microsoft Dynamics AI calling · WeeBee Enterprise</p>
            </div>
            {wbsConnected && wbs && (
              <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500 shrink-0">
                <span className="flex items-center gap-1 gap-1" title="Properties"><Building2 className="w-3 h-3" />{wbs.carsCount}</span>
                <span className="flex items-center gap-1" title="Buyers"><Users className="w-3 h-3" />{wbs.buyersCount}</span>
                <span className="flex items-center gap-1" title="Agents"><UserCheck className="w-3 h-3" />{wbs.dealersCount}</span>
              </div>
            )}
            <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
          </div>
        </Link>
      </div>

      {/* ── Platform Workspace Clients ── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">Platform Workspaces</p>

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading clients…
          </div>
        )}

        <div className="space-y-2">
          {(clients as any[]).map((c: any) => {
          const profile = c.billing_profile;
          const hasProfile = !!profile;
          return (
            <div
              key={c.id}
              className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{c.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Created {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>

              {hasProfile ? (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-emerald-400">
                      {profile.currency === "GBP" ? "£" : "$"}
                      {(profile.monthly_charge_cents / 100).toFixed(2)}/mo
                    </div>
                    <Badge
                      className={cn(
                        "text-[10px]",
                        profile.status === "active"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-gray-700 text-gray-400",
                      )}
                    >
                      {profile.status}
                    </Badge>
                  </div>
                </div>
              ) : (
                <span className="text-xs text-gray-500">No billing profile</span>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEdit(c.id)}
                  className="border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 text-xs gap-1"
                >
                  <Settings className="w-3 h-3" />
                  {hasProfile ? "Edit" : "Set Up"}
                </Button>
                <Link
                  to="/admin/accounts/workspace/$id"
                  params={{ id: c.id }}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingId} onOpenChange={(o) => !o && setEditingId(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PoundSterling className="w-4 h-4 text-emerald-400" />
              Billing Profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400">Monthly Charge (pence)</Label>
                <Input
                  type="number"
                  value={form.monthlyChargeCents}
                  onChange={(e) => field("monthlyChargeCents", Number(e.target.value))}
                  className="mt-1 bg-gray-800 border-gray-700 text-white"
                  placeholder="e.g. 50000 = £500"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  = {form.currency === "GBP" ? "£" : "$"}{(form.monthlyChargeCents / 100).toFixed(2)}
                </p>
              </div>
              <div>
                <Label className="text-xs text-gray-400">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => field("currency", v)}>
                  <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="GBP">GBP (£)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                    <SelectItem value="EUR">EUR (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400">Included Minutes</Label>
                <Input type="number" value={form.includedMinutes} onChange={(e) => field("includedMinutes", Number(e.target.value))} className="mt-1 bg-gray-800 border-gray-700 text-white" />
              </div>
              <div>
                <Label className="text-xs text-gray-400">Included Messages</Label>
                <Input type="number" value={form.includedMessages} onChange={(e) => field("includedMessages", Number(e.target.value))} className="mt-1 bg-gray-800 border-gray-700 text-white" />
              </div>
              <div>
                <Label className="text-xs text-gray-400">Included Email Sends</Label>
                <Input type="number" value={form.includedEmailSends} onChange={(e) => field("includedEmailSends", Number(e.target.value))} className="mt-1 bg-gray-800 border-gray-700 text-white" />
              </div>
              <div>
                <Label className="text-xs text-gray-400">Included Video Seconds</Label>
                <Input type="number" value={form.includedVideoSeconds} onChange={(e) => field("includedVideoSeconds", Number(e.target.value))} className="mt-1 bg-gray-800 border-gray-700 text-white" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400">Contract Start</Label>
                <Input type="date" value={form.contractStartDate} onChange={(e) => field("contractStartDate", e.target.value)} className="mt-1 bg-gray-800 border-gray-700 text-white" />
              </div>
              <div>
                <Label className="text-xs text-gray-400">Contract End</Label>
                <Input type="date" value={form.contractEndDate} onChange={(e) => field("contractEndDate", e.target.value)} className="mt-1 bg-gray-800 border-gray-700 text-white" />
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-400">Status</Label>
              <Select value={form.status} onValueChange={(v) => field("status", v)}>
                <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="churned">Churned</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-gray-400">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => field("notes", e.target.value)} className="mt-1 bg-gray-800 border-gray-700 text-white text-sm" rows={2} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingId(null)} className="border-gray-700 text-gray-300">
                Cancel
              </Button>
              <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                {saving ? "Saving…" : "Save Profile"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
