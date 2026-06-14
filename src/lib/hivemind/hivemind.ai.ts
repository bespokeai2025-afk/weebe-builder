import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Shared platform data fetcher ──────────────────────────────────────────────
async function fetchFullPlatformData(sb: any, workspaceId: string) {
  const now        = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);
  const s14        = new Date(now); s14.setDate(now.getDate() - 14);
  const s30        = new Date(now); s30.setDate(now.getDate() - 30);
  const s60        = new Date(now); s60.setDate(now.getDate() - 60);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [ag, ca, le, bo, cp, wa, se, usage, hexCamps, hexEnroll, docs, tasks, actions, kbs] = await Promise.all([
    sb.from("agents").select("id,name,retell_agent_id,inbound_phone_number,settings").eq("workspace_id", workspaceId),
    sb.from("calls").select("id,agent_id,call_successful,duration_seconds,call_type,started_at").eq("workspace_id", workspaceId).gte("started_at", s60.toISOString()).limit(1000),
    sb.from("leads").select("id,full_name,status,pipeline_stage,created_at,updated_at,source,interest_level").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(3000),
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
  ]);

  if (le.error)   console.error("[HiveMind] leads query error:",   le.error.message);
  if (ag.error)   console.error("[HiveMind] agents query error:",  ag.error.message);
  if (ca.error)   console.error("[HiveMind] calls query error:",   ca.error.message);
  if (bo.error)   console.error("[HiveMind] bookings query error:",bo.error.message);
  if (se.error)   console.error("[HiveMind] settings query error:",se.error.message);

  const agents   = ag.data    ?? [];
  const calls    = ca.data    ?? [];
  const leads    = le.data    ?? [];
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
  const kbsArr   = kbs.data   ?? [];

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
  const recentLeads    = leads.slice(0, 10);
  const conversionRate = leads.length > 0 ? Math.round((salesTotal / leads.length) * 1000) / 10 : 0;

  // Pipeline breakdown
  const stageCounts: Record<string, number> = {};
  for (const l of leads) stageCounts[l.status] = (stageCounts[l.status] ?? 0) + 1;

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
      total: leads.length, active: activeLeads.length, idle: idleLeads.length,
      needCall: leads.filter((l: any) => l.status === "need_to_call").length,
      sales: salesTotal, salesMonth, conversionRate,
      highInterest: highInterest.length,
      stale: idleLeads.length,
      stageCounts,
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
  };
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
  lines.push(`  Total: ${d.leads.total} | Active: ${d.leads.active} | Need call: ${d.leads.needCall} | Sales all-time: ${d.leads.sales} | High interest: ${d.leads.highInterest}`);
  lines.push(`  Conversion rate: ${d.leads.conversionRate}% | Idle 14d+: ${d.leads.idle}`);

  // Pipeline
  const stages = Object.entries(d.leads.stageCounts ?? {})
    .sort((a: any, b: any) => b[1] - a[1])
    .map(([s, n]) => `${s.replace(/_/g, " ")}: ${n}`)
    .join(" | ");
  if (stages) lines.push(`  Pipeline: ${stages}`);

  // Recent leads
  if (d.leads.recent?.length) {
    lines.push(`  Recent leads: ${d.leads.recent.slice(0, 8).map((l: any) => `"${l.name}" (${l.status}${l.interest === "high" ? ", HIGH interest" : ""})`).join(", ")}`);
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
- For monthly summaries: /hivemind/briefing | For tasks: /hivemind/tasks

--- LIVE PLATFORM DATA ---
${context}
--- END DATA ---`;
}

// ── Morning briefing builder ───────────────────────────────────────────────────
function buildMorningBriefing(d: any): string {
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

    const [platformData, apiKey] = await Promise.all([
      fetchFullPlatformData(sb, workspaceId),
      getOpenAIKey(sb, workspaceId),
    ]);

    const ctx          = buildPlatformContext(platformData);
    const systemPrompt = buildSystemPrompt(ctx, data.personality ?? "friendly", data.userName);

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
    const d = await fetchFullPlatformData(sb, workspaceId);
    return { briefing: buildMorningBriefing(d) };
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

    const [platformData, cfgRow] = await Promise.all([
      fetchFullPlatformData(sb, workspaceId),
      sb.from("workspace_settings").select("elevenlabs_api_key,openai_api_key").eq("workspace_id", workspaceId).maybeSingle(),
    ]);

    const cfg    = cfgRow.data ?? {};
    const hasEL  = !!(process.env.ELEVENLABS_API_KEY || cfg.elevenlabs_api_key);
    const hasOAI = !!(process.env.OPENAI_API_KEY || cfg.openai_api_key);

    const ctx          = buildPlatformContext(platformData);
    const systemPrompt = buildSystemPrompt(ctx, data.personality ?? "friendly", data.userName);

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
