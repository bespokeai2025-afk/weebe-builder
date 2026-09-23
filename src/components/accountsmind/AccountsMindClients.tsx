import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  listAccountsClients,
  upsertBillingProfile,
  getBillingProfile,
  setClientIndustry,
} from "@/lib/accountsmind/accountsmind.functions";
import { listIndustryOptions, industryLabel } from "@/lib/accountsmind/industry-presets.shared";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Users, Settings, ChevronRight, RefreshCw, PoundSterling,
  Building2, UserCheck, ExternalLink, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const billingSchema = z.object({
  monthlyChargeCents: z.coerce.number().int().min(0, "Must be a positive amount"),
  currency: z.string().min(1, "Select a currency"),
  billingCycle: z.string().min(1),
  includedMinutes: z.coerce.number().int().min(0, "Must be ≥ 0"),
  includedMessages: z.coerce.number().int().min(0, "Must be ≥ 0"),
  includedVideoSeconds: z.coerce.number().int().min(0, "Must be ≥ 0"),
  includedEmailSends: z.coerce.number().int().min(0, "Must be ≥ 0"),
  includedStorageMb: z.coerce.number().int().min(0, "Must be ≥ 0"),
  contractStartDate: z.string(),
  contractEndDate: z.string(),
  status: z.string().min(1, "Select a status"),
  notes: z.string(),
  billingAddress: z.string(),
});
type BillingForm = z.infer<typeof billingSchema>;

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
  billingAddress: "",
};

export function AccountsMindClients() {
  const listFn       = useServerFn(listAccountsClients);
  const getProfileFn = useServerFn(getBillingProfile);
  const upsertFn     = useServerFn(upsertBillingProfile);
  const qc           = useQueryClient();

  const setIndustryFn = useServerFn(setClientIndustry);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const form = useForm<BillingForm>({
    resolver: zodResolver(billingSchema),
    defaultValues: DEFAULTS,
  });

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["accountsmind-clients"],
    queryFn:  () => listFn(),
    throwOnError: false,
  });

  const industryOptions = listIndustryOptions();
  const visibleClients = (clients as any[]).filter((c) =>
    industryFilter === "all"
      ? true
      : industryFilter === "unset"
        ? !c.industry
        : c.industry === industryFilter,
  );

  const changeIndustry = async (workspaceId: string, industryKey: string) => {
    try {
      await setIndustryFn({ data: { workspaceId, industryKey } });
      qc.invalidateQueries({ queryKey: ["accountsmind-clients"] });
      toast.success("Client industry updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update industry");
    }
  };

  const openEdit = async (workspaceId: string) => {
    const profile = await getProfileFn({ data: { workspaceId } });
    if (profile) {
      form.reset({
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
        billingAddress:       profile.billing_address ?? "",
      });
    } else {
      form.reset(DEFAULTS);
    }
    setEditingId(workspaceId);
  };

  const closeDialog = () => {
    setEditingId(null);
    form.reset(DEFAULTS);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (!editingId) return;
    setSaving(true);
    try {
      await upsertFn({
        data: {
          workspaceId:          editingId,
          monthlyChargeCents:   values.monthlyChargeCents,
          currency:             values.currency,
          billingCycle:         values.billingCycle,
          includedMinutes:      values.includedMinutes,
          includedMessages:     values.includedMessages,
          includedVideoSeconds: values.includedVideoSeconds,
          includedEmailSends:   values.includedEmailSends,
          includedStorageMb:    values.includedStorageMb,
          overageRates:         {},
          contractStartDate:    values.contractStartDate || null,
          contractEndDate:      values.contractEndDate   || null,
          status:               values.status,
          notes:                values.notes,
          billingAddress:       values.billingAddress,
        },
      });
      qc.invalidateQueries({ queryKey: ["accountsmind-clients"] });
      setEditingId(null);
      toast.success("Billing profile saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  });

  const getWbsStatusFn = useServerFn(getWebespokeEnterpriseStatus);
  const wbsStatusQ = useQuery({
    queryKey: ["wbs-enterprise-status"],
    queryFn: () => getWbsStatusFn(),
    refetchInterval: 60_000,
    throwOnError: false,
  });
  const wbsConnected = wbsStatusQ.data?.status === "connected";
  const wbs = wbsStatusQ.data;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" /> Clients
          </h1>
          <p className="text-sm text-muted-foreground dark:text-gray-400 mt-0.5">Billing profiles and commercial management</p>
        </div>
        <Link
          to="/systemmind/clients/setup"
          className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 border border-sky-500/30 rounded-lg px-3 py-1.5 transition-colors"
        >
          Workspace Setup <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* ── Operational Setup Notice ── */}
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] px-4 py-3 flex items-start gap-3">
        <ExternalLink className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-sky-300">Workspace Setup moved to SystemMind → Clients</p>
          <p className="text-xs text-muted-foreground dark:text-gray-400 mt-0.5">
            Module activation, plan tier assignment, workspace creation, and the API Probe tool are now in{" "}
            <Link to="/systemmind/clients/setup" className="text-sky-400 hover:underline">SystemMind → Workspace Setup</Link>.
            This page retains billing profiles and commercial management only.
          </p>
        </div>
      </div>

      {/* ── Enterprise Clients section ── */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 dark:text-gray-600 mb-2">Enterprise Clients</p>
        <Link to="/admin/accounts/clients/webuyanyhouse" className="block group">
          <div className="bg-card border border-border dark:bg-gray-900 dark:border-gray-800 group-hover:border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-4 transition-colors">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 shrink-0">
              <Building2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground dark:text-white">Webuyanyhouse</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">Enterprise</span>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium",
                  wbsConnected ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground dark:bg-gray-800 dark:text-gray-500",
                )}>
                  {wbsConnected ? "● Connected" : "○ Disconnected"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground dark:text-gray-500 mt-0.5">Real estate client · Microsoft Dynamics AI calling · WeeBee Enterprise</p>
            </div>
            {wbsConnected && wbs && (
              <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground dark:text-gray-500 shrink-0">
                <span className="flex items-center gap-1" title="Properties"><Building2 className="w-3 h-3" />{wbs.carsCount}</span>
                <span className="flex items-center gap-1" title="Buyers"><Users className="w-3 h-3" />{wbs.buyersCount}</span>
                <span className="flex items-center gap-1" title="Agents"><UserCheck className="w-3 h-3" />{wbs.dealersCount}</span>
              </div>
            )}
            <ChevronRight className="w-4 h-4 text-muted-foreground/70 group-hover:text-muted-foreground dark:text-gray-600 dark:group-hover:text-gray-400 transition-colors shrink-0" />
          </div>
        </Link>
      </div>

      {/* ── Billing Profiles ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 dark:text-gray-600">Billing Profiles</p>
          <Select value={industryFilter} onValueChange={setIndustryFilter}>
            <SelectTrigger className="w-56 h-8 bg-card border-border text-foreground/80 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 text-xs">
              <SelectValue placeholder="Filter by industry" />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border dark:bg-gray-800 dark:border-gray-700">
              <SelectItem value="all">All industries</SelectItem>
              <SelectItem value="unset">No industry set</SelectItem>
              {industryOptions.map((o) => (
                <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground dark:text-gray-400 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading clients…
          </div>
        )}

        <div className="space-y-2">
          {visibleClients.map((c: any) => {
            const profile = c.billing_profile;
            const hasProfile = !!profile;
            return (
              <div
                key={c.id}
                className="bg-card border border-border dark:bg-gray-900 dark:border-gray-800 rounded-xl px-4 py-3 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground dark:text-white">{c.name}</span>
                    {c.industry && industryLabel(c.industry) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-medium">
                        {industryLabel(c.industry)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground dark:text-gray-500 mt-0.5">
                    Created {new Date(c.created_at).toLocaleDateString()}
                  </div>
                </div>

                <Select
                  value={c.industry ?? ""}
                  onValueChange={(v) => changeIndustry(c.id, v)}
                >
                  <SelectTrigger className="hidden md:flex w-48 h-8 bg-muted border-border text-foreground/80 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 text-xs shrink-0">
                    <SelectValue placeholder="Set industry…" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border dark:bg-gray-800 dark:border-gray-700">
                    {industryOptions.map((o) => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

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
                            : "bg-muted text-muted-foreground dark:bg-gray-700 dark:text-gray-400",
                        )}
                      >
                        {profile.status}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground dark:text-gray-500">No billing profile</span>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEdit(c.id)}
                    className="border-border text-foreground/80 hover:text-foreground hover:border-foreground/40 dark:border-gray-700 dark:text-gray-300 dark:hover:text-white dark:hover:border-gray-500 text-xs gap-1"
                  >
                    <Settings className="w-3 h-3" />
                    {hasProfile ? "Edit Billing" : "Set Billing"}
                  </Button>
                  <Link
                    to="/admin/accounts/workspace/$id"
                    params={{ id: c.id }}
                    className="text-muted-foreground hover:text-foreground dark:text-gray-400 dark:hover:text-white transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            );
          })}

          {!isLoading && (clients as any[]).length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground dark:text-gray-500">
              <Users className="mx-auto w-8 h-8 mb-2 opacity-20" />
              No clients yet. Workspace setup is managed in{" "}
              <Link to="/systemmind/clients/setup" className="text-sky-400 hover:underline">SystemMind → Workspace Setup</Link>.
            </div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingId} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="bg-card border-border text-foreground dark:bg-gray-900 dark:border-gray-700 dark:text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PoundSterling className="w-4 h-4 text-emerald-400" />
              Billing Profile
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="monthlyChargeCents"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">
                        Monthly Charge (pence)
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                          placeholder="e.g. 50000 = £500"
                        />
                      </FormControl>
                      <p className="text-[10px] text-muted-foreground dark:text-gray-500 mt-1">
                        = {form.watch("currency") === "GBP" ? "£" : "$"}
                        {((field.value as number) / 100).toFixed(2)}
                      </p>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Currency</FormLabel>
                      <FormControl>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border dark:bg-gray-800 dark:border-gray-700">
                            <SelectItem value="GBP">GBP (£)</SelectItem>
                            <SelectItem value="USD">USD ($)</SelectItem>
                            <SelectItem value="EUR">EUR (€)</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="includedMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Included Minutes</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white" />
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="includedMessages"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Included Messages</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white" />
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="includedEmailSends"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Included Email Sends</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white" />
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="includedVideoSeconds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Included Video Seconds</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white" />
                      </FormControl>
                      <FormMessage className="text-[11px]" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="contractStartDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Contract Start</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contractEndDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Contract End</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white" />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Status</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border dark:bg-gray-800 dark:border-gray-700">
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                          <SelectItem value="churned">Churned</SelectItem>
                          <SelectItem value="trial">Trial</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage className="text-[11px]" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="billingAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">
                      Billing address (appears on invoices as {"{to_address}"})
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={"123 High Street\nLondon\nSW1A 1AA"}
                        className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white text-sm"
                        rows={3}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-muted-foreground dark:text-gray-400">Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="mt-1 bg-muted border-border text-foreground dark:bg-gray-800 dark:border-gray-700 dark:text-white text-sm" rows={2} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={closeDialog} type="button" className="border-border text-foreground/80 dark:border-gray-700 dark:text-gray-300">
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                  {saving ? "Saving…" : "Save Profile"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
