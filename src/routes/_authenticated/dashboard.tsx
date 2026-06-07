import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Phone, Users, Calendar, TrendingUp, ArrowUpRight, Radio, PhoneCall } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getOverviewStats } from "@/lib/dashboard/leads.functions";
import { getDashboardLiveAgents } from "@/lib/agents/agents.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Webespoke AI" }] }),
  component: DashboardPage,
});

const FLOW_LABELS: Record<string, string> = {
  receptionist: "Receptionist",
  lead_generation: "Lead Generation",
  client_qualification: "Client Qualification",
};

function DashboardPage() {
  const getStats = useServerFn(getOverviewStats);
  const getLiveAgents = useServerFn(getDashboardLiveAgents);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-overview"],
    queryFn: () => getStats(),
  });

  const liveAgentsQ = useQuery({
    queryKey: ["dashboard-live-agents"],
    queryFn: () => getLiveAgents(),
    refetchOnWindowFocus: true,
  });

  const liveAgents = liveAgentsQ.data ?? [];

  const cards = [
    {
      title: "Total Leads",
      value: data?.totals.leads ?? 0,
      icon: Users,
    },
    {
      title: "Qualified",
      value: data?.totals.qualified ?? 0,
      icon: TrendingUp,
    },
    {
      title: "Calls Completed",
      value: data?.totals.callsCompleted ?? 0,
      icon: Phone,
    },
    {
      title: "Bookings",
      value: data?.totals.bookings ?? 0,
      icon: Calendar,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your receptionist activity</p>
      </div>

      {/* Live Agents */}
      {(liveAgents.length > 0 || liveAgentsQ.isLoading) && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Live Agents
          </h2>
          {liveAgentsQ.isLoading ? (
            <div className="h-20 animate-pulse rounded-lg bg-muted" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {liveAgents.map((agent) => (
                <Card key={agent.id} className="border-green-500/30 bg-green-500/5">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{agent.name}</p>
                        <Badge variant="secondary" className="mt-1 text-[10px] px-1.5 py-0">
                          {FLOW_LABELS[agent.agentType] ?? agent.agentType}
                        </Badge>
                      </div>
                      <span className="flex items-center gap-1 shrink-0">
                        <Radio className="h-3 w-3 text-green-500 animate-pulse" />
                        <span className="text-[11px] text-green-600 font-medium">Live</span>
                      </span>
                    </div>
                    {agent.phoneNumber && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <PhoneCall className="h-3 w-3 shrink-0" />
                        <span className="font-mono">{agent.phoneNumber}</span>
                      </div>
                    )}
                    {agent.liveAt && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Since{" "}
                        {new Date(agent.liveAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.title}
                </CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="h-8 w-20 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="text-3xl font-bold">{card.value}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {data?.recentLeads && data.recentLeads.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle className="text-lg">Recent Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recentLeads.slice(0, 5).map((lead: any) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium">{lead.full_name ?? lead.name}</p>
                    {lead.phone && <p className="text-xs text-muted-foreground">{lead.phone}</p>}
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">{lead.status}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-8 flex gap-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/my-agents">
            View agents
            <ArrowUpRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
