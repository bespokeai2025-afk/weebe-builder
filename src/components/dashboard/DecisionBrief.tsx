import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDashboardDecisions, type Decision } from "./decision-model";

type Props = {
  totals?: { pendingBookings: number; callsFailed: number; qualified: number };
  agents?: { isDeployed: boolean }[];
  loading: boolean;
  stale: boolean;
};

function DecisionRow({ decision, primary = false }: { decision: Decision; primary?: boolean }) {
  return <div className="flex flex-wrap items-center gap-4 py-3">
    {decision.count != null && <span className={`grid h-11 min-w-11 shrink-0 place-items-center rounded-xl px-2 text-lg font-semibold tabular-nums ${primary ? "bg-brand/10 text-brand" : "bg-muted text-foreground"}`}>{decision.count.toLocaleString()}</span>}
    <div className="min-w-[180px] flex-1"><h3 className="text-sm font-semibold">{decision.title}</h3><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{decision.detail}</p></div>
    <Button asChild variant="outline" size="sm" className={`min-h-10 whitespace-normal ${primary ? "border-brand/35 text-brand hover:bg-brand/10 hover:text-brand" : ""}`}>
      <Link to={decision.to} search={{ vm: undefined }}>{decision.action}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link>
    </Button>
  </div>;
}

export function DecisionBrief({ totals, agents, loading, stale }: Props) {
  const decisions = getDashboardDecisions({ totals, agents });
  return <section aria-labelledby="decision-brief-title" className="viz-panel">
    <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 id="decision-brief-title" className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4 w-4 text-brand" aria-hidden="true" />Where to focus</h2>
      <span className="text-xs text-muted-foreground">{!totals ? (loading ? "Loading snapshot" : "Data unavailable") : stale ? "Last available snapshot" : "Current records · all time"}</span>
    </header>
    {!totals ? <p role="status" className="py-3 text-sm leading-relaxed text-muted-foreground">{loading ? "Checking your workspace for next steps…" : "Restore your workspace connection to see recommendations."}</p>
      : decisions.length ? <>
        <DecisionRow decision={decisions[0]} primary />
        {decisions.length > 1 && <details className="mt-2 border-t border-border pt-3">
          <summary className="w-fit cursor-pointer rounded py-1 text-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{decisions.length - 1} more suggested {decisions.length === 2 ? "action" : "actions"}</summary>
          <div className="mt-2 divide-y divide-border">{decisions.slice(1).map(decision => <DecisionRow key={decision.id} decision={decision} />)}</div>
        </details>}
        {decisions.some(d => d.id === "bookings") && <p className="mt-3 text-xs text-muted-foreground">Pending bookings may include past dates. Check details before following up.</p>}
      </> : <div className="flex flex-wrap items-center justify-between gap-3 py-3"><p className="text-sm text-muted-foreground">No next steps flagged by this snapshot. Explore your recent activity for opportunities.</p><Button asChild variant="outline" size="sm"><Link to="/analytics">Explore analytics<ArrowUpRight className="h-4 w-4" /></Link></Button></div>}
  </section>;
}
