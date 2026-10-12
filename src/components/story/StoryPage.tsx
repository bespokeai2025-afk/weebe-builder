/**
 * WEBEE story landing page.
 *
 * ISOLATION: react, @tanstack/react-router (Link only), lucide-react and
 * ./data + ./MiniBuilder. Nothing from the production app. See data.ts for
 * the full contract and why it matters.
 *
 * The page has exactly ONE gold primary CTA per screenful. Gold carries
 * hierarchy; lines, borders and inactive states use --story-accent-cool.
 */

import { useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Menu,
  X,
  PhoneOff,
  Clock,
  TrendingDown,
  ShieldCheck,
  Check,
  type LucideIcon,
} from "lucide-react";
import { MiniBuilder } from "./MiniBuilder";
import { HiveHero } from "./HiveHero";
import { CallTicker } from "./CallTicker";
import { LeadForm } from "./LeadForm";
import { SocialProof } from "./SocialProof";
import { AccentLab } from "./AccentLab";
import { OUTCOMES, TRUST_POINTS, USE_CASES } from "./data";
import logoWebee from "@/assets/webee-logo-yellow.png";

// "Get Started" means create an account — new visitors land on sign-up, not
// log-in (audit 2026-10-10 #12).
const SIGNUP = { to: "/signup" } as const;

export function StoryPage() {
  return (
    <main className="webee-story">
      <a href="#main" className="st-skip">Skip to content</a>
      <Nav />
      <div id="main" />
      <Hero />
      <BuilderSection />
      <OutcomeSection />
      {/* Capture sits straight after the demo, while interest is highest and
          before the visitor has to scroll through trust material. */}
      <CallbackSection />
      <SocialProof />
      <UseCaseSection />
      <TrustSection />
      <FinalCta />
      <Footer />
      <AccentLab />
    </main>
  );
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */
function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(5,14,30,0.86)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--story-border)",
      }}
    >
      <div
        className="st-wrap"
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          to="/"
          style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}
        >
          <img
            src={logoWebee}
            alt=""
            width={30}
            height={30}
            style={{ borderRadius: 8, objectFit: "cover" }}
          />
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--story-text)" }}>
            WEBEE
          </span>
        </Link>

        <nav
          aria-label="Primary"
          style={{ display: "flex", alignItems: "center", gap: 26 }}
          className="st-nav-links"
        >
          <a href="#build" style={navLink}>
            How it works
          </a>
          <a href="#results" style={navLink}>
            Results
          </a>
          <Link to="/pricing" style={navLink}>
            Pricing
          </Link>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link {...SIGNUP} style={{ ...navLink, display: "none" }} className="st-signin">
            Sign in
          </Link>
          <Link {...SIGNUP} className="st-btn st-btn--primary" style={{ padding: "10px 20px", fontSize: 14 }}>
            Get started
          </Link>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="st-menu-btn"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--story-muted)",
              cursor: "pointer",
              padding: 6,
              display: "none",
            }}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div
          className="st-wrap"
          style={{ paddingBottom: 18, borderTop: "1px solid var(--story-border)", paddingTop: 12 }}
        >
          <a href="#build" style={mobileLink} onClick={() => setOpen(false)}>
            How it works
          </a>
          <a href="#results" style={mobileLink} onClick={() => setOpen(false)}>
            Results
          </a>
          <Link to="/pricing" style={mobileLink}>
            Pricing
          </Link>
          <Link {...SIGNUP} style={mobileLink}>
            Sign in
          </Link>
        </div>
      )}
    </header>
  );
}

const navLink: CSSProperties = {
  fontSize: 14,
  color: "var(--story-muted)",
  textDecoration: "none",
  fontWeight: 500,
};
const mobileLink: CSSProperties = {
  display: "block",
  padding: "12px 0",
  color: "var(--story-muted)",
  fontSize: 15,
  textDecoration: "none",
  borderBottom: "1px solid var(--story-border)",
};

/* ── Hero ────────────────────────────────────────────────────────────────── */
function Hero() {
  return (
    <>
      {/* Split frame, the same composition as /hero-lab: copy owns the left,
          the 3D owns the right. Centred type on top of a masked canvas made
          the scene background noise; side by side, the two share the frame. */}
      <section className="st-hero st-hero--split">
        <HiveHero />
        <div className="st-wrap st-hero-inner">
          <div className="st-hero-copy">
            <div className="st-kicker">Autonomous voice agents for inbound calls</div>
            <h1 className="st-hero-h1">
              Every call
              <br />
              answered.
            </h1>
            <p className="st-lede" style={{ marginTop: 22 }}>
              WEBEE picks up in a natural voice, qualifies the caller, books them into your
              diary and writes it to your CRM, with nobody at the desk.
            </p>
            <div className="st-hero-ctas">
              <Link {...SIGNUP} className="st-btn st-btn--primary">
                Start free <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href="#build" className="st-btn st-btn--ghost">
                Build one now
              </a>
            </div>
            <p style={{ fontSize: 13, color: "var(--story-dim)", marginTop: 18 }}>
              No card required · Live in under an hour
            </p>
            {/* Proof before belief: the first screen already shows the agent
                working, rather than only asking visitors to believe a claim. */}
            <CallTicker />
          </div>
        </div>
      </section>

      {/* Hard numbers, stated flatly. Borrowed structure from the technical
          reference sites: a hairline strip of specs, no decoration. */}
      <div className="st-wrap">
        <div className="st-specs">
          <Spec value="<1 ring" label="Pickup time" />
          <Spec value="24/7/365" label="Availability" />
          <Spec value="38s" label="Call to booked" />
          <Spec value="40+" label="Languages" />
        </div>
      </div>

      {/* The cost of the problem, stated before the solution. */}
      <section className="st-section" style={{ paddingTop: "clamp(48px, 7vw, 76px)" }}>
        <div className="st-wrap">
          <div className="st-metrics st-reveal">
            <ProblemCard
              icon={PhoneOff}
              stat="1 in 4"
              text="business calls go unanswered — most of those callers never try again."
            />
            <ProblemCard
              icon={Clock}
              stat="After hours"
              text="is when a third of enquiries arrive, and when nobody is at the desk."
            />
            <ProblemCard
              icon={TrendingDown}
              stat="78%"
              text="of customers buy from whoever responds to them first."
            />
          </div>
        </div>
      </section>
    </>
  );
}

function Spec({ value, label }: { value: string; label: string }) {
  return (
    <div className="st-spec">
      <div className="st-spec-value">{value}</div>
      <div className="st-spec-label">{label}</div>
    </div>
  );
}

function ProblemCard({
  icon: Icon,
  stat,
  text,
}: {
  icon: LucideIcon;
  stat: string;
  text: string;
}) {
  return (
    <div className="st-card">
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "rgba(56,189,248,0.12)",
          color: "var(--story-accent-cool)",
          marginBottom: 14,
        }}
      >
        <Icon size={18} />
      </span>
      <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em" }}>{stat}</div>
      <p style={{ fontSize: 13.5, marginTop: 6 }}>{text}</p>
    </div>
  );
}

/* ── The interactive demo ────────────────────────────────────────────────── */
export function BuilderSection() {
  return (
    <section id="build" className="st-section" style={{ background: "var(--story-bg)" }}>
      <div className="st-wrap">
        <div style={{ textAlign: "center", maxWidth: 680, margin: "0 auto 40px" }}>
          <div className="st-kicker">Build it yourself — right here</div>
          <h2>Give your agent tools. Watch it work.</h2>
          <p className="st-lede" style={{ margin: "16px auto 0" }}>
            This is the real thing, simplified. Choose what your agent should do, then press
            test and listen to the call it would have handled for you.
          </p>
        </div>

        <div className="st-reveal">
          <MiniBuilder />
        </div>
      </div>
    </section>
  );
}

/* ── Outcomes ────────────────────────────────────────────────────────────── */
export function OutcomeSection() {
  return (
    <section id="results" className="st-section" style={{ background: "var(--story-bg-raised)" }}>
      <div className="st-wrap">
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <div className="st-kicker">What that demo call just did</div>
          <h2>A booked appointment, with no one at the desk.</h2>
        </div>
        <div className="st-metrics st-reveal">
          {OUTCOMES.map((o) => (
            <div className="st-metric" data-shown="true" key={o.key}>
              <div className="st-metric-value">{o.value}</div>
              <div className="st-metric-label">{o.label}</div>
              <div className="st-metric-caption">{o.caption}</div>
            </div>
          ))}
        </div>
        <p
          style={{
            textAlign: "center",
            marginTop: 28,
            fontSize: 14,
            color: "var(--story-dim)",
          }}
        >
          That was one example call. Smart Dash shows you every real one.
        </p>
      </div>
    </section>
  );
}

/* ── Callback capture ────────────────────────────────────────────────────── */
export function CallbackSection() {
  return (
    <section id="callback" className="st-section">
      <div
        className="st-wrap"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 44,
          alignItems: "center",
        }}
      >
        <div>
          <div className="st-kicker">Not ready to set one up?</div>
          <h2>Let it call you instead.</h2>
          <p style={{ marginTop: 16 }}>
            Leave a number and we will ring you back to walk through exactly what an agent
            would do for your business — which calls it would answer, what it would ask, and
            where the bookings would land.
          </p>
          <p style={{ marginTop: 14, fontSize: 14, color: "var(--story-dim)" }}>
            Most businesses are live within the hour once they decide.
          </p>
        </div>
        <LeadForm />
      </div>
    </section>
  );
}

/* ── Use cases ───────────────────────────────────────────────────────────── */
export function UseCaseSection() {
  return (
    <section className="st-section">
      <div className="st-wrap">
        <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 40px" }}>
          <div className="st-kicker">Where it earns its keep</div>
          <h2>Built for businesses that live on the phone.</h2>
        </div>
        <div
          className="st-metrics st-reveal"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        >
          {USE_CASES.map((u) => (
            <div className="st-card" key={u.title}>
              <h3>{u.title}</h3>
              <p style={{ fontSize: 14, marginTop: 8 }}>{u.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Trust ───────────────────────────────────────────────────────────────── */
export function TrustSection() {
  return (
    <section className="st-section" style={{ background: "var(--story-bg-raised)" }}>
      <div
        className="st-wrap"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 40,
          alignItems: "center",
        }}
      >
        <div>
          <div className="st-kicker">Yours, not a bot in a box</div>
          <h2>It sounds like your business, because it is.</h2>
          <p style={{ marginTop: 16 }}>
            Your number, your script, your calendar, your CRM. You hear every call and you
            change the workflow whenever you like — no agency, no developer.
          </p>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {TRUST_POINTS.map((t) => (
            <li key={t} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
              <span
                aria-hidden="true"
                style={{
                  flex: "none",
                  width: 21,
                  height: 21,
                  marginTop: 1,
                  borderRadius: "50%",
                  background: "rgba(52,211,153,0.14)",
                  color: "var(--story-ok)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Check size={12} />
              </span>
              <span style={{ fontSize: 14.5, color: "var(--story-muted)", lineHeight: 1.55 }}>
                {t}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── Final CTA ───────────────────────────────────────────────────────────── */
export function FinalCta({
  ctaLabel = "Start free",
  icon = true,
  fineprint = "No card required · Cancel any time",
}: {
  ctaLabel?: string;
  icon?: boolean;
  /** null hides the line (e.g. until the claim is confirmed). */
  fineprint?: string | null;
}) {
  return (
    <section className="st-section">
      <div className="st-wrap" style={{ textAlign: "center", maxWidth: 680 }}>
        {icon && (
          <ShieldCheck
            size={26}
            aria-hidden="true"
            style={{ color: "var(--story-gold)", marginBottom: 16 }}
          />
        )}
        <h2>Your next missed call could have been a customer.</h2>
        <p className="st-lede" style={{ margin: "16px auto 0" }}>
          Set up your first agent in under an hour. Keep your number, keep your voice.
        </p>
        <div style={{ marginTop: 28 }}>
          <Link {...SIGNUP} className="st-btn st-btn--primary">
            {ctaLabel} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {fineprint && (
          <p style={{ fontSize: 13, color: "var(--story-dim)", marginTop: 16 }}>{fineprint}</p>
        )}
      </div>
    </section>
  );
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
export function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--story-border)", padding: "28px 0" }}>
      <div
        className="st-wrap"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12.5, color: "var(--story-dim)" }}>
          © {new Date().getFullYear()} Webespoke AI Ltd.
        </span>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Link to="/privacy" style={{ ...navLink, fontSize: 12.5 }}>
            Privacy
          </Link>
          <Link to="/terms" style={{ ...navLink, fontSize: 12.5 }}>
            Terms
          </Link>
          <Link to="/contact" style={{ ...navLink, fontSize: 12.5 }}>
            Contact
          </Link>
        </div>
      </div>
    </footer>
  );
}
