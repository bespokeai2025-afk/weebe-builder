// ── GrowthMind Lead Opportunity Detector ──────────────────────────────────────
// Pure client-side function — derives all opportunities from platform data

export type OpportunityType =
  | "stale"           // active but no update in 14+ days
  | "never_called"    // has phone but never been called
  | "repeat_contact"  // called 3+ times with no conversion
  | "stalled"         // in-progress/qualified with no update in 7+ days
  | "no_show"         // booked appointment missed
  | "hot_lead";       // recent activity but no booking yet

export type OpportunityUrgency = "critical" | "high" | "medium" | "low";

export type LeadOpportunity = {
  id:         string;
  name:       string;
  type:       OpportunityType;
  label:      string;
  urgency:    OpportunityUrgency;
  reason:     string;
  action:     string;
  phone?:     string;
  email?:     string;
  daysSince?: number;
  callCount?: number;
};

export function detectLeadOpportunities(data: any): LeadOpportunity[] {
  if (!data) return [];

  const opps: LeadOpportunity[] = [];

  // 1. STALE LEADS — active but not updated in 14+ days
  for (const l of (data.leads?.staleDetail ?? [])) {
    opps.push({
      id:        `stale-${l.id}`,
      name:      l.name,
      type:      "stale",
      label:     "Stale Lead",
      urgency:   l.daysSinceUpdate > 30 ? "critical" : l.daysSinceUpdate > 21 ? "high" : "medium",
      reason:    `No activity for ${l.daysSinceUpdate} days — pipeline position at risk`,
      action:    "Re-engage with a follow-up call or WhatsApp message",
      daysSince: l.daysSinceUpdate,
      phone:     l.phone,
      email:     l.email,
    });
  }

  // 2. NEVER-CALLED LEADS — have a phone number but zero calls on record
  for (const l of (data.leads?.neverCalledDetail ?? [])) {
    opps.push({
      id:        `never-${l.id}`,
      name:      l.name,
      type:      "never_called",
      label:     "Never Contacted",
      urgency:   l.daysSinceCreated > 14 ? "critical" : l.daysSinceCreated > 7 ? "high" : "medium",
      reason:    `Added ${l.daysSinceCreated} day${l.daysSinceCreated !== 1 ? "s" : ""} ago — never been called`,
      action:    "Call immediately — untouched leads go cold fast",
      daysSince: l.daysSinceCreated,
      phone:     l.phone,
      email:     l.email,
    });
  }

  // 3. REPEAT CONTACTS — called 3+ times with no conversion
  for (const l of (data.leads?.repeatContacts ?? [])) {
    opps.push({
      id:        `repeat-${l.id}`,
      name:      l.name,
      type:      "repeat_contact",
      label:     "Repeat Contact",
      urgency:   l.callCount >= 6 ? "high" : "medium",
      reason:    `Called ${l.callCount} times with no conversion — needs a different approach`,
      action:    "Try a different script, offer, or hand off to a human agent",
      callCount: l.callCount,
      phone:     l.phone,
      email:     l.email,
    });
  }

  // 4. STALLED PIPELINE — in-progress / qualified with no update in 7+ days
  for (const l of (data.leads?.stalledPipeline ?? [])) {
    opps.push({
      id:        `stalled-${l.id}`,
      name:      l.name,
      type:      "stalled",
      label:     "Stalled Pipeline",
      urgency:   l.daysSinceUpdate > 14 ? "high" : "medium",
      reason:    `${l.status} for ${l.daysSinceUpdate} days without an update`,
      action:    "Move this lead forward or mark as not interested to keep the pipeline clean",
      daysSince: l.daysSinceUpdate,
      phone:     l.phone,
      email:     l.email,
    });
  }

  // 5. NO-SHOW BOOKINGS — appointments that were missed or cancelled
  for (const b of (data.bookings?.noShowDetail ?? [])) {
    opps.push({
      id:     `noshow-${b.id}`,
      name:   b.attendeeName ?? b.title ?? "Unknown",
      type:   "no_show",
      label:  "Missed Appointment",
      urgency: "high",
      reason: `Appointment was cancelled or not attended — ${b.title ?? "appointment"}`,
      action: "Reach out immediately to reschedule — they showed intent by booking",
    });
  }

  // Sort by urgency
  const urgencyOrder: Record<OpportunityUrgency, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return opps.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
}

export function getOpportunitySummary(data: any) {
  const opps = detectLeadOpportunities(data);
  return {
    total:    opps.length,
    critical: opps.filter(o => o.urgency === "critical").length,
    high:     opps.filter(o => o.urgency === "high").length,
    medium:   opps.filter(o => o.urgency === "medium").length,
    low:      opps.filter(o => o.urgency === "low").length,
    byType: {
      stale:          opps.filter(o => o.type === "stale").length,
      never_called:   opps.filter(o => o.type === "never_called").length,
      repeat_contact: opps.filter(o => o.type === "repeat_contact").length,
      stalled:        opps.filter(o => o.type === "stalled").length,
      no_show:        opps.filter(o => o.type === "no_show").length,
    },
  };
}
