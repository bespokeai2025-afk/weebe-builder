// ── Marketing Readiness Score Engine ───────────────────────────────────────────
// 0-100 score across 5 marketing-focused readiness dimensions

export type ScoreDimension = {
  key:    string;
  label:  string;
  score:  number;
  max:    number;
  pct:    number;
  note:   string;
  color:  "emerald" | "amber" | "red" | "slate";
};

export type GrowthScore = {
  total:      number;
  grade:      string;
  label:      string;
  dimensions: ScoreDimension[];
};

function dim(
  key: string, label: string, raw: number, max: number, note: string,
): ScoreDimension {
  const score = Math.min(Math.round(raw), max);
  const pct   = Math.round((score / max) * 100);
  const color = pct >= 70 ? "emerald" : pct >= 40 ? "amber" : "red";
  return { key, label, score, max, pct, note, color };
}

export function computeGrowthScore(data: any): GrowthScore {
  if (!data) return { total: 0, grade: "F", label: "No data", dimensions: [] };

  const { calls, leads, bookings, campaigns, whatsapp, email, marketing, systemHealth } = data;

  // 1. Campaign Readiness (25 pts) — is automated outreach running?
  let campScore = 0;
  if ((campaigns?.active ?? 0) >= 3)          campScore = 25;
  else if ((campaigns?.active ?? 0) >= 2)     campScore = 20;
  else if ((campaigns?.active ?? 0) >= 1)     campScore = 14;
  else if ((campaigns?.total ?? 0) > 0)       campScore = 6;
  if (systemHealth?.emailCampaigns)           campScore = Math.min(campScore + 4, 25);
  if (systemHealth?.waOutreach)               campScore = Math.min(campScore + 3, 25);
  const campNote = (campaigns?.active ?? 0) === 0
    ? (campaigns?.total ?? 0) === 0 ? "No outreach campaigns created" : "All campaigns paused — no automated outreach"
    : `${campaigns.active} active campaign${campaigns.active !== 1 ? "s" : ""} running`;

  // 2. Lead Generation (20 pts) — is the pipeline growing?
  const newLeads7  = leads?.newLast7  ?? 0;
  const newLeads30 = leads?.newLast30 ?? 0;
  let leadScore = 0;
  if (newLeads7 >= 10)       leadScore += 8;
  else if (newLeads7 >= 5)   leadScore += 6;
  else if (newLeads7 >= 2)   leadScore += 4;
  else if (newLeads7 >= 1)   leadScore += 2;
  if (newLeads30 >= 30)      leadScore += 8;
  else if (newLeads30 >= 15) leadScore += 6;
  else if (newLeads30 >= 5)  leadScore += 4;
  else if (newLeads30 >= 1)  leadScore += 2;
  if ((leads?.total ?? 0) > 100) leadScore = Math.min(leadScore + 4, 20);
  const leadNote = (leads?.total ?? 0) === 0
    ? "No leads in the pipeline yet"
    : `${newLeads7} new leads this week, ${newLeads30} this month (${leads?.total ?? 0} total)`;

  // 3. Funnel & Conversion (20 pts) — are leads converting?
  let funnelScore = 0;
  const convRate    = leads?.conversionRate ?? 0;
  const bookingRate = bookings?.bookingRate  ?? 0;
  const followUpCov = leads?.followUpCoverage ?? 0;
  if (convRate >= 20)      funnelScore += 8;
  else if (convRate >= 10) funnelScore += 6;
  else if (convRate >= 5)  funnelScore += 4;
  else if (convRate > 0)   funnelScore += 2;
  if (bookingRate >= 15)   funnelScore += 6;
  else if (bookingRate >= 8) funnelScore += 4;
  else if (bookingRate > 0)  funnelScore += 2;
  funnelScore += Math.round((followUpCov / 100) * 6);
  funnelScore = Math.min(funnelScore, 20);
  const funnelNote = (leads?.total ?? 0) === 0
    ? "No conversion data yet — add leads to track funnel"
    : `${convRate}% conversion rate, ${bookingRate}% booking rate, ${followUpCov}% follow-up coverage`;

  // 4. Content & SEO (20 pts) — is inbound marketing active?
  let contentScore = 0;
  const seoKw         = marketing?.seoKeywords      ?? 0;
  const recentContent = marketing?.recentContentCount ?? 0;
  const competitorsCnt= marketing?.competitorsCount  ?? 0;
  if (seoKw >= 10)          contentScore += 8;
  else if (seoKw >= 5)      contentScore += 6;
  else if (seoKw >= 1)      contentScore += 4;
  if (recentContent >= 5)   contentScore += 8;
  else if (recentContent >= 2) contentScore += 5;
  else if (recentContent >= 1) contentScore += 3;
  if (competitorsCnt >= 3)  contentScore += 4;
  else if (competitorsCnt >= 1) contentScore += 2;
  contentScore = Math.min(contentScore, 20);
  const contentNote = seoKw === 0 && recentContent === 0
    ? "No SEO keywords tracked and no recent content published"
    : `${seoKw} SEO keyword${seoKw !== 1 ? "s" : ""} tracked, ${recentContent} content piece${recentContent !== 1 ? "s" : ""} published (14d)`;

  // 5. Channel Engagement (15 pts) — are multiple channels active?
  let channelScore = 0;
  const waTotal   = whatsapp?.total   ?? 0;
  const waOut     = whatsapp?.outbound ?? 0;
  const emailAct  = email?.active ?? 0;
  if (systemHealth?.whatsapp && waOut >= 20)  channelScore += 6;
  else if (systemHealth?.whatsapp && waOut > 0) channelScore += 4;
  else if (systemHealth?.whatsapp)              channelScore += 2;
  if (emailAct >= 2)      channelScore += 6;
  else if (emailAct >= 1) channelScore += 4;
  if ((calls?.successRate ?? 0) >= 50)  channelScore += 3;
  else if ((calls?.total ?? 0) > 0)     channelScore += 1;
  channelScore = Math.min(channelScore, 15);
  const channelNote = waTotal === 0 && emailAct === 0
    ? "No multi-channel engagement — connect WhatsApp and email"
    : `${waOut} WA outbound msgs, ${emailAct} active email campaign${emailAct !== 1 ? "s" : ""}, ${calls?.successRate ?? 0}% call success`;

  const dimensions: ScoreDimension[] = [
    dim("campaigns",  "Campaign Readiness",   campScore,    25, campNote),
    dim("leads",      "Lead Generation",       leadScore,    20, leadNote),
    dim("funnel",     "Funnel & Conversion",   funnelScore,  20, funnelNote),
    dim("content",    "Content & SEO",         contentScore, 20, contentNote),
    dim("channels",   "Channel Engagement",    channelScore, 15, channelNote),
  ];

  const total = Math.min(dimensions.reduce((s, d) => s + d.score, 0), 100);
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F";
  const label = total >= 85 ? "Excellent" : total >= 70 ? "Good" : total >= 55 ? "Developing" : total >= 40 ? "Needs Work" : "Critical";

  return { total, grade, label, dimensions };
}
