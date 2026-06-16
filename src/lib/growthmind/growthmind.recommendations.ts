// ── GrowthMind Marketing Recommendation Engine ────────────────────────────────
// Pure client-side function — no server calls
// Exclusively CMO/marketing focused — no platform infrastructure checks

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
  const { calls, leads, bookings, campaigns, whatsapp, email, marketing, systemHealth, ads } = data;

  // ── CAMPAIGN READINESS ────────────────────────────────────────────────────
  if (!systemHealth?.campaigns && (leads?.total ?? 0) > 5) {
    recs.push({
      id: "no-campaigns",
      category: "Campaigns",
      priority: "critical",
      problem: "No outreach campaigns created — leads are not being contacted at scale",
      impact: "Without campaigns, lead contact depends entirely on manual effort. Automation can 10× your outreach volume.",
      fix: "Create your first call campaign targeting leads with 'need to call' status.",
      action: { href: "/campaigns", label: "Create Campaign" },
    });
  } else if (!systemHealth?.activeCampaigns && systemHealth?.campaigns) {
    recs.push({
      id: "inactive-campaigns",
      category: "Campaigns",
      priority: "high",
      problem: "All campaigns are paused — no automated outreach is running",
      impact: "Paused campaigns mean your leads are not being contacted. Pipeline velocity drops without active outreach.",
      fix: "Restart an existing campaign or create a new one to resume automated lead contact.",
      action: { href: "/campaigns", label: "View Campaigns" },
    });
  }

  // ── LEAD RESPONSE TIME ────────────────────────────────────────────────────
  if ((leads?.avgResponseHrs ?? null) !== null && leads.avgResponseHrs > 24) {
    recs.push({
      id: "slow-response",
      category: "Lead Response",
      priority: "critical",
      problem: `Average lead response time is ${leads.avgResponseHrs} hours`,
      impact: "Leads contacted within 1 hour are 7× more likely to convert. Slow response is the #1 conversion killer.",
      fix: "Deploy an outbound call campaign to contact new leads automatically within minutes of enquiry.",
      action: { href: "/campaigns", label: "View Campaigns" },
    });
  } else if ((leads?.avgResponseHrs ?? null) !== null && leads.avgResponseHrs > 4) {
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
  if ((leads?.active ?? 0) > 0 && (leads?.followUpCoverage ?? 0) < 50) {
    recs.push({
      id: "low-followup",
      category: "Pipeline",
      priority: "critical",
      problem: `Only ${leads.followUpCoverage}% of active leads have been contacted`,
      impact: `${Math.round(leads.active * (1 - leads.followUpCoverage / 100))} leads have never been called — each is a missed revenue opportunity.`,
      fix: "Create a call campaign targeting all untouched leads immediately.",
      action: { href: "/leads", label: "View Leads" },
    });
  } else if ((leads?.active ?? 0) > 0 && (leads?.followUpCoverage ?? 0) < 75) {
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
  if ((leads?.staleCount ?? 0) > 20) {
    recs.push({
      id: "stale-leads-high",
      category: "Pipeline",
      priority: "high",
      problem: `${leads.staleCount} leads stale for 14+ days`,
      impact: "Stale leads go cold fast — pipelines left unworked waste the marketing spend that acquired them.",
      fix: "Re-engage stale leads with a targeted WhatsApp broadcast or re-activation call campaign.",
      action: { href: "/leads", label: "View Stale Leads" },
    });
  } else if ((leads?.staleCount ?? 0) > 5) {
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
  if ((leads?.total ?? 0) >= 20 && (leads?.conversionRate ?? 0) < 5) {
    recs.push({
      id: "low-conversion",
      category: "Conversion",
      priority: "high",
      problem: `Conversion rate is ${leads.conversionRate}% — well below industry average`,
      impact: "Most leads are not converting. Improving to 10% would double your closed deals from the same pipeline.",
      fix: "Review your outreach script, qualification criteria, and follow-up cadence. A/B test different opening messages.",
      action: { href: "/campaigns", label: "Review Campaigns" },
    });
  } else if ((leads?.total ?? 0) >= 10 && (leads?.conversionRate ?? 0) < 10) {
    recs.push({
      id: "medium-conversion",
      category: "Conversion",
      priority: "medium",
      problem: `Conversion rate of ${leads.conversionRate}% has room to improve`,
      impact: "Each percentage point improvement compounds into significant revenue gains over time.",
      fix: "Analyse call outcomes for common objections, refine your messaging, and add a stronger call-to-action.",
      action: { href: "/calls", label: "Review Calls" },
    });
  }

  // ── BOOKING RATE ──────────────────────────────────────────────────────────
  if ((leads?.total ?? 0) >= 10 && (bookings?.total ?? 0) === 0) {
    recs.push({
      id: "no-bookings",
      category: "Funnel",
      priority: "high",
      problem: "No bookings recorded despite having active leads",
      impact: "Bookings are a key conversion milestone. Zero bookings signals a mid-funnel blockage.",
      fix: "Instruct your agents to offer appointment bookings and ensure your calendar is connected.",
      action: { href: "/growthmind/lead-opportunities", label: "View Funnel" },
    });
  }

  // ── CONTENT MARKETING ────────────────────────────────────────────────────
  if (!(marketing?.recentContentCount > 0)) {
    recs.push({
      id: "no-recent-content",
      category: "Content",
      priority: "medium",
      problem: "No content published in the last 14 days",
      impact: "Consistent content publishing builds brand authority and drives organic inbound leads at zero ad cost.",
      fix: "Use Content Studio to generate and publish blog posts, social media, or email campaigns.",
      action: { href: "/growthmind/content-studio", label: "Open Content Studio" },
    });
  }

  // ── SEO ───────────────────────────────────────────────────────────────────
  if (!(marketing?.seoKeywords > 0)) {
    recs.push({
      id: "no-seo-keywords",
      category: "SEO",
      priority: "medium",
      problem: "No SEO keywords being tracked",
      impact: "Without keyword tracking you have no visibility into organic search performance or ranking opportunities.",
      fix: "Add your target keywords in GrowthMind SEO to start monitoring your search presence.",
      action: { href: "/growthmind/seo", label: "Open SEO" },
    });
  }

  // ── FOLLOW-UP EMAIL CAMPAIGNS ─────────────────────────────────────────────
  if (!systemHealth?.followUpCampaigns && (leads?.total ?? 0) > 10) {
    recs.push({
      id: "no-followup-email",
      category: "Nurture",
      priority: "medium",
      problem: "No follow-up email sequence configured",
      impact: "Email nurture sequences keep leads warm between calls, improving eventual conversion rates by up to 50%.",
      fix: "Create a follow-up email sequence in HexMail to automatically nurture leads between touchpoints.",
      action: { href: "/hexmail", label: "Open HexMail" },
    });
  }

  // ── WHATSAPP OUTREACH ─────────────────────────────────────────────────────
  if (!systemHealth?.whatsapp && (leads?.total ?? 0) > 10) {
    recs.push({
      id: "no-whatsapp",
      category: "Channels",
      priority: "medium",
      problem: "WhatsApp not connected — missing the highest-response outreach channel",
      impact: "WhatsApp messages have 98% open rates vs 20% for email. Connecting it could significantly boost engagement.",
      fix: "Set up WhatsApp in settings to reach leads via their preferred channel.",
      action: { href: "/whatsapp", label: "Set Up WhatsApp" },
    });
  } else if (systemHealth?.whatsapp && !systemHealth?.waOutreach && (leads?.total ?? 0) > 10) {
    recs.push({
      id: "wa-connected-no-outreach",
      category: "Channels",
      priority: "low",
      problem: "WhatsApp is connected but no outbound messages sent in the last 30 days",
      impact: "You have WhatsApp set up but aren't using it — this is a high-ROI channel sitting idle.",
      fix: "Send a broadcast to your leads or set up a WhatsApp campaign to re-engage your audience.",
      action: { href: "/whatsapp", label: "Open WhatsApp" },
    });
  }

  // ── COMPETITOR TRACKING ───────────────────────────────────────────────────
  if (!(marketing?.competitorsCount > 0)) {
    recs.push({
      id: "no-competitors",
      category: "Strategy",
      priority: "low",
      problem: "No competitors being tracked in GrowthMind",
      impact: "Without competitive intelligence you may be missing positioning opportunities or pricing insights.",
      fix: "Add your top competitors in GrowthMind to track their moves and benchmark your performance.",
      action: { href: "/growthmind/competitors", label: "Track Competitors" },
    });
  }

  // ── PAID ADS ──────────────────────────────────────────────────────────────
  if (ads?.hasSyncedData) {
    const totalSpend  = ads.totalSpend ?? 0;
    const metaRoas    = ads.meta?.avgRoas;
    const googleRoas  = ads.google?.avgRoas;

    // Zero-spend alert
    if (totalSpend === 0 && ads.totalCampaigns > 0) {
      recs.push({
        id: "ads-zero-spend",
        category: "Paid Ads",
        priority: "high",
        problem: "No ad spend recorded across connected ad accounts",
        impact: "Your ad accounts are connected but show zero spend — campaigns may be paused or not set up.",
        fix: "Check your Meta and Google Ads accounts for paused campaigns and activate them.",
        action: { href: "/growthmind/ads-performance", label: "View Ads" },
      });
    }

    // Low ROAS — Meta
    if (metaRoas !== null && metaRoas !== undefined && metaRoas < 1 && (ads.meta?.spend ?? 0) > 10) {
      recs.push({
        id: "meta-low-roas",
        category: "Paid Ads",
        priority: "high",
        problem: `Meta Ads ROAS is ${metaRoas.toFixed(2)}x — spending more than you're earning back`,
        impact: "Every £1 spent on Meta Ads is returning less than £1. Continuing without optimising wastes budget.",
        fix: "Pause underperforming ad sets, narrow your audience targeting, and A/B test new creatives.",
        action: { href: "/growthmind/ads-performance", label: "Review Meta Ads" },
      });
    }

    // Low ROAS — Google
    if (googleRoas !== null && googleRoas !== undefined && googleRoas < 1 && (ads.google?.spend ?? 0) > 10) {
      recs.push({
        id: "google-low-roas",
        category: "Paid Ads",
        priority: "high",
        problem: `Google Ads ROAS is ${googleRoas.toFixed(2)}x — below break-even`,
        impact: "You're losing money on Google Ads. Without optimisation this compounds quickly.",
        fix: "Review keyword match types, add negative keywords, and tighten ad scheduling.",
        action: { href: "/growthmind/ads-performance", label: "Review Google Ads" },
      });
    }

    // No conversions tracked
    const totalConversions = (ads.meta?.conversions ?? 0) + (ads.google?.conversions ?? 0);
    if (totalConversions === 0 && totalSpend > 50) {
      recs.push({
        id: "ads-no-conversions",
        category: "Paid Ads",
        priority: "medium",
        problem: "No conversions tracked despite active ad spend",
        impact: "Without conversion tracking you cannot measure ROI or optimise campaigns for profitability.",
        fix: "Set up conversion tracking in Meta Ads Manager and Google Ads — at minimum track form submissions and calls.",
        action: { href: "/growthmind/ads-performance", label: "View Ads" },
      });
    }
  } else if (!(ads?.hasSyncedData) && (leads?.total ?? 0) > 20) {
    // Large lead volume but no ads connected
    recs.push({
      id: "ads-not-connected",
      category: "Paid Ads",
      priority: "low",
      problem: "No ad platforms connected — unable to measure paid acquisition cost",
      impact: "Without ads data, GrowthMind cannot calculate your cost-per-lead or advise on budget allocation.",
      fix: "Connect your Meta Ads or Google Ads account in provider settings to unlock paid analytics.",
      action: { href: "/settings/providers", label: "Connect Ads" },
    });
  }

  const order: Record<GrowthPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]);
}
