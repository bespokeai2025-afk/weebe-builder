import {
  Phone, PhoneIncoming, PhoneOutgoing, Search, Filter, Download,
  RefreshCw, PlayCircle, ChevronDown, MoreHorizontal, ArrowUpDown
} from "lucide-react";

const STATS = [
  { label: "Total", value: "1,284", icon: Phone, color: "#4f8cff" },
  { label: "Completed", value: "892", icon: PhoneIncoming, color: "#10b981" },
  { label: "Failed", value: "147", icon: Phone, color: "#ef4444" },
  { label: "Total talk", value: "94h 22m", icon: PhoneOutgoing, color: "#f59e0b" },
];

const CALLS = [
  { id: "c1", contact: "Sarah Johnson", phone: "+44 7700 900123", direction: "inbound", status: "completed", duration: "4m 12s", sentiment: "positive", agent: "Receptionist AI", time: "Today, 14:32" },
  { id: "c2", contact: "Marcus Webb", phone: "+44 7700 900456", direction: "outbound", status: "completed", duration: "2m 48s", sentiment: "neutral", agent: "Lead Gen Bot", time: "Today, 13:15" },
  { id: "c3", contact: "Priya Sharma", phone: "+44 7700 900789", direction: "inbound", status: "no_answer", duration: "—", sentiment: null, agent: "Receptionist AI", time: "Today, 11:07" },
  { id: "c4", contact: "Tom Alderton", phone: "+44 7700 900321", direction: "outbound", status: "completed", duration: "6m 03s", sentiment: "positive", agent: "Lead Gen Bot", time: "Today, 09:44" },
  { id: "c5", contact: "Lena Müller", phone: "+44 7700 900654", direction: "inbound", status: "voicemail", duration: "0m 45s", sentiment: null, agent: "Receptionist AI", time: "Yesterday, 17:22" },
  { id: "c6", contact: "James Okafor", phone: "+44 7700 900987", direction: "outbound", status: "completed", duration: "3m 31s", sentiment: "negative", agent: "Receptionist AI", time: "Yesterday, 15:11" },
  { id: "c7", contact: "Nina Clarke", phone: "+44 7700 900147", direction: "inbound", status: "completed", duration: "8m 02s", sentiment: "positive", agent: "Lead Gen Bot", time: "Yesterday, 12:05" },
  { id: "c8", contact: "David Kim", phone: "+44 7700 900258", direction: "outbound", status: "failed", duration: "—", sentiment: null, agent: "Lead Gen Bot", time: "Yesterday, 10:30" },
];

function statusPill(s: string) {
  const styles: Record<string, [string, string]> = {
    completed: ["rgba(16,185,129,0.12)", "#10b981"],
    no_answer: ["rgba(245,158,11,0.12)", "#f59e0b"],
    voicemail: ["rgba(139,92,246,0.12)", "#a78bfa"],
    failed: ["rgba(239,68,68,0.12)", "#ef4444"],
    in_progress: ["rgba(79,140,255,0.12)", "#4f8cff"],
  };
  const [bg, color] = styles[s] ?? ["rgba(100,116,139,0.12)", "#94a3b8"];
  return { background: bg, color, fontSize: "11px", padding: "2px 8px", borderRadius: "5px", fontWeight: 500 };
}

function sentimentPill(s: string | null) {
  if (!s) return null;
  const styles: Record<string, [string, string]> = {
    positive: ["rgba(16,185,129,0.12)", "#10b981"],
    negative: ["rgba(239,68,68,0.12)", "#ef4444"],
    neutral: ["rgba(100,116,139,0.12)", "#94a3b8"],
  };
  const [bg, color] = styles[s] ?? ["rgba(100,116,139,0.12)", "#94a3b8"];
  return { background: bg, color, fontSize: "11px", padding: "2px 8px", borderRadius: "5px", fontWeight: 500 };
}

export function CallsPage() {
  return (
    <div style={{ height: "100vh", background: "#0b0f14", color: "#e2e8f0", fontFamily: "Inter, sans-serif", fontSize: "14px", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Page header */}
      <div style={{ padding: "16px 24px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0, color: "#f1f5f9" }}>Calls</h1>
            <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>Call activity, transcripts and outcomes</p>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button style={{ height: "32px", padding: "0 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
              <Download size={12} /> Export
            </button>
            <button style={{ height: "32px", width: "32px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "8px", marginBottom: "14px" }}>
          {STATS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} style={{ background: "#151d2b", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "10px 14px", display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "30px", height: "30px", borderRadius: "7px", background: `${s.color}18`, border: `1px solid ${s.color}28`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={14} color={s.color} />
                </div>
                <div>
                  <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 500, marginBottom: "1px", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em", lineHeight: 1 }}>{s.value}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0", paddingBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ position: "relative", flex: 1, maxWidth: "280px" }}>
            <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#475569" }} />
            <input placeholder="Search calls…" style={{ width: "100%", height: "32px", paddingLeft: "30px", paddingRight: "10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: "12px", outline: "none", boxSizing: "border-box" }} />
          </div>
          <button style={{ height: "32px", padding: "0 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
            <Filter size={12} /> Status <ChevronDown size={10} />
          </button>
          <button style={{ height: "32px", padding: "0 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
            Agent <ChevronDown size={10} />
          </button>
          <button style={{ height: "32px", padding: "0 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#94a3b8", fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px" }}>
            Date <ChevronDown size={10} />
          </button>
          <div style={{ marginLeft: "auto", fontSize: "12px", color: "#475569" }}>{CALLS.length} calls</div>
        </div>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 20px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "#0b0f14", zIndex: 10 }}>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {[
                { label: "Contact", w: "18%" },
                { label: "Phone", w: "14%" },
                { label: "Direction", w: "9%" },
                { label: "Status", w: "10%" },
                { label: "Duration", w: "9%" },
                { label: "Sentiment", w: "10%" },
                { label: "Agent", w: "15%" },
                { label: "Time", w: "13%" },
                { label: "", w: "2%" },
              ].map((h) => (
                <th key={h.label} style={{ width: h.w, padding: "0 12px", height: "36px", textAlign: "left", fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569" }}>
                  {h.label && (
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                      {h.label}
                      {["Contact", "Duration", "Time"].includes(h.label) && <ArrowUpDown size={10} style={{ opacity: 0.5 }} />}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CALLS.map((call, i) => (
              <tr key={call.id} style={{
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "0 12px", height: "44px", fontSize: "13px", fontWeight: 500, color: "#e2e8f0" }}>{call.contact}</td>
                <td style={{ padding: "0 12px", fontSize: "12px", color: "#64748b", fontFamily: "monospace" }}>{call.phone}</td>
                <td style={{ padding: "0 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#64748b" }}>
                    {call.direction === "inbound" ? <PhoneIncoming size={12} color="#4f8cff" /> : <PhoneOutgoing size={12} color="#f59e0b" />}
                    <span style={{ fontSize: "11px" }}>{call.direction}</span>
                  </div>
                </td>
                <td style={{ padding: "0 12px" }}>
                  <span style={statusPill(call.status)}>{call.status.replace("_", " ")}</span>
                </td>
                <td style={{ padding: "0 12px", fontSize: "12px", color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{call.duration}</td>
                <td style={{ padding: "0 12px" }}>
                  {call.sentiment ? <span style={sentimentPill(call.sentiment)!}>{call.sentiment}</span> : <span style={{ color: "#475569", fontSize: "12px" }}>—</span>}
                </td>
                <td style={{ padding: "0 12px", fontSize: "12px", color: "#64748b" }}>{call.agent}</td>
                <td style={{ padding: "0 12px", fontSize: "12px", color: "#475569" }}>{call.time}</td>
                <td style={{ padding: "0 12px" }}>
                  <div style={{ display: "flex", gap: "4px", opacity: 0.6 }}>
                    {call.status === "completed" && <PlayCircle size={14} color="#4f8cff" style={{ cursor: "pointer" }} />}
                    <MoreHorizontal size={14} color="#64748b" style={{ cursor: "pointer" }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 0", borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "4px" }}>
          <span style={{ fontSize: "12px", color: "#475569" }}>Showing 8 of 1,284 calls</span>
          <div style={{ display: "flex", gap: "4px" }}>
            {["Prev", "1", "2", "3", "Next"].map((p) => (
              <button key={p} style={{
                height: "28px", minWidth: "28px", padding: "0 8px",
                borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)",
                background: p === "1" ? "rgba(79,140,255,0.15)" : "rgba(255,255,255,0.04)",
                color: p === "1" ? "#4f8cff" : "#94a3b8", fontSize: "12px", cursor: "pointer"
              }}>{p}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
