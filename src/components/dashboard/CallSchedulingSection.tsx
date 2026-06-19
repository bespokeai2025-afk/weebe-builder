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

// ── Types ─────────────────────────────────────────────────────────────────────

type WbahAgent = {
  id: string;
  name: string;
  status: string;
  voicemail_enabled: boolean;
  phone_number: string | null;
};

type NormalizedCampaign = {
  id: string;
  name: string;
  status: string;
  agent_id: string | null;
  created_at: string;
  lead_status: string | null;
  call_time: string;
  timezone: string;
  frequency_type: "daily" | "custom";
  interval_days: number;
  voicemail_enabled: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEZONES = [
  { value: "Europe/London",       label: "London (GMT/BST)" },
  { value: "Europe/Paris",        label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin",       label: "Berlin (CET/CEST)" },
  { value: "America/New_York",    label: "New York (ET)" },
  { value: "America/Chicago",     label: "Chicago (CT)" },
  { value: "America/Denver",      label: "Denver (MT)" },
  { value: "America/Los_Angeles", label: "Los Angeles (PT)" },
  { value: "Asia/Dubai",          label: "Dubai (GST)" },
  { value: "Asia/Kolkata",        label: "Kolkata (IST)" },
  { value: "Asia/Singapore",      label: "Singapore (SGT)" },
  { value: "Australia/Sydney",    label: "Sydney (AEST)" },
];

const STATUS_OPTIONS = [
  { value: "new",               label: "New" },
  { value: "disqualified",      label: "Disqualified" },
  { value: "tried_to_contact",  label: "Tried to Contact" },
  { value: "qualified",         label: "Qualified" },
  { value: "contacted",         label: "Contacted" },
];

const BLANK = {
  name:             "",
  agentId:          "",
  leadStatus:       "",
  callTime:         "09:00",
  timezone:         "Europe/London",
  frequencyType:    "daily" as "daily" | "custom",
  intervalDays:     1,
  voicemailEnabled: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt12(time24: string) {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function scheduleLabel(c: NormalizedCampaign) {
  if (c.frequency_type === "daily") return `Every 1 day(s) at ${fmt12(c.call_time)}`;
  return `Every ${c.interval_days} day(s) at ${fmt12(c.call_time)}`;
}

function normalizeRawCampaign(raw: any): NormalizedCampaign {
  return {
    id:               raw._id ?? raw.id ?? "",
    name:             raw.campaign_name ?? raw.name ?? "",
    status:           raw.status ?? "active",
    agent_id:         raw.agent_id ?? null,
    created_at:       raw.created_at ?? raw.createdAt ?? "",
    lead_status:      raw.lead_status ?? raw.leadStatus ?? null,
    call_time:        raw.call_time ?? raw.callTime ?? "09:00",
    timezone:         raw.timezone ?? "Europe/London",
    frequency_type:   raw.frequency_type === "custom" ? "custom" : "daily",
    interval_days:    raw.interval_days ?? raw.intervalDays ?? 1,
    voicemail_enabled: raw.voicemail_enabled ?? raw.voicemailEnabled ?? false,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CallSchedulingSection() {
  const qc         = useQueryClient();
  const listFn     = useServerFn(getWbahCampaigns);
  const createFn   = useServerFn(createWbahCampaign);
  const updateFn   = useServerFn(updateWbahCampaignSettings);
  const deleteFn   = useServerFn(deleteWbahCampaign);
  const pauseFn    = useServerFn(pauseWbahCampaign);
  const resumeFn   = useServerFn(resumeWbahCampaign);
  const voiceFn    = useServerFn(toggleWbahCampaignVoicemailSetting);
  const agentsFn   = useServerFn(getWbahAgentsForCampaign);

  const [search,     setSearch]     = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NormalizedCampaign | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [form,       setForm]       = useState(BLANK);

  const QK_CAMPAIGNS = ["wbah-campaigns"];
  const QK_AGENTS    = ["wbah-campaign-agents"];

  const campaignsQ = useQuery({
    queryKey: QK_CAMPAIGNS,
    queryFn: async () => {
      const raw = await listFn();
      const arr: any[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as any)?.data)
          ? (raw as any).data
          : [];
      return arr.map(normalizeRawCampaign);
    },
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const agentsQ = useQuery({
    queryKey: QK_AGENTS,
    queryFn: () => agentsFn(),
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const campaigns = (campaignsQ.data ?? []) as NormalizedCampaign[];
  const agents    = (agentsQ.data ?? []) as WbahAgent[];

  const filtered = search.trim()
    ? campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : campaigns;

  const totalActive = campaigns.filter((c) => c.status === "active").length;
  const totalDaily  = campaigns.filter((c) => c.frequency_type === "daily").length;
  const totalCustom = campaigns.filter((c) => c.frequency_type === "custom").length;

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK);
    setDialogOpen(true);
  }

  function openEdit(c: NormalizedCampaign) {
    setEditTarget(c);
    setForm({
      name:             c.name,
      agentId:          c.agent_id ?? "",
      leadStatus:       c.lead_status ?? "",
      callTime:         c.call_time,
      timezone:         c.timezone,
      frequencyType:    c.frequency_type,
      intervalDays:     c.interval_days,
      voicemailEnabled: c.voicemail_enabled,
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error("Campaign name is required"); return; }
    setSaving(true);
    try {
      const payload = {
        campaign_name:    form.name.trim(),
        agent_id:         form.agentId || null,
        lead_status:      form.leadStatus || null,
        call_time:        form.callTime,
        timezone:         form.timezone,
        frequency_type:   form.frequencyType,
        interval_days:    form.frequencyType === "custom" ? form.intervalDays : undefined,
        voicemail_enabled: form.voicemailEnabled,
      };

      if (editTarget) {
        await updateFn({ data: { id: editTarget.id, ...payload } });
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

  async function handleDelete(id: string) {
    try {
      await deleteFn({ data: { id } });
      toast.success("Campaign deleted");
      qc.invalidateQueries({ queryKey: QK_CAMPAIGNS });
    } catch (e) {
      toast.error("Failed to delete campaign", { description: (e as Error).message });
    }
  }

  async function handleTogglePause(c: NormalizedCampaign) {
    try {
      if (c.status === "active") {
        await pauseFn({ data: { id: c.id } });
      } else {
        await resumeFn({ data: { id: c.id } });
      }
      qc.invalidateQueries({ queryKey: QK_CAMPAIGNS });
    } catch (e) {
      toast.error("Failed to update campaign", { description: (e as Error).message });
    }
  }

  async function handleVoicemailToggle(c: NormalizedCampaign) {
    try {
      await voiceFn({ data: { id: c.id, voicemail_enabled: !c.voicemail_enabled } });
      qc.invalidateQueries({ queryKey: QK_CAMPAIGNS });
    } catch (e) {
      toast.error("Failed to update voicemail setting", { description: (e as Error).message });
    }
  }

  const agentLabel = (agentId: string | null) => {
    if (!agentId) return "—";
    const a = agents.find((ag) => ag.id === agentId);
    if (!a) return agentId.slice(0, 20) + "…";
    return a.name;
  };

  const statusLabel = (filter: string | null) => {
    if (!filter) return "All Leads (no filter)";
    return STATUS_OPTIONS.find((s) => s.value === filter)?.label ?? filter;
  };

  return (
    <div className="space-y-5">
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Total Campaigns",
            value: campaigns.length,
            icon:  Phone,
            color: "text-blue-400",
            bg:    "bg-blue-500/10",
            sub:   `${campaigns.filter((c) => c.status === "paused").length} paused`,
          },
          {
            label: "Active Campaigns",
            value: totalActive,
            icon:  CheckCircle2,
            color: "text-emerald-400",
            bg:    "bg-emerald-500/10",
            sub:   "Running now",
          },
          {
            label: "Daily Campaigns",
            value: totalDaily,
            icon:  PhoneCall,
            color: "text-violet-400",
            bg:    "bg-violet-500/10",
            sub:   "Recurring daily",
          },
          {
            label: "Custom Interval",
            value: totalCustom,
            icon:  Clock,
            color: "text-amber-400",
            bg:    "bg-amber-500/10",
            sub:   "Custom schedule",
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
            <div className={cn("mb-2 inline-flex rounded-lg p-2", s.bg)}>
              <s.icon className={cn("h-4 w-4", s.color)} />
            </div>
            <p className={cn("text-xl font-bold tabular-nums", s.color)}>{s.value}</p>
            <p className="text-xs font-medium text-foreground mt-0.5">{s.label}</p>
            <p className="text-[10px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Search + refresh */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search call campaigns…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => campaignsQ.refetch()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", campaignsQ.isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* Campaign list */}
      {campaignsQ.isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading campaigns…</p>
      ) : campaignsQ.isError ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center">
          <Phone className="h-8 w-8 text-destructive/40" />
          <p className="text-sm font-medium text-destructive">Failed to load campaigns</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            {(campaignsQ.error as Error)?.message ?? "Unknown error"}
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => campaignsQ.refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        </div>
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
                    onClick={() => handleTogglePause(c)}
                    className="rounded p-1.5 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                  >
                    {c.status === "active"
                      ? <Pause className="h-3.5 w-3.5" />
                      : <Play  className="h-3.5 w-3.5" />}
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
                  <p className="font-medium text-foreground mt-0.5">{c.timezone}</p>
                </div>
              </div>

              {/* Footer: frequency + voicemail */}
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-2.5">
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                  <span>
                    Frequency:{" "}
                    <span className="text-foreground font-medium capitalize">
                      {c.frequency_type === "custom" ? "Custom" : "Daily"}
                    </span>
                  </span>
                  {c.frequency_type === "custom" && (
                    <span>
                      Interval days:{" "}
                      <span className="text-foreground font-medium">{c.interval_days}</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>Voicemail</span>
                  <Switch
                    checked={c.voicemail_enabled}
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
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">Select Call Agent</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] gap-1"
                    onClick={() => agentsQ.refetch()}
                    disabled={agentsQ.isFetching}
                  >
                    <RefreshCw className={cn("h-2.5 w-2.5", agentsQ.isFetching && "animate-spin")} />
                    Refresh Agents
                  </Button>
                </div>
                {agentsQ.isLoading ? (
                  <p className="text-[11px] text-muted-foreground">Loading agents…</p>
                ) : agentsQ.isError ? (
                  <p className="text-[11px] text-destructive">
                    Failed to load agents — {(agentsQ.error as Error)?.message ?? "unknown error"}
                  </p>
                ) : agents.length === 0 ? (
                  <p className="text-[11px] text-amber-400">
                    No campaign agents found. Check your WebespokeAI account.
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
                  Agents are fetched from your WebespokeAI account
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
                  value={form.leadStatus || "__all__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, leadStatus: v === "__all__" ? "" : v }))}
                >
                  <SelectTrigger className="mt-1 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Leads (no filter)</SelectItem>
                    {STATUS_OPTIONS.map((s) => (
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
                      onClick={() => setForm((f) => ({ ...f, frequencyType: freq }))}
                      className={cn(
                        "flex-1 py-1.5 text-xs font-medium transition-colors capitalize",
                        form.frequencyType === freq
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {freq === "daily" ? "Daily" : "Custom Interval"}
                    </button>
                  ))}
                </div>
              </div>
              {form.frequencyType === "custom" && (
                <div>
                  <Label className="text-xs">Interval (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    className="mt-1 h-8 text-xs w-32"
                    value={form.intervalDays}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      intervalDays: Math.max(1, Number(e.target.value) || 1),
                    }))}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
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
