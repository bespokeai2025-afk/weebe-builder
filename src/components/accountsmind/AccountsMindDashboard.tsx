import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  getAccountsDashboard,
  runAccountsMindScan,
} from "@/lib/accountsmind/accountsmind.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, TrendingDown, DollarSign, Users, Zap,
  Bell, RefreshCw, AlertTriangle, CheckCircle, BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(cents: number, currency = "£") {
  return `${currency}${(cents / 100).toFixed(2)}`;
}

function MarginBadge({ pct }: { pct: number }) {
  const color =
    pct >= 40 ? "bg-emerald-500/20 text-emerald-400" :
    pct >= 20 ? "bg-yellow-500/20 text-yellow-400" :
    pct >= 0  ? "bg-orange-500/20 text-orange-400" :
                "bg-red-500/20 text-red-400";
  return (
    <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", color)}>
      {pct.toFixed(1)}%
    </span>
  );
}

export function AccountsMindDashboard() {
  const getDashboard = useServerFn(getAccountsDashboard);
  const doScan       = useServerFn(runAccountsMindScan);
  const qc           = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["accountsmind-dashboard"],
    queryFn:  () => getDashboard(),
  });

  const scan = useMutation({
    mutationFn: async () => {
      setScanning(true);
      try { return await doScan(); }
      finally { setScanning(false); }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accountsmind-dashboard"] }),
  });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-400">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading dashboard…
      </div>
    );
  }

  const d = data ?? {
    totalRevenueCents: 0, totalCostCents: 0, grossProfitCents: 0,
    avgMarginPercent: 0, mostExpensiveProvider: "—", clientCount: 0,
    mostProfitableClient: null, leastProfitableClient: null,
    alerts: [], recentRecharges: [], clients: [], providerTotals: {},
  };

  const criticalAlerts = (d.alerts as any[]).filter((a: any) => a.severity === "critical");
  const warningAlerts  = (d.alerts as any[]).filter((a: any) => a.severity === "warning");

  const stats = [
    { label: "Monthly Revenue",   value: fmt(d.totalRevenueCents),   icon: DollarSign, color: "text-emerald-400" },
    { label: "Monthly Cost",      value: fmt(d.totalCostCents),      icon: TrendingDown, color: "text-red-400" },
    { label: "Gross Profit",      value: fmt(d.grossProfitCents),    icon: TrendingUp, color: d.grossProfitCents >= 0 ? "text-emerald-400" : "text-red-400" },
    { label: "Avg Margin",        value: `${d.avgMarginPercent.toFixed(1)}%`, icon: BarChart3, color: d.avgMarginPercent >= 30 ? "text-emerald-400" : "text-yellow-400" },
    { label: "Active Clients",    value: String(d.clientCount),      icon: Users, color: "text-blue-400" },
    { label: "Costliest Provider",value: d.mostExpensiveProvider,    icon: Zap, color: "text-purple-400" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">AccountsMind</h1>
          <p className="text-sm text-gray-400 mt-0.5">Client costing & profit monitoring</p>
        </div>
        <Button
          size="sm"
          onClick={() => scan.mutate()}
          disabled={scanning}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", scanning && "animate-spin")} />
          Run Scan
        </Button>
      </div>

      {/* Alert banner */}
      {criticalAlerts.length > 0 && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-sm text-red-300">
            {criticalAlerts.length} critical alert{criticalAlerts.length !== 1 ? "s" : ""} require attention.
          </span>
          <Link to="/admin/accounts/alerts" className="ml-auto text-xs text-red-400 hover:text-red-300 underline">
            View Alerts
          </Link>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={cn("w-4 h-4", color)} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <div className={cn("text-xl font-bold", color)}>{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Best / worst clients */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white">Client Profitability</h3>
          {d.mostProfitableClient && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <Link
                  to="/admin/accounts/workspace/$id"
                  params={{ id: (d.mostProfitableClient as any).workspace_id }}
                  className="text-sm text-gray-200 hover:text-white"
                >
                  {(d.mostProfitableClient as any).workspace_name ?? "—"}
                </Link>
              </div>
              <MarginBadge pct={(d.mostProfitableClient as any).gross_margin_percent ?? 0} />
            </div>
          )}
          {d.leastProfitableClient && d.leastProfitableClient !== d.mostProfitableClient && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                <Link
                  to="/admin/accounts/workspace/$id"
                  params={{ id: (d.leastProfitableClient as any).workspace_id }}
                  className="text-sm text-gray-200 hover:text-white"
                >
                  {(d.leastProfitableClient as any).workspace_name ?? "—"}
                </Link>
              </div>
              <MarginBadge pct={(d.leastProfitableClient as any).gross_margin_percent ?? 0} />
            </div>
          )}
          {!d.mostProfitableClient && (
            <p className="text-xs text-gray-500">No cost data yet — run a scan first.</p>
          )}
          <Link
            to="/admin/accounts/profitability"
            className="block text-xs text-emerald-400 hover:text-emerald-300 mt-1"
          >
            View all clients →
          </Link>
        </div>

        {/* Recent recharges */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Recent Recharges</h3>
            <Link to="/admin/accounts/recharges" className="text-xs text-gray-400 hover:text-white">
              View all
            </Link>
          </div>
          {(d.recentRecharges as any[]).length === 0 && (
            <p className="text-xs text-gray-500">No recharge events recorded.</p>
          )}
          {(d.recentRecharges as any[]).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-200">{r.provider_name}</div>
                <div className="text-xs text-gray-500">{r.provider_category} · {new Date(r.detected_at).toLocaleDateString()}</div>
              </div>
              <span className="text-sm font-semibold text-yellow-400">
                {r.currency === "GBP" ? "£" : "$"}{(r.amount_cents / 100).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Open alerts */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bell className="w-4 h-4 text-yellow-400" />
            Open Alerts
            {(d.alerts as any[]).length > 0 && (
              <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px]">
                {(d.alerts as any[]).length}
              </Badge>
            )}
          </h3>
          <Link to="/admin/accounts/alerts" className="text-xs text-gray-400 hover:text-white">View all</Link>
        </div>
        {(d.alerts as any[]).length === 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <CheckCircle className="w-4 h-4 text-emerald-400" /> No open alerts
          </div>
        )}
        {(d.alerts as any[]).slice(0, 4).map((alert: any) => (
          <div key={alert.id} className="flex items-start gap-3 py-2 border-b border-gray-800 last:border-0">
            <AlertTriangle className={cn("w-3.5 h-3.5 mt-0.5 shrink-0",
              alert.severity === "critical" ? "text-red-400" :
              alert.severity === "warning"  ? "text-yellow-400" : "text-blue-400"
            )} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-200">{alert.title}</div>
              <div className="text-xs text-gray-500 truncate">{alert.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
