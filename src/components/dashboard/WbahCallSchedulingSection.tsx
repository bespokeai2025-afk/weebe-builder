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
  getWbahCampaigns,
  createWbahCampaign,
  updateWbahCampaignSettings,
  deleteWbahCampaign,
  pauseWbahCampaign,
  resumeWbahCampaign,
  toggleWbahCampaignVoicemailSetting,
  getWbahAgentsForCampaign,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";

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

const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "interested", label: "Interested" },
  { value: "qualified", label: "Qualified" },
  { value: "not_interested", label: "Not Interested" },
  { value: "callback_requested", label: "Callback Requested" },
  { value: "no_answer", label: "No Answer" },
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
];

function fmt12(time24: string) {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

type WbahCampaign = {
  _id?: string;
  id?: string;
  campaign_name?: string;
  name?: string;
  status?: string;
  agent_id?: string | null;
  lead_status?: string | null;
  call_time?: string;
  timezone?: string;
  frequency_type?: "daily" | "custom";
  interval_days?: number;
  voicemail_enabled?: boolean;
};

type WbahAgent = {
  id: string;
  name: string;
  status?: string;
  voicemail_enabled?: boolean;
  phone_number?: string | null;
};

const BLANK = {
  campaign_name: "",
  agent_id: "",
  lead_status: "",
  call_time: "09:00",
  timezone: "Europe/London",
  frequency_type: "daily" as "daily" | "custom",
  interval_days: 1,
  voicemail_enabled: false,
};

function campaignId(c: WbahCampaign) { return c._id ?? c.id ?? ""; }
function campaignName(c: WbahCampaign) { return c.campaign_name ?? c.name ?? "Untitled"; }
function campaignStatus(c: WbahCampaign) { return (c.status ?? "active").toLowerCase(); }
function scheduleLabel(c: WbahCampaign) {
  const t = c.call_time ?? "09:00";
  if ((c.frequency_type ?? "daily") === "daily") return `Every 1 day(s) at ${fmt12(t)}`;
  return `Every ${c.interval_days ?? 1} day(s) at ${fmt12(t)}`;
}

const QK_CAMPAIGNS = ["wbah-campaigns"];
const QK_AGENTS    = ["wbah-campaign-agents"];

export function WbahCallSchedulingSection() {
  const qc = useQueryClient();

  const listFn   = useServerFn(getWbahCampaigns);
  const agentsFn = useServerFn(getWbahAgentsForCampaign);
  const createFn = useServerFn(createWbahCampaign);
  const updateFn = useServerFn(updateWbahCampaignSettings);
  const deleteFn = useServerFn(deleteWbahCampaign);
  const pauseFn  = useServerFn(pauseWbahCampaign);
  const resumeFn = useServerFn(resumeWbahCampaign);
  const vmFn     = useServerFn(toggleWbahCampaignVoicemailSetting);

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WbahCampaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(BLANK);

  const campaignsQ = useQuery({
    queryKey: QK_CAMPAIGNS,
    queryFn: () => listFn(),
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const agentsQ = useQuery({
    queryKey: QK_AGENTS,
    queryFn: () => agentsFn(),
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const campaigns = (campaignsQ.data ?? []) as WbahCampaign[];
  const agents    = (agentsQ.data ?? []) as WbahAgent[];

  const filtered = search.trim()
    ? campaigns.filter((c) => campaignName(c).toLowerCase().includes(search.toLowerCase()))
    : campaigns;

  const totalActive = campaigns.filter((c) => campaignStatus(c) === "active").length;
  const totalDaily  = campaigns.filter((c) => (c.frequency_type ?? "daily") === "daily").length;
  const totalCustom = campaigns.filter((c) => c.frequency_type === "custom").length;

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK);
    setDialogOpen(true);
  }

  function openEdit(c: WbahCampaign) {
    setEditTarget(c);
    setForm({
      campaign_name:    campaignName(c),
      agent_id:         c.agent_id ?? "",
      lead_status:      c.lead_status ?? "",
      call_time:        c.call_time ?? "09:00",
      timezone:         c.timezone ?? "Europe/London",
      frequency_type:   c.frequency_type ?? "daily",
      interval_days:    c.interval_days ?? 1,
      voicemail_enabled: c.voicemail_enabled ?? false,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.campaign_name.trim()) { toast.error("Campaign name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        campaign_name:    form.campaign_name.trim(),
        agent_id:         form.agent_id || null,
        lead_status:      form.lead_status || null,
        call_time:        form.call_time,
        timezone:         form.timezone,
        frequency_type:   form.frequency_type,
        interval_days:    form.interval_days,
        voicemail_enabled: form.voicemail_enabled,
      };
      if (editTarget) {
        await updateFn({ data: { id: campaignId(editTarget), ...payload } });
        toast.success("Campaign updated");
      } else {
        await createFn({ data: payload });
        toast.success("Campaign created");
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: QK_CAMPAIGNS });
    } catch (e) {
      toast.error("Failed to save campaign", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: WbahCampaign) {
    try {
      await deleteFn({ data: { id: campaignId(c) } });
      toast.success("Campaign deleted");
      qc.invalidateQueries({ queryKey: QK_CAMPAIGNS });
    } catch (e) {
      toast.error("Failed to delete campaign", { description: (e as Error).message });
    }
  }

  async function handleToggle(c: WbahCampaign) {
    try {
      const isActive = campaignStatus(c) === "active";
      if (isActive) {
        await pauseFn({ data: { id: campaignId(c) } });
      } else {
        await resumeFn({ data: { id: campaignId(c) } });
      }
      qc.invalidateQueries({ queryKey: QK_CAMPAIGNS });
    } catch (e) {
      toast.error("Failed to update campaign", { description: (e as Error).message });
    }
  }

  async function handleVoicemailToggle(c: WbahCampaign) {
    try {
      await vmFn({ data: { id: campaignId(c), voicemail_enabled: !(c.voicemail_enabled ?? false) } });
      qc.invalidateQueries({ queryKey: QK_CAMPAIGNS });
    } catch (e) {
      toast.error("Failed to update voicemail setting", { description: (e as Error).message });
    }
  }

  const agentLabel = (agentId: string | null | undefined) => {
    if (!agentId) return "—";
    const a = agents.find((ag) => ag.id === agentId);
    return a ? a.name : agentId.slice(0, 20) + "…";
  };

  const statusLabel = (filter: string | null | undefined) => {
    if (!filter) return "All Leads (no filter)";
    return LEAD_STATUS_OPTIONS.find((s) => s.value === filter)?.label ?? filter;
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
          { label: "Total Campaigns", value: campaigns.length, icon: Phone, color: "text-blue-400", bg: "bg-blue-500/10", sub: `${campaigns.filter((c) => campaignStatus(c) === "paused").length} paused` },
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

      {/* Error state */}
      {campaignsQ.isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          Failed to load campaigns. {(campaignsQ.error as Error)?.message}
        </div>
      )}

      {/* Campaign list */}
      {campaignsQ.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 && !campaignsQ.isError ? (
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
            <div key={campaignId(c)} className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
                    <Phone className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{campaignName(c)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    campaignStatus(c) === "active"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {campaignStatus(c) === "active" ? "● Active" : "● Paused"}
                  </span>
                  <button
                    title={campaignStatus(c) === "active" ? "Pause" : "Resume"}
                    onClick={() => handleToggle(c)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                  >
                    {campaignStatus(c) === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
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
                    onClick={() => handleDelete(c)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Lead Status</p>
                  <p className="font-medium text-foreground mt-0.5">{statusLabel(c.lead_status)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Agent</p>
                  <p className="font-medium text-foreground mt-0.5 truncate">{agentLabel(c.agent_id)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Schedule</p>
                  <p className="font-medium text-foreground mt-0.5">{scheduleLabel(c)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Timezone</p>
                  <p className="font-medium text-foreground mt-0.5">{c.timezone ?? "—"}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-2.5">
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                  <span>
                    Frequency:{" "}
                    <span className="text-foreground font-medium">
                      {(c.frequency_type ?? "daily") === "custom" ? "Custom" : "Daily"}
                    </span>
                  </span>
                  {c.frequency_type === "custom" && (
                    <span>
                      Interval days:{" "}
                      <span className="text-foreground font-medium">{c.interval_days ?? 1}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>Voicemail</span>
                  <Switch
                    checked={c.voicemail_enabled ?? false}
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
                  placeholder="e.g. Follow-up New Leads"
                  value={form.campaign_name}
                  onChange={(e) => setForm((f) => ({ ...f, campaign_name: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Select Call Agent</Label>
                {agentsQ.isLoading ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">Loading agents…</p>
                ) : agents.length === 0 ? (
                  <p className="mt-1 text-[11px] text-amber-400">
                    No agents found in your WeeBespoke account.
                  </p>
                ) : (
                  <Select
                    value={form.agent_id || "__none__"}
                    onValueChange={(v) => setForm((f) => ({ ...f, agent_id: v === "__none__" ? "" : v }))}
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
                  value={form.lead_status || "__all__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, lead_status: v === "__all__" ? "" : v }))}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Leads (no filter)</SelectItem>
                    {LEAD_STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                    value={form.call_time}
                    onChange={(e) => setForm((f) => ({ ...f, call_time: e.target.value }))}
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
                      onClick={() => setForm((f) => ({ ...f, frequency_type: freq }))}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-medium transition-colors",
                        form.frequency_type === freq
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {freq === "daily" ? "Daily" : "Custom Interval"}
                    </button>
                  ))}
                </div>
              </div>
              {form.frequency_type === "custom" && (
                <div>
                  <Label className="text-xs">Interval (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    className="mt-1 h-8 text-xs w-32"
                    value={form.interval_days}
                    onChange={(e) => setForm((f) => ({ ...f, interval_days: Math.max(1, Number(e.target.value) || 1) }))}
                  />
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <div>
                  <Label className="text-xs">Voicemail detection</Label>
                  <p className="text-[10px] text-muted-foreground">Leave message if voicemail detected</p>
                </div>
                <Switch
                  checked={form.voicemail_enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, voicemail_enabled: v }))}
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
