import React, { useState } from "react";
import { 
  LayoutDashboard, BarChart3, LayoutGrid, Workflow, LayoutTemplate, 
  Database, UserCheck, Check, PhoneCall, CalendarDays, MessageSquare, 
  CreditCard, Search, Settings, PhoneOutgoing, Clock, CheckCircle2,
  ChevronDown, Filter, MoreHorizontal, Plus, Upload, Calendar, X, Play, Trash2
} from "lucide-react";

export function DataPage() {
  const [selectedRows, setSelectedRows] = useState([1, 2, 4]);

  const toggleRow = (id: number) => {
    if (selectedRows.includes(id)) {
      setSelectedRows(selectedRows.filter(r => r !== id));
    } else {
      setSelectedRows([...selectedRows, id]);
    }
  };

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Analytics", icon: BarChart3 },
    { name: "Agents", icon: LayoutGrid },
    { name: "Builder", icon: Workflow },
    { name: "Templates", icon: LayoutTemplate },
    { name: "Data", icon: Database, active: true },
    { name: "Leads", icon: UserCheck },
    { name: "Qualified", icon: Check },
    { name: "Calls", icon: PhoneCall },
    { name: "Calendar", icon: CalendarDays },
    { name: "WhatsApp", icon: MessageSquare },
    { name: "Billing", icon: CreditCard },
  ];

  const data = [
    { id: 1, name: "Sarah Johnson", phone: "+1 (555) 123-4567", status: "needs_to_call", agent: "Sales Bot 1", updated: "10m ago" },
    { id: 2, name: "Marcus Webb", phone: "+1 (555) 987-6543", status: "queued", agent: "Qualification Bot", updated: "1h ago" },
    { id: 3, name: "Priya Sharma", phone: "+1 (555) 456-7890", status: "completed", agent: "Sales Bot 1", updated: "2h ago" },
    { id: 4, name: "David Chen", phone: "+1 (555) 234-5678", status: "failed", agent: "Outbound AI", updated: "3h ago" },
    { id: 5, name: "Emma Wilson", phone: "+1 (555) 876-5432", status: "needs_to_call", agent: "Unassigned", updated: "4h ago" },
    { id: 6, name: "James Taylor", phone: "+1 (555) 345-6789", status: "needs_to_call", agent: "Sales Bot 2", updated: "5h ago" },
    { id: 7, name: "Olivia Davis", phone: "+1 (555) 765-4321", status: "completed", agent: "Qualification Bot", updated: "1d ago" },
    { id: 8, name: "Daniel Martinez", phone: "+1 (555) 654-3210", status: "queued", agent: "Sales Bot 1", updated: "1d ago" },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "needs_to_call": return { bg: "rgba(79,140,255,0.12)", color: "#4f8cff", label: "Needs to call" };
      case "queued": return { bg: "rgba(251,191,36,0.12)", color: "#fbbf24", label: "Queued" };
      case "completed": return { bg: "rgba(52,211,153,0.12)", color: "#34d399", label: "Completed" };
      case "failed": return { bg: "rgba(248,113,113,0.12)", color: "#f87171", label: "Failed" };
      default: return { bg: "rgba(255,255,255,0.1)", color: "#e2e8f0", label: status };
    }
  };

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100%",
      backgroundColor: "#0b0f14",
      color: "#e2e8f0",
      fontFamily: "Inter, -apple-system, sans-serif",
      overflow: "hidden"
    }}>
      {/* Sidebar */}
      <div style={{
        width: "208px",
        flexShrink: 0,
        backgroundColor: "#0d1117",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Workspace Switcher */}
        <div style={{ padding: "16px", display: "flex", alignItems: "center", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "rgba(79,140,255,0.15)", color: "#4f8cff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>W</div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: "14px", fontWeight: 500, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Webee</div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>Admin · Pro</div>
          </div>
        </div>

        {/* Nav Items */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 8px", display: "flex", flexDirection: "column", gap: "4px" }}>
          {navItems.map(item => (
            <div key={item.name} style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "8px 12px",
              borderRadius: "6px",
              cursor: "pointer",
              backgroundColor: item.active ? "rgba(79,140,255,0.08)" : "transparent",
              color: item.active ? "#e2e8f0" : "#64748b",
              fontWeight: item.active ? 500 : 400,
              boxShadow: item.active ? "inset 0 0 0 1px rgba(79,140,255,0.14)" : "none",
              position: "relative"
            }}>
              {item.active && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: "2px", height: "16px", backgroundColor: "#4f8cff", borderRadius: "0 2px 2px 0" }} />}
              <item.icon size={16} />
              <span style={{ fontSize: "13px" }}>{item.name}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px", display: "flex", alignItems: "center", gap: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ width: "28px", height: "28px", borderRadius: "14px", backgroundColor: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 600 }}>WA</div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: "12px", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>workspace@email.com</div>
          </div>
          <Settings size={14} color="#64748b" />
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top Header */}
        <div style={{
          height: "44px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          backgroundColor: "rgba(11,15,20,0.9)",
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px"
        }}>
          <div style={{ fontSize: "12px", color: "#64748b" }}>Data Records</div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <Search size={16} color="#64748b" />
            <div style={{ width: "28px", height: "28px", borderRadius: "14px", backgroundColor: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 600 }}>WA</div>
          </div>
        </div>

        {/* Page Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "24px", position: "relative" }}>
          
          {/* Header Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>Data Records</h1>
              <p style={{ fontSize: "13px", color: "#64748b", margin: "4px 0 0 0" }}>Manage your outbound calling campaign leads.</p>
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <button style={{ height: "32px", padding: "0 12px", borderRadius: "6px", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#e2e8f0", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <Plus size={14} /> Add Record
              </button>
              <button style={{ height: "32px", padding: "0 12px", borderRadius: "6px", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#e2e8f0", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <Upload size={14} /> Import CSV
              </button>
              <button style={{ height: "32px", padding: "0 12px", borderRadius: "6px", backgroundColor: "#4f8cff", border: "none", color: "#ffffff", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <Calendar size={14} /> Configure Schedule
              </button>
            </div>
          </div>

          {/* KPI Strip */}
          <div style={{ display: "flex", gap: "16px" }}>
            {[
              { label: "Total Records", value: "2,847", icon: Database, bg: "rgba(79,140,255,0.12)", color: "#4f8cff" },
              { label: "Needs to Call", value: "1,204", icon: PhoneOutgoing, bg: "rgba(167,139,250,0.12)", color: "#a78bfa" },
              { label: "Queued", value: "389", icon: Clock, bg: "rgba(251,191,36,0.12)", color: "#fbbf24" },
              { label: "Completed", value: "1,254", icon: CheckCircle2, bg: "rgba(52,211,153,0.12)", color: "#34d399" }
            ].map(kpi => (
              <div key={kpi.label} style={{ flex: 1, backgroundColor: "#131c2b", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", backgroundColor: kpi.bg, color: kpi.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <kpi.icon size={18} />
                </div>
                <div>
                  <div style={{ fontSize: "18px", fontWeight: 600, color: "#e2e8f0", lineHeight: 1.2 }}>{kpi.value}</div>
                  <div style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginTop: "2px" }}>{kpi.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Filters Bar */}
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", padding: "0 12px", height: "32px" }}>
              <Search size={14} color="#64748b" />
              <input type="text" placeholder="Search records..." style={{ flex: 1, background: "none", border: "none", color: "#e2e8f0", fontSize: "13px", outline: "none" }} />
            </div>
            <button style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", padding: "0 12px", height: "32px", color: "#e2e8f0", fontSize: "13px", cursor: "pointer" }}>
              Status: All <ChevronDown size={14} color="#64748b" />
            </button>
            <button style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", padding: "0 12px", height: "32px", color: "#e2e8f0", fontSize: "13px", cursor: "pointer" }}>
              Agent: All <ChevronDown size={14} color="#64748b" />
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", padding: "0 12px", height: "32px", color: "#e2e8f0", fontSize: "13px", cursor: "pointer" }}>
              <input type="checkbox" style={{ accentColor: "#4f8cff", cursor: "pointer" }} /> Unassigned only
            </label>
          </div>

          {/* Data Table */}
          <div style={{ backgroundColor: "#131c2b", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", height: "36px", backgroundColor: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", padding: "0 16px" }}>
              <div style={{ width: "32px" }}>
                <input type="checkbox" checked={selectedRows.length === data.length} onChange={() => {}} style={{ accentColor: "#4f8cff", cursor: "pointer" }} />
              </div>
              <div style={{ flex: "2" }}>Name</div>
              <div style={{ flex: "2" }}>Phone</div>
              <div style={{ flex: "2" }}>Status</div>
              <div style={{ flex: "2" }}>Assigned Agent</div>
              <div style={{ flex: "1" }}>Updated</div>
              <div style={{ width: "40px", textAlign: "right" }}></div>
            </div>
            
            {data.map(row => {
              const status = getStatusBadge(row.status);
              const isSelected = selectedRows.includes(row.id);
              return (
                <div key={row.id} style={{ display: "flex", alignItems: "center", height: "44px", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "13px", padding: "0 16px", backgroundColor: isSelected ? "rgba(79,140,255,0.04)" : "transparent", transition: "background-color 0.15s" }}>
                  <div style={{ width: "32px" }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)} style={{ accentColor: "#4f8cff", cursor: "pointer" }} />
                  </div>
                  <div style={{ flex: "2", fontWeight: 500 }}>{row.name}</div>
                  <div style={{ flex: "2", color: "#94a3b8" }}>{row.phone}</div>
                  <div style={{ flex: "2" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", height: "22px", padding: "0 8px", borderRadius: "11px", backgroundColor: status.bg, color: status.color, fontSize: "11px", fontWeight: 500 }}>
                      {status.label}
                    </span>
                  </div>
                  <div style={{ flex: "2", color: row.agent === "Unassigned" ? "#64748b" : "#e2e8f0" }}>{row.agent}</div>
                  <div style={{ flex: "1", color: "#64748b" }}>{row.updated}</div>
                  <div style={{ width: "40px", textAlign: "right" }}>
                    <button style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%" }}>
                      <MoreHorizontal size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Floating Action Bar */}
          <div style={{ 
            position: "absolute", 
            bottom: "24px", 
            left: "50%", 
            transform: `translate(-50%, ${selectedRows.length > 0 ? "0" : "100px"})`, 
            opacity: selectedRows.length > 0 ? 1 : 0,
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
            backgroundColor: "#131c2b", 
            border: "1px solid rgba(255,255,255,0.08)", 
            borderRadius: "10px", 
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            padding: "8px",
            gap: "8px",
            zIndex: 10
          }}>
            <div style={{ backgroundColor: "rgba(79,140,255,0.1)", color: "#4f8cff", fontSize: "12px", fontWeight: 500, padding: "0 12px", height: "28px", borderRadius: "6px", display: "flex", alignItems: "center" }}>
              {selectedRows.length} selected
            </div>
            <div style={{ width: "1px", height: "24px", backgroundColor: "rgba(255,255,255,0.06)", margin: "0 4px" }} />
            
            <button style={{ height: "32px", padding: "0 12px", borderRadius: "6px", backgroundColor: "transparent", border: "none", color: "#e2e8f0", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <UserCheck size={14} /> Assign Agent
            </button>
            <button style={{ height: "32px", padding: "0 12px", borderRadius: "6px", backgroundColor: "transparent", border: "none", color: "#e2e8f0", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <Calendar size={14} /> Schedule Calls
            </button>
            <button style={{ height: "32px", padding: "0 12px", borderRadius: "6px", backgroundColor: "#4f8cff", border: "none", color: "#ffffff", fontSize: "13px", fontWeight: 500, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
              <Play size={14} fill="currentColor" /> Start Calling
            </button>
            
            <div style={{ width: "1px", height: "24px", backgroundColor: "rgba(255,255,255,0.06)", margin: "0 4px" }} />
            
            <button style={{ height: "32px", width: "32px", padding: "0", borderRadius: "6px", backgroundColor: "rgba(248,113,113,0.1)", border: "none", color: "#f87171", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Trash2 size={14} />
            </button>
            <button style={{ height: "32px", width: "32px", padding: "0", borderRadius: "6px", backgroundColor: "transparent", border: "none", color: "#64748b", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginLeft: "-4px" }} onClick={() => setSelectedRows([])}>
              <X size={14} />
            </button>
          </div>
          
        </div>
      </div>
    </div>
  );
}
