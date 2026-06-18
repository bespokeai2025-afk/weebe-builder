import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import {
  Megaphone,
  Plus,
  Trash2,
  RefreshCw,
  Play,
  Pause,
  Square,
  X,
  Phone,
  Users,
  CalendarClock,
  Clock,
  Database,
  UserCheck,
  PhoneOutgoing,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import {
  listCampaigns,
  saveCampaign,
  updateCampaignStatus,
  deleteCampaign,
} from "@/lib/telephony/telephony.functions";
import { listPhoneNumbers } from "@/lib/telephony/telephony.functions";
import {
  listAllCallCampaigns,
  toggleCallCampaignPause,
  deleteCallCampaign,
  type CallCampaignWithAgent,
} from "@/lib/dashboard/call-campaigns.functions";
import { getWbahCampaigns, pauseWbahCampaign, resumeWbahCampaign, deleteWbahCampaign } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/campaigns")({
  head: () => ({ meta: [{ title: "Campaigns — Webee" }] }),
  component: CampaignsPage,
});

function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-emerald-500/15 text-emerald-400",
    paused: "bg-amber-500/15 text-amber-400",
    completed: "bg-primary/15 text-primary",
    cancelled: "bg-destructive/15 text-destructive",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[s] ?? "bg-muted text-muted-foreground"}`}>
      {s}
    </span>
  );
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString();
}

type CampaignsTab = "telephony" | "scheduled" | "wbah";

function CampaignsPage() {
  const [activeTab, setActiveTab] = useState<CampaignsTab>("scheduled");
  const [isWbah, setIsWbah] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_workspace_id")
          .eq("user_id", sess.session.user.id)
          .maybeSingle();
        if (!profile?.default_workspace_id || !active) return;
        const { data: ws } = await supabase
          .from("workspaces")
          .select("slug")
          .eq("id", profile.default_workspace_id)
          .maybeSingle();
        if (active) setIsWbah(ws?.slug === "webuyanyhouse");
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  const qc = useQueryClient();
  const listFn = useServerFn(listCampaigns);
  const saveFn = useServerFn(saveCampaign);
  const updateStatusFn = useServerFn(updateCampaignStatus);
  const deleteFn = useServerFn(deleteCampaign);
  const listNumsFn = useServerFn(listPhoneNumbers);

  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<any>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: string } | null>(null);

  const { data: campaigns = [], isFetching, refetch } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listFn({}),
  });
  const campPag = useTablePagination(campaigns, 25);

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-list"],
    queryFn: async () => {
      const { data } = await supabase.from("agents").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: phoneNumbers = [] } = useQuery({
    queryKey: ["phone-numbers"],
    queryFn: () => listNumsFn({}),
  });

  const saveMut = useMutation({
    mutationFn: (v: any) => saveFn({ data: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["campaigns"] }); setShowCreate(false); setEditCampaign(null); },
  });

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: string }) => updateStatusFn({ data: v as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["campaigns"] }); setConfirming(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["campaigns"] }); setConfirming(null); },
  });

  const tabs: { key: CampaignsTab; label: string; icon: React.ReactNode }[] = [
    { key: "scheduled", label: "Scheduled Campaigns", icon: <CalendarClock className="h-3.5 w-3.5" /> },
    { key: "telephony", label: "Telephony Campaigns", icon: <PhoneOutgoing className="h-3.5 w-3.5" /> },
    ...(isWbah ? [{ key: "wbah" as CampaignsTab, label: "WeeBespoke Campaigns", icon: <Building2 className="h-3.5 w-3.5" /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Scheduled call campaigns and bulk outbound campaigns.
          </p>
        </div>
        {activeTab === "telephony" && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5" /> New Campaign
            </Button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-white/[0.06] bg-muted/20 p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "scheduled" && <ScheduledCampaignsTab />}

      {activeTab === "wbah" && <WbahCampaignsTab />}

      {activeTab === "telephony" && (<>
        {(showCreate || editCampaign) && (
          <CampaignDialog
            existing={editCampaign}
            agents={agents}
            phoneNumbers={phoneNumbers}
            onSave={v => saveMut.mutate(v)}
            onClose={() => { setShowCreate(false); setEditCampaign(null); }}
            saving={saveMut.isPending}
          />
        )}

        {confirming && (
          <ConfirmDialog
            message={
              confirming.action === "delete"
                ? "Delete this campaign? This cannot be undone."
                : `Set campaign status to "${confirming.action}"?`
            }
            onConfirm={() => {
              if (confirming.action === "delete") {
                deleteMut.mutate(confirming.id);
              } else {
                statusMut.mutate({ id: confirming.id, status: confirming.action });
              }
            }}
            onClose={() => setConfirming(null)}
            loading={statusMut.isPending || deleteMut.isPending}
            destructive={confirming.action === "delete" || confirming.action === "cancelled"}
          />
        )}

        {campaigns.length === 0 && !isFetching ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
            <Megaphone className="h-10 w-10 opacity-30" />
            <p className="text-sm">No campaigns yet.</p>
            <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5" /> Create your first campaign
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {campPag.sliced.map((c: any) => (
              <div key={c.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold truncate">{c.name}</h3>
                      {statusBadge(c.status)}
                    </div>
                    {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      {c.agent && (<span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.agent.name}</span>)}
                      {c.phone_number && (<span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {c.phone_number.friendly_name ?? c.phone_number.phone_number}</span>)}
                      <span>Created {fmtDate(c.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {c.status === "draft" && (
                      <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                        onClick={() => setConfirming({ id: c.id, action: "active" })}>
                        <Play className="h-3.5 w-3.5" /> Start
                      </Button>
                    )}
                    {c.status === "active" && (
                      <Button size="sm" variant="outline" className="text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                        onClick={() => setConfirming({ id: c.id, action: "paused" })}>
                        <Pause className="h-3.5 w-3.5" /> Pause
                      </Button>
                    )}
                    {c.status === "paused" && (
                      <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                        onClick={() => setConfirming({ id: c.id, action: "active" })}>
                        <Play className="h-3.5 w-3.5" /> Resume
                      </Button>
                    )}
                    {(c.status === "active" || c.status === "paused") && (
                      <Button size="sm" variant="outline" onClick={() => setConfirming({ id: c.id, action: "cancelled" })}>
                        <Square className="h-3.5 w-3.5" /> Stop
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setEditCampaign(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                      onClick={() => setConfirming({ id: c.id, action: "delete" })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-5 gap-3">
                  {[
                    { label: "Total", key: "total" },
                    { label: "Called", key: "called" },
                    { label: "Answered", key: "answered" },
                    { label: "Booked", key: "booked" },
                    { label: "Failed", key: "failed" },
                  ].map(stat => (
                    <div key={stat.key} className="rounded-lg bg-muted/30 px-3 py-2 text-center">
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                      <p className="text-lg font-bold">{c.stats?.[stat.key] ?? 0}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <TablePagBar {...campPag} />
          </div>
        )}
      </>)}
    </div>
  );
}

const PAGE_TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  data: {
    label: "Data Records",
    icon: <Database className="h-3 w-3" />,
    color: "bg-blue-500/15 text-blue-400",
  },
  leads: {
    label: "Leads",
    icon: <Users className="h-3 w-3" />,
    color: "bg-violet-500/15 text-violet-400",
  },
  qualified: {
    label: "Qualified",
    icon: <UserCheck className="h-3 w-3" />,
    color: "bg-emerald-500/15 text-emerald-400",
  },
};

function fmt12(time24: string) {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function ScheduledCampaignsTab() {
  const qc = useQueryClient();
  const listAllFn = useServerFn(listAllCallCampaigns);
  const toggleFn = useServerFn(toggleCallCampaignPause);
  const deleteFn = useServerFn(deleteCallCampaign);

  const { data: campaigns = [], isFetching, refetch } = useQuery({
    queryKey: ["all-call-campaigns"],
    queryFn: () => listAllFn({}),
  });
  const schedPag = useTablePagination(campaigns, 25);

  const toggleMut = useMutation({
    mutationFn: (c: CallCampaignWithAgent) =>
      toggleFn({ data: { id: c.id, currentStatus: c.status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-call-campaigns"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-call-campaigns"] }),
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (isFetching && !campaigns.length) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading campaigns…
      </div>
    );
  }

  if (!campaigns.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
        <CalendarClock className="h-10 w-10 opacity-30" />
        <p className="text-sm font-medium">No scheduled campaigns yet.</p>
        <p className="text-xs max-w-xs">
          Create call campaigns from the Data Records, Leads, or Qualified pages — they'll all appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""} across all sources</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
        </Button>
      </div>

      {schedPag.sliced.map((c) => {
        const ptMeta = PAGE_TYPE_META[c.config.pageType] ?? PAGE_TYPE_META.data;
        const isActive = c.status === "active";
        const toggling = toggleMut.isPending && toggleMut.variables?.id === c.id;
        const deleting = deleteMut.isPending && deletingId === c.id;

        return (
          <div
            key={c.id}
            className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{c.name}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      isActive
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400",
                    )}
                  >
                    {c.status}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", ptMeta.color)}>
                    {ptMeta.icon}
                    {ptMeta.label}
                  </span>

                  {c.config.leadStatusFilter && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted/60 text-muted-foreground">
                      Filter: {c.config.leadStatusFilter}
                    </span>
                  )}

                  {c.agentName && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted/60 text-muted-foreground">
                      <Users className="h-3 w-3" />
                      {c.agentName}
                    </span>
                  )}

                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted/60 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {c.config.callFrequency === "daily"
                      ? `Daily at ${fmt12(c.config.callTime)}`
                      : `Every ${c.config.intervalDays}d at ${fmt12(c.config.callTime)}`}
                  </span>

                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted/60 text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {c.config.timezone.replace("_", " ")}
                  </span>
                </div>

                {c.config.lastRunDate && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Last run: {c.config.lastRunDate}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggling}
                  onClick={() => toggleMut.mutate(c)}
                  className={cn(
                    "h-7 text-xs gap-1",
                    isActive
                      ? "text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                      : "text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10",
                  )}
                >
                  {isActive ? (<><Pause className="h-3 w-3" /> Pause</>) : (<><Play className="h-3 w-3" /> Resume</>)}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleting}
                  onClick={() => { setDeletingId(c.id); deleteMut.mutate(c.id); }}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        );
      })}
      <TablePagBar {...schedPag} />
    </div>
  );
}

function CampaignDialog({
  existing,
  agents,
  phoneNumbers,
  onSave,
  onClose,
  saving,
}: {
  existing?: any;
  agents: any[];
  phoneNumbers: any[];
  onSave: (v: any) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [desc, setDesc] = useState(existing?.description ?? "");
  const [agentId, setAgentId] = useState(existing?.agent_id ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(existing?.phone_number_id ?? "");
  const [targetsRaw, setTargetsRaw] = useState(
    existing?.targets
      ? existing.targets.map((t: any) => (t.name ? `${t.phone} ${t.name}` : t.phone)).join("\n")
      : "",
  );
  const [maxAttempts, setMaxAttempts] = useState(existing?.retry_config?.max_attempts ?? 3);
  const [retryDelay, setRetryDelay] = useState(existing?.retry_config?.retry_delay_minutes ?? 60);

  function parseTargets() {
    return targetsRaw
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean)
      .map((l: string) => {
        const [phone, ...rest] = l.split(/\s+/);
        return { phone, name: rest.join(" ") || undefined };
      });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      ...(existing?.id ? { id: existing.id } : {}),
      name: name.trim(),
      description: desc.trim() || undefined,
      agent_id: agentId || null,
      phone_number_id: phoneNumberId || null,
      targets: parseTargets(),
      retry_config: { max_attempts: Number(maxAttempts), retry_delay_minutes: Number(retryDelay) },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{existing ? "Edit Campaign" : "New Campaign"}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Campaign Name *</label>
            <input required value={name} onChange={e => setName(e.target.value)} placeholder="Q3 Outreach" className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Agent</label>
              <select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">— None —</option>
                {agents.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From Number</label>
              <select value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="">— None —</option>
                {phoneNumbers.map((n: any) => <option key={n.id} value={n.id}>{n.friendly_name ?? n.phone_number}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Target Numbers (one per line, optionally followed by name)
            </label>
            <textarea
              value={targetsRaw}
              onChange={e => setTargetsRaw(e.target.value)}
              rows={6}
              placeholder={"+14155550001 John Smith\n+14155550002\n+14155550003 Jane Doe"}
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <p className="mt-0.5 text-xs text-muted-foreground">{parseTargets().length} target{parseTargets().length !== 1 ? "s" : ""}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Max Retry Attempts</label>
              <input type="number" min={1} max={10} value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Retry Delay (minutes)</label>
              <input type="number" min={1} value={retryDelay} onChange={e => setRetryDelay(e.target.value)} className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : existing ? "Save Changes" : "Create Campaign"}</Button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({
  message,
  onConfirm,
  onClose,
  loading,
  destructive,
}: {
  message: string;
  onConfirm: () => void;
  onClose: () => void;
  loading: boolean;
  destructive?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl">
        <p className="text-sm">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={loading}>
            {loading ? "…" : "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── WeeBespoke Campaigns tab (only shown for webuyanyhouse workspace) ──────────

function wbahStatusBadge(s: string) {
  const map: Record<string, string> = {
    active:    "bg-emerald-500/15 text-emerald-400",
    paused:    "bg-amber-500/15 text-amber-400",
    completed: "bg-primary/15 text-primary",
    draft:     "bg-muted text-muted-foreground",
    cancelled: "bg-destructive/15 text-destructive",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${map[s] ?? "bg-muted text-muted-foreground"}`}>
      {s ?? "unknown"}
    </span>
  );
}

function WbahCampaignsTab() {
  const qc = useQueryClient();
  const getFn    = useServerFn(getWbahCampaigns);
  const pauseFn  = useServerFn(pauseWbahCampaign);
  const resumeFn = useServerFn(resumeWbahCampaign);
  const delFn    = useServerFn(deleteWbahCampaign);

  const { data: campaigns = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["wbah-campaigns"],
    queryFn:  () => getFn(),
    staleTime: 60_000,
    retry: 1,
  });
  const wbahCampPag = useTablePagination(campaigns, 25);

  const pauseMut  = useMutation({ mutationFn: (id: string) => pauseFn({ data: { id } }),  onSuccess: () => qc.invalidateQueries({ queryKey: ["wbah-campaigns"] }) });
  const resumeMut = useMutation({ mutationFn: (id: string) => resumeFn({ data: { id } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["wbah-campaigns"] }) });
  const deleteMut = useMutation({ mutationFn: (id: string) => delFn({ data: { id } }),    onSuccess: () => qc.invalidateQueries({ queryKey: ["wbah-campaigns"] }) });

  if (isLoading) return (
    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
      <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Loading campaigns…
    </div>
  );

  if (error) return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      {(error as Error).message}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Live campaigns from WeeBespoke AI — Webuyanyhouse workspace
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <Megaphone className="h-10 w-10 opacity-30" />
          <p className="text-sm">No WeeBespoke campaigns found.</p>
        </div>
      ) : (
        <>
          {wbahCampPag.sliced.map((c: any) => (
          <div key={c.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold truncate">{c.name ?? c.campaign_name ?? `Campaign ${c.id}`}</h3>
                  {wbahStatusBadge(c.status ?? c.campaign_status ?? "unknown")}
                </div>
                {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  {c.agentName  && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.agentName}</span>}
                  {c.phoneNumber && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {c.phoneNumber}</span>}
                  {c.total_leads != null && <span>{c.total_leads} leads</span>}
                  {c.created_at && <span>Created {new Date(c.created_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {(c.status === "active" || c.campaign_status === "active") && (
                  <Button size="sm" variant="outline" className="text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                    onClick={() => pauseMut.mutate(c.id)} disabled={pauseMut.isPending}>
                    <Pause className="h-3.5 w-3.5" /> Pause
                  </Button>
                )}
                {(c.status === "paused" || c.campaign_status === "paused") && (
                  <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                    onClick={() => resumeMut.mutate(c.id)} disabled={resumeMut.isPending}>
                    <Play className="h-3.5 w-3.5" /> Resume
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                  onClick={() => { if (window.confirm("Delete this campaign?")) deleteMut.mutate(c.id); }}
                  disabled={deleteMut.isPending}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
        <TablePagBar {...wbahCampPag} />
        </>
      )}
    </div>
  );
}
