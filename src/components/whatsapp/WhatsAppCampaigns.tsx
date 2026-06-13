import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Megaphone, Clock, CheckCircle2, AlertCircle, PlayCircle, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listWACampaigns, createWACampaign, deleteWACampaign, listWATemplates, launchWACampaign,
} from "@/lib/dashboard/whatsapp.functions";
import { toast } from "sonner";

const TYPE_LABELS: Record<string, string> = {
  broadcast: "Broadcast",
  follow_up: "Follow-up",
  scheduled: "Scheduled",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft:     { label: "Draft",     color: "secondary",    icon: AlertCircle },
  scheduled: { label: "Scheduled", color: "outline",      icon: Clock },
  running:   { label: "Running",   color: "default",      icon: PlayCircle },
  completed: { label: "Completed", color: "secondary",    icon: CheckCircle2 },
  failed:    { label: "destructive", color: "destructive", icon: AlertCircle },
};

function emptyForm() {
  return { name: "", type: "broadcast" as const, template_id: "", scheduled_at: "" };
}

export function WhatsAppCampaigns() {
  const qc = useQueryClient();
  const listFn   = useServerFn(listWACampaigns);
  const createFn = useServerFn(createWACampaign);
  const deleteFn = useServerFn(deleteWACampaign);
  const tmplFn   = useServerFn(listWATemplates);
  const launchFn = useServerFn(launchWACampaign);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["wa-campaigns"],
    queryFn: () => listFn(),
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["wa-templates"],
    queryFn: () => tmplFn(),
  });

  const [open, setOpen]           = useState(false);
  const [deleteId, setDeleteId]   = useState<string | null>(null);
  const [launchId, setLaunchId]   = useState<string | null>(null);
  const [form, setForm]           = useState(emptyForm());

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: form.name,
          type: form.type,
          template_id: form.template_id || undefined,
          scheduled_at: form.scheduled_at || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      setOpen(false);
      setForm(emptyForm());
      toast.success("Campaign created");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: deleteId! } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      setDeleteId(null);
      toast.success("Campaign deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const launch = useMutation({
    mutationFn: () => launchFn({ data: { id: launchId! } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      setLaunchId(null);
      toast.success(`Campaign launched — ${res.sent} sent, ${res.failed} failed`);
    },
    onError: (e: any) => {
      setLaunchId(null);
      toast.error(e.message);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Create and manage broadcast, follow-up, and scheduled campaigns.
        </p>
        <Button size="sm" onClick={() => { setForm(emptyForm()); setOpen(true); }} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> New Campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (campaigns as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Megaphone className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No campaigns yet</p>
          <p className="text-xs">Create a campaign to send messages to multiple contacts at once.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {["Name", "Type", "Template", "Status", "Sent", "Delivered", "Read", "Replied", "Created", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(campaigns as any[]).map((c: any) => {
                const sc = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
                const Icon = sc.icon;
                const stats = c.stats ?? {};
                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[c.type] ?? c.type}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {c.whatsapp_templates?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={sc.color as any} className="gap-1 text-[10px]">
                        <Icon className="h-3 w-3" />{sc.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.sent ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.delivered ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.read ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.replied ?? 0}</td>
                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        {c.status === "draft" && (
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-400"
                            title="Launch campaign"
                            onClick={() => setLaunchId(c.id)}
                          >
                            <Rocket className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Summer Promo 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={form.type} onValueChange={(v: any) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="broadcast">Broadcast — send to all contacts now</SelectItem>
                  <SelectItem value="follow_up">Follow-up — auto re-engage after inactivity</SelectItem>
                  <SelectItem value="scheduled">Scheduled — send at a specific time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Template (optional)</Label>
              <Select value={form.template_id} onValueChange={(v) => setForm({ ...form, template_id: v })}>
                <SelectTrigger><SelectValue placeholder="Choose a template…" /></SelectTrigger>
                <SelectContent>
                  {(templates as any[]).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.type === "scheduled" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Schedule Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>
              {create.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!launchId} onOpenChange={(o) => !o && setLaunchId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-green-500" /> Launch campaign?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately send the campaign template to all opted-in contacts via WhatsApp. Make sure your Twilio credentials are configured in Settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={launch.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => launch.mutate()}
              disabled={launch.isPending}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {launch.isPending ? "Launching…" : "Launch Now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
