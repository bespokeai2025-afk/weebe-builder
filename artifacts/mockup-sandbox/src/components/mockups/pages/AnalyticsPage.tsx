import React from 'react';
import {
  LayoutDashboard, BarChart3, LayoutGrid, Workflow, LayoutTemplate,
  Database, UserCheck, Check, PhoneCall, CalendarDays, MessageSquare,
  CreditCard, Settings, ChevronDown, RefreshCw, Phone, Clock, Timer,
  TrendingUp
} from 'lucide-react';

export function AnalyticsPage() {
  const font = "Inter, -apple-system, sans-serif";
  const bg = "#0b0f14";
  const sidebarBg = "#0d1117";
  const cardBg = "#131c2b";
  const border = "rgba(255,255,255,0.06)";
  const muted = "#64748b";
  const text = "#e2e8f0";
  const accent = "#4f8cff";

  const navItems = [
    { name: "Dashboard", icon: LayoutDashboard },
    { name: "Analytics", icon: BarChart3, active: true },
    { name: "Agents", icon: LayoutGrid },
    { name: "Builder", icon: Workflow },
    { name: "Templates", icon: LayoutTemplate },
    { name: "Data", icon: Database },
    { name: "Leads", icon: UserCheck },
    { name: "Qualified", icon: Check },
    { name: "Calls", icon: PhoneCall },
    { name: "Calendar", icon: CalendarDays },
    { name: "WhatsApp", icon: MessageSquare },
    { name: "Billing", icon: CreditCard },
  ];

  return (
    <div style={{ display: 'flex', width: '100%', minHeight: '100vh', backgroundColor: bg, color: text, fontFamily: font }}>
      {/* Sidebar */}
      <div style={{ width: '208px', backgroundColor: sidebarBg, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Workspace Switcher */}
        <div style={{ padding: '16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '6px', backgroundColor: 'rgba(79,140,255,0.15)', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '14px' }}>W</div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '14px', fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Webee</div>
            <div style={{ fontSize: '12px', color: muted, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>Admin · Pro</div>
          </div>
          <ChevronDown size={14} color={muted} />
        </div>

        {/* Nav Items */}
        <div style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
          {navItems.map((item) => (
            <div key={item.name} style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
              backgroundColor: item.active ? 'rgba(79,140,255,0.08)' : 'transparent',
              color: item.active ? text : muted,
              fontWeight: item.active ? 500 : 400,
              position: 'relative'
            }}>
              {item.active && <div style={{ position: 'absolute', left: 0, top: '4px', bottom: '4px', width: '2px', backgroundColor: accent, borderRadius: '0 2px 2px 0' }} />}
              <item.icon size={16} />
              <span style={{ fontSize: '13px' }}>{item.name}</span>
            </div>
          ))}
        </div>

        {/* Bottom Profile */}
        <div style={{ padding: '16px', borderTop: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: cardBg, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: muted }}>WA</div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '12px', color: muted, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>workspace@email.com</div>
          </div>
          <Settings size={14} color={muted} style={{ cursor: 'pointer' }} />
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <header style={{ height: '44px', borderBottom: `1px solid ${border}`, backgroundColor: 'rgba(11,15,20,0.9)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', flexShrink: 0 }}>
          <div style={{ fontSize: '13px', color: muted }}>Analytics</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}><RefreshCw size={14} color={muted} /></button>
            <div style={{ height: '16px', width: '1px', backgroundColor: border }}></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: text, cursor: 'pointer' }}>
              All Agents <ChevronDown size={14} color={muted} />
            </div>
            <div style={{ height: '16px', width: '1px', backgroundColor: border }}></div>
            <div style={{ display: 'flex', background: cardBg, border: `1px solid ${border}`, borderRadius: '6px', overflow: 'hidden' }}>
              {['7d', '30d', '60d', '90d'].map(d => (
                <div key={d} style={{ padding: '4px 10px', fontSize: '12px', cursor: 'pointer', backgroundColor: d === '7d' ? 'rgba(79,140,255,0.1)' : 'transparent', color: d === '7d' ? accent : muted }}>{d}</div>
              ))}
            </div>
          </div>
        </header>

        {/* Scrollable Area */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Primary KPI Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {[
              { label: 'Total Calls', val: '1,847', icon: Phone, color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
              { label: 'Minutes Used', val: '3,241', icon: Clock, color: '#a78bfa', bg: 'rgba(167,139,250,0.1)' },
              { label: 'Avg Duration', val: '1m 45s', icon: Timer, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
              { label: 'Success Rate', val: '68%', icon: TrendingUp, color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
            ].map(kpi => (
              <div key={kpi.label} style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '8px', backgroundColor: kpi.bg, color: kpi.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <kpi.icon size={20} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', color: muted, marginBottom: '4px' }}>{kpi.label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 600 }}>{kpi.val}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Secondary KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
            {[
              { label: 'Inbound', val: '924' },
              { label: 'Outbound', val: '923' },
              { label: 'Voicemails', val: '147' },
              { label: 'Unsuccessful', val: '312' },
            ].map(kpi => (
              <div key={kpi.label} style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '8px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', color: muted }}>{kpi.label}</div>
                <div style={{ fontSize: '15px', fontWeight: 500 }}>{kpi.val}</div>
              </div>
            ))}
          </div>

          {/* Charts Section */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: '0 0 60%', backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '20px' }}>Calls per Day</div>
              <div style={{ flex: 1, minHeight: '200px', position: 'relative' }}>
                <svg width="100%" height="100%" viewBox="0 0 800 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="area-gradient" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(79,140,255,0.2)" />
                      <stop offset="100%" stopColor="rgba(79,140,255,0)" />
                    </linearGradient>
                  </defs>
                  <path d="M0,180 L0,150 L60,130 L120,160 L180,110 L240,140 L300,90 L360,110 L420,70 L480,80 L540,50 L600,60 L660,30 L720,40 L800,10 L800,180 Z" fill="url(#area-gradient)" />
                  <path d="M0,150 L60,130 L120,160 L180,110 L240,140 L300,90 L360,110 L420,70 L480,80 L540,50 L600,60 L660,30 L720,40 L800,10" fill="none" stroke="#4f8cff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                </svg>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontSize: '11px', color: muted }}>
                  <span>Mon 1</span><span>Wed 3</span><span>Fri 5</span><span>Sun 7</span><span>Tue 9</span><span>Thu 11</span><span>Sat 13</span>
                </div>
              </div>
            </div>

            <div style={{ flex: '0 0 calc(40% - 16px)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ flex: 1, backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '16px' }}>User Sentiment</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { label: 'Positive', val: '52%', color: '#34d399' },
                      { label: 'Neutral', val: '28%', color: '#fbbf24' },
                      { label: 'Negative', val: '12%', color: '#f87171' },
                      { label: 'Unknown', val: '8%', color: '#64748b' }
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color }}></div><span style={{ color: muted }}>{item.label}</span></div>
                        <span>{item.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ width: '100px', height: '100px', position: 'relative', flexShrink: 0, marginLeft: '16px' }}>
                  <svg viewBox="0 0 42 42" width="100%" height="100%">
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke={border} strokeWidth="4"></circle>
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#34d399" strokeWidth="4" strokeDasharray="52 48" strokeDashoffset="25"></circle>
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#fbbf24" strokeWidth="4" strokeDasharray="28 72" strokeDashoffset="-27"></circle>
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#f87171" strokeWidth="4" strokeDasharray="12 88" strokeDashoffset="-55"></circle>
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#64748b" strokeWidth="4" strokeDasharray="8 92" strokeDashoffset="-67"></circle>
                  </svg>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 600 }}>1.8k</div>
                </div>
              </div>

              <div style={{ flex: 1, backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', padding: '16px', display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '16px' }}>Call Types</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { label: 'Inbound', val: '50%', color: '#4f8cff' },
                      { label: 'Outbound', val: '50%', color: '#a78bfa' },
                    ].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color }}></div><span style={{ color: muted }}>{item.label}</span></div>
                        <span>{item.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ width: '100px', height: '100px', position: 'relative', flexShrink: 0, marginLeft: '16px' }}>
                  <svg viewBox="0 0 42 42" width="100%" height="100%">
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke={border} strokeWidth="4"></circle>
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#4f8cff" strokeWidth="4" strokeDasharray="50 50" strokeDashoffset="25"></circle>
                    <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#a78bfa" strokeWidth="4" strokeDasharray="50 50" strokeDashoffset="-25"></circle>
                  </svg>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 600 }}>100%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Horizontal Bar Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            {[
              {
                title: 'Call Status',
                items: [
                  { label: 'Completed', val: '80%' },
                  { label: 'Voicemail', val: '45%' },
                  { label: 'No Answer', val: '30%' },
                  { label: 'Failed', val: '15%' }
                ]
              },
              {
                title: 'Disconnection Reasons',
                items: [
                  { label: 'User Hung Up', val: '60%' },
                  { label: 'Agent Ended', val: '30%' },
                  { label: 'Network Issue', val: '15%' },
                  { label: 'System Error', val: '5%' }
                ]
              }
            ].map(section => (
              <div key={section.title} style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', padding: '20px' }}>
                <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '20px' }}>{section.title}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {section.items.map(item => (
                    <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span style={{ color: muted }}>{item.label}</span>
                        <span>{item.val}</span>
                      </div>
                      <div style={{ width: '100%', height: '6px', backgroundColor: border, borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: item.val, height: '100%', backgroundColor: accent, borderRadius: '3px' }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Latency Tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {[
              { label: 'LLM P50', val: '312', unit: 'ms' },
              { label: 'End-to-end P50', val: '890', unit: 'ms' },
              { label: 'TTS P50', val: '178', unit: 'ms' },
            ].map(kpi => (
              <div key={kpi.label} style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: '12px', color: muted, marginBottom: '8px' }}>{kpi.label}</div>
                <div style={{ fontSize: '24px', fontWeight: 600 }}>{kpi.val}<span style={{ fontSize: '14px', color: muted, marginLeft: '2px', fontWeight: 400 }}>{kpi.unit}</span></div>
              </div>
            ))}
          </div>

          {/* Per-agent Table */}
          <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '12px 20px', borderBottom: `1px solid ${border}`, fontSize: '10px', textTransform: 'uppercase', color: muted, fontWeight: 500, letterSpacing: '0.05em' }}>
              <div>Agent</div>
              <div>Calls</div>
              <div>Talk Time</div>
              <div>Minutes</div>
              <div>Status</div>
            </div>
            {[
              { name: 'Sales SDR - US', calls: '842', time: '1m 24s', min: '1,178', status: 'Active', color: '#10b981' },
              { name: 'Support Tier 1', calls: '621', time: '2m 15s', min: '1,397', status: 'Active', color: '#10b981' },
              { name: 'Outbound Qualification', calls: '384', time: '1m 45s', min: '672', status: 'Paused', color: '#f59e0b' },
            ].map((row, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', padding: '0 20px', height: '44px', alignItems: 'center', borderBottom: i < 2 ? `1px solid ${border}` : 'none', fontSize: '13px' }}>
                <div style={{ fontWeight: 500 }}>{row.name}</div>
                <div>{row.calls}</div>
                <div>{row.time}</div>
                <div>{row.min}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: muted }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: row.color }}></div>
                  {row.status}
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
