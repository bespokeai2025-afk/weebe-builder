import { Component, useState, useMemo, useEffect } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Compass, Loader2, RefreshCw, Send, Trash2, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Target, Megaphone, BarChart3, Globe, Video,
  Search, Mail, Phone, FileText, Layers, Zap, TrendingUp, DollarSign,
  AlertTriangle, Package, Trophy, Users, Clock, Sparkles, PlayCircle,
  CalendarDays, Star, ArrowRight, Shield, Edit2, Save,
} from "lucide-react";
import { GrowthMindShell } from "./GrowthMindShell";
import { cn } from "@/lib/utils";
import {
  generateStrategyCentre, listStrategyCentre,
  sendStrategyCentreToHiveMind, approveStrategyCentre,
  rejectStrategyCentre, deleteStrategyCentre,
  updateStrategyCentre, getStrategyTasks, getStrategyAssets,
  updateStrategyTask,
  type StrategyCentre,
} from "@/lib/growthmind/growthmind.strategy-centre";

// ── Error boundary ───────────────────────────────────────────────────────────────

class StrategyErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, message: err.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <p className="text-sm font-medium text-red-300">Failed to render strategy</p>
          <p className="text-xs text-muted-foreground">{this.state.message}</p>
          <button
            className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.08] transition-colors"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        h1:     ({ children }) => <p className="font-bold text-foreground mb-1.5 mt-2 first:mt-0">{children}</p>,
        h2:     ({ children }) => <p className="font-semibold text-foreground/90 mb-1 mt-2 first:mt-0">{children}</p>,
        h3:     ({ children }) => <p className="font-medium text-foreground/80 mb-0.5 mt-1.5 first:mt-0">{children}</p>,
        ul:     ({ children }) => <ul className="list-disc pl-4 space-y-0.5 mb-2">{children}</ul>,
        ol:     ({ children }) => <ol className="list-decimal pl-4 space-y-0.5 mb-2">{children}</ol>,
        li:     ({ children }) => <li>{children}</li>,
        strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
        em:     ({ children }) => <em className="text-foreground/80">{children}</em>,
        code:   ({ children }) => <code className="bg-white/[0.06] rounded px-1 py-0.5 text-[11px]">{children}</code>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ── Strategy type definitions ────────────────────────────────────────────────────

type StrategyCentreType =
  | "30_day" | "60_day" | "90_day"
  | "seo_campaign" | "meta_ads" | "google_ads" | "linkedin"
  | "whatsapp_campaign" | "hexmail_campaign"
  | "video_ad" | "ai_calling_campaign" | "landing_page_campaign"
  | "full_multi_channel";

const STRATEGY_TYPES: {
  id: StrategyCentreType; label: string; desc: string;
  icon: React.ElementType; color: string; group: string;
}[] = [
  { id: "30_day",               label: "30-Day Growth",      desc: "Fast-action growth plan",            icon: CalendarDays, color: "text-emerald-400", group: "Growth Plans" },
  { id: "60_day",               label: "60-Day Growth",      desc: "Mid-term campaign strategy",         icon: CalendarDays, color: "text-emerald-400", group: "Growth Plans" },
  { id: "90_day",               label: "90-Day Growth",      desc: "Full-quarter execution roadmap",     icon: CalendarDays, color: "text-emerald-400", group: "Growth Plans" },
  { id: "seo_campaign",         label: "SEO Campaign",       desc: "Organic search dominance",           icon: Search,       color: "text-blue-400",    group: "Campaigns" },
  { id: "meta_ads",             label: "Meta Ads",           desc: "Facebook & Instagram campaigns",     icon: Megaphone,    color: "text-blue-400",    group: "Campaigns" },
  { id: "google_ads",           label: "Google Ads",         desc: "Search & display advertising",       icon: Globe,        color: "text-yellow-400",  group: "Campaigns" },
  { id: "linkedin",             label: "LinkedIn",           desc: "B2B audience & content strategy",    icon: Target,       color: "text-blue-400",    group: "Campaigns" },
  { id: "whatsapp_campaign",    label: "WhatsApp",           desc: "Broadcast & follow-up sequences",    icon: Phone,        color: "text-emerald-400", group: "Channels" },
  { id: "hexmail_campaign",     label: "HexMail",            desc: "Email nurture & broadcast",          icon: Mail,         color: "text-purple-400",  group: "Channels" },
  { id: "video_ad",             label: "Video Ad",           desc: "Video scripts & ad creative briefs", icon: Video,        color: "text-pink-400",    group: "Channels" },
  { id: "ai_calling_campaign",  label: "AI Calling",         desc: "Calling scripts & qualification",    icon: Phone,        color: "text-orange-400",  group: "Channels" },
  { id: "landing_page_campaign",label: "Landing Page",       desc: "High-conversion page strategy",      icon: FileText,     color: "text-cyan-400",    group: "Channels" },
  { id: "full_multi_channel",   label: "Full Multi-Channel", desc: "All engines — complete campaign",     icon: Layers,       color: "text-amber-400",   group: "Full" },
];

const GROUPS = ["Growth Plans", "Campaigns", "Channels", "Full"] as const;

const ENGINE_ICONS: Record<string, React.ElementType> = {
  seo:              Search,
  content_studio:   Sparkles,
  video_studio:     Video,
  campaign_factory: Megaphone,
  whatsapp:         Phone,
  hexmail:          Mail,
  ai_calling:       Phone,
  landing_page:     FileText,
};

const ENGINE_LABELS: Record<string, string> = {
  seo:              "SEO Engine",
  content_studio:   "Content Studio",
  video_studio:     "Video Studio",
  campaign_factory: "Campaign Factory",
  whatsapp:         "WhatsApp Engine",
  hexmail:          "HexMail Engine",
  ai_calling:       "AI Calling Engine",
  landing_page:     "Landing Page Engine",
};

const STATUS_STYLES: Record<string, string> = {
  draft:                "bg-white/[0.06] text-muted-foreground",
  proposed_to_hivemind: "bg-amber-500/15 text-amber-300",
  approved:             "bg-emerald-500/15 text-emerald-300",
  rejected:             "bg-red-500/15 text-red-300",
  in_progress:          "bg-blue-500/15 text-blue-300",
  executed:             "bg-purple-500/15 text-purple-300",
  archived:             "bg-white/[0.04] text-muted-foreground/50",
};

const STATUS_LABELS: Record<string, string> = {
  draft:                "Draft",
  proposed_to_hivemind: "Awaiting HiveMind",
  approved:             "Approved",
  rejected:             "Rejected",
  in_progress:          "In Progress",
  executed:             "Executed",
  archived:             "Archived",
};

// ── Sub-components ───────────────────────────────────────────────────────────────

function Section({
  title, icon: Icon, children, defaultOpen = true,
}: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 py-3 text-sm text-muted-foreground leading-relaxed">{children}</div>}
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "text-emerald-400 bg-emerald-500/10" : pct >= 60 ? "text-yellow-400 bg-yellow-500/10" : "text-red-400 bg-red-500/10";
  return (
    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", color)}>
      {pct}%
    </span>
  );
}

// ── Full strategy display ────────────────────────────────────────────────────────

type EditableFields = {
  executiveSummary:      string;
  selectedService:       string;
  targetAudience:        string;
  budgetRecommendation:  string;
  expectedOutcome:       string;
  channelRecommendation: string;
};

function StrategyDisplay({
  strategy, onApprove, onReject, onSend, onDelete, onRegenerate, onEdit,
}: {
  strategy: StrategyCentre;
  onApprove: () => void;
  onReject: () => void;
  onSend: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onEdit: (fields: Partial<EditableFields>) => Promise<void>;
}) {
  const tasksFn      = useServerFn(getStrategyTasks);
  const assetsFn     = useServerFn(getStrategyAssets);
  const taskUpdateFn = useServerFn(updateStrategyTask);
  const qcInner      = useQueryClient();

  const { data: tasksData,  isLoading: tasksLoading,  isError: tasksError  } = useQuery({
    queryKey:  ["strategy-tasks", strategy.id],
    queryFn:   () => tasksFn({ data: { strategyId: strategy.id } }),
    enabled:   strategy.status === "approved",
    staleTime: 30_000,
  });
  const { data: assetsData, isLoading: assetsLoading, isError: assetsError } = useQuery({
    queryKey:  ["strategy-assets", strategy.id],
    queryFn:   () => assetsFn({ data: { strategyId: strategy.id } }),
    staleTime: 60_000,
  });

  const tasks  = tasksData?.tasks  ?? [];
  const assets = assetsData?.assets ?? [];

  async function handleTaskToggle(taskId: string, currentStatus: string) {
    const nextStatus = currentStatus === "completed" ? "pending" : "completed";
    try {
      await taskUpdateFn({ data: { taskId, status: nextStatus as "pending" | "completed" } });
      await qcInner.invalidateQueries({ queryKey: ["strategy-tasks", strategy.id] });
    } catch {
      toast.error("Failed to update task");
    }
  }

  const [sending,      setSending]      = useState(false);
  const [approving,    setApproving]    = useState(false);
  const [rejecting,    setRejecting]    = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [editing,      setEditing]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [editFields,   setEditFields]   = useState<EditableFields>({
    executiveSummary:      strategy.executiveSummary          ?? "",
    selectedService:       strategy.selectedService           ?? "",
    targetAudience:        strategy.targetAudience            ?? "",
    budgetRecommendation:  strategy.budgetRecommendation      ?? "",
    expectedOutcome:       strategy.expectedOutcome           ?? "",
    channelRecommendation: strategy.channelRecommendation.join(", "),
  });

  useEffect(() => {
    setEditFields({
      executiveSummary:      strategy.executiveSummary          ?? "",
      selectedService:       strategy.selectedService           ?? "",
      targetAudience:        strategy.targetAudience            ?? "",
      budgetRecommendation:  strategy.budgetRecommendation      ?? "",
      expectedOutcome:       strategy.expectedOutcome           ?? "",
      channelRecommendation: strategy.channelRecommendation.join(", "),
    });
  }, [strategy.id, strategy.updatedAt]);

  const typeLabel = STRATEGY_TYPES.find(t => t.id === strategy.strategyType)?.label ?? strategy.strategyType;

  const wrap = (fn: () => void, set: (v: boolean) => void) => async () => {
    set(true);
    try { await fn(); } finally { set(false); }
  };

  const planSections: { title: string; icon: React.ElementType; content: string }[] = [
    { title: "Campaign Plan",   icon: Megaphone,   content: strategy.campaignPlan },
    { title: "Content Plan",    icon: Sparkles,    content: strategy.contentPlan },
    { title: "SEO Plan",        icon: Search,      content: strategy.seoPlan },
    { title: "Video Plan",      icon: Video,       content: strategy.videoPlan },
    { title: "WhatsApp Plan",   icon: Phone,       content: strategy.whatsappPlan },
    { title: "Email Plan",      icon: Mail,        content: strategy.emailPlan },
    { title: "AI Calling Plan", icon: Phone,       content: strategy.aiCallingPlan },
    { title: "Landing Page",    icon: FileText,    content: strategy.landingPagePlan },
  ].filter(s => s.content?.trim());

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{typeLabel}</h2>
            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", STATUS_STYLES[strategy.status])}>
              {STATUS_LABELS[strategy.status] ?? strategy.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generated {new Date(strategy.createdAt).toLocaleDateString()} · {Math.round(strategy.confidenceScore * 100)}% confidence
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {strategy.status === "draft" && (
            <>
              <button
                onClick={wrap(onSend, setSending)}
                disabled={sending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 transition-colors disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Send to HiveMind
              </button>
              <button
                onClick={wrap(onApprove, setApproving)}
                disabled={approving}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 transition-colors disabled:opacity-50"
              >
                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve
              </button>
              <button
                onClick={wrap(onReject, setRejecting)}
                disabled={rejecting}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
              >
                {rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                Reject
              </button>
            </>
          )}
          {strategy.status === "proposed_to_hivemind" && (
            <>
              <button
                onClick={wrap(onApprove, setApproving)}
                disabled={approving}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 transition-colors disabled:opacity-50"
              >
                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve
              </button>
              <button
                onClick={wrap(onReject, setRejecting)}
                disabled={rejecting}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-50"
              >
                {rejecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                Reject
              </button>
            </>
          )}
          <button
            onClick={wrap(onRegenerate, setRegenerating)}
            disabled={regenerating}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-white/[0.05] hover:bg-white/[0.08] text-muted-foreground transition-colors disabled:opacity-50"
          >
            {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Regenerate
          </button>
          <button
            onClick={() => setEditing(v => !v)}
            title="Edit key fields"
            className={cn(
              "p-1.5 rounded transition-colors",
              editing
                ? "text-blue-400 bg-blue-500/10"
                : "text-muted-foreground hover:text-blue-400",
            )}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={wrap(onDelete, setDeleting)}
            disabled={deleting}
            className="p-1.5 rounded text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Inline Edit Panel */}
      {editing && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-4 space-y-3">
          <p className="text-[10px] text-blue-400 uppercase tracking-widest font-semibold flex items-center gap-1.5">
            <Edit2 className="h-3 w-3" /> Edit Strategy
          </p>
          <p className="text-[10px] text-muted-foreground/50 italic">
            Strategy type is fixed — regenerate to change it.
          </p>
          {(
            [
              { label: "Service to Promote",    field: "selectedService"       as const },
              { label: "Target Audience",        field: "targetAudience"        as const },
              { label: "Budget Recommendation",  field: "budgetRecommendation"  as const },
              { label: "Expected Outcome",       field: "expectedOutcome"       as const },
              { label: "Channels (comma-sep.)",  field: "channelRecommendation" as const },
            ] as { label: string; field: keyof EditableFields }[]
          ).map(({ label, field }) => (
            <div key={field}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
              <input
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500/50"
                value={editFields[field]}
                onChange={e => setEditFields(prev => ({ ...prev, [field]: e.target.value }))}
              />
            </div>
          ))}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Executive Summary</p>
            <textarea
              rows={3}
              className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-foreground focus:outline-none focus:border-blue-500/50 resize-none"
              value={editFields.executiveSummary}
              onChange={e => setEditFields(prev => ({ ...prev, executiveSummary: e.target.value }))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:bg-white/[0.05] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                setSaving(true);
                try { await onEdit(editFields); setEditing(false); }
                finally { setSaving(false); }
              }}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Service Selection Card */}
      {strategy.selectedService && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold text-amber-200">Recommended: {strategy.selectedService}</p>
                <ScorePill score={strategy.confidenceScore} />
              </div>
              {strategy.serviceSelectionReason && (
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{strategy.serviceSelectionReason}</p>
              )}
              {/* Service scores */}
              {Object.keys(strategy.serviceScores).length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(strategy.serviceScores)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .slice(0, 5)
                    .map(([name, score]) => (
                      <span key={name} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-muted-foreground">
                        {name}: {typeof score === "number" ? score.toFixed(1) : score}
                      </span>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick stats row */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: "Target Audience", value: strategy.targetAudience,       icon: Users },
          { label: "Expected Outcome",value: strategy.expectedOutcome,       icon: TrendingUp },
          { label: "Budget",          value: strategy.budgetRecommendation,  icon: DollarSign },
          { label: "Channels",        value: strategy.channelRecommendation.join(", "), icon: Layers },
        ].map(({ label, value, icon: Icon }) => value ? (
          <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className="h-3 w-3 text-muted-foreground/60" />
              <p className="text-[9px] text-muted-foreground/60 uppercase tracking-widest font-semibold">{label}</p>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3">{value}</p>
          </div>
        ) : null)}
      </div>

      {/* Executive Summary */}
      {strategy.executiveSummary && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
          <p className="text-[10px] text-emerald-400/70 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
            <Compass className="h-3 w-3" /> Executive Summary
          </p>
          <p className="text-sm text-foreground/85 leading-relaxed">{strategy.executiveSummary}</p>
        </div>
      )}

      {/* Plan sections */}
      <div className="space-y-2">
        {planSections.map(({ title, icon, content }) => (
          <Section key={title} title={title} icon={icon} defaultOpen={false}>
            <MarkdownContent content={content} />
          </Section>
        ))}
      </div>

      {/* KPIs */}
      {strategy.kpis.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="px-4 py-3 bg-white/[0.02] flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">KPIs</p>
          </div>
          <div className="p-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {strategy.kpis.map((kpi, i) => (
              <div key={i} className="rounded-lg bg-white/[0.03] px-3 py-2.5">
                <p className="text-xs font-medium truncate">{kpi.metric}</p>
                <p className="text-sm font-bold text-emerald-400 mt-0.5">{kpi.target}</p>
                <p className="text-[10px] text-muted-foreground">{kpi.period}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {strategy.risks && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.03] p-4">
          <p className="text-[10px] text-red-400/70 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> Risks & Mitigations
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{strategy.risks}</p>
        </div>
      )}

      {/* Required Assets + Approval Actions */}
      {(strategy.requiredAssets.length > 0 || strategy.approvalActions.length > 0) && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {strategy.requiredAssets.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                <Package className="h-3 w-3" /> Required Assets
              </p>
              <ul className="space-y-1">
                {strategy.requiredAssets.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ArrowRight className="h-3 w-3 shrink-0 mt-0.5 text-muted-foreground/40" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {strategy.approvalActions.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 p-4">
              <p className="text-[10px] text-amber-400/70 uppercase tracking-widest font-semibold mb-2 flex items-center gap-1.5">
                <Shield className="h-3 w-3" /> Approval Actions
              </p>
              <ul className="space-y-1">
                {strategy.approvalActions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="text-[10px] font-bold text-amber-400 shrink-0">{i + 1}.</span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Prompt Engines Used */}
      {strategy.promptEnginesUsed.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-3 flex items-center gap-1.5">
            <Zap className="h-3 w-3" /> Prompt Engines Used
          </p>
          <div className="flex flex-wrap gap-2">
            {strategy.promptEnginesUsed.map(engine => {
              const EIcon = ENGINE_ICONS[engine] ?? Zap;
              return (
                <div key={engine} className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-1.5">
                  <EIcon className="h-3 w-3 text-muted-foreground/60" />
                  <span className="text-xs text-muted-foreground">{ENGINE_LABELS[engine] ?? engine}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Approval status notes */}
      {strategy.status === "approved" && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">Strategy approved — tasks created and ready to execute.</p>
        </div>
      )}
      {strategy.status === "rejected" && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3">
          <p className="text-sm text-red-300 flex items-center gap-2">
            <XCircle className="h-4 w-4 shrink-0" />
            Strategy rejected{strategy.rejectionReason ? `: ${strategy.rejectionReason}` : "."}
          </p>
        </div>
      )}
      {strategy.status === "proposed_to_hivemind" && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 flex items-center gap-3">
          <Send className="h-4 w-4 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300">Strategy auto-sent to HiveMind — review is pending. Approve or reject above, or wait for HiveMind COO to act.</p>
        </div>
      )}

      {/* Generated Assets */}
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="px-4 py-3 bg-white/[0.02] flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Generated Campaign Assets</p>
            {assets.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 ml-auto">
                {assets.length} deliverable{assets.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="p-3 space-y-2">
            {assetsLoading && (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading assets…
              </div>
            )}
            {assetsError && (
              <p className="text-xs text-red-400 px-1 py-2">Failed to load assets.</p>
            )}
            {!assetsLoading && !assetsError && assets.length === 0 && (
              <p className="text-xs text-muted-foreground/60 px-1 py-2">No campaign assets generated for this strategy.</p>
            )}
            {(assets as any[]).map((asset: any) => {
              const EIcon = ENGINE_ICONS[asset.engine as string] ?? Sparkles;
              return (
                <Section key={asset.id} title={asset.title ?? asset.engine} icon={EIcon} defaultOpen={false}>
                  <MarkdownContent content={asset.content ?? ""} />
                </Section>
              );
            })}
          </div>
        </div>

      {/* Strategy Tasks */}
      {strategy.status === "approved" && (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="px-4 py-3 bg-white/[0.02] flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Strategy Tasks</p>
            {tasks.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 ml-auto">
                {tasks.filter((t: any) => t.status === "completed").length}/{tasks.length} done
              </span>
            )}
          </div>
          <div className="p-3 space-y-1.5">
            {tasksLoading && (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading tasks…
              </div>
            )}
            {tasksError && (
              <p className="text-xs text-red-400 px-1 py-2">Failed to load tasks.</p>
            )}
            {!tasksLoading && !tasksError && tasks.length === 0 && (
              <p className="text-xs text-muted-foreground/60 px-1 py-2">No tasks were generated for this strategy.</p>
            )}
            {(tasks as any[]).map((task: any) => {
              const done = task.status === "completed";
              return (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors",
                    done
                      ? "bg-emerald-500/[0.04] border-emerald-500/10 opacity-60"
                      : "bg-white/[0.02] border-white/[0.04]",
                  )}
                >
                  <button
                    type="button"
                    title={done ? "Mark pending" : "Mark complete"}
                    onClick={() => handleTaskToggle(task.id, task.status)}
                    className="mt-0.5 shrink-0 transition-colors"
                  >
                    <CheckCircle2 className={cn(
                      "h-3.5 w-3.5",
                      done ? "text-emerald-400" : "text-muted-foreground/30 hover:text-emerald-400",
                    )} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-xs font-medium leading-snug", done && "line-through")}>{task.title}</p>
                    {task.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{task.description}</p>
                    )}
                    {task.week_number && (
                      <p className="text-[9px] text-muted-foreground/40 mt-0.5">Week {task.week_number}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    {task.channel && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.05] text-muted-foreground/60 uppercase tracking-widest">{task.channel}</span>
                    )}
                    <span className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-widest",
                      task.priority === "high"   ? "bg-red-500/10 text-red-400"
                      : task.priority === "medium" ? "bg-yellow-500/10 text-yellow-400"
                      : "bg-white/[0.05] text-muted-foreground/60",
                    )}>
                      {task.priority}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────────

export function GrowthMindStrategyCentre() {
  const qc              = useQueryClient();
  const generateFn      = useServerFn(generateStrategyCentre);
  const listFn          = useServerFn(listStrategyCentre);
  const sendFn          = useServerFn(sendStrategyCentreToHiveMind);
  const approveFn       = useServerFn(approveStrategyCentre);
  const rejectFn        = useServerFn(rejectStrategyCentre);
  const deleteFn        = useServerFn(deleteStrategyCentre);
  const updateFn        = useServerFn(updateStrategyCentre);

  const [selectedType,       setSelectedType]       = useState<StrategyCentreType>("30_day");
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [generating,         setGenerating]         = useState(false);
  const [budget,             setBudget]             = useState("");
  const [goal,               setGoal]               = useState("");

  const { data, isLoading } = useQuery({
    queryKey:  ["strategy-centre"],
    queryFn:   () => listFn(),
    staleTime: 60_000,
  });

  const strategies     = data?.strategies ?? [];
  const selectedStrategy = selectedStrategyId
    ? strategies.find(s => s.id === selectedStrategyId) ?? null
    : strategies[0] ?? null;

  const grouped = useMemo(() => {
    const g: Record<string, typeof STRATEGY_TYPES> = {};
    for (const t of STRATEGY_TYPES) {
      if (!g[t.group]) g[t.group] = [];
      g[t.group].push(t);
    }
    return g;
  }, []);

  async function handleEdit(strategyId: string, fields: Partial<EditableFields>) {
    try {
      const { channelRecommendation, ...rest } = fields;
      const update: Record<string, unknown> = { ...rest };
      if (channelRecommendation !== undefined) {
        update.channelRecommendation = channelRecommendation
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
      await updateFn({ data: { strategyId, ...update } });
      await qc.invalidateQueries({ queryKey: ["strategy-centre"] });
      toast.success("Strategy updated");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update");
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await generateFn({ data: {
        strategyType: selectedType,
        budget:       budget.trim() || undefined,
        goal:         goal.trim()   || undefined,
      } });
      await qc.invalidateQueries({ queryKey: ["strategy-centre"] });
      setSelectedStrategyId(res.strategy.id);
      setBudget("");
      setGoal("");
      const autoSent = (res as any).autoSentToHiveMind;
      toast.success(autoSent
        ? "Strategy generated & sent to HiveMind for approval"
        : "Strategy generated"
      );
    } catch (e: any) {
      toast.error(e.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSend(strategyId: string) {
    try {
      await sendFn({ data: { strategyId } });
      await qc.invalidateQueries({ queryKey: ["strategy-centre"] });
      toast.success("Sent to HiveMind for approval");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  }

  async function handleApprove(strategyId: string) {
    try {
      const res = await approveFn({ data: { strategyId } });
      await qc.invalidateQueries({ queryKey: ["strategy-centre"] });
      await qc.invalidateQueries({ queryKey: ["strategy-tasks", strategyId] });
      const created = (res as any).tasksCreated ?? 0;
      toast.success(
        created > 0
          ? `Strategy approved — ${created} task${created !== 1 ? "s" : ""} created`
          : "Strategy approved — no tasks were generated for this strategy",
      );
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  }

  async function handleReject(strategyId: string) {
    try {
      await rejectFn({ data: { strategyId } });
      await qc.invalidateQueries({ queryKey: ["strategy-centre"] });
      toast.success("Strategy rejected");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  }

  async function handleDelete(strategyId: string) {
    try {
      await deleteFn({ data: { strategyId } });
      await qc.invalidateQueries({ queryKey: ["strategy-centre"] });
      if (selectedStrategyId === strategyId) setSelectedStrategyId(null);
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  }

  async function handleRegenerate(strategyType: StrategyCentreType, strategyId: string) {
    await handleDelete(strategyId);
    setSelectedType(strategyType);
    setSelectedStrategyId(null);
    setGenerating(true);
    try {
      const res = await generateFn({ data: {
        strategyType,
        budget: budget.trim() || undefined,
        goal:   goal.trim()   || undefined,
      } });
      await qc.invalidateQueries({ queryKey: ["strategy-centre"] });
      setSelectedStrategyId(res.strategy.id);
      const autoSent = (res as any).autoSentToHiveMind;
      setBudget("");
      setGoal("");
      toast.success(autoSent
        ? "Strategy regenerated & sent to HiveMind"
        : "Strategy regenerated"
      );
    } catch (e: any) {
      toast.error(e.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <GrowthMindShell>
      <div className="flex min-h-0 flex-1">

        {/* ── Left panel: type selector + history ──────────────────────────── */}
        <aside className="w-72 shrink-0 border-r border-white/[0.04] flex flex-col min-h-0">
          {/* Type selector */}
          <div className="p-3 border-b border-white/[0.04]">
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-semibold mb-2 px-1">
              Strategy Type
            </p>
            <div className="space-y-3">
              {GROUPS.map(group => (
                <div key={group}>
                  <p className="text-[9px] text-muted-foreground/40 uppercase tracking-widest px-1 mb-1">{group}</p>
                  <div className="space-y-0.5">
                    {grouped[group]?.map(t => {
                      const Icon = t.icon;
                      const isActive = selectedType === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedType(t.id)}
                          className={cn(
                            "w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors",
                            isActive
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "hover:bg-white/[0.04] text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-emerald-400" : t.color)} />
                          <div className="min-w-0">
                            <p className="text-xs font-medium leading-tight truncate">{t.label}</p>
                            <p className="text-[10px] text-muted-foreground/60 leading-none mt-0.5 truncate">{t.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 space-y-2">
              <div>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-semibold mb-1 px-0.5">
                  Goal <span className="normal-case font-normal">(optional)</span>
                </p>
                <input
                  className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-emerald-500/40 transition-colors"
                  placeholder="e.g. Get 20 new clients in 30 days"
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-semibold mb-1 px-0.5">
                  Budget <span className="normal-case font-normal">(optional)</span>
                </p>
                <input
                  className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-emerald-500/40 transition-colors"
                  placeholder="e.g. £1,500/month"
                  value={budget}
                  onChange={e => setBudget(e.target.value)}
                />
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              {generating ? "Generating…" : `Generate Strategy`}
            </button>
          </div>

          {/* Past strategies */}
          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : strategies.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-center px-3">
                <Compass className="h-6 w-6 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground/50">No strategies yet. Select a type and generate your first one.</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest px-2 py-1">Past Strategies</p>
                {strategies.map(s => {
                  const typeInfo = STRATEGY_TYPES.find(t => t.id === s.strategyType);
                  const Icon     = typeInfo?.icon ?? Compass;
                  const isActive = (selectedStrategyId ?? strategies[0]?.id) === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedStrategyId(s.id)}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded-lg transition-colors",
                        isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                        <p className="text-xs font-medium truncate">{typeInfo?.label ?? s.strategyType}</p>
                        <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0", STATUS_STYLES[s.status])}>
                          {STATUS_LABELS[s.status]?.split(" ")[0]}
                        </span>
                      </div>
                      {s.selectedService && (
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 pl-5 truncate">{s.selectedService}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/40 mt-0.5 pl-5">
                        {new Date(s.createdAt).toLocaleDateString()}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── Right panel: strategy output ──────────────────────────────────── */}
        <main className="flex-1 min-w-0 overflow-y-auto p-5">
          {generating ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20 flex items-center justify-center">
                  <Compass className="h-8 w-8 text-emerald-400 animate-pulse" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Generating Strategy…</p>
                <p className="text-xs text-muted-foreground mt-1">
                  GrowthMind is reading your Business DNA, analysing opportunities, and selecting the best service to promote.
                </p>
              </div>
              <div className="space-y-2 text-center text-xs text-muted-foreground/60 max-w-xs">
                {[
                  "Reading Business DNA & Knowledge Base…",
                  "Scoring service opportunities…",
                  "Routing to prompt engines…",
                  "Compiling strategy…",
                  "Generating campaign assets…",
                  "Sending to HiveMind for review…",
                ].map((step, i) => (
                  <p key={i} className="animate-pulse" style={{ animationDelay: `${i * 0.3}s` }}>
                    {step}
                  </p>
                ))}
              </div>
            </div>
          ) : selectedStrategy ? (
            <StrategyErrorBoundary>
              <StrategyDisplay
                strategy={selectedStrategy}
                onApprove={() => handleApprove(selectedStrategy.id)}
                onReject={() => handleReject(selectedStrategy.id)}
                onSend={() => handleSend(selectedStrategy.id)}
                onDelete={() => handleDelete(selectedStrategy.id)}
                onRegenerate={() => handleRegenerate(selectedStrategy.strategyType as StrategyCentreType, selectedStrategy.id)}
                onEdit={(fields) => handleEdit(selectedStrategy.id, fields)}
              />
            </StrategyErrorBoundary>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20 flex items-center justify-center">
                <Compass className="h-8 w-8 text-emerald-400" />
              </div>
              <div className="text-center max-w-sm">
                <h2 className="text-base font-semibold">GrowthMind Strategy Centre</h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  Select a strategy type from the left panel. GrowthMind will read your Business DNA, score your services,
                  route tasks to the correct prompt engines, and create a complete campaign plan — ready for HiveMind approval.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 max-w-md w-full">
                {[
                  { icon: Compass,    label: "Reads DNA & Data",      desc: "12 data sources analysed" },
                  { icon: Trophy,     label: "Scores Services",        desc: "AI picks the best offer" },
                  { icon: Layers,     label: "Routes to Engines",      desc: "Up to 8 prompt engines" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
                    <Icon className="h-5 w-5 text-emerald-400 mx-auto mb-1.5" />
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5">{desc}</p>
                  </div>
                ))}
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                Generate {STRATEGY_TYPES.find(t => t.id === selectedType)?.label ?? "Strategy"}
              </button>
            </div>
          )}
        </main>
      </div>
    </GrowthMindShell>
  );
}
