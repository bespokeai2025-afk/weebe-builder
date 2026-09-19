import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { getLeadsCreatedTrend } from "@/lib/dashboard/leads.functions";

const CHART_CONFIG: ChartConfig = {
  count: { label: "Leads", color: "var(--brand)" },
};

/**
 * "Leads Created Over Time" — the one trend classified READY NOW in the
 * Phase 2B.1 analytics audit. Counts leads by their real, immutable
 * created_at only. No other series (qualified/calls/bookings), no
 * fabricated comparison, no percentage-change — those all require history
 * this app doesn't have yet (see the audit).
 */
export function LeadsTrendChart() {
  const getTrendFn = useServerFn(getLeadsCreatedTrend);
  const [days, setDays] = useState<7 | 30>(7);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-leads-trend", days],
    queryFn: () => getTrendFn({ data: { days } }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });

  const total = (data ?? []).reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Lead Activity</p>
          <p className="text-caption text-muted-foreground mt-0.5">Leads created over time</p>
        </div>
        <div
          role="group"
          aria-label="Date range"
          className="flex items-center gap-0.5 rounded-lg border border-border bg-card/40 p-0.5"
        >
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                days === d
                  ? "bg-brand/15 text-brand"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        // Skeleton keeps the populated chart's own height (Phase 2A.4 allows
        // this specifically) to avoid layout shift once data arrives.
        <div className="h-52 rounded-xl skeleton-shimmer" />
      ) : isError ? (
        // Compact — an error has no chart to show, so it shouldn't reserve
        // full chart height (Phase 2A.4 finding: this was wasting prime
        // dashboard space, especially on mobile).
        <div className="flex h-20 items-center justify-center rounded-xl border border-dashed border-border text-caption text-muted-foreground">
          Couldn't load lead activity right now.
        </div>
      ) : total === 0 ? (
        <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-center">
          <p className="text-sm font-medium text-foreground">No leads in this period yet</p>
          <p className="text-caption text-muted-foreground">Try the {days === 7 ? "30D" : "7D"} view, or check back once new leads arrive.</p>
        </div>
      ) : (
        <ChartContainer config={CHART_CONFIG} className="h-52 w-full">
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.08} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval={days === 30 ? 4 : 0}
              className="text-[11px]"
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent labelKey="date" indicator="line" />}
            />
            <Area
              dataKey="count"
              type="monotone"
              fill="var(--color-count)"
              fillOpacity={0.12}
              stroke="var(--color-count)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  );
}
