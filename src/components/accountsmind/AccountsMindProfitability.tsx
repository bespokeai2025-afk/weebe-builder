import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listClientProfitability } from "@/lib/accountsmind/accountsmind.functions";
import { RefreshCw, TrendingUp, TrendingDown, Minus, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function MarginIcon({ pct }: { pct: number }) {
  if (pct >= 30) return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
  if (pct >= 0)  return <Minus       className="w-3.5 h-3.5 text-yellow-400" />;
  return              <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
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

export function AccountsMindProfitability() {
  const listFn = useServerFn(listClientProfitability);
  const { data = [], isLoading } = useQuery({
    queryKey: ["accountsmind-profitability"],
    queryFn:  () => listFn(),
    throwOnError: false,
  });

  const rows = data as any[];
  const total = rows.reduce((s: number, r: any) => s + (r.monthly_charge_cents ?? 0), 0);
  const totalCost = rows.reduce((s: number, r: any) => s + (r.total_cost_cents ?? 0), 0);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-400" /> Profitability
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Client margin ranking — current month</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Total Revenue</div>
          <div className="text-lg font-bold text-emerald-400">£{(total / 100).toFixed(0)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Total Cost</div>
          <div className="text-lg font-bold text-red-400">£{(totalCost / 100).toFixed(0)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Platform Profit</div>
          <div className={cn("text-lg font-bold", (total - totalCost) >= 0 ? "text-emerald-400" : "text-red-400")}>
            £{((total - totalCost) / 100).toFixed(0)}
          </div>
        </div>
      </div>

      {rows.length === 0 && !isLoading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-500">No profitability data yet.</p>
          <p className="text-xs text-gray-600 mt-1">Go to Dashboard and run a scan to compute this month's figures.</p>
        </div>
      )}

      {/* Ranked table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {rows.map((r: any, i: number) => {
          const currency = r.billing_profile?.currency === "USD" ? "$" : "£";
          return (
            <div
              key={r.id}
              className="flex items-center gap-4 px-4 py-3 border-b border-gray-800/70 last:border-0 hover:bg-gray-800/30 transition-colors"
            >
              {/* Rank */}
              <div className="w-6 text-xs text-gray-500 font-mono">{i + 1}</div>

              {/* Trend icon */}
              <MarginIcon pct={r.gross_margin_percent} />

              {/* Name */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white">{r.workspace_name}</div>
                <div className="text-xs text-gray-500">
                  {currency}{(r.monthly_charge_cents / 100).toFixed(0)}/mo charge
                  {" · "}cost {currency}{(r.total_cost_cents / 100).toFixed(0)}
                </div>
              </div>

              {/* Profit */}
              <div className="text-right">
                <div className={cn("text-sm font-semibold",
                  r.gross_profit_cents >= 0 ? "text-emerald-400" : "text-red-400"
                )}>
                  {currency}{(r.gross_profit_cents / 100).toFixed(0)}
                </div>
                <div className="text-xs text-gray-500">profit</div>
              </div>

              {/* Margin badge */}
              <MarginBadge pct={r.gross_margin_percent} />

              <Link
                to="/admin/accounts/workspace/$id"
                params={{ id: r.workspace_id }}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
