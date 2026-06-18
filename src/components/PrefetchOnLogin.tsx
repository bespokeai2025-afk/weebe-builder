/**
 * PrefetchOnLogin
 *
 * Fires all high-traffic queries in the background the moment the user is
 * authenticated, so every page loads instantly from the React Query cache
 * rather than hitting the network on first visit.
 *
 * Renders nothing — it is a side-effect-only component placed inside
 * AuthenticatedLayout so it runs for every user on every workspace.
 *
 * Rules:
 * - staleTime 5 min: won't re-fetch if data is already warm in cache
 * - All prefetches are fire-and-forget (no await, no spinner, no error shown)
 * - Only fires once per authed=true transition
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getOverviewStats, listLeads }              from "@/lib/dashboard/leads.functions";
import { getDashboardLiveAgents }                   from "@/lib/agents/agents.functions";
import { getCampaignStats }                         from "@/lib/dashboard/campaigns.functions";
import { getPipelineLeads }                         from "@/lib/pipeline/pipeline.functions";
import { getRetellAnalytics }                       from "@/lib/dashboard/analytics.functions";
import { getQualificationStats, listQualifiedLeads } from "@/lib/dashboard/qualified.functions";
import { listCalls }                                from "@/lib/dashboard/calls.functions";
import { listWbahCallsFromDb }                      from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";

const STALE = 5 * 60 * 1000;

interface Props {
  authed: boolean;
}

export function PrefetchOnLogin({ authed }: Props) {
  const qc = useQueryClient();

  const overviewFn       = useServerFn(getOverviewStats);
  const liveAgentsFn     = useServerFn(getDashboardLiveAgents);
  const listLeadsFn      = useServerFn(listLeads);
  const campaignStatsFn  = useServerFn(getCampaignStats);
  const pipelineFn       = useServerFn(getPipelineLeads);
  const analyticsFn      = useServerFn(getRetellAnalytics);
  const qualStatsFn      = useServerFn(getQualificationStats);
  const qualLeadsFn      = useServerFn(listQualifiedLeads);
  const callsFn          = useServerFn(listCalls);
  const wbahCallsFn      = useServerFn(listWbahCallsFromDb);

  useEffect(() => {
    if (!authed) return;

    const prefetch = (key: unknown[], fn: () => Promise<unknown>) =>
      qc.prefetchQuery({ queryKey: key, queryFn: fn, staleTime: STALE });

    prefetch(["dashboard-overview"],           () => overviewFn());
    prefetch(["dashboard-live-agents"],        () => liveAgentsFn());
    prefetch(["leads-all"],                    () => listLeadsFn({ data: { limit: 5000 } }));
    prefetch(["campaign-stats"],               () => campaignStatsFn({ data: {} }));
    prefetch(["pipeline-leads"],               () => pipelineFn());
    prefetch(["retell-analytics", 30],         () => analyticsFn({ data: { days: 30, limit: 1000 } }));
    prefetch(["qualification-stats"],          () => qualStatsFn());
    prefetch(["leads-qualified", "", "all"],   () => qualLeadsFn({ data: {} }));
    prefetch(["calls"],                        () => callsFn({ data: {} }));
    prefetch(["wbah-calls"],                   () => wbahCallsFn());
  }, [authed]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
