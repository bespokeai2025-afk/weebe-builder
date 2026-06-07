import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search, ShieldCheck, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listQualifiedLeads } from "@/lib/dashboard/qualified.functions";

export const Route = createFileRoute("/_authenticated/qualified")({
  head: () => ({ meta: [{ title: "Qualified — Webespoke AI" }] }),
  component: QualifiedPage,
});

function QualifiedPage() {
  const qc = useQueryClient();
  const getLeads = useServerFn(listQualifiedLeads);
  const [search, setSearch] = useState("");

  const leadsQ = useQuery({
    queryKey: ["leads-qualified", search],
    queryFn: () => getLeads({ data: { search: search || undefined, limit: 200 } }),
    refetchOnWindowFocus: false,
  });

  const rows = (leadsQ.data ?? []) as any[];
  const interested = rows.filter((l: any) => l.status === "interested");
  const qualified = rows.filter((l: any) => l.status === "qualified");

  const statCards = [
    { title: "Total Qualified", value: rows.length, icon: ShieldCheck },
    { title: "Interested", value: interested.length, icon: Users },
    { title: "Qualified", value: qualified.length, icon: TrendingUp },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Qualified</h1>
        <p className="text-sm text-muted-foreground mt-1">Leads marked interested or qualified</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statCards.map((card) => {
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
                {leadsQ.isLoading ? (
                  <div className="h-8 w-16 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="text-3xl font-bold">{card.value}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-8">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads…"
              className="h-9 w-full max-w-xs border-white/[0.06] bg-white/[0.02] pl-8 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => qc.invalidateQueries({ queryKey: ["leads-qualified"] })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {leadsQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading leads…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-medium">No qualified leads</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Qualified leads will show up here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((lead: any) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">{lead.full_name ?? lead.phone}</p>
                    <p className="text-xs text-muted-foreground">
                      {lead.phone}
                      {lead.email ? ` · ${lead.email}` : ""}
                    </p>
                  </div>
                  <span
                    className={
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium " +
                      (lead.status === "qualified"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400")
                    }
                  >
                    {lead.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
