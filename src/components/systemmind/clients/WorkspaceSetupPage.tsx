import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  listAccountsClients,
  upsertBillingProfile,
  getBillingProfile,
} from "@/lib/accountsmind/accountsmind.functions";
import { adminListWorkspacesWithModules, adminSetWorkspaceModules, MODULE_CATALOG } from "@/lib/modules/modules.functions";
import {
  adminCreateClientWorkspace,
  adminSetWorkspaceStatus,
} from "@/lib/systemmind/admin-workspace.server";
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
  Users, Settings, ChevronRight, RefreshCw, PoundSterling, Building2,
  Package, ChevronDown, Check, ExternalLink, ChevronUp,
  Plus, Power, PowerOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Create Workspace form ─────────────────────────────────────────────────────

interface CreateWsForm {
  name:       string;
  ownerEmail: string;
  planTier:   string;
}

const CREATE_DEFAULTS: CreateWsForm = { name: "", ownerEmail: "", planTier: "free" };

// ── Billing form ──────────────────────────────────────────────────────────────

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

const PLAN_TIERS = [
  { id: "free",              label: "Free / PAYG",         color: "#64748b" },
  { id: "receptionist",     label: "Receptionist",         color: "#60a5fa" },
  { id: "lead_generation",  label: "Lead Generation",      color: "#4ade80" },
  { id: "pro_bundle",       label: "Pro Bundle",           color: "#f5b800" },
  { id: "scale_bundle",     label: "Scale Bundle",         color: "#e879f9" },
  { id: "executive_suite",  label: "Executive Suite",      color: "#f5b800" },
  { id: "business_command", label: "Business Command",     color: "#a78bfa" },
  { id: "enterprise",       label: "Enterprise",           color: "#38bdf8" },
];

// ── Migration Report (collapsible, static) ────────────────────────────────────

function MigrationReport() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-sky-300">Migration Report</span>
          <Badge className="text-[10px] bg-sky-500/20 text-sky-400 border-0">Summary</Badge>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-sky-400" /> : <ChevronDown className="w-4 h-4 text-sky-400" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-sky-500/10">
          <div className="pt-3 grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-400 mb-2">Moved to SystemMind → Clients</p>
              <ul className="space-y-1">
                {[
                  "Platform workspaces list + module toggles",
                  "Billing profile management",
                  "Module activation and plan tier assignment",
                  "Workspace Setup page (this page)",
                  "API Probe tool (new — see sidebar)",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-gray-300">
                    <Check className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400 mb-2">Retained in AccountsMind</p>
              <ul className="space-y-1">
                {[
                  "Enterprise billing display",
                  "Subscription status tracking",
                  "Provider cost analysis",
                  "Recharge management",
                  "Link to SystemMind for operational setup",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-gray-300">
                    <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-purple-400 mb-2">New DB Tables Created</p>
              <ul className="space-y-1">
                {["client_api_connections", "client_api_endpoint_mappings"].map((t) => (
                  <li key={t} className="text-xs font-mono text-gray-400">+ {t}</li>
                ))}
                <li className="text-xs text-gray-500 mt-1">Apply: CLIENT_API_PROBE_MIGRATION.sql via Supabase SQL Editor</li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400 mb-2">Permissions Applied</p>
              <ul className="space-y-1">
                {[
                  "All server functions guarded by requirePlatformAdmin",
                  "Frontend routes guarded by admin profile check",
                  "Credentials encrypted at rest (never sent to browser)",
                  "Webuyanyhouse auto-seeded in API Probe on first load",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-gray-300">
                    <Check className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-2">Existing Clients Verified</p>
            <p className="text-xs text-gray-400">
              Webuyanyhouse workspace + enterprise_integrations record are untouched. Sync jobs (wbah-leads-sync-tick, client.server.ts) continue to use the existing enterprise_integrations credential store — the API Probe references them without interfering.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function WorkspaceSetupPage() {
  const listFn       = useServerFn(listAccountsClients);
  const getProfileFn = useServerFn(getBillingProfile);
  const upsertFn     = useServerFn(upsertBillingProfile);
  const fetchWsFn    = useServerFn(adminListWorkspacesWithModules);
  const setModFn     = useServerFn(adminSetWorkspaceModules);
  const createWsFn   = useServerFn(adminCreateClientWorkspace);
  const setStatusFn  = useServerFn(adminSetWorkspaceStatus);
  const qc           = useQueryClient();

  const [editingId, setEditingId]         = useState<string | null>(null);
  const [form, setForm]                   = useState<BillingForm>(DEFAULTS);
  const [saving, setSaving]               = useState(false);
  const [expanded, setExpanded]           = useState<string | null>(null);
  const [pendingModules, setPend]         = useState<Record<string, string[]>>({});
  const [pendingTiers, setPTiers]         = useState<Record<string, string>>({});
  const [showCreate, setShowCreate]       = useState(false);
  const [createForm, setCreateForm]       = useState<CreateWsForm>(CREATE_DEFAULTS);
  const [creating, setCreating]           = useState(false);
  const [togglingId, setTogglingId]       = useState<string | null>(null);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ["accountsmind-clients"],
    queryFn:  () => listFn(),
    throwOnError: false,
  });

  const { data: workspaces = [] } = useQuery({
    queryKey: ["sm-workspaces-modules"],
    queryFn:  () => fetchWsFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const saveMut = useMutation({
    mutationFn: async ({ workspaceId, modules, planTier }: { workspaceId: string; modules: string[]; planTier: string }) =>
      setModFn({ data: { workspaceId, modules, planTier } }),
    onSuccess: (_r, vars) => {
      toast.success("Modules updated");
      setPend((p) => { const n = { ...p }; delete n[vars.workspaceId]; return n; });
      setPTiers((p) => { const n = { ...p }; delete n[vars.workspaceId]; return n; });
      qc.invalidateQueries({ queryKey: ["sm-workspaces-modules"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
      toast.success("Billing profile saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const field = <K extends keyof BillingForm>(key: K, val: BillingForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const createWorkspace = async () => {
    if (!createForm.name.trim() || !createForm.ownerEmail.trim()) {
      toast.error("Name and owner email are required");
      return;
    }
    setCreating(true);
    try {
      const res = await createWsFn({ data: createForm });
      toast.success(`Workspace "${createForm.name}" created${res.ownerLinked ? " and owner linked" : " (owner not found — invite them separately)"}`);
      setShowCreate(false);
      setCreateForm(CREATE_DEFAULTS);
      qc.invalidateQueries({ queryKey: ["sm-workspaces-modules"] });
      qc.invalidateQueries({ queryKey: ["accountsmind-clients"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create workspace");
    } finally {
      setCreating(false);
    }
  };

  const toggleStatus = async (workspaceId: string, currentStatus: string) => {
    const next = currentStatus === "suspended" ? "active" : "suspended";
    setTogglingId(workspaceId);
    try {
      await setStatusFn({ data: { workspaceId, status: next } });
      toast.success(`Workspace ${next}`);
      qc.invalidateQueries({ queryKey: ["sm-workspaces-modules"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Status update failed");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" /> Workspace Setup
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Platform workspaces, billing profiles, and module configuration</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Create Workspace
          </Button>
          <Link
            to="/systemmind/clients/api-probe"
            className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors"
          >
            API Probe <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Migration Report */}
      <MigrationReport />

      {/* Platform Workspaces with Module Config */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-3">Platform Workspaces & Modules</p>

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        <div className="space-y-2">
          {(workspaces as any[]).map((ws: any) => {
            const settings       = ws.workspace_settings?.[0] ?? ws.workspace_settings ?? {};
            const currentModules: string[] = pendingModules[ws.id] ?? settings.active_modules ?? [];
            const currentTier: string      = pendingTiers[ws.id]   ?? settings.plan_tier     ?? "free";
            const isDirty = !!(pendingModules[ws.id] || pendingTiers[ws.id]);
            const isOpen  = expanded === ws.id;

            const billingClient = (clients as any[]).find((c: any) => c.id === ws.id);
            const profile = billingClient?.billing_profile;

            return (
              <div key={ws.id} className="rounded-xl border border-white/[0.06] bg-gray-900/40 overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : ws.id)}
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="h-9 w-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                    <Building2 className="h-4 w-4 text-sky-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white truncate">{ws.name}</span>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{
                          background: `${PLAN_TIERS.find(t => t.id === currentTier)?.color ?? "#64748b"}18`,
                          color: PLAN_TIERS.find(t => t.id === currentTier)?.color ?? "#64748b",
                        }}
                      >
                        {PLAN_TIERS.find(t => t.id === currentTier)?.label ?? currentTier}
                      </span>
                      {isDirty && <Badge variant="secondary" className="text-[10px]">Unsaved</Badge>}
                      {profile && (
                        <span className="text-[10px] text-emerald-400">
                          {profile.currency === "GBP" ? "£" : "$"}{(profile.monthly_charge_cents / 100).toFixed(0)}/mo
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {currentModules.length} modules · Created {new Date(ws.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(ws.id); }}
                      className="text-xs text-gray-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-gray-700 hover:border-gray-500 transition-colors"
                    >
                      <Settings className="w-3 h-3" />
                      {profile ? "Edit Billing" : "Set Billing"}
                    </button>
                    {(() => {
                      const settings   = ws.workspace_settings?.[0] ?? ws.workspace_settings ?? {};
                      const wsStatus   = settings.workspace_status ?? "active";
                      const isToggling = togglingId === ws.id;
                      return (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleStatus(ws.id, wsStatus); }}
                          disabled={isToggling}
                          title={wsStatus === "suspended" ? "Activate workspace" : "Suspend workspace"}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded border text-xs transition-colors",
                            wsStatus === "suspended"
                              ? "border-amber-700 text-amber-400 hover:border-amber-500"
                              : "border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-700",
                            isToggling && "opacity-50 cursor-not-allowed",
                          )}
                        >
                          {wsStatus === "suspended" ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
                          {wsStatus === "suspended" ? "Activate" : "Suspend"}
                        </button>
                      );
                    })()}
                    {isOpen ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/[0.06] p-4 space-y-4">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2 block">Plan Tier</label>
                      <div className="flex flex-wrap gap-2">
                        {PLAN_TIERS.map((tier) => (
                          <button
                            key={tier.id}
                            onClick={() => setPTiers((p) => ({ ...p, [ws.id]: tier.id }))}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                              currentTier === tier.id
                                ? "border-current"
                                : "border-white/[0.08] text-muted-foreground hover:border-white/20"
                            )}
                            style={currentTier === tier.id ? { borderColor: tier.color, color: tier.color, background: `${tier.color}15` } : {}}
                          >
                            {tier.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2 block">Active Modules</label>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {MODULE_CATALOG.map((mod) => {
                          const active = currentModules.includes(mod.id);
                          return (
                            <button
                              key={mod.id}
                              onClick={() => {
                                const next = active
                                  ? currentModules.filter((m) => m !== mod.id)
                                  : [...currentModules, mod.id];
                                setPend((p) => ({ ...p, [ws.id]: next }));
                              }}
                              className={cn(
                                "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all",
                                active ? "bg-card border-primary/30" : "bg-transparent border-white/[0.06] hover:border-white/15"
                              )}
                            >
                              <div
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center"
                                style={active ? { background: mod.color, borderColor: mod.color } : { borderColor: "rgba(255,255,255,0.2)" }}
                              >
                                {active && <Check className="h-2.5 w-2.5 text-black" />}
                              </div>
                              <div>
                                <div className="text-xs font-medium" style={{ color: active ? mod.color : undefined }}>{mod.name}</div>
                                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{mod.price}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => {
                          setPend((p) => { const n = { ...p }; delete n[ws.id]; return n; });
                          setPTiers((p) => { const n = { ...p }; delete n[ws.id]; return n; });
                        }}
                        disabled={!isDirty}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => saveMut.mutate({ workspaceId: ws.id, modules: currentModules, planTier: currentTier })}
                        disabled={saveMut.isPending}
                        className="bg-sky-600 hover:bg-sky-700 text-white"
                      >
                        Save Modules
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {!isLoading && (workspaces as any[]).length === 0 && (
            <div className="py-12 text-center text-sm text-gray-500">
              <Building2 className="mx-auto h-8 w-8 mb-3 opacity-20" />
              No workspaces found
            </div>
          )}
        </div>
      </div>

      {/* Billing Profile Dialog */}
      <Dialog open={!!editingId} onOpenChange={(o) => !o && setEditingId(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PoundSterling className="w-4 h-4 text-sky-400" />
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
                  <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white"><SelectValue /></SelectTrigger>
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
                <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white"><SelectValue /></SelectTrigger>
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
              <Button variant="outline" onClick={() => setEditingId(null)} className="border-gray-700 text-gray-300">Cancel</Button>
              <Button onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-700">
                {saving ? "Saving…" : "Save Profile"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Workspace Dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => !o && setShowCreate(false)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-sky-400" />
              Create New Client Workspace
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-xs text-gray-400">Workspace Name *</Label>
              <Input
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 bg-gray-800 border-gray-700 text-white"
                placeholder="e.g. Acme Property Ltd"
              />
            </div>
            <div>
              <Label className="text-xs text-gray-400">Owner Email *</Label>
              <Input
                type="email"
                value={createForm.ownerEmail}
                onChange={(e) => setCreateForm((f) => ({ ...f, ownerEmail: e.target.value }))}
                className="mt-1 bg-gray-800 border-gray-700 text-white"
                placeholder="owner@client.com"
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Must match an existing platform user. If not found, the workspace is created and the owner can be linked later.
              </p>
            </div>
            <div>
              <Label className="text-xs text-gray-400">Initial Plan Tier</Label>
              <Select value={createForm.planTier} onValueChange={(v) => setCreateForm((f) => ({ ...f, planTier: v }))}>
                <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  {PLAN_TIERS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-700">
              <Button variant="outline" size="sm" onClick={() => { setShowCreate(false); setCreateForm(CREATE_DEFAULTS); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={createWorkspace}
                disabled={creating}
                className="bg-sky-600 hover:bg-sky-700 text-white"
              >
                {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                Create Workspace
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
