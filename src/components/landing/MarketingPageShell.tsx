import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import logoWebee from "@/assets/webee-logo-yellow.png";

export const MK = {
  bg:      "#050e1e",
  surface: "#07132a",
  border:  "rgba(255,255,255,0.07)",
  gold:    "#F5B800",
  text:    "#fff",
  muted:   "rgba(184,197,214,0.72)",
  dim:     "rgba(184,197,214,0.45)",
};

export function MkH2({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ fontSize: 22, fontWeight: 800, color: MK.text, letterSpacing: "-0.02em", margin: "40px 0 14px" }}>
      {children}
    </h2>
  );
}

export function MkP({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 15, color: MK.muted, lineHeight: 1.8, marginBottom: 14 }}>{children}</p>;
}

export function MkList({ items }: { items: ReactNode[] }) {
  return (
    <ul style={{ margin: "0 0 14px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((it, i) => (
        <li key={i} style={{ fontSize: 15, color: MK.muted, lineHeight: 1.7 }}>{it}</li>
      ))}
    </ul>
  );
}

export function MkCardGrid({ cards }: { cards: { title: string; body: string }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, margin: "8px 0 14px" }}>
      {cards.map(c => (
        <div key={c.title} style={{ background: MK.surface, border: `1px solid ${MK.border}`, borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: MK.text, marginBottom: 8 }}>{c.title}</div>
          <div style={{ fontSize: 13.5, color: MK.muted, lineHeight: 1.7 }}>{c.body}</div>
        </div>
      ))}
    </div>
  );
}

export function MarketingPageShell({
  kicker,
  title,
  intro,
  children,
  showCta = true,
}: {
  kicker: string;
  title: string;
  intro?: string;
  children: ReactNode;
  showCta?: boolean;
}) {
  return (
    <main style={{ background: MK.bg, minHeight: "100vh", color: MK.text, fontFamily: "'Inter', system-ui, -apple-system, sans-serif", WebkitFontSmoothing: "antialiased" }}>
      {/* Header */}
      <header style={{ borderBottom: `1px solid ${MK.border}`, padding: "0 24px" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
            <img src={logoWebee} alt="WEBEE" style={{ height: 28, width: 28, borderRadius: 7, objectFit: "cover" }} />
            <span style={{ fontWeight: 800, fontSize: 14, color: MK.text, letterSpacing: "-0.01em" }}>
              WEBEE <span style={{ color: MK.gold }}>Builder</span>
            </span>
          </Link>
          <Link to="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: MK.muted, textDecoration: "none" }} className="hover:text-white transition-colors">
            <ArrowLeft size={14} /> Back to home
          </Link>
        </div>
      </header>

      {/* Body */}
      <article style={{ maxWidth: 880, margin: "0 auto", padding: "64px 24px 80px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(245,184,0,0.75)", marginBottom: 16 }}>
          {kicker}
        </div>
        <h1 style={{ fontSize: "clamp(30px, 5vw, 44px)", fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: 18 }}>
          {title}
        </h1>
        {intro && <p style={{ fontSize: 16.5, color: MK.muted, lineHeight: 1.75, marginBottom: 8, maxWidth: 680 }}>{intro}</p>}
        {children}

        {showCta && (
          <div style={{ marginTop: 56, background: MK.surface, border: `1px solid ${MK.border}`, borderRadius: 16, padding: "32px 28px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Ready to see WEBEE in action?</div>
              <div style={{ fontSize: 13.5, color: MK.muted }}>Launch AI voice agents, automate conversations and monitor performance from one platform.</div>
            </div>
            <Link to="/login" search={{ redirect: "/dashboard" }}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 26px", borderRadius: 999, background: MK.gold, color: "#06162B", fontSize: 14, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap" }}
              className="hover:opacity-90 transition-opacity"
            >
              Get Started Free <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </article>

      {/* Footer strip */}
      <footer style={{ borderTop: `1px solid ${MK.border}`, padding: "22px 24px" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11.5, color: MK.dim }}>© {new Date().getFullYear()} Webespoke AI Ltd. All rights reserved.</span>
          <div style={{ display: "flex", gap: 18 }}>
            <Link to="/privacy" style={{ fontSize: 11.5, color: MK.dim, textDecoration: "none" }} className="hover:text-white transition-colors">Privacy</Link>
            <Link to="/terms" style={{ fontSize: 11.5, color: MK.dim, textDecoration: "none" }} className="hover:text-white transition-colors">Terms</Link>
            <Link to="/contact" style={{ fontSize: 11.5, color: MK.dim, textDecoration: "none" }} className="hover:text-white transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
