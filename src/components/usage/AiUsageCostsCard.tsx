// ── AI usage & production costs card (month-to-date) ─────────────────────────
// Shared widget shown on the HiveMind overview and the Content Studio Projects
// tab. Reads the workspace's own usage costs (no billing/margin data).

import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Loader2 } from "lucide-react";
import { getAiUsageCosts, type AiUsageCostBucket } from "@/lib/usage/ai-usage-costs";

function fmtUsd(n: number) {
  return n >= 0.01 || n === 0
    ? `$${n.toFixed(2)}`
    : `$${n.toFixed(4)}`;
}

function BucketRows({ buckets }: { buckets: AiUsageCostBucket[] }) {
  return (
    <div className="space-y-1">
      {buckets.map((b) => (
        <div key={b.key} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {b.label}
            <span className="ml-1.5 text-xs text-muted-foreground/60">×{b.events}</span>
          </span>
          <span className="font-medium tabular-nums">{fmtUsd(b.costUsd)}</span>
        </div>
      ))}
    </div>
  );
}

export function AiUsageCostsCard({ compact = false }: { compact?: boolean }) {
  const fetchCosts = useServerFn(getAiUsageCosts);
  const q = useQuery({
    queryKey: ["ai-usage-costs"],
    queryFn: () => fetchCosts(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const d = q.data;

  return (
    <Card>
      <CardHeader className={compact ? "pb-2" : undefined}>
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4 text-emerald-500" />
          AI usage &amp; production costs
          {d && (
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {d.monthLabel} · month to date
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading usage costs…
          </div>
        )}
        {q.isError && (
          <p className="text-sm text-muted-foreground">
            Usage costs are unavailable right now.
          </p>
        )}
        {d && (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total this month</span>
              <span className="text-xl font-semibold tabular-nums">{fmtUsd(d.totalUsd)}</span>
            </div>
            {d.growthmind.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  GrowthMind &amp; Content Studio generation — {fmtUsd(d.growthmindUsd)}
                </p>
                <BucketRows buckets={d.growthmind} />
              </div>
            )}
            {d.providers.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
                  Provider usage (voice, LLM, media, messaging)
                </p>
                <BucketRows buckets={d.providers.slice(0, compact ? 5 : 10)} />
              </div>
            )}
            {d.growthmind.length === 0 && d.providers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No AI usage recorded yet this month.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
