/**
 * WEBEE's own sales positioning, taken from the WEBESPOKE AI / WEBEE INDUSTRY SERIES decks.
 *
 * Without this the model invented WEBEE's story from the product name alone and produced plausible
 * but off-message copy. Everything here is verbatim positioning from the decks, so generated
 * material matches what the prospect has actually been sent.
 */

/** Positioning every deck repeats, in every industry. */
export const WEBEE_CORE_POSITIONING = `WEBEE — no-code AI calling. BUILD • DEPLOY • CRM • FOLLOW-UP.
Built for overflow and out-of-hours. The pattern is RESPOND / QUALIFY / ACT.

The complete WEBEE layer: BUILD, DEPLOY, QUALIFY, BOOK, CRM, FOLLOW-UP.

Key differentiator, stated plainly: standalone builders such as Retell provide specialist
voice-agent infrastructure. WEBEE adds the no-code operational journey AROUND the conversation —
qualification, booking, CRM write-back and follow-up. Sell the journey, not the voice.

The honest frame the decks lead with, and which must never be broken:
"The strongest operating model is both — not either/or."
  • HUMAN EXPERTISE — Judgement. Trust. Decisions. People retain exceptions, approval and
    accountability.
  • WEBEE COVERAGE — Speed. Consistency. Scale. Reduce missed calls, support overflow and
    out-of-hours demand, ask approved questions, log outcomes, continue routine follow-up.
Never claim WEBEE replaces human expertise. The decks say so explicitly: "without pretending
automation replaces human expertise."

Call to action: see your first workflow running — book a tailored demo at webespokeai.com.`;

export type WebeeIndustry = {
  key: string;
  label: string;
  /** Words in the lead's data that indicate this industry. */
  match: string[];
  headline: string;
  leaks: string[];
  workflow: string[];
  useCases: string[];
  pilotMetrics: string[];
  /** Where the decks deliberately hold the line on what WEBEE does not do. */
  guardrail?: string;
};

export const WEBEE_INDUSTRIES: WebeeIndustry[] = [
  {
    key: "real_estate",
    label: "Real Estate & Property",
    match: [
      "real estate",
      "property",
      "estate agent",
      "realty",
      "lettings",
      "landlord",
      "broker",
      "villa",
      "apartment",
      "developer",
    ],
    headline: "The enquiry should not go cold because the team is busy.",
    leaks: [
      "Missed demand — calls and web leads arrive while negotiators are in viewings or outside office hours",
      "Slow follow-up — prospects speak with the first agency that responds clearly",
      "Scattered context — notes, call outcomes and follow-ups live in separate systems",
    ],
    workflow: [
      "Respond — answer inbound calls or call new leads back promptly",
      "Understand — capture location, property type, timing and intent",
      "Route — book a valuation or viewing, or pass the lead to the right person",
      "Follow up — keep agreed next steps moving across voice and messaging",
    ],
    useCases: [
      "Inbound property receptionist",
      "Seller or buyer qualification",
      "Viewing and valuation booking",
      "Dormant-lead reactivation",
    ],
    pilotMetrics: [
      "Time to first response",
      "Contact and qualification rate",
      "Valuations or viewings booked",
      "Follow-ups completed",
    ],
  },
  {
    key: "home_services",
    label: "Home Services & Trades",
    match: [
      "plumb",
      "electric",
      "heating",
      "boiler",
      "hvac",
      "roofing",
      "builder",
      "trades",
      "engineer",
      "maintenance",
      "installation",
      "locksmith",
      "cleaning",
    ],
    headline: "A missed call can mean the next local provider wins the work.",
    leaks: [
      "Teams are mobile — engineers and tradespeople cannot stop work to answer every call",
      "Urgency varies — emergency jobs, quotes and routine visits need different routing",
      "Quote follow-up — promising enquiries are lost after the first conversation",
    ],
    workflow: [
      "Answer — receive calls and explain the next step in plain language",
      "Scope — capture job type, postcode, urgency and preferred time",
      "Schedule — book an estimate or request a priority callback",
      "Follow — confirm details and keep quote follow-up visible",
    ],
    useCases: [
      "24/7 enquiry capture",
      "Estimate booking",
      "Emergency triage",
      "Unaccepted-quote follow-up",
    ],
    pilotMetrics: ["Calls answered", "Jobs qualified", "Visits booked", "Quote follow-up rate"],
  },
  {
    key: "hospitality",
    label: "Hospitality & Leisure",
    match: [
      "hotel",
      "restaurant",
      "cafe",
      "bar",
      "venue",
      "leisure",
      "spa",
      "resort",
      "catering",
      "events",
      "golf",
      "gym",
    ],
    headline:
      "Front-of-house teams should not have to choose between the guest in front of them and the phone.",
    leaks: [
      "Peak-time calls — enquiries arrive when reception and service teams are busiest",
      "Repeated questions — opening times, facilities, menus, access and availability create high call volume",
      "Group opportunity — events and group bookings need complete details and reliable follow-up",
    ],
    workflow: [
      "Welcome — answer with the venue's tone and approved guest information",
      "Understand — capture dates, party size, preferences and occasion",
      "Arrange — book where connected or route the request to the right team",
      "Confirm — send agreed confirmations and keep follow-up organised",
    ],
    useCases: [
      "Reservations receptionist",
      "Event enquiry capture",
      "Group booking qualification",
      "Post-enquiry follow-up",
    ],
    pilotMetrics: [
      "Calls answered",
      "Bookings completed",
      "Event leads captured",
      "Front-desk admin time",
    ],
  },
  {
    key: "insurance",
    label: "Insurance",
    match: ["insur", "underwrit", "broker", "policy", "claims", "renewal"],
    headline: "Customers want quick, clear next steps — not a maze of callbacks.",
    leaks: [
      "Busy lines — new-business, renewal and service enquiries compete for the same team",
      "Repetitive discovery — agents repeat initial questions before they can advise or quote",
      "Renewal leakage — inconsistent reminders and callbacks make retention harder",
    ],
    workflow: [
      "Identify — recognise new business, renewal, service or claims-routing needs",
      "Gather — capture only approved information and customer consent",
      "Connect — book or transfer to the appropriate authorised team",
      "Continue — record outcomes and send approved reminders",
    ],
    useCases: [
      "New-business intake",
      "Renewal reminders",
      "Broker appointment booking",
      "Claims call routing",
    ],
    pilotMetrics: [
      "Response time",
      "Appointments completed",
      "Renewal contact rate",
      "Follow-up completion",
    ],
    guardrail:
      "Automation is for structured intake and coordination only. Advice, underwriting and material decisions stay with authorised people and systems. Never imply WEBEE advises or underwrites.",
  },
  {
    key: "legal",
    label: "Legal Services",
    match: [
      "law",
      "legal",
      "solicitor",
      "barrister",
      "attorney",
      "conveyanc",
      "litigation",
      "chambers",
    ],
    headline:
      "A prospective client should receive a clear response even when fee earners are unavailable.",
    leaks: [
      "Time-sensitive leads — new enquiries contact several firms and expect a prompt answer",
      "Repeated intake — teams spend time asking the same initial matter and eligibility questions",
      "Incomplete hand-offs — important context is lost between the first call and the consultation",
    ],
    workflow: [
      "Receive — answer or return new-client enquiries using an approved introduction",
      "Triage — capture matter type, location, timing and basic conflict-check details",
      "Arrange — book a consultation or route urgent matters to staff",
      "Record — create a structured summary and scheduled follow-up",
    ],
    useCases: [
      "New-matter intake",
      "Consultation booking",
      "Existing-client call routing",
      "Unconverted-enquiry follow-up",
    ],
    pilotMetrics: [
      "Time to first response",
      "Qualified consultations",
      "Complete intake records",
      "Staff time saved on triage",
    ],
    guardrail:
      "Intake only. Never present WEBEE as giving legal advice — the deck is explicit: make intake faster and more consistent without presenting automation as legal advice.",
  },
  {
    key: "recruitment",
    label: "Recruitment & Staffing",
    match: ["recruit", "staffing", "talent", "headhunt", "employment agency", "candidate"],
    headline:
      "Recruiters create more value in conversations than in repetitive scheduling and first-stage chasing.",
    leaks: [
      "Speed matters — strong candidates and live vacancies move quickly between agencies",
      "Scheduling load — recruiters lose time coordinating interviews and availability",
      "Uneven follow-up — candidates and client leads disengage when next steps are unclear",
    ],
    workflow: [
      "Engage — contact applicants or respond to candidate and client calls",
      "Screen — ask role-specific, approved first-stage questions",
      "Schedule — book recruiter calls or interviews across calendars",
      "Update — record outcomes and send agreed reminders",
    ],
    useCases: [
      "Candidate pre-screening",
      "Interview scheduling",
      "Client lead qualification",
      "Database re-engagement",
    ],
    pilotMetrics: [
      "Response time",
      "Screening completion",
      "Interviews booked",
      "Recruiter admin time",
    ],
  },
];

/**
 * Best-matching industry playbook for a lead, or null.
 *
 * Matched on the lead's own text (company name, business type, research) rather than asked for, so
 * the rep does not have to classify the lead before generating.
 */
export function matchWebeeIndustry(haystack: string): WebeeIndustry | null {
  const text = haystack.toLowerCase();
  let best: { industry: WebeeIndustry; hits: number } | null = null;
  for (const industry of WEBEE_INDUSTRIES) {
    const hits = industry.match.filter((m) => text.includes(m)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { industry, hits };
  }
  return best?.industry ?? null;
}

/** The industry section of the prompt, or a general note when nothing matched. */
export function webeeIndustryBrief(industry: WebeeIndustry | null): string {
  if (!industry) {
    return `No industry deck matched this lead. Use the core positioning above and stay general about
their sector rather than guessing at it. Say what you would need to confirm.`;
  }
  return [
    `Matched industry deck: ${industry.label}`,
    `Deck headline: "${industry.headline}"`,
    "",
    "Where opportunity leaks in this sector:",
    ...industry.leaks.map((l) => `  - ${l}`),
    "",
    "The connected workflow WEBEE sells here:",
    ...industry.workflow.map((w) => `  - ${w}`),
    "",
    `High-value use cases: ${industry.useCases.join(", ")}`,
    `Pilot metrics this sector measures: ${industry.pilotMetrics.join(", ")}`,
    ...(industry.guardrail ? ["", `GUARDRAIL: ${industry.guardrail}`] : []),
  ].join("\n");
}
