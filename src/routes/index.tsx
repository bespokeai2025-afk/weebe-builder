import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Check, Play, Workflow, LayoutDashboard,
  Phone, Users, Zap, BarChart3, Shield, Globe,
  Bot, Calendar, TrendingUp, ChevronRight,
  Building2, Lock, Key, FileText, Headphones,
  Activity, PhoneCall, Target, DollarSign, Star,
  CheckCircle2, MessageSquare, Layers, Menu, X
} from "lucide-react";
import logoWebee from "@/assets/webee-logo-yellow.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Webee — Build, Deploy & Manage AI Voice Agents" },
      { name: "description", content: "Create AI receptionists, sales agents, support teams and lead generators without code. Monitor conversations, performance and bookings in real time." },
      { property: "og:title", content: "Webee — AI Voice Agent Platform by Webespoke AI" },
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
        50% { transform: translateY(-14px); }
      }
      @keyframes glow-pulse {
        0%, 100% { opacity: 0.35; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(1.08); }
      }
      @keyframes fade-up {
        from { opacity: 0; transform: translateY(28px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes slide-in-right {
        from { opacity: 0; transform: translateX(40px); }
        to   { opacity: 1; transform: translateX(0); }
      }
      @keyframes shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
      .animate-float     { animation: float 5s ease-in-out infinite; }
      .animate-glow      { animation: glow-pulse 4s ease-in-out infinite; }
      .animate-fade-up   { animation: fade-up 0.7s ease both; }
      .animate-slide-right { animation: slide-in-right 0.8s ease both; }
      .delay-100 { animation-delay: 0.1s; }
      .delay-200 { animation-delay: 0.2s; }
      .delay-300 { animation-delay: 0.3s; }
      .delay-400 { animation-delay: 0.4s; }
      .delay-500 { animation-delay: 0.5s; }
      .delay-600 { animation-delay: 0.6s; }
      .glass {
        background: rgba(16, 42, 76, 0.45);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.08);
      }
      .glass-light {
        background: rgba(45, 140, 255, 0.06);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(45, 140, 255, 0.15);
      }
      .gold-shimmer {
        background: linear-gradient(90deg, #F5B800 0%, #FFD94A 40%, #F5B800 80%);
        background-size: 200% auto;
        animation: shimmer 3s linear infinite;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .nav-link:hover { color: #fff; }
      .section-reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
      .section-reveal.visible { opacity: 1; transform: translateY(0); }
      .card-hover { transition: transform 0.25s ease, box-shadow 0.25s ease; }
      .card-hover:hover { transform: translateY(-5px); box-shadow: 0 24px 60px rgba(45,140,255,0.18); }
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
    }, { threshold: 0.12 });
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
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav style={{
      position: "sticky", top: 0, zIndex: 100,
      background: scrolled ? "rgba(6,22,43,0.95)" : "rgba(6,22,43,0.8)",
      backdropFilter: "blur(20px)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
      transition: "background 0.3s ease",
    }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={logoWebee} alt="Webee" style={{ height: 36, width: 36, borderRadius: 10, objectFit: "cover" }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#fff", letterSpacing: "-0.02em" }}>Webee</div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#B8C5D6", marginTop: -1 }}>by Webespoke AI</div>
          </div>
        </div>

        {/* Desktop links */}
        <div style={{ display: "flex", alignItems: "center", gap: 32 }} className="hidden md:flex">
          {["Platform", "Solutions", "Pricing", "Enterprise", "Resources"].map(l => (
            <a key={l} href="#" className="nav-link" style={{ fontSize: 14, color: "#B8C5D6", textDecoration: "none", transition: "color 0.2s" }}>{l}</a>
          ))}
        </div>

        {/* CTAs */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link to="/login" search={{ redirect: "/dashboard" }}
            style={{ display: "none" }}
            className="hidden md:inline-flex"
          >
            <span style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", color: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
              Book Demo
            </span>
          </Link>
          <Link to="/login" search={{ redirect: "/dashboard" }}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 20px", borderRadius: 8, background: "#F5B800", color: "#06162B", fontSize: 13, fontWeight: 700, textDecoration: "none", transition: "opacity 0.2s" }}
            className="hover:opacity-90"
          >
            Start Building <ArrowRight size={13} />
          </Link>
          <button onClick={() => setOpen(!open)} style={{ background: "transparent", border: "none", color: "#B8C5D6", cursor: "pointer" }} className="md:hidden">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {open && (
        <div style={{ background: "#06162B", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 24px" }} className="md:hidden">
          {["Platform", "Solutions", "Pricing", "Enterprise", "Resources"].map(l => (
            <a key={l} href="#" style={{ display: "block", padding: "10px 0", color: "#B8C5D6", fontSize: 14, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{l}</a>
          ))}
        </div>
      )}
    </nav>
  );
}

/* ─── Hero Section ──────────────────────────────────────────────────── */
function HeroSection() {
  return (
    <section style={{ background: "linear-gradient(135deg, #06162B 0%, #0B2344 60%, #06162B 100%)", padding: "80px 24px 100px", position: "relative", overflow: "hidden" }}>
      {/* Radial glow top */}
      <div className="animate-glow" style={{
        position: "absolute", top: -100, left: "50%", transform: "translateX(-50%)",
        width: 800, height: 500, borderRadius: "50%",
        background: "radial-gradient(ellipse, rgba(45,140,255,0.18) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }} className="flex flex-col lg:grid">
        {/* Left */}
        <div className="animate-fade-up">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 999, background: "rgba(245,184,0,0.1)", border: "1px solid rgba(245,184,0,0.3)", marginBottom: 24 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#F5B800", display: "inline-block", animation: "glow-pulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#F5B800" }}>Powered by Webespoke AI</span>
          </div>

          <h1 style={{ fontSize: "clamp(36px, 5vw, 58px)", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.03em", color: "#fff", marginBottom: 20 }}>
            Build, Deploy & Manage<br />
            <span className="gold-shimmer">AI Voice Agents</span><br />
            From One Platform
          </h1>

          <p style={{ fontSize: 17, color: "#B8C5D6", lineHeight: 1.7, maxWidth: 480, marginBottom: 36 }}>
            Create AI receptionists, sales agents, support teams and lead generators without code.
            Monitor conversations, performance and bookings in real time.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 28 }}>
            <Link to="/login" search={{ redirect: "/dashboard" }}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 28px", borderRadius: 10, background: "#F5B800", color: "#06162B", fontSize: 15, fontWeight: 700, textDecoration: "none", boxShadow: "0 8px 32px rgba(245,184,0,0.35)" }}
              className="hover:opacity-90 transition-opacity"
            >
              Start Building <ArrowRight size={16} />
            </Link>
            <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 28px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", color: "#fff", fontSize: 15, fontWeight: 600, textDecoration: "none" }}
              className="hover:bg-white/5 transition-colors"
            >
              <Play size={15} fill="currentColor" /> Watch Demo
            </a>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
            {["No Code", "24/7 Automation", "Voice + SMS", "Real-Time Analytics"].map(t => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={14} color="#2D8CFF" />
                <span style={{ fontSize: 13, color: "#B8C5D6", fontWeight: 500 }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right — stacked product mockups */}
        <div className="animate-slide-right delay-200" style={{ position: "relative", height: 520 }}>
          {/* Blue glow behind */}
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
            width: 420, height: 420, borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(45,140,255,0.22) 0%, transparent 65%)",
            pointerEvents: "none",
          }} className="animate-glow" />

          {/* Main dashboard card */}
          <div className="animate-float" style={{
            position: "absolute", top: 40, left: "50%", transform: "translateX(-50%)",
            width: 360, background: "#0B2344", borderRadius: 16,
            border: "1px solid rgba(45,140,255,0.25)",
            boxShadow: "0 24px 80px rgba(6,22,43,0.8), 0 0 40px rgba(45,140,255,0.15)",
            overflow: "hidden", zIndex: 3,
          }}>
            {/* Browser chrome */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#06162B" }}>
              {["#F87171","#FBBF24","#34D399"].map(c => <span key={c} style={{ width: 9, height: 9, borderRadius: "50%", background: c, display: "inline-block" }} />)}
              <span style={{ fontSize: 10, color: "#B8C5D6", marginLeft: 6 }}>Smart Dash · Live</span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: "#F5B800", display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F5B800", display: "inline-block", animation: "glow-pulse 2s infinite" }} />
                3 agents live
              </span>
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ fontSize: 10, color: "#B8C5D6", marginBottom: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>Overview</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  { l: "Calls", v: "1,284", c: "#2D8CFF" },
                  { l: "Qualified", v: "347", c: "#34D399" },
                  { l: "Booked", v: "89", c: "#F5B800" },
                ].map(k => (
                  <div key={k.l} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 8, color: "#B8C5D6", textTransform: "uppercase", letterSpacing: "0.1em" }}>{k.l}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: k.c, marginTop: 2 }}>{k.v}</div>
                  </div>
                ))}
              </div>
              {[
                { name: "Emma Thompson", status: "Qualified", score: 92, sc: "#34D399" },
                { name: "James Miller",  status: "Booked",    score: 87, sc: "#F5B800" },
                { name: "Sarah Chen",    status: "Active",    score: 74, sc: "#2D8CFF" },
              ].map(r => (
                <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 10, color: "#fff", flex: 1 }}>{r.name}</span>
                  <span style={{ fontSize: 9, color: r.sc, background: `${r.sc}18`, padding: "2px 6px", borderRadius: 4 }}>{r.status}</span>
                  <div style={{ width: 50, height: 3, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
                    <div style={{ height: "100%", borderRadius: 3, background: r.sc, width: `${r.score}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Builder mini card — floating top-left */}
          <div style={{
            position: "absolute", top: 10, left: 0, width: 170,
            background: "#102A4C", borderRadius: 12,
            border: "1px solid rgba(245,184,0,0.2)",
            boxShadow: "0 16px 48px rgba(6,22,43,0.7)",
            padding: "10px 12px", zIndex: 4,
            animation: "float 6s ease-in-out infinite",
          }}>
            <div style={{ fontSize: 9, color: "#F5B800", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>AI Builder</div>
            {[
              { label: "Welcome Node", c: "#2D8CFF" },
              { label: "Check Availability", c: "#8B5CF6" },
              { label: "Book Appointment", c: "#34D399" },
            ].map((n, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: 2, background: n.c, flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "#B8C5D6" }}>{n.label}</span>
              </div>
            ))}
            <div style={{ marginTop: 8, padding: "4px 8px", background: "rgba(45,140,255,0.12)", borderRadius: 6, fontSize: 9, color: "#2D8CFF", textAlign: "center" }}>
              3 nodes connected
            </div>
          </div>

          {/* Voice call mini card — bottom right */}
          <div style={{
            position: "absolute", bottom: 20, right: 0, width: 165,
            background: "#102A4C", borderRadius: 12,
            border: "1px solid rgba(52,211,153,0.2)",
            boxShadow: "0 16px 48px rgba(6,22,43,0.7)",
            padding: "10px 12px", zIndex: 4,
            animation: "float 7s ease-in-out infinite 1s",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", background: "rgba(52,211,153,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <PhoneCall size={11} color="#34D399" />
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#34D399", fontWeight: 600 }}>LIVE CALL</div>
                <div style={{ fontSize: 8, color: "#B8C5D6" }}>Agent: Rebecca</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
              {[14,6,10,14,6,14,8,14,6,10,14,8].map((h, i) => (
                <div key={i} style={{ flex: 1, height: h, background: "#34D399", borderRadius: 2, opacity: i % 3 === 0 ? 0.9 : i % 3 === 1 ? 0.6 : 0.75 }} />
              ))}
            </div>
            <div style={{ fontSize: 9, color: "#B8C5D6" }}>Duration: 2:34</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Section 2: Three Layers ─────────────────────────────────────── */
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
    <section style={{ background: "#06162B", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#2D8CFF", marginBottom: 14 }}>The Platform</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            One Platform.<br />Three Powerful Layers.
          </h2>
          <p style={{ fontSize: 16, color: "#B8C5D6", marginTop: 16, maxWidth: 500, margin: "16px auto 0" }}>
            Builder, Voice Agents and Smart Dash work together as one integrated ecosystem.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }}>
          {layers.map((l, i) => {
            const Icon = l.icon;
            return (
              <div key={i} className="card-hover glass" style={{ borderRadius: 20, padding: 32, position: "relative", overflow: "hidden" }}>
                {/* Top glow accent */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${l.color}, transparent)` }} />
                <div style={{ width: 48, height: 48, borderRadius: 14, background: l.bg, border: `1px solid ${l.color}30`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
                  <Icon size={22} color={l.color} />
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 10 }}>{l.title}</h3>
                <p style={{ fontSize: 14, color: "#B8C5D6", lineHeight: 1.7, marginBottom: 20 }}>{l.desc}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {l.features.map(f => (
                    <div key={f} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Check size={13} color={l.color} />
                      <span style={{ fontSize: 13, color: "#B8C5D6" }}>{f}</span>
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

/* ─── Section 3: Builder Showcase ─────────────────────────────────── */
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
    <section style={{ background: "linear-gradient(180deg, #06162B 0%, #0B2344 100%)", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }} className="flex flex-col lg:grid">
        <div className="section-reveal" ref={ref}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#F5B800", marginBottom: 14 }}>Webee Builder</div>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: 18 }}>
            Build AI Agents Visually
          </h2>
          <p style={{ fontSize: 16, color: "#B8C5D6", lineHeight: 1.75, marginBottom: 28 }}>
            Design intelligent workflows without writing code. Connect nodes to create complex AI conversation flows in minutes.
          </p>
          {[
            "Drag-and-drop node editor",
            "Conditional logic & branching",
            "Live preview before deploying",
            "Template library to get started fast",
          ].map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, background: "rgba(245,184,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Check size={11} color="#F5B800" />
              </div>
              <span style={{ fontSize: 14, color: "#B8C5D6" }}>{f}</span>
            </div>
          ))}
          <Link to="/login" search={{ redirect: "/builder" }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 24, padding: "12px 24px", borderRadius: 10, background: "#F5B800", color: "#06162B", fontSize: 14, fontWeight: 700, textDecoration: "none" }}
            className="hover:opacity-90 transition-opacity"
          >
            Try the Builder <ChevronRight size={16} />
          </Link>
        </div>

        {/* Workflow diagram */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
          {nodes.map((n, i) => {
            const Icon = n.icon;
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div className="card-hover" style={{
                  width: 280, padding: "14px 18px", borderRadius: 14,
                  background: "#102A4C", border: `1px solid ${n.color}30`,
                  boxShadow: `0 4px 24px rgba(0,0,0,0.3), 0 0 20px ${n.color}18`,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: n.bg, border: `1px solid ${n.color}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={16} color={n.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: n.color, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2 }}>
                      {i === 0 ? "Trigger" : i === nodes.length - 1 ? "Output" : "Action"}
                    </div>
                    <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{n.label}</div>
                  </div>
                  <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: n.color, boxShadow: `0 0 8px ${n.color}` }} />
                </div>
                {i < nodes.length - 1 && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, padding: "4px 0" }}>
                    <div style={{ width: 2, height: 12, background: `linear-gradient(180deg, ${n.color}60, ${nodes[i+1].color}60)`, borderRadius: 1 }} />
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: nodes[i+1].color, margin: "1px 0", boxShadow: `0 0 6px ${nodes[i+1].color}` }} />
                    <div style={{ width: 2, height: 12, background: `linear-gradient(180deg, ${nodes[i+1].color}60, ${nodes[i+1].color}20)`, borderRadius: 1 }} />
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

/* ─── Section 4: Voice Agents ─────────────────────────────────────── */
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
    <section style={{ background: "#06162B", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 80, alignItems: "center" }} className="flex flex-col-reverse lg:grid">
        {/* Conversation UI */}
        <div>
          <div className="glass" style={{ borderRadius: 20, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#06162B", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(52,211,153,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Bot size={15} color="#34D399" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#fff", fontWeight: 600 }}>Rebecca — AI Agent</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34D399", display: "inline-block", animation: "glow-pulse 2s infinite" }} />
                  <span style={{ fontSize: 10, color: "#34D399" }}>Live call</span>
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
                {[12,7,18,10,16,8,14,11].map((h, i) => (
                  <div key={i} style={{ width: 3, borderRadius: 2, background: "#34D399", opacity: i % 2 === 0 ? 0.9 : 0.55, height: h }} />
                ))}
              </div>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.from === "agent" ? "flex-start" : "flex-end" }}>
                  <div style={{
                    maxWidth: "80%", padding: "9px 13px", borderRadius: m.from === "agent" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                    background: m.from === "agent" ? "rgba(45,140,255,0.1)" : "rgba(245,184,0,0.1)",
                    border: `1px solid ${m.from === "agent" ? "rgba(45,140,255,0.2)" : "rgba(245,184,0,0.2)"}`,
                    fontSize: 12, color: "#E2E8F0", lineHeight: 1.6,
                  }}>
                    {m.text}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 4, paddingTop: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#2D8CFF", animation: "blink 1s infinite" }} />
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#2D8CFF", animation: "blink 1s infinite 0.2s" }} />
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#2D8CFF", animation: "blink 1s infinite 0.4s" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="section-reveal" ref={ref}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#2D8CFF", marginBottom: 14 }}>Voice Agents</div>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: 18 }}>
            AI Agents That Never Miss A Call
          </h2>
          <p style={{ fontSize: 16, color: "#B8C5D6", lineHeight: 1.75, marginBottom: 28 }}>
            Deploy voice agents that handle real conversations — booking appointments, qualifying leads and integrating with your CRM automatically.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {features.map(f => {
              const Icon = f.icon;
              return (
                <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "rgba(45,140,255,0.06)", border: "1px solid rgba(45,140,255,0.12)" }}>
                  <Icon size={14} color="#2D8CFF" />
                  <span style={{ fontSize: 13, color: "#B8C5D6" }}>{f.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Section 5: Smart Dash ───────────────────────────────────────── */
function DashSection() {
  const ref = useReveal();
  const cards = [
    { label: "Calls Handled",    value: "12,847", delta: "+18%", icon: PhoneCall,   color: "#2D8CFF" },
    { label: "Qualified Leads",  value: "3,291",  delta: "+24%", icon: Target,      color: "#F5B800" },
    { label: "Bookings Made",    value: "891",    delta: "+31%", icon: Calendar,    color: "#34D399" },
    { label: "Revenue Tracked",  value: "£94k",   delta: "+12%", icon: DollarSign,  color: "#8B5CF6" },
    { label: "Conversion Rate",  value: "28.4%",  delta: "+4%",  icon: TrendingUp,  color: "#F87171" },
    { label: "Agent Uptime",     value: "99.9%",  delta: "stable",icon: Activity,   color: "#34D399" },
  ];

  return (
    <section style={{ background: "linear-gradient(180deg, #0B2344 0%, #06162B 100%)", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#34D399", marginBottom: 14 }}>Smart Dash</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            Every Conversation.<br />Every Booking.<br />One Dashboard.
          </h2>
          <p style={{ fontSize: 16, color: "#B8C5D6", marginTop: 16, maxWidth: 480, margin: "16px auto 0" }}>
            Get unified visibility across all your AI agents, calls and conversions in real time.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
          {cards.map((c, i) => {
            const Icon = c.icon;
            return (
              <div key={i} className="card-hover glass" style={{ borderRadius: 16, padding: 24, position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${c.color}80, transparent)` }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${c.color}14`, border: `1px solid ${c.color}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={16} color={c.color} />
                  </div>
                  <span style={{ fontSize: 11, color: "#34D399", fontWeight: 600, background: "rgba(52,211,153,0.1)", padding: "3px 8px", borderRadius: 6 }}>{c.delta}</span>
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{c.value}</div>
                <div style={{ fontSize: 12, color: "#B8C5D6", marginTop: 4 }}>{c.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─── Section 6: Social Proof ─────────────────────────────────────── */
function SocialProof() {
  const ref = useReveal();
  const stats = [
    { value: "500K+",  label: "Calls Handled",       icon: PhoneCall  },
    { value: "89%",    label: "Qualification Rate",   icon: Target     },
    { value: "24/7",   label: "Availability",         icon: Zap        },
    { value: "10x",    label: "Faster Response Times",icon: TrendingUp },
  ];
  return (
    <section style={{ background: "#06162B", padding: "100px 24px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 56 }}>
          <h2 style={{ fontSize: "clamp(26px, 3.5vw, 40px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>
            Trusted By Growing Businesses
          </h2>
          <p style={{ fontSize: 15, color: "#B8C5D6", marginTop: 12 }}>Real results from real deployments across multiple industries.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 24, marginBottom: 60 }}>
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="glass" style={{ borderRadius: 20, padding: "32px 24px", textAlign: "center" }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(45,140,255,0.1)", border: "1px solid rgba(45,140,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                  <Icon size={20} color="#2D8CFF" />
                </div>
                <div style={{ fontSize: 42, fontWeight: 900, color: "#F5B800", letterSpacing: "-0.04em" }}>{s.value}</div>
                <div style={{ fontSize: 13, color: "#B8C5D6", marginTop: 6 }}>{s.label}</div>
              </div>
            );
          })}
        </div>
        {/* Logo row placeholder */}
        <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap", opacity: 0.4 }}>
          {["Healthcare", "Property", "Automotive", "Finance", "Retail", "Trades"].map(l => (
            <div key={l} style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", fontSize: 12, color: "#B8C5D6", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Section 7: Enterprise ───────────────────────────────────────── */
function EnterpriseSection() {
  const ref = useReveal();
  const features = [
    { icon: Layers,    label: "Multi-Agent Management",  desc: "Manage unlimited agents from a single workspace." },
    { icon: Users,     label: "Team Permissions",        desc: "Role-based access control for your entire team." },
    { icon: Globe,     label: "White Label Options",     desc: "Fully branded platform for your clients." },
    { icon: Key,       label: "API Access",              desc: "Connect your existing stack via REST API." },
    { icon: Shield,    label: "Enterprise Security",     desc: "SOC2-ready infrastructure and data encryption." },
    { icon: FileText,  label: "Advanced Reporting",      desc: "Custom dashboards and data exports on demand." },
  ];
  return (
    <section style={{ background: "linear-gradient(135deg, #0B2344 0%, #06162B 100%)", padding: "100px 24px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div className="section-reveal" ref={ref} style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#2D8CFF", marginBottom: 14 }}>Enterprise</div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>
            Built For Teams That Scale
          </h2>
          <p style={{ fontSize: 16, color: "#B8C5D6", marginTop: 12, maxWidth: 440, margin: "12px auto 0" }}>
            Everything large teams need to deploy, manage and scale AI voice operations confidently.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={i} className="card-hover glass-light" style={{ borderRadius: 16, padding: "24px 22px", display: "flex", gap: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(45,140,255,0.1)", border: "1px solid rgba(45,140,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={18} color="#2D8CFF" />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 5 }}>{f.label}</div>
                  <div style={{ fontSize: 13, color: "#B8C5D6", lineHeight: 1.6 }}>{f.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 48, textAlign: "center" }}>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "13px 28px", borderRadius: 10, border: "1px solid rgba(45,140,255,0.3)", color: "#2D8CFF", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
            className="hover:bg-[#2D8CFF]/10 transition-colors"
          >
            <Building2 size={15} /> Talk to Enterprise Sales
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Section 8: Final CTA ────────────────────────────────────────── */
function CTASection() {
  return (
    <section style={{ background: "#0B2344", padding: "100px 24px", position: "relative", overflow: "hidden", textAlign: "center" }}>
      <div className="animate-glow" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 600, height: 400, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(245,184,0,0.08) 0%, transparent 65%)", pointerEvents: "none" }} />
      <div style={{ maxWidth: 680, margin: "0 auto", position: "relative" }}>
        <h2 style={{ fontSize: "clamp(30px, 5vw, 52px)", fontWeight: 900, color: "#fff", letterSpacing: "-0.04em", lineHeight: 1.08, marginBottom: 20 }}>
          Start Building Your<br /><span className="gold-shimmer">AI Workforce</span> Today
        </h2>
        <p style={{ fontSize: 17, color: "#B8C5D6", lineHeight: 1.7, marginBottom: 40 }}>
          Launch voice agents, automate conversations and monitor performance from one platform.
        </p>
        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 14 }}>
          <Link to="/login" search={{ redirect: "/dashboard" }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "15px 36px", borderRadius: 12, background: "#F5B800", color: "#06162B", fontSize: 16, fontWeight: 800, textDecoration: "none", boxShadow: "0 8px 40px rgba(245,184,0,0.4)" }}
            className="hover:opacity-90 transition-opacity"
          >
            Start Building <ArrowRight size={17} />
          </Link>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "15px 36px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", color: "#fff", fontSize: 16, fontWeight: 600, textDecoration: "none" }}
            className="hover:bg-white/5 transition-colors"
          >
            Book Demo
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ──────────────────────────────────────────────────────── */
function Footer() {
  const cols = [
    { heading: "Platform", links: ["Builder", "Voice Agents", "Smart Dash", "API Docs"] },
    { heading: "Solutions", links: ["Healthcare", "Property", "Automotive", "Trades"] },
    { heading: "Company", links: ["About", "Contact", "Partners", "Careers"] },
    { heading: "Legal", links: ["Privacy Policy", "Terms of Service", "Security", "Compliance"] },
  ];
  return (
    <footer style={{ background: "#06162B", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "60px 24px 32px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(4, 1fr)", gap: 40, marginBottom: 48 }} className="flex flex-wrap gap-8">
          {/* Brand column */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <img src={logoWebee} alt="Webee" style={{ height: 32, width: 32, borderRadius: 8, objectFit: "cover" }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>Webee</div>
                <div style={{ fontSize: 9, color: "#B8C5D6", letterSpacing: "0.1em", textTransform: "uppercase" }}>by Webespoke AI</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#B8C5D6", lineHeight: 1.7, maxWidth: 220 }}>
              The complete AI voice agent platform. Build, deploy and manage intelligent agents from one place.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              {["li", "tw", "yt"].map(s => (
                <a key={s} href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer"
                  style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#B8C5D6", fontSize: 11, fontWeight: 700, textTransform: "uppercase", textDecoration: "none" }}
                  className="hover:border-white/30 hover:text-white transition-colors"
                >
                  {s}
                </a>
              ))}
            </div>
          </div>

          {cols.map(col => (
            <div key={col.heading}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>{col.heading}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map(l => (
                  <a key={l} href="#" style={{ fontSize: 13, color: "#B8C5D6", textDecoration: "none", transition: "color 0.2s" }} className="hover:text-white">{l}</a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 24, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#B8C5D6" }}>© {new Date().getFullYear()} Webespoke AI Ltd. All rights reserved.</span>
          <a href="https://www.webespokeai.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#B8C5D6", textDecoration: "none" }} className="hover:text-white transition-colors">
            webespokeai.com
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────── */
function Index() {
  return (
    <main style={{ background: "#06162B", color: "#fff", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <GlobalStyles />
      <Nav />
      <HeroSection />
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
