import { useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { listQualifiedLeads, getQualificationStats } from "@/lib/dashboard/qualified.functions";
import { setLeadStatus } from "@/lib/dashboard/leads.functions";

export const Route = createFileRoute("/_authenticated/qualified")({
  head: () => ({ meta: [{ title: "Qualified — Webespoke AI" }] }),
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

function QualifiedPage() {
  const qc = useQueryClient();
  const getLeads = useServerFn(listQualifiedLeads);
  const getStats = useServerFn(getQualificationStats);
  const setStatusFn = useServerFn(setLeadStatus);

  const [search, setSearch] = useState("");
  const [qualFilter, setQualFilter] = useState("all");

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

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Qualified</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Contacts scored and routed after qualification calls
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-1 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{stats?.total ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Qualified</CardTitle>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-emerald-500">{stats?.qualified ?? "—"}</p>
            {stats && stats.total > 0 && (
              <p className="text-xs text-muted-foreground">{stats.qualificationRate}% rate</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Partial</CardTitle>
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-amber-500">{stats?.partiallyQualified ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Score</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {stats?.avgScore != null ? (
              <p className={`text-xl font-bold ${stats.avgScore >= 70 ? "text-emerald-500" : stats.avgScore >= 40 ? "text-amber-500" : "text-red-500"}`}>
                {stats.avgScore}
              </p>
            ) : (
              <p className="text-xl font-bold text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
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
      <Card>
        <CardContent className="p-0">
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Score</th>
                    <th className="px-3 py-2">Budget</th>
                    <th className="px-3 py-2">Decision Maker</th>
                    <th className="px-3 py-2">Interest</th>
                    <th className="px-3 py-2">Urgency</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2">Next Step</th>
                    <th className="px-3 py-2">Last Contact</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead: any) => (
                    <tr
                      key={lead.id}
                      className="group border-b border-white/[0.04] align-top hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        {lead.full_name ?? "—"}
                        {lead.company_name && (
                          <div className="text-[11px] text-muted-foreground font-normal">{lead.company_name}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap text-xs">
                        {lead.phone}
                      </td>
                      <td className="px-3 py-2">
                        {qualStatusBadge(lead.qualification_status ?? lead.status)}
                      </td>
                      <td className="px-3 py-2">{scoreBadge(lead.qualification_score ?? lead.lead_score)}</td>
                      <td className="px-3 py-2">{boolBadge(lead.budget_confirmed, "✓", "—")}</td>
                      <td className="px-3 py-2">{boolBadge(lead.decision_maker, "✓", "—")}</td>
                      <td className="px-3 py-2">
                        {lead.interest_level ? (
                          <span className="text-xs capitalize text-muted-foreground">{lead.interest_level}</span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">{urgencyBadge(lead.urgency)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px]">
                        <span className="line-clamp-2">{lead.call_summary ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px]">
                        <span className="line-clamp-2">{lead.next_step ?? lead.next_action ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap text-xs">
                        {fmtDate(lead.last_contacted_at)}
                      </td>
                      <td className="px-3 py-2">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
