/**
 * Reseller Portal — Client Accounts panel.
 * Entitlement-gated (reseller_client_accounts): create branded child client
 * workspaces, invite the client owner, assign an allowed package, choose
 * branding inheritance, view status/usage, suspend, request upgrades.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Users, Bot, Ban, Play, ArrowUpCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { PACKAGE_CATALOG } from "@/lib/packages/packages.shared";
import {
  getResellerOverview, createChildClient, setChildSuspended, requestClientUpgrade,
} from "@/lib/reseller/reseller.functions";

export const Route = createFileRoute("/_authenticated/reseller")({
  head: () => ({ meta: [{ title: "Reseller Portal — Webee" }] }),
  component: ResellerPortal,
});

function pkgName(key: string) {
  return PACKAGE_CATALOG.find((p) => p.packageKey === key)?.packageName ?? key;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600",
  invited: "bg-blue-500/15 text-blue-600",
  suspended: "bg-red-500/15 text-red-600",
};

function ResellerPortal() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getResellerOverview);
  const createFn = useServerFn(createChildClient);
  const suspendFn = useServerFn(setChildSuspended);
  const upgradeFn = useServerFn(requestClientUpgrade);

  const q = useQuery({
    queryKey: ["reseller-overview"],
    queryFn: () => overviewFn(),
    throwOnError: false,
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    packageKey: "receptionist_lite",
    brandingMode: "inherit" as "inherit" | "webee" | "custom",
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["reseller-overview"] });

  const createMut = useMutation({
    mutationFn: () => createFn({ data: form }),
    onSuccess: () => {
      toast.success("Client account created", { description: "An invitation email has been sent." });
      setOpen(false);
      setForm({ clientName: "", clientEmail: "", packageKey: "receptionist_lite", brandingMode: "inherit" });
      invalidate();
    },
    onError: (e: any) => toast.error("Could not create client", { description: e?.message }),
  });

  const suspendMut = useMutation({
    mutationFn: (v: { clientId: string; suspended: boolean }) => suspendFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: any) => toast.error("Update failed", { description: e?.message }),
  });

  const upgradeMut = useMutation({
    mutationFn: (v: { clientId: string; requestedPackageKey: string }) => upgradeFn({ data: v }),
    onSuccess: () => {
      toast.success("Upgrade requested", { description: "WEBEE has been notified of the package change request." });
      invalidate();
    },
    onError: (e: any) => toast.error("Request failed", { description: e?.message }),
  });

  if (q.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Reseller Portal unavailable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {(q.error as any)?.message ?? "Reseller client accounts are not included in your current package."}
        </p>
      </div>
    );
  }

  const data = q.data!;
  const usage = data.usage;
  const atLimit = usage.remaining <= 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reseller Portal</h1>
          <p className="text-sm text-muted-foreground">
            Client accounts: {usage.used} of {usage.unlimited ? "unlimited" : usage.allowance} used
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={atLimit}>
              <Plus className="mr-2 h-4 w-4" /> New Client Account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create client account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Client / business name</Label>
                <Input value={form.clientName}
                  onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                  placeholder="Acme Plumbing Ltd" />
              </div>
              <div className="space-y-2">
                <Label>Client owner email</Label>
                <Input type="email" value={form.clientEmail}
                  onChange={(e) => setForm((f) => ({ ...f, clientEmail: e.target.value }))}
                  placeholder="owner@acme.co.uk" />
              </div>
              <div className="space-y-2">
                <Label>Package</Label>
                <Select value={form.packageKey} onValueChange={(v) => setForm((f) => ({ ...f, packageKey: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data.allowedPackages.map((k: string) => (
                      <SelectItem key={k} value={k}>{pkgName(k)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Branding</Label>
                <Select value={form.brandingMode}
                  onValueChange={(v) => setForm((f) => ({ ...f, brandingMode: v as any }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit my white label branding</SelectItem>
                    <SelectItem value="webee">Standard WEBEE branding</SelectItem>
                    <SelectItem value="custom">Client's own branding (set up later)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
                {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create & invite
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {atLimit && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <ArrowUpCircle className="h-5 w-5 text-amber-500" />
            You've reached your client account limit. Upgrade your package or add extra client account slots to create more.
          </CardContent>
        </Card>
      )}

      {data.clients.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No client accounts yet. Create your first branded client workspace above.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.clients.map((c: any) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{c.client_name}</CardTitle>
                  <Badge className={STATUS_STYLES[c.status] ?? ""} variant="secondary">{c.status}</Badge>
                </div>
                <CardDescription>{c.client_email}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>{pkgName(c.package_key)}</span>
                  {c.usage && (
                    <>
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{c.usage.members} members</span>
                      <span className="inline-flex items-center gap-1"><Bot className="h-3.5 w-3.5" />{c.usage.agents} agents</span>
                    </>
                  )}
                  <span>Branding: {c.branding_mode}</span>
                </div>
                {c.upgrade_requested_package_key && (
                  <p className="text-xs text-amber-600">
                    Upgrade to {pkgName(c.upgrade_requested_package_key)} requested
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline"
                    disabled={suspendMut.isPending}
                    onClick={() => suspendMut.mutate({ clientId: c.id, suspended: c.status !== "suspended" })}>
                    {c.status === "suspended"
                      ? (<><Play className="mr-1 h-3.5 w-3.5" /> Reactivate</>)
                      : (<><Ban className="mr-1 h-3.5 w-3.5" /> Suspend</>)}
                  </Button>
                  <Select onValueChange={(v) => upgradeMut.mutate({ clientId: c.id, requestedPackageKey: v })}>
                    <SelectTrigger className="h-8 w-[170px] text-xs">
                      <SelectValue placeholder="Request upgrade…" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.allowedPackages
                        .filter((k: string) => k !== c.package_key)
                        .map((k: string) => (
                          <SelectItem key={k} value={k}>{pkgName(k)}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
