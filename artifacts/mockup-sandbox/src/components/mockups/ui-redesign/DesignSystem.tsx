import {
  Phone, Users, Calendar, TrendingUp, BarChart3, Bell, Settings,
  LayoutDashboard, LayoutGrid, Workflow, Database, UserCheck, Check,
  PhoneCall, CalendarDays, CreditCard, MessageSquare, LayoutTemplate,
  Sparkles, ChevronDown, Search, Filter, Plus, ArrowUpRight, Radio
} from "lucide-react";

const NAV = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Analytics", icon: BarChart3 },
  { label: "Agents", icon: LayoutGrid },
  { label: "Builder", icon: Workflow },
  { label: "Templates", icon: LayoutTemplate },
  { label: "Data", icon: Database },
  { label: "Leads", icon: UserCheck },
  { label: "Qualified", icon: Check },
  { label: "Calls", icon: PhoneCall },
  { label: "Calendar", icon: CalendarDays },
  { label: "WhatsApp", icon: MessageSquare },
  { label: "Billing", icon: CreditCard },
];

export function DesignSystem() {
  return (
    <div style={{ background: "#070b0f", minHeight: "100vh", color: "#e2e8f0", fontFamily: "Inter, sans-serif", padding: "32px 40px" }}>

      {/* Title */}
      <div style={{ marginBottom: "36px" }}>
        <div style={{ fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em", color: "#4f8cff", marginBottom: "6px" }}>Design System</div>
        <h1 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 6px", color: "#f1f5f9" }}>Enterprise UI Refresh</h1>
        <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>Key components — sidebar, KPI cards, table toolbar, typography scale</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "32px" }}>

        {/* ── SIDEBAR ── */}
        <div>
          <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#475569", marginBottom: "10px" }}>Sidebar</div>
          <div style={{ background: "#0d1117", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", overflow: "hidden" }}>
            {/* Header */}
            <div style={{ padding: "10px 10px 6px" }}>
              <button style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "6px 8px", borderRadius: "8px", background: "transparent", border: "none", cursor: "pointer", color: "#e2e8f0" }}>
                <div style={{ width: "28px", height: "28px", borderRadius: "7px", overflow: "hidden", flexShrink: 0 }}>
                  <img src="/__mockup/images/webee-logo-dark.png" alt="Webee" style={{ width: "28px", height: "28px", objectFit: "cover", display: "block" }} />
                </div>
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.2 }}>Webee</div>
                  <div style={{ fontSize: "10px", color: "#64748b" }}>Admin · Pro</div>
                </div>
                <ChevronDown size={11} color="#64748b" />
              </button>
            </div>
            <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "0 10px" }} />
            <div style={{ padding: "8px 8px" }}>
              <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(100,116,139,0.7)", padding: "0 6px", marginBottom: "4px" }}>Workspace</div>
              {NAV.map((item) => {
                const Icon = item.icon;
                const isActive = item.active;
                return (
                  <div key={item.label} style={{ position: "relative" }}>
                    {isActive && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: "2px", height: "18px", background: "#4f8cff", borderRadius: "0 2px 2px 0" }} />}
                    <button style={{
                      display: "flex", alignItems: "center", gap: "8px", width: "100%",
                      padding: "0 8px", height: "30px", borderRadius: "7px", border: "none", cursor: "pointer",
                      background: isActive ? "rgba(79,140,255,0.08)" : "transparent",
                      color: isActive ? "#e2e8f0" : "#64748b",
                      fontWeight: isActive ? 500 : 400, fontSize: "12px", marginBottom: "1px",
                      boxShadow: isActive ? "inset 0 0 0 1px rgba(79,140,255,0.14)" : "none",
                    }}>
                      <Icon size={13} />
                      {item.label}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>

          {/* KPI Cards */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#475569", marginBottom: "10px" }}>KPI Cards — Compact (64px)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", marginBottom: "10px" }}>
              {[
                { label: "Total Leads", value: "1,284", icon: Users, color: "#4f8cff", delta: "+12%", up: true },
                { label: "Qualified", value: "347", icon: TrendingUp, color: "#10b981", delta: "+8%", up: true },
                { label: "Calls", value: "892", icon: Phone, color: "#f59e0b", delta: "-3%", up: false },
                { label: "Bookings", value: "63", icon: Calendar, color: "#a78bfa", delta: "+21%", up: true },
              ].map((k) => {
                const Icon = k.icon;
                return (
                  <div key={k.label} style={{ background: "#151d2b", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${k.color}15`, border: `1px solid ${k.color}25`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={15} color={k.color} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "2px", fontWeight: 500 }}>{k.label}</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                        <span style={{ fontSize: "20px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</span>
                        <span style={{ fontSize: "11px", color: k.up ? "#10b981" : "#ef4444", fontWeight: 500 }}>{k.delta}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: "11px", color: "#475569", fontStyle: "italic" }}>↑ ~35% shorter than current cards · Metric value is primary focal point · Icon in subtle container</div>
          </div>

          {/* Toolbar pattern */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#475569", marginBottom: "10px" }}>Table Toolbar — Compact (32px controls)</div>
            <div style={{ background: "#151d2b", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ position: "relative", flex: 1, maxWidth: "260px" }}>
                  <Search size={12} style={{ position: "absolute", left: "9px", top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
                  <input placeholder="Search…" style={{ width: "100%", height: "32px", paddingLeft: "28px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: "12px", outline: "none", boxSizing: "border-box" }} />
                </div>
                {["Status", "Agent", "Date range"].map((f) => (
                  <button key={f} style={{ height: "32px", padding: "0 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
                    <Filter size={11} />{f}<ChevronDown size={10} />
                  </button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                  <button style={{ height: "32px", padding: "0 12px", borderRadius: "8px", border: "none", background: "#4f8cff", color: "#fff", fontSize: "12px", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
                    <Plus size={12} /> New
                  </button>
                </div>
              </div>

              {/* Sample table rows */}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    {["Name", "Phone", "Status", "Score", "Agent", "Time"].map((h) => (
                      <th key={h} style={{ padding: "0 14px", height: "32px", textAlign: "left", fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Sarah Johnson", phone: "+44 7700 900123", status: "qualified", statusColor: "#10b981", statusBg: "rgba(16,185,129,0.12)", score: 92, agent: "Receptionist AI", time: "2m ago" },
                    { name: "Marcus Webb", phone: "+44 7700 900456", status: "callback", statusColor: "#f59e0b", statusBg: "rgba(245,158,11,0.12)", score: 74, agent: "Lead Gen Bot", time: "14m ago" },
                    { name: "Priya Sharma", phone: "+44 7700 900789", status: "new", statusColor: "#3b82f6", statusBg: "rgba(59,130,246,0.12)", score: 61, agent: "Receptionist AI", time: "31m ago" },
                  ].map((r, i) => (
                    <tr key={r.name} style={{ borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                      <td style={{ padding: "0 14px", height: "44px", fontSize: "13px", fontWeight: 500, color: "#e2e8f0" }}>{r.name}</td>
                      <td style={{ padding: "0 14px", fontSize: "12px", color: "#64748b", fontFamily: "monospace" }}>{r.phone}</td>
                      <td style={{ padding: "0 14px" }}>
                        <span style={{ background: r.statusBg, color: r.statusColor, fontSize: "11px", padding: "2px 8px", borderRadius: "5px", fontWeight: 500 }}>{r.status}</span>
                      </td>
                      <td style={{ padding: "0 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <div style={{ width: "44px", height: "3px", borderRadius: "2px", background: "rgba(255,255,255,0.08)" }}>
                            <div style={{ width: `${r.score}%`, height: "100%", background: r.score >= 80 ? "#10b981" : "#f59e0b", borderRadius: "2px" }} />
                          </div>
                          <span style={{ fontSize: "12px", color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{r.score}</span>
                        </div>
                      </td>
                      <td style={{ padding: "0 14px", fontSize: "12px", color: "#64748b" }}>{r.agent}</td>
                      <td style={{ padding: "0 14px", fontSize: "12px", color: "#475569" }}>{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: "11px", color: "#475569", fontStyle: "italic", marginTop: "8px" }}>↑ 44px row height · Compact toolbar (32px) · Status pills with semantic colour · Mini score bars</div>
          </div>

          {/* Typography scale */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#475569", marginBottom: "10px" }}>Typography Scale</div>
            <div style={{ background: "#151d2b", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {[
                { label: "24px · Page Title", style: { fontSize: "24px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }, text: "Dashboard" },
                { label: "20px · Section Header", style: { fontSize: "20px", fontWeight: 600, color: "#f1f5f9" }, text: "Recent Leads" },
                { label: "16px · Body", style: { fontSize: "16px", color: "#cbd5e1" }, text: "Your AI receptionist handled 892 calls this month." },
                { label: "14px · Table content", style: { fontSize: "14px", color: "#94a3b8" }, text: "Sarah Johnson · +44 7700 900123" },
                { label: "12px · Metadata / Labels", style: { fontSize: "12px", color: "#64748b" }, text: "Last active 2m ago · Lead Gen Bot" },
                { label: "10–11px · Uppercase labels", style: { fontSize: "10px", fontWeight: 500, textTransform: "uppercase" as const, letterSpacing: "0.1em", color: "#475569" }, text: "Status · Agent · Time" },
              ].map((t) => (
                <div key={t.label} style={{ display: "flex", alignItems: "baseline", gap: "16px" }}>
                  <span style={{ fontSize: "10px", color: "#334155", fontVariantNumeric: "tabular-nums", minWidth: "170px", flexShrink: 0 }}>{t.label}</span>
                  <span style={t.style}>{t.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Button + Badge variants */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#475569", marginBottom: "10px" }}>Controls — 32px / 36px heights · 8–10px radius</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <button style={{ height: "36px", padding: "0 16px", borderRadius: "10px", border: "none", background: "#4f8cff", color: "#fff", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>Primary</button>
              <button style={{ height: "36px", padding: "0 16px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#e2e8f0", fontSize: "13px", cursor: "pointer" }}>Secondary</button>
              <button style={{ height: "32px", padding: "0 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: "12px", cursor: "pointer" }}>Small</button>
              <button style={{ height: "32px", padding: "0 12px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444", fontSize: "12px", cursor: "pointer" }}>Destructive</button>
              <div style={{ width: "1px", height: "28px", background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
              {[
                { label: "qualified", bg: "rgba(16,185,129,0.12)", color: "#10b981" },
                { label: "callback", bg: "rgba(245,158,11,0.12)", color: "#f59e0b" },
                { label: "new", bg: "rgba(59,130,246,0.12)", color: "#3b82f6" },
                { label: "failed", bg: "rgba(239,68,68,0.12)", color: "#ef4444" },
                { label: "voicemail", bg: "rgba(139,92,246,0.12)", color: "#a78bfa" },
              ].map((b) => (
                <span key={b.label} style={{ background: b.bg, color: b.color, fontSize: "11px", padding: "3px 9px", borderRadius: "5px", fontWeight: 500 }}>{b.label}</span>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
