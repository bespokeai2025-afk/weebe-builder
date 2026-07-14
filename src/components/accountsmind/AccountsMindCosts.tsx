import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getProviderCostSummary } from "@/lib/accountsmind/accountsmind.functions";
import { RefreshCw, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  systemmind: "bg-indigo-500",
  voice:     "bg-blue-500",
  llm:       "bg-purple-500",
  telephony: "bg-orange-500",
  whatsapp:  "bg-green-500",
  email:     "bg-pink-500",
  video:     "bg-yellow-500",
  image:     "bg-cyan-500",
  storage:   "bg-gray-500",
};

function colorFor(cat: string) {
  const key = Object.keys(CATEGORY_COLORS).find((k) => cat.toLowerCase().includes(k));
  return key ? CATEGORY_COLORS[key] : "bg-gray-600";
}

export function AccountsMindCosts() {
  const getSummary = useServerFn(getProviderCostSummary);

  const { data = [], isLoading } = useQuery({
    queryKey: ["accountsmind-costs"],
    queryFn:  () => getSummary(),
    throwOnError: false,
  });

  const total = (data as any[]).reduce((s: number, r: any) => s + r.costCents, 0);

  const byCategory: Record<string, number> = {};
  for (const r of data as any[]) {
    const cat = r.category ?? "other";
    byCategory[cat] = (byCategory[cat] ?? 0) + r.costCents;
  }
  const catEntries = Object.entries(byCategory).sort(([, a], [, b]) => b - a);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-400" /> Provider Costs
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Current month — aggregated from usage logs</p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading costs…
        </div>
      )}

      {/* Category totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {catEntries.map(([cat, cents]) => (
          <div key={cat} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("w-2 h-2 rounded-full", colorFor(cat))} />
              <span className="text-xs text-gray-400 capitalize">{cat}</span>
            </div>
            <div className="text-lg font-bold text-white">
              £{(cents / 100).toFixed(2)}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {total > 0 ? ((cents / total) * 100).toFixed(1) : "0"}% of total
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
        <span className="text-sm text-gray-400">Total provider spend this month</span>
        <span className="text-xl font-bold text-white">£{(total / 100).toFixed(2)}</span>
      </div>

      {/* Provider breakdown table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Provider Breakdown</h3>
        {(data as any[]).length === 0 && !isLoading && (
          <p className="text-xs text-gray-500">No provider usage recorded for this month.</p>
        )}
        <div className="space-y-1">
          {(data as any[]).map((r: any, i: number) => {
            const barPct = total > 0 ? (r.costCents / total) * 100 : 0;
            return (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-gray-800/50 last:border-0">
                <div className={cn("w-2 h-2 rounded-full shrink-0", colorFor(r.category))} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-300">
                      <span className="text-gray-500 capitalize">{r.category}</span>
                      {" / "}
                      <span className="text-white">{r.provider}</span>
                    </span>
                    <span className="text-gray-300 font-medium">£{(r.costCents / 100).toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-1">
                    <div
                      className={cn("h-1 rounded-full", colorFor(r.category))}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
