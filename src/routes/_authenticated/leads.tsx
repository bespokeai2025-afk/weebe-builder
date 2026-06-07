import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Phone, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listCalledQualifiedRecords } from "@/lib/dashboard/calls.functions";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({ meta: [{ title: "Leads — Webespoke AI" }] }),
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

function fmtDuration(s: number | null) {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function LeadsPage() {
  const fn = useServerFn(listCalledQualifiedRecords);
  const q = useQuery({
    queryKey: ["leads-qualified"],
    queryFn: () => fn(),
  });
  const rows = (q.data ?? []) as { record: any; call: any }[];
  const positive = rows.filter((r) => r.call.sentiment === "positive").length;
  const neutral = rows.filter((r) => r.call.sentiment === "neutral").length;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clients called by your voice agent with a neutral or positive outcome
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()}>
          <RefreshCw className="mr-1 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Qualified leads
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <p className="text-3xl font-bold">{rows.length}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Positive</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <p className="text-3xl font-bold text-emerald-500">{positive}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Neutral</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {q.isLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <p className="text-3xl font-bold text-amber-500">{neutral}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Qualified Records</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No qualified leads yet</p>
              <p className="text-sm text-muted-foreground">
                Once your voice agent calls clients from the Data section and a call ends with
                neutral or positive sentiment, they'll appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Mobile</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">City</th>
                    <th className="px-3 py-2">Sentiment</th>
                    <th className="px-3 py-2">Outcome</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Last call</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ record: r, call: c }) => (
                    <tr key={r.id} className="border-b border-white/[0.04] align-top">
                      <td className="px-3 py-2 font-medium">{r.name ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {r.mobile_number}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.email ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.city ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            c.sentiment === "positive"
                              ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400"
                              : "rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-400"
                          }
                        >
                          {c.sentiment}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.call_outcome ?? c.call_status ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {fmtDuration(c.duration_seconds)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {fmtDate(c.started_at)}
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
