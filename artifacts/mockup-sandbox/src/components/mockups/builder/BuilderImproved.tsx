import { useState } from "react";
import {
  LayoutDashboard, BarChart3, LayoutGrid, Workflow, LayoutTemplate,
  Database, UserCheck, Check, CalendarDays, CreditCard, MessageSquare,
  Settings, PhoneCall,
  MessageSquare as MsgSq, Zap, PhoneForwarded, GitBranch, User2,
  MessageCircle, Code2, XCircle, StickyNote, Hash,
  Settings2, ChevronRight, ChevronDown, Save, DownloadCloud,
  Wand2, Play, MoreHorizontal, Plus, Maximize2,
  Bookmark, Search, Blocks, ArrowRight, Variable,
  Command, ZoomIn, ZoomOut, Layers, Map, PanelLeft, PhoneCall as PhoneCallIcon
} from "lucide-react";

/* ── Design tokens (matching the rest of the app mockups) ── */
const BG        = "#0b0f14";
const SIDEBAR   = "#0d1117";
const CARD      = "#131c2b";
const BORDER    = "rgba(255,255,255,0.06)";
const MUTED     = "#64748b";
const TEXT      = "#e2e8f0";
const ACCENT    = "#4f8cff";

/* ── App-shell sidebar nav (same as Dashboard/Calls mockups) ── */
const NAV = [
  { label: "Dashboard",  icon: LayoutDashboard },
  { label: "Analytics",  icon: BarChart3 },
  { label: "Agents",     icon: LayoutGrid },
  { label: "Builder",    icon: Workflow,       active: true },
  { label: "Templates",  icon: LayoutTemplate },
  { label: "Data",       icon: Database },
  { label: "Leads",      icon: UserCheck },
  { label: "Qualified",  icon: Check },
  { label: "Calls",      icon: PhoneCall },
  { label: "Calendar",   icon: CalendarDays },
  { label: "WhatsApp",   icon: MessageSquare },
  { label: "Billing",    icon: CreditCard },
];

/* ── Node palette ── */
const NODE_TYPES = [
  { id: "conversation", label: "Conversation",  icon: MsgSq,         color: ACCENT,     bg: "rgba(79,140,255,0.12)"  },
  { id: "function",     label: "Function",       icon: Zap,           color: "#a78bfa",  bg: "rgba(167,139,250,0.12)" },
  { id: "transfer",     label: "Call Transfer",  icon: PhoneForwarded,color: "#34d399",  bg: "rgba(52,211,153,0.12)"  },
  { id: "logic",        label: "Logic Split",    icon: GitBranch,     color: "#fbbf24",  bg: "rgba(251,191,36,0.12)"  },
  { id: "agent",        label: "Agent Transfer", icon: User2,         color: "#f472b6",  bg: "rgba(244,114,182,0.12)" },
  { id: "sms",          label: "In-Call SMS",    icon: MessageCircle, color: "#38bdf8",  bg: "rgba(56,189,248,0.12)"  },
  { id: "variable",     label: "Extract Var",    icon: Variable,      color: "#fb923c",  bg: "rgba(251,146,60,0.12)"  },
  { id: "code",         label: "Code",           icon: Code2,         color: "#94a3b8",  bg: "rgba(148,163,184,0.12)" },
  { id: "ending",       label: "End Call",       icon: XCircle,       color: "#f87171",  bg: "rgba(248,113,113,0.12)" },
  { id: "note",         label: "Note",           icon: StickyNote,    color: TEXT,       bg: "rgba(226,232,240,0.06)" },
];

/* ── Sample canvas nodes ── */
const CANVAS_NODES = [
  {
    id: "n1", type: "conversation", label: "Welcome",
    x: 148, y: 130, w: 224,
    prompt: "Hi! I'm your AI receptionist. How can I help you today?",
    transitions: ["Booking enquiry", "General question"],
  },
  {
    id: "n2", type: "function", label: "Check Availability",
    x: 448, y: 54, w: 224,
    prompt: "cal_com_check_slots({ date: '{{today}}' })",
    transitions: ["Slots found", "No slots"],
  },
  {
    id: "n3", type: "logic", label: "Route Intent",
    x: 448, y: 270, w: 224,
    prompt: "intent === 'booking' → Booking\nintent === 'support' → Support",
    transitions: ["Booking", "Support", "Other"],
  },
  {
    id: "n4", type: "ending", label: "Goodbye",
    x: 748, y: 174, w: 224,
    prompt: "Thanks for calling. Have a great day!",
    transitions: [],
  },
];

/* ── Canvas node card ── */
function CanvasNode({ node }: { node: typeof CANVAS_NODES[0] }) {
  const meta = NODE_TYPES.find(t => t.id === node.type)!;
  const Icon = meta.icon;
  const isMono = node.type === "function" || node.type === "code";
  return (
    <div style={{
      position: "absolute", left: node.x, top: node.y, width: node.w,
      background: CARD, border: `1px solid ${BORDER}`,
      borderRadius: 10, overflow: "hidden",
      boxShadow: "0 2px 20px rgba(0,0,0,0.35)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "7px 10px", borderBottom: `1px solid ${BORDER}`,
        background: "rgba(255,255,255,0.025)",
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={11} color={meta.color} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: TEXT, flex: 1 }}>{node.label}</span>
        <span style={{
          fontSize: 9.5, color: MUTED,
          background: "rgba(255,255,255,0.05)", padding: "1px 5px", borderRadius: 4,
        }}>{meta.label}</span>
      </div>

      <div style={{ padding: "7px 10px", borderBottom: node.transitions.length ? `1px solid ${BORDER}` : "none" }}>
        <p style={{
          fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.55, margin: 0,
          fontFamily: isMono ? "monospace" : "inherit",
        }}>
          {node.prompt}
        </p>
      </div>

      {node.transitions.length > 0 && (
        <div style={{ padding: "5px 7px", display: "flex", flexDirection: "column", gap: 2 }}>
          {node.transitions.map(t => (
            <div key={t} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "3px 7px", background: "rgba(255,255,255,0.03)", borderRadius: 5,
            }}>
              <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.45)" }}>{t}</span>
              <ArrowRight size={9} color="rgba(255,255,255,0.2)" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── SVG edges ── */
function Edges() {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} overflow="visible">
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="rgba(79,140,255,0.5)" />
        </marker>
      </defs>
      <path d={`M ${148+224} ${130+46} C ${420} ${130+46} ${420} ${54+46} ${448} ${54+46}`}
        stroke="rgba(79,140,255,0.35)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)" />
      <path d={`M ${148+224} ${130+74} C ${420} ${130+74} ${420} ${270+46} ${448} ${270+46}`}
        stroke="rgba(79,140,255,0.35)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)" />
      <path d={`M ${448+224} ${54+46} C ${720} ${54+46} ${720} ${174+46} ${748} ${174+46}`}
        stroke="rgba(79,140,255,0.35)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)" />
      <path d={`M ${448+224} ${270+46} C ${720} ${270+46} ${720} ${174+70} ${748} ${174+70}`}
        stroke="rgba(79,140,255,0.35)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)" />
    </svg>
  );
}

/* ── Right panel helpers ── */
function AccordionSection({ label, children, defaultOpen = false }: {
  label: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${BORDER}` }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "9px 14px", background: "transparent", border: "none", cursor: "pointer",
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED }}>
          {label}
        </span>
        {open ? <ChevronDown size={12} color={MUTED} /> : <ChevronRight size={12} color={MUTED} />}
      </button>
      {open && <div style={{ padding: "0 14px 12px" }}>{children}</div>}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ fontSize: 10, color: MUTED, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function SelectMock({ value }: { value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "5px 9px", background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`,
      borderRadius: 6, cursor: "pointer",
    }}>
      <span style={{ fontSize: 11, color: TEXT }}>{value}</span>
      <ChevronDown size={11} color={MUTED} />
    </div>
  );
}

/* Segmented pip control — replaces old white-ball slider */
function SliderMock({ label, value }: { label: string; value: number }) {
  const STEPS = 8;
  const filled = Math.round((value / 100) * STEPS);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: MUTED }}>{label}</span>
        <span style={{
          fontSize: 9.5, fontWeight: 600, color: ACCENT,
          background: "rgba(79,140,255,0.1)", border: "1px solid rgba(79,140,255,0.2)",
          padding: "1px 6px", borderRadius: 4,
        }}>{value}</span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {Array.from({ length: STEPS }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 3,
            background: i < filled
              ? i < filled * 0.5
                ? `rgba(79,140,255,0.5)`
                : ACCENT
              : "rgba(255,255,255,0.07)",
          }} />
        ))}
      </div>
    </div>
  );
}

/* ── Toolbar icon button ── */
function Btn({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <button title={title} style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: 6, background: "transparent",
      border: `1px solid transparent`, cursor: "pointer",
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)";
        (e.currentTarget as HTMLElement).style.borderColor = BORDER;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = "transparent";
        (e.currentTarget as HTMLElement).style.borderColor = "transparent";
      }}
    >
      <Icon size={14} color={MUTED} />
    </button>
  );
}

/* ── Main ── */
export function BuilderImproved() {
  const [leftTab, setLeftTab] = useState<"nodes" | "components">("nodes");
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div style={{
      display: "flex", height: "100vh", background: BG,
      color: TEXT, fontFamily: "Inter, -apple-system, sans-serif",
      fontSize: 14, overflow: "hidden",
    }}>

      {/* ════════════ COLLAPSED ICON-RAIL SIDEBAR ════════════ */}
      <aside style={{
        width: 56, minWidth: 56, background: SIDEBAR,
        borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column",
        alignItems: "center", paddingTop: 8,
      }}>
        {/* Logo avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: 8, marginBottom: 8,
          background: "rgba(79,140,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: ACCENT }}>W</span>
        </div>

        <div style={{ width: 32, height: 1, background: BORDER, marginBottom: 6 }} />

        {/* Icon-only nav */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, width: "100%", padding: "0 8px" }}>
          {NAV.map(item => {
            const Icon = item.icon;
            const active = !!item.active;
            return (
              <div key={item.label} title={item.label} style={{ position: "relative", width: "100%" }}>
                {active && (
                  <div style={{
                    position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)",
                    width: 2, height: 18, background: ACCENT, borderRadius: "0 2px 2px 0",
                  }} />
                )}
                <button style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "100%", height: 32, borderRadius: 7, border: "none", cursor: "pointer",
                  background: active ? "rgba(79,140,255,0.1)" : "transparent",
                  color: active ? ACCENT : MUTED,
                  boxShadow: active ? "inset 0 0 0 1px rgba(79,140,255,0.16)" : "none",
                }}>
                  <Icon size={15} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer avatar */}
        <div style={{ padding: "8px 0", borderTop: `1px solid ${BORDER}`, width: "100%", display: "flex", justifyContent: "center" }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: "#1e293b",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 600, color: "#94a3b8", cursor: "pointer",
          }}>WA</div>
        </div>
      </aside>

      {/* ════════════ BUILDER AREA ════════════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ── Builder toolbar ── */}
        <header style={{
          height: 44, display: "flex", alignItems: "center",
          borderBottom: `1px solid ${BORDER}`,
          background: "rgba(11,15,20,0.9)", backdropFilter: "blur(12px)",
          flexShrink: 0, padding: "0 10px", gap: 5,
        }}>
          {/* Status */}
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "3px 8px", background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.16)", borderRadius: 6,
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e" }} />
            <span style={{ fontSize: 10.5, color: "#4ade80", fontWeight: 500 }}>Draft</span>
          </div>
          <span style={{ fontSize: 10.5, color: MUTED }}>Saved 2m ago</span>

          {/* Agent name (centred) */}
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <input
              defaultValue="Lead Qualification Agent"
              style={{
                background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`,
                borderRadius: 7, padding: "4px 14px", fontSize: 13, fontWeight: 600,
                color: TEXT, textAlign: "center", width: 260, outline: "none",
              }}
            />
          </div>

          {/* Canvas controls + actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {/* ⌘K hint */}
            <div style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 7px", background: "rgba(255,255,255,0.04)",
              border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer", marginRight: 2,
            }}>
              <Command size={10} color={MUTED} />
              <span style={{ fontSize: 10, color: MUTED }}>K</span>
            </div>

            <Btn icon={Wand2}    title="Auto-layout" />
            <Btn icon={ZoomIn}   title="Zoom in" />
            <Btn icon={ZoomOut}  title="Zoom out" />
            <Btn icon={Maximize2}title="Fit view" />

            <div style={{ width: 1, height: 18, background: BORDER, margin: "0 3px" }} />

            <Btn icon={Bookmark}     title="Save as template" />
            <Btn icon={DownloadCloud}title="Export" />

            <div style={{ width: 1, height: 18, background: BORDER, margin: "0 3px" }} />

            <button style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 11px", background: "rgba(255,255,255,0.05)",
              border: `1px solid ${BORDER}`, borderRadius: 6,
              cursor: "pointer", fontSize: 12, fontWeight: 500, color: TEXT,
            }}>
              <Save size={12} /> Save
            </button>

            <button style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 13px", background: ACCENT, border: "none",
              borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
              color: "#fff", boxShadow: "0 0 16px rgba(79,140,255,0.3)",
            }}>
              <Play size={11} /> Deploy
            </button>

            {/* Settings toggle */}
            <button
              onClick={() => setRightCollapsed(!rightCollapsed)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 28, height: 28, borderRadius: 6, border: `1px solid ${BORDER}`,
                cursor: "pointer", marginLeft: 2,
                background: rightCollapsed ? "rgba(79,140,255,0.08)" : "rgba(255,255,255,0.04)",
              }}
            >
              <Settings2 size={13} color={rightCollapsed ? ACCENT : MUTED} />
            </button>
          </div>
        </header>

        {/* ── Builder body ── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* ── Node palette ── */}
          <div style={{
            width: 204, flexShrink: 0, borderRight: `1px solid ${BORDER}`,
            background: "rgba(13,17,23,0.7)", display: "flex", flexDirection: "column",
          }}>
            {/* Tabs */}
            <div style={{ display: "flex", padding: "8px 8px 0", gap: 2 }}>
              {(["nodes", "components"] as const).map(tab => (
                <button key={tab} onClick={() => setLeftTab(tab)} style={{
                  flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 500,
                  background: leftTab === tab ? "rgba(79,140,255,0.08)" : "transparent",
                  color: leftTab === tab ? ACCENT : MUTED,
                  border: leftTab === tab ? `1px solid rgba(79,140,255,0.18)` : "1px solid transparent",
                  borderRadius: 6, cursor: "pointer", textTransform: "capitalize",
                }}>
                  {tab === "nodes"
                    ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Layers size={11} /> Nodes</span>
                    : <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Blocks size={11} /> Components</span>}
                </button>
              ))}
            </div>

            {/* Search */}
            <div style={{ padding: "7px 8px 5px", position: "relative" }}>
              <Search size={11} color={MUTED} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
              <input placeholder="Search nodes…" style={{
                width: "100%", padding: "5px 8px 5px 26px", fontSize: 11,
                background: "rgba(255,255,255,0.04)", border: `1px solid ${BORDER}`,
                borderRadius: 6, color: TEXT, outline: "none", boxSizing: "border-box",
              }} />
            </div>

            {/* Node list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "2px 8px 8px" }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: "rgba(100,116,139,0.7)",
                letterSpacing: "0.12em", textTransform: "uppercase",
                padding: "4px 4px 5px",
              }}>Core Nodes</div>

              {NODE_TYPES.map(node => {
                const Icon = node.icon;
                return (
                  <div key={node.id} draggable style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 7px", borderRadius: 7, cursor: "grab",
                    marginBottom: 1, border: "1px solid transparent",
                  }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "rgba(255,255,255,0.04)";
                      el.style.borderColor = BORDER;
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.background = "transparent";
                      el.style.borderColor = "transparent";
                    }}
                  >
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      background: node.bg, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon size={12} color={node.color} />
                    </div>
                    <span style={{ fontSize: 12, color: TEXT }}>{node.label}</span>
                  </div>
                );
              })}

              <div style={{
                fontSize: 10, fontWeight: 600, color: "rgba(100,116,139,0.7)",
                letterSpacing: "0.12em", textTransform: "uppercase",
                padding: "10px 4px 5px",
              }}>Integrations</div>

              {[
                { label: "Cal.com Booking",  emoji: "📅" },
                { label: "Stripe Payment",   emoji: "💳" },
                { label: "HubSpot CRM",      emoji: "🔗" },
              ].map(i => (
                <div key={i.label} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 7px",
                  borderRadius: 7, cursor: "grab", marginBottom: 1,
                  border: "1px solid transparent", opacity: 0.65,
                }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "rgba(255,255,255,0.04)";
                    el.style.opacity = "1";
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = "transparent";
                    el.style.opacity = "0.65";
                  }}
                >
                  <span style={{ fontSize: 15 }}>{i.emoji}</span>
                  <span style={{ fontSize: 12, color: TEXT }}>{i.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Canvas ── */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {/* Dot grid */}
            <div style={{
              position: "absolute", inset: 0,
              backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)`,
              backgroundSize: "26px 26px",
            }} />
            {/* Vignette */}
            <div style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              background: "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(11,15,20,0.45) 100%)",
            }} />

            {/* Nodes + edges */}
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
              <Edges />
              {CANVAS_NODES.map(n => <CanvasNode key={n.id} node={n} />)}
            </div>

            {/* START label */}
            <div style={{
              position: "absolute", left: 68, top: 162,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
              <div style={{
                padding: "2px 9px", background: "rgba(167,139,250,0.14)",
                border: "1px solid rgba(167,139,250,0.32)", borderRadius: 20,
                fontSize: 9.5, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.08em",
              }}>START</div>
              <ArrowRight size={12} color="rgba(167,139,250,0.6)" />
            </div>

            {/* Bottom mini-toolbar */}
            <div style={{
              position: "absolute", bottom: 14, left: "50%", transform: "translateX(-50%)",
              display: "flex", alignItems: "center", gap: 3,
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 9,
              padding: "3px 7px", boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
            }}>
              <Btn icon={ZoomOut} title="Zoom out" />
              <span style={{ fontSize: 11, color: MUTED, padding: "0 3px" }}>100%</span>
              <Btn icon={ZoomIn}  title="Zoom in" />
              <div style={{ width: 1, height: 14, background: BORDER, margin: "0 2px" }} />
              <Btn icon={Layers} title="Layers" />
              <Btn icon={Map}    title="Minimap" />
            </div>

            {/* Mini-map */}
            <div style={{
              position: "absolute", bottom: 14, right: 14,
              width: 112, height: 72, background: "rgba(13,17,23,0.85)",
              border: `1px solid ${BORDER}`, borderRadius: 7, overflow: "hidden",
            }}>
              <div style={{ transform: "scale(0.14) translate(5px, 5px)", transformOrigin: "top left" }}>
                {CANVAS_NODES.map(n => {
                  const meta = NODE_TYPES.find(t => t.id === n.type)!;
                  return (
                    <div key={n.id} style={{
                      position: "absolute", left: n.x, top: n.y, width: n.w, height: 50,
                      background: meta.bg, border: `2px solid ${meta.color}`,
                      borderRadius: 8, opacity: 0.85,
                    }} />
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Right settings panel ── */}
          {!rightCollapsed && (
            <div style={{
              width: 256, flexShrink: 0, borderLeft: `1px solid ${BORDER}`,
              background: "rgba(13,17,23,0.7)", overflowY: "auto",
              display: "flex", flexDirection: "column",
            }}>
              {/* Panel header */}
              <div style={{
                padding: "9px 14px", borderBottom: `1px solid ${BORDER}`,
                display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
              }}>
                <Settings2 size={13} color={ACCENT} />
                <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>Agent Settings</span>
                <button style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer" }}>
                  <MoreHorizontal size={13} color={MUTED} />
                </button>
              </div>

              <AccordionSection label="Language Model" defaultOpen>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                      Model
                      <span style={{ fontSize: 8.5, color: MUTED, background: "rgba(255,255,255,0.06)", padding: "1px 4px", borderRadius: 3, letterSpacing: "0.05em" }}>builder cost</span>
                    </div>
                    <SelectMock value="GPT-4o · $0.035/min" />
                  </div>
                  <div style={{ width: 56 }}>
                    <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>Temp</div>
                    <div style={{
                      height: 26, borderRadius: 6, border: `1px solid ${BORDER}`,
                      background: "rgba(255,255,255,0.04)", display: "flex",
                      alignItems: "center", justifyContent: "center",
                      fontSize: 11, color: TEXT,
                    }}>0.7</div>
                  </div>
                </div>
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>Global Prompt</div>
                  <div style={{
                    borderRadius: 6, border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.03)", padding: "7px 8px",
                    fontSize: 10, color: MUTED, lineHeight: 1.6, minHeight: 54,
                  }}>
                    You are a helpful AI receptionist for Acme Corp. Always be professional and concise…
                  </div>
                </div>
                <FormRow label="Max Duration"><SelectMock value="30 minutes" /></FormRow>
              </AccordionSection>

              <AccordionSection label="Voice & Language" defaultOpen>
                <FormRow label="Voice"><SelectMock value="Emily — ElevenLabs" /></FormRow>
                <FormRow label="Languages">
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {["EN 🇬🇧", "ES 🇪🇸"].map(l => (
                      <span key={l} style={{
                        padding: "3px 7px", background: "rgba(79,140,255,0.1)",
                        border: "1px solid rgba(79,140,255,0.18)", borderRadius: 5,
                        fontSize: 10, color: "#93c5fd",
                      }}>{l}</span>
                    ))}
                    <button style={{
                      padding: "3px 7px", background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${BORDER}`, borderRadius: 5,
                      fontSize: 10, color: MUTED, cursor: "pointer",
                    }}>+ Add</button>
                  </div>
                </FormRow>
                <SliderMock label="Volume" value={80} />
                <SliderMock label="Speaking Rate" value={62} />
              </AccordionSection>

              <AccordionSection label="Post-Call Data">
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {["customer_name", "intent", "budget_confirmed", "meeting_booked"].map(f => (
                    <div key={f} style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "4px 7px", background: "rgba(255,255,255,0.03)", borderRadius: 5,
                    }}>
                      <Hash size={9} color={MUTED} />
                      <span style={{ fontSize: 10.5, color: TEXT, fontFamily: "monospace" }}>{f}</span>
                    </div>
                  ))}
                  <button style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "5px 7px",
                    background: "transparent", border: `1px dashed ${BORDER}`,
                    borderRadius: 5, fontSize: 10, color: MUTED, cursor: "pointer", marginTop: 2,
                  }}>
                    <Plus size={10} /> Add field
                  </button>
                </div>
              </AccordionSection>

              <AccordionSection label="Booking Config">
                <FormRow label="Provider"><SelectMock value="Cal.com" /></FormRow>
                <FormRow label="Event type"><SelectMock value="Discovery Call (30m)" /></FormRow>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 8px", background: "rgba(52,211,153,0.07)",
                  border: "1px solid rgba(52,211,153,0.14)", borderRadius: 6, marginTop: 4,
                }}>
                  <span style={{ fontSize: 10.5, color: "#6ee7b7" }}>✓ Connected</span>
                  <span style={{ fontSize: 10, color: MUTED }}>cal.com/alex</span>
                </div>
              </AccordionSection>

              <AccordionSection label="Agent Type" defaultOpen>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {[
                    { id: "receptionist",         label: "Receptionist",          desc: "Answers & routes calls",     color: "#4f8cff",  bg: "rgba(79,140,255,0.1)",   border: "rgba(79,140,255,0.25)"  },
                    { id: "lead_generation",       label: "Lead Generation",       desc: "Captures & nurtures leads",  color: "#a78bfa",  bg: "rgba(167,139,250,0.1)",  border: "rgba(167,139,250,0.25)" },
                    { id: "client_qualification",  label: "Client Qualification",  desc: "Qualifies by budget/fit",    color: "#34d399",  bg: "rgba(52,211,153,0.1)",   border: "rgba(52,211,153,0.25)"  },
                  ].map(({ id, label, desc, color, bg, border: bc }) => {
                    const active = id === "lead_generation";
                    return (
                      <div key={id} style={{
                        display: "flex", alignItems: "center", gap: 9,
                        padding: "7px 10px", borderRadius: 8, cursor: "pointer",
                        background: active ? bg : "rgba(255,255,255,0.02)",
                        border: `1px solid ${active ? bc : BORDER}`,
                      }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                          background: active ? color : "rgba(255,255,255,0.15)",
                          boxShadow: active ? `0 0 6px ${color}` : "none",
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: active ? 600 : 400, color: active ? color : TEXT }}>{label}</div>
                          <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>{desc}</div>
                        </div>
                        {active && (
                          <div style={{
                            fontSize: 9, fontWeight: 600, color, letterSpacing: "0.06em",
                            background: bg, border: `1px solid ${bc}`,
                            padding: "1px 6px", borderRadius: 4,
                          }}>ACTIVE</div>
                        )}
                      </div>
                    );
                  })}
                  <p style={{ fontSize: 9.5, color: "#a78bfa", margin: "2px 0 0", paddingLeft: 2 }}>
                    Lead Gen sections active ↓
                  </p>
                </div>
              </AccordionSection>

              <AccordionSection label="Agent Config">
                <FormRow label="Transition"><SelectMock value="Flex Mode" /></FormRow>
                <FormRow label="Start speaker"><SelectMock value="Agent" /></FormRow>
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>Webhook URL</div>
                  <div style={{
                    height: 26, borderRadius: 6, border: `1px solid ${BORDER}`,
                    background: "rgba(255,255,255,0.03)", display: "flex", alignItems: "center",
                    padding: "0 8px", fontSize: 10, color: MUTED,
                  }}>https://hooks.example.com/agent</div>
                </div>
              </AccordionSection>

              <AccordionSection label="Lead Generation" defaultOpen>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 9.5, color: "#a78bfa", fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#a78bfa", boxShadow: "0 0 5px #a78bfa" }} />
                    Intelligence Tracking
                  </div>
                  {[
                    ["Interest level", true],
                    ["Buying intent", true],
                    ["Lead score", true],
                    ["Objections raised", false],
                    ["Next action", true],
                    ["Meeting requested", true],
                    ["Callback requested", false],
                    ["Decision maker status", false],
                  ].map(([label, on]) => (
                    <div key={label as string} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ fontSize: 10.5, color: TEXT }}>{label as string}</span>
                      <div style={{
                        width: 28, height: 15, borderRadius: 8, position: "relative", cursor: "pointer",
                        background: on ? "rgba(167,139,250,0.5)" : "rgba(255,255,255,0.1)",
                        border: `1px solid ${on ? "rgba(167,139,250,0.5)" : BORDER}`,
                      }}>
                        <div style={{
                          position: "absolute", top: 1, width: 11, height: 11, borderRadius: "50%",
                          background: on ? "#a78bfa" : "rgba(255,255,255,0.3)",
                          left: on ? 14 : 1, transition: "left 0.15s",
                        }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>Campaign</div>
                    <SelectMock value="Q3 Outbound — SMB" />
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>Qualification criteria</div>
                    <SelectMock value="Budget ≥ £500/mo" />
                  </div>
                </div>
              </AccordionSection>

              <AccordionSection label="Agent Handbook">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {[
                    ["Echo verification", true],
                    ["Speech normalization", true],
                    ["Default personality", true],
                    ["Scope boundaries", false],
                    ["Natural filler words", true],
                    ["NATO phonetic alphabet", false],
                    ["High empathy", true],
                    ["AI disclosure", false],
                    ["Smart matching", true],
                  ].map(([label, on]) => (
                    <div key={label as string} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0" }}>
                      <span style={{ fontSize: 10.5, color: TEXT }}>{label as string}</span>
                      <div style={{
                        width: 28, height: 15, borderRadius: 8, position: "relative", cursor: "pointer",
                        background: on ? "rgba(79,140,255,0.45)" : "rgba(255,255,255,0.1)",
                        border: `1px solid ${on ? "rgba(79,140,255,0.4)" : BORDER}`,
                      }}>
                        <div style={{
                          position: "absolute", top: 1, width: 11, height: 11, borderRadius: "50%",
                          background: on ? ACCENT : "rgba(255,255,255,0.3)",
                          left: on ? 14 : 1,
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionSection>

              <AccordionSection label="Speech Settings">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { label: "Voice speed", value: "1.0" },
                    { label: "Voice temp", value: "1.0" },
                    { label: "Volume", value: "1.0" },
                    { label: "Responsiveness", value: "0.9" },
                    { label: "Interruption", value: "0.7" },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>{label}</div>
                      <div style={{
                        height: 26, borderRadius: 6, border: `1px solid ${BORDER}`,
                        background: "rgba(255,255,255,0.04)", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        fontSize: 11, color: TEXT,
                      }}>{value}</div>
                    </div>
                  ))}
                  <div>
                    <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 3 }}>Emotion</div>
                    <SelectMock value="Calm" />
                  </div>
                </div>
                <div style={{ marginTop: 6 }}>
                  <FormRow label="STT mode"><SelectMock value="Fast" /></FormRow>
                </div>
              </AccordionSection>

              <AccordionSection label="Variables">
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {[
                    { name: "{{customer_name}}", type: "string" },
                    { name: "{{today}}",         type: "date" },
                    { name: "{{agent_name}}",    type: "string" },
                  ].map(v => (
                    <div key={v.name} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "4px 7px", background: "rgba(255,255,255,0.03)", borderRadius: 5,
                    }}>
                      <span style={{ fontSize: 10.5, fontFamily: "monospace", color: "#c4b5fd" }}>{v.name}</span>
                      <span style={{ fontSize: 9.5, color: MUTED }}>{v.type}</span>
                    </div>
                  ))}
                </div>
              </AccordionSection>

              {/* Live deployment banner */}
              <div style={{
                margin: 10, padding: "9px 11px",
                background: "rgba(79,140,255,0.07)", border: `1px solid rgba(79,140,255,0.16)`,
                borderRadius: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                  <PhoneCallIcon size={11} color={ACCENT} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#93c5fd" }}>Live Deployment</span>
                </div>
                <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.55 }}>
                  +44 7700 900 123<br />
                  <span style={{ color: "#4ade80" }}>● Active</span> · 142 calls this week
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
