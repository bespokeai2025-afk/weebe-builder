import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type GrowthMindExecutiveSummary, type SystemMindExecutiveSummary } from "@/lib/executives/executive-council";

// ── WBAH lead derivation ──────────────────────────────────────────────────────
// WBAH's `leads` table is dup-inflated (~400k rows), so even a COUNT over it exceeds
// the authenticated role's 8s statement_timeout — which silently zeroed HiveMind's
// lead numbers ("0 leads") while the dashboard showed 1,500+. The dashboard avoids
// this by deriving WBAH "leads" from the small, clean `wbah_calls` table. We mirror
// that exactly (see listWbahPositiveNeutralLeads): one row per contact whose
// MOST-RECENT call came back positive or neutral. Rows are shaped like `leads` so the
// downstream breakdown logic works unchanged. Uses the service-role client (wbah_calls
// is RLS-protected) via a dynamic import to keep it out of the client bundle.
async function deriveWbahLeadsFromCalls(workspaceId: string): Promise<any[]> {
  // Cache (short TTL) like the dashboard's listWbahPositiveNeutralLeads so we don't
  // rescan ~12k calls on every HiveMind request. Dynamic imports keep these server-only
  // modules out of the client bundle (hivemind.ai.ts is imported by client routes).
  const { cacheWrap } = await import("@/lib/cache/redis.server");
  return cacheWrap(`hivemind:wbah-leads:${workspaceId}`, 60, async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const PAGE = 1000;
    const all: any[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await (supabaseAdmin as any)
        .from("wbah_calls")
        .select("id, customer_name, phone, sentiment, started_at")
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("[HiveMind] wbah_calls query error:", error.message);
        break;
      }
      const batch: any[] = data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
      from += PAGE;
    }
    // Dedup per contact (phone): rows are latest-first, so the first time we see a phone
    // is that contact's most-recent call.
    const seen = new Set<string>();
    const latest: any[] = [];
    for (const c of all) {
      const key = c.phone && String(c.phone).trim() ? String(c.phone).trim() : `id:${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(c);
    }
    const leads = latest
      .filter((c) => {
        const s = String(c.sentiment ?? "").toLowerCase();
        return s === "positive" || s === "neutral";
      })
      .map((c) => {
        const iso: string | null = c.started_at ?? null;
        return {
          id: c.id,
          full_name: c.customer_name ?? "Unknown",
          status: null,
          pipeline_stage: null,
          created_at: iso,
          updated_at: iso,
          source: null,
          interest_level: null,
          sentiment: String(c.sentiment ?? "").toLowerCase() || null,
        };
      });
    console.log(`[HiveMind] WBAH leads derived from wbah_calls: ${leads.length} positive/neutral contacts (from ${all.length} calls)`);
    return leads;
  });
}

// ── Shared platform data fetcher ──────────────────────────────────────────────
// Exported for reuse by the Executive Bridge. NOTE: the returned object includes a
// raw `cfg` field with workspace settings — callers exposing data to the client
// MUST whitelist safe fields and never forward `cfg`/agent settings.
export async function fetchFullPlatformData(sb: any, workspaceId: string) {
  const now        = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);
  const s14        = new Date(now); s14.setDate(now.getDate() - 14);
  const s30        = new Date(now); s30.setDate(now.getDate() - 30);
  const s60        = new Date(now); s60.setDate(now.getDate() - 60);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  // WBAH's leads table is dup-inflated (~400k rows); even a COUNT over it exceeds the
  // authenticated role's 8s statement_timeout, which silently zeroed HiveMind's lead
  // numbers. Detect WBAH up front so we (a) skip that doomed query and (b) source lead
  // metrics from the small, clean wbah_calls table — exactly like the dashboard does.
  const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";
  const { data: wsRow, error: wsErr } = await sb.from("workspaces").select("slug").eq("id", workspaceId).maybeSingle();
  if (wsErr) console.error("[HiveMind] workspace slug lookup error:", wsErr.message);
  // ID fallback: if the slug lookup is blocked (RLS) or transiently fails, we must NOT
  // silently fall back to the doomed leads-table path for the known WBAH workspace.
  const isWbah = wsRow?.slug === "webuyanyhouse" || workspaceId === WBAH_WORKSPACE_ID;
  // Kick off the WBAH derivation NOW so it runs concurrently with the main batch below.
  const wbahLeadsPromise: Promise<any[] | null> = isWbah
    ? deriveWbahLeadsFromCalls(workspaceId)
    : Promise.resolve(null);

  const [ag, ca, le, bo, cp, wa, se, usage, hexCamps, hexEnroll, docs, tasks, actions, kbs, gmRecs, gmGenLogsRes, videoAssetsRes, videoScheduledRes, adAccountsRes, adCampsRes, adAlertsRes, seoSiteRes] = await Promise.all([
    sb.from("agents").select("id,name,retell_agent_id,inbound_phone_number,settings").eq("workspace_id", workspaceId),
    sb.from("calls").select("id,agent_id,call_successful,duration_seconds,call_type,started_at").eq("workspace_id", workspaceId).gte("started_at", s60.toISOString()).limit(1000),
    // NOTE: deliberately NO .order() here. An `ORDER BY created_at` forces a full
    // sequential scan + sort over the entire workspace's leads. On very large workspaces
    // (e.g. WBAH ≈ 396k rows) that exceeds the authenticated role's 8s statement_timeout;
    // the query then errors and `leads` silently falls back to [] → HiveMind reports
    // "0 leads". We instead take the EXACT total via { count: "exact" } (no sort), use the
    // unordered row sample for breakdowns, and sort the sample in JS for the recent list.
    // For WBAH the leads table is unusable (see deriveWbahLeadsFromCalls); skip it
    // entirely to avoid the statement timeout and source the data from wbah_calls instead.
    isWbah
      ? Promise.resolve({ data: [] as any[], count: 0, error: null })
      : sb.from("leads").select("id,full_name,status,pipeline_stage,created_at,updated_at,source,interest_level,sentiment", { count: "exact" }).eq("workspace_id", workspaceId).limit(3000),
    sb.from("calendar_bookings").select("id,status,created_at,title").eq("workspace_id", workspaceId).gte("created_at", s60.toISOString()).limit(500),
    sb.from("call_campaigns").select("id,name,status,total_leads,completed_calls,created_at").eq("workspace_id", workspaceId).limit(50),
    sb.from("whatsapp_messages").select("id,direction,created_at").eq("workspace_id", workspaceId).gte("created_at", s30.toISOString()).limit(500),
    sb.from("workspace_settings").select("retell_workspace_id,calcom_api_key,elevenlabs_api_key,openai_api_key,whatsapp_phone_id,twilio_auth_token,hivemind_mode").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("usage_events").select("minutes,cost_cents,occurred_at").eq("workspace_id", workspaceId).gte("occurred_at", s30.toISOString()).limit(2000),
    sb.from("hexmail_campaigns").select("id,name,status,created_at").eq("workspace_id", workspaceId).limit(30),
    sb.from("hexmail_campaign_enrollments").select("campaign_id,status").eq("workspace_id", workspaceId).limit(5000),
    Promise.resolve(sb.from("documents").select("id,name,created_at").eq("workspace_id", workspaceId).limit(100)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("hivemind_tasks").select("status,title,priority").eq("workspace_id", workspaceId).neq("status","completed").limit(50)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("hivemind_actions").select("status,title,action_type,created_at").eq("workspace_id", workspaceId).eq("status","pending").limit(20)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("knowledge_bases").select("id,name").eq("workspace_id", workspaceId).limit(20)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_recommendations").select("category,priority,problem,fix").eq("workspace_id", workspaceId).eq("is_dismissed", false).order("created_at", { ascending: false }).limit(5)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_generation_logs").select("provider,model,estimated_cost_usd,status,created_at").eq("workspace_id", workspaceId).gte("created_at", weekStart.toISOString()).limit(1000)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_video_assets").select("id,video_type,provider,quality_mode,cost_estimate,video_url,campaign_id,created_at").eq("workspace_id", workspaceId).gte("created_at", monthStart.toISOString()).limit(200)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_content_calendar").select("id").eq("workspace_id", workspaceId).eq("content_type", "Video Script").gte("scheduled_date", new Date().toISOString().slice(0, 10)).limit(20)).catch(() => ({ data: [] })),
    // Ads accounts + campaigns + alerts
    Promise.resolve(sb.from("growthmind_ads_accounts").select("id,platform,label,status,monthly_budget,total_spend_synced,sync_status,last_synced_at").eq("workspace_id", workspaceId).eq("status","active").limit(20)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_campaigns").select("id,name,platform,status,spend,impressions,clicks,conversions,roas,budget,updated_at").eq("workspace_id", workspaceId).gte("updated_at", s30.toISOString()).limit(100)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_ad_budget_alerts").select("id,platform,alert_type,message,current_value,threshold,created_at").eq("workspace_id", workspaceId).eq("acknowledged", false).order("created_at", { ascending: false }).limit(10)).catch(() => ({ data: [] })),
    // SEO
    Promise.resolve(sb.from("growthmind_seo_sites").select("id,url,keywords,ai_recs,updated_at").eq("workspace_id", workspaceId).limit(5)).catch(() => ({ data: [] })),
  ]);

  if (le.error)   console.error("[HiveMind] leads query error:",   le.error.message);
  if (ag.error)   console.error("[HiveMind] agents query error:",  ag.error.message);
  if (ca.error)   console.error("[HiveMind] calls query error:",   ca.error.message);
  if (bo.error)   console.error("[HiveMind] bookings query error:",bo.error.message);
  if (se.error)   console.error("[HiveMind] settings query error:",se.error.message);

  const agents   = ag.data    ?? [];
  const calls    = ca.data    ?? [];
  const wbahLeadRows = await wbahLeadsPromise;
  let leads      = le.data    ?? [];
  // Exact lead total even when the row sample is capped at PostgREST's 1000-row limit
  // (large workspaces). Falls back to the sample size if no count was returned.
  let leadsTotal = le.count ?? leads.length;
  if (isWbah && wbahLeadRows) {
    // The wbah_calls-derived array IS the full lead set, so sampleSize === total
    // downstream (exact figures, no "sample of N" caveat).
    leads = wbahLeadRows;
    leadsTotal = wbahLeadRows.length;
  }
  const bks      = bo.data    ?? [];
  const camps    = cp.data    ?? [];
  const msgs     = wa.data    ?? [];
  const cfg      = se.data    ?? {};
  const usageRows= usage.data ?? [];
  const hexCampsArr = hexCamps.data ?? [];
  const enrollRows  = hexEnroll.data ?? [];
  const docsArr  = docs.data  ?? [];
  const tasksArr = tasks.data ?? [];
  const actionsArr = actions.data ?? [];
  const kbsArr     = kbs.data   ?? [];
  const gmRecsArr      = gmRecs.data     ?? [];
  const gmGenLogsArr   = gmGenLogsRes.data ?? [];
  const videoAssetsArr = videoAssetsRes.data   ?? [];
  const videoScheduledArr = videoScheduledRes.data ?? [];
  const adAccountsArr  = adAccountsRes.data  ?? [];
  const adCampsArr     = adCampsRes.data     ?? [];
  const adAlertsArr    = adAlertsRes.data    ?? [];
  const seoSitesArr    = seoSiteRes.data     ?? [];

  const todayStr     = todayStart.toISOString();
  const weekStr      = weekStart.toISOString();
  const monthStr     = monthStart.toISOString();
  const prevMonthStr = prevMonthStart.toISOString();
  const prevMonthEndStr = prevMonthEnd.toISOString();
  const s14Str       = s14.toISOString();
  const s30Str       = s30.toISOString();

  // ── Calls ────────────────────────────────────────────────────────────────────
  const callsMonth = calls.filter((c: any) => c.started_at >= monthStr);
  const callsToday = calls.filter((c: any) => c.started_at >= todayStr);
  const totalCalls = calls.length;
  const succCalls  = calls.filter((c: any) => c.call_successful).length;
  const durCalls   = calls.filter((c: any) => c.duration_seconds > 0);
  const avgDur     = durCalls.length ? Math.round(durCalls.reduce((s: number, c: any) => s + c.duration_seconds, 0) / durCalls.length) : 0;

  // ── Leads ────────────────────────────────────────────────────────────────────
  const saleStatuses   = ["sale_done", "completed"];
  const activeStatuses = ["need_to_call","calling","interested","qualified","contact_made"];
  const leadsMonth     = leads.filter((l: any) => l.created_at >= monthStr);
  const leadsPrevMonth = leads.filter((l: any) => l.created_at >= prevMonthStr && l.created_at <= prevMonthEndStr);
  const leadsToday     = leads.filter((l: any) => l.created_at >= todayStr);
  const leadsWeek      = leads.filter((l: any) => l.created_at >= weekStr);
  const salesTotal     = leads.filter((l: any) => saleStatuses.includes(l.status)).length;
  const salesMonth     = leads.filter((l: any) => saleStatuses.includes(l.status) && l.updated_at >= monthStr).length;
  const activeLeads    = leads.filter((l: any) => activeStatuses.includes(l.status));
  const idleLeads      = activeLeads.filter((l: any) => new Date(l.updated_at) < s14);
  const highInterest   = leads.filter((l: any) => l.interest_level === "high" && activeStatuses.includes(l.status));
  const recentLeads    = [...leads].sort((a: any, b: any) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))).slice(0, 10);
  const conversionRate = leads.length > 0 ? Math.round((salesTotal / leads.length) * 1000) / 10 : 0;

  // Pipeline breakdown
  const stageCounts: Record<string, number> = {};
  // WBAH leads have no status pipeline (derived from call sentiment), so skip stage tally.
  if (!isWbah) for (const l of leads) stageCounts[l.status] = (stageCounts[l.status] ?? 0) + 1;

  // Sentiment + lead-source breakdown. Derived from the (≤1000-row) lead sample, NOT from
  // exact per-sentiment COUNT queries: counting `leads` filtered by sentiment over WBAH's
  // ~400k dup-inflated rows exceeds the authenticated role's 8s statement_timeout (the same
  // failure that once zeroed the lead total). For large workspaces these are proportional
  // estimates; for normal workspaces the sample IS the full set, so they are exact.
  const leadSampleSize  = leads.length;
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
  const sourceCounts: Record<string, number> = {};
  for (const l of leads) {
    const sent = String(l.sentiment ?? "").toLowerCase();
    if (sent === "positive")      sentimentCounts.positive++;
    else if (sent === "neutral")  sentimentCounts.neutral++;
    else if (sent === "negative") sentimentCounts.negative++;
    else                          sentimentCounts.unknown++;
    // WBAH leads carry no source field; only tally sources for status-pipeline workspaces.
    if (!isWbah) {
      const src = String(l.source ?? "").trim() || "unknown";
      sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
    }
  }

  // ── Bookings ─────────────────────────────────────────────────────────────────
  const bksMonth = bks.filter((b: any) => b.created_at >= monthStr);
  const bksToday = bks.filter((b: any) => b.created_at >= todayStr);
  const bksWeek  = bks.filter((b: any) => b.created_at >= weekStr);

  // ── Costs ────────────────────────────────────────────────────────────────────
  const totalMins   = usageRows.reduce((s: number, u: any) => s + (Number(u.minutes) || 0), 0);
  const totalCents  = usageRows.reduce((s: number, u: any) => s + (Number(u.cost_cents) || 0), 0);
  const totalDollar = Math.round(totalCents / 100 * 100) / 100;
  const costPerLead = leadsMonth.length > 0 ? Math.round((totalDollar / leadsMonth.length) * 100) / 100 : 0;

  // ── Agents ───────────────────────────────────────────────────────────────────
  const agentScores = agents.map((a: any) => {
    const s        = a.settings ?? {};
    const deployed = !!(s.deployedRetellAgentId || a.retell_agent_id);
    const hasPhone = !!(s.phoneNumber || a.inbound_phone_number);
    const ac       = calls.filter((c: any) => c.agent_id === a.id);
    const succ2    = ac.filter((c: any) => c.call_successful).length;
    const kb       = s.knowledgeBase ?? null;
    return {
      name: a.name, deployed, hasPhone, kb,
      callCount: ac.length,
      successRate: ac.length ? Math.round((succ2 / ac.length) * 100) : 0,
      callsToday: ac.filter((c: any) => c.started_at >= todayStr).length,
    };
  }).sort((a: any, b: any) => b.callCount - a.callCount);

  // ── Campaigns ────────────────────────────────────────────────────────────────
  const campStats = camps.map((c: any) => ({
    name: c.name, status: c.status,
    totalLeads: c.total_leads ?? 0, completedCalls: c.completed_calls ?? 0,
    completionPct: c.total_leads > 0 ? Math.round((c.completed_calls / c.total_leads) * 100) : 0,
    stalled: ["active","running"].includes(c.status ?? "") && (c.completed_calls ?? 0) === 0 && new Date(c.created_at) < s14,
  }));

  // ── Follow-up campaigns ───────────────────────────────────────────────────────
  const hexStats = hexCampsArr.map((c: any) => {
    const e = enrollRows.filter((r: any) => r.campaign_id === c.id);
    return { name: c.name, status: c.status, enrolled: e.length, active: e.filter((r: any) => r.status === "active").length };
  });

  // ── System health ─────────────────────────────────────────────────────────────
  const systemHealth = {
    retell:      !!(cfg.retell_workspace_id),
    calcom:      !!cfg.calcom_api_key,
    elevenlabs:  !!cfg.elevenlabs_api_key,
    openai:      !!cfg.openai_api_key,
    whatsapp:    !!cfg.whatsapp_phone_id,
    twilio:      !!cfg.twilio_auth_token,
  };

  // Prompt performance (graceful — migration may not be applied yet)
  let promptPerformance: any = null;
  try {
    const { getPromptPerformanceSummary } = await import("@/lib/growthmind/growthmind.prompt-studio");
    promptPerformance = await getPromptPerformanceSummary(sb, workspaceId);
  } catch {}

  // Strategy Centre summary (graceful — migration may not be applied yet)
  let strategyCentre: any = null;
  try {
    const { getStrategyCentreSummary } = await import("@/lib/growthmind/growthmind.strategy-centre");
    strategyCentre = await getStrategyCentreSummary(sb, workspaceId);
  } catch {}

  return {
    agents, agentScores, cfg,
    mode: cfg.hivemind_mode ?? "assistant",
    today: {
      leads:    leadsToday.length,
      bookings: bksToday.length,
      calls:    callsToday.length,
      messages: msgs.filter((m: any) => m.created_at >= todayStr).length,
    },
    week:  { leads: leadsWeek.length, bookings: bksWeek.length },
    month: { leads: leadsMonth.length, bookings: bksMonth.length, sales: salesMonth },
    prevMonth: { leads: leadsPrevMonth.length },
    calls: {
      total: totalCalls, success: succCalls,
      successRate: totalCalls > 0 ? Math.round((succCalls / totalCalls) * 100) : 0,
      avgDuration: avgDur,
      inbound:  calls.filter((c: any) => c.call_type === "inbound").length,
      outbound: calls.filter((c: any) => c.call_type !== "inbound").length,
      thisMonth: callsMonth.length,
    },
    leads: {
      isWbah,
      total: leadsTotal, active: activeLeads.length, idle: idleLeads.length,
      needCall: leads.filter((l: any) => l.status === "need_to_call").length,
      sales: salesTotal, salesMonth, conversionRate,
      highInterest: highInterest.length,
      stale: idleLeads.length,
      stageCounts,
      sampleSize: leadSampleSize,
      sentiment: sentimentCounts,
      sources: sourceCounts,
      recent: recentLeads.map((l: any) => ({
        name: l.full_name ?? "Unnamed",
        status: l.status,
        interest: l.interest_level,
        created: l.created_at,
      })),
    },
    bookings: { total: bks.length, thisMonth: bksMonth.length, thisWeek: bksWeek.length, today: bksToday.length },
    campaigns: {
      total: camps.length,
      active: camps.filter((c: any) => ["running","active"].includes(c.status ?? "")).length,
      stopped: camps.filter((c: any) => ["stopped","paused"].includes(c.status ?? "")).length,
      stats: campStats,
      stalled: campStats.filter((c: any) => c.stalled).length,
    },
    followUpCampaigns: hexStats,
    whatsapp: {
      inbound:  msgs.filter((m: any) => m.direction === "inbound").length,
      outbound: msgs.filter((m: any) => m.direction === "outbound").length,
    },
    costs: { totalMinutes: Math.round(totalMins), totalDollars: totalDollar, costPerLead },
    documents: docsArr.map((d: any) => d.name),
    knowledgeBases: kbsArr.map((k: any) => k.name),
    tasks: {
      suggested:  tasksArr.filter((t: any) => t.status === "suggested").length,
      approved:   tasksArr.filter((t: any) => t.status === "approved").length,
      inProgress: tasksArr.filter((t: any) => t.status === "in_progress").length,
      items:      tasksArr.slice(0, 8).map((t: any) => ({ title: t.title, priority: t.priority, status: t.status })),
    },
    pendingActions: {
      count: actionsArr.length,
      items: actionsArr.slice(0, 6).map((a: any) => ({ title: a.title, type: a.action_type })),
    },
    systemHealth,
    growthMind: (() => {
      const gmLeads        = leads;
      const gmCalls        = ca.data ?? [];
      const gmBookings     = bo.data ?? [];
      const gmCamps        = cp.data ?? [];
      const totalLeads     = gmLeads.length;
      const saleLeads      = gmLeads.filter((l: any) => l.status === "sale_done").length;
      const activeLeads    = gmLeads.filter((l: any) => !["sale_done","do_not_call","not_interested"].includes(l.status)).length;
      const conversionRate = totalLeads > 0 ? Math.round((saleLeads / totalLeads) * 100) : 0;
      const succCalls2     = gmCalls.filter((c: any) => c.call_successful).length;
      const callSuccessRate= gmCalls.length > 0 ? Math.round((succCalls2 / gmCalls.length) * 100) : 0;
      const totalBookings  = gmBookings.length;
      const bookingRate    = totalLeads > 0 ? Math.round((totalBookings / totalLeads) * 100) : 0;
      const activeCampaigns= gmCamps.filter((c: any) => ["running","active"].includes(c.status ?? "")).length;
      let sc = 0;
      if (totalLeads > 0)        sc += 15;
      if (conversionRate >= 5)   sc += 20;
      if (callSuccessRate >= 40) sc += 15;
      if (bookingRate >= 5)      sc += 15;
      if (activeCampaigns >= 1)  sc += 15;
      if (totalBookings > 0)     sc += 10;
      if (activeLeads > 0)       sc += 10;
      const qualEst = Math.round(activeLeads * 0.4);
      const funnelDropBiggest =
        totalLeads > 0 && qualEst / Math.max(1, totalLeads) < 0.3
          ? "Traffic → Qualified (most leads not progressing)"
          : totalBookings < saleLeads * 2
            ? "Qualified → Appointment (low booking rate)"
            : "Appointment → Sale";
      return {
        marketingReadinessScore: Math.min(100, sc),
        callSuccessRate,
        conversionRate,
        bookingRate,
        activeCampaigns,
        totalLeads,
        activeLeads,
        saleLeads,
        funnelDropBiggest,
        topRecommendations: gmRecsArr.map((r: any) => ({
          priority: r.priority, problem: r.problem, fix: r.fix,
        })),
      };
    })(),
    contentStudio: (() => {
      if (!gmGenLogsArr.length) return null;
      const byProvider: Record<string, number> = {};
      const byModel:    Record<string, number> = {};
      let totalCost    = 0;
      let fallbacks    = 0;
      for (const r of gmGenLogsArr) {
        byProvider[r.provider] = (byProvider[r.provider] ?? 0) + 1;
        byModel[r.model]       = (byModel[r.model]       ?? 0) + 1;
        totalCost += r.estimated_cost_usd ?? 0;
        if (r.status === "fallback") fallbacks++;
      }
      const topProvider = Object.entries(byProvider).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return {
        totalGenerations: gmGenLogsArr.length,
        byProvider,
        byModel,
        estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
        fallbacks,
        topProvider,
      };
    })(),
    adEfficiency: (() => {
      if (adAccountsArr.length === 0) return null;
      const totalSpend       = adAccountsArr.reduce((s: number, a: any) => s + Number(a.total_spend_synced ?? 0), 0);
      const byPlatform       = adAccountsArr.map((a: any) => ({
        platform:    a.platform,
        label:       a.label,
        spend:       Number(a.total_spend_synced ?? 0),
        budget:      Number(a.monthly_budget ?? 0),
        syncStatus:  a.sync_status,
        lastSynced:  a.last_synced_at,
        pctUsed:     a.monthly_budget > 0 ? Math.round((a.total_spend_synced / a.monthly_budget) * 100) : null,
      }));
      const activeCampaigns  = adCampsArr.filter((c: any) => c.status === "active" || c.status === "enabled");
      const totalImpressions = adCampsArr.reduce((s: number, c: any) => s + Number(c.impressions ?? 0), 0);
      const totalClicks      = adCampsArr.reduce((s: number, c: any) => s + Number(c.clicks ?? 0), 0);
      const totalConversions = adCampsArr.reduce((s: number, c: any) => s + Number(c.conversions ?? 0), 0);
      const avgRoas          = adCampsArr.length > 0
        ? Math.round(adCampsArr.filter((c: any) => c.roas).reduce((s: number, c: any) => s + Number(c.roas ?? 0), 0) / Math.max(1, adCampsArr.filter((c: any) => c.roas).length) * 100) / 100
        : null;
      const ctr              = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : null;
      const cpl              = totalConversions > 0 && totalSpend > 0 ? Math.round((totalSpend / totalConversions) * 100) / 100 : null;
      const lowRoasCamps     = adCampsArr.filter((c: any) => c.roas !== null && Number(c.roas) < 1 && Number(c.spend ?? 0) > 50);
      const staleAccounts    = adAccountsArr.filter((a: any) => {
        if (!a.last_synced_at) return false;
        return (Date.now() - new Date(a.last_synced_at).getTime()) > 24 * 60 * 60 * 1000;
      });
      const openAlerts       = adAlertsArr.map((al: any) => ({ type: al.alert_type, platform: al.platform, message: al.message }));
      return {
        connectedAccounts: adAccountsArr.length,
        totalSpend,
        byPlatform,
        campaigns: {
          total:   adCampsArr.length,
          active:  activeCampaigns.length,
          lowRoas: lowRoasCamps.map((c: any) => ({ name: c.name, roas: c.roas, spend: c.spend })),
        },
        metrics: { totalImpressions, totalClicks, totalConversions, avgRoas, ctr, cpl },
        staleAccounts: staleAccounts.map((a: any) => ({ platform: a.platform, label: a.label })),
        openAlerts,
      };
    })(),
    seoHealth: (() => {
      if (seoSitesArr.length === 0) return null;
      const site         = seoSitesArr[0];
      const keywords     = (site.keywords ?? []) as any[];
      const tracked      = keywords.length;
      const withPosition = keywords.filter((k: any) => k.gsc_position != null);
      const avgPosition  = withPosition.length > 0
        ? Math.round(withPosition.reduce((s: number, k: any) => s + Number(k.gsc_position), 0) / withPosition.length * 10) / 10
        : null;
      const top10        = withPosition.filter((k: any) => Number(k.gsc_position) <= 10).length;
      const dropping     = keywords.filter((k: any) => {
        const trend = k.trend ?? k.position_trend;
        return trend === "dropping" || trend === "down";
      });
      const highVolLowPos = keywords.filter((k: any) =>
        (k.volume ?? 0) > 100 && k.gsc_position != null && Number(k.gsc_position) > 20
      );
      return {
        siteUrl:   site.url,
        tracked,
        withPosition: withPosition.length,
        avgPosition,
        top10,
        dropping:      dropping.map((k: any) => k.keyword),
        opportunities: highVolLowPos.slice(0, 5).map((k: any) => ({ keyword: k.keyword, volume: k.volume, position: k.gsc_position })),
        hasAiRecs: !!(site.ai_recs && site.ai_recs.length > 0),
        lastUpdated: site.updated_at,
      };
    })(),
    videoSummary: (() => {
      if (!videoAssetsArr.length && !videoScheduledArr.length) return null;
      const ALL_KEY_TYPES = ["meta_video_ad", "explainer_video", "ugc_ad", "product_demo", "testimonial_video"];
      const byType:     Record<string, number> = {};
      const byProvider: Record<string, number> = {};
      const byQuality:  Record<string, number> = {};
      let   totalCostEst = 0;

      for (const a of videoAssetsArr) {
        byType[a.video_type ?? "unknown"] = (byType[a.video_type ?? "unknown"] ?? 0) + 1;
        const prov = (a.provider ?? "text_only") as string;
        byProvider[prov] = (byProvider[prov] ?? 0) + 1;
        const q = (a.quality_mode ?? "fast") as string;
        byQuality[q]     = (byQuality[q] ?? 0) + 1;
        totalCostEst    += a.cost_estimate ?? 0;
      }

      const coveredTypes  = new Set(videoAssetsArr.map((a: any) => a.video_type as string));
      const missingTypes  = ALL_KEY_TYPES.filter(t => !coveredTypes.has(t));
      const pendingJobs   = videoAssetsArr.filter((a: any) =>
        typeof a.video_url === "string" && /^\[veo3_job:|^\[runway_job:/.test(a.video_url)
      );
      const failedJobs    = videoAssetsArr.filter((a: any) =>
        typeof a.video_url === "string" && a.video_url.startsWith("[error:")
      );

      const byCampaign: Record<string, { count: number; cost: number }> = {};
      for (const a of videoAssetsArr) {
        if (a.campaign_id) {
          if (!byCampaign[a.campaign_id]) byCampaign[a.campaign_id] = { count: 0, cost: 0 };
          byCampaign[a.campaign_id].count++;
          byCampaign[a.campaign_id].cost += a.cost_estimate ?? 0;
        }
      }
      const campaignsWithVideo = Object.keys(byCampaign).length;
      const videosLinkedToCampaign = videoAssetsArr.filter((a: any) => a.campaign_id).length;

      return {
        totalThisMonth:         videoAssetsArr.length,
        upcomingScheduled:      videoScheduledArr.length,
        byType,
        missingTypes,
        pendingJobs:            pendingJobs.length,
        failedJobs:             failedJobs.length,
        failedJobIds:           failedJobs.map((a: any) => a.id as string),
        byProvider,
        byQuality,
        estimatedCostThisMonth: Math.round(totalCostEst * 100) / 100,
        byCampaign,
        campaignsWithVideo,
        videosLinkedToCampaign,
      };
    })(),
    promptPerformance,
    strategyCentre,
  };
}

// ── Dynamic retrieval query builder ───────────────────────────────────────────
// Builds a semantically rich, data-driven embedding query from live HiveMind
// platform data. Called before every executive KB retrieval so that each
// briefing / voice session retrieves uniquely relevant knowledge instead of
// returning the same static chunks.
function buildHiveMindRetrievalQuery(d: any): string {
  if (!d) return "business operations priorities, lead management, pipeline decisions, and platform risks";

  const parts: string[] = [];

  // Today's activity snapshot
  const todayBits: string[] = [];
  if ((d.today?.leads  ?? 0) > 0) todayBits.push(`${d.today.leads} new lead${d.today.leads !== 1 ? "s" : ""}`);
  if ((d.today?.bookings ?? 0) > 0) todayBits.push(`${d.today.bookings} booking${d.today.bookings !== 1 ? "s" : ""}`);
  if ((d.today?.calls  ?? 0) > 0) todayBits.push(`${d.today.calls} call${d.today.calls !== 1 ? "s" : ""}`);
  if (todayBits.length) parts.push(`Today: ${todayBits.join(", ")}`);

  // Week & month momentum
  if ((d.week?.leads ?? 0) > 0 || (d.month?.leads ?? 0) > 0) {
    parts.push(`Pipeline momentum: ${d.week?.leads ?? 0} leads this week, ${d.month?.leads ?? 0} this month, ${d.month?.sales ?? 0} sales this month`);
  }

  // Lead pipeline health
  if (d.leads) {
    const { total = 0, active = 0, idle = 0, needCall = 0, conversionRate = 0, highInterest = 0, stale = 0 } = d.leads;
    parts.push(`Pipeline: ${total} total (${active} active, ${idle} idle 14d+, ${needCall} need follow-up call)`);
    const sent = d.leads.sentiment;
    if (sent && (sent.positive || sent.neutral || sent.negative)) {
      parts.push(`Lead sentiment split: ${sent.positive} positive, ${sent.neutral} neutral, ${sent.negative} negative`);
    }
    const srcTop = Object.entries(d.leads.sources ?? {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([s]: any) => s);
    if (srcTop.length) parts.push(`Top lead sources: ${srcTop.join(", ")}`);
    if (highInterest > 0) parts.push(`${highInterest} high-interest lead${highInterest !== 1 ? "s" : ""} requiring priority outreach`);
    if (total > 10 && conversionRate < 5) parts.push("conversion rate below threshold — pipeline bottleneck and sales process improvements");
    if (total > 0 && stale / total > 0.3)  parts.push("high idle lead ratio — re-engagement automation and CRM hygiene");
  }

  // Campaign operations
  if (d.campaigns) {
    const { active = 0, stalled = 0, total = 0 } = d.campaigns;
    parts.push(`Campaigns: ${active} active, ${stalled} stalled of ${total} total`);
    if (stalled > 0) parts.push("stalled campaign recovery and operational remediation");
    if (active === 0 && total > 0) parts.push("all campaigns paused — outreach activation strategy");
  }

  // Booking & call performance
  if (d.bookings) {
    const { thisWeek = 0, thisMonth = 0 } = d.bookings;
    parts.push(`Bookings: ${thisWeek} this week, ${thisMonth} this month`);
  }
  if (d.calls) {
    const { total = 0, successRate = 0 } = d.calls;
    if (total > 0) parts.push(`Call performance: ${total} calls (${successRate}% success rate)`);
    if (total > 10 && successRate < 30) parts.push("low call success — agent script and outreach quality improvements");
  }

  // Cost & efficiency
  if (d.costs?.totalDollars > 0) {
    parts.push(`Platform cost: $${d.costs.totalDollars} this month ($${d.costs.costPerLead} per lead)`);
    if (d.costs.costPerLead > 50) parts.push("high cost per lead — efficiency and cost optimisation strategies");
  }

  // Pending actions & open tasks (decisions requiring COO input)
  if ((d.pendingActions?.count ?? 0) > 0) {
    const titles = (d.pendingActions.items ?? []).slice(0, 2).map((a: any) => a.title).join(", ");
    parts.push(`${d.pendingActions.count} pending action${d.pendingActions.count !== 1 ? "s" : ""} awaiting decision${titles ? `: ${titles}` : ""}`);
  }
  if (d.tasks) {
    const open = (d.tasks.approved ?? 0) + (d.tasks.inProgress ?? 0);
    if (open > 0) parts.push(`${open} open operational task${open !== 1 ? "s" : ""} in progress`);
    const suggested = d.tasks.suggested ?? 0;
    if (suggested > 0) parts.push(`${suggested} AI-suggested task${suggested !== 1 ? "s" : ""} pending review`);
  }

  // Provider health gaps → surface relevant setup / troubleshooting knowledge
  if (d.systemHealth) {
    const gaps: string[] = [];
    if (!d.systemHealth.retell)     gaps.push("voice provider not connected");
    if (!d.systemHealth.calcom)     gaps.push("calendar integration missing");
    if (!d.systemHealth.openai)     gaps.push("OpenAI API key not configured");
    if (!d.systemHealth.whatsapp)   gaps.push("WhatsApp channel not connected");
    if (gaps.length) parts.push(`Provider issues requiring resolution: ${gaps.join(", ")}`);
  }

  // Paid ads efficiency
  if (d.adEfficiency) {
    const ae = d.adEfficiency;
    parts.push(`Paid ads: ${ae.connectedAccounts} account${ae.connectedAccounts !== 1 ? "s" : ""} connected, £${ae.totalSpend.toFixed(0)} total spend, ${ae.campaigns.active} active campaigns`);
    if (ae.metrics.avgRoas !== null) parts.push(`Ads performance: ROAS ${ae.metrics.avgRoas}x, CTR ${ae.metrics.ctr}%, CPL £${ae.metrics.cpl}`);
    if (ae.campaigns.lowRoas.length > 0) parts.push(`${ae.campaigns.lowRoas.length} campaign${ae.campaigns.lowRoas.length !== 1 ? "s" : ""} with ROAS below 1x while spending — requires ad optimisation and creative testing`);
    if (ae.openAlerts.length > 0) parts.push(`${ae.openAlerts.length} budget alert${ae.openAlerts.length !== 1 ? "s" : ""} active — budget management and spend pacing strategies`);
    if (ae.staleAccounts.length > 0) parts.push("ad accounts not synced in 24h — ad account reconnection and token refresh");
  }

  // SEO health
  if (d.seoHealth) {
    const s = d.seoHealth;
    parts.push(`SEO: ${s.tracked} keywords tracked for ${s.siteUrl}${s.avgPosition !== null ? `, avg position ${s.avgPosition}, ${s.top10} in top 10` : ""}`);
    if (s.dropping.length > 0) parts.push(`${s.dropping.length} keyword${s.dropping.length !== 1 ? "s" : ""} dropping in search rankings — content refresh and SEO remediation strategies`);
    if (s.opportunities.length > 0) parts.push(`${s.opportunities.length} high-volume keyword${s.opportunities.length !== 1 ? "s" : ""} ranking below position 20 — SEO content opportunities and quick-win optimisations`);
  } else {
    parts.push("no SEO site configured — search engine optimisation strategy and keyword research");
  }

  // Anchor to operational KB topics
  parts.push("operational workflows, lead management best practices, pipeline optimisation, provider configuration, and platform decisions");

  return parts.join(". ");
}

// ── Context builder ────────────────────────────────────────────────────────────
function buildPlatformContext(d: any): string {
  if (!d) return "No platform data available yet.";
  const lines: string[] = [];

  const hour = new Date().getHours();
  lines.push(`[${new Date().toLocaleString()} | HiveMind Mode: ${(d.mode ?? "assistant").toUpperCase()}]\n`);

  // TODAY
  lines.push(`TODAY: ${d.today.leads} new leads | ${d.today.bookings} bookings | ${d.today.calls} calls | ${d.today.messages} WhatsApp msgs`);
  lines.push(`THIS WEEK: ${d.week.leads} leads | ${d.week.bookings} bookings`);
  lines.push(`THIS MONTH: ${d.month.leads} leads (vs ${d.prevMonth.leads} last month) | ${d.month.bookings} bookings | ${d.month.sales} sales`);

  // LEADS
  lines.push(`\nLEADS OVERVIEW:`);
  if (d.leads.isWbah) {
    // WBAH leads are derived from call sentiment (no status pipeline): one row per
    // already-called contact whose most-recent call was positive or neutral — the same
    // figures the user sees on the "Positive / Neutral Leads" page.
    const sent = d.leads.sentiment ?? { positive: 0, neutral: 0 };
    lines.push(`  Total leads (already-called contacts with positive or neutral sentiment): ${Number(d.leads.total ?? 0).toLocaleString()}`);
    lines.push(`  Sentiment: positive ${Number(sent.positive ?? 0).toLocaleString()} | neutral ${Number(sent.neutral ?? 0).toLocaleString()}`);
    lines.push(`  New today: ${d.today.leads} | this week: ${d.week.leads} | this month: ${d.month.leads}`);
    if (d.leads.recent?.length) {
      lines.push(`  Recent leads: ${d.leads.recent.slice(0, 8).map((l: any) => `"${l.name}"`).join(", ")}`);
    }
  } else {
    lines.push(`  Total: ${d.leads.total} | Active: ${d.leads.active} | Need call: ${d.leads.needCall} | Sales all-time: ${d.leads.sales} | High interest: ${d.leads.highInterest}`);
    lines.push(`  Conversion rate: ${d.leads.conversionRate}% | Idle 14d+: ${d.leads.idle}`);

    // Pipeline
    const stages = Object.entries(d.leads.stageCounts ?? {})
      .sort((a: any, b: any) => b[1] - a[1])
      .map(([s, n]) => `${s.replace(/_/g, " ")}: ${n}`)
      .join(" | ");
    if (stages) lines.push(`  Pipeline: ${stages}`);

    // Sentiment + lead-source split. For very large workspaces these come from a capped
    // sample, so percentages (and scaled estimates) are shown rather than raw sample counts.
    const leadSampleSize = Number(d.leads.sampleSize ?? 0);
    const leadTotal      = Number(d.leads.total ?? 0);
    const leadIsSample   = leadSampleSize > 0 && leadTotal > leadSampleSize;
    const sent = d.leads.sentiment;
    if (sent) {
      const fmt = (n: number) => {
        if (!leadIsSample) return `${n}`;
        const pct = leadSampleSize > 0 ? Math.round((n / leadSampleSize) * 100) : 0;
        return `${pct}% (≈${Math.round((n / leadSampleSize) * leadTotal).toLocaleString()})`;
      };
      lines.push(`  Sentiment: positive ${fmt(sent.positive)} | neutral ${fmt(sent.neutral)} | negative ${fmt(sent.negative)}${sent.unknown ? ` | unscored ${fmt(sent.unknown)}` : ""}${leadIsSample ? ` — % from a ${leadSampleSize}-lead sample of ${leadTotal.toLocaleString()} total` : ""}`);
    }
    const srcEntries = Object.entries(d.leads.sources ?? {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6);
    if (srcEntries.length) {
      const srcStr = srcEntries
        .map(([s, n]: any) => leadIsSample ? `${s}: ${Math.round((n / leadSampleSize) * 100)}%` : `${s}: ${n}`)
        .join(" | ");
      lines.push(`  Top lead sources: ${srcStr}${leadIsSample ? " (sample-based %)" : ""}`);
    }

    // Recent leads
    if (d.leads.recent?.length) {
      lines.push(`  Recent leads: ${d.leads.recent.slice(0, 8).map((l: any) => `"${l.name}" (${l.status}${l.interest === "high" ? ", HIGH interest" : ""})`).join(", ")}`);
    }
  }

  // CALLS
  lines.push(`\nCALLS (30d): ${d.calls.total} total | ${d.calls.successRate}% success | avg ${d.calls.avgDuration}s | ${d.calls.inbound} inbound | ${d.calls.outbound} outbound | ${d.calls.thisMonth} this month`);

  // BOOKINGS
  lines.push(`\nBOOKINGS: ${d.bookings.total} total | ${d.bookings.thisMonth} this month | ${d.bookings.thisWeek} this week | ${d.bookings.today} today`);

  // AGENTS
  lines.push(`\nAGENTS (${d.agentScores?.length ?? 0}):`);
  for (const a of (d.agentScores ?? []).slice(0, 10)) {
    const st = a.deployed ? "✓ deployed" : "✗ NOT DEPLOYED";
    const ph = a.hasPhone ? "has phone" : "no phone";
    const kb = a.kb ? `KB: ${a.kb}` : "no KB";
    lines.push(`  • "${a.name}": ${st}, ${ph}, ${kb}, ${a.callCount} calls (${a.successRate}% success), ${a.callsToday} calls today`);
  }

  // CALL CAMPAIGNS
  lines.push(`\nCALL CAMPAIGNS: ${d.campaigns.total} total | ${d.campaigns.active} active | ${d.campaigns.stalled} stalled`);
  for (const c of (d.campaigns.stats ?? []).slice(0, 8)) {
    const warn = c.stalled ? " ⚠ STALLED" : "";
    lines.push(`  • "${c.name}": ${c.status}, ${c.completionPct}% complete (${c.completedCalls}/${c.totalLeads})${warn}`);
  }

  // FOLLOW-UP CAMPAIGNS (hexmail)
  if (d.followUpCampaigns?.length > 0) {
    lines.push(`\nFOLLOW-UP EMAIL CAMPAIGNS (${d.followUpCampaigns.length}):`);
    for (const c of d.followUpCampaigns.slice(0, 6)) {
      lines.push(`  • "${c.name}": ${c.status}, ${c.enrolled} enrolled, ${c.active} active`);
    }
  } else {
    lines.push(`\nFOLLOW-UP EMAIL CAMPAIGNS: none configured`);
  }

  // WHATSAPP
  lines.push(`\nWHATSAPP (30d): ${d.whatsapp.inbound} inbound | ${d.whatsapp.outbound} outbound`);

  // COSTS
  lines.push(`\nAI CALL COSTS (30d): ${d.costs.totalMinutes} mins | $${d.costs.totalDollars} total | $${d.costs.costPerLead} per lead this month`);

  // DOCUMENTS & KBs
  if (d.documents?.length > 0) lines.push(`\nDOCUMENTS: ${d.documents.slice(0, 6).map((n: string) => `"${n}"`).join(", ")}${d.documents.length > 6 ? ` +${d.documents.length - 6} more` : ""}`);
  if (d.knowledgeBases?.length > 0) lines.push(`KNOWLEDGE BASES: ${d.knowledgeBases.join(", ")}`);
  if (!d.documents?.length && !d.knowledgeBases?.length) lines.push(`\nDOCUMENTS/KNOWLEDGE BASES: none uploaded`);

  // HIVEMIND TASKS
  if (d.tasks) {
    lines.push(`\nHIVEMIND TASKS: ${d.tasks.suggested} suggested | ${d.tasks.approved} approved | ${d.tasks.inProgress} in-progress`);
    for (const t of (d.tasks.items ?? [])) {
      lines.push(`  • [${t.priority.toUpperCase()}] "${t.title}" (${t.status})`);
    }
  }

  // PENDING ACTIONS
  if (d.pendingActions?.count > 0) {
    lines.push(`\nPENDING ACTIONS AWAITING APPROVAL (${d.pendingActions.count}):`);
    for (const a of (d.pendingActions.items ?? [])) {
      lines.push(`  • "${a.title}" [${a.type}]`);
    }
  } else {
    lines.push(`\nPENDING ACTIONS: none`);
  }

  // SYSTEM
  const health = d.systemHealth ?? {};
  const connected = Object.entries(health).filter(([, v]) => v).map(([k]) => k);
  const missing   = Object.entries(health).filter(([, v]) => !v).map(([k]) => k);
  lines.push(`\nSYSTEM: Connected — ${connected.join(", ") || "nothing"}${missing.length ? ` | NOT connected — ${missing.join(", ")}` : ""}`);

  // GROWTHMIND EXECUTIVE SUMMARY (injected from marketing intelligence engine)
  if (d.growthMind) {
    const gm = d.growthMind;
    lines.push(`\nGROWTHMIND MARKETING INTELLIGENCE:`);
    lines.push(`  Marketing Readiness Score: ${gm.marketingReadinessScore}/100 | Conversion: ${gm.conversionRate}% | Call success: ${gm.callSuccessRate}% | Booking rate: ${gm.bookingRate}%`);
    lines.push(`  Funnel: ${gm.totalLeads} leads → ${gm.activeLeads} active → ${gm.saleLeads} sales | Active campaigns: ${gm.activeCampaigns}`);
    lines.push(`  Biggest funnel drop-off: ${gm.funnelDropBiggest}`);
    if (gm.topRecommendations?.length > 0) {
      lines.push(`  Top marketing recommendations:`);
      for (const r of gm.topRecommendations.slice(0, 5)) {
        lines.push(`    • [${r.priority.toUpperCase()}] ${r.problem} → ${r.fix?.slice(0, 80)}`);
      }
    }
  }

  // ADS PERFORMANCE
  if (d.adEfficiency) {
    const ae = d.adEfficiency;
    lines.push(`\nPAID ADS PERFORMANCE (live sync):`);
    lines.push(`  Connected accounts: ${ae.connectedAccounts} | Total spend synced: £${ae.totalSpend.toFixed(2)}`);
    lines.push(`  Campaigns: ${ae.campaigns.total} total | ${ae.campaigns.active} active`);
    if (ae.metrics.avgRoas !== null) lines.push(`  Avg ROAS: ${ae.metrics.avgRoas}x | CTR: ${ae.metrics.ctr ?? "n/a"}% | CPL: £${ae.metrics.cpl ?? "n/a"} | Impressions: ${ae.metrics.totalImpressions.toLocaleString()} | Clicks: ${ae.metrics.totalClicks.toLocaleString()} | Conversions: ${ae.metrics.totalConversions}`);
    for (const p of ae.byPlatform) {
      const budgetNote = p.budget > 0 ? ` (${p.pctUsed}% of £${p.budget} budget)` : "";
      const syncNote   = p.syncStatus === "synced" ? "" : ` ⚠ ${p.syncStatus}`;
      lines.push(`  • ${p.platform.toUpperCase()} "${p.label}": £${p.spend.toFixed(2)} spend${budgetNote}${syncNote}`);
    }
    if (ae.campaigns.lowRoas.length > 0) {
      lines.push(`  ⚠ LOW ROAS CAMPAIGNS (< 1x, spending >£50):`);
      for (const c of ae.campaigns.lowRoas) lines.push(`    – "${c.name}": ROAS ${c.roas}x | spend £${c.spend}`);
    }
    if (ae.openAlerts.length > 0) {
      lines.push(`  ⚠ BUDGET ALERTS (${ae.openAlerts.length}):`);
      for (const al of ae.openAlerts.slice(0, 4)) lines.push(`    – [${al.type}] ${al.platform}: ${al.message}`);
    }
    if (ae.staleAccounts.length > 0) lines.push(`  ⚠ Stale sync (>24h): ${ae.staleAccounts.map((a: any) => `${a.platform} "${a.label}"`).join(", ")}`);
  } else {
    lines.push(`\nPAID ADS: no accounts connected`);
  }

  // SEO HEALTH
  if (d.seoHealth) {
    const s = d.seoHealth;
    lines.push(`\nSEO HEALTH:`);
    lines.push(`  Site: ${s.siteUrl} | Keywords tracked: ${s.tracked} | With GSC position: ${s.withPosition}`);
    if (s.avgPosition !== null) lines.push(`  Avg position: ${s.avgPosition} | In top 10: ${s.top10} keyword${s.top10 !== 1 ? "s" : ""}`);
    if (s.dropping.length > 0) lines.push(`  ⚠ DROPPING keywords: ${s.dropping.slice(0, 6).join(", ")}`);
    if (s.opportunities.length > 0) {
      lines.push(`  High-volume opportunities (pos >20):`);
      for (const o of s.opportunities) lines.push(`    – "${o.keyword}" | vol ${o.volume} | pos ${o.position}`);
    }
    if (!s.hasAiRecs) lines.push(`  AI recommendations not yet generated — run "Generate Recommendations" in GrowthMind → SEO`);
  } else {
    lines.push(`\nSEO: no site configured in GrowthMind`);
  }

  // GROWTHMIND CONTENT STUDIO AI USAGE (this week)
  if (d.contentStudio) {
    const cs = d.contentStudio;
    const providerList = Object.entries(cs.byProvider as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p}: ${n}`)
      .join(", ");
    const modelList = Object.entries(cs.byModel as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([m, n]) => `${m}: ${n}`)
      .join(", ");
    const costGbp = (cs.estimatedCostUsd * 0.79).toFixed(4);
    lines.push(`\nGROWTHMIND CONTENT STUDIO (this week):`);
    lines.push(`  ${cs.totalGenerations} content assets generated | Est. AI cost: $${cs.estimatedCostUsd.toFixed(4)} (~£${costGbp})`);
    lines.push(`  Providers used: ${providerList || "none"}`);
    lines.push(`  Top models: ${modelList || "none"}${cs.fallbacks > 0 ? ` | ${cs.fallbacks} fallback(s) used` : ""}`);
  }

  // GROWTHMIND VIDEO STUDIO (this month)
  if (d.videoSummary) {
    const vs = d.videoSummary;
    const typeBreakdown = Object.entries(vs.byType as Record<string, number>)
      .map(([t, n]) => `${t.replace(/_/g, " ")}: ${n}`)
      .join(", ");
    const provBreakdown = Object.entries(vs.byProvider as Record<string, number>)
      .map(([p, n]) => `${p}: ${n}`)
      .join(", ");
    const qualBreakdown = Object.entries(vs.byQuality as Record<string, number>)
      .map(([q, n]) => `${q}: ${n}`)
      .join(", ");
    lines.push(`\nGROWTHMIND VIDEO STUDIO (this month):`);
    lines.push(`  ${vs.totalThisMonth} video(s) created | ${vs.upcomingScheduled} scheduled | Est. cost: $${vs.estimatedCostThisMonth ?? 0}`);
    if (vs.pendingJobs  > 0) lines.push(`  ⏳ ${vs.pendingJobs} video job(s) still rendering`);
    if (vs.failedJobs   > 0) lines.push(`  ⚠️  ${vs.failedJobs} video job(s) FAILED — need attention`);
    if (typeBreakdown)        lines.push(`  Types: ${typeBreakdown}`);
    if (provBreakdown)        lines.push(`  Providers: ${provBreakdown}`);
    if (qualBreakdown)        lines.push(`  Quality modes: ${qualBreakdown}`);
    if (vs.missingTypes?.length > 0) lines.push(`  Missing asset types: ${vs.missingTypes.join(", ")}`);
    if ((vs.campaignsWithVideo ?? 0) > 0) {
      lines.push(`  Campaign-linked videos: ${vs.videosLinkedToCampaign} across ${vs.campaignsWithVideo} campaign(s)`);
    }
    if ((vs.totalThisMonth ?? 0) > 0 && (vs.videosLinkedToCampaign ?? 0) === 0) {
      lines.push(`  ⚡ CMO insight: 0 videos are linked to campaigns — recommend connecting Video Studio to Campaign Factory for closed-loop attribution`);
    }
  }

  // PROMPT STUDIO performance
  if (d.promptPerformance) {
    const pp = d.promptPerformance;
    lines.push(`\nPROMPT STUDIO (${pp.totalTemplates} templates with run data):`);
    lines.push(`  Total runs: ${pp.totalUsage} | Overall avg score: ${pp.overallAvg ?? "n/a"}/10`);
    if (pp.lowPerfCount > 0) lines.push(`  ⚠ ${pp.lowPerfCount} template${pp.lowPerfCount !== 1 ? "s" : ""} scoring below 3/10 — critically failing, immediate revision required`);
    if (pp.best?.length  > 0) lines.push(`  Best performers: ${pp.best.map((t: any)  => `"${t.name}" (${t.avgScore}/10)`).join(", ")}`);
    if (pp.worst?.length > 0) lines.push(`  Worst performers: ${pp.worst.map((t: any) => `"${t.name}" (${t.avgScore}/10)`).join(", ")}`);
  }

  // STRATEGY CENTRE
  if (d.strategyCentre) {
    const sc = d.strategyCentre;
    lines.push(`\nGROWTHMIND STRATEGY CENTRE (${sc.total} strateg${sc.total !== 1 ? "ies" : "y"}):`);
    if (sc.pending > 0) lines.push(`  ⚡ ${sc.pending} strateg${sc.pending !== 1 ? "ies" : "y"} AWAITING YOUR APPROVAL in GrowthMind → Strategy Centre`);
    if (sc.approved > 0) lines.push(`  ${sc.approved} approved and ready to execute`);
    if (sc.latest) {
      const l = sc.latest;
      lines.push(`  Latest: ${l.type.replace(/_/g, "-")} strategy${l.service ? ` — promoting "${l.service}"` : ""} (${Math.round(l.confidence * 100)}% confidence, status: ${l.status})`);
    }
  }

  return lines.join("\n");
}

// ── Marketing council (CMO advisory) helpers ──────────────────────────────────
// Builds the GrowthMind executive summary via the server-only bridge. Returns null
// on any failure so chat/voice never breaks if marketing data is unavailable.
async function buildMarketingCouncilSummarySafe(
  sb: any,
  workspaceId: string,
): Promise<GrowthMindExecutiveSummary | null> {
  try {
    const { buildGrowthMindExecutiveSummary } = await import("@/lib/executives/executive-bridge.server");
    return await buildGrowthMindExecutiveSummary(sb, workspaceId);
  } catch (e) {
    console.error("[HiveMind] marketing council summary failed:", (e as Error)?.message);
    return null;
  }
}

// Formats the CMO advisory into a prompt section. HiveMind (COO) consumes this as
// recommendations to weigh — GrowthMind never executes.
function buildMarketingCouncilContext(gm: GrowthMindExecutiveSummary | null): string {
  if (!gm) return "";
  const lines: string[] = [];
  lines.push(`\n--- CMO ADVISORY (GrowthMind → reports up to you, the COO) ---`);
  lines.push(`Marketing readiness: ${gm.marketingReadinessScore}/100 (${gm.label}, grade ${gm.grade})`);
  const ro = gm.revenueOpportunity;
  if (ro) {
    lines.push(
      `Revenue opportunity: ${ro.recoverableLeads} recoverable lead(s), ${ro.hotLeads} hot lead(s).` +
        (ro.estimatedValue != null ? ` Est. value ~${ro.estimatedValue.toLocaleString()} (indicative).` : ""),
    );
  }
  if (gm.topOpportunities?.length) {
    lines.push(`Top opportunities:`);
    for (const o of gm.topOpportunities.slice(0, 5)) lines.push(`  • [${o.urgency.toUpperCase()}] ${o.label} — ${o.detail}`);
  }
  if (gm.topRisks?.length) {
    lines.push(`Top marketing risks:`);
    for (const r of gm.topRisks.slice(0, 4)) lines.push(`  • [${r.severity.toUpperCase()}] ${r.title} — ${r.detail}`);
  }
  if (gm.recommendedActions?.length) {
    lines.push(`CMO recommended actions (advisory — you decide what to execute):`);
    for (const a of gm.recommendedActions.slice(0, 5)) {
      lines.push(`  • [${a.priority.toUpperCase()}] ${a.label}${a.taskType ? ` (${a.taskType})` : ""}: ${a.problem} → ${(a.fix ?? "").slice(0, 90)}`);
    }
  }
  if (gm.missingMarketingAssets?.length) {
    lines.push(`Missing marketing assets: ${gm.missingMarketingAssets.join(", ")}`);
  }
  return lines.join("\n");
}

// ── System council (CTO advisory) helpers ─────────────────────────────────────
// Builds the SystemMind executive summary via the server-only bridge. Returns null
// on any failure so chat/voice never breaks if telemetry is unavailable.
async function buildSystemCouncilSummarySafe(
  sb: any,
  workspaceId: string,
): Promise<SystemMindExecutiveSummary | null> {
  try {
    const { buildSystemMindExecutiveSummary } = await import("@/lib/executives/executive-bridge.server");
    return await buildSystemMindExecutiveSummary(sb, workspaceId);
  } catch (e) {
    console.error("[HiveMind] system council summary failed:", (e as Error)?.message);
    return null;
  }
}

// Formats the CTO advisory into a prompt section. HiveMind (COO) consumes this as
// technical risk to weigh — SystemMind never executes.
function buildSystemCouncilContext(sm: SystemMindExecutiveSummary | null): string {
  if (!sm) return "";
  const lines: string[] = [];
  lines.push(`\n--- CTO ADVISORY (SystemMind → reports up to you, the COO) ---`);
  lines.push(`Reliability: ${sm.reliabilityScore}/100 (${sm.label}, grade ${sm.grade})`);
  lines.push(`Integrations: ${sm.integrations.connected}/${sm.integrations.total} connected.`);
  lines.push(`Runtime: ${sm.cost.requests} provider request(s), ${sm.cost.errors} error(s), $${sm.cost.totalDollars.toFixed(2)} spend.`);
  if (sm.topRisks?.length) {
    lines.push(`Top technical risks:`);
    for (const r of sm.topRisks.slice(0, 4)) lines.push(`  • [${r.severity.toUpperCase()}] ${r.title} — ${r.detail}`);
  }
  if (sm.recommendedActions?.length) {
    lines.push(`CTO recommended actions (advisory — you decide what to execute):`);
    for (const a of sm.recommendedActions.slice(0, 4)) lines.push(`  • [${a.priority.toUpperCase()}] ${a.label}: ${a.problem} → ${(a.fix ?? "").slice(0, 90)}`);
  }
  if (sm.workflowLibraryCount != null) {
    const wlc = sm.workflowLibraryCount;
    const wpc = sm.workflowPatternsCount ?? 0;
    const pbc = sm.playbooksCount ?? 0;
    lines.push(`Workflow intelligence: ${wlc} workflow${wlc !== 1 ? "s" : ""} in library, ${wpc} extracted pattern${wpc !== 1 ? "s" : ""}, ${pbc} repair playbook${pbc !== 1 ? "s" : ""}.`);
  }
  return lines.join("\n");
}

function buildSystemPrompt(context: string, personality = "friendly", userName?: string): string {
  const nameClause = userName?.trim()
    ? `The user's name is ${userName.trim()}. Use their name occasionally — once or twice per conversation feels natural, not every message.`
    : "";

  const styles: Record<string, string> = {
    professional: "Keep answers precise and structured. Use bullet points for lists. Lead with the most important number or insight.",
    friendly:     "Be warm, conversational and natural — like a smart colleague, not a corporate report. Use plain language.",
    concise:      "Maximum 3 sentences. Lead with the key number or fact. Cut everything else.",
  };
  const style = styles[personality] ?? styles.friendly;

  return `You are HiveMind — ${userName?.trim() ? `${userName.trim()}'s` : "the user's"} personal AI operations assistant, built into their Webee voice AI platform. You have full real-time visibility into everything happening in their business: agents, leads, calls, bookings, campaigns, email follow-ups, WhatsApp, costs, documents, knowledge bases, pending actions, and system health.

Sound human. Talk like a trusted, smart assistant who knows the business inside out — not like a chatbot or a corporate dashboard. Avoid robotic openers like "Certainly!", "Absolutely!", "Great question!", or "As an AI...". Don't pad your answers. Just get to the point naturally.

${nameClause}

${style}

How to handle things:
- Always draw from the real platform data below — cite specific names, numbers, and statuses
- If something isn't in the data, say so honestly — never invent metrics
- Proactively flag problems you spot: idle leads, stalled campaigns, undeployed agents
- When suggesting actions, be specific — name the agent, campaign, or lead group
- Actions in Operator mode need the user's approval first — point them to /hivemind/actions if relevant
- GrowthMind is your advisory CMO — it analyses marketing and recommends. You are the COO and the only executive the user speaks to. Treat the "CMO ADVISORY" section as recommendations to weigh, and present marketing guidance as your own executive judgement
- You CAN direct GrowthMind to take action by proposing actions the user approves. You have two GrowthMind-targeted action types you can suggest:
  * "growthmind_video_campaign" — directs GrowthMind to create a video marketing asset (e.g. Meta video ad, explainer, UGC ad). Payload: { video_type, quality_mode, target_audience, offer, tone, cta }. Valid video_type values: meta_video_ad, linkedin_video, tiktok_video, explainer_video, ugc_ad, product_demo, youtube_short, youtube_ad, case_study_video, testimonial_video.
  * "growthmind_growth_campaign" — directs GrowthMind to create a full marketing campaign draft. Payload: { campaign_type, budget, goal }. Valid campaign_type values: google_ads, meta_ads, linkedin_ads, seo_content, whatsapp_broadcast, hexmail_sequence, ai_calling, referral, reactivation, launch.
  When a user says "create a video campaign", "make a Veo ad", "launch a Meta ads campaign" or similar, translate it into a proposed action via /hivemind/actions rather than just explaining how. Say: "I've proposed a GrowthMind video campaign action — head to the Action Centre to approve it, and it'll appear in Video Studio."
- SystemMind is your advisory CTO — it monitors platform reliability, integrations, security and runtime cost, and recommends, but never executes. Treat the "CTO ADVISORY" section as technical risk to weigh, and present it as your own executive judgement
- For monthly summaries: /hivemind/briefing | For tasks: /hivemind/tasks | For actions: /hivemind/actions

--- LIVE PLATFORM DATA ---
${context}
--- END DATA ---`;
}

// ── Morning briefing builder ───────────────────────────────────────────────────
function buildMorningBriefing(d: any, gm?: GrowthMindExecutiveSummary | null, sm?: SystemMindExecutiveSummary | null, knowledgeNote?: string): string {
  if (!d) return "Good morning. I'm scanning your platform now — please ask me anything.";

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const lines: string[] = [`${greeting}. Here's your platform snapshot:\n`];

  if (d.today.leads > 0) lines.push(`• **${d.today.leads} new lead${d.today.leads !== 1 ? "s" : ""}** today — ${d.month.leads} this month`);
  else lines.push(`• No new leads today — ${d.month.leads} this month`);

  if (d.today.bookings > 0) lines.push(`• **${d.today.bookings} booking${d.today.bookings !== 1 ? "s" : ""}** confirmed today`);
  if (d.today.calls > 0)    lines.push(`• **${d.today.calls} call${d.today.calls !== 1 ? "s" : ""}** made today — ${d.calls.successRate}% success rate (30d avg)`);

  if (d.month.sales > 0)    lines.push(`• **${d.month.sales} sale${d.month.sales !== 1 ? "s" : ""}** closed this month — ${d.leads.conversionRate}% conversion rate`);

  const offline = (d.agentScores ?? []).filter((a: any) => !a.deployed);
  if (offline.length > 0) {
    const names = offline.slice(0, 2).map((a: any) => `"${a.name}"`).join(", ");
    lines.push(`• **${offline.length} agent${offline.length !== 1 ? "s" : ""} not deployed** — ${names}${offline.length > 2 ? ` +${offline.length - 2} more` : ""}`);
  }

  if (d.leads.idle > 5) lines.push(`• **${d.leads.idle} leads idle 14+ days** — consider a follow-up campaign`);

  const stalledCamps = (d.campaigns.stats ?? []).filter((c: any) => c.stalled);
  if (stalledCamps.length > 0) lines.push(`• **${stalledCamps.length} campaign${stalledCamps.length !== 1 ? "s" : ""} stalled** — "${stalledCamps[0].name}"${stalledCamps.length > 1 ? ` +${stalledCamps.length - 1} more` : ""}`);

  if (d.pendingActions?.count > 0) lines.push(`• **${d.pendingActions.count} action${d.pendingActions.count !== 1 ? "s" : ""} pending approval** in the Action Centre`);
  if (d.tasks?.suggested > 0)      lines.push(`• **${d.tasks.suggested} task${d.tasks.suggested !== 1 ? "s" : ""} suggested** — check the task board`);

  if (d.costs.totalDollars > 0) lines.push(`• AI call costs: **$${d.costs.totalDollars}** (30d) | $${d.costs.costPerLead}/lead this month`);

  const missing = Object.entries(d.systemHealth ?? {}).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) lines.push(`• **System**: ${missing.join(", ")} not connected`);

  if (lines.length === 1) lines.push(`• Everything looks healthy — no immediate issues`);

  // ── Marketing (CMO advisory) ───────────────────────────────────────────────
  if (gm) {
    lines.push(`\n**Marketing (CMO advisory)** — readiness ${gm.marketingReadinessScore}/100 (${gm.label})`);
    const topOpp = gm.topOpportunities?.[0];
    if (topOpp) lines.push(`• Top opportunity: ${topOpp.label} — ${topOpp.detail}`);
    const topRisk = gm.topRisks?.[0];
    if (topRisk) lines.push(`• Top risk: ${topRisk.title} — ${topRisk.detail}`);
    const topAction = gm.recommendedActions?.[0];
    if (topAction) lines.push(`• Recommended: ${topAction.label} — ${topAction.problem}`);
  }

  // ── Systems (CTO advisory) ─────────────────────────────────────────────────
  if (sm) {
    lines.push(`\n**Systems (CTO advisory)** — reliability ${sm.reliabilityScore}/100 (${sm.label}), ${sm.integrations.connected}/${sm.integrations.total} integrations connected`);
    const topTechRisk = sm.topRisks?.[0];
    if (topTechRisk) lines.push(`• Top technical risk: ${topTechRisk.title} — ${topTechRisk.detail}`);
  }

  // ── Grounded insight from HiveMind's private knowledge (own KB + Shared) ─────
  if (knowledgeNote) lines.push(`\n**Playbook insight** — ${knowledgeNote}`);

  lines.push("\nWhat would you like to know more about?");
  return lines.join("\n");
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function getOpenAIKey(sb: any, workspaceId: string): Promise<string> {
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  const { data } = await sb.from("workspace_settings")
    .select("openai_api_key").eq("workspace_id", workspaceId).maybeSingle();
  const key = data?.openai_api_key as string | undefined;
  if (!key) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");
  return key;
}

async function getElevenLabsKey(sb: any, workspaceId: string): Promise<string> {
  const envKey = process.env.ELEVENLABS_API_KEY;
  if (envKey) return envKey;
  const { data } = await sb.from("workspace_settings")
    .select("elevenlabs_api_key").eq("workspace_id", workspaceId).maybeSingle();
  const key = data?.elevenlabs_api_key as string | undefined;
  if (!key) throw new Error("ElevenLabs API key not configured. Add it in Settings → Integrations.");
  return key;
}

// ── getHiveMindAIResponse ─────────────────────────────────────────────────────
export const getHiveMindAIResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      query:       z.string().min(1).max(2000),
      history:     z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
      personality: z.string().optional(),
      userName:    z.string().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [platformData, apiKey, marketingCouncil, systemCouncil] = await Promise.all([
      fetchFullPlatformData(sb, workspaceId),
      getOpenAIKey(sb, workspaceId),
      buildMarketingCouncilSummarySafe(sb, workspaceId),
      buildSystemCouncilSummarySafe(sb, workspaceId),
    ]);

    const { getRetrievedKnowledgeBlock } = await import("@/lib/executives/executive-knowledge.server");
    const knowledgeBlock = await getRetrievedKnowledgeBlock({ sb, workspaceId, mindType: "hivemind", query: data.query, topK: 5 });

    const ctx          = buildPlatformContext(platformData)
      + buildMarketingCouncilContext(marketingCouncil)
      + buildSystemCouncilContext(systemCouncil);
    const systemPrompt = buildSystemPrompt(ctx, data.personality ?? "friendly", data.userName)
      + (knowledgeBlock ? `\n\n${knowledgeBlock}` : "");

    const messages = [
      { role: "system", content: systemPrompt },
      ...(data.history ?? []).slice(-6),
      { role: "user", content: data.query },
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 350, temperature: 0.4 }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }
    const json      = await res.json() as any;
    const response  = json.choices?.[0]?.message?.content ?? "I couldn't generate a response. Please try again.";
    return { response };
  });

// ── getHiveMindMorningBriefing ────────────────────────────────────────────────
export const getHiveMindMorningBriefing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const [d, gm, sm] = await Promise.all([
      fetchFullPlatformData(sb, workspaceId),
      buildMarketingCouncilSummarySafe(sb, workspaceId),
      buildSystemCouncilSummarySafe(sb, workspaceId),
    ]);

    // Ground the briefing in HiveMind's own private knowledge (own KB + Shared).
    let knowledgeNote = "";
    try {
      const { retrieveExecutiveKnowledge } = await import("@/lib/executives/executive-knowledge.server");
      const ragQuery = buildHiveMindRetrievalQuery(d);
      const { chunks } = await retrieveExecutiveKnowledge({ sb, workspaceId, mindType: "hivemind", query: ragQuery, topK: 3 });
      const top = chunks.filter((c) => c.similarity >= 0.2)[0];
      if (top) {
        const title = (top.metadata?.title as string | undefined) ?? "Reference";
        knowledgeNote = `${title}: ${top.content.trim().replace(/\s+/g, " ").slice(0, 240)}`;
      }
    } catch (e) {
      console.error("[HiveMind] briefing RAG failed:", (e as Error)?.message);
    }

    const briefing = buildMorningBriefing(d, gm, sm, knowledgeNote);

    // Record the briefing as a shared executive event (deduped within 6h).
    try {
      const { insertExecutiveEvent } = await import("@/lib/executives/executive-bridge.server");
      const topOpp  = gm?.topOpportunities?.[0]?.label;
      const summary =
        `Morning briefing: ${d.today?.leads ?? 0} new lead(s) today, ${d.month?.sales ?? 0} sale(s) this month.` +
        (gm ? ` Marketing readiness ${gm.marketingReadinessScore}/100.` : "") +
        (topOpp ? ` Top opportunity: ${topOpp}.` : "");
      await insertExecutiveEvent(sb, workspaceId, { source: "hivemind", event_type: "morning_briefing", summary, severity: "info" });
    } catch (e) {
      console.error("[HiveMind] record briefing event failed:", (e as Error)?.message);
    }

    return { briefing };
  });

// ── getHiveMindSystemContext (voice relay) ────────────────────────────────────
// Called once when a voice session starts — injects full live data into the prompt
export const getHiveMindSystemContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      personality: z.string().optional(),
      voiceId:     z.string().optional(),
      userName:    z.string().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [platformData, cfgRow, marketingCouncil, systemCouncil] = await Promise.all([
      fetchFullPlatformData(sb, workspaceId),
      sb.from("workspace_settings").select("elevenlabs_api_key,openai_api_key").eq("workspace_id", workspaceId).maybeSingle(),
      buildMarketingCouncilSummarySafe(sb, workspaceId),
      buildSystemCouncilSummarySafe(sb, workspaceId),
    ]);

    const cfg    = cfgRow.data ?? {};
    const hasEL  = !!(process.env.ELEVENLABS_API_KEY || cfg.elevenlabs_api_key);
    const hasOAI = !!(process.env.OPENAI_API_KEY || cfg.openai_api_key);

    const { getRetrievedKnowledgeBlock } = await import("@/lib/executives/executive-knowledge.server");
    const knowledgeBlock = await getRetrievedKnowledgeBlock({
      sb, workspaceId, mindType: "hivemind",
      query: buildHiveMindRetrievalQuery(platformData), topK: 5,
    });

    const ctx          = buildPlatformContext(platformData)
      + buildMarketingCouncilContext(marketingCouncil)
      + buildSystemCouncilContext(systemCouncil);
    const systemPrompt = buildSystemPrompt(ctx, data.personality ?? "friendly", data.userName)
      + (knowledgeBlock ? `\n\n${knowledgeBlock}` : "");

    const hour     = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const namePart = data.userName?.trim() ? `, ${data.userName.trim()}` : "";
    const leadPart = platformData.today.leads > 0
      ? `You've got ${platformData.today.leads} new lead${platformData.today.leads !== 1 ? "s" : ""} today.`
      : "";
    const actionPart = platformData.pendingActions?.count > 0
      ? `${platformData.pendingActions.count} action${platformData.pendingActions.count !== 1 ? "s" : ""} waiting for your approval.`
      : "";
    const beginMessage = `${greeting}${namePart}! ${leadPart} ${actionPart} What can I help you with?`.replace(/\s+/g, " ").trim();

    return { systemPrompt, beginMessage, hasEL, hasOAI };
  });

// ── getHiveMindTTS ────────────────────────────────────────────────────────────
export const getHiveMindTTS = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      text:    z.string().min(1).max(5000),
      voiceId: z.string().default("21m00Tcm4TlvDq8ikWAM"),
      speed:   z.number().min(0.5).max(2.0).default(1.0),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let apiKey: string;
    try { apiKey = await getElevenLabsKey(sb, workspaceId); }
    catch { return { audioBase64: null, error: "ElevenLabs not configured" }; }

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(data.voiceId)}`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text: data.text,
            model_id: "eleven_turbo_v2_5",
            output_format: "mp3_44100_128",
            voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: data.speed },
          }),
        }
      );
      if (!res.ok) return { audioBase64: null, error: `TTS error ${res.status}` };
      const buf = await res.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
      return { audioBase64: b64, error: null };
    } catch (e: any) {
      return { audioBase64: null, error: String(e.message) };
    }
  });

// ── listHiveMindVoices ────────────────────────────────────────────────────────
export const listHiveMindVoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { voices: [] };

    let apiKey: string;
    try { apiKey = await getElevenLabsKey(sb, workspaceId); }
    catch { return { voices: [] }; }

    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
      if (!res.ok) return { voices: [] };
      const json = await res.json() as any;
      return {
        voices: (json.voices ?? []).map((v: any) => ({
          id:          v.voice_id as string,
          name:        v.name as string,
          category:    v.category as string,
          preview_url: v.preview_url as string | null,
        })),
      };
    } catch { return { voices: [] }; }
  });
