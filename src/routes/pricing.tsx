import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight, Check, Minus, Zap, Building2, Menu, X,
  Phone, Users, BarChart3, Bot, MessageSquare, Video,
  Wrench, Crown, Rocket, Star,
} from "lucide-react";
import logoWebee from "@/assets/webee-logo-yellow.png";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "WEBEE Builder — Pricing & Modules" },
      { name: "description", content: "Start with the WEBEE Core CRM free with every plan. Add AI modules — Receptionist, Lead Generation, GrowthMind, WhatsApp, Video Studio and more — as your business grows." },
    ],
  }),
  component: PricingPage,
});

/* ── Colour tokens ─────────────────────────────────────────────────── */
const C = {
  bg:      "#050e1e",
  surface: "#07132a",
  card:    "#081426",
  border:  "rgba(255,255,255,0.07)",
  gold:    "#F5B800",
  text:    "#fff",
  muted:   "rgba(184,197,214,0.72)",
  dim:     "rgba(184,197,214,0.42)",
};

/* ── Module definitions ────────────────────────────────────────────── */
const MODULES = [
  {
    id: "receptionist",
    icon: Phone,
    name: "Receptionist",
    price: "£297",
    period: "/month",
    minutes: "60 AI voice minutes included",
    tagline: "Answer every call, book every appointment.",
    color: "#60a5fa",
    glow: "rgba(96,165,250,0.12)",
    features: [
      "AI inbound receptionist",
      "Appointment booking",
      "Call logs, transcripts & recordings",
      "Basic HiveMind intelligence",
      "1 live agent",
      "Calendar integration",
    ],
    unlocks: ["receptionist_agent", "inbound_calls", "appointment_booking"],
  },
  {
    id: "lead_gen",
    icon: Users,
    name: "Lead Generation",
    price: "+£250",
    period: "/month",
    minutes: "100 AI voice minutes included",
    tagline: "Dial more leads. Fill your pipeline automatically.",
    color: "#4ade80",
    glow: "rgba(74,222,128,0.10)",
    features: [
      "Outbound calling campaigns",
      "CSV upload & lead lists",
      "Lead generation agents",
      "Campaign dashboard",
      "Lead analytics",
      "Data management",
    ],
    unlocks: ["outbound_campaigns", "csv_calling", "lead_generation_agents"],
  },
  {
    id: "qualification",
    icon: BarChart3,
    name: "Client Qualification",
    price: "+£300",
    period: "/month",
    minutes: "150 AI voice minutes included",
    tagline: "Score leads. Automate your qualification pipeline.",
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.10)",
    features: [
      "Qualification agents",
      "Lead scoring & intent tracking",
      "Qualified pipeline automation",
      "Advanced call outcomes",
      "CRM automation",
      "Sales readiness tracking",
    ],
    unlocks: ["qualification_agents", "lead_scoring", "qualified_pipeline_automation"],
  },
  {
    id: "growthmind",
    icon: Rocket,
    name: "GrowthMind",
    price: "+£250",
    period: "/month",
    minutes: null,
    tagline: "AI-driven growth strategy, campaigns & content.",
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.10)",
    features: [
      "GrowthMind AI engine",
      "Campaign Factory",
      "Content Studio",
      "SEO Centre & Content Calendar",
      "Marketing recommendations",
      "Opportunity Engine & Business DNA",
    ],
    unlocks: ["growthmind", "campaign_factory", "content_studio", "seo_centre"],
  },
  {
    id: "whatsapp",
    icon: MessageSquare,
    name: "WhatsApp Centre",
    price: "+£99",
    period: "/month",
    minutes: null,
    tagline: "AI-powered WhatsApp inbox, broadcasts & agents.",
    color: "#34d399",
    glow: "rgba(52,211,153,0.10)",
    features: [
      "WhatsApp inbox",
      "Broadcast campaigns",
      "WhatsApp AI agents",
      "Message templates",
      "Automated follow-ups",
    ],
    unlocks: ["whatsapp_centre", "whatsapp_broadcasts", "whatsapp_agents"],
  },
  {
    id: "video",
    icon: Video,
    name: "Video & Creative Studio",
    price: "+£99",
    period: "/month",
    minutes: null,
    tagline: "Generate videos, images & ad creatives with AI.",
    color: "#f472b6",
    glow: "rgba(244,114,182,0.10)",
    features: [
      "Video Studio (Veo integration)",
      "Image Studio (GPT-Image)",
      "Ad creative generation",
      "Creative Asset Library",
      "Usage credits billed separately",
    ],
    unlocks: ["video_studio", "image_studio", "creative_assets"],
  },
  {
    id: "builder",
    icon: Wrench,
    name: "Builder",
    price: "£97",
    period: "/month",
    minutes: "100 AI voice minutes included",
    tagline: "Full agent and flow building toolkit.",
    color: "#94a3b8",
    glow: "rgba(148,163,184,0.08)",
    standalone: true,
    features: [
      "Agent Builder",
      "Flow Builder & Canvas",
      "Knowledge Builder",
      "Testing tools",
      "1 live agent",
    ],
    unlocks: ["builder", "agent_testing", "flow_builder"],
  },
];

const BUNDLES = [
  {
    id: "pro",
    icon: Star,
    name: "Pro Bundle",
    price: "£997",
    period: "/month",
    minutes: "500 AI voice minutes included",
    tagline: "Everything you need to run a full AI-powered business.",
    color: C.gold,
    glow: "rgba(245,184,0,0.12)",
    highlighted: true,
    includes: ["Receptionist", "Lead Generation", "Client Qualification", "GrowthMind", "WhatsApp Centre", "Video & Creative Studio", "HiveMind", "SystemMind"],
    saving: "Save £443/mo vs individual modules",
  },
  {
    id: "scale",
    icon: Crown,
    name: "Scale Bundle",
    price: "£1,997",
    period: "/month",
    minutes: "1,500 AI voice minutes included",
    tagline: "Enterprise-grade AI operations at scale.",
    color: "#e879f9",
    glow: "rgba(232,121,249,0.12)",
    highlighted: false,
    includes: ["Everything in Pro", "AccountsMind", "Multi-agent orchestration", "Advanced workflows", "White labelling", "Advanced reporting", "Priority support"],
    saving: "Most powerful — for agencies & multi-location businesses",
  },
];

const CORE_FEATURES = [
  "Smart Dash CRM",
  "Calls dashboard",
  "Leads & contacts",
  "Qualified pipeline",
  "Calendar",
  "Knowledge Bases",
  "Provider Settings",
  "Basic reporting",
];

/* ── Nav ────────────────────────────────────────────────────────────── */
function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: "rgba(5,14,30,0.92)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", gap: 28 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", flexShrink: 0 }}>
          <img src={logoWebee} alt="WEBEE" style={{ height: 30, width: 30, borderRadius: 8, objectFit: "cover" }} />
          <span style={{ fontWeight: 800, fontSize: 14.5, color: "#fff", letterSpacing: "-0.02em" }}>
            WEBEE <span style={{ color: C.gold }}>Builder</span>
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 26 }} className="hidden md:flex">
          {(["Features", "Docs"] as const).map(l => (
            <Link key={l} to={l === "Docs" ? "/docs" : "/"} style={{ fontSize: 13.5, color: C.muted, textDecoration: "none", fontWeight: 500 }}>{l}</Link>
          ))}
          <Link to="/pricing" style={{ fontSize: 13.5, color: "#fff", textDecoration: "none", fontWeight: 600 }}>Pricing</Link>
        </div>

        <div style={{ flex: 1 }} />

        <Link to="/login" search={{ redirect: "/dashboard" }}
          className="hidden md:inline-flex"
          style={{ fontSize: 13.5, color: C.muted, fontWeight: 500, textDecoration: "none", padding: "7px 14px" }}
        >Sign In</Link>
        <Link to="/login" search={{ redirect: "/dashboard" }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, background: C.gold, color: "#06162B", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
        >
          Launch App <ArrowRight size={11} />
        </Link>
        <button onClick={() => setOpen(!open)} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 4 }} className="md:hidden">
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {open && (
        <div style={{ background: "#050e1e", borderTop: `1px solid ${C.border}`, padding: "14px 24px 18px" }} className="md:hidden">
          {["Features", "Pricing", "Docs"].map(l => (
            <a key={l} href="#" style={{ display: "block", padding: "10px 0", color: "#B8C5D6", fontSize: 14, borderBottom: `1px solid ${C.border}` }}>{l}</a>
          ))}
          <Link to="/login" search={{ redirect: "/dashboard" }} style={{ display: "block", marginTop: 14, padding: "10px 0", color: "#B8C5D6", fontSize: 14, textDecoration: "none" }}>Sign In</Link>
        </div>
      )}
    </nav>
  );
}

/* ── Module card ─────────────────────────────────────────────────────── */
function ModuleCard({ mod }: { mod: typeof MODULES[0] }) {
  const Icon = mod.icon;
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: "28px 26px",
      display: "flex",
      flexDirection: "column",
      gap: 0,
      position: "relative",
      overflow: "hidden",
      transition: "border-color 0.2s, transform 0.2s",
    }}
      className="hover:-translate-y-0.5 hover:border-white/[0.14]"
    >
      {/* Glow */}
      <div style={{ position: "absolute", top: -40, right: -40, width: 160, height: 160, borderRadius: "50%", background: mod.glow, pointerEvents: "none" }} />

      {(mod as any).standalone && (
        <div style={{ position: "absolute", top: 16, right: 16, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.dim, background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 7px" }}>Standalone</div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${mod.color}18`, border: `1px solid ${mod.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={18} color={mod.color} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>{mod.name}</div>
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 1 }}>{mod.tagline}</div>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 32, fontWeight: 900, color: C.text, letterSpacing: "-0.04em", lineHeight: 1 }}>{mod.price}</span>
          <span style={{ fontSize: 13, color: C.muted }}>{mod.period}</span>
        </div>
        {mod.minutes && (
          <div style={{ fontSize: 11.5, color: mod.color, marginTop: 6, fontWeight: 600 }}>
            + {mod.minutes}
          </div>
        )}
      </div>

      <ul style={{ flex: 1, margin: "0 0 24px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 9 }}>
        {mod.features.map(f => (
          <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: C.muted }}>
            <Check size={13} color={mod.color} style={{ marginTop: 2, flexShrink: 0 }} />
            {f}
          </li>
        ))}
      </ul>

      <Link to="/login" search={{ redirect: "/billing" }}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", borderRadius: 9, border: `1px solid ${mod.color}40`, color: mod.color, fontSize: 13, fontWeight: 600, textDecoration: "none", background: `${mod.color}0a`, transition: "background 0.2s" }}
        className="hover:opacity-80"
      >
        Add module <ArrowRight size={12} />
      </Link>
    </div>
  );
}

/* ── Bundle card ─────────────────────────────────────────────────────── */
function BundleCard({ bundle }: { bundle: typeof BUNDLES[0] }) {
  const Icon = bundle.icon;
  return (
    <div style={{
      background: bundle.highlighted ? `linear-gradient(135deg, #0a1829 0%, #0c1f3a 100%)` : C.card,
      border: `1px solid ${bundle.highlighted ? `${C.gold}35` : C.border}`,
      borderRadius: 20,
      padding: "36px 34px",
      position: "relative",
      overflow: "hidden",
      boxShadow: bundle.highlighted ? `0 0 0 1px ${C.gold}18, 0 32px 80px -40px ${C.gold}25` : "none",
    }}>
      {/* Glow */}
      <div style={{ position: "absolute", top: -60, right: -60, width: 260, height: 260, borderRadius: "50%", background: bundle.glow, pointerEvents: "none" }} />

      {bundle.highlighted && (
        <div style={{ position: "absolute", top: 20, right: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#06162B", background: C.gold, borderRadius: 6, padding: "4px 10px" }}>
          Most Popular
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `${bundle.color}18`, border: `1px solid ${bundle.color}35`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={20} color={bundle.color} />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>{bundle.name}</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{bundle.tagline}</div>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: 44, fontWeight: 900, color: C.text, letterSpacing: "-0.05em", lineHeight: 1 }}>{bundle.price}</span>
          <span style={{ fontSize: 15, color: C.muted }}>{bundle.period}</span>
        </div>
        <div style={{ fontSize: 12, color: bundle.color, marginTop: 6, fontWeight: 600 }}>{bundle.minutes}</div>
      </div>

      <div style={{ fontSize: 11.5, color: bundle.color, fontWeight: 600, marginBottom: 20, background: `${bundle.color}10`, border: `1px solid ${bundle.color}25`, borderRadius: 6, padding: "6px 12px", display: "inline-block" }}>
        {bundle.saving}
      </div>

      <ul style={{ margin: "0 0 28px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
        {bundle.includes.map(f => (
          <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13.5, color: C.muted }}>
            <Check size={14} color={bundle.color} style={{ marginTop: 2, flexShrink: 0 }} />
            {f}
          </li>
        ))}
      </ul>

      <Link to="/login" search={{ redirect: "/billing" }}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "14px 0", borderRadius: 10, background: bundle.highlighted ? C.gold : `${bundle.color}18`, color: bundle.highlighted ? "#06162B" : bundle.color, fontSize: 14, fontWeight: 700, textDecoration: "none", border: bundle.highlighted ? "none" : `1px solid ${bundle.color}35` }}
        className="hover:opacity-90 transition-opacity"
      >
        Get {bundle.name} <ArrowRight size={13} />
      </Link>
    </div>
  );
}

/* ── Comparison table ──────────────────────────────────────────────── */
const COMPARE_ROWS = [
  { feature: "Smart Dash CRM", core: true, receptionist: true, leadGen: true, pro: true },
  { feature: "Calls & Call Logs", core: true, receptionist: true, leadGen: true, pro: true },
  { feature: "Leads & Contacts", core: true, receptionist: true, leadGen: true, pro: true },
  { feature: "Pipeline & Qualified", core: true, receptionist: true, leadGen: true, pro: true },
  { feature: "Calendar & Bookings", core: true, receptionist: true, leadGen: true, pro: true },
  { feature: "Knowledge Bases", core: true, receptionist: true, leadGen: true, pro: true },
  { feature: "AI Inbound Receptionist", core: false, receptionist: true, leadGen: false, pro: true },
  { feature: "Outbound Calling", core: false, receptionist: false, leadGen: true, pro: true },
  { feature: "Lead Campaigns", core: false, receptionist: false, leadGen: true, pro: true },
  { feature: "Qualification Agents", core: false, receptionist: false, leadGen: false, pro: true },
  { feature: "GrowthMind AI", core: false, receptionist: false, leadGen: false, pro: true },
  { feature: "WhatsApp Centre", core: false, receptionist: false, leadGen: false, pro: true },
  { feature: "Video & Creative Studio", core: false, receptionist: false, leadGen: false, pro: true },
  { feature: "HiveMind AI COO", core: false, receptionist: false, leadGen: false, pro: true },
];

/* ── Page ───────────────────────────────────────────────────────────── */
function PricingPage() {
  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        @keyframes fade-up { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation: fade-up 0.55s ease both; }
        .fade-up-2 { animation: fade-up 0.55s 0.1s ease both; }
        .fade-up-3 { animation: fade-up 0.55s 0.2s ease both; }
      `}</style>

      <Nav />

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section style={{ paddingTop: 120, paddingBottom: 64, textAlign: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -100, left: "50%", transform: "translateX(-50%)", width: 900, height: 500, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(30,60,160,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 80, right: "5%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(245,184,0,0.05) 0%, transparent 65%)", pointerEvents: "none" }} />

        <div className="fade-up" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(245,184,0,0.75)", marginBottom: 20 }}>
          <span style={{ width: 20, height: 1, background: "rgba(245,184,0,0.4)", display: "inline-block" }} />
          Modular Pricing
          <span style={{ width: 20, height: 1, background: "rgba(245,184,0,0.4)", display: "inline-block" }} />
        </div>

        <h1 className="fade-up-2" style={{ fontSize: "clamp(36px, 5.5vw, 64px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05, margin: "0 auto 20px", maxWidth: 700, padding: "0 24px" }}>
          Start with the CRM.<br />
          <span style={{ color: C.gold }}>Add what you need.</span>
        </h1>

        <p className="fade-up-3" style={{ fontSize: "clamp(15px, 1.8vw, 17px)", color: C.muted, lineHeight: 1.75, maxWidth: 560, margin: "0 auto 48px", padding: "0 24px" }}>
          Every paid workspace includes the full WEBEE Core CRM. Unlock AI capabilities, automations and intelligence by adding modules as your business grows.
        </p>
      </section>

      {/* ── Core Platform ─────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 64px" }}>
        <div style={{ background: "linear-gradient(135deg, #07132a 0%, #0a1a35 100%)", border: `1px solid ${C.border}`, borderRadius: 20, padding: "36px 40px", display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center" }}>
          <div style={{ flex: "1 1 340px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.gold, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 10 }}>Included with every plan</div>
            <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 10px", lineHeight: 1.15 }}>WEBEE Core Platform</h2>
            <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, margin: "0 0 20px" }}>
              The full CRM foundation — always available to every paying workspace. We never gate your data or your pipeline behind a higher tier.
            </p>
            <Link to="/login" search={{ redirect: "/dashboard" }}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 22px", borderRadius: 9, background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
              className="hover:bg-white/[0.1] transition-colors"
            >
              Access your dashboard <ArrowRight size={12} />
            </Link>
          </div>
          <div style={{ flex: "1 1 320px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {CORE_FEATURES.map(f => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(245,184,0,0.12)", border: "1px solid rgba(245,184,0,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Check size={10} color={C.gold} />
                  </div>
                  {f}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Add-on Modules ────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 10 }}>Add-on modules</div>
          <h2 style={{ fontSize: "clamp(24px, 4vw, 38px)", fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 12px" }}>
            Unlock what you need
          </h2>
          <p style={{ fontSize: 14.5, color: C.muted, maxWidth: 500, margin: "0 auto" }}>
            Mix and match modules. A workspace can have Receptionist + GrowthMind, or all modules together — your choice.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 18 }}>
          {MODULES.map(mod => <ModuleCard key={mod.id} mod={mod} />)}
        </div>
      </section>

      {/* ── Bundles ───────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 10 }}>Save more with bundles</div>
          <h2 style={{ fontSize: "clamp(24px, 4vw, 38px)", fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 12px" }}>
            Full-stack AI operations
          </h2>
          <p style={{ fontSize: 14.5, color: C.muted, maxWidth: 480, margin: "0 auto" }}>
            Get everything at a fixed monthly rate — ideal for agencies and growing businesses.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24 }}>
          {BUNDLES.map(bundle => <BundleCard key={bundle.id} bundle={bundle} />)}
        </div>
      </section>

      {/* ── Comparison table ──────────────────────────────────────────── */}
      <section style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <h2 style={{ fontSize: "clamp(22px, 3.5vw, 32px)", fontWeight: 800, letterSpacing: "-0.04em", margin: "0 0 8px" }}>Compare plans</h2>
          <p style={{ fontSize: 14, color: C.muted }}>What's included across tiers</p>
        </div>

        <div style={{ border: `1px solid ${C.border}`, borderRadius: 16, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 130px 130px 110px", background: "#050e1e", borderBottom: `1px solid ${C.border}`, padding: "14px 20px", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>Feature</span>
            {[
              { label: "Core", sub: "Included" },
              { label: "Receptionist", sub: "£297/mo" },
              { label: "Lead Gen", sub: "+£250/mo" },
              { label: "Pro Bundle", sub: "£997/mo" },
            ].map(col => (
              <div key={col.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{col.label}</div>
                <div style={{ fontSize: 10, color: C.gold }}>{col.sub}</div>
              </div>
            ))}
          </div>

          {COMPARE_ROWS.map((row, i) => (
            <div key={row.feature} style={{ display: "grid", gridTemplateColumns: "1fr 100px 130px 130px 110px", padding: "12px 20px", gap: 8, alignItems: "center", background: i % 2 === 0 ? C.surface : "transparent", borderBottom: i < COMPARE_ROWS.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <span style={{ fontSize: 13, color: C.muted }}>{row.feature}</span>
              {[row.core, row.receptionist, row.leadGen, row.pro].map((has, j) => (
                <div key={j} style={{ display: "flex", justifyContent: "center" }}>
                  {has
                    ? <Check size={15} color={C.gold} />
                    : <Minus size={13} color="rgba(255,255,255,0.12)" />
                  }
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 760, margin: "0 auto", padding: "0 24px 80px" }}>
        <h2 style={{ fontSize: "clamp(22px, 3.5vw, 32px)", fontWeight: 800, letterSpacing: "-0.04em", textAlign: "center", margin: "0 0 36px" }}>Common questions</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { q: "Do I need to choose just one module?", a: "No — workspaces can have multiple modules active at the same time. You can start with Receptionist and add Lead Generation later, or go straight to a bundle." },
            { q: "What's included in the Core Platform?", a: "Every paid workspace gets the full CRM foundation: Smart Dash, Calls, Leads, Contacts, Qualified pipeline, Calendar, Knowledge Bases, and basic reporting. We never gate your data." },
            { q: "How do AI voice minutes work?", a: "Each module includes a monthly allowance of AI voice minutes (e.g. Receptionist includes 60 mins/month). Overages are billed at a per-minute rate. The Pro Bundle includes 500 mins, Scale includes 1,500 mins." },
            { q: "Can I try before I buy?", a: "Yes — the Builder module is available as a standalone £97/mo plan so you can build and test your agents before committing to a full module stack." },
            { q: "How does video and image generation work?", a: "The Video & Creative Studio module unlocks access to the studio. Generation itself is usage-based (credits) billed separately on top of the module fee." },
            { q: "Can I have a custom plan?", a: "Yes — enterprise customers with specific requirements (white labelling, custom minute pools, dedicated support) should contact us to discuss a tailored arrangement." },
          ].map(item => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px 100px" }}>
        <div style={{ background: "linear-gradient(135deg, rgba(245,184,0,0.07) 0%, rgba(30,60,160,0.12) 100%)", border: `1px solid ${C.border}`, borderRadius: 20, padding: "56px 40px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 600, height: 300, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(245,184,0,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, letterSpacing: "-0.04em", margin: "0 0 14px", lineHeight: 1.1, position: "relative" }}>
            Ready to build your hive?
          </h2>
          <p style={{ fontSize: 16, color: C.muted, lineHeight: 1.7, maxWidth: 500, margin: "0 auto 36px", position: "relative" }}>
            Start with the core CRM and add your first AI module today.
          </p>
          <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12, position: "relative" }}>
            <Link to="/login" search={{ redirect: "/dashboard" }}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 32px", borderRadius: 999, background: C.gold, color: "#06162B", fontSize: 14.5, fontWeight: 800, textDecoration: "none", boxShadow: "0 12px 40px rgba(245,184,0,0.28)" }}
              className="hover:opacity-90 transition-opacity"
            >
              Get Started Free <ArrowRight size={14} />
            </Link>
            <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 28px", borderRadius: 999, border: `1px solid ${C.border}`, color: C.muted, fontSize: 14.5, fontWeight: 600, textDecoration: "none" }}
              className="hover:border-white/25 hover:text-white transition-colors"
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "28px 24px", textAlign: "center" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 24, marginBottom: 16 }}>
          <Link to="/"        style={{ fontSize: 12.5, color: C.dim, textDecoration: "none" }} className="hover:text-white">Home</Link>
          <Link to="/docs"    style={{ fontSize: 12.5, color: C.dim, textDecoration: "none" }} className="hover:text-white">API Docs</Link>
          <Link to="/pricing" style={{ fontSize: 12.5, color: "#fff", textDecoration: "none", fontWeight: 600 }}>Pricing</Link>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, color: C.dim, textDecoration: "none" }} className="hover:text-white">webespokeai.com</a>
        </div>
        <div style={{ fontSize: 11.5, color: C.dim }}>© {new Date().getFullYear()} Webespoke AI Ltd. All rights reserved.</div>
      </footer>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: C.surface, border: `1px solid ${open ? "rgba(255,255,255,0.12)" : C.border}`, borderRadius: 12, overflow: "hidden", transition: "border-color 0.2s" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, textAlign: "left" }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{q}</span>
        <div style={{ width: 22, height: 22, borderRadius: "50%", border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transform: open ? "rotate(45deg)" : "none", transition: "transform 0.2s" }}>
          <span style={{ color: C.muted, fontSize: 16, lineHeight: 1, marginTop: -1 }}>+</span>
        </div>
      </button>
      {open && (
        <div style={{ padding: "0 22px 18px", fontSize: 13.5, color: C.muted, lineHeight: 1.75 }}>{a}</div>
      )}
    </div>
  );
}
