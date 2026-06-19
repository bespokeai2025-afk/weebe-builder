import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plus, Globe, Pencil, Trash2, ToggleLeft, ToggleRight,
  Building2, Check, Package, DollarSign, RefreshCw, Link, Palette,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  adminListWhitelabelPartners,
  adminCreateWhitelabelPartner,
  adminUpdateWhitelabelPartner,
  adminToggleWhitelabelPartner,
  adminDeleteWhitelabelPartner,
  type WhitelabelPartner,
} from "@/lib/whitelabel/whitelabel.functions";
import { MODULE_CATALOG } from "@/lib/modules/modules.functions";

export const Route = createFileRoute("/_authenticated/admin/whitelabel")({
  component: AdminWhitelabelPage,
});

const PARTNER_TIERS = [
  { id: "standard",   label: "Standard",   color: "#60a5fa" },
  { id: "premium",    label: "Premium",    color: "#f5b800" },
  { id: "enterprise", label: "Enterprise", color: "#a78bfa" },
];

const EMPTY: WhitelabelPartner = {
  partner_name: "",
  slug: "",
  brand_name: "",
  primary_color: "#F5B800",
  secondary_color: "#050e1e",
  accent_color: "#3b82f6",
  hide_powered_by: false,
  allowed_modules: [],
  partner_tier: "standard",
  monthly_fee_pence: 0,
  active: true,
};

function PartnerForm({
  initial,
  onSave,
  onCancel,
  isBusy,
}: {
  initial: WhitelabelPartner;
  onSave: (p: WhitelabelPartner) => void;
  onCancel: () => void;
  isBusy: boolean;
}) {
  const [form, setForm] = useState<WhitelabelPartner>({ ...initial });
  const set = (k: keyof WhitelabelPartner, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const toggleModule = (id: string) => {
    const mods = form.allowed_modules ?? [];
    set("allowed_modules", mods.includes(id) ? mods.filter((m) => m !== id) : [...mods, id]);
  };

  return (
    <div className="space-y-5">
      {/* Brand */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Partner / Agency Name</Label>
          <Input value={form.partner_name} onChange={(e) => set("partner_name", e.target.value)} placeholder="Acme Digital Agency" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Brand Name (shown to end users)</Label>
          <Input value={form.brand_name} onChange={(e) => set("brand_name", e.target.value)} placeholder="AcmeAI" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Slug (subdomain / path key)</Label>
          <Input
            value={form.slug}
            onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            placeholder="acme-digital"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tagline</Label>
          <Input value={form.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} placeholder="AI-powered by AcmeAI" />
        </div>
      </div>

      {/* Domain */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Custom Domain</Label>
          <Input value={form.custom_domain ?? ""} onChange={(e) => set("custom_domain", e.target.value)} placeholder="app.acme.com" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Support Email</Label>
          <Input type="email" value={form.support_email ?? ""} onChange={(e) => set("support_email", e.target.value)} placeholder="support@acme.com" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Logo URL</Label>
          <Input value={form.logo_url ?? ""} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://..." />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Favicon URL</Label>
          <Input value={form.favicon_url ?? ""} onChange={(e) => set("favicon_url", e.target.value)} placeholder="https://..." />
        </div>
      </div>

      {/* Colours */}
      <div>
        <Label className="text-xs mb-2 block">Brand Colours</Label>
        <div className="flex gap-4 flex-wrap">
          {([["primary_color", "Primary"], ["secondary_color", "Background"], ["accent_color", "Accent"]] as [keyof WhitelabelPartner, string][]).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                value={(form[key] as string) ?? "#ffffff"}
                onChange={(e) => set(key, e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border border-white/10 bg-transparent p-0.5"
              />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Partner tier & billing */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Partner Tier</Label>
          <div className="flex gap-2">
            {PARTNER_TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => set("partner_tier", t.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                  form.partner_tier === t.id ? "border-current" : "border-white/[0.08] text-muted-foreground"
                )}
                style={form.partner_tier === t.id ? { borderColor: t.color, color: t.color, background: `${t.color}18` } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Monthly Fee (£)</Label>
          <Input
            type="number"
            min="0"
            value={(form.monthly_fee_pence / 100).toString()}
            onChange={(e) => set("monthly_fee_pence", Math.round(parseFloat(e.target.value || "0") * 100))}
            placeholder="0"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Revenue Share (%)</Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            value={(form.revenue_share_pct ?? 0).toString()}
            onChange={(e) => set("revenue_share_pct", parseFloat(e.target.value || "0"))}
            placeholder="0"
          />
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => set("hide_powered_by", !form.hide_powered_by)}
            className={cn("h-5 w-5 rounded border flex items-center justify-center transition-colors", form.hide_powered_by ? "bg-primary border-primary" : "border-white/20")}
          >
            {form.hide_powered_by && <Check className="h-3.5 w-3.5 text-black" />}
          </div>
          <span className="text-sm text-muted-foreground">Hide "Powered by WEBEE"</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <div
            onClick={() => set("active", !form.active)}
            className={cn("h-5 w-5 rounded border flex items-center justify-center transition-colors", form.active ? "bg-primary border-primary" : "border-white/20")}
          >
            {form.active && <Check className="h-3.5 w-3.5 text-black" />}
          </div>
          <span className="text-sm text-muted-foreground">Active</span>
        </label>
      </div>

      {/* Allowed modules */}
      <div>
        <Label className="text-xs mb-2 block">Allowed Modules (partner can offer these)</Label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODULE_CATALOG.map((mod) => {
            const active = (form.allowed_modules ?? []).includes(mod.id);
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => toggleModule(mod.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2.5 text-left text-xs transition-all",
                  active ? "border-primary/30 bg-card" : "border-white/[0.06] hover:border-white/15"
                )}
              >
                <div
                  className="h-3 w-3 shrink-0 rounded border flex items-center justify-center"
                  style={active ? { background: mod.color, borderColor: mod.color } : { borderColor: "rgba(255,255,255,0.2)" }}
                >
                  {active && <Check className="h-2 w-2 text-black" />}
                </div>
                <span style={{ color: active ? mod.color : undefined }}>{mod.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label className="text-xs">Internal Notes</Label>
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
          className="w-full rounded-md border border-white/[0.06] bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
          placeholder="Partner context, agreements, special requirements…"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.06]">
        <Button variant="outline" onClick={onCancel} disabled={isBusy}>Cancel</Button>
        <Button onClick={() => onSave(form)} disabled={isBusy || !form.partner_name || !form.slug || !form.brand_name}>
          Save Partner
        </Button>
      </div>
    </div>
  );
}

function AdminWhitelabelPage() {
  const qc = useQueryClient();
  const listFn   = useServerFn(adminListWhitelabelPartners);
  const createFn = useServerFn(adminCreateWhitelabelPartner);
  const updateFn = useServerFn(adminUpdateWhitelabelPartner);
  const toggleFn = useServerFn(adminToggleWhitelabelPartner);
  const deleteFn = useServerFn(adminDeleteWhitelabelPartner);

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState<(WhitelabelPartner & { id: string }) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ["admin-whitelabel"],
    queryFn: () => listFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const createMut = useMutation({
    mutationFn: (p: WhitelabelPartner) => createFn({ data: p }),
    onSuccess: () => { toast.success("Partner created"); setShowCreate(false); qc.invalidateQueries({ queryKey: ["admin-whitelabel"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (p: WhitelabelPartner & { id: string }) => updateFn({ data: p }),
    onSuccess: () => { toast.success("Partner updated"); setEditing(null); qc.invalidateQueries({ queryKey: ["admin-whitelabel"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleFn({ data: { id, active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-whitelabel"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Partner removed"); setConfirmDelete(null); qc.invalidateQueries({ queryKey: ["admin-whitelabel"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-5 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">White Label Partners</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manage white label deployments — branding, modules, billing, and domain configuration.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-2" onClick={() => qc.invalidateQueries({ queryKey: ["admin-whitelabel"] })}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Partner
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      {!isLoading && (partners as any[]).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total Partners", value: (partners as any[]).length, icon: Building2 },
            { label: "Active",         value: (partners as any[]).filter((p: any) => p.active).length, icon: ToggleRight },
            { label: "Revenue",        value: `£${((partners as any[]).reduce((s: number, p: any) => s + (p.monthly_fee_pence ?? 0), 0) / 100).toLocaleString("en-GB")}/mo`, icon: DollarSign },
            { label: "Modules Offered",value: new Set((partners as any[]).flatMap((p: any) => p.allowed_modules ?? [])).size, icon: Package },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/[0.06] bg-card/40 p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <stat.icon className="h-3.5 w-3.5" />
                {stat.label}
              </div>
              <div className="text-lg font-semibold">{stat.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Partner cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : (partners as any[]).length === 0 ? (
        <div className="py-20 text-center">
          <Globe className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
          <p className="text-sm text-muted-foreground">No white label partners yet.</p>
          <Button size="sm" className="mt-4 gap-2" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" /> Add first partner
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(partners as any[]).map((p: any) => (
            <div
              key={p.id}
              className={cn(
                "relative rounded-2xl border p-5 flex flex-col gap-4 overflow-hidden",
                p.active ? "border-white/[0.08] bg-card/40" : "border-white/[0.04] bg-card/20 opacity-60"
              )}
            >
              {/* Color stripe */}
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: p.primary_color }} />

              <div className="flex items-start justify-between gap-3 pt-1">
                <div>
                  <div className="flex items-center gap-2">
                    {p.logo_url ? (
                      <img src={p.logo_url} alt={p.brand_name} className="h-6 w-6 rounded object-contain" />
                    ) : (
                      <div className="h-6 w-6 rounded flex items-center justify-center text-[10px] font-bold text-black" style={{ background: p.primary_color }}>
                        {p.brand_name.charAt(0)}
                      </div>
                    )}
                    <span className="font-semibold text-sm">{p.brand_name}</span>
                    <Badge
                      variant="secondary"
                      className="text-[10px]"
                      style={{ color: PARTNER_TIERS.find(t => t.id === p.partner_tier)?.color }}
                    >
                      {p.partner_tier}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.partner_name}</p>
                </div>
                <button
                  onClick={() => toggleMut.mutate({ id: p.id, active: !p.active })}
                  className="shrink-0"
                  title={p.active ? "Deactivate" : "Activate"}
                >
                  {p.active
                    ? <ToggleRight className="h-5 w-5 text-primary" />
                    : <ToggleLeft className="h-5 w-5 text-muted-foreground" />}
                </button>
              </div>

              <div className="space-y-1.5">
                {p.custom_domain && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Globe className="h-3 w-3" />
                    {p.custom_domain}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Link className="h-3 w-3" />
                  /{p.slug}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <DollarSign className="h-3 w-3" />
                  £{(p.monthly_fee_pence / 100).toFixed(0)}/mo
                  {p.revenue_share_pct > 0 && <span> · {p.revenue_share_pct}% rev share</span>}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Package className="h-3 w-3" />
                  {(p.allowed_modules ?? []).length} modules allowed
                </div>
              </div>

              {/* Colour chips */}
              <div className="flex items-center gap-1.5">
                <Palette className="h-3 w-3 text-muted-foreground" />
                {[p.primary_color, p.secondary_color, p.accent_color].map((c, i) => (
                  <div key={i} className="h-4 w-4 rounded-full border border-white/10" style={{ background: c }} title={c} />
                ))}
                {p.hide_powered_by && <span className="ml-1 text-[10px] text-muted-foreground">· White labelled</span>}
              </div>

              <div className="flex gap-2 mt-auto pt-2 border-t border-white/[0.06]">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive border-destructive/20 hover:bg-destructive/10"
                  onClick={() => setConfirmDelete(p.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Globe className="h-4 w-4" /> New White Label Partner</DialogTitle>
          </DialogHeader>
          <PartnerForm
            initial={EMPTY}
            onSave={(p) => createMut.mutate(p)}
            onCancel={() => setShowCreate(false)}
            isBusy={createMut.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Edit Partner</DialogTitle>
          </DialogHeader>
          {editing && (
            <PartnerForm
              initial={editing}
              onSave={(p) => updateMut.mutate({ ...p, id: editing.id! })}
              onCancel={() => setEditing(null)}
              isBusy={updateMut.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove partner?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently delete the partner configuration. Their workspace and data are unaffected.</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && deleteMut.mutate(confirmDelete)}
              disabled={deleteMut.isPending}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
