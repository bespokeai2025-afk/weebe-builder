import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getWebuyanyhouseLeads,
  getWebuyanyhouseLeadStats,
} from "@/lib/integrations/webespokeEnterprise/wbah.functions";
import {
  Home, Users, PhoneOff, HelpCircle, RefreshCw, ChevronDown,
  ChevronUp, Phone, Mail, MapPin, Pound, Clock, User2, Brain,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Lead = {
  id: string;
  source_section: string;
  lead_name: string | null;
  phone: string | null;
  email: string | null;
  property_address: string | null;
  postcode: string | null;
  expected_price: string | null;
  current_status: string | null;
  assigned_agent: string | null;
  last_call_attempt: string | null;
  call_attempt_count: number | null;
  call_outcome: string | null;
  qualification_status: string | null;
  qualification_summary: string | null;
  sentiment: string | null;
  n8n_workflow_id: string | null;
  notes: string | null;
  raw_payload: unknown;
  synced_at: string;
};

// ── Tabs config ───────────────────────────────────────────────────────────────

const TABS = [
  {
    id: "disqualified",
    label: "Disqualified",
    icon: PhoneOff,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    activeBorder: "border-red-500",
  },
  {
    id: "tried_to_contact",
    label: "Tried To Contact",
    icon: Phone,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
    activeBorder: "border-yellow-500",
  },
  {
    id: "new_lead",
    label: "New Leads",
    icon: Home,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    activeBorder: "border-emerald-500",
  },
  {
    id: "unknown",
    label: "Unknown / Needs Mapping",
    icon: HelpCircle,
    color: "text-gray-400",
    bg: "bg-gray-800",
    border: "border-gray-700",
    activeBorder: "border-gray-500",
  },
] as const;
type TabId = typeof TABS[number]["id"];

// ── Lead card ─────────────────────────────────────────────────────────────────

function LeadCard({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);

  function fmt(v: string | null | undefined, fallback = "Not available") {
    return v?.trim() ? v.trim() : fallback;
  }

  function fmtDate(v: string | null | undefined) {
    if (!v) return "Not available";
    try { return new Date(v).toLocaleString("en-GB"); } catch { return v; }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Summary row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white truncate">
              {fmt(lead.lead_name, "Unnamed Lead")}
            </span>
            {lead.qualification_status && (
              <Badge className="text-[10px] bg-purple-500/20 text-purple-400">
                {lead.qualification_status}
              </Badge>
            )}
            {lead.sentiment && (
              <Badge className="text-[10px] bg-blue-500/20 text-blue-400">
                {lead.sentiment}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {lead.phone && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Phone className="w-3 h-3" />{lead.phone}
              </span>
            )}
            {lead.property_address && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <MapPin className="w-3 h-3" />{lead.property_address}{lead.postcode ? `, ${lead.postcode}` : ""}
              </span>
            )}
            {lead.expected_price && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Pound className="w-3 h-3" />{lead.expected_price}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {lead.current_status && (
            <Badge className="text-[10px] bg-gray-800 text-gray-400 hidden sm:inline-flex">
              {lead.current_status}
            </Badge>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-gray-800 px-4 py-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { icon: User2, label: "Lead Name",            value: fmt(lead.lead_name) },
              { icon: Mail,  label: "Email",                value: fmt(lead.email) },
              { icon: Phone, label: "Phone",                value: fmt(lead.phone) },
              { icon: MapPin,label: "Property Address",     value: fmt(lead.property_address) },
              { icon: MapPin,label: "Postcode",             value: fmt(lead.postcode) },
              { icon: Pound, label: "Expected Price",       value: fmt(lead.expected_price) },
              { icon: User2, label: "Assigned Agent",       value: fmt(lead.assigned_agent) },
              { icon: Brain, label: "Qualification Status", value: fmt(lead.qualification_status) },
              { icon: Clock, label: "Last Call Attempt",    value: fmtDate(lead.last_call_attempt) },
              { icon: Phone, label: "Call Attempts",        value: lead.call_attempt_count != null ? String(lead.call_attempt_count) : "Not available" },
              { icon: Phone, label: "Call Outcome",         value: fmt(lead.call_outcome) },
              { icon: Brain, label: "Sentiment",            value: fmt(lead.sentiment) },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-gray-950 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="w-3 h-3 text-gray-500" />
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
                </div>
                <p className={cn(
                  "text-xs",
                  value === "Not available" ? "text-gray-700 italic" : "text-gray-200",
                )}>{value}</p>
              </div>
            ))}
          </div>

          {lead.notes && (
            <div className="bg-gray-950 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Notes / Summary</p>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}

          {lead.qualification_summary && (
            <div className="bg-gray-950 rounded-lg p-3">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Qualification Summary</p>
              <p className="text-xs text-gray-300 whitespace-pre-wrap">{lead.qualification_summary}</p>
            </div>
          )}

          {lead.n8n_workflow_id && (
            <div className="text-xs text-gray-500">
              n8n Workflow: <span className="font-mono text-gray-400">{lead.n8n_workflow_id}</span>
            </div>
          )}

          <div className="text-[10px] text-gray-700">
            Synced: {fmtDate(lead.synced_at)}
          </div>

          {/* Raw JSON drawer */}
          <div>
            <button
              onClick={() => setRawOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              {rawOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {rawOpen ? "Hide raw payload" : "View raw payload"}
            </button>
            {rawOpen && (
              <pre className="mt-2 text-[9px] bg-gray-950 rounded-lg p-3 overflow-auto max-h-64 text-gray-400 whitespace-pre-wrap break-all border border-gray-800">
                {JSON.stringify(lead.raw_payload, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab panel ─────────────────────────────────────────────────────────────────

function TabPanel({ leads, sectionId, tabConfig }: {
  leads: Lead[];
  sectionId: TabId;
  tabConfig: typeof TABS[number];
}) {
  const filtered = leads.filter(l => l.source_section === sectionId);

  if (sectionId === "new_lead" && !filtered.length) {
    return (
      <div className="text-center py-16 border border-dashed border-gray-800 rounded-xl">
        <Home className="w-10 h-10 mx-auto mb-3 text-emerald-500/20" />
        <p className="text-sm text-gray-500 font-medium">No new leads synced yet</p>
        <p className="text-xs text-gray-700 mt-1">
          New leads will appear here once the source route is confirmed and synced.
        </p>
      </div>
    );
  }

  if (!filtered.length) {
    return (
      <div className="text-center py-14 text-gray-700 border border-dashed border-gray-800 rounded-xl">
        <tabConfig.icon className="w-8 h-8 mx-auto mb-2 opacity-20" />
        <p className="text-sm">No {tabConfig.label.toLowerCase()} yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filtered.map(lead => (
        <LeadCard key={lead.id} lead={lead} />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function WebuyanyhouseLeads() {
  const [tab, setTab] = useState<TabId>("new_lead");

  const getLeadsFn = useServerFn(getWebuyanyhouseLeads);
  const getStatsFn = useServerFn(getWebuyanyhouseLeadStats);

  const leadsQ = useQuery({
    queryKey: ["wbah-leads"],
    queryFn:  () => getLeadsFn(),
    refetchInterval: 120_000,
  });

  const statsQ = useQuery({
    queryKey: ["wbah-lead-stats"],
    queryFn:  () => getStatsFn(),
    refetchInterval: 120_000,
  });

  const leads   = (leadsQ.data ?? []) as Lead[];
  const stats   = statsQ.data;
  const loading = leadsQ.isLoading;

  const countFor = (id: string): number => {
    if (!stats) return leads.filter(l => l.source_section === id).length;
    if (id === "disqualified")     return stats.disqualified;
    if (id === "tried_to_contact") return stats.tried_to_contact;
    if (id === "new_lead")         return stats.new_lead;
    return stats.unknown;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Home className="w-5 h-5 text-emerald-400" />
            Leads
          </h1>
          {stats?.lastSynced && (
            <p className="text-xs text-gray-500 mt-0.5">
              Last synced {new Date(stats.lastSynced).toLocaleString("en-GB")}
              {stats.total > 0 && ` · ${stats.total} records`}
            </p>
          )}
        </div>
        {loading && (
          <RefreshCw className="w-4 h-4 text-gray-500 animate-spin" />
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => {
          const count = countFor(t.id);
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                active
                  ? `${t.bg} ${t.activeBorder} ${t.color}`
                  : "bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700",
              )}
            >
              <t.icon className={cn("w-3.5 h-3.5", active ? t.color : "text-gray-500")} />
              {t.label}
              <span className={cn(
                "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1",
                active ? `${t.bg} ${t.color}` : "bg-gray-800 text-gray-500",
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-gray-500 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading leads…</span>
        </div>
      ) : (
        <TabPanel
          leads={leads}
          sectionId={tab}
          tabConfig={TABS.find(t => t.id === tab)!}
        />
      )}
    </div>
  );
}
