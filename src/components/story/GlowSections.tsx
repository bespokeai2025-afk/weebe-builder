/**
 * Sections written for the /hive-glow page, in its dark amber-lit language.
 *
 * Both pay off the hero's promise — "AI calls, qualifies and gives you your 10
 * hottest leads":
 *   HowItWorks — the three steps, numbered because they genuinely are a sequence.
 *   HotLeads   — a product-style lead board. Every row is EXAMPLE data and
 *                labelled as such on the card; nothing here should be read as a
 *                real customer.
 *   IndustryCards — who it's for, in the same card language as HowItWorks
 *                (icon tile, title, body), each ending in a way to act.
 *
 * ISOLATION: react, lucide-react and ./data only.
 */

import {
  PhoneIncoming,
  Filter,
  Flame,
  CalendarCheck,
  PhoneCall,
  Sparkles,
  Stethoscope,
  House,
  CarFront,
  Wrench,
  ArrowRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { USE_CASES } from "./data";

const STEPS: { n: string; icon: LucideIcon; title: string; body: string }[] = [
  {
    n: "01",
    icon: PhoneIncoming,
    title: "It answers",
    body: "Every call picked up on the first ring, in a natural voice. Nights, weekends, and the ones that used to go to voicemail.",
  },
  {
    n: "02",
    icon: Filter,
    title: "It qualifies",
    body: "Your questions, asked your way. Budget, timing, need. The agent sorts the serious callers from the tyre-kickers while they're still on the line.",
  },
  {
    n: "03",
    icon: Flame,
    title: "It ranks",
    body: "Every morning you get your ten hottest leads, scored and summarised, with the ones ready to book already in your diary.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="st-section st-gx-how">
      <div className="st-wrap">
        <div className="st-gx-head st-reveal">
          <div className="st-kicker">How it works</div>
          <h2>From ringing phone to ranked lead.</h2>
        </div>
        <ol className="st-gx-steps st-reveal">
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <li className="st-gx-step" key={s.n}>
                <div className="st-gx-step-top">
                  <span className="st-gx-hex" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="st-gx-num">{s.n}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

interface Lead {
  name: string;
  need: string;
  heat: number; // 0–100
  when: string;
  status: "booked" | "callback" | "new";
}

/* EXAMPLE DATA — illustrative only, labelled as such in the UI. */
const LEADS: Lead[] = [
  { name: "Sarah M.", need: "Dental implants consultation", heat: 96, when: "08:12", status: "booked" },
  { name: "James T.", need: "Boiler replacement quote", heat: 91, when: "07:40", status: "callback" },
  { name: "Priya K.", need: "3-bed viewing, Saturday", heat: 88, when: "Yesterday", status: "booked" },
  { name: "Daniel R.", need: "Test drive — hybrid SUV", heat: 82, when: "Yesterday", status: "new" },
  { name: "Emma L.", need: "Teeth whitening, new patient", heat: 77, when: "Yesterday", status: "callback" },
  { name: "Tom W.", need: "Full rewire, two-storey house", heat: 71, when: "Mon", status: "new" },
];

const STATUS: Record<Lead["status"], { label: string; icon: LucideIcon }> = {
  booked: { label: "Booked", icon: CalendarCheck },
  callback: { label: "Call back", icon: PhoneCall },
  new: { label: "New", icon: Sparkles },
};

export function HotLeads() {
  return (
    <section id="product" className="st-section st-gx-leads">
      <div className="st-wrap st-gx-leads-grid">
        <div className="st-reveal">
          <div className="st-kicker">Your morning</div>
          <h2>Your ten hottest leads, before your first coffee.</h2>
          <p style={{ marginTop: 18 }}>
            Every call is scored on intent, budget and urgency, then ranked. Open WEBEE and the
            people most ready to buy are at the top, with a one-line summary of what they
            want and whether they're already booked in.
          </p>
          <ul className="st-gx-ticks">
            <li>Scored on what the caller actually said, not on form fields</li>
            <li>Ready-to-book leads land straight in your calendar</li>
            <li>Full transcript and recording one click away</li>
          </ul>
        </div>

        <div className="st-gx-board st-reveal" role="table" aria-label="Example lead board">
          <div className="st-gx-board-head">
            <span>
              <Flame size={14} aria-hidden="true" /> Hottest leads
            </span>
            <span className="st-gx-example">Example data</span>
          </div>
          <div role="rowgroup">
            {LEADS.map((l, i) => {
              const S = STATUS[l.status];
              return (
                <div className="st-gx-row" role="row" key={l.name}>
                  <span className="st-gx-rank" role="cell">
                    {i + 1}
                  </span>
                  <span className="st-gx-who" role="cell">
                    <strong>{l.name}</strong>
                    <span>{l.need}</span>
                  </span>
                  <span className="st-gx-heat" role="cell" aria-label={`Heat score ${l.heat} out of 100`}>
                    <span className="st-gx-heat-bar">
                      <span style={{ width: `${l.heat}%` }} />
                    </span>
                    <span className="st-gx-heat-num">{l.heat}</span>
                  </span>
                  <span className="st-gx-status" data-status={l.status} role="cell">
                    <S.icon size={12} aria-hidden="true" /> {S.label}
                  </span>
                  <span className="st-gx-when" role="cell">
                    {l.when}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const INDUSTRY_ICON: Record<string, LucideIcon> = {
  "Dental & healthcare": Stethoscope,
  Property: House,
  Automotive: CarFront,
  "Trades & home services": Wrench,
};

/**
 * Industry cards. The grid uses subgrid rows so icon, title, body and link
 * line up across a row even when one title wraps to two lines.
 */
export function IndustryCards() {
  return (
    <section className="st-section">
      <div className="st-wrap">
        <div className="st-gx-head st-reveal">
          <div className="st-kicker">Where it earns its keep</div>
          <h2>Built for businesses that live on the phone.</h2>
        </div>
        <ul className="st-gx-inds st-reveal">
          {USE_CASES.map((u) => {
            const Icon = INDUSTRY_ICON[u.title] ?? PhoneIncoming;
            return (
              <li className="st-gx-step st-gx-ind" key={u.title}>
                <span className="st-gx-hex" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <h3>{u.title}</h3>
                <p>{u.body}</p>
                <a className="st-gx-ind-link" href="#callback" aria-label={`Get a callback about ${u.title}`}>
                  Get a callback <ArrowRight size={14} aria-hidden="true" />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
