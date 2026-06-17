import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  ArrowRight, ChevronRight, Copy, Check, Menu, X,
  Bot, Users, Phone, Calendar, BarChart3, Megaphone,
  Webhook, BookOpen, DollarSign, Zap, Shield, Key,
} from "lucide-react";
import logoWebee from "@/assets/webee-logo-yellow.png";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "WEBEE API Docs — Developer Reference" },
      { name: "description", content: "Complete WEBEE REST API reference. Manage agents, contacts, calls, bookings, campaigns, analytics and billing from your own applications." },
    ],
  }),
  component: DocsPage,
});

/* ── Colour tokens (match homepage) ───────────────────────────────── */
const C = {
  bg:      "#050e1e",
  surface: "#07132a",
  border:  "rgba(255,255,255,0.07)",
  gold:    "#F5B800",
  text:    "#fff",
  muted:   "rgba(184,197,214,0.72)",
  dim:     "rgba(184,197,214,0.45)",
  code:    "#0d1b30",
};

/* ── Method badge colours ─────────────────────────────────────────── */
const METHOD_COLOR: Record<string, { bg: string; text: string }> = {
  GET:    { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa" },
  POST:   { bg: "rgba(34,197,94,0.15)",   text: "#4ade80" },
  PATCH:  { bg: "rgba(245,158,11,0.15)",  text: "#fbbf24" },
  DELETE: { bg: "rgba(239,68,68,0.15)",   text: "#f87171" },
};

/* ── Sidebar sections ─────────────────────────────────────────────── */
const SECTIONS = [
  { id: "overview",        label: "Overview",          icon: BookOpen },
  { id: "authentication",  label: "Authentication",     icon: Key },
  { id: "agents",          label: "Agents",             icon: Bot },
  { id: "leads",           label: "Leads",              icon: Users },
  { id: "contacts",        label: "Contacts",           icon: Users },
  { id: "calls",           label: "Calls",              icon: Phone },
  { id: "bookings",        label: "Bookings",           icon: Calendar },
  { id: "campaigns",       label: "Campaigns",          icon: Megaphone },
  { id: "analytics",       label: "Analytics",          icon: BarChart3 },
  { id: "billing",         label: "Billing & Costs",    icon: DollarSign },
  { id: "knowledge",       label: "Knowledge",          icon: BookOpen },
  { id: "webhooks",        label: "Webhooks",           icon: Webhook },
  { id: "errors",          label: "Errors",             icon: Shield },
];

const API_BASE = "https://app.webespokeai.com/api/v1";

/* ── Copy button ──────────────────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      style={{ position: "absolute", top: 10, right: 10, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "4px 8px", color: C.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}
    >
      {copied ? <Check size={11} color={C.gold} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ── Code block ───────────────────────────────────────────────────── */
function Code({ children, label }: { children: string; label?: string }) {
  return (
    <div style={{ position: "relative", marginTop: 12 }}>
      {label && <div style={{ fontSize: 10, fontWeight: 600, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>}
      <div style={{ position: "relative", background: "#020b18", border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 44px 16px 18px", overflowX: "auto" }}>
        <pre style={{ margin: 0, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 12.5, lineHeight: 1.7, color: "#c9d6e8", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {children}
        </pre>
        <CopyBtn text={children} />
      </div>
    </div>
  );
}

/* ── Endpoint card ────────────────────────────────────────────────── */
function EndpointCard({ method, path, perm, desc, example, params }: {
  method: string; path: string; perm: string; desc: string; example: string;
  params?: { name: string; type: string; required?: boolean; desc: string }[];
}) {
  const [open, setOpen] = useState(false);
  const mc = METHOD_COLOR[method] ?? METHOD_COLOR.GET;
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", background: open ? "#0a1829" : C.surface, border: "none", cursor: "pointer", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}
      >
        <span style={{ background: mc.bg, color: mc.text, fontFamily: "monospace", fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 5, minWidth: 52, textAlign: "center", flexShrink: 0 }}>{method}</span>
        <code style={{ color: "#e2e8f0", fontSize: 13.5, fontFamily: "'JetBrains Mono', monospace", flex: 1 }}>{path}</code>
        <span style={{ fontSize: 10, color: C.gold, background: "rgba(245,184,0,0.1)", border: "1px solid rgba(245,184,0,0.2)", borderRadius: 4, padding: "2px 8px", flexShrink: 0 }}>{perm}</span>
        <ChevronRight size={14} color={C.dim} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ padding: "0 18px 20px", background: "#0a1829", borderTop: `1px solid ${C.border}` }}>
          <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.7, marginTop: 14, marginBottom: 0 }}>{desc}</p>

          {params && params.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Parameters</div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                {params.map((p, i) => (
                  <div key={p.name} style={{ display: "grid", gridTemplateColumns: "150px 70px 1fr", gap: 12, padding: "10px 14px", borderBottom: i < params.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "start" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <code style={{ color: "#93c5fd", fontSize: 12.5 }}>{p.name}</code>
                      {p.required && <span style={{ fontSize: 9, color: "#f87171", fontWeight: 700 }}>REQ</span>}
                    </div>
                    <code style={{ color: "#a78bfa", fontSize: 11.5 }}>{p.type}</code>
                    <span style={{ color: C.muted, fontSize: 12.5 }}>{p.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Code label="Example request">{example}</Code>
        </div>
      )}
    </div>
  );
}

/* ── Section heading ──────────────────────────────────────────────── */
function SectionHead({ id, icon: Icon, title, subtitle }: { id: string; icon: any; title: string; subtitle: string }) {
  return (
    <div id={id} style={{ scrollMarginTop: 80, paddingTop: 48, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(245,184,0,0.1)", border: "1px solid rgba(245,184,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={15} color={C.gold} />
        </div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: "-0.03em" }}>{title}</h2>
      </div>
      <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.7 }}>{subtitle}</p>
      <div style={{ height: 1, background: C.border, marginTop: 20 }} />
    </div>
  );
}

/* ── Nav ──────────────────────────────────────────────────────────── */
function Nav({ onMenuToggle }: { onMenuToggle: () => void }) {
  return (
    <nav style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, height: 56, background: "rgba(5,14,30,0.92)", backdropFilter: "blur(16px)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 20px", gap: 16 }}>
      <Link to="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", flexShrink: 0 }}>
        <img src={logoWebee} alt="WEBEE" style={{ height: 28, width: 28, borderRadius: 7, objectFit: "cover" }} />
        <span style={{ fontWeight: 800, fontSize: 14, color: "#fff", letterSpacing: "-0.02em" }}>
          WEBEE <span style={{ color: C.gold }}>Builder</span>
        </span>
      </Link>

      <div style={{ width: 1, height: 20, background: C.border, margin: "0 4px" }} />
      <span style={{ fontSize: 12, color: C.dim, fontWeight: 600 }}>API Reference</span>

      <div style={{ flex: 1 }} />

      <Link to="/" style={{ fontSize: 13, color: C.muted, textDecoration: "none", fontWeight: 500 }} className="hidden md:inline">Home</Link>
      <Link to="/login" search={{ redirect: "/dashboard" }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, background: C.gold, color: "#06162B", fontSize: 13, fontWeight: 700, textDecoration: "none" }}
      >
        Launch App <ArrowRight size={11} />
      </Link>

      <button onClick={onMenuToggle} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer", padding: 4, display: "none" }} className="md:hidden">
        <Menu size={18} />
      </button>
    </nav>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────── */
function Sidebar({ active, onNav, mobileOpen, onClose }: { active: string; onNav: (id: string) => void; mobileOpen: boolean; onClose: () => void }) {
  const scroll = (id: string) => {
    onNav(id);
    onClose();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const content = (
    <div style={{ padding: "24px 0" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.14em", textTransform: "uppercase", padding: "0 20px", marginBottom: 12 }}>Getting Started</div>
      {SECTIONS.slice(0, 2).map(s => (
        <SidebarItem key={s.id} section={s} active={active === s.id} onClick={() => scroll(s.id)} />
      ))}
      <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.14em", textTransform: "uppercase", padding: "20px 20px 12px" }}>Endpoints</div>
      {SECTIONS.slice(2, -1).map(s => (
        <SidebarItem key={s.id} section={s} active={active === s.id} onClick={() => scroll(s.id)} />
      ))}
      <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.14em", textTransform: "uppercase", padding: "20px 20px 12px" }}>Reference</div>
      {SECTIONS.slice(-1).map(s => (
        <SidebarItem key={s.id} section={s} active={active === s.id} onClick={() => scroll(s.id)} />
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden md:block" style={{ width: 220, flexShrink: 0, position: "sticky", top: 56, height: "calc(100vh - 56px)", overflowY: "auto", borderRight: `1px solid ${C.border}`, background: C.bg }}>
        {content}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200 }} />
          <div style={{ position: "fixed", top: 0, left: 0, bottom: 0, width: 260, background: C.surface, zIndex: 201, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: 16 }}>
              <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.muted, cursor: "pointer" }}>
                <X size={18} />
              </button>
            </div>
            {content}
          </div>
        </>
      )}
    </>
  );
}

function SidebarItem({ section, active, onClick }: { section: typeof SECTIONS[0]; active: boolean; onClick: () => void }) {
  const Icon = section.icon;
  return (
    <button
      onClick={onClick}
      style={{ width: "100%", background: active ? "rgba(245,184,0,0.07)" : "transparent", border: "none", borderLeft: `2px solid ${active ? C.gold : "transparent"}`, cursor: "pointer", padding: "8px 20px", display: "flex", alignItems: "center", gap: 9, textAlign: "left" }}
    >
      <Icon size={13} color={active ? C.gold : C.dim} />
      <span style={{ fontSize: 13, color: active ? "#fff" : C.muted, fontWeight: active ? 600 : 400 }}>{section.label}</span>
    </button>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */
function DocsPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const ids = SECTIONS.map(s => s.id);
    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(e => { if (e.isIntersecting) setActiveSection(e.target.id); });
      },
      { rootMargin: "-30% 0px -65% 0px" },
    );
    ids.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: "'Inter', system-ui, -apple-system, sans-serif", WebkitFontSmoothing: "antialiased" }}>
      <Nav onMenuToggle={() => setMobileMenu(o => !o)} />

      <div style={{ display: "flex", paddingTop: 56 }}>
        <Sidebar active={activeSection} onNav={setActiveSection} mobileOpen={mobileMenu} onClose={() => setMobileMenu(false)} />

        {/* Content */}
        <main style={{ flex: 1, minWidth: 0, padding: "0 32px 80px", maxWidth: 820 }}>

          {/* ── Overview ─────────────────────────────────────────── */}
          <div id="overview" style={{ scrollMarginTop: 80, paddingTop: 48, marginBottom: 24 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(245,184,0,0.75)", marginBottom: 16 }}>
              <span style={{ width: 20, height: 1, background: "rgba(245,184,0,0.4)", display: "inline-block" }} />
              Developer Reference
              <span style={{ width: 20, height: 1, background: "rgba(245,184,0,0.4)", display: "inline-block" }} />
            </div>
            <h1 style={{ fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.1, margin: "0 0 16px" }}>
              WEBEE API Reference
            </h1>
            <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.75, margin: "0 0 32px", maxWidth: 640 }}>
              The WEBEE REST API gives you programmatic access to agents, contacts, calls, bookings, campaigns, analytics, and billing — all workspace-scoped and secured by API key.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 36 }}>
              {[
                { icon: Zap,    label: "22 endpoints",    sub: "across 8 resource types" },
                { icon: Shield, label: "Bearer auth",      sub: "per-workspace API keys" },
                { icon: BarChart3, label: "60 req / min",  sub: "per key, with Retry-After" },
              ].map(card => (
                <div key={card.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(245,184,0,0.1)", border: "1px solid rgba(245,184,0,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <card.icon size={16} color={C.gold} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{card.label}</div>
                    <div style={{ fontSize: 11.5, color: C.dim }}>{card.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Base URL</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <code style={{ fontFamily: "monospace", fontSize: 13.5, color: "#93c5fd", flex: 1 }}>{API_BASE}</code>
                <CopyBtn text={API_BASE} />
              </div>
            </div>
          </div>

          {/* ── Authentication ───────────────────────────────────── */}
          <SectionHead id="authentication" icon={Key} title="Authentication" subtitle="All requests require a WEBEE API key issued from Settings → Developer API. Keys are workspace-scoped." />

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px", marginBottom: 16 }}>
            <p style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.7, margin: "0 0 12px" }}>
              Pass your key in the <code style={{ color: "#93c5fd" }}>Authorization</code> header on every request:
            </p>
            <Code>Authorization: Bearer wbee_xxxxxxxxxxxxxxxxxxxxxxxx</Code>
          </div>

          <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "14px 18px", marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, color: "#fca5a5", lineHeight: 1.7 }}>
              <strong>Security:</strong> Never expose API keys in client-side code or public repositories. Keys can be rotated or revoked from the Developer API settings at any time.
            </div>
          </div>

          <Code label="Quick start — list your agents">
{`curl "${API_BASE}/agents" \\
  -H "Authorization: Bearer wbee_your_key_here"`}
          </Code>

          {/* ── Agents ───────────────────────────────────────────── */}
          <SectionHead id="agents" icon={Bot} title="Agents" subtitle="List, deploy, test, and archive your WEBEE AI agents." />
          <EndpointCard method="GET" path="/agents" perm="agents:read" desc="Returns all agents in your workspace including their name, voice provider settings, deployment status, and flow configuration." example={`curl "${API_BASE}/agents" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="POST" path="/agents/deploy" perm="agents:deploy" desc="Requests deployment for an agent. Returns the current deployment status. Full deployment (voice provider linking) must be completed in the Builder." params={[
            { name: "agent_id", type: "string", required: true, desc: "UUID of the agent to deploy." },
          ]} example={`curl -X POST "${API_BASE}/agents/deploy" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"agent_id":"<uuid>"}'`} />
          <EndpointCard method="POST" path="/agents/test" perm="calls:trigger" desc="Initiates a live test outbound call from a deployed agent to a given phone number. The agent must already be deployed with a voice provider." params={[
            { name: "agent_id",   type: "string", required: true,  desc: "UUID of the deployed agent." },
            { name: "to_number",  type: "string", required: true,  desc: "Destination in E.164 format (e.g. +15005550001)." },
            { name: "from_number", type: "string", required: false, desc: "Caller ID override. Defaults to the agent's assigned number." },
          ]} example={`curl -X POST "${API_BASE}/agents/test" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"agent_id":"<uuid>","to_number":"+15005550001"}'`} />
          <EndpointCard method="POST" path="/agents/archive" perm="agents:archive" desc="Soft-archives an agent (sets archived: true). The agent remains in the database but will be hidden from active lists. Reversible from the Builder." params={[
            { name: "agent_id", type: "string", required: true, desc: "UUID of the agent to archive." },
          ]} example={`curl -X POST "${API_BASE}/agents/archive" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"agent_id":"<uuid>"}'`} />

          {/* ── Leads ───────────────────────────────────────────── */}
          <SectionHead id="leads" icon={Users} title="Leads" subtitle="Create and list leads in your CRM pipeline." />
          <EndpointCard method="GET" path="/leads" perm="leads:read" desc="Returns a paginated list of leads. Supports filtering by status and full-text search." params={[
            { name: "limit",  type: "number",  desc: "Max results (1–200, default 50)." },
            { name: "offset", type: "number",  desc: "Pagination offset." },
            { name: "status", type: "string",  desc: "Filter: new | qualified | converted | lost" },
          ]} example={`curl "${API_BASE}/leads?limit=20&status=new" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="POST" path="/leads" perm="leads:write" desc="Creates a new lead in your workspace pipeline." params={[
            { name: "full_name",  type: "string",   desc: "Contact full name." },
            { name: "phone",      type: "string",   desc: "E.164 phone number." },
            { name: "email",      type: "string",   desc: "Email address." },
            { name: "source",     type: "string",   desc: "Lead source label (e.g. crm, website). Defaults to api." },
            { name: "tags",       type: "string[]", desc: "Array of string tags." },
          ]} example={`curl -X POST "${API_BASE}/leads" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"full_name":"Jane Smith","phone":"+15005550001","email":"jane@acme.com","source":"crm"}'`} />

          {/* ── Contacts ─────────────────────────────────────────── */}
          <SectionHead id="contacts" icon={Users} title="Contacts" subtitle="Full CRUD for contacts — search, create, and update with pipeline stage tracking." />
          <EndpointCard method="GET" path="/contacts" perm="contacts:read" desc="Returns a paginated, searchable list of contacts." params={[
            { name: "limit",  type: "number", desc: "Max results (1–200, default 50)." },
            { name: "offset", type: "number", desc: "Pagination offset." },
            { name: "q",      type: "string", desc: "Full-text search across name, email, phone." },
            { name: "tag",    type: "string", desc: "Filter by a single tag value." },
          ]} example={`curl "${API_BASE}/contacts?q=Jane&limit=20" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="POST" path="/contacts" perm="contacts:write" desc="Creates a new contact." params={[
            { name: "full_name",      type: "string",   desc: "Contact full name." },
            { name: "phone",          type: "string",   desc: "E.164 phone number." },
            { name: "email",          type: "string",   desc: "Email address." },
            { name: "tags",           type: "string[]", desc: "Array of tag strings." },
            { name: "pipeline_stage", type: "string",   desc: "Stage name (e.g. Discovery)." },
          ]} example={`curl -X POST "${API_BASE}/contacts" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"full_name":"Jane Smith","phone":"+15005550001","tags":["vip"]}'`} />
          <EndpointCard method="PATCH" path="/contacts/:id" perm="contacts:write" desc="Updates a contact by ID. Only fields included in the request body are changed." params={[
            { name: "status",         type: "string", desc: "new | qualified | converted | lost" },
            { name: "pipeline_stage", type: "string", desc: "Stage name." },
            { name: "notes",          type: "string", desc: "Free-text notes." },
            { name: "tags",           type: "string[]", desc: "Replaces the full tags array." },
          ]} example={`curl -X PATCH "${API_BASE}/contacts/<id>" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"qualified","pipeline_stage":"Demo Scheduled"}'`} />
          <EndpointCard method="GET" path="/contacts/:id" perm="contacts:read" desc="Retrieves a single contact by ID." example={`curl "${API_BASE}/contacts/<id>" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />

          {/* ── Calls ────────────────────────────────────────────── */}
          <SectionHead id="calls" icon={Phone} title="Calls" subtitle="Trigger outbound calls, list call logs, and pull detailed analytics." />
          <EndpointCard method="POST" path="/calls" perm="calls:trigger" desc="Triggers an AI outbound call from a deployed agent to a phone number. Returns immediately with the call record; status updates arrive via webhooks." params={[
            { name: "agent_id",  type: "string", required: true,  desc: "UUID of the deployed agent." },
            { name: "to_number", type: "string", required: true,  desc: "Destination in E.164 format." },
            { name: "lead_id",   type: "string", required: false, desc: "Associate this call with a lead." },
          ]} example={`curl -X POST "${API_BASE}/calls" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"agent_id":"<uuid>","to_number":"+15005550001"}'`} />
          <EndpointCard method="GET" path="/calls" perm="calls:read" desc="Returns paginated call logs for the workspace." params={[
            { name: "limit",     type: "number", desc: "Max results (1–200, default 50)." },
            { name: "since",     type: "string", desc: "ISO 8601 date — only calls after this date." },
            { name: "status",    type: "string", desc: "Filter by call_status." },
            { name: "direction", type: "string", desc: "inbound | outbound" },
          ]} example={`curl "${API_BASE}/calls?limit=10&direction=outbound" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="GET" path="/calls/analytics" perm="calls:analytics" desc="Returns detailed call metrics: summary totals, daily/weekly time-series, per-agent breakdown, sentiment distribution, and disconnection reasons." params={[
            { name: "days",     type: "number", desc: "Lookback window in days (1–365, default 30)." },
            { name: "bucket",   type: "string", desc: "Time-series bucket: day | week (default day)." },
            { name: "agent_id", type: "string", desc: "Restrict analytics to one agent." },
          ]} example={`curl "${API_BASE}/calls/analytics?days=30&bucket=day" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />

          <EndpointCard method="GET" path="/calls/:id" perm="calls:read"
            desc="Returns the full record for a single call including the post-call AI summary, full transcript, recording URL, sentiment, cost, and associated contact."
            params={[
              { name: "id", type: "string", required: true, desc: "The call UUID." },
            ]}
            example={`curl "${API_BASE}/calls/<id>" \\\n  -H "Authorization: Bearer YOUR_KEY"`}
          />

          {/* ── Call statuses reference ── */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px", marginTop: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>Call Status Values</div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
              {[
                { val: "initiated",   color: "#60a5fa", desc: "Call created and being dialled out." },
                { val: "in_progress", color: "#4ade80", desc: "Agent and caller are connected." },
                { val: "completed",   color: "#4ade80", desc: "Call ended normally. Summary and transcript are available." },
                { val: "ended",       color: "#4ade80", desc: "Alias for completed (used by some voice providers)." },
                { val: "no_answer",   color: "#fbbf24", desc: "Destination did not pick up." },
                { val: "busy",        color: "#fbbf24", desc: "Destination line was busy." },
                { val: "cancelled",   color: "#fbbf24", desc: "Call was cancelled before it connected." },
                { val: "failed",      color: "#f87171", desc: "Provider-level failure (bad number, network error, etc.)." },
                { val: "error",       color: "#f87171", desc: "Internal system error during call setup." },
              ].map((row, i, arr) => (
                <div key={row.val} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 16, padding: "10px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "center" }}>
                  <code style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color }}>{row.val}</code>
                  <span style={{ fontSize: 12.5, color: C.muted }}>{row.desc}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Sentiment Values</div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 20 }}>
              {[
                { val: "positive", color: "#4ade80", desc: "Agent determined the caller was happy, interested, or engaged." },
                { val: "neutral",  color: "#94a3b8", desc: "No strong positive or negative signal detected." },
                { val: "negative", color: "#f87171", desc: "Caller expressed frustration, disinterest, or complaints." },
              ].map((row, i, arr) => (
                <div key={row.val} style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 16, padding: "10px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "center" }}>
                  <code style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: row.color }}>{row.val}</code>
                  <span style={{ fontSize: 12.5, color: C.muted }}>{row.desc}</span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Post-call Summary Fields</div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
              {[
                { field: "summary",              type: "string | null",  desc: "AI-generated narrative summary of the call." },
                { field: "transcript",           type: "string | null",  desc: "Full verbatim transcript (agent + caller turns)." },
                { field: "recording_url",        type: "string | null",  desc: "Signed URL to the call recording audio file." },
                { field: "sentiment",            type: "string | null",  desc: "Detected caller sentiment: positive | neutral | negative." },
                { field: "call_outcome",         type: "string | null",  desc: "Outcome label set by the agent flow (e.g. booked, callback_requested)." },
                { field: "disconnection_reason", type: "string | null",  desc: "Why the call ended (e.g. agent_hangup, user_hangup, dial_failed)." },
                { field: "duration_seconds",     type: "number | null",  desc: "Total talk time in seconds." },
                { field: "cost_usd",             type: "number | null",  desc: "Provider cost for this call in USD." },
              ].map((row, i, arr) => (
                <div key={row.field} style={{ display: "grid", gridTemplateColumns: "190px 120px 1fr", gap: 12, padding: "10px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "start" }}>
                  <code style={{ fontFamily: "monospace", fontSize: 12, color: "#93c5fd" }}>{row.field}</code>
                  <code style={{ fontFamily: "monospace", fontSize: 11, color: "#a78bfa" }}>{row.type}</code>
                  <span style={{ fontSize: 12.5, color: C.muted }}>{row.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Bookings ─────────────────────────────────────────── */}
          <SectionHead id="bookings" icon={Calendar} title="Bookings" subtitle="Create and manage calendar bookings captured by your agents." />
          <EndpointCard method="GET" path="/bookings" perm="bookings:read" desc="Returns a paginated list of bookings, optionally filtered by status or date range." params={[
            { name: "status", type: "string", desc: "confirmed | cancelled | pending" },
            { name: "since",  type: "string", desc: "ISO 8601 start date." },
            { name: "until",  type: "string", desc: "ISO 8601 end date." },
            { name: "limit",  type: "number", desc: "Max results (1–200, default 50)." },
          ]} example={`curl "${API_BASE}/bookings?status=confirmed&since=2026-06-01" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="POST" path="/bookings" perm="bookings:write" desc="Creates a booking directly via API (without a voice agent interaction)." params={[
            { name: "start_at",       type: "string", required: true,  desc: "ISO 8601 start datetime." },
            { name: "attendee_name",  type: "string", required: false, desc: "Attendee full name." },
            { name: "attendee_email", type: "string", required: false, desc: "Attendee email." },
            { name: "attendee_phone", type: "string", required: false, desc: "Attendee phone (E.164)." },
            { name: "end_at",         type: "string", required: false, desc: "ISO 8601 end datetime." },
            { name: "notes",          type: "string", required: false, desc: "Booking notes." },
            { name: "agent_id",       type: "string", required: false, desc: "Associate with an agent." },
          ]} example={`curl -X POST "${API_BASE}/bookings" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"attendee_name":"Jane Smith","attendee_email":"jane@acme.com","start_at":"2026-07-01T10:00:00Z"}'`} />
          <EndpointCard method="PATCH" path="/bookings/:id" perm="bookings:write" desc="Updates a booking. Setting status to cancelled fires a booking.cancelled webhook." params={[
            { name: "status",   type: "string", desc: "confirmed | cancelled | pending" },
            { name: "start_at", type: "string", desc: "Reschedule: new ISO 8601 start time." },
            { name: "notes",    type: "string", desc: "Updated notes." },
          ]} example={`curl -X PATCH "${API_BASE}/bookings/<id>" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"cancelled"}'`} />

          {/* ── Campaigns ────────────────────────────────────────── */}
          <SectionHead id="campaigns" icon={Megaphone} title="Campaigns" subtitle="Enrol contacts into outbound campaigns and monitor performance metrics." />
          <EndpointCard method="POST" path="/campaigns" perm="campaigns:trigger" desc="Enrols a contact (by lead_id or phone number) into an existing WEBEE campaign." params={[
            { name: "campaign_id", type: "string", required: true,  desc: "UUID of the campaign." },
            { name: "phone",       type: "string", required: false, desc: "E.164 phone — creates a contact if no lead_id." },
            { name: "lead_id",     type: "string", required: false, desc: "Existing lead UUID to enrol." },
            { name: "name",        type: "string", required: false, desc: "Contact name (used if creating new)." },
          ]} example={`curl -X POST "${API_BASE}/campaigns" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"campaign_id":"<uuid>","phone":"+15005550001","name":"Jane Smith"}'`} />
          <EndpointCard method="GET" path="/campaigns/performance" perm="campaigns:read" desc="Returns per-campaign statistics: total enrolled, completed, pending, failed, and completion rate." params={[
            { name: "days",        type: "number", desc: "Lookback window in days (default 30, max 365)." },
            { name: "campaign_id", type: "string", desc: "Restrict to a single campaign." },
            { name: "limit",       type: "number", desc: "Max campaigns to return (default 20, max 100)." },
          ]} example={`curl "${API_BASE}/campaigns/performance?days=30" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />

          {/* ── Analytics ────────────────────────────────────────── */}
          <SectionHead id="analytics" icon={BarChart3} title="Analytics" subtitle="High-level workspace metrics and AI-driven growth recommendations." />
          <EndpointCard method="GET" path="/analytics" perm="analytics:read" desc="Returns an overview of workspace activity for a given period: call totals, lead counts, booking counts, sentiment, and cost." params={[
            { name: "days", type: "number", desc: "Lookback window in days (default 30, max 365)." },
          ]} example={`curl "${API_BASE}/analytics?days=30" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="GET" path="/growthmind/recommendations" perm="growthmind:read" desc="Returns active AI-generated growth recommendations and scored business opportunities from the GrowthMind engine." params={[
            { name: "limit",    type: "number", desc: "Max recommendations (default 20, max 100)." },
            { name: "category", type: "string", desc: "Filter by category (e.g. campaign, funnel)." },
            { name: "priority", type: "string", desc: "Filter by: high | medium | low" },
          ]} example={`curl "${API_BASE}/growthmind/recommendations?priority=high" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />

          {/* ── Billing ──────────────────────────────────────────── */}
          <SectionHead id="billing" icon={DollarSign} title="Billing & Costs" subtitle="Access billing plan details, provider cost breakdowns, call profitability, and usage metrics." />
          <EndpointCard method="GET" path="/billing" perm="billing:read" desc="Returns the workspace billing plan, included resource limits, overage rates, and the last 3 months of aggregated cost history." example={`curl "${API_BASE}/billing" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="GET" path="/costs" perm="billing:read" desc="Returns a provider-level cost breakdown for a specific calendar month, grouped by category (voice, LLM, email, etc.)." params={[
            { name: "month", type: "string", desc: "YYYY-MM (default: current month). E.g. 2026-06" },
          ]} example={`curl "${API_BASE}/costs?month=2026-06" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="GET" path="/profitability" perm="billing:read" desc="Returns per-call profitability records including cost, revenue, profit, and margin percentage." params={[
            { name: "days",     type: "number", desc: "Lookback window in days (default 30, max 365)." },
            { name: "agent_id", type: "string", desc: "Restrict to one agent." },
            { name: "limit",    type: "number", desc: "Max records (default 100, max 500)." },
          ]} example={`curl "${API_BASE}/profitability?days=30" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="GET" path="/provider-usage" perm="billing:read" desc="Returns aggregated request counts, error rates, and costs per AI/telephony provider." params={[
            { name: "days",     type: "number", desc: "Lookback window in days (default 30, max 365)." },
            { name: "category", type: "string", desc: "Filter by: voice | llm | email | video | whatsapp" },
          ]} example={`curl "${API_BASE}/provider-usage?category=voice&days=30" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />

          {/* ── Knowledge ────────────────────────────────────────── */}
          <SectionHead id="knowledge" icon={BookOpen} title="Knowledge" subtitle="Upload documents and text to power your agent's knowledge base." />
          <EndpointCard method="POST" path="/knowledge" perm="knowledge:write" desc="Uploads a knowledge document (plain text or URL) to a WEBEE agent's knowledge base. The content is chunked and indexed for retrieval during conversations." params={[
            { name: "agent_id", type: "string", required: true,  desc: "UUID of the target agent." },
            { name: "title",    type: "string", required: true,  desc: "Document title." },
            { name: "content",  type: "string", required: false, desc: "Plain text content." },
            { name: "url",      type: "string", required: false, desc: "URL to crawl and index." },
          ]} example={`curl -X POST "${API_BASE}/knowledge" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"agent_id":"<uuid>","title":"Company FAQ","content":"Q: What are your hours?\\nA: Monday to Friday, 9am–5pm."}'`} />

          {/* ── Webhooks ─────────────────────────────────────────── */}
          <SectionHead id="webhooks" icon={Webhook} title="Webhooks" subtitle="Subscribe to real-time events. All payloads are signed with HMAC-SHA256." />
          <EndpointCard method="GET" path="/webhooks" perm="webhooks:manage" desc="Lists all webhook subscriptions for the workspace." example={`curl "${API_BASE}/webhooks" \\\n  -H "Authorization: Bearer YOUR_KEY"`} />
          <EndpointCard method="POST" path="/webhooks" perm="webhooks:manage" desc="Creates a webhook subscription. WEBEE will POST signed JSON to target_url when the event fires." params={[
            { name: "name",       type: "string", required: true, desc: "Display name for the webhook." },
            { name: "event_type", type: "string", required: true, desc: "Event to subscribe to (see list below)." },
            { name: "target_url", type: "string", required: true, desc: "HTTPS URL to receive the event payload." },
          ]} example={`curl -X POST "${API_BASE}/webhooks" \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Lead Sync","event_type":"lead.created","target_url":"https://your-app.com/webhooks/webee"}'`} />

          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px", marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>Available Event Types</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
              {["lead.created","lead.updated","call.started","call.completed","call.failed","booking.created","booking.updated","booking.cancelled","campaign.completed","document.uploaded","agent.deployed"].map(e => (
                <code key={e} style={{ fontFamily: "monospace", fontSize: 12, color: "#93c5fd", background: "#020b18", border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px" }}>{e}</code>
              ))}
            </div>
          </div>

          <Code label="Webhook payload shape">
{`{
  "event": "lead.created",
  "workspace_id": "wsp_xxxxxxxxxxxx",
  "timestamp": "2026-06-17T10:00:00.000Z",
  "data": { /* resource object */ }
}`}
          </Code>

          <Code label="Verifying the signature (Node.js)">
{`import crypto from "node:crypto";

function verifyWebeeWebhook(rawBody, signature, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

// Express
app.post("/webhooks/webee", express.raw({ type: "*/*" }), (req, res) => {
  const sig    = req.headers["x-webee-signature"];
  const secret = process.env.WEBEE_WEBHOOK_SECRET;
  if (!verifyWebeeWebhook(req.body.toString(), sig, secret))
    return res.status(403).send("Invalid signature");
  const event = JSON.parse(req.body.toString());
  // handle event.event ...
  res.sendStatus(200);
});`}
          </Code>

          {/* ── Errors ───────────────────────────────────────────── */}
          <SectionHead id="errors" icon={Shield} title="Errors" subtitle="WEBEE uses standard HTTP status codes. All error responses follow the same JSON shape." />

          <Code label="Error response shape">
{`{
  "error": "Agent not found",
  "status": 404
}`}
          </Code>

          <div style={{ marginTop: 20, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
            {[
              { code: "400", label: "Bad Request",    desc: "Missing or invalid parameters." },
              { code: "401", label: "Unauthorized",   desc: "Invalid or missing API key." },
              { code: "403", label: "Forbidden",      desc: "Your key lacks the required permission scope." },
              { code: "404", label: "Not Found",      desc: "The requested resource does not exist in your workspace." },
              { code: "422", label: "Unprocessable",  desc: "Request is valid but cannot be completed (e.g. agent not deployed)." },
              { code: "429", label: "Too Many Requests", desc: "Rate limit exceeded. Check the Retry-After header." },
              { code: "500", label: "Server Error",   desc: "Something went wrong on our end. Contact support." },
            ].map((row, i, arr) => (
              <div key={row.code} style={{ display: "grid", gridTemplateColumns: "70px 140px 1fr", gap: 16, padding: "12px 18px", background: i % 2 === 0 ? C.surface : "transparent", borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "center" }}>
                <code style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: parseInt(row.code) >= 500 ? "#f87171" : parseInt(row.code) >= 400 ? "#fbbf24" : "#4ade80" }}>{row.code}</code>
                <span style={{ fontSize: 12.5, color: "#e2e8f0", fontWeight: 600 }}>{row.label}</span>
                <span style={{ fontSize: 12.5, color: C.muted }}>{row.desc}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div style={{ marginTop: 64, background: "linear-gradient(135deg, rgba(245,184,0,0.08) 0%, rgba(30,60,160,0.12) 100%)", border: `1px solid ${C.border}`, borderRadius: 16, padding: "40px 36px", textAlign: "center" }}>
            <h3 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 10px" }}>Ready to integrate?</h3>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.7, margin: "0 0 24px" }}>Generate your first API key from the Developer API settings inside your workspace.</p>
            <Link to="/login" search={{ redirect: "/settings/developer" }}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 999, background: C.gold, color: "#06162B", fontSize: 14, fontWeight: 800, textDecoration: "none" }}
            >
              Get your API key <ArrowRight size={13} />
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
