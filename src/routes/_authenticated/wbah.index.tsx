/**
 * Webuyanyhouse — Dashboard
 * KPI cards + Recharts charts. Scoped to Webuyanyhouse workspace only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Clock, Phone, Users, TrendingUp, TrendingDown, CalendarRange,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getWbahDashboard } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import {
  WbahPage, WbahCard, KpiCard, WbahLoading, WbahError, WbahEmpty,
  safeArr, safeNum,
} from "@/components/wbah/WbahShell";

export const Route = createFileRoute("/_authenticated/wbah/")({
  component: WbahDashboard,
});

// Default: last 30 days
function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function WbahDashboard() {
  const [range, setRange] = useState(defaultRange);
  const [committed, setCommitted] = useState(range);

  const getDashFn = useServerFn(getWbahDashboard);

  const { data, isLoading, error } = useQuery({
    queryKey: ["wbah-dashboard", committed.startDate, committed.endDate],
    queryFn: () => getDashFn({ data: committed }),
    staleTime: 120_000,
    retry: 1,
  });

  const perfData = data ? safeArr(data.callPerformance) : [];
  const dropsData = data ? safeArr(data.callDrops) : [];

  return (
    <WbahPage
      title="Dashboard"
      subtitle="Webuyanyhouse property seller qualification — performance overview"
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <CalendarRange className="h-3.5 w-3.5" />
            <input
              type="date"
              value={range.startDate}
              onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs"
            />
            <span>–</span>
            <input
              type="date"
              value={range.endDate}
              onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-xs"
            />
          </div>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
            onClick={() => setCommitted(range)}
          >
            Load
          </Button>
        </div>
      }
    >
      {/* Error */}
      {error && (
        <WbahError message={(error as Error).message} />
      )}

      {/* Loading */}
      {isLoading && <WbahLoading label="Fetching dashboard data…" />}

      {/* KPI cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            icon={Clock}
            label="Total Call Minutes"
            value={safeNum(data.totalMinutes)}
            sub="minutes this period"
            color="text-blue-400"
          />
          <KpiCard
            icon={Phone}
            label="Number of Calls"
            value={safeNum(data.numberOfCalls)}
            sub="calls made"
            color="text-emerald-400"
          />
          <KpiCard
            icon={Users}
            label="Leads"
            value={safeNum(data.leads)}
            sub="property sellers"
            color="text-purple-400"
          />
          <KpiCard
            icon={TrendingUp}
            label="Call Performance"
            value={safeNum(data.callPerformance)}
            sub="performance score"
            color="text-yellow-400"
          />
          <KpiCard
            icon={TrendingDown}
            label="Call Drops"
            value={safeNum(data.callDrops)}
            sub="dropped calls"
            color="text-red-400"
          />
        </div>
      )}

      {/* Charts */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Call Performance Over Time */}
          <WbahCard className="p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Call Performance Over Time</h3>
            {perfData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={perfData}>
                  <defs>
                    <linearGradient id="perf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
                    labelStyle={{ color: "#e5e7eb" }}
                    itemStyle={{ color: "#10b981" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#perf)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <WbahEmpty label="No performance data for this period" />
            )}
          </WbahCard>

          {/* Call Drops / Outcomes */}
          <WbahCard className="p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Call Drops &amp; Outcomes</h3>
            {dropsData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dropsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8 }}
                    labelStyle={{ color: "#e5e7eb" }}
                    itemStyle={{ color: "#ef4444" }}
                  />
                  <Bar dataKey="drops" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <WbahEmpty label="No drop data for this period" />
            )}
          </WbahCard>
        </div>
      )}

      {/* Date range note */}
      <p className="text-xs text-gray-600 text-center">
        Showing data from {committed.startDate} to {committed.endDate} · Webuyanyhouse workspace only
      </p>
    </WbahPage>
  );
}
