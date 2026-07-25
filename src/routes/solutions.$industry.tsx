import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MarketingPageShell, MkH2, MkP, MkList, MkCardGrid, MK } from "@/components/landing/MarketingPageShell";

interface IndustryContent {
  name: string;
  title: string;
  intro: string;
  metaDescription: string;
  challenges: string[];
  useCases: { title: string; body: string }[];
  outcomes: string[];
}

const INDUSTRIES: Record<string, IndustryContent> = {
  healthcare: {
    name: "Healthcare",
    title: "AI receptionists for healthcare practices",
    metaDescription: "WEBEE AI voice agents for clinics, dental and healthcare practices — answer every call, book appointments and reduce no-shows.",
    intro: "Clinics, dental practices and healthcare providers use WEBEE to answer every patient call, book appointments and take the pressure off front-desk teams.",
    challenges: [
      "Reception teams stretched between in-person patients and a ringing phone",
      "Missed calls that become missed appointments and lost patients",
      "No-shows caused by missing reminders and slow rebooking",
      "Out-of-hours enquiries going to voicemail no one checks",
    ],
    useCases: [
      { title: "24/7 appointment booking", body: "Patients call any time; the AI receptionist checks availability, books the slot and confirms it back — no hold music." },
      { title: "Reminders & rebooking", body: "Automated reminder and follow-up campaigns reduce no-shows and refill cancelled slots." },
      { title: "Triage & routing", body: "Route urgent enquiries to the right person immediately while handling routine questions automatically." },
      { title: "New patient intake", body: "Capture patient details, insurance information and reason for visit before the first appointment." },
    ],
    outcomes: [
      "Every call answered — during clinics, lunch breaks and after hours",
      "Fewer no-shows through consistent reminders",
      "Front-desk staff freed for the patients in front of them",
    ],
  },
  property: {
    name: "Property",
    title: "AI agents for estate agents and property managers",
    metaDescription: "WEBEE AI voice agents for estate agents, letting agents and property managers — qualify applicants, book viewings and handle tenant calls.",
    intro: "Estate agents, letting agents and property managers use WEBEE to qualify applicants, book viewings and handle tenant calls without adding headcount.",
    challenges: [
      "Viewing requests arriving at all hours across portals and phone",
      "Negotiators spending hours qualifying applicants who never proceed",
      "Tenant maintenance calls interrupting revenue-generating work",
      "Slow response times losing instructions to faster competitors",
    ],
    useCases: [
      { title: "Viewing bookings", body: "Applicants call or message and the AI books viewings directly into your diary, with confirmations and reminders." },
      { title: "Applicant qualification", body: "Budget, timeline, financing position and requirements captured on the first call — only qualified applicants reach your negotiators." },
      { title: "Tenant line", body: "A 24/7 line for tenants that logs maintenance issues, answers common questions and escalates emergencies." },
      { title: "Valuation follow-up", body: "Automated follow-up campaigns keep your pipeline of potential instructions warm." },
    ],
    outcomes: [
      "Faster speed-to-lead than any competitor relying on callbacks",
      "Negotiators focused on qualified applicants only",
      "A professional tenant experience around the clock",
    ],
  },
  automotive: {
    name: "Automotive",
    title: "AI agents for dealerships and garages",
    metaDescription: "WEBEE AI voice agents for car dealerships, garages and service centres — capture enquiries, book test drives and schedule services.",
    intro: "Dealerships, garages and service centres use WEBEE to capture every enquiry, book test drives and keep service bays full.",
    challenges: [
      "Sales enquiries missed while the team is on the forecourt",
      "Service booking calls queuing at peak times",
      "MOT and service reminders handled inconsistently",
      "After-hours enquiries lost to competitors",
    ],
    useCases: [
      { title: "Test drive booking", body: "Enquiries from any channel become booked test drives with the right vehicle and salesperson." },
      { title: "Service scheduling", body: "The AI books services and MOTs against your workshop diary, and handles reschedules automatically." },
      { title: "Reminder campaigns", body: "MOT, service and follow-up reminders that actually go out — by call or WhatsApp." },
      { title: "Enquiry qualification", body: "Part-exchange, budget and financing details captured before your sales team pick up the conversation." },
    ],
    outcomes: [
      "No sales enquiry left unanswered",
      "Fuller workshop diaries with fewer gaps",
      "Consistent follow-up without chasing the team",
    ],
  },
  trades: {
    name: "Trades",
    title: "AI receptionists for trades and home services",
    metaDescription: "WEBEE AI voice agents for plumbers, electricians, builders and home-services businesses — answer calls on the job and book work automatically.",
    intro: "Plumbers, electricians, builders and home-services businesses use WEBEE to answer the phone while they're on the tools — and turn calls into booked jobs.",
    challenges: [
      "Calls missed while on a job going straight to a competitor",
      "Evenings spent returning voicemails and pricing enquiries",
      "Emergency call-outs mixed in with routine enquiries",
      "Quotes and follow-ups slipping through the cracks",
    ],
    useCases: [
      { title: "Never miss a call", body: "The AI answers instantly, takes the job details and books it into your diary while you keep working." },
      { title: "Emergency triage", body: "Urgent call-outs identified and escalated to your phone immediately; routine work booked for later." },
      { title: "Quote follow-up", body: "Automatic follow-up on outstanding quotes so work doesn't go cold." },
      { title: "Job intake", body: "Address, access details, photos via WhatsApp and problem description captured before you arrive." },
    ],
    outcomes: [
      "Every call answered — even mid-job, evenings and weekends",
      "More booked work from the same volume of enquiries",
      "Evenings back, admin handled",
    ],
  },
};

export const Route = createFileRoute("/solutions/$industry")({
  loader: ({ params }) => {
    if (!INDUSTRIES[params.industry]) throw notFound();
    return { industry: params.industry };
  },
  head: ({ params }) => {
    const c = INDUSTRIES[params.industry as string];
    return {
      meta: c ? [
        { title: `${c.name} — WEBEE Builder by Webespoke AI` },
        { name: "description", content: c.metaDescription },
      ] : [],
    };
  },
  component: IndustryPage,
});

function IndustryPage() {
  const { industry } = Route.useParams();
  const c = INDUSTRIES[industry];
  if (!c) {
    return (
      <MarketingPageShell kicker="Solutions" title="Solution not found" showCta={false}>
        <MkP>
          We couldn't find that industry page. See our{" "}
          <Link to="/" style={{ color: MK.gold, textDecoration: "none", fontWeight: 600 }}>homepage</Link>{" "}
          for the full platform overview.
        </MkP>
      </MarketingPageShell>
    );
  }
  return (
    <MarketingPageShell kicker={`Solutions · ${c.name}`} title={c.title} intro={c.intro}>
      <MkH2>The problem</MkH2>
      <MkList items={c.challenges} />
      <MkH2>How WEBEE helps</MkH2>
      <MkCardGrid cards={c.useCases} />
      <MkH2>What you get</MkH2>
      <MkList items={c.outcomes} />
    </MarketingPageShell>
  );
}
