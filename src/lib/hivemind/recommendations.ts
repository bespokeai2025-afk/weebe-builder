export type Priority = "critical" | "high" | "medium" | "low";

export type Recommendation = {
  id: string;
  category: string;
  priority: Priority;
  problem: string;
  impact: string;
  fix: string;
  action?: { label: string; href: string };
};

// ── Engine ──────────────────────────────────────────────────────────────────────
export function generateRecommendations(data: any): Recommendation[] {
  if (!data) return [];
  const recs: Recommendation[] = [];
  const {
    agents, agentScores, calls, leads, bookings,
    campaigns, whatsapp, telephony, phoneNumbers,
    systemHealth, settings,
  } = data;

  // ── SETUP ──

  // Brand-new workspace: no agents, no leads, no calls → provide a full onboarding path
  const isNewWorkspace = agents.length === 0 && (leads?.total ?? 0) === 0 && (calls?.total ?? 0) === 0;

  if (agents.length === 0) {
    recs.push({
      id: "no-agents", category: "Setup", priority: "critical",
      problem: "No voice agents have been created",
      impact: "The platform has nothing to handle calls, follow-ups, or bookings. No value can be delivered until at least one agent exists.",
      fix: "Create your first voice agent in Agents → New Agent.",
      action: { label: "Create Agent", href: "/my-agents" },
    });
  }

  // Business DNA not configured (settings.businessName is a proxy for DNA completion)
  if (isNewWorkspace || !settings?.businessName) {
    recs.push({
      id: "no-business-dna", category: "Setup", priority: "critical",
      problem: "Business DNA is not configured",
      impact: "HiveMind cannot personalise recommendations, generate strategies, or brief your AI agents without knowing your business profile.",
      fix: "Complete your Business DNA in HiveMind → Business DNA to unlock personalised insights.",
      action: { label: "Business DNA", href: "/hivemind/business-dna" },
    });
  }

  if (!systemHealth.retell && agents.length > 0) {
    recs.push({
      id: "no-retell", category: "Setup", priority: "critical",
      problem: "Voice platform API key is not configured",
      impact: "No agent can be deployed or make any calls. The entire voice layer is non-functional.",
      fix: "Add your OmniVoice workspace key in Settings → Integrations.",
      action: { label: "Settings → Integrations", href: "/settings/integrations" },
    });
  }

  if (!systemHealth.calcom) {
    recs.push({
      id: "no-calcom", category: "Setup", priority: "high",
      problem: "Calendar (Cal.com) is not connected",
      impact: "Agents cannot auto-book appointments. Every booking must be done manually, losing conversion rate.",
      fix: "Add your Cal.com API key in Settings → Calendar.",
      action: { label: "Settings → Calendar", href: "/settings/calendar" },
    });
  }

  // WhatsApp not connected at all (not just idle)
  if (!systemHealth.whatsapp) {
    recs.push({
      id: "no-whatsapp", category: "Setup", priority: "medium",
      problem: "WhatsApp is not connected",
      impact: "You cannot reach leads via WhatsApp. Many prospects prefer messaging over voice calls.",
      fix: "Connect WhatsApp in Settings → Integrations → WhatsApp.",
      action: { label: "Connect WhatsApp", href: "/settings/integrations" },
    });
  }

  // No marketing integrations — recommend GrowthMind setup
  const hasAnyMarketingIntegration = systemHealth?.googleAnalytics || systemHealth?.metaAds ||
    systemHealth?.googleAds || systemHealth?.whatsapp || systemHealth?.email;
  if (!hasAnyMarketingIntegration && agents.length === 0) {
    recs.push({
      id: "no-marketing-setup", category: "Setup", priority: "medium",
      problem: "No marketing channels are connected",
      impact: "GrowthMind cannot analyse ad performance, web traffic, or campaign ROI without connected data sources.",
      fix: "Connect Google Analytics, Meta Ads, or Google Ads in Settings → Integrations, then open GrowthMind.",
      action: { label: "Open GrowthMind", href: "/growthmind" },
    });
  }

  // Fix #10: only flag missing AI key if an agent is NOT on Retell mode
  const nonRetellAgents = (agentScores ?? []).filter(
    (a: any) => a.deploymentMode && a.deploymentMode !== "retell"
  );
  if (!systemHealth.elevenlabs && !systemHealth.openai && nonRetellAgents.length > 0) {
    recs.push({
      id: "no-ai-provider", category: "Setup", priority: "medium",
      problem: "No AI voice provider key configured (ElevenLabs or OpenAI)",
      impact: "HyperStream / VoxStream agents cannot function without an AI provider key.",
      fix: "Add at least one provider key in Settings → Integrations.",
      action: { label: "Settings → Integrations", href: "/settings/integrations" },
    });
  }

  if (!systemHealth.twilio && phoneNumbers.length === 0) {
    recs.push({
      id: "no-telephony", category: "Setup", priority: "medium",
      problem: "No telephony provider connected and no phone numbers assigned",
      impact: "Inbound calls cannot be received. Outbound dial-out is not possible.",
      fix: "Connect Twilio in Telephony Settings or assign phone numbers to agents.",
      action: { label: "Telephony Settings", href: "/telephony-settings" },
    });
  }

  // ── AGENT HEALTH ──
  for (const a of agentScores ?? []) {
    if (!a.deployed) {
      recs.push({
        id: `agent-offline-${a.id}`, category: "Agent Health", priority: "high",
        problem: `Agent "${a.name}" is not deployed`,
        impact: "This agent cannot receive or make any calls until it is deployed.",
        fix: "Open the Builder, select this agent, and click the Deploy button.",
        action: { label: "Open Builder", href: "/builder" },
      });
    }

    if (a.deployed && !a.hasPhone) {
      recs.push({
        id: `agent-no-phone-${a.id}`, category: "Agent Health", priority: "medium",
        problem: `Agent "${a.name}" has no phone number assigned`,
        impact: "Inbound callers have no number to reach this agent.",
        fix: "Assign a phone number to this agent in Phone Numbers.",
        action: { label: "Phone Numbers", href: "/phone-numbers" },
      });
    }

    if (!a.hasKB && a.deployed) {
      recs.push({
        id: `agent-no-kb-${a.id}`, category: "Agent Health", priority: "low",
        problem: `Agent "${a.name}" has no knowledge base attached`,
        impact: "The agent can only answer from its system prompt. Questions about products, FAQs, and policies may be answered incorrectly.",
        fix: "Upload a knowledge base document in the Builder under this agent's Knowledge Base tab.",
        action: { label: "Open Builder", href: "/builder" },
      });
    }

    if (a.deployed && a.callCount > 10 && a.successRate < 30) {
      recs.push({
        id: `agent-low-success-${a.id}`, category: "Agent Health", priority: "high",
        problem: `Agent "${a.name}" has a low success rate (${a.successRate}%)`,
        impact: "Over 70% of calls are not achieving their goal. Budget is being wasted on unproductive calls.",
        fix: "Review the agent's prompt and conversation flow in the Builder. Improve objection handling and goal clarity.",
        action: { label: "Open Builder", href: "/builder" },
      });
    }

    if (a.deployed && a.callCount === 0) {
      recs.push({
        id: `agent-no-calls-${a.id}`, category: "Agent Health", priority: "medium",
        problem: `Agent "${a.name}" is deployed but has made 0 calls in the last 30 days`,
        impact: "A deployed agent with no activity indicates a routing or campaign issue.",
        fix: "Check that the agent is assigned a phone number and attached to an active campaign.",
        action: { label: "Phone Numbers", href: "/phone-numbers" },
      });
    }
  }

  // ── LEADS ──
  if (leads.total === 0) {
    recs.push({
      id: "no-leads", category: "Pipeline", priority: "high",
      problem: "No leads have been imported",
      impact: "Agents have nobody to call. All campaign and follow-up capabilities sit idle.",
      fix: "Import leads via Data → Import (CSV) or add them manually.",
      action: { label: "Import Leads", href: "/data" },
    });
  }

  // Fix #9: note the threshold in text — keeps it accurate vs Briefing's configurable threshold
  if (leads.stale > 10) {
    recs.push({
      id: "stale-leads", category: "Pipeline", priority: "medium",
      problem: `${leads.stale} active leads have had no activity for 14+ days`,
      impact: "Stale leads signal pipeline blockage and lost revenue. Cold leads convert at a fraction of warm leads.",
      fix: "Review stale leads in the Pipeline view. Move, call, or disqualify them.",
      action: { label: "View Pipeline", href: "/pipeline" },
    });
  }

  if (leads.needCall > 50 && campaigns.active === 0) {
    recs.push({
      id: "uncontacted-leads", category: "Pipeline", priority: "high",
      problem: `${leads.needCall} leads are waiting for a call but no campaign is active`,
      impact: "Leads waiting for contact go cold within days. Each day without contact reduces conversion probability.",
      fix: "Launch a call campaign from the Campaigns page to start reaching these leads.",
      action: { label: "Start Campaign", href: "/campaigns" },
    });
  }

  if (leads.total > 0 && leads.sales === 0 && calls.total > 20) {
    recs.push({
      id: "no-sales", category: "Pipeline", priority: "high",
      problem: "Calls are happening but no leads have been marked as Sale Done",
      impact: "Either deals are not closing or outcomes are not being tracked — both are serious revenue blind spots.",
      fix: "Ensure agents are programmed to update lead status after a successful close, or manually review recent calls.",
      action: { label: "View Leads", href: "/leads" },
    });
  }

  // ── CAMPAIGNS ──
  if (campaigns.total === 0 && leads.total > 0) {
    recs.push({
      id: "no-campaigns", category: "Campaigns", priority: "medium",
      problem: "No call campaigns have been created",
      impact: "Leads sit untouched with no systematic outreach. A campaign structures follow-up automatically.",
      fix: "Create a campaign in the Campaigns section and attach your leads.",
      action: { label: "Create Campaign", href: "/campaigns" },
    });
  }

  for (const c of campaigns.stats ?? []) {
    if ((c.status === "stopped" || c.status === "paused") && c.completionPct < 80) {
      recs.push({
        id: `campaign-inactive-${c.id}`, category: "Campaigns", priority: "medium",
        problem: `Campaign "${c.name}" is inactive at ${c.completionPct}% completion`,
        impact: `${c.totalLeads - c.completedCalls} leads are not being reached. Paused campaigns lose momentum.`,
        fix: "Restart or review the campaign in the Campaigns section.",
        action: { label: "Campaigns", href: "/campaigns" },
      });
    }

    if (c.completionPct === 0 && c.status === "running") {
      recs.push({
        id: `campaign-stalled-${c.id}`, category: "Campaigns", priority: "high",
        problem: `Campaign "${c.name}" is running but has 0% completion`,
        impact: "A running campaign with no progress indicates a configuration or agent issue. Leads are not being called.",
        fix: "Check the agent assignment and phone number in the campaign settings.",
        action: { label: "Campaigns", href: "/campaigns" },
      });
    }
  }

  // ── CONVERSIONS ──
  if (calls.total > 30 && bookings.total === 0 && systemHealth.calcom) {
    recs.push({
      id: "calls-no-bookings", category: "Conversion", priority: "high",
      problem: "Many calls are happening but no appointments have been booked",
      impact: "Calls are not converting to meetings. Revenue is slipping despite high activity.",
      fix: "Ensure the booking tool is enabled in the agent's Builder flow and that Cal.com event types are accessible.",
      action: { label: "Check Calendar", href: "/settings/calendar" },
    });
  }

  // ── WHATSAPP ──
  if (systemHealth.whatsapp && whatsapp.total === 0) {
    recs.push({
      id: "wa-no-messages", category: "WhatsApp", priority: "low",
      problem: "WhatsApp is connected but no messages have been sent in 30 days",
      impact: "The WhatsApp channel is idle. Leads who prefer messaging are not being reached.",
      fix: "Create a WhatsApp campaign or enable WhatsApp follow-up in your agent flows.",
      action: { label: "WhatsApp", href: "/whatsapp" },
    });
  }

  // ── TELEPHONY ──
  if (phoneNumbers.length > 0) {
    const unassigned = phoneNumbers.filter((p: any) => !p.agent_id);
    if (unassigned.length > 0) {
      recs.push({
        id: "unassigned-numbers", category: "Telephony", priority: "medium",
        problem: `${unassigned.length} phone number${unassigned.length > 1 ? "s are" : " is"} not assigned to any agent`,
        impact: "Unassigned numbers cannot receive calls. They are a wasted resource.",
        fix: "Assign each phone number to an agent in Phone Numbers.",
        action: { label: "Phone Numbers", href: "/phone-numbers" },
      });
    }

    const disconnected = phoneNumbers.filter((p: any) => p.active === false);
    if (disconnected.length > 0) {
      recs.push({
        id: "disconnected-numbers", category: "Telephony", priority: "high",
        problem: `${disconnected.length} phone number${disconnected.length > 1 ? "s are" : " is"} disconnected`,
        impact: "Inbound callers will reach a dead line. This directly destroys trust and leads.",
        fix: "Review and reconnect or replace the disconnected number(s) in Phone Numbers.",
        action: { label: "Phone Numbers", href: "/phone-numbers" },
      });
    }
  }

  const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];
  return recs.sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
}
