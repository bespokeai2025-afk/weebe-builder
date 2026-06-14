// ── Growth Score Engine ────────────────────────────────────────────────────────
// 0-100 score across 6 weighted marketing dimensions

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

  const { calls, leads, bookings, campaigns, agentPerf, systemHealth } = data;

  // 1. Lead Response Time (20 pts) — faster is better
  let responseScore = 0;
  if (leads.avgResponseHrs !== null) {
    if (leads.avgResponseHrs <= 1)       responseScore = 20;
    else if (leads.avgResponseHrs <= 4)  responseScore = 16;
    else if (leads.avgResponseHrs <= 12) responseScore = 12;
    else if (leads.avgResponseHrs <= 24) responseScore = 8;
    else                                  responseScore = 4;
  } else if (calls.total > 0) {
    responseScore = 6; // some activity but can't measure
  }
  const responseNote = leads.avgResponseHrs === null
    ? "No response time data — connect more leads and calls"
    : leads.avgResponseHrs <= 1
      ? `Excellent: avg ${leads.avgResponseHrs}h response`
      : leads.avgResponseHrs <= 4
        ? `Good: avg ${leads.avgResponseHrs}h response`
        : `Slow: avg ${leads.avgResponseHrs}h — aim for under 1h`;

  // 2. Follow-Up Coverage (20 pts)
  let followScore = Math.round((leads.followUpCoverage / 100) * 20);
  const followNote = leads.active === 0
    ? "No active leads to follow up"
    : `${leads.followUpCoverage}% of active leads have been contacted`;

  // 3. Conversion Rate (20 pts)
  let convScore = 0;
  if (leads.conversionRate >= 30)      convScore = 20;
  else if (leads.conversionRate >= 20) convScore = 16;
  else if (leads.conversionRate >= 10) convScore = 12;
  else if (leads.conversionRate >= 5)  convScore = 8;
  else if (leads.conversionRate > 0)   convScore = 4;
  else if (leads.total === 0)          convScore = 0;
  const convNote = leads.total === 0
    ? "No leads in pipeline yet"
    : `${leads.conversionRate}% of leads converted to sales`;

  // 4. Booking Rate (15 pts)
  let bookScore = 0;
  if (bookings.bookingRate >= 20)      bookScore = 15;
  else if (bookings.bookingRate >= 10) bookScore = 12;
  else if (bookings.bookingRate >= 5)  bookScore = 9;
  else if (bookings.bookingRate > 0)   bookScore = 5;
  else if (bookings.total > 0)         bookScore = 3;
  const bookNote = bookings.total === 0
    ? "No bookings recorded"
    : `${bookings.bookingRate}% booking rate (${bookings.total} total bookings)`;

  // 5. Campaign Activity (15 pts)
  let campScore = 0;
  if (campaigns.active >= 3)       campScore = 15;
  else if (campaigns.active >= 2)  campScore = 12;
  else if (campaigns.active >= 1)  campScore = 8;
  else if (campaigns.total > 0)    campScore = 4;
  const campNote = campaigns.active === 0
    ? campaigns.total === 0 ? "No campaigns created" : "All campaigns inactive"
    : `${campaigns.active} active campaign${campaigns.active !== 1 ? "s" : ""} running`;

  // 6. Agent Performance (10 pts)
  const topAgent = agentPerf?.[0];
  let agentScore = 0;
  if (calls.successRate >= 70)      agentScore = 10;
  else if (calls.successRate >= 50) agentScore = 8;
  else if (calls.successRate >= 30) agentScore = 5;
  else if (calls.total > 0)         agentScore = 3;
  const agentNote = calls.total === 0
    ? "No call activity recorded"
    : `${calls.successRate}% call success rate across ${calls.total} calls`;

  const dimensions: ScoreDimension[] = [
    dim("response",   "Lead Response Time",   responseScore, 20, responseNote),
    dim("followup",   "Follow-Up Coverage",   followScore,   20, followNote),
    dim("conversion", "Conversion Rate",       convScore,     20, convNote),
    dim("booking",    "Booking Rate",          bookScore,     15, bookNote),
    dim("campaigns",  "Campaign Activity",     campScore,     15, campNote),
    dim("agents",     "Agent Performance",     agentScore,    10, agentNote),
  ];

  const total = Math.min(dimensions.reduce((s, d) => s + d.score, 0), 100);
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F";
  const label = total >= 85 ? "Excellent" : total >= 70 ? "Good" : total >= 55 ? "Developing" : total >= 40 ? "Needs Work" : "Critical";

  return { total, grade, label, dimensions };
}
