import React from "react";
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
  Sparkles,
  Cpu,
  Clock,
  Phone,
  DollarSign,
  Check as CheckIcon
} from "lucide-react";

export function BillingPage() {
  const sidebarItems = [
    { icon: LayoutDashboard, label: "Dashboard", active: false },
    { icon: BarChart3, label: "Analytics", active: false },
    { icon: LayoutGrid, label: "Agents", active: false },
    { icon: Workflow, label: "Builder", active: false },
    { icon: LayoutTemplate, label: "Templates", active: false },
    { icon: Database, label: "Data", active: false },
    { icon: UserCheck, label: "Leads", active: false },
    { icon: Check, label: "Qualified", active: false },
    { icon: PhoneCall, label: "Calls", active: false },
    { icon: CalendarDays, label: "Calendar", active: false },
    { icon: MessageSquare, label: "WhatsApp", active: false },
    { icon: CreditCard, label: "Billing", active: true },
  ];

  const planFeatures = {
    starter: [
      "1 agent",
      "500 mins",
      "Basic analytics",
    ],
    pro: [
      "5 agents",
      "3,000 mins",
      "Advanced analytics",
      "Priority support",
    ],
    enterprise: [
      "20 agents",
      "Unlimited mins",
      "Custom integrations",
      "SLA",
    ]
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100%",
        backgroundColor: "#0b0f14",
        color: "#e2e8f0",
        fontFamily: "Inter, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Sidebar */}
      <div
        style={{
          width: "208px",
          minWidth: "208px",
          backgroundColor: "#0d1117",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Workspace Switcher */}
        <div
          style={{
            padding: "16px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "6px",
              backgroundColor: "rgba(79,140,255,0.15)",
              color: "#4f8cff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: "14px",
            }}
          >
            W
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>Webee</span>
            <span style={{ fontSize: "12px", color: "#64748b" }}>Admin · Pro</span>
          </div>
        </div>

        {/* Nav Items */}
        <div style={{ padding: "12px 8px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px" }}>
          {sidebarItems.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  backgroundColor: item.active ? "rgba(79,140,255,0.08)" : "transparent",
                  color: item.active ? "#e2e8f0" : "#64748b",
                  fontWeight: item.active ? 500 : 400,
                  fontSize: "14px",
                  position: "relative",
                }}
              >
                {item.active && (
                  <div
                    style={{
                      position: "absolute",
                      left: "-8px",
                      top: "4px",
                      bottom: "4px",
                      width: "2px",
                      backgroundColor: "#4f8cff",
                      borderRadius: "0 2px 2px 0",
                    }}
                  />
                )}
                <Icon size={16} />
                {item.label}
              </div>
            );
          })}
        </div>

        {/* Bottom User */}
        <div
          style={{
            padding: "16px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "16px",
              backgroundColor: "#131c2b",
              color: "#e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 500,
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            WA
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div
              style={{
                fontSize: "12px",
                color: "#64748b",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              workspace@email.com
            </div>
          </div>
          <Settings size={16} color="#64748b" style={{ cursor: "pointer" }} />
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top Header */}
        <div
          style={{
            height: "44px",
            minHeight: "44px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            backgroundColor: "rgba(11,15,20,0.9)",
            backdropFilter: "blur(12px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
          }}
        >
          <div style={{ color: "#64748b", fontSize: "14px" }}>Billing</div>
          <button
            style={{
              backgroundColor: "#131c2b",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "#e2e8f0",
              fontSize: "13px",
              fontWeight: 500,
              padding: "6px 12px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Manage billing
          </button>
        </div>

        {/* Page Scrollable Area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 24px", display: "flex", justifyContent: "center" }}>
          <div style={{ maxWidth: "1024px", width: "100%", display: "flex", flexDirection: "column", gap: "32px" }}>
            
            {/* Current Plan card */}
            <div
              style={{
                backgroundColor: "#131c2b",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px",
                padding: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "linear-gradient(90deg, rgba(79,140,255,0.08) 0%, rgba(19,28,43,1) 100%)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      color: "#4f8cff",
                      fontSize: "14px",
                      fontWeight: 600,
                      backgroundColor: "rgba(79,140,255,0.1)",
                      padding: "4px 8px",
                      borderRadius: "6px",
                    }}
                  >
                    <Sparkles size={14} />
                    Pro Plan
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      color: "#10b981",
                      fontSize: "13px",
                      fontWeight: 500,
                    }}
                  >
                    ● Active
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "32px", fontWeight: 700 }}>$97</span>
                  <span style={{ color: "#64748b", fontSize: "16px" }}>/ month</span>
                </div>
                <div style={{ color: "#64748b", fontSize: "14px" }}>
                  Renews June 28, 2026
                </div>
              </div>
              <button
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                  color: "#4f8cff",
                  fontSize: "14px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Manage billing &rarr;
              </button>
            </div>

            {/* Usage this cycle */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
                {/* Active Agents */}
                <div
                  style={{
                    backgroundColor: "#131c2b",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "12px",
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(79,140,255,0.1)",
                      color: "#4f8cff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Cpu size={20} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ color: "#64748b", fontSize: "13px" }}>Active Agents</span>
                    <span style={{ fontSize: "20px", fontWeight: 600 }}>3</span>
                  </div>
                </div>

                {/* Minutes Used */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div
                    style={{
                      backgroundColor: "#131c2b",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: "12px",
                      padding: "16px",
                      display: "flex",
                      alignItems: "center",
                      gap: "16px",
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "8px",
                        backgroundColor: "rgba(139,92,246,0.1)",
                        color: "#8b5cf6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Clock size={20} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ color: "#64748b", fontSize: "13px" }}>Minutes Used</span>
                      <span style={{ fontSize: "14px", fontWeight: 600 }}>
                        <span style={{ fontSize: "20px" }}>1,247</span> of 3,000
                      </span>
                    </div>
                  </div>
                  <div style={{ height: "4px", backgroundColor: "#131c2b", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: "42%", height: "100%", backgroundColor: "#8b5cf6", borderRadius: "2px" }} />
                  </div>
                </div>

                {/* Calls Made */}
                <div
                  style={{
                    backgroundColor: "#131c2b",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "12px",
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(16,185,129,0.1)",
                      color: "#10b981",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Phone size={20} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ color: "#64748b", fontSize: "13px" }}>Calls Made</span>
                    <span style={{ fontSize: "14px", fontWeight: 600 }}>
                      <span style={{ fontSize: "20px" }}>847</span> of unlimited
                    </span>
                  </div>
                </div>

                {/* Accrued Cost */}
                <div
                  style={{
                    backgroundColor: "#131c2b",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "12px",
                    padding: "16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(245,158,11,0.1)",
                      color: "#f59e0b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <DollarSign size={20} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ color: "#64748b", fontSize: "13px" }}>Accrued Cost</span>
                    <span style={{ fontSize: "20px", fontWeight: 600 }}>$41.20</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Plans Section */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Choose a plan</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
                
                {/* Starter */}
                <div
                  style={{
                    backgroundColor: "#131c2b",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "12px",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "24px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <h4 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Starter</h4>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                      <span style={{ fontSize: "28px", fontWeight: 700 }}>$29</span>
                      <span style={{ color: "#64748b", fontSize: "14px" }}>/mo</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                    {planFeatures.starter.map((feature, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#e2e8f0" }}>
                        <CheckIcon size={16} color="#10b981" />
                        {feature}
                      </div>
                    ))}
                  </div>
                  <button
                    style={{
                      width: "100%",
                      backgroundColor: "transparent",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "#e2e8f0",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Downgrade
                  </button>
                </div>

                {/* Pro */}
                <div
                  style={{
                    backgroundColor: "#131c2b",
                    border: "2px solid #4f8cff",
                    borderRadius: "12px",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "24px",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "-12px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      backgroundColor: "#4f8cff",
                      color: "#fff",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "4px 12px",
                      borderRadius: "12px",
                    }}
                  >
                    Current plan
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <h4 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Pro</h4>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                      <span style={{ fontSize: "28px", fontWeight: 700 }}>$97</span>
                      <span style={{ color: "#64748b", fontSize: "14px" }}>/mo</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                    {planFeatures.pro.map((feature, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#e2e8f0" }}>
                        <CheckIcon size={16} color="#10b981" />
                        {feature}
                      </div>
                    ))}
                  </div>
                  <button
                    disabled
                    style={{
                      width: "100%",
                      backgroundColor: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      color: "#64748b",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontWeight: 500,
                      cursor: "not-allowed",
                    }}
                  >
                    Current Plan
                  </button>
                </div>

                {/* Enterprise */}
                <div
                  style={{
                    backgroundColor: "#131c2b",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "12px",
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "24px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <h4 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Enterprise</h4>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                      <span style={{ fontSize: "28px", fontWeight: 700 }}>$297</span>
                      <span style={{ color: "#64748b", fontSize: "14px" }}>/mo</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                    {planFeatures.enterprise.map((feature, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", color: "#e2e8f0" }}>
                        <CheckIcon size={16} color="#10b981" />
                        {feature}
                      </div>
                    ))}
                  </div>
                  <button
                    style={{
                      width: "100%",
                      backgroundColor: "#4f8cff",
                      border: "none",
                      color: "#fff",
                      padding: "10px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Upgrade
                  </button>
                </div>

              </div>
            </div>

            {/* Invoices & payment footer card */}
            <div
              style={{
                backgroundColor: "#131c2b",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "24px",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "60%" }}>
                  <h3 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Invoices & Payment Methods</h3>
                  <p style={{ color: "#64748b", fontSize: "14px", margin: 0, lineHeight: 1.5 }}>
                    View invoices and update your payment details in the secure Stripe portal.
                  </p>
                </div>
                <button
                  style={{
                    backgroundColor: "transparent",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#e2e8f0",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    fontSize: "14px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Open Billing Portal &rarr;
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ color: "#64748b", fontSize: "13px" }}>Last invoice</span>
                  <span style={{ fontSize: "14px", fontWeight: 500 }}>$97.00, Jun 1</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ color: "#64748b", fontSize: "13px" }}>Payment method</span>
                  <span style={{ fontSize: "14px", fontWeight: 500, display: "flex", alignItems: "center", gap: "8px" }}>
                    Visa ••••4242
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <span style={{ color: "#64748b", fontSize: "13px" }}>Next charge</span>
                  <span style={{ fontSize: "14px", fontWeight: 500 }}>$97.00, Jun 28</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
