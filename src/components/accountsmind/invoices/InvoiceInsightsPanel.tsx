import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getInvoiceInsights } from "@/lib/accountsmind/invoice-suite-phase3.functions";
import { Button } from "@/components/ui/button";
import { Sparkles, ChevronDown, ChevronUp, AlertTriangle, Clock3, Info, RefreshCw, Loader2 } from "lucide-react";

const SEV_STYLE: Record<string, string> = {
  high: "border-red-800/60 bg-red-950/30",
  medium: "border-amber-800/60 bg-amber-950/20",
  low: "border-slate-800 bg-slate-950/40",
};
const SEV_ICON: Record<string, any> = { high: AlertTriangle, medium: Clock3, low: Info };
const SEV_ICON_CLS: Record<string, string> = { high: "text-red-400", medium: "text-amber-400", low: "text-slate-400" };

export function InvoiceInsightsPanel() {
  const fn = useServerFn(getInvoiceInsights);
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["am-invoice-insights"],
    queryFn: () => fn(),
    throwOnError: false,
    staleTime: 5 * 60 * 1000,
  });
  const insights: any[] = (data as any)?.insights ?? [];
  const highCount = insights.filter((i) => i.severity === "high").length;
  const shown = expanded ? insights : insights.slice(0, 4);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400" /> AccountsMind insights
          {highCount > 0 && <span className="rounded-full bg-red-900/60 border border-red-700 px-2 py-0.5 text-[10px] text-red-300">{highCount} need attention</span>}
        </h2>
        <Button size="sm" variant="ghost" className="text-slate-400 h-7" disabled={isRefetching} onClick={() => refetch()}>
          {isRefetching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-10 rounded bg-slate-800/50 animate-pulse" />)}</div>
      ) : insights.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing needs attention — invoices reconcile, nothing is overdue, and all active clients are billed this month.</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {shown.map((ins, i) => {
              const Icon = SEV_ICON[ins.severity] ?? Info;
              return (
                <li key={i} className={`rounded-lg border px-3 py-2 ${SEV_STYLE[ins.severity] ?? SEV_STYLE.low}`}>
                  <p className="text-xs text-white flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${SEV_ICON_CLS[ins.severity]}`} /> {ins.title}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 pl-5">{ins.detail}</p>
                </li>
              );
            })}
          </ul>
          {insights.length > 4 && (
            <button onClick={() => setExpanded((e) => !e)} className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1">
              {expanded ? <><ChevronUp className="w-3 h-3" /> Show fewer</> : <><ChevronDown className="w-3 h-3" /> Show all {insights.length}</>}
            </button>
          )}
        </>
      )}
    </section>
  );
}
