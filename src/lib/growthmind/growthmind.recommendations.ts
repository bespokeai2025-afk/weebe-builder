// ── GrowthMind Recommendation Engine ──────────────────────────────────────────
// Pure client-side function — no server calls

export type GrowthPriority = "critical" | "high" | "medium" | "low";

export type GrowthRecommendation = {
  id:       string;
  category: string;
  priority: GrowthPriority;
  problem:  string;
  impact:   string;
  fix:      string;
  action?:  { href: string; label: string };
};

export function generateGrowthRecommendations(data: any): GrowthRecommendation[] {
  if (!data) return [];

  const recs: GrowthRecommendation[] = [];
  const { calls, leads, bookings, campaigns, agentPerf, systemHealth, agents, whatsapp, email } = data;

  // ── LEAD RESPONSE TIME ────────────────────────────────────────────────────
  if (leads.avgResponseHrs !== null && leads.avgResponseHrs > 24) {
    recs.push({
      id: "slow-response",
      category: "Lead Response",
      priority: "critical",
      problem: `Average lead response time is ${leads.avgResponseHrs} hours`,
      impact: "Leads contacted within 1 hour are 7× more likely to convert. Slow response is the #1 conversion killer.",
      fix: "Deploy an outbound call campaign to contact new leads automatically within minutes of enquiry.",
      action: { href: "/campaigns", label: "View Campaigns" },
    });
  } else if (leads.avgResponseHrs !== null && leads.avgResponseHrs > 4) {
    recs.push({
      id: "medium-response",
      category: "Lead Response",
      priority: "high",
      problem: `Average lead response time is ${leads.avgResponseHrs} hours — aim for under 1h`,
      impact: "Contacting leads within 4h doubles conversion vs next-day follow-up.",
      fix: "Set up an automated outbound campaign triggered when new leads enter your pipeline.",
      action: { href: "/campaigns", label: "View Campaigns" },
    });
  }

  // ── FOLLOW-UP COVERAGE ────────────────────────────────────────────────────
  if (leads.active > 0 && leads.followUpCoverage < 50) {
    recs.push({
      id: "low-followup",
      category: "Pipeline",
      priority: "critical",
      problem: `Only ${leads.followUpCoverage}% of active leads have been contacted`,
      impact: `${Math.round(leads.active * (1 - leads.followUpCoverage / 100))} leads have never been called — each is a missed revenue opportunity.`,
      fix: "Create a call campaign targeting all untouched leads immediately.",
      action: { href: "/leads", label: "View Leads" },
    });
  } else if (leads.active > 0 && leads.followUpCoverage < 75) {
    recs.push({
      id: "medium-followup",
      category: "Pipeline",
      priority: "high",
      problem: `${leads.followUpCoverage}% follow-up coverage — ${100 - leads.followUpCoverage}% of active leads untouched`,
      impact: "Systematic follow-up increases close rates by 44% on average.",
      fix: "Run a follow-up campaign to reach leads that have not been called yet.",
      action: { href: "/leads", label: "View Leads" },
    });
  }

  // ── STALE LEADS ───────────────────────────────────────────────────────────
  if (leads.staleCount > 20) {
    recs.push({
      id: "stale-leads-high",
      category: "Pipeline",
      priority: "high",
      problem: `${leads.staleCount} leads stale for 14+ days`,
      impact: "Stale leads go cold fast — pipelines left unworked waste the marketing spend that acquired them.",
      fix: "Re-engage stale leads with a targeted WhatsApp broadcast or re-activation call campaign.",
      action: { href: "/leads", label: "View Stale Leads" },
    });
  } else if (leads.staleCount > 5) {
    recs.push({
      id: "stale-leads-medium",
      category: "Pipeline",
      priority: "medium",
      problem: `${leads.staleCount} leads haven't been updated in 14+ days`,
      impact: "Unworked leads dilute pipeline visibility and lower conversion rates.",
      fix: "Review and update stale leads — or run a re-engagement campaign.",
      action: { href: "/leads", label: "View Leads" },
    });
  }

  // ── CONVERSION RATE ───────────────────────────────────────────────────────
  if (leads.total >= 20 && leads.conversionRate < 5) {
    recs.push({
      id: "low-conversion",
      category: "Conversion",
      priority: "high",
      problem: `Conversion rate is ${leads.conversionRate}% — well below industry average`,
      impact: "Most leads are not converting. Improving to 10% would double your closed deals from the same pipeline.",
      fix: "Review your AI agent script, qualification criteria, and follow-up cadence. Consider A/B testing different opening messages.",
      action: { href: "/my-agents", label: "Review Agents" },
    });
  } else if (leads.total >= 10 && leads.conversionRate < 10) {
    recs.push({
      id: "medium-conversion",
      category: "Conversion",
      priority: "medium",
      problem: `Conversion rate of ${leads.conversionRate}% has room to improve`,
      impact: "Each percentage point improvement compounds into significant revenue gains over time.",
      fix: "Analyse call recordings for objections, refine your agent prompt, and add a stronger call-to-action.",
      action: { href: "/calls", label: "Review Calls" },
    });
  }

  // ── BOOKING RATE ──────────────────────────────────────────────────────────
  if (leads.total >= 10 && bookings.total === 0) {
    recs.push({
      id: "no-bookings",
      category: "Bookings",
      priority: "high",
      problem: "No bookings recorded despite having active leads",
      impact: "Bookings are a key conversion milestone. Zero bookings signals a funnel blockage.",
      fix: "Connect your calendar (Cal.com) and instruct your agents to offer appointments during calls.",
      action: { href: "/settings/calendar", label: "Connect Calendar" },
    });
  }

  // ── CAMPAIGNS ─────────────────────────────────────────────────────────────
  if (!systemHealth.campaigns && leads.total > 5) {
    recs.push({
      id: "no-campaigns",
      category: "Campaigns",
      priority: "high",
      problem: "No call campaigns created — leads are not being contacted at scale",
      impact: "Without campaigns, lead outreach depends entirely on manual effort. Automation can 10× your outreach volume.",
      fix: "Create your first call campaign targeting leads with 'need to call' status.",
      action: { href: "/campaigns", label: "Create Campaign" },
    });
  } else if (campaigns.active === 0 && campaigns.total > 0) {
    recs.push({
      id: "inactive-campaigns",
      category: "Campaigns",
      priority: "medium",
      problem: "All campaigns are inactive — no automated outreach running",
      impact: "Paused campaigns mean your leads are not being contacted. Pipeline activity drops without active outreach.",
      fix: "Restart or create a new campaign to resume automated lead contact.",
      action: { href: "/campaigns", label: "View Campaigns" },
    });
  }

  // ── AGENT PERFORMANCE ─────────────────────────────────────────────────────
  if (calls.total > 10 && calls.successRate < 30) {
    recs.push({
      id: "low-call-success",
      category: "Agent Performance",
      priority: "high",
      problem: `Call success rate is only ${calls.successRate}% — agents are underperforming`,
      impact: "Low success rates mean most outreach attempts fail. Improving to 50%+ would dramatically increase qualified opportunities.",
      fix: "Review call recordings, update agent prompts with better objection handling, and refine your opening script.",
      action: { href: "/calls", label: "Review Calls" },
    });
  }

  const idleAgents = (agentPerf ?? []).filter((a: any) => a.callCount === 0 && a.deployed);
  if (idleAgents.length > 0) {
    recs.push({
      id: "idle-agents",
      category: "Agent Performance",
      priority: "medium",
      problem: `${idleAgents.length} deployed agent${idleAgents.length > 1 ? "s" : ""} with zero call activity`,
      impact: "Deployed agents sitting idle are wasted capacity that could be generating revenue.",
      fix: "Assign these agents to an active campaign or check their phone number assignment.",
      action: { href: "/my-agents", label: "View Agents" },
    });
  }

  // ── WHATSAPP ──────────────────────────────────────────────────────────────
  if (!systemHealth.whatsapp && leads.total > 10) {
    recs.push({
      id: "no-whatsapp",
      category: "Channels",
      priority: "medium",
      problem: "WhatsApp not connected — missing a high-response outreach channel",
      impact: "WhatsApp messages have 98% open rates vs 20% for email. Connecting it could significantly boost engagement.",
      fix: "Set up WhatsApp integration in Buzzchat settings to reach leads via their preferred channel.",
      action: { href: "/whatsapp", label: "Set Up Buzzchat" },
    });
  }

  // ── EMAIL ─────────────────────────────────────────────────────────────────
  if (!systemHealth.email && leads.total > 10) {
    recs.push({
      id: "no-email",
      category: "Channels",
      priority: "low",
      problem: "No email campaigns — missing nurture touchpoints",
      impact: "Email nurture sequences keep leads warm between calls, improving eventual conversion rates.",
      fix: "Create a HexMail campaign to send follow-up sequences to unresponsive leads.",
      action: { href: "/hexmail", label: "Open HexMail" },
    });
  }

  // ── CALENDAR ─────────────────────────────────────────────────────────────
  if (!systemHealth.calcom) {
    recs.push({
      id: "no-calendar",
      category: "Setup",
      priority: "medium",
      problem: "Calendar not connected — agents cannot book appointments",
      impact: "Without calendar access, agents cannot close the loop by booking discovery calls or demos.",
      fix: "Connect your Cal.com account in Settings to enable agent-driven bookings.",
      action: { href: "/settings/calendar", label: "Connect Calendar" },
    });
  }

  // ── NO AGENTS ─────────────────────────────────────────────────────────────
  if (!systemHealth.agents) {
    recs.push({
      id: "no-agents",
      category: "Setup",
      priority: "critical",
      problem: "No AI agents configured",
      impact: "Without agents, there is no automated outreach, qualification, or booking capability.",
      fix: "Create and deploy your first AI agent from the Agents page.",
      action: { href: "/my-agents", label: "Create Agent" },
    });
  }

  const order: Record<GrowthPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}
