import React, { useState } from "react";
import { 
  LayoutDashboard, 
  BarChart3, 
  LayoutGrid, 
  Workflow, 
  LayoutTemplate, 
  Database, 
  UserCheck, 
  Check, 
  PhoneCall, 
  CalendarDays, 
  MessageSquare, 
  CreditCard,
  Settings,
  Search,
  Globe2,
  User,
  Trash2,
  Plus
} from "lucide-react";

export function TemplatesPage() {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  const colors = {
    bg: "#0b0f14",
    sidebar: "#0d1117",
    card: "#131c2b",
    border: "rgba(255,255,255,0.06)",
    muted: "#64748b",
    text: "#e2e8f0",
    accent: "#4f8cff",
    font: "Inter, -apple-system, sans-serif"
  };

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard" },
    { icon: BarChart3, label: "Analytics" },
    { icon: LayoutGrid, label: "Agents" },
    { icon: Workflow, label: "Builder" },
    { icon: LayoutTemplate, label: "Templates", active: true },
    { icon: Database, label: "Data" },
    { icon: UserCheck, label: "Leads" },
    { icon: Check, label: "Qualified" },
    { icon: PhoneCall, label: "Calls" },
    { icon: CalendarDays, label: "Calendar" },
    { icon: MessageSquare, label: "WhatsApp" },
    { icon: CreditCard, label: "Billing" },
  ];

  const globalTemplates = [
    { id: "g1", name: "Lead Qualification Bot", desc: "Qualifies inbound leads by budget, timeline and pain points", tags: ["Lead Gen", "Sales"] },
    { id: "g2", name: "Appointment Setter", desc: "Books discovery calls using Cal.com integration", tags: ["Sales", "Scheduling"] },
    { id: "g3", name: "Customer Support AI", desc: "Handles FAQs, escalates complex issues to humans", tags: ["Support", "Service"] },
    { id: "g4", name: "Cold Outreach Agent", desc: "Follows a proven outbound sales script", tags: ["Outreach", "Sales"] },
    { id: "g5", name: "Re-engagement Bot", desc: "Wins back churned customers with personalised offers", tags: ["Marketing", "Retention"] },
    { id: "g6", name: "Receptionist AI", desc: "Answers calls, routes to the right department", tags: ["Inbound", "Routing"] },
  ];

  const myTemplates = [
    { id: "m1", name: "Custom Qualifier v2", desc: "Personal lead qualifying flow with custom questions", tags: ["Custom", "Lead Gen"] },
    { id: "m2", name: "Weekly Follow-up", desc: "Automated weekly check-in calls for existing clients", tags: ["Retention", "Follow-up"] },
  ];

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", backgroundColor: colors.bg, color: colors.text, fontFamily: colors.font, margin: 0, padding: 0, boxSizing: "border-box", overflow: "hidden" }}>
      
      {/* Sidebar */}
      <div style={{ width: "208px", flexShrink: 0, backgroundColor: colors.sidebar, borderRight: `1px solid ${colors.border}`, display: "flex", flexDirection: "column", height: "100%" }}>
        
        {/* Workspace Switcher */}
        <div style={{ padding: "16px", display: "flex", alignItems: "center", gap: "12px", borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "6px", backgroundColor: "rgba(79,140,255,0.15)", color: colors.accent, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "14px" }}>
            W
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "14px", fontWeight: 500, color: colors.text }}>Webee</span>
            <span style={{ fontSize: "12px", color: colors.muted }}>Admin · Pro</span>
          </div>
        </div>

        {/* Nav Items */}
        <div style={{ flex: 1, padding: "12px 8px", display: "flex", flexDirection: "column", gap: "4px", overflowY: "auto" }}>
          {navItems.map((item, idx) => (
            <div key={idx} style={{ 
              display: "flex", 
              alignItems: "center", 
              gap: "10px", 
              padding: "8px 12px", 
              borderRadius: "6px",
              backgroundColor: item.active ? "rgba(79,140,255,0.08)" : "transparent",
              color: item.active ? colors.text : colors.muted,
              fontWeight: item.active ? 500 : 400,
              cursor: "pointer",
              position: "relative"
            }}>
              {item.active && (
                <div style={{ position: "absolute", left: "-8px", top: "10%", height: "80%", width: "2px", backgroundColor: colors.accent, borderRadius: "0 2px 2px 0" }} />
              )}
              <item.icon size={16} color={item.active ? colors.accent : colors.muted} />
              <span style={{ fontSize: "13px" }}>{item.label}</span>
            </div>
          ))}
        </div>

        {/* User profile bottom */}
        <div style={{ padding: "16px", borderTop: `1px solid ${colors.border}`, display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "50%", backgroundColor: colors.card, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: colors.text, border: `1px solid ${colors.border}` }}>
            WA
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
            <span style={{ fontSize: "12px", color: colors.muted, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>workspace@email.com</span>
          </div>
          <Settings size={14} color={colors.muted} style={{ cursor: "pointer" }} />
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        
        {/* Top Header */}
        <div style={{ 
          height: "44px", 
          borderBottom: `1px solid ${colors.border}`, 
          backgroundColor: "rgba(11,15,20,0.9)", 
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          flexShrink: 0
        }}>
          <div style={{ fontSize: "13px", color: colors.muted }}>
            Templates
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} color={colors.muted} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }} />
              <input 
                type="text" 
                placeholder="Search templates..." 
                style={{ 
                  width: "200px", 
                  backgroundColor: colors.bg, 
                  border: `1px solid ${colors.border}`, 
                  borderRadius: "6px", 
                  padding: "6px 12px 6px 32px", 
                  color: colors.text, 
                  fontSize: "13px",
                  outline: "none"
                }} 
              />
            </div>
            <button style={{ 
              backgroundColor: colors.card, 
              border: `1px solid ${colors.border}`, 
              color: colors.text, 
              padding: "6px 12px", 
              borderRadius: "6px", 
              fontSize: "12px", 
              cursor: "pointer",
              fontWeight: 500
            }}>
              Save current agent as template
            </button>
          </div>
        </div>

        {/* Page Scrollable Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "40px 48px" }}>
          
          {/* Page Header */}
          <div style={{ marginBottom: "40px" }}>
            <h1 style={{ fontSize: "20px", fontWeight: "bold", margin: "0 0 8px 0", color: colors.text }}>Templates</h1>
            <p style={{ fontSize: "14px", color: colors.muted, margin: 0 }}>Browse and clone agent configurations to jumpstart your workflow.</p>
          </div>

          {/* Global Templates */}
          <div style={{ marginBottom: "48px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
              <Globe2 size={16} color={colors.muted} />
              <span style={{ fontSize: "13px", fontWeight: 600, color: colors.text }}>Global Templates</span>
              <div style={{ backgroundColor: colors.card, border: `1px solid ${colors.border}`, borderRadius: "10px", padding: "2px 8px", fontSize: "11px", color: colors.muted }}>
                12
              </div>
            </div>

            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
              gap: "20px" 
            }}>
              {globalTemplates.map(template => (
                <div 
                  key={template.id}
                  onMouseEnter={() => setHoveredCard(template.id)}
                  onMouseLeave={() => setHoveredCard(null)}
                  style={{
                    backgroundColor: hoveredCard === template.id ? "#172236" : colors.card,
                    border: `1px solid ${colors.border}`,
                    borderRadius: "10px",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    transition: "all 0.2s ease"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ backgroundColor: "rgba(79,140,255,0.1)", padding: "6px", borderRadius: "6px", display: "flex" }}>
                      <Workflow size={14} color={colors.accent} />
                    </div>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: colors.text }}>{template.name}</span>
                  </div>
                  <p style={{ fontSize: "12px", color: colors.muted, margin: 0, lineHeight: "1.5", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "36px" }}>
                    {template.desc}
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px", minHeight: "24px" }}>
                    {template.tags.map(tag => (
                      <span key={tag} style={{ fontSize: "11px", backgroundColor: "rgba(255,255,255,0.03)", color: colors.muted, padding: "2px 8px", borderRadius: "12px", border: `1px solid ${colors.border}` }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px", paddingTop: "16px", borderTop: `1px solid ${colors.border}` }}>
                    <span style={{ fontSize: "11px", color: colors.muted }}>Updated Jun 1</span>
                    <button style={{ backgroundColor: colors.accent, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}>
                      Use template
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* My Templates */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <User size={16} color={colors.muted} />
                <span style={{ fontSize: "13px", fontWeight: 600, color: colors.text }}>My Templates</span>
                <div style={{ backgroundColor: colors.card, border: `1px solid ${colors.border}`, borderRadius: "10px", padding: "2px 8px", fontSize: "11px", color: colors.muted }}>
                  2
                </div>
              </div>
              <button style={{ 
                backgroundColor: "transparent", 
                border: `1px dashed ${colors.border}`, 
                color: colors.muted, 
                padding: "4px 10px", 
                borderRadius: "6px", 
                fontSize: "12px", 
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}>
                <Plus size={14} /> Save new
              </button>
            </div>

            <div style={{ 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
              gap: "20px" 
            }}>
              {myTemplates.map(template => (
                <div 
                  key={template.id}
                  onMouseEnter={() => setHoveredCard(template.id)}
                  onMouseLeave={() => setHoveredCard(null)}
                  style={{
                    backgroundColor: hoveredCard === template.id ? "#172236" : colors.card,
                    border: `1px solid ${colors.border}`,
                    borderRadius: "10px",
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    transition: "all 0.2s ease",
                    position: "relative"
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ backgroundColor: "rgba(79,140,255,0.1)", padding: "6px", borderRadius: "6px", display: "flex" }}>
                        <Workflow size={14} color={colors.accent} />
                      </div>
                      <span style={{ fontSize: "13px", fontWeight: "bold", color: colors.text }}>{template.name}</span>
                    </div>
                    {hoveredCard === template.id && (
                      <button style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.muted, padding: "4px" }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <p style={{ fontSize: "12px", color: colors.muted, margin: 0, lineHeight: "1.5", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "36px" }}>
                    {template.desc}
                  </p>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px", minHeight: "24px" }}>
                    {template.tags.map(tag => (
                      <span key={tag} style={{ fontSize: "11px", backgroundColor: "rgba(255,255,255,0.03)", color: colors.muted, padding: "2px 8px", borderRadius: "12px", border: `1px solid ${colors.border}` }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px", paddingTop: "16px", borderTop: `1px solid ${colors.border}` }}>
                    <span style={{ fontSize: "11px", color: colors.muted }}>Updated Jun 1</span>
                    <button style={{ backgroundColor: colors.accent, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}>
                      Use template
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
