import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Check, Play, Workflow, LayoutDashboard,
  Phone, Users, Zap, BarChart3, Shield, Globe,
  Bot, Calendar, TrendingUp, ChevronRight,
  Building2, Lock, Key, FileText, Headphones,
  Activity, PhoneCall, Target, DollarSign, Star,
  CheckCircle2, MessageSquare, Layers, Menu, X,
  RefreshCw, Repeat2, Cpu, LayoutPanelLeft,
} from "lucide-react";
import logoWebee from "@/assets/webee-logo-yellow.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WEBEE Builder — Design Your Bees. Deploy Your Hive." },
      { name: "description", content: "WEBEE Builder is the flagship no-code platform for designing, training, and deploying your own autonomous AI workforce. No engineers. No agencies. Just intelligent agents ready to work in minutes." },
      { property: "og:title", content: "WEBEE Builder — A Webespoke AI Product" },
      { property: "og:url", content: "https://www.webespokeai.com" },
    ],
  }),
  component: Index,
});

/* ─── CSS keyframe animations ─────────────────────────────────────── */
function GlobalStyles() {
  return (
    <style>{`
      @keyframes float {
        0%, 100% { transform: translateY(0px); }
        50%       { transform: translateY(-12px); }
      }
      @keyframes glow-pulse {
        0%, 100% { opacity: 0.35; transform: scale(1); }
        50%       { opacity: 0.65; transform: scale(1.06); }
      }
      @keyframes fade-up {
        from { opacity: 0; transform: translateY(24px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position:  200% 0; }
      }
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50%       { opacity: 0; }
      }
      @keyframes scan-line {
        0%   { transform: translateY(-100%); }
        100% { transform: translateY(100%); }
      }
      .animate-float       { animation: float 5s ease-in-out infinite; }
      .animate-glow        { animation: glow-pulse 4s ease-in-out infinite; }
      .animate-fade-up     { animation: fade-up 0.7s ease both; }
      .delay-100 { animation-delay: 0.10s; }
      .delay-200 { animation-delay: 0.20s; }
      .delay-300 { animation-delay: 0.30s; }
      .delay-400 { animation-delay: 0.40s; }
      .delay-500 { animation-delay: 0.50s; }
      .delay-600 { animation-delay: 0.60s; }
      .gold-shimmer {
        background: linear-gradient(90deg, #F5B800 0%, #FFD94A 45%, #F5B800 90%);
        background-size: 200% auto;
        animation: shimmer 3.5s linear infinite;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .glass {
        background: rgba(16,42,76,0.45);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.07);
      }
      .glass-light {
        background: rgba(45,140,255,0.05);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(45,140,255,0.14);
      }
      .nav-link { transition: color 0.2s; }
      .nav-link:hover { color: #fff !important; }
      .section-reveal { opacity: 0; transform: translateY(22px); transition: opacity 0.6s ease, transform 0.6s ease; }
      .section-reveal.visible { opacity: 1; transform: translateY(0); }
      .card-hover { transition: transform 0.25s ease, box-shadow 0.25s ease; }
      .card-hover:hover { transform: translateY(-4px); box-shadow: 0 24px 60px rgba(45,140,255,0.16); }
      .feat-card-hover { transition: transform 0.2s ease, border-color 0.2s ease; }
      .feat-card-hover:hover { transform: translateY(-3px); }
    `}</style>
  );
}

/* ─── Reveal on scroll hook ────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add("visible"); obs.disconnect(); }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

/* ─── Navigation ────────────────────────────────────────────────────── */
function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 100,
      background: scrolled ? "rgba(5,14,30,0.96)" : "transparent",
      backdropFilter: scrolled ? "blur(20px)" : "none",
      borderBottom: scrolled ? "1px solid rgba(255,255,255,0.05)" : "1px solid transparent",
      transition: "background 0.35s ease, border-color 0.35s ease, backdrop-filter 0.35s ease",
    }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px", height: 62, display: "flex", alignItems: "center", justifyContent: "space-between" }}>

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <img src={logoWebee} alt="WEBEE" style={{ height: 34, width: 34, borderRadius: 9, objectFit: "cover" }} />
          <span style={{ fontWeight: 800, fontSize: 15, color: "#fff", letterSpacing: "-0.02em" }}>
            WEBEE <span style={{ color: "#F5B800" }}>Builder</span>
          </span>
        </div>

        {/* Center nav links */}
        <div style={{ display: "flex", alignItems: "center", gap: 28 }} className="hidden md:flex">
          {["Features", "Pricing", "Docs"].map(l => (
            <a key={l} href="#" className="nav-link" style={{ fontSize: 13.5, color: "rgba(184,197,214,0.85)", textDecoration: "none", fontWeight: 500 }}>{l}</a>
          ))}
        </div>

        {/* Right CTAs */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link to="/login" search={{ redirect: "/dashboard" }}
            className="hidden md:inline-flex nav-link"
            style={{ fontSize: 13.5, color: "rgba(184,197,214,0.85)", fontWeight: 500, textDecoration: "none", padding: "7px 14px" }}
          >
            Sign In
          </Link>
          <Link to="/login" search={{ redirect: "/dashboard" }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, background: "#F5B800", color: "#06162B", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
            className="hover:opacity-90 transition-opacity"
          >
            Launch App <ArrowRight size={12} />
          </Link>
          <button onClick={() => setOpen(!open)} style={{ background: "transparent", border: "none", color: "#B8C5D6", cursor: "pointer", padding: 4 }} className="md:hidden">
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div style={{ background: "#050e1e", borderTop: "1px solid rgba(255,255,255,0.05)", padding: "16px 24px 20px" }} className="md:hidden">
          {["Features", "Pricing", "Docs"].map(l => (
            <a key={l} href="#" style={{ display: "block", padding: "11px 0", color: "#B8C5D6", fontSize: 14, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{l}</a>
          ))}
          <Link to="/login" search={{ redirect: "/dashboard" }} style={{ display: "block", marginTop: 16, padding: "11px 0", color: "#B8C5D6", fontSize: 14, textDecoration: "none" }}>Sign In</Link>
        </div>
      )}
    </nav>
  );
}

/* ─── Hero Section ──────────────────────────────────────────────────── */
function HeroSection() {
  return (
    <section style={{
      background: "linear-gradient(160deg, #050e1e 0%, #0a1a35 40%, #0d1a40 70%, #080f28 100%)",
      padding: "96px 24px 0",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Ambient glow blobs */}
      <div className="animate-glow" style={{
        position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)",
        width: 900, height: 560, borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(30,60,160,0.22) 0%, transparent 68%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", top: 200, right: -120, width: 480, height: 480, borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(245,184,0,0.06) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />

      {/* Centered content */}
      <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center", position: "relative" }}>

        {/* Kicker */}
        <div className="animate-fade-up" style={{ marginBottom: 28 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
            color: "rgba(245,184,0,0.75)",
          }}>
            <span style={{ width: 20, height: 1, background: "rgba(245,184,0,0.4)", display: "inline-block" }} />
            Flagship Platform &nbsp;·&nbsp; A Webespoke AI Product
            <span style={{ width: 20, height: 1, background: "rgba(245,184,0,0.4)", display: "inline-block" }} />
          </span>
        </div>

        {/* Main headline */}
        <h1 className="animate-fade-up delay-100" style={{
          fontSize: "clamp(42px, 6.5vw, 76px)",
          fontWeight: 900,
          lineHeight: 1.05,
          letterSpacing: "-0.04em",
          color: "#fff",
          marginBottom: 24,
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }}>
          Design your bees.<br />
          <span className="gold-shimmer">Deploy your hive.</span>
        </h1>

        {/* Subtext */}
        <p className="animate-fade-up delay-200" style={{
          fontSize: "clamp(15px, 1.8vw, 17px)",
          color: "rgba(184,197,214,0.82)",
          lineHeight: 1.75,
          maxWidth: 600,
          margin: "0 auto 40px",
          WebkitFontSmoothing: "antialiased",
        }}>
          WEBEE Builder is the flagship no-code platform for designing, training, and deploying your own autonomous AI workforce. No engineers. No agencies. Just intelligent agents ready to work in minutes.
        </p>

        {/* CTAs */}
        <div className="animate-fade-up delay-300" style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12, marginBottom: 64 }}>
          <Link to="/login" search={{ redirect: "/dashboard" }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "13px 30px", borderRadius: 999,
              background: "#F5B800", color: "#06162B",
              fontSize: 14.5, fontWeight: 800,
              textDecoration: "none",
              boxShadow: "0 0 0 1px rgba(245,184,0,0.3), 0 12px 36px rgba(245,184,0,0.28)",
              letterSpacing: "-0.01em",
            }}
            className="hover:opacity-90 transition-opacity"
          >
            Get Started Free <ArrowRight size={14} />
          </Link>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "13px 28px", borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.13)",
              color: "rgba(255,255,255,0.85)",
              fontSize: 14.5, fontWeight: 600,
              textDecoration: "none", letterSpacing: "-0.01em",
            }}
            className="hover:bg-white/[0.05] hover:border-white/25 transition-colors"
          >
            Book a Demo <ArrowRight size={13} />
          </a>
        </div>
      </div>

      {/* Floating App Preview Mockup */}
      <div className="animate-fade-up delay-400" style={{ maxWidth: 1000, margin: "0 auto", position: "relative", paddingBottom: 0 }}>
        {/* Glow behind the mockup */}
        <div style={{
          position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)",
          width: 700, height: 400, borderRadius: "50%",
          background: "radial-gradient(ellipse, rgba(30,80,200,0.18) 0%, transparent 65%)",
          pointerEvents: "none",
          filter: "blur(40px)",
        }} />

        {/* App chrome wrapper */}
        <div style={{
          borderRadius: "16px 16px 0 0",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          boxShadow: "0 -4px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)",
          overflow: "hidden",
          position: "relative",
        }}>
          {/* Browser chrome bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px",
            background: "rgba(10,22,48,0.9)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}>
            {["#F87171","#FBBF24","#34D399"].map(c => <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block" }} />)}
            <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 14px", borderRadius: 6, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", minWidth: 200 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34D399", display: "inline-block", animation: "glow-pulse 2s infinite" }} />
                <span style={{ fontSize: 10.5, color: "rgba(184,197,214,0.7)", fontFamily: "monospace" }}>app.webespokeai.com/builder</span>
              </div>
            </div>
            <span style={{ fontSize: 9.5, color: "#F5B800", display: "flex", alignItems: "center", gap: 4, fontWeight: 700 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#F5B800", display: "inline-block", animation: "glow-pulse 2s infinite" }} />
              LIVE
            </span>
          </div>

          {/* Simulated builder canvas */}
          <div style={{
            background: "linear-gradient(160deg, #070f22 0%, #0a1530 100%)",
            display: "flex",
            height: 380,
            overflow: "hidden",
            position: "relative",
          }}>
            {/* Dot grid background */}
            <div style={{
              position: "absolute", inset: 0,
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
              pointerEvents: "none",
            }} />

            {/* Left panel: node palette */}
            <div style={{ width: 150, borderRight: "1px solid rgba(255,255,255,0.05)", background: "rgba(5,14,30,0.7)", padding: "12px 10px", flexShrink: 0, zIndex: 2 }}>
              <div style={{ fontSize: 8.5, color: "rgba(184,197,214,0.5)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>Nodes</div>
              {[
                { label: "Call Trigger",     c: "#2D8CFF" },
                { label: "AI Response",      c: "#8B5CF6" },
                { label: "Qualify Lead",     c: "#F5B800" },
                { label: "Book Appointment", c: "#34D399" },
                { label: "Send SMS",         c: "#F87171" },
                { label: "Update CRM",       c: "#06B6D4" },
              ].map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", borderRadius: 6, marginBottom: 3, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)", cursor: "default" }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: n.c, flexShrink: 0 }} />
                  <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.7)" }}>{n.label}</span>
                </div>
              ))}
            </div>

            {/* Canvas: flow diagram */}
            <div style={{ flex: 1, position: "relative", zIndex: 2 }}>
              {/* Flow nodes */}
              {[
                { label: "Inbound Call",       sub: "Trigger",     x: "50%", y: 30,  c: "#2D8CFF", tx: "-50%" },
                { label: "AI Greeting",         sub: "AI Response", x: "30%", y: 115, c: "#8B5CF6", tx: "-50%" },
                { label: "Qualify Lead",        sub: "Logic",       x: "70%", y: 115, c: "#F5B800", tx: "-50%" },
                { label: "Book Appointment",    sub: "Action",      x: "30%", y: 200, c: "#34D399", tx: "-50%" },
                { label: "CRM Update",          sub: "Action",      x: "70%", y: 200, c: "#06B6D4", tx: "-50%" },
                { label: "End Call + Follow Up",sub: "Output",      x: "50%", y: 285, c: "#F87171", tx: "-50%" },
              ].map((n, i) => (
                <div key={i} style={{
                  position: "absolute", left: n.x, top: n.y, transform: `translateX(${n.tx})`,
                  padding: "7px 14px", borderRadius: 9,
                  background: "rgba(10,22,48,0.9)", border: `1px solid ${n.c}35`,
                  boxShadow: `0 4px 20px rgba(0,0,0,0.4), 0 0 12px ${n.c}18`,
                  whiteSpace: "nowrap",
                }}>
                  <div style={{ fontSize: 7.5, color: n.c, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 1 }}>{n.sub}</div>
                  <div style={{ fontSize: 10.5, color: "#fff", fontWeight: 600 }}>{n.label}</div>
                </div>
              ))}

              {/* Connector lines */}
              <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
                {[
                  { x1: "50%", y1: 65, x2: "30%", y2: 110 },
                  { x1: "50%", y1: 65, x2: "70%", y2: 110 },
                  { x1: "30%", y1: 140, x2: "30%", y2: 195 },
                  { x1: "70%", y1: 140, x2: "70%", y2: 195 },
                  { x1: "30%", y1: 225, x2: "50%", y2: 280 },
                  { x1: "70%", y1: 225, x2: "50%", y2: 280 },
                ].map((l, i) => (
                  <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                    stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" strokeDasharray="4 3" />
                ))}
              </svg>
            </div>

            {/* Right panel: inspector */}
            <div style={{ width: 180, borderLeft: "1px solid rgba(255,255,255,0.05)", background: "rgba(5,14,30,0.7)", padding: "12px 10px", flexShrink: 0, zIndex: 2 }}>
              <div style={{ fontSize: 8.5, color: "rgba(184,197,214,0.5)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>Inspector</div>
              <div style={{ fontSize: 9.5, color: "#fff", fontWeight: 600, marginBottom: 8, padding: "6px 8px", background: "rgba(45,140,255,0.08)", borderRadius: 6, border: "1px solid rgba(45,140,255,0.15)" }}>AI Greeting</div>
              {[
                { l: "Voice", v: "Rebecca" },
                { l: "Language", v: "EN-GB" },
                { l: "Tone", v: "Professional" },
                { l: "Max turns", v: "12" },
              ].map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 9, color: "rgba(184,197,214,0.55)" }}>{r.l}</span>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{r.v}</span>
                </div>
              ))}

              <div style={{ marginTop: 16, fontSize: 8.5, color: "rgba(184,197,214,0.5)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Status</div>
              {[
                { l: "Agent", v: "ag_x921k", c: "#34D399" },
                { l: "Deployed", v: "Active", c: "#34D399" },
                { l: "Test calls", v: "4", c: "#F5B800" },
              ].map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 9, color: "rgba(184,197,214,0.55)" }}>{r.l}</span>
                  <span style={{ fontSize: 9, color: r.c, fontWeight: 600 }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom fade into next section */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: 120,
          background: "linear-gradient(to bottom, transparent, #050e1e)",
          pointerEvents: "none",
        }} />
      </div>
    </section>
  );
}

/* ─── Feature Grid (4 cards) ─────────────────────────────────────── */
function FeatureGrid() {
  const ref = useReveal();
  const cards = [
    {
      icon: RefreshCw,
      color: "#2D8CFF",
      bg: "rgba(45,140,255,0.08)",
      border: "rgba(45,140,255,0.18)",
      title: "CLS Engine™",
      badge: "Closed Loop Scripting",
      desc: "Autonomous conversation scripts that self-correct and adapt in real time to keep every call on track.",
    },
    {
      icon: Repeat2,
      color: "#8B5CF6",
      bg: "rgba(139,92,246,0.08)",
      border: "rgba(139,92,246,0.18)",
      title: "Echo Loop Technology™",
      badge: "Persistent customer memory",
      desc: "Every interaction is remembered. Agents recall context across sessions to deliver deeply personalised experiences.",
    },
    {
      icon: Cpu,
      color: "#F5B800",
      bg: "rgba(245,184,0,0.08)",
      border: "rgba(245,184,0,0.22)",
      title: "WEBEE Builder™",
      badge: "No-code AI agent platform",
      desc: "Design, train, and deploy autonomous AI agents with a visual drag-and-drop canvas. No engineering required.",
    },
    {
      icon: LayoutPanelLeft,
      color: "#34D399",
      bg: "rgba(52,211,153,0.08)",
      border: "rgba(52,211,153,0.18)",
      title: "WEBEE Smart Dash™",
      badge: "Centralised command centre",
      desc: "Monitor every call, booking, and conversion across your entire AI workforce from a single live dashboard.",
    },
  ];

  return (
    <section style={{ background: "#050e1e", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 56 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(245,184,0,0.7)", marginBottom: 14 }}>
            Platform Technology
          </div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.035em", lineHeight: 1.1, WebkitFontSmoothing: "antialiased" }}>
            Four pillars. One platform.
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 18 }}>
          {cards.map((c, i) => {
            const Icon = c.icon;
            return (
              <div key={i} className="feat-card-hover" style={{
                borderRadius: 16, padding: "28px 24px",
                background: "rgba(10,22,48,0.6)",
                border: `1px solid ${c.border}`,
                backdropFilter: "blur(12px)",
                position: "relative", overflow: "hidden",
              }}>
                {/* Top accent line */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${c.color}60, transparent)` }} />

                {/* Icon circle */}
                <div style={{ width: 42, height: 42, borderRadius: "50%", background: c.bg, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
                  <Icon size={18} color={c.color} />
                </div>

                {/* Badge */}
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: c.color, marginBottom: 7, opacity: 0.8 }}>{c.badge}</div>

                {/* Title */}
                <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 10, letterSpacing: "-0.02em", WebkitFontSmoothing: "antialiased" }}>{c.title}</div>

                {/* Description */}
                <p style={{ fontSize: 13, color: "rgba(184,197,214,0.72)", lineHeight: 1.65, margin: 0 }}>{c.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Three Layers ─────────────────────────────────────── */
function ThreeLayersSection() {
  const ref = useReveal();
  const layers = [
    {
      icon: Workflow, color: "#2D8CFF", bg: "rgba(45,140,255,0.08)",
      title: "Webee Builder",
      desc: "Visual drag-and-drop workflow creation. Build any AI agent conversation without writing a single line of code.",
      features: ["No-code flow editor", "Node-based logic", "Template library", "One-click deploy"],
    },
    {
      icon: Bot, color: "#F5B800", bg: "rgba(245,184,0,0.08)",
      title: "AI Voice Agents",
      desc: "Deploy intelligent voice receptionists, sales agents and support teams that work around the clock.",
      features: ["Natural conversations", "Appointment booking", "Lead qualification", "CRM integration"],
    },
    {
      icon: BarChart3, color: "#34D399", bg: "rgba(52,211,153,0.08)",
      title: "Smart Dash",
      desc: "Track every call, booking, conversion and revenue metric in a unified real-time dashboard.",
      features: ["Live call monitoring", "Revenue tracking", "Agent performance", "Custom reports"],
    },
  ];

  return (
    <section style={{ background: "linear-gradient(180deg, #050e1e 0%, #07142a 100%)", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#2D8CFF", opacity: 0.8, marginBottom: 14 }}>The Platform</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.035em", lineHeight: 1.1, WebkitFontSmoothing: "antialiased" }}>
            One Platform. Three Powerful Layers.
          </h2>
          <p style={{ fontSize: 15.5, color: "rgba(184,197,214,0.72)", marginTop: 16, maxWidth: 460, margin: "16px auto 0" }}>
            Builder, Voice Agents and Smart Dash work together as one integrated ecosystem.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 22 }}>
          {layers.map((l, i) => {
            const Icon = l.icon;
            return (
              <div key={i} className="card-hover glass" style={{ borderRadius: 20, padding: 32, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${l.color}55, transparent)` }} />
                <div style={{ width: 46, height: 46, borderRadius: 13, background: l.bg, border: `1px solid ${l.color}28`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
                  <Icon size={20} color={l.color} />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 10, letterSpacing: "-0.02em" }}>{l.title}</h3>
                <p style={{ fontSize: 13.5, color: "rgba(184,197,214,0.72)", lineHeight: 1.7, marginBottom: 22 }}>{l.desc}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {l.features.map(f => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Check size={12} color={l.color} />
                      <span style={{ fontSize: 13, color: "rgba(184,197,214,0.72)" }}>{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Builder Showcase ─────────────────────────────────── */
function BuilderSection() {
  const ref = useReveal();
  const nodes = [
    { label: "Trigger",           icon: PhoneCall,    color: "#2D8CFF", bg: "rgba(45,140,255,0.12)" },
    { label: "AI Agent",          icon: Bot,          color: "#8B5CF6", bg: "rgba(139,92,246,0.12)" },
    { label: "CRM Update",        icon: Users,        color: "#F5B800", bg: "rgba(245,184,0,0.12)"  },
    { label: "SMS Follow-Up",     icon: MessageSquare,color: "#34D399", bg: "rgba(52,211,153,0.12)" },
    { label: "Booking Confirmed", icon: Calendar,     color: "#F87171", bg: "rgba(248,113,113,0.12)"},
  ];

  return (
    <section style={{ background: "linear-gradient(180deg, #07142a 0%, #050e1e 100%)", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 72, alignItems: "center" }} className="flex flex-col lg:grid">
        <div className="section-reveal" ref={ref}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#F5B800", opacity: 0.8, marginBottom: 14 }}>WEBEE Builder</div>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.035em", lineHeight: 1.15, marginBottom: 18, WebkitFontSmoothing: "antialiased" }}>
            Build AI Agents Visually
          </h2>
          <p style={{ fontSize: 15.5, color: "rgba(184,197,214,0.72)", lineHeight: 1.75, marginBottom: 28 }}>
            Design intelligent workflows without writing code. Connect nodes to create complex AI conversation flows in minutes.
          </p>
          {[
            "Drag-and-drop node editor",
            "Conditional logic & branching",
            "Live preview before deploying",
            "Template library to get started fast",
          ].map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 18, height: 18, borderRadius: 5, background: "rgba(245,184,0,0.1)", border: "1px solid rgba(245,184,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Check size={10} color="#F5B800" />
              </div>
              <span style={{ fontSize: 13.5, color: "rgba(184,197,214,0.72)" }}>{f}</span>
            </div>
          ))}
          <Link to="/login" search={{ redirect: "/builder" }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 28, padding: "11px 24px", borderRadius: 999, background: "#F5B800", color: "#06162B", fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}
            className="hover:opacity-90 transition-opacity"
          >
            Try the Builder <ChevronRight size={15} />
          </Link>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
          {nodes.map((n, i) => {
            const Icon = n.icon;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div className="card-hover" style={{
                  width: 280, padding: "13px 16px", borderRadius: 13,
                  background: "rgba(10,22,48,0.8)", border: `1px solid ${n.color}28`,
                  boxShadow: `0 4px 24px rgba(0,0,0,0.3), 0 0 18px ${n.color}14`,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: n.bg, border: `1px solid ${n.color}38`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={15} color={n.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 7.5, color: n.color, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>
                      {i === 0 ? "Trigger" : i === nodes.length - 1 ? "Output" : "Action"}
                    </div>
                    <div style={{ fontSize: 12.5, color: "#fff", fontWeight: 600 }}>{n.label}</div>
                  </div>
                  <div style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: "50%", background: n.color, boxShadow: `0 0 7px ${n.color}` }} />
                </div>
                {i < nodes.length - 1 && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3px 0" }}>
                    <div style={{ width: 1.5, height: 12, background: `linear-gradient(180deg, ${n.color}55, ${nodes[i+1].color}55)`, borderRadius: 1 }} />
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: nodes[i+1].color, margin: "1px 0", boxShadow: `0 0 5px ${nodes[i+1].color}` }} />
                    <div style={{ width: 1.5, height: 12, background: `linear-gradient(180deg, ${nodes[i+1].color}55, ${nodes[i+1].color}18)`, borderRadius: 1 }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Voice Agents ─────────────────────────────────────── */
function VoiceSection() {
  const ref = useReveal();
  const msgs = [
    { from: "agent", text: "Hi, this is Rebecca from Acme Corp. How can I help you today?" },
    { from: "user",  text: "I'd like to book an appointment for next Tuesday." },
    { from: "agent", text: "Of course! I have slots at 10am and 2pm available. Which works best?" },
    { from: "user",  text: "10am sounds perfect." },
    { from: "agent", text: "Confirmed! I've booked you for Tuesday at 10am. You'll receive a confirmation shortly." },
  ];
  const features = [
    { icon: Headphones, label: "Natural Voice Conversations" },
    { icon: Calendar,   label: "Appointment Booking" },
    { icon: Target,     label: "Lead Qualification" },
    { icon: Users,      label: "CRM Integration" },
    { icon: Zap,        label: "24/7 Availability" },
    { icon: Globe,      label: "Multi-language Support" },
  ];

  return (
    <section style={{ background: "#050e1e", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 72, alignItems: "center" }} className="flex flex-col-reverse lg:grid">
        <div>
          <div className="glass" style={{ borderRadius: 20, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(5,14,30,0.8)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(52,211,153,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Bot size={14} color="#34D399" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>Rebecca — AI Agent</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34D399", display: "inline-block", animation: "glow-pulse 2s infinite" }} />
                  <span style={{ fontSize: 9.5, color: "#34D399" }}>Live call</span>
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 2.5 }}>
                {[12,7,18,10,16,8,14,11].map((h, i) => (
                  <div key={i} style={{ width: 2.5, borderRadius: 2, background: "#34D399", opacity: i % 2 === 0 ? 0.9 : 0.5, height: h }} />
                ))}
              </div>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.from === "agent" ? "flex-start" : "flex-end" }}>
                  <div style={{
                    maxWidth: "80%", padding: "8px 12px", borderRadius: m.from === "agent" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                    background: m.from === "agent" ? "rgba(45,140,255,0.08)" : "rgba(245,184,0,0.08)",
                    border: `1px solid ${m.from === "agent" ? "rgba(45,140,255,0.18)" : "rgba(245,184,0,0.18)"}`,
                    fontSize: 12, color: "#E2E8F0", lineHeight: 1.65,
                  }}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 4 }}>
                {[0, 0.2, 0.4].map((d, i) => <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#2D8CFF", animation: `blink 1s infinite ${d}s` }} />)}
              </div>
            </div>
          </div>
        </div>

        <div className="section-reveal" ref={ref}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#2D8CFF", opacity: 0.8, marginBottom: 14 }}>Voice Agents</div>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.035em", lineHeight: 1.15, marginBottom: 18, WebkitFontSmoothing: "antialiased" }}>
            AI Agents That Never Miss A Call
          </h2>
          <p style={{ fontSize: 15.5, color: "rgba(184,197,214,0.72)", lineHeight: 1.75, marginBottom: 28 }}>
            Deploy voice agents that handle real conversations — booking appointments, qualifying leads and integrating with your CRM automatically.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {features.map(f => {
              const Icon = f.icon;
              return (
                <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", borderRadius: 9, background: "rgba(45,140,255,0.05)", border: "1px solid rgba(45,140,255,0.11)" }}>
                  <Icon size={13} color="#2D8CFF" />
                  <span style={{ fontSize: 12.5, color: "rgba(184,197,214,0.72)" }}>{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Smart Dash ─────────────────────────────────────── */
function DashSection() {
  const ref = useReveal();
  const cards = [
    { label: "Calls Handled",   value: "12,847", delta: "+18%", icon: PhoneCall,  color: "#2D8CFF" },
    { label: "Qualified Leads", value: "3,291",  delta: "+24%", icon: Target,     color: "#F5B800" },
    { label: "Bookings Made",   value: "891",    delta: "+31%", icon: Calendar,   color: "#34D399" },
    { label: "Revenue Tracked", value: "£94k",   delta: "+12%", icon: DollarSign, color: "#8B5CF6" },
    { label: "Conversion Rate", value: "28.4%",  delta: "+4%",  icon: TrendingUp, color: "#F87171" },
    { label: "Agent Uptime",    value: "99.9%",  delta: "stable",icon: Activity,  color: "#34D399" },
  ];

  return (
    <section style={{ background: "linear-gradient(180deg, #050e1e 0%, #07142a 100%)", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#34D399", opacity: 0.8, marginBottom: 14 }}>Smart Dash</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.035em", lineHeight: 1.1, WebkitFontSmoothing: "antialiased" }}>
            Every Conversation.<br />Every Booking.<br />One Dashboard.
          </h2>
          <p style={{ fontSize: 15.5, color: "rgba(184,197,214,0.72)", marginTop: 16, maxWidth: 460, margin: "16px auto 0" }}>
            Get unified visibility across all your AI agents, calls and conversions in real time.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
          {cards.map((c, i) => {
            const Icon = c.icon;
            return (
              <div key={i} className="card-hover glass" style={{ borderRadius: 15, padding: 22, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${c.color}70, transparent)` }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: `${c.color}12`, border: `1px solid ${c.color}28`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={15} color={c.color} />
                  </div>
                  <span style={{ fontSize: 10.5, color: "#34D399", fontWeight: 600, background: "rgba(52,211,153,0.08)", padding: "2px 7px", borderRadius: 5 }}>{c.delta}</span>
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: "-0.025em", WebkitFontSmoothing: "antialiased" }}>{c.value}</div>
                <div style={{ fontSize: 12, color: "rgba(184,197,214,0.6)", marginTop: 4 }}>{c.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Social Proof ─────────────────────────────────────── */
function SocialProof() {
  const ref = useReveal();
  const stats = [
    { value: "500K+", label: "Calls Handled",       icon: PhoneCall  },
    { value: "89%",   label: "Qualification Rate",  icon: Target     },
    { value: "24/7",  label: "Availability",        icon: Zap        },
    { value: "10x",   label: "Faster Response Times",icon: TrendingUp },
  ];
  return (
    <section style={{ background: "#07142a", padding: "100px 24px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 56 }}>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.035em", WebkitFontSmoothing: "antialiased" }}>
            Trusted By Growing Businesses
          </h2>
          <p style={{ fontSize: 14.5, color: "rgba(184,197,214,0.65)", marginTop: 12 }}>Real results from real deployments across multiple industries.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginBottom: 60 }}>
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="glass" style={{ borderRadius: 18, padding: "28px 22px", textAlign: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(45,140,255,0.09)", border: "1px solid rgba(45,140,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                  <Icon size={18} color="#2D8CFF" />
                </div>
                <div style={{ fontSize: 40, fontWeight: 900, color: "#F5B800", letterSpacing: "-0.04em", WebkitFontSmoothing: "antialiased" }}>{s.value}</div>
                <div style={{ fontSize: 12.5, color: "rgba(184,197,214,0.6)", marginTop: 5 }}>{s.label}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap", opacity: 0.35 }}>
          {["Healthcare", "Property", "Automotive", "Finance", "Retail", "Trades"].map(l => (
            <div key={l} style={{ padding: "7px 18px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.14)", fontSize: 11, color: "#B8C5D6", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Enterprise ─────────────────────────────────────── */
function EnterpriseSection() {
  const ref = useReveal();
  const features = [
    { icon: Layers,   label: "Multi-Agent Management", desc: "Manage unlimited agents from a single workspace." },
    { icon: Users,    label: "Team Permissions",       desc: "Role-based access control for your entire team." },
    { icon: Globe,    label: "White Label Options",    desc: "Fully branded platform for your clients." },
    { icon: Key,      label: "API Access",             desc: "Connect your existing stack via REST API." },
    { icon: Shield,   label: "Enterprise Security",    desc: "SOC2-ready infrastructure and data encryption." },
    { icon: FileText, label: "Advanced Reporting",     desc: "Custom dashboards and data exports on demand." },
  ];
  return (
    <section style={{ background: "linear-gradient(135deg, #07142a 0%, #050e1e 100%)", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#2D8CFF", opacity: 0.8, marginBottom: 14 }}>Enterprise</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.035em", WebkitFontSmoothing: "antialiased" }}>
            Built For Teams That Scale
          </h2>
          <p style={{ fontSize: 15.5, color: "rgba(184,197,214,0.72)", marginTop: 12, maxWidth: 420, margin: "12px auto 0" }}>
            Everything large teams need to deploy, manage and scale AI voice operations confidently.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={i} className="card-hover glass-light" style={{ borderRadius: 15, padding: "22px 20px", display: "flex", gap: 15 }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: "rgba(45,140,255,0.09)", border: "1px solid rgba(45,140,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={16} color="#2D8CFF" />
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", marginBottom: 4, letterSpacing: "-0.01em" }}>{f.label}</div>
                  <div style={{ fontSize: 12.5, color: "rgba(184,197,214,0.65)", lineHeight: 1.6 }}>{f.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 48, textAlign: "center" }}>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 26px", borderRadius: 999, border: "1px solid rgba(45,140,255,0.28)", color: "#2D8CFF", fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}
            className="hover:bg-[#2D8CFF]/10 transition-colors"
          >
            <Building2 size={14} /> Talk to Enterprise Sales
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Section: Final CTA ─────────────────────────────────────── */
function CTASection() {
  return (
    <section style={{ background: "#07142a", padding: "110px 24px", position: "relative", overflow: "hidden", textAlign: "center" }}>
      <div className="animate-glow" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 640, height: 400, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(245,184,0,0.07) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div style={{ maxWidth: 660, margin: "0 auto", position: "relative" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(245,184,0,0.7)", marginBottom: 20 }}>
          Get started today
        </div>
        <h2 style={{ fontSize: "clamp(30px, 5vw, 54px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: 20, WebkitFontSmoothing: "antialiased" }}>
          Design your bees.<br /><span className="gold-shimmer">Deploy your hive.</span>
        </h2>
        <p style={{ fontSize: 16, color: "rgba(184,197,214,0.72)", lineHeight: 1.7, marginBottom: 44 }}>
          Launch voice agents, automate conversations and monitor performance from one platform.
        </p>
        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 12 }}>
          <Link to="/login" search={{ redirect: "/dashboard" }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 36px", borderRadius: 999, background: "#F5B800", color: "#06162B", fontSize: 15, fontWeight: 800, textDecoration: "none", boxShadow: "0 0 0 1px rgba(245,184,0,0.3), 0 12px 40px rgba(245,184,0,0.3)", letterSpacing: "-0.01em" }}
            className="hover:opacity-90 transition-opacity"
          >
            Get Started Free <ArrowRight size={15} />
          </Link>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 32px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.85)", fontSize: 15, fontWeight: 600, textDecoration: "none", letterSpacing: "-0.01em" }}
            className="hover:bg-white/[0.05] transition-colors"
          >
            Book a Demo
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ─────────────────────────────────────────────────── */
function Footer() {
  const cols = [
    { heading: "Platform", links: ["Builder", "Voice Agents", "Smart Dash", "API Docs"] },
    { heading: "Solutions", links: ["Healthcare", "Property", "Automotive", "Trades"] },
    { heading: "Company",  links: ["About", "Contact", "Partners", "Careers"] },
    { heading: "Legal",    links: ["Privacy Policy", "Terms of Service", "Security", "Compliance"] },
  ];
  return (
    <footer style={{ background: "#050e1e", borderTop: "1px solid rgba(255,255,255,0.05)", padding: "60px 24px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(4, 1fr)", gap: 40, marginBottom: 48 }} className="flex flex-wrap gap-8">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
              <img src={logoWebee} alt="WEBEE" style={{ height: 30, width: 30, borderRadius: 8, objectFit: "cover" }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#fff", letterSpacing: "-0.01em" }}>
                  WEBEE <span style={{ color: "#F5B800" }}>Builder</span>
                </div>
                <div style={{ fontSize: 8.5, color: "rgba(184,197,214,0.5)", letterSpacing: "0.1em", textTransform: "uppercase" }}>by Webespoke AI</div>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: "rgba(184,197,214,0.6)", lineHeight: 1.7, maxWidth: 200 }}>
              The complete AI voice agent platform. Build, deploy and manage intelligent agents from one place.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {["li", "tw", "yt"].map(s => (
                <a key={s} href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
                  style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(184,197,214,0.55)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", textDecoration: "none" }}
                  className="hover:border-white/25 hover:text-white transition-colors"
                >
                  {s}
                </a>
              ))}
            </div>
          </div>
          {cols.map(col => (
            <div key={col.heading}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#fff", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 14, opacity: 0.9 }}>{col.heading}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map(l => (
                  <a key={l} href="#" style={{ fontSize: 12.5, color: "rgba(184,197,214,0.55)", textDecoration: "none", transition: "color 0.2s" }} className="hover:text-white">{l}</a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 22, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11.5, color: "rgba(184,197,214,0.45)" }}>© {new Date().getFullYear()} Webespoke AI Ltd. All rights reserved.</span>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, color: "rgba(184,197,214,0.45)", textDecoration: "none" }} className="hover:text-white transition-colors">
            webespokeai.com
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ─── Page assembly ─────────────────────────────────────────────── */
function Index() {
  return (
    <main style={{ background: "#050e1e", color: "#fff", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      <GlobalStyles />
      <Nav />
      <HeroSection />
      <FeatureGrid />
      <ThreeLayersSection />
      <BuilderSection />
      <VoiceSection />
      <DashSection />
      <SocialProof />
      <EnterpriseSection />
      <CTASection />
      <Footer />
    </main>
  );
}
