import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Phone,
  Plus,
  Trash2,
  Pencil,
  Search,
  Pause,
  Play,
  PhoneCall,
  Clock,
  Globe,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  listCallCampaigns,
  createCallCampaign,
  updateCallCampaign,
  deleteCallCampaign,
  toggleCallCampaignPause,
  type CallCampaign,
} from "@/lib/dashboard/call-campaigns.functions";
import { listWorkspaceCampaignFilters } from "@/lib/people-views/people-views.functions";

const TIMEZONES = [
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "America/New_York", label: "New York (ET)" },
  { value: "America/Chicago", label: "Chicago (CT)" },
  { value: "America/Denver", label: "Denver (MT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Kolkata", label: "Kolkata (IST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

function fmt12(time24: string) {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function scheduleLabel(config: CallCampaign["config"]) {
  if (config.callFrequency === "daily") {
    return `Every 1 day(s) at ${fmt12(config.callTime)}`;
  }
  return `Every ${config.intervalDays} day(s) at ${fmt12(config.callTime)}`;
}

const BLANK = {
  name: "",
  agentId: "",
  leadStatusFilter: "",
  callTime: "09:00",
  timezone: "Europe/London",
  callFrequency: "daily" as "daily" | "custom",
  intervalDays: 1,
  voicemailEnabled: false,
  campaignFilterId: "",
};

type Props = {
  pageType: "data" | "qualified" | "leads";
  statusOptions: Array<{ value: string; label: string }>;
  agents: Array<{ id: string; name: string; retell_agent_id?: string | null }>;
};

export function CallSchedulingSection({ pageType, statusOptions, agents }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listCallCampaigns);
  const createFn = useServerFn(createCallCampaign);
  const updateFn = useServerFn(updateCallCampaign);
  const deleteFn = useServerFn(deleteCallCampaign);
  const toggleFn = useServerFn(toggleCallCampaignPause);
  const listFiltersFn = useServerFn(listWorkspaceCampaignFilters);

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CallCampaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);

  const QK = ["call-campaigns", pageType];

  const campaignsQ = useQuery({
    queryKey: QK,
    queryFn: () => listFn({ data: { pageType } }),
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const campaigns = (campaignsQ.data ?? []) as CallCampaign[];

  // Workspace campaign filters (optional, additive; leads/qualified only).
  const filtersQ = useQuery({
    queryKey: ["workspace-campaign-filters"],
    queryFn: () => listFiltersFn(),
    enabled: pageType !== "data",
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
  const availableFilters = (((filtersQ.data as any)?.filters ?? []) as Array<{ id: string; name: string; status: string }>)
    .filter((f) => f.status === "active");

  const filtered = search.trim()
    ? campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : campaigns;

  const totalActive = campaigns.filter((c) => c.status === "active").length;
  const totalDaily = campaigns.filter((c) => c.config?.callFrequency === "daily").length;
  const totalCustom = campaigns.filter((c) => c.config?.callFrequency === "custom").length;

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK);
    setDialogOpen(true);
  }

  function openEdit(c: CallCampaign) {
    setEditTarget(c);
    setForm({
      name: c.name,
      agentId: c.agent_id ?? "",
      leadStatusFilter: c.config?.leadStatusFilter ?? "",
      callTime: c.config?.callTime ?? "09:00",
      timezone: c.config?.timezone ?? "Europe/London",
      callFrequency: c.config?.callFrequency ?? "daily",
      intervalDays: c.config?.intervalDays ?? 1,
      voicemailEnabled: c.config?.voicemailEnabled ?? false,
      campaignFilterId: c.config?.campaignFilterId ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Campaign name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        agentId: form.agentId || null,
        pageType,
        leadStatusFilter: form.leadStatusFilter || null,
        callTime: form.callTime,
        timezone: form.timezone,
        callFrequency: form.callFrequency,
        intervalDays: form.intervalDays,
        voicemailEnabled: form.voicemailEnabled,
        campaignFilterId: pageType !== "data" && form.campaignFilterId ? form.campaignFilterId : null,
      };
      if (editTarget) {
        await updateFn({ data: { id: editTarget.id, ...payload } });
        toast.success("Campaign updated");
      } else {
        await createFn({ data: payload });
        toast.success("Campaign created");
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: QK });
    } catch (e) {
      toast.error("Failed to save campaign", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFn({ data: { id } });
      toast.success("Campaign deleted");
      qc.invalidateQueries({ queryKey: QK });
    } catch (e) {
      toast.error("Failed to delete campaign", { description: (e as Error).message });
    }
  }

  async function handleToggle(c: CallCampaign) {
    try {
      await toggleFn({ data: { id: c.id, currentStatus: c.status } });
      qc.invalidateQueries({ queryKey: QK });
    } catch (e) {
      toast.error("Failed to update campaign", { description: (e as Error).message });
    }
  }

  async function handleVoicemailToggle(c: CallCampaign) {
    try {
      await updateFn({
        data: {
          id: c.id,
          name: c.name,
          agentId: c.agent_id ?? null,
          pageType,
          leadStatusFilter: c.config?.leadStatusFilter ?? null,
          callTime: c.config?.callTime ?? "09:00",
          timezone: c.config?.timezone ?? "Europe/London",
          callFrequency: c.config?.callFrequency ?? "daily",
          intervalDays: c.config?.intervalDays ?? 1,
          voicemailEnabled: !c.config?.voicemailEnabled,
          campaignFilterId: c.config?.campaignFilterId ?? null,
        },
      });
      qc.invalidateQueries({ queryKey: QK });
    } catch (e) {
      toast.error("Failed to update voicemail setting", { description: (e as Error).message });
    }
  }

  const agentLabel = (agentId: string | null) => {
    if (!agentId) return "—";
    const a = agents.find((ag) => ag.id === agentId);
    if (!a) return agentId.slice(0, 20) + "…";
    const rid = a.retell_agent_id;
    return rid ? rid.slice(0, 18) + "…" : a.name;
  };

  const statusLabel = (filter: string | null) => {
    if (!filter) return "All Leads (no filter)";
    return statusOptions.find((s) => s.value === filter)?.label ?? filter;
  };

  return (
    <div className="min-w-0 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Call Scheduling</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Automate outbound calls based on lead status and schedule
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Create Call Campaign
        </Button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Campaigns", value: campaigns.length, icon: Phone, color: "text-blue-400", bg: "bg-blue-500/10", sub: `${campaigns.filter((c) => c.status === "paused").length} paused` },
          { label: "Active Campaigns", value: totalActive, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10", sub: "Running now" },
          { label: "Daily Campaigns", value: totalDaily, icon: PhoneCall, color: "text-violet-400", bg: "bg-violet-500/10", sub: "Recurring daily" },
          { label: "Custom Interval", value: totalCustom, icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", sub: "Custom schedule" },
        ].map((s) => (
          <div key={s.label} className="min-w-0 rounded-xl border border-white/[0.06] bg-card/60 p-3">
            <div className={cn("mb-1.5 inline-flex rounded-lg p-1.5", s.bg)}>
              <s.icon className={cn("h-3.5 w-3.5", s.color)} />
            </div>
            <p className={cn("text-lg font-bold tabular-nums", s.color)}>{s.value}</p>
            <p className="text-xs font-medium text-foreground mt-0.5">{s.label}</p>
            <p className="text-[10px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + refresh */}
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search call campaigns…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => campaignsQ.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Campaign list */}
      {campaignsQ.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <Phone className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">No campaigns yet</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Create a campaign to automate outbound calls based on lead status and a recurring schedule.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Create Campaign
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-white/[0.06] bg-card/60 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                {/* Left: icon + name */}
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
                    <Phone className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{c.name}</p>
                  </div>
                </div>

                {/* Right: status badge + actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      c.status === "active"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {c.status === "active" ? "● Active" : "● Paused"}
                  </span>
                  <button
                    title={c.status === "active" ? "Pause" : "Resume"}
                    onClick={() => handleToggle(c)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                  >
                    {c.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    title="Edit"
                    onClick={() => openEdit(c)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="Delete"
                    onClick={() => handleDelete(c.id)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Details grid */}
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Lead Status</p>
                  <p className="font-medium text-foreground mt-0.5">{statusLabel(c.config?.leadStatusFilter ?? null)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Agent ID</p>
                  <p className="font-medium text-foreground mt-0.5 font-mono truncate">{agentLabel(c.agent_id)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Schedule</p>
                  <p className="font-medium text-foreground mt-0.5">{c.config ? scheduleLabel(c.config) : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Timezone</p>
                  <p className="font-medium text-foreground mt-0.5">{c.config?.timezone ?? "—"}</p>
                </div>
              </div>

              {/* Footer: frequency + voicemail */}
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-2.5">
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                  <span>
                    Frequency:{" "}
                    <span className="text-foreground font-medium capitalize">
                      {c.config?.callFrequency === "custom" ? "Custom" : "Daily"}
                    </span>
                  </span>
                  {c.config?.callFrequency === "custom" && (
                    <span>
                      Interval days:{" "}
                      <span className="text-foreground font-medium">{c.config.intervalDays}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>Voicemail</span>
                  <Switch
                    checked={c.config?.voicemailEnabled ?? false}
                    onCheckedChange={() => handleVoicemailToggle(c)}
                    className="!h-4 !w-7"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-w-md flex flex-col max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              {editTarget ? "Edit Campaign" : "Create Call Campaign"}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 pr-1 space-y-4 pb-1">
            {/* Campaign Details */}
            <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Phone className="h-3.5 w-3.5 text-blue-400" />
                Campaign Details
              </div>
              <div>
                <Label className="text-xs">Campaign Name</Label>
                <Input
                  className="mt-1 h-8 text-xs"
                  placeholder="e.g. Follow-up Disqualified Leads"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Select Call Agent</Label>
                {agents.length === 0 ? (
                  <p className="mt-1 text-[11px] text-amber-400">
                    No live agents found. Go-live with an agent first.
                  </p>
                ) : (
                  <Select
                    value={form.agentId || "__none__"}
                    onValueChange={(v) => setForm((f) => ({ ...f, agentId: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue placeholder="Select an agent…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No agent selected</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Agents are synced from your OmniVoice account
                </p>
              </div>
            </div>

            {/* Lead Targeting */}
            <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Globe className="h-3.5 w-3.5 text-violet-400" />
                Lead Targeting
              </div>
              <div>
                <Label className="text-xs">Target Lead Status</Label>
                <Select
                  value={form.leadStatusFilter || "__all__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, leadStatusFilter: v === "__all__" ? "" : v }))}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Leads (no filter)</SelectItem>
                    {statusOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {pageType !== "data" && availableFilters.length > 0 && (
                <div>
                  <Label className="text-xs">Campaign Filter (optional)</Label>
                  <Select
                    value={form.campaignFilterId || "__none__"}
                    onValueChange={(v) => setForm((f) => ({ ...f, campaignFilterId: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue placeholder="No filter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No filter (default behaviour)</SelectItem>
                      {availableFilters.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Workspace filters narrow which leads this campaign calls. Leaving it off keeps
                    the campaign exactly as before.
                  </p>
                </div>
              )}
            </div>

            {/* Schedule Configuration */}
            <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Clock className="h-3.5 w-3.5 text-emerald-400" />
                Schedule Configuration
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Call Time</Label>
                  <Input
                    type="time"
                    className="mt-1 h-8 text-xs"
                    value={form.callTime}
                    onChange={(e) => setForm((f) => ({ ...f, callTime: e.target.value }))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Timezone</Label>
                  <Select
                    value={form.timezone}
                    onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}
                  >
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1 block">Call Frequency</Label>
                <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
                  {(["daily", "custom"] as const).map((freq) => (
                    <button
                      key={freq}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, callFrequency: freq }))}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-medium transition-colors capitalize",
                        form.callFrequency === freq
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {freq === "daily" ? "Daily" : "Custom Interval"}
                    </button>
                  ))}
                </div>
              </div>
              {form.callFrequency === "custom" && (
                <div>
                  <Label className="text-xs">Interval (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    className="mt-1 h-8 text-xs w-32"
                    value={form.intervalDays}
                    onChange={(e) => setForm((f) => ({ ...f, intervalDays: Math.max(1, Number(e.target.value) || 1) }))}
                  />
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <Label className="text-xs">Voicemail detection</Label>
                  <p className="text-[10px] text-muted-foreground">Leave message if voicemail detected</p>
                </div>
                <Switch
                  checked={form.voicemailEnabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, voicemailEnabled: v }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 shrink-0 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editTarget ? "Save Changes" : "Launch Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
