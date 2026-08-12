import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Ban, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { listGadsNegativeDecisionLog } from "@/lib/growthmind/gads-live.server";

export const Route = createFileRoute("/_authenticated/growthmind/negative-keywords")({
  head: () => ({ meta: [{ title: "Negative Keyword Log — GrowthMind" }] }),
  component: NegativeKeywordLogPage,
});

const CLASS_META: Record<string, { label: string; cls: string }> = {
  relevant:             { label: "Relevant",             cls: "bg-blue-500/15 text-blue-300" },
  irrelevant:           { label: "Irrelevant",           cls: "bg-red-500/15 text-red-300" },
  uncertain:            { label: "Uncertain",            cls: "bg-amber-500/15 text-amber-300" },
  high_value_discovery: { label: "High-value discovery", cls: "bg-emerald-500/15 text-emerald-300" },
};

const DECISION_META: Record<string, { label: string; cls: string }> = {
  recommended_negative: { label: "Recommended negative", cls: "bg-orange-500/15 text-orange-300" },
  not_recommended:      { label: "Not recommended",      cls: "bg-slate-500/15 text-slate-300" },
  approved:             { label: "Approved",             cls: "bg-blue-500/15 text-blue-300" },
  declined:             { label: "Declined",             cls: "bg-slate-500/15 text-slate-300" },
  applied:              { label: "Applied to Google Ads", cls: "bg-emerald-500/15 text-emerald-300" },
  apply_failed:         { label: "Apply failed",         cls: "bg-red-500/15 text-red-300" },
};

function NegativeKeywordLogPage() {
  const listFn = useServerFn(listGadsNegativeDecisionLog);
  const { data, isLoading } = useQuery({
    queryKey: ["gads-negative-log"],
    queryFn: () => listFn(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const entries: any[] = data?.entries ?? [];

  return (
    <GrowthMindShell>
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/15 ring-1 ring-red-500/20">
            <Ban className="h-4.5 w-4.5 text-red-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Negative Keyword Decision Log</h1>
            <p className="text-xs text-muted-foreground">
              A permanent record of every search term considered for exclusion — its classification, the decision,
              and the evidence. Only terms classified <span className="text-red-300 font-medium">Irrelevant</span> can
              ever be recommended as negatives; Uncertain terms need human review and high-value discoveries are
              keyword candidates, never exclusions.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading decision log…
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-sm text-muted-foreground">
            No decisions logged yet. Entries appear when a Google Ads deep analysis classifies search terms or a
            negative-keyword recommendation is approved.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.07] text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Search term</th>
                  <th className="px-3 py-2">Classification</th>
                  <th className="px-3 py-2">Decision</th>
                  <th className="px-3 py-2">Campaign</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2 whitespace-nowrap">When</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const c = CLASS_META[e.classification] ?? { label: e.classification, cls: "bg-white/[0.06] text-muted-foreground" };
                  const d = DECISION_META[e.decision] ?? { label: e.decision, cls: "bg-white/[0.06] text-muted-foreground" };
                  return (
                    <tr key={e.id} className="border-b border-white/[0.04] align-top">
                      <td className="px-3 py-2 font-medium">"{e.search_term}"{e.match_type ? <span className="ml-1 text-[10px] text-muted-foreground">[{e.match_type}]</span> : null}</td>
                      <td className="px-3 py-2"><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", c.cls)}>{c.label}</span></td>
                      <td className="px-3 py-2"><span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium", d.cls)}>{d.label}</span></td>
                      <td className="px-3 py-2 text-muted-foreground">{e.campaign_name ?? e.campaign_id ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[320px]">{e.reason ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{new Date(e.created_at).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
