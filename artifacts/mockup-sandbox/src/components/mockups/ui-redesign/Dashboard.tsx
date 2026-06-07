import {
  Phone, Users, Calendar, TrendingUp, PhoneCall, Radio,
  LayoutDashboard, BarChart3, LayoutGrid, Workflow, LayoutTemplate,
  Database, UserCheck, Check, CalendarDays, CreditCard, MessageSquare,
  Sparkles, Settings, ArrowUpRight, ChevronRight, RefreshCw
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

const KPI = [
  { label: "Total Leads", value: "1,284", icon: Users, delta: "+12%", up: true },
  { label: "Qualified", value: "347", icon: TrendingUp, delta: "+8%", up: true },
  { label: "Calls Completed", value: "892", icon: Phone, delta: "-3%", up: false },
  { label: "Bookings", value: "63", icon: Calendar, delta: "+21%", up: true },
];

const LEADS = [
  { name: "Sarah Johnson", phone: "+44 7700 900123", status: "qualified", score: 92, time: "2m ago" },
  { name: "Marcus Webb", phone: "+44 7700 900456", status: "callback", score: 74, time: "14m ago" },
  { name: "Priya Sharma", phone: "+44 7700 900789", status: "new", score: 61, time: "31m ago" },
  { name: "Tom Alderton", phone: "+44 7700 900321", status: "qualified", score: 88, time: "1h ago" },
  { name: "Lena Müller", phone: "+44 7700 900654", status: "disqualified", score: 22, time: "2h ago" },
];

const AGENTS = [
  { name: "Receptionist AI", type: "Receptionist", phone: "+44 3300 882011", since: "Jun 1, 2026" },
  { name: "Lead Gen Bot", type: "Lead Generation", phone: "+44 3300 882012", since: "Jun 3, 2026" },
];

function statusBadge(s: string) {
  const map: Record<string, string> = {
    qualified: "bg-emerald-500/15 text-emerald-400",
    callback: "bg-amber-500/15 text-amber-400",
    new: "bg-blue-500/15 text-blue-400",
    disqualified: "bg-red-500/15 text-red-400",
  };
  return map[s] ?? "bg-zinc-700 text-zinc-400";
}

export function Dashboard() {
  return (
    <div style={{ display: "flex", height: "100vh", background: "#0b0f14", color: "#e2e8f0", fontFamily: "Inter, sans-serif", fontSize: "14px", overflow: "hidden" }}>

      {/* ── Sidebar ── */}
      <aside style={{ width: "208px", minWidth: "208px", background: "#0d1117", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", padding: "0" }}>
        {/* Workspace switcher */}
        <div style={{ padding: "10px 10px 6px" }}>
          <button style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "6px 8px", borderRadius: "8px", background: "transparent", border: "none", cursor: "pointer", color: "#e2e8f0" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "7px", background: "linear-gradient(135deg, #4f8cff 0%, #2563eb 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 1px rgba(79,140,255,0.3), 0 4px 12px -4px rgba(79,140,255,0.5)" }}>
              <Sparkles size={13} color="#fff" />
            </div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.2 }}>Webespoke AI</div>
              <div style={{ fontSize: "10px", color: "#64748b" }}>Admin · Pro</div>
            </div>
          </button>
        </div>

        <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "0 10px" }} />

        {/* Nav */}
        <div style={{ padding: "8px 8px", flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(100,116,139,0.7)", padding: "0 6px", marginBottom: "4px" }}>Workspace</div>
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = item.active;
            return (
              <div key={item.label} style={{ position: "relative" }}>
                {isActive && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: "2px", height: "18px", background: "#4f8cff", borderRadius: "0 2px 2px 0" }} />}
                <button style={{
                  display: "flex", alignItems: "center", gap: "8px", width: "100%",
                  padding: "0 8px", height: "32px", borderRadius: "7px", border: "none", cursor: "pointer",
                  background: isActive ? "rgba(79,140,255,0.08)" : "transparent",
                  color: isActive ? "#e2e8f0" : "#64748b",
                  fontWeight: isActive ? 500 : 400, fontSize: "13px",
                  boxShadow: isActive ? "inset 0 0 0 1px rgba(79,140,255,0.14)" : "none",
                  marginBottom: "1px",
                }}>
                  <Icon size={14} />
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "8px 10px" }}>
          <button style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "6px 8px", borderRadius: "7px", background: "transparent", border: "none", cursor: "pointer", color: "#64748b" }}>
            <div style={{ width: "26px", height: "26px", borderRadius: "6px", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 600, color: "#94a3b8" }}>WA</div>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8" }}>workspace@email.com</div>
            </div>
            <Settings size={13} />
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Top bar */}
        <header style={{ height: "44px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", padding: "0 20px", justifyContent: "space-between", background: "rgba(11,15,20,0.8)", backdropFilter: "blur(12px)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#64748b", fontSize: "12px" }}>
            <span>Dashboard</span>
          </div>
          <button style={{ width: "28px", height: "28px", borderRadius: "7px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b" }}>
            <RefreshCw size={12} />
          </button>
        </header>

        <main style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* Page title */}
          <div style={{ marginBottom: "16px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, color: "#f1f5f9" }}>Dashboard</h1>
              <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>Overview of your receptionist activity</p>
            </div>
            <button style={{ display: "flex", alignItems: "center", gap: "6px", padding: "0 12px", height: "32px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: "12px", cursor: "pointer" }}>
              View agents <ArrowUpRight size={12} />
            </button>
          </div>

          {/* Live Agents */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b", marginBottom: "8px" }}>Live Agents</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
              {AGENTS.map((a) => (
                <div key={a.name} style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "10px", padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{a.name}</div>
                      <div style={{ fontSize: "10px", background: "rgba(100,116,139,0.2)", color: "#94a3b8", padding: "1px 6px", borderRadius: "4px", display: "inline-block", marginTop: "2px" }}>{a.type}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <Radio size={11} color="#10b981" style={{ animation: "pulse 2s infinite" }} />
                      <span style={{ fontSize: "11px", color: "#10b981", fontWeight: 500 }}>Live</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#64748b" }}>
                    <PhoneCall size={11} />
                    <span style={{ fontSize: "11px", fontFamily: "monospace" }}>{a.phone}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* KPI Cards — compact enterprise strip */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", marginBottom: "16px" }}>
            {KPI.map((k) => {
              const Icon = k.icon;
              return (
                <div key={k.label} style={{ background: "#151d2b", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "12px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "rgba(79,140,255,0.1)", border: "1px solid rgba(79,140,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={15} color="#4f8cff" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11px", color: "#64748b", marginBottom: "2px", fontWeight: 500 }}>{k.label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontSize: "20px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</span>
                      <span style={{ fontSize: "11px", color: k.up ? "#10b981" : "#ef4444", fontWeight: 500 }}>{k.delta}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent Leads table */}
          <div style={{ background: "#151d2b", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>Recent Leads</span>
              <button style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#4f8cff", background: "none", border: "none", cursor: "pointer" }}>
                View all <ChevronRight size={11} />
              </button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Name", "Phone", "Status", "Score", "Time"].map((h) => (
                    <th key={h} style={{ padding: "0 14px", height: "32px", textAlign: "left", fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LEADS.map((l, i) => (
                  <tr key={l.name} style={{ borderBottom: i < LEADS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                    <td style={{ padding: "0 14px", height: "44px", fontSize: "13px", fontWeight: 500, color: "#e2e8f0" }}>{l.name}</td>
                    <td style={{ padding: "0 14px", fontSize: "12px", color: "#64748b", fontFamily: "monospace" }}>{l.phone}</td>
                    <td style={{ padding: "0 14px" }}>
                      <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "5px" }} className={statusBadge(l.status)}>
                        <span style={{ background: l.status === "qualified" ? "rgba(16,185,129,0.15)" : l.status === "callback" ? "rgba(245,158,11,0.15)" : l.status === "new" ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)", color: l.status === "qualified" ? "#10b981" : l.status === "callback" ? "#f59e0b" : l.status === "new" ? "#3b82f6" : "#ef4444", padding: "2px 8px", borderRadius: "5px", fontSize: "11px" }}>
                          {l.status}
                        </span>
                      </span>
                    </td>
                    <td style={{ padding: "0 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "48px", height: "3px", borderRadius: "2px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                          <div style={{ width: `${l.score}%`, height: "100%", background: l.score >= 80 ? "#10b981" : l.score >= 60 ? "#f59e0b" : "#ef4444", borderRadius: "2px" }} />
                        </div>
                        <span style={{ fontSize: "12px", color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{l.score}</span>
                      </div>
                    </td>
                    <td style={{ padding: "0 14px", fontSize: "12px", color: "#475569" }}>{l.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
