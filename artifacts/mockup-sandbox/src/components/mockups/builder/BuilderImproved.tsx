import { useState } from "react";
import {
  MessageSquare, Zap, PhoneForwarded, GitBranch, User2,
  MessageCircle, Code2, XCircle, StickyNote, Hash,
  Settings2, ChevronRight, ChevronDown, Save, DownloadCloud,
  LayoutGrid, Mic, Brain, Globe, Volume2, Wand2, Play,
  MoreHorizontal, Plus, PanelLeft, AlignLeft, Maximize2,
  Bookmark, Search, Blocks, ArrowRight, PhoneCall, Variable,
  Command, ZoomIn, ZoomOut, Layers, Map
} from "lucide-react";

/* ─── Color system ─────────────────────────────── */
const bg   = "#0b0f14";
const card = "#131c2b";
const border = "rgba(255,255,255,0.07)";
const muted = "rgba(255,255,255,0.35)";

/* ─── Node type catalogue ──────────────────────── */
const NODE_TYPES = [
  { id: "conversation", label: "Conversation", icon: MessageSquare, color: "#4f8cff", bg: "rgba(79,140,255,0.12)" },
  { id: "function",     label: "Function",     icon: Zap,           color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  { id: "transfer",     label: "Call Transfer", icon: PhoneForwarded,color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  { id: "logic",        label: "Logic Split",   icon: GitBranch,     color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  { id: "agent",        label: "Agent Transfer",icon: User2,         color: "#f472b6", bg: "rgba(244,114,182,0.12)" },
  { id: "sms",          label: "In-Call SMS",   icon: MessageCircle, color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  { id: "variable",     label: "Extract Var",   icon: Variable,      color: "#fb923c", bg: "rgba(251,146,60,0.12)" },
  { id: "code",         label: "Code",          icon: Code2,         color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
  { id: "ending",       label: "End Call",      icon: XCircle,       color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  { id: "note",         label: "Note",          icon: StickyNote,    color: "#e2e8f0", bg: "rgba(226,232,240,0.08)" },
];

/* ─── Sample canvas nodes ──────────────────────── */
const CANVAS_NODES = [
  {
    id: "n1", type: "conversation", label: "Welcome",
    x: 200, y: 160, w: 240,
    prompt: "Hi! I'm your AI receptionist. How can I help you today?",
    transitions: ["Booking enquiry", "General question"],
  },
  {
    id: "n2", type: "function", label: "Check Availability",
    x: 520, y: 80, w: 240,
    prompt: "cal_com_check_slots({ date: '{{today}}' })",
    transitions: ["Slots found", "No slots"],
  },
  {
    id: "n3", type: "logic", label: "Route Intent",
    x: 520, y: 300, w: 240,
    prompt: "intent === 'booking' → Booking\nintent === 'support' → Support",
    transitions: ["Booking", "Support", "Other"],
  },
  {
    id: "n4", type: "ending", label: "Goodbye",
    x: 830, y: 200, w: 240,
    prompt: "Thanks for calling! Have a great day.",
    transitions: [],
  },
];

/* ─── Mini node card ───────────────────────────── */
function CanvasNode({ node }: { node: typeof CANVAS_NODES[0] }) {
  const meta = NODE_TYPES.find(t => t.id === node.type)!;
  const Icon = meta.icon;
  return (
    <div
      style={{
        position: "absolute", left: node.x, top: node.y, width: node.w,
        background: card, border: `1px solid ${border}`,
        borderRadius: 12, overflow: "hidden",
        boxShadow: `0 2px 24px rgba(0,0,0,0.4), 0 0 0 1px ${border}`,
      }}
    >
      {/* Node header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", borderBottom: `1px solid ${border}`,
        background: "rgba(255,255,255,0.03)",
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: meta.bg, display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Icon size={12} color={meta.color} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0", flex: 1 }}>{node.label}</span>
        <span style={{ fontSize: 10, color: muted, background: "rgba(255,255,255,0.05)", padding: "1px 6px", borderRadius: 4 }}>
          {meta.label}
        </span>
      </div>

      {/* Prompt preview */}
      <div style={{ padding: "8px 12px", borderBottom: node.transitions.length ? `1px solid ${border}` : "none" }}>
        <p style={{
          fontSize: 10.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.55,
          fontFamily: node.type === "function" || node.type === "code"
            ? "'Fira Code', monospace" : "inherit",
          margin: 0,
        }}>
          {node.prompt}
        </p>
      </div>

      {/* Transitions */}
      {node.transitions.length > 0 && (
        <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
          {node.transitions.map((t) => (
            <div key={t} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "3px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 6,
            }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{t}</span>
              <ArrowRight size={10} color="rgba(255,255,255,0.25)" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Connector SVG lines ──────────────────────── */
function Edges() {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} overflow="visible">
      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="rgba(79,140,255,0.5)" />
        </marker>
      </defs>
      {/* n1 → n2 */}
      <path d={`M ${200+240} ${160+52} C ${480} ${160+52} ${480} ${80+52} ${520} ${80+52}`}
        stroke="rgba(79,140,255,0.35)" strokeWidth="1.5" fill="none" strokeDasharray="none" markerEnd="url(#arr)" />
      {/* n1 → n3 */}
      <path d={`M ${200+240} ${160+80} C ${480} ${160+80} ${480} ${300+52} ${520} ${300+52}`}
        stroke="rgba(79,140,255,0.35)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)" />
      {/* n2 → n4 */}
      <path d={`M ${520+240} ${80+52} C ${780} ${80+52} ${780} ${200+52} ${830} ${200+52}`}
        stroke="rgba(167,139,250,0.35)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)" />
      {/* n3 → n4 */}
      <path d={`M ${520+240} ${300+52} C ${780} ${300+52} ${780} ${200+80} ${830} ${200+80}`}
        stroke="rgba(251,191,36,0.35)" strokeWidth="1.5" fill="none" markerEnd="url(#arr)" />
    </svg>
  );
}

/* ─── Accordion section ────────────────────────── */
function AccordionSection({ label, children, defaultOpen = false }: {
  label: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${border}` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", background: "transparent", border: "none", cursor: "pointer",
          color: "#e2e8f0",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: muted }}>
          {label}
        </span>
        {open ? <ChevronDown size={13} color={muted} /> : <ChevronRight size={13} color={muted} />}
      </button>
      {open && <div style={{ padding: "0 16px 14px" }}>{children}</div>}
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: muted, marginBottom: 4, letterSpacing: "0.04em" }}>{label}</div>
      {children}
    </div>
  );
}

function SelectMock({ value }: { value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "5px 10px", background: "rgba(255,255,255,0.04)", border: `1px solid ${border}`,
      borderRadius: 7, cursor: "pointer",
    }}>
      <span style={{ fontSize: 11, color: "#e2e8f0" }}>{value}</span>
      <ChevronDown size={11} color={muted} />
    </div>
  );
}

function SliderMock({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: muted, marginBottom: 3 }}>{label}</div>
        <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${value}%`, background: "#4f8cff", borderRadius: 2 }} />
          <div style={{
            position: "absolute", top: "50%", left: `${value}%`, transform: "translate(-50%,-50%)",
            width: 10, height: 10, borderRadius: "50%", background: "#fff",
            boxShadow: "0 0 0 2px #4f8cff",
          }} />
        </div>
      </div>
      <span style={{ fontSize: 10, color: "#e2e8f0", minWidth: 24, textAlign: "right" }}>{value}</span>
    </div>
  );
}

/* ─── Main export ──────────────────────────────── */
export function BuilderImproved() {
  const [leftTab, setLeftTab] = useState<"nodes" | "components">("nodes");
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div style={{
      width: "100vw", height: "100vh", display: "flex", flexDirection: "column",
      background: bg, fontFamily: "-apple-system, 'Inter', sans-serif",
      overflow: "hidden", color: "#e2e8f0",
    }}>

      {/* ── TOOLBAR ──────────────────────────────── */}
      <div style={{
        height: 44, display: "flex", alignItems: "center",
        borderBottom: `1px solid ${border}`, background: "rgba(11,15,20,0.95)",
        backdropFilter: "blur(12px)", flexShrink: 0, padding: "0 12px",
        gap: 6,
      }}>
        {/* Left: sidebar toggle + status */}
        <button style={toolBtn()}>
          <PanelLeft size={15} color={muted} />
        </button>
        <div style={{ width: 1, height: 20, background: border, margin: "0 4px" }} />
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "3px 8px", background: "rgba(34,197,94,0.1)", borderRadius: 6,
          border: "1px solid rgba(34,197,94,0.18)",
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e" }} />
          <span style={{ fontSize: 10.5, color: "#4ade80", fontWeight: 500 }}>Draft</span>
        </div>
        <span style={{ fontSize: 10.5, color: muted }}>Saved 2m ago</span>

        {/* Center: agent name */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <input
            defaultValue="Lead Qualification Agent"
            style={{
              background: "rgba(255,255,255,0.04)", border: `1px solid ${border}`,
              borderRadius: 7, padding: "4px 12px", fontSize: 13, fontWeight: 600,
              color: "#f1f5f9", textAlign: "center", width: 260, outline: "none",
            }}
          />
        </div>

        {/* Right: canvas controls + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* Command palette shortcut hint */}
          <div style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 6,
            border: `1px solid ${border}`, cursor: "pointer", marginRight: 4,
          }}>
            <Command size={11} color={muted} />
            <span style={{ fontSize: 10, color: muted }}>K</span>
          </div>

          {[
            { icon: Wand2,    tip: "Auto-layout" },
            { icon: ZoomIn,   tip: "Zoom in" },
            { icon: ZoomOut,  tip: "Zoom out" },
            { icon: Maximize2,tip: "Fit view" },
            { icon: Map,      tip: "Minimap" },
          ].map(({ icon: I, tip }) => (
            <button key={tip} title={tip} style={toolBtn()}>
              <I size={14} color={muted} />
            </button>
          ))}

          <div style={{ width: 1, height: 20, background: border, margin: "0 4px" }} />

          <button style={toolBtn()} title="Templates">
            <Bookmark size={14} color={muted} />
          </button>
          <button style={toolBtn()} title="Export">
            <DownloadCloud size={14} color={muted} />
          </button>

          <div style={{ width: 1, height: 20, background: border, margin: "0 4px" }} />

          {/* Save */}
          <button style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", background: "rgba(255,255,255,0.06)", border: `1px solid ${border}`,
            borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 500, color: "#e2e8f0",
          }}>
            <Save size={13} />
            Save
          </button>

          {/* Deploy */}
          <button style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 14px", background: "#4f8cff", border: "none",
            borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600,
            color: "#fff", boxShadow: "0 0 20px rgba(79,140,255,0.35)",
          }}>
            <Play size={12} />
            Deploy
          </button>

          {/* Right panel toggle */}
          <button
            onClick={() => setRightCollapsed(!rightCollapsed)}
            style={{ ...toolBtn(), marginLeft: 4, background: rightCollapsed ? "rgba(79,140,255,0.12)" : undefined }}
          >
            <Settings2 size={14} color={rightCollapsed ? "#4f8cff" : muted} />
          </button>
        </div>
      </div>

      {/* ── BODY ─────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── LEFT PANEL ─────────────────────────── */}
        <div style={{
          width: 220, flexShrink: 0, borderRight: `1px solid ${border}`,
          background: "rgba(19,28,43,0.6)", display: "flex", flexDirection: "column",
          backdropFilter: "blur(8px)",
        }}>
          {/* Tabs */}
          <div style={{ display: "flex", padding: "8px 8px 0", gap: 2 }}>
            {(["nodes", "components"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setLeftTab(tab)}
                style={{
                  flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 500,
                  background: leftTab === tab ? "rgba(79,140,255,0.12)" : "transparent",
                  color: leftTab === tab ? "#4f8cff" : muted,
                  border: leftTab === tab ? "1px solid rgba(79,140,255,0.2)" : `1px solid transparent`,
                  borderRadius: 6, cursor: "pointer", textTransform: "capitalize",
                }}
              >
                {tab === "nodes" ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Layers size={11} />{tab}</span>
                  : <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Blocks size={11} />{tab}</span>}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ padding: "8px 8px 6px", position: "relative" }}>
            <Search size={12} color={muted} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }} />
            <input
              placeholder="Search nodes…"
              style={{
                width: "100%", padding: "5px 8px 5px 28px", fontSize: 11,
                background: "rgba(255,255,255,0.04)", border: `1px solid ${border}`,
                borderRadius: 6, color: "#e2e8f0", outline: "none", boxSizing: "border-box",
              }}
            />
          </div>

          {/* Node list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 8px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 4px 6px" }}>
              {leftTab === "nodes" ? "Core Nodes" : "Components"}
            </div>
            {NODE_TYPES.filter(n => leftTab === "nodes" || n.id === "function").map((node) => {
              const Icon = node.icon;
              return (
                <div
                  key={node.id}
                  draggable
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 8px", borderRadius: 8, cursor: "grab",
                    marginBottom: 2, transition: "background 0.12s",
                    border: `1px solid transparent`,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                    (e.currentTarget as HTMLElement).style.borderColor = border;
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.borderColor = "transparent";
                  }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                    background: node.bg, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon size={13} color={node.color} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: "#e2e8f0" }}>{node.label}</div>
                  </div>
                  <div style={{ marginLeft: "auto", opacity: 0 }} className="drag-hint">
                    <Plus size={11} color={muted} />
                  </div>
                </div>
              );
            })}

            {leftTab === "nodes" && (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, color: muted, letterSpacing: "0.1em", textTransform: "uppercase", padding: "10px 4px 6px" }}>
                  Integrations
                </div>
                {[
                  { label: "Cal.com Booking", icon: "📅", color: "#4f8cff" },
                  { label: "Stripe Payment", icon: "💳", color: "#34d399" },
                  { label: "HubSpot CRM", icon: "🔗", color: "#f97316" },
                ].map((i) => (
                  <div key={i.label} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "7px 8px",
                    borderRadius: 8, cursor: "grab", marginBottom: 2,
                    border: "1px solid transparent", opacity: 0.7,
                  }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                      (e.currentTarget as HTMLElement).style.opacity = "1";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.opacity = "0.7";
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{i.icon}</span>
                    <span style={{ fontSize: 11, color: "#e2e8f0" }}>{i.label}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── CANVAS ──────────────────────────────── */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {/* Grid background */}
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)`,
            backgroundSize: "28px 28px",
          }} />

          {/* Subtle gradient vignette */}
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(11,15,20,0.5) 100%)",
            pointerEvents: "none",
          }} />

          {/* Canvas content */}
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <Edges />
            {CANVAS_NODES.map(n => <CanvasNode key={n.id} node={n} />)}
          </div>

          {/* Start indicator */}
          <div style={{
            position: "absolute", left: 120, top: 190,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          }}>
            <div style={{
              padding: "3px 10px", background: "rgba(79,140,255,0.15)", border: "1px solid rgba(79,140,255,0.3)",
              borderRadius: 20, fontSize: 10, fontWeight: 600, color: "#4f8cff",
            }}>START</div>
            <ArrowRight size={14} color="rgba(79,140,255,0.5)" />
          </div>

          {/* Canvas toolbar (bottom) */}
          <div style={{
            position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
            display: "flex", alignItems: "center", gap: 4,
            background: card, border: `1px solid ${border}`, borderRadius: 10,
            padding: "4px 8px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}>
            {[
              { icon: ZoomOut, label: "Zoom out" },
              null,
              { icon: ZoomIn, label: "Zoom in" },
            ].map((item, i) =>
              item === null ? (
                <span key={i} style={{ fontSize: 11, color: muted, padding: "0 4px" }}>100%</span>
              ) : (
                <button key={item.label} title={item.label} style={toolBtn()}>
                  <item.icon size={13} color={muted} />
                </button>
              )
            )}
            <div style={{ width: 1, height: 16, background: border, margin: "0 2px" }} />
            {[Layers, Map].map((Icon, i) => (
              <button key={i} style={toolBtn()}>
                <Icon size={13} color={muted} />
              </button>
            ))}
          </div>

          {/* Mini map */}
          <div style={{
            position: "absolute", bottom: 16, right: 16,
            width: 120, height: 80,
            background: "rgba(19,28,43,0.85)", border: `1px solid ${border}`,
            borderRadius: 8, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ position: "relative", width: 100, height: 60, transform: "scale(0.18)", transformOrigin: "top left", left: 5, top: 5 }}>
              {CANVAS_NODES.map(n => {
                const meta = NODE_TYPES.find(t => t.id === n.type)!;
                return (
                  <div key={n.id} style={{
                    position: "absolute", left: n.x, top: n.y, width: n.w, height: 48,
                    background: meta.bg, border: `2px solid ${meta.color}`,
                    borderRadius: 8, opacity: 0.8,
                  }} />
                );
              })}
            </div>
          </div>
        </div>

        {/* ── RIGHT SETTINGS PANEL ─────────────────── */}
        {!rightCollapsed && (
          <div style={{
            width: 268, flexShrink: 0, borderLeft: `1px solid ${border}`,
            background: "rgba(19,28,43,0.6)", overflowY: "auto",
            backdropFilter: "blur(8px)", display: "flex", flexDirection: "column",
          }}>
            {/* Panel header */}
            <div style={{
              padding: "10px 16px", borderBottom: `1px solid ${border}`,
              display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
            }}>
              <Settings2 size={13} color="#4f8cff" />
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#e2e8f0" }}>Agent Settings</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button style={toolBtn()}>
                  <MoreHorizontal size={13} color={muted} />
                </button>
              </div>
            </div>

            {/* Accordion sections */}
            <AccordionSection label="Language Model" defaultOpen>
              <FormRow label="Model">
                <SelectMock value="GPT-4o" />
              </FormRow>
              <SliderMock label="Responsiveness" value={72} />
              <SliderMock label="Interruption Sensitivity" value={45} />
              <FormRow label="Max Duration">
                <SelectMock value="30 minutes" />
              </FormRow>
            </AccordionSection>

            <AccordionSection label="Voice & Language" defaultOpen>
              <FormRow label="Voice">
                <div style={{ display: "flex", gap: 6 }}>
                  <SelectMock value="Emily — ElevenLabs" />
                </div>
              </FormRow>
              <FormRow label="Languages">
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["EN 🇬🇧", "ES 🇪🇸"].map(l => (
                    <span key={l} style={{
                      padding: "3px 8px", background: "rgba(79,140,255,0.12)", border: "1px solid rgba(79,140,255,0.2)",
                      borderRadius: 5, fontSize: 10, color: "#93c5fd",
                    }}>{l}</span>
                  ))}
                  <button style={{
                    padding: "3px 7px", background: "rgba(255,255,255,0.04)", border: `1px solid ${border}`,
                    borderRadius: 5, fontSize: 10, color: muted, cursor: "pointer",
                  }}>+ Add</button>
                </div>
              </FormRow>
              <SliderMock label="Volume" value={80} />
              <SliderMock label="Speaking Rate" value={62} />
            </AccordionSection>

            <AccordionSection label="Post-Call Data">
              <FormRow label="Capture fields">
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {["customer_name", "intent", "budget_confirmed", "meeting_booked"].map(f => (
                    <div key={f} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "4px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 5,
                    }}>
                      <Hash size={10} color={muted} />
                      <span style={{ fontSize: 10.5, color: "#e2e8f0", fontFamily: "monospace" }}>{f}</span>
                    </div>
                  ))}
                  <button style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "5px 8px",
                    background: "transparent", border: `1px dashed ${border}`,
                    borderRadius: 5, fontSize: 10, color: muted, cursor: "pointer",
                  }}>
                    <Plus size={10} /> Add field
                  </button>
                </div>
              </FormRow>
            </AccordionSection>

            <AccordionSection label="Booking Config">
              <FormRow label="Provider">
                <SelectMock value="Cal.com" />
              </FormRow>
              <FormRow label="Event type">
                <SelectMock value="Discovery Call (30m)" />
              </FormRow>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 8px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)",
                borderRadius: 7, marginTop: 4,
              }}>
                <span style={{ fontSize: 10.5, color: "#6ee7b7" }}>✓ Connected</span>
                <span style={{ fontSize: 10, color: muted }}>cal.com/alex</span>
              </div>
            </AccordionSection>

            <AccordionSection label="Variables">
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {[
                  { name: "{{customer_name}}", type: "string" },
                  { name: "{{today}}", type: "date" },
                  { name: "{{agent_name}}", type: "string" },
                ].map(v => (
                  <div key={v.name} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "4px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 5,
                  }}>
                    <span style={{ fontSize: 10.5, fontFamily: "monospace", color: "#c4b5fd" }}>{v.name}</span>
                    <span style={{ fontSize: 9.5, color: muted }}>{v.type}</span>
                  </div>
                ))}
              </div>
            </AccordionSection>

            {/* Deploy status banner */}
            <div style={{
              margin: 12, padding: "10px 12px",
              background: "rgba(79,140,255,0.08)", border: "1px solid rgba(79,140,255,0.18)",
              borderRadius: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <PhoneCall size={12} color="#4f8cff" />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#93c5fd" }}>Live Deployment</span>
              </div>
              <div style={{ fontSize: 10, color: muted, lineHeight: 1.5 }}>
                +44 7700 900 123<br />
                <span style={{ color: "#4ade80" }}>● Active</span> · 142 calls this week
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Utility ─────────────────────────────────── */
function toolBtn(extra?: React.CSSProperties): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 30, height: 30, borderRadius: 7, background: "transparent",
    border: "1px solid transparent", cursor: "pointer",
    transition: "background 0.12s, border-color 0.12s",
    ...extra,
  };
}
