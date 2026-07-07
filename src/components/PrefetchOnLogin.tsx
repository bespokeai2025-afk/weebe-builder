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
 * - Keys MUST match each page's useQuery key exactly, or the page re-fetches.
 *   The WBAH workspace keys some queries on `isWbah`, so we resolve the active
 *   workspace once before prefetching the workspace-specific queries.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

import { getOverviewStats, listLeads }               from "@/lib/dashboard/leads.functions";
import { getDashboardLiveAgents, listLiveAgents }     from "@/lib/agents/agents.functions";
import { getCampaignStats }                           from "@/lib/dashboard/campaigns.functions";
import { getPipelineLeads }                           from "@/lib/pipeline/pipeline.functions";
import { getRetellAnalytics }                         from "@/lib/dashboard/analytics.functions";
import { getQualificationStats, listQualifiedLeads }  from "@/lib/dashboard/qualified.functions";
import { listCalls }                                  from "@/lib/dashboard/calls.functions";
import { getCallSchedule }                            from "@/lib/dashboard/call-schedule.functions";
import { listDataRecords }                            from "@/lib/dashboard/data-records.functions";
import {
  listWbahPositiveNeutralLeads,
  listWbahQualifiedLeads,
  listWbahCategorizedLeads,
  listWbahCallsCount,
} from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";

const STALE = 5 * 60 * 1000;

// Tracks the workspace whose data currently populates the React Query cache.
// Module-level so it survives component remounts but resets on a full page
// reload (same lifetime as the QueryClient created in router.tsx).
let lastWorkspaceId: string | null = null;

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
  const listAgentsFn     = useServerFn(listLiveAgents);
  const scheduleFn       = useServerFn(getCallSchedule);
  const dataRecordsFn    = useServerFn(listDataRecords);
  const wbahLeadsFn      = useServerFn(listWbahPositiveNeutralLeads);
  const wbahQualifiedFn  = useServerFn(listWbahQualifiedLeads);
  const wbahCatFn        = useServerFn(listWbahCategorizedLeads);
  const wbahCallsCountFn = useServerFn(listWbahCallsCount);

  // null = not yet resolved; true/false once the workspace slug is known.
  const [isWbah, setIsWbah] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authed) { setIsWbah(null); return; }
    let active = true;
    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) { if (active) setIsWbah(false); return; }
        const { data: profile } = await supabase
          .from("profiles")
          .select("default_workspace_id")
          .eq("user_id", sess.session.user.id)
          .maybeSingle();
        if (!profile?.default_workspace_id) { if (active) setIsWbah(false); return; }
        const wsId = profile.default_workspace_id as string;
        // Account isolation: if the active workspace changed since the last
        // resolve (a different user logged in on this same SPA session), wipe
        // the React Query cache so no prior workspace's data is served under
        // the shared (non-workspace-keyed) query keys before fresh data loads.
        if (lastWorkspaceId !== null && lastWorkspaceId !== wsId) {
          qc.clear();
        }
        lastWorkspaceId = wsId;
        const { data: ws } = await supabase
          .from("workspaces")
          .select("slug")
          .eq("id", wsId)
          .maybeSingle();
        if (active) setIsWbah(ws?.slug === "webuyanyhouse");
      } catch {
        if (active) setIsWbah(false);
      }
    })();
    return () => { active = false; };
  }, [authed]);

  useEffect(() => {
    if (!authed || isWbah === null) return;

    const prefetch = (key: unknown[], fn: () => Promise<unknown>) =>
      qc.prefetchQuery({ queryKey: key, queryFn: fn, staleTime: STALE });

    // ── Queries shared by every workspace ──
    prefetch(["dashboard-overview"],           () => overviewFn());
    prefetch(["dashboard-live-agents"],        () => liveAgentsFn());
    prefetch(["campaign-stats"],               () => campaignStatsFn({ data: {} }));
    prefetch(["pipeline-leads"],               () => pipelineFn());
    prefetch(["retell-analytics", 30],         () => analyticsFn({ data: { days: 30 } }));
    prefetch(["qualification-stats"],          () => qualStatsFn());
    prefetch(["qual-agents"],                  () => listAgentsFn());
    prefetch(["my-agents-mini"],               () => listAgentsFn());
    prefetch(["call-schedule"],                () => scheduleFn());
    prefetch(["data-records", { limit: 500, csvOnly: true }], () => dataRecordsFn({ data: { limit: 500, csvOnly: true } }));

    if (isWbah) {
      // ── WBAH "We Buy Any House" workspace ──
      prefetch(["leads-all", true, "30"], () => wbahLeadsFn());
      prefetch(["wbah-qualified-leads"],  () => wbahQualifiedFn());
      // NOTE: the full WBAH calls list is ~20MB — never prefetch it on login.
      // The Calls page loads page-1 on demand via server-side pagination.

      // The Data → People sub-tabs use local component state (not React Query),
      // so prefetching cannot populate them directly. Instead warm the server-side
      // cache for the badge counts + the default "Disqualified" view so opening the
      // tab returns instantly. Run them SEQUENTIALLY (one fire-and-forget chain)
      // so we don't kick off several expensive WBAH CRM derivations concurrently
      // on every login.
      (async () => {
        try {
          await wbahCallsCountFn();
          await wbahCatFn({ data: { category: "disqualified",     page: 1, limit: 1 } });
          await wbahCatFn({ data: { category: "tried_to_contact", page: 1, limit: 1 } });
          await wbahCatFn({ data: { category: "rebooking",        page: 1, limit: 1 } });
          await wbahCatFn({ data: { category: "disqualified",     page: 1, limit: 200 } });
        } catch {
          /* warming is best-effort; ignore failures */
        }
      })();
    } else {
      // ── All other workspaces ──
      const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const dateTo   = new Date().toISOString();
      prefetch(["leads-all", false, "30"], () => listLeadsFn({ data: { limit: 1000, dateFrom, dateTo } }));
      prefetch(["calls", "exclude", "30"], () => callsFn({ data: { voicemailFilter: "exclude", dateFrom, dateTo } }));
      prefetch(["leads-qualified", ""],    () => qualLeadsFn({ data: { limit: 200 } }));
    }
  }, [authed, isWbah]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
