import { useState, useMemo } from "react";
import { useTablePagination, TablePagBar } from "@/components/ui/table-pagination";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Users,
  Target,
  CheckCircle2,
  StickyNote,
  BarChart3,
} from "lucide-react";
import { CallSchedulingSection } from "@/components/dashboard/CallSchedulingSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard, SummaryTooltip } from "@/components/dashboard/PageShell";
import { toast } from "sonner";
import { listQualifiedLeads, getQualificationStats } from "@/lib/dashboard/qualified.functions";
import { setLeadStatus } from "@/lib/dashboard/leads.functions";
import { listLiveAgents } from "@/lib/agents/agents.functions";
import { NotesBookingSheet } from "@/components/dashboard/NotesBookingSheet";
import type { NotesEntityType } from "@/components/dashboard/NotesBookingSheet";

export const Route = createFileRoute("/_authenticated/qualified")({
  head: () => ({ meta: [{ title: "Qualified — Webee" }] }),
  component: QualifiedPage,
});

function fmtDate(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString(); } catch { return d; }
}

function qualStatusBadge(s: string | null) {
  if (!s) return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, string> = {
    qualified: "bg-emerald-500/15 text-emerald-400",
    partially_qualified: "bg-amber-500/15 text-amber-400",
    not_qualified: "bg-red-500/15 text-red-400",
    callback_required: "bg-blue-500/15 text-blue-400",
  };
  const label = s.replace(/_/g, " ");
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${map[s] ?? "bg-muted text-muted-foreground"}`}>
      {label}
    </span>
  );
}

function scoreBadge(score: number | null) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";
  return <span className={`font-semibold tabular-nums ${color}`}>{score}</span>;
}

function boolBadge(v: boolean | null, trueLabel = "Yes", falseLabel = "No") {
  if (v == null) return <span className="text-muted-foreground text-xs">—</span>;
  return v
    ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400">{trueLabel}</span>
    : <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{falseLabel}</span>;
}

function urgencyBadge(v: string | null) {
  if (!v || v === "none") return <span className="text-muted-foreground text-xs">—</span>;
  const map: Record<string, string> = {
    high: "bg-red-500/15 text-red-400",
    medium: "bg-amber-500/15 text-amber-400",
    low: "bg-emerald-500/15 text-emerald-400",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${map[v] ?? "bg-muted text-muted-foreground"}`}>{v}</span>;
}

const QUAL_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "qualified", label: "Qualified" },
  { value: "partially_qualified", label: "Partial" },
  { value: "not_qualified", label: "Not Qualified" },
  { value: "callback_required", label: "Callback" },
];

const STATUS_ACTIONS = [
  { value: "qualified" as const, label: "Qualified", color: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30" },
  { value: "interested" as const, label: "Open", color: "bg-blue-500/15 text-blue-400 ring-blue-500/30" },
  { value: "not_interested" as const, label: "Closed", color: "bg-red-500/15 text-red-400 ring-red-500/30" },
];

type PanelTarget = {
  entityType: NotesEntityType;
  entityId: string;
  entityName: string;
  defaultPhone?: string;
  defaultEmail?: string;
  leadId?: string | null;
};

function QualifiedPage() {
  const qc = useQueryClient();
  const getLeads = useServerFn(listQualifiedLeads);
  const getStats = useServerFn(getQualificationStats);
  const setStatusFn = useServerFn(setLeadStatus);

  const [search, setSearch] = useState("");
  const [qualFilter, setQualFilter] = useState("all");
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [qualTab, setQualTab] = useState<"contacts" | "campaigns">("contacts");
  const listAgentsFn = useServerFn(listLiveAgents);

  const agentsQ = useQuery({
    queryKey: ["qual-agents"],
    queryFn: () => listAgentsFn(),
    refetchOnWindowFocus: false,
  });
  const qualAgents = (agentsQ.data ?? []) as Array<{ id: string; name: string; retell_agent_id?: string | null }>;

  const leadsQ = useQuery({
    queryKey: ["leads-qualified", search, qualFilter],
    queryFn: () =>
      getLeads({
        data: {
          search: search || undefined,
          qualificationStatus: qualFilter !== "all" ? qualFilter : undefined,
          limit: 200,
        },
      }),
    refetchOnWindowFocus: false,
  });

  const statsQ = useQuery({
    queryKey: ["qualification-stats"],
    queryFn: () => getStats(),
    refetchOnWindowFocus: false,
  });

  const rows = (leadsQ.data ?? []) as any[];
  const stats = statsQ.data;

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r: any) =>
      (r.full_name ?? "").toLowerCase().includes(q) ||
      (r.phone ?? "").toLowerCase().includes(q) ||
      (r.company_name ?? "").toLowerCase().includes(q));
    if (qualFilter !== "all") out = out.filter((r: any) =>
      (r.qualification_status ?? r.status) === qualFilter);
    return out;
  }, [rows, search, qualFilter]);

  const qualPag = useTablePagination(filtered, 25);

  async function handleSetStatus(id: string, status: typeof STATUS_ACTIONS[number]["value"]) {
    try {
      await setStatusFn({ data: { id, status } });
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["leads-qualified"] });
      qc.invalidateQueries({ queryKey: ["qualification-stats"] });
      qc.invalidateQueries({ queryKey: ["leads-all"] });
    } catch (e) {
      toast.error("Failed", { description: (e as Error).message });
    }
  }

  function refresh() {
    qc.invalidateQueries({ queryKey: ["leads-qualified"] });
    qc.invalidateQueries({ queryKey: ["qualification-stats"] });
    qc.invalidateQueries({ queryKey: ["leads-all"] });
  }

  function openPanel(lead: any) {
    setPanel({
      entityType: "lead",
      entityId: lead.id,
      entityName: lead.full_name ?? lead.phone ?? "Lead",
      defaultPhone: lead.phone ?? undefined,
      defaultEmail: lead.email ?? undefined,
      leadId: lead.id,
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Qualified</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Contacts scored and routed after qualification calls
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-white/[0.06]">
        {(["contacts", "campaigns"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setQualTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              qualTab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "contacts" ? (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Contacts
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Campaigns
              </span>
            )}
          </button>
        ))}
      </div>

      {qualTab === "campaigns" && (
        <CallSchedulingSection
          pageType="qualified"
          statusOptions={[
            { value: "qualified", label: "Qualified" },
            { value: "partially_qualified", label: "Partially Qualified" },
            { value: "not_qualified", label: "Not Qualified" },
            { value: "callback_required", label: "Callback Required" },
          ]}
          agents={qualAgents}
        />
      )}

      {qualTab === "contacts" && (
      <>
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-5">
        <KpiCard label="Total" value={stats?.total ?? "—"} icon={Users} iconBg="bg-blue-500/15" iconColor="text-blue-400" />
        <KpiCard
          label="Qualified"
          value={stats?.qualified ?? "—"}
          icon={ShieldCheck}
          iconBg="bg-emerald-500/15"
          iconColor="text-emerald-400"
          hint={stats && stats.total > 0 ? `${stats.qualificationRate}% rate` : undefined}
        />
        <KpiCard label="Partial" value={stats?.partiallyQualified ?? "—"} icon={TrendingUp} iconBg="bg-amber-500/15" iconColor="text-amber-400" />
        <KpiCard label="Avg Score" value={stats?.avgScore ?? "—"} icon={Target} iconBg="bg-violet-500/15" iconColor="text-violet-400" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone…"
            className="h-8 w-52 pl-8 text-xs"
          />
        </div>
        <div className="flex gap-1">
          {QUAL_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setQualFilter(opt.value)}
              className={`rounded px-2.5 py-1 text-xs transition-colors ${qualFilter === opt.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
        <div className="p-0">
          {leadsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-medium">No qualified contacts yet</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
                Build a Client Qualification agent, run calls, and qualified contacts will appear here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-card/30">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Name</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Phone</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Score</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Budget</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Decision</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Interest</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Urgency</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Summary</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next Step</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Last Contact</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Actions</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {qualPag.sliced.map((lead: any) => (
                    <tr
                      key={lead.id}
                      className="h-9 border-b border-white/[0.04] align-middle hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3 py-1.5 text-xs font-medium whitespace-nowrap">
                        {lead.full_name ?? "—"}
                        {lead.company_name && (
                          <div className="text-[11px] text-muted-foreground font-normal">{lead.company_name}</div>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap text-[11px] font-mono">
                        {lead.phone}
                      </td>
                      <td className="px-3 py-1.5">
                        {qualStatusBadge(lead.qualification_status ?? lead.status)}
                      </td>
                      <td className="px-3 py-1.5">{scoreBadge(lead.qualification_score ?? lead.lead_score)}</td>
                      <td className="px-3 py-1.5">{boolBadge(lead.budget_confirmed, "✓", "—")}</td>
                      <td className="px-3 py-1.5">{boolBadge(lead.decision_maker, "✓", "—")}</td>
                      <td className="px-3 py-1.5">
                        {lead.interest_level ? (
                          <span className="text-[11px] capitalize text-muted-foreground">{lead.interest_level}</span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-1.5">{urgencyBadge(lead.urgency)}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[200px] align-middle">
                        <SummaryTooltip text={lead.call_summary} lines={2} />
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-muted-foreground max-w-[160px] align-middle">
                        <span className="line-clamp-1">{lead.next_step ?? lead.next_action ?? "—"}</span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap text-[11px]">
                        {fmtDate(lead.last_contacted_at)}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex gap-1">
                          {STATUS_ACTIONS.map((opt) => (
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
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => openPanel(lead)}
                          title="Notes & appointment"
                          className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
                        >
                          <StickyNote className="h-3 w-3" />
                          <span>Notes</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagBar page={qualPag.page} pageSize={qualPag.pageSize} totalPages={qualPag.totalPages} total={qualPag.total} setPage={qualPag.setPage} changePageSize={qualPag.changePageSize} />
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {/* Notes & Booking sheet */}
      {panel && (
        <NotesBookingSheet
          open={!!panel}
          onOpenChange={(o) => { if (!o) setPanel(null); }}
          entityType={panel.entityType}
          entityId={panel.entityId}
          entityName={panel.entityName}
          defaultPhone={panel.defaultPhone}
          defaultEmail={panel.defaultEmail}
          leadId={panel.leadId}
        />
      )}
    </div>
  );
}
