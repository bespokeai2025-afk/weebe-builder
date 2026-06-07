import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Users,
  Phone,
  RefreshCw,
  TrendingUp,
  Target,
  CalendarCheck,
  BarChart3,
  Brain,
  Plus,
  Trash2,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { KpiCard, MiniKpiCard } from "@/components/dashboard/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { listLeads, setLeadStatus, startQualificationCallsForLeads } from "@/lib/dashboard/leads.functions";
import {
  listCampaigns,
  createCampaign,
  deleteCampaign,
  getCampaignStats,
} from "@/lib/dashboard/campaigns.functions";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({ meta: [{ title: "Leads — Webee" }] }),
  component: LeadsPage,
});

function fmtDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString();
  } catch {
    return d;
  }
}

function sentimentBadge(s: string | null) {
  if (!s) return null;
  const map: Record<string, string> = {
    positive: "bg-emerald-500/15 text-emerald-400",
    neutral: "bg-amber-500/15 text-amber-400",
    negative: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${map[s] ?? "bg-muted text-muted-foreground"}`}>
      {s}
    </span>
  );
}

function scoreBadge(score: number | null) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color =
    score >= 70
      ? "text-emerald-400"
      : score >= 40
        ? "text-amber-400"
        : "text-red-400";
  return <span className={`font-semibold ${color}`}>{score}</span>;
}

function interestBadge(level: string | null) {
  if (!level) return null;
  const map: Record<string, string> = {
    high: "bg-emerald-500/15 text-emerald-400",
    medium: "bg-amber-500/15 text-amber-400",
    low: "bg-red-500/15 text-red-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${map[level] ?? "bg-muted text-muted-foreground"}`}>
      {level}
    </span>
  );
}

const STATUS_OPTIONS = [
  { value: "interested", label: "Open", color: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" },
  { value: "qualified", label: "Qualified", color: "bg-violet-500/15 text-violet-400 ring-violet-500/30" },
  { value: "callback_requested", label: "Callback Requested", color: "bg-amber-500/15 text-amber-400 ring-amber-500/30" },
  { value: "need_to_call", label: "Needs to Call", color: "bg-sky-500/15 text-sky-400 ring-sky-500/30" },
  { value: "not_interested", label: "Closed", color: "bg-red-500/15 text-red-400 ring-red-500/30" },
  { value: "completed", label: "Completed", color: "bg-blue-500/15 text-blue-400 ring-blue-500/30" },
] as const;

function statusDisplay(status: string | null) {
  const opt = STATUS_OPTIONS.find((o) => o.value === status);
  if (opt) return opt;
  return { value: status ?? "", label: status?.replace(/_/g, " ") ?? "—", color: "bg-muted text-muted-foreground ring-border" };
}

function LeadsPage() {
  const qc = useQueryClient();
  const listLeadsFn = useServerFn(listLeads);
  const setStatusFn = useServerFn(setLeadStatus);
  const listCampaignsFn = useServerFn(listCampaigns);
  const createCampaignFn = useServerFn(createCampaign);
  const deleteCampaignFn = useServerFn(deleteCampaign);
  const getCampaignStatsFn = useServerFn(getCampaignStats);
  const getAgentsFn = useServerFn(getDashboardLiveAgents);
  const startQualFn = useServerFn(startQualificationCallsForLeads);

  const [tab, setTab] = useState<"leads" | "campaigns">("leads");
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qualDialogOpen, setQualDialogOpen] = useState(false);
  const [qualAgentId, setQualAgentId] = useState<string>("");
  const [qualFromNumber, setQualFromNumber] = useState<string>("");
  const [qualRunning, setQualRunning] = useState(false);

  const leadsQ = useQuery({
    queryKey: ["leads-all"],
    queryFn: () => listLeadsFn({ data: { limit: 200 } }),
  });

  const campaignsQ = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listCampaignsFn(),
  });

  const statsQ = useQuery({
    queryKey: ["campaign-stats"],
    queryFn: () => getCampaignStatsFn({ data: {} }),
  });

  const agentsQ = useQuery({
    queryKey: ["dashboard-live-agents"],
    queryFn: () => getAgentsFn(),
    staleTime: 30_000,
  });

  const leads = (leadsQ.data ?? []) as any[];
  const campaigns = campaignsQ.data ?? [];
  const stats = statsQ.data;
  const allAgents = (agentsQ.data ?? []) as any[];
  const qualAgents = allAgents.filter((a: any) => a.agentType === "client_qualification");

  const filtered = leads.filter((l: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (l.full_name ?? "").toLowerCase().includes(q) ||
      (l.phone ?? "").includes(q) ||
      (l.email ?? "").toLowerCase().includes(q) ||
      (l.company_name ?? "").toLowerCase().includes(q)
    );
  });

  const positive = leads.filter((l: any) => l.sentiment === "positive").length;
  const withScore = leads.filter((l: any) => l.lead_score != null);
  const avgScore =
    withScore.length > 0
      ? Math.round(withScore.reduce((a: number, l: any) => a + l.lead_score, 0) / withScore.length)
      : null;
  const meetingsReq = leads.filter((l: any) => l.meeting_requested).length;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((l: any) => l.id)));
    }
  }

  async function handleSetStatus(id: string, status: typeof STATUS_OPTIONS[number]["value"]) {
    try {
      await setStatusFn({ data: { id, status } });
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed to update status", { description: (e as Error).message });
    }
  }

  async function handleCreateCampaign() {
    if (!campaignName.trim()) return;
    try {
      await createCampaignFn({ data: { name: campaignName.trim() } });
      toast.success("Campaign created");
      setCampaignName("");
      setNewCampaignOpen(false);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (e) {
      toast.error("Failed to create campaign", { description: (e as Error).message });
    }
  }

  async function handleDeleteCampaign(id: string) {
    try {
      await deleteCampaignFn({ data: { id } });
      toast.success("Campaign deleted");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (e) {
      toast.error("Failed to delete campaign", { description: (e as Error).message });
    }
  }

  async function handleStartQualification() {
    if (!qualAgentId || selectedIds.size === 0) return;
    setQualRunning(true);
    try {
      const result = await startQualFn({
        data: {
          leadIds: Array.from(selectedIds),
          agentId: qualAgentId,
          fromNumber: qualFromNumber || null,
        },
      });
      toast.success(`Qualification started — ${result.placed} calls placed`, {
        description: result.failed > 0 ? `${result.failed} failed` : undefined,
      });
      setQualDialogOpen(false);
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed to start qualification", { description: (e as Error).message });
    } finally {
      setQualRunning(false);
    }
  }

  function openQualDialog() {
    if (selectedIds.size === 0) {
      toast.error("Select at least one lead first");
      return;
    }
    const defaultAgent = qualAgents[0];
    if (defaultAgent && !qualAgentId) setQualAgentId(defaultAgent.id);
    if (defaultAgent?.phoneNumber && !qualFromNumber) setQualFromNumber(defaultAgent.phoneNumber);
    setQualDialogOpen(true);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lead Generation intelligence — updated automatically after every call
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "leads" && selectedIds.size > 0 && (
            <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:text-blue-300" onClick={openQualDialog}>
              <ShieldCheck className="mr-1 h-4 w-4" />
              Qualify {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => {
            leadsQ.refetch();
            campaignsQ.refetch();
            statsQ.refetch();
          }}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <KpiCard label="Total Leads" value={leads.length} icon={Users} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
        <KpiCard
          label="Positive Sentiment"
          value={positive}
          icon={TrendingUp}
          iconBg="bg-emerald-500/15"
          iconColor="text-emerald-400"
          hint={leads.length > 0 ? `${Math.round((positive / leads.length) * 100)}%` : undefined}
        />
        <KpiCard
          label="Avg Lead Score"
          value={avgScore ?? "—"}
          icon={Target}
          iconBg="bg-violet-500/15"
          iconColor="text-violet-400"
        />
        <KpiCard label="Meetings Req." value={meetingsReq} icon={CalendarCheck} iconBg="bg-amber-500/15" iconColor="text-amber-400" />
      </div>

      {/* Campaign stats mini strip */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
          <MiniKpiCard label="Calls Made" value={stats.called} hint={`of ${stats.total} records`} />
          <MiniKpiCard label="Contacts Reached" value={stats.reached} hint={`${stats.conversionRate}% connect rate`} />
          <MiniKpiCard label="Positive Sentiment" value={`${stats.positivePct}%`} />
          <MiniKpiCard label="Meetings Booked" value={stats.meetingsBooked} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b">
        {(["leads", "campaigns"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "leads" ? (
              <span className="flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" /> Lead Intelligence
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Campaigns
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Lead Intelligence Tab */}
      {tab === "leads" && (
        <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Lead Records
              {selectedIds.size > 0 && (
                <span className="ml-2 normal-case text-xs font-normal text-blue-400 tracking-normal">{selectedIds.size} selected</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
              )}
              <Input
                placeholder="Search name, phone, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 w-48 text-xs"
              />
            </div>
          </div>
          <div className="p-0">
            {leadsQ.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Users className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">No leads yet</p>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Once a Lead Generation agent completes a call, lead intelligence will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-card/30">
                      <th className="px-3 py-2.5 w-8">
                        <Checkbox
                          checked={selectedIds.size === filtered.length && filtered.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Sentiment</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Score</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Interest</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next Action</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Last Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((lead: any) => (
                      <tr
                        key={lead.id}
                        className={`h-11 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors ${selectedIds.has(lead.id) ? "bg-blue-500/5" : ""}`}
                      >
                        <td className="px-3 py-2.5">
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                          />
                        </td>
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                          {lead.full_name ?? "—"}
                          {lead.company_name && (
                            <div className="text-[11px] text-muted-foreground font-normal">{lead.company_name}</div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-xs font-mono">
                          {lead.phone}
                        </td>
                        {/* Status picker */}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-1">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${statusDisplay(lead.status).color}`}>
                              {statusDisplay(lead.status).label}
                            </span>
                            <div className="flex gap-1 mt-0.5">
                              {STATUS_OPTIONS.map((opt) => (
                                <button
                                  key={opt.value}
                                  title={`Mark as ${opt.label}`}
                                  onClick={() => handleSetStatus(lead.id, opt.value)}
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity ring-1 ${opt.color} ${lead.status === opt.value ? "opacity-100" : "opacity-40 hover:opacity-80"}`}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{sentimentBadge(lead.sentiment)}</td>
                        <td className="px-3 py-2.5">{scoreBadge(lead.lead_score)}</td>
                        <td className="px-3 py-2.5">{interestBadge(lead.interest_level)}</td>
                        {/* Call summary */}
                        <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[220px] align-top">
                          <span className="line-clamp-3">{lead.call_summary ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[180px] align-top">
                          <span className="line-clamp-2">{lead.next_action ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                          {fmtDate(lead.last_contacted_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Campaigns Tab */}
      {tab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setNewCampaignOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Campaign
            </Button>
          </div>

          {campaignsQ.isLoading ? (
            <p className="text-center text-sm text-muted-foreground py-8">Loading…</p>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No campaigns yet</p>
              <p className="text-sm text-muted-foreground">
                Create a campaign in the builder (Agent Type → Lead Generation → Campaign Settings) or here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c: any) => (
                <Card key={c.id}>
                  <CardContent className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      {c.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Created {fmtDate(c.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize text-[11px]">
                        {c.status}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteCampaign(c.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assign Qualification Agent Dialog */}
      <Dialog open={qualDialogOpen} onOpenChange={setQualDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-400" />
              Assign Qualification Agent
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <p className="text-sm text-muted-foreground">
              Start qualification calls for <span className="font-semibold text-foreground">{selectedIds.size}</span> selected lead{selectedIds.size !== 1 ? "s" : ""}.
            </p>
            {qualAgents.length === 0 ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-400">
                No live Client Qualification agents found. Build and go-live with a qualification agent in the Builder first.
              </div>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Qualification Agent</Label>
                  <Select value={qualAgentId} onValueChange={(v) => {
                    setQualAgentId(v);
                    const agent = qualAgents.find((a: any) => a.id === v);
                    if (agent?.phoneNumber) setQualFromNumber(agent.phoneNumber);
                  }}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select an agent…" />
                    </SelectTrigger>
                    <SelectContent>
                      {qualAgents.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                          {a.phoneNumber && <span className="ml-2 text-muted-foreground text-xs">{a.phoneNumber}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">From Number (optional override)</Label>
                  <Input
                    value={qualFromNumber}
                    onChange={(e) => setQualFromNumber(e.target.value)}
                    placeholder="+1 555 000 0000"
                    className="mt-1 h-8 text-xs"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQualDialogOpen(false)} disabled={qualRunning}>
              Cancel
            </Button>
            <Button
              onClick={handleStartQualification}
              disabled={!qualAgentId || qualAgents.length === 0 || qualRunning}
            >
              {qualRunning ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Phone className="mr-1 h-4 w-4" />
                  Start {selectedIds.size} Call{selectedIds.size !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Campaign Dialog */}
      <Dialog open={newCampaignOpen} onOpenChange={setNewCampaignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Campaign Name</Label>
              <Input
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="e.g. Q3 Outbound — SMB"
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreateCampaign()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewCampaignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCampaign} disabled={!campaignName.trim()}>
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
