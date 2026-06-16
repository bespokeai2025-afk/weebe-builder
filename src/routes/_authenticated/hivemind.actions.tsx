import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Zap, CheckCircle2, XCircle, Clock, Loader2, Plus, RefreshCw,
  ChevronDown, ChevronUp, Trash2, AlertTriangle, Play, X,
  Mail, Users, ArrowRight, BookOpen, Megaphone, ClipboardList,
  Film, TrendingUp, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell, useHiveMindMode } from "@/components/hivemind/HiveMindShell";
import {
  getHiveMindActionsAndCounts, approveHiveMindAction, rejectHiveMindAction,
  deleteHiveMindAction, proposeHiveMindAction, generateOperatorActions,
  type HiveMindAction, type ActionType,
} from "@/lib/hivemind/hivemind.actions";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";

export const Route = createFileRoute("/_authenticated/hivemind/actions")({
  head: () => ({ meta: [{ title: "Action Centre — HiveMind" }] }),
  component: HiveMindActionsPage,
});

// ── Constants ─────────────────────────────────────────────────────────────────
const ACTION_STYLES: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  create_task:                { label: "Create Task",        color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20",    icon: ClipboardList },
  create_followup_campaign:   { label: "Create Campaign",    color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20",icon: Mail },
  enroll_leads_in_campaign:   { label: "Enroll Leads",       color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20",icon: Users },
  move_pipeline_stage:        { label: "Move Pipeline",      color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20",  icon: ArrowRight },
  assign_knowledge_base:      { label: "Assign KB",          color: "text-indigo-400",  bg: "bg-indigo-500/10 border-indigo-500/20",icon: BookOpen },
  launch_broadcast:           { label: "Broadcast",          color: "text-orange-400",  bg: "bg-orange-500/10 border-orange-500/20",icon: Megaphone },
  growthmind_video_campaign:  { label: "GrowthMind Video",   color: "text-pink-400",    bg: "bg-pink-500/10 border-pink-500/20",    icon: Film },
  growthmind_growth_campaign: { label: "GrowthMind Campaign",color: "text-violet-400",  bg: "bg-violet-500/10 border-violet-500/20",icon: TrendingUp },
};

function getActionStyle(type: string) {
  return ACTION_STYLES[type] ?? { label: type, color: "text-muted-foreground", bg: "bg-white/[0.04] border-white/[0.08]", icon: Zap };
}

const VIDEO_TYPE_LABELS_SHORT: Record<string, string> = {
  meta_video_ad: "Meta Video Ad", linkedin_video: "LinkedIn Video", tiktok_video: "TikTok Video",
  explainer_video: "Explainer Video", ugc_ad: "UGC Ad", product_demo: "Product Demo",
  youtube_short: "YouTube Short", youtube_ad: "YouTube Ad", case_study_video: "Case Study",
  testimonial_video: "Testimonial", webinar_clip: "Webinar Clip", podcast_clip: "Podcast Clip",
};

const CAMPAIGN_TYPE_LABELS_SHORT: Record<string, string> = {
  google_ads: "Google Ads", meta_ads: "Meta Ads", linkedin_ads: "LinkedIn Ads",
  seo_content: "SEO Content", whatsapp_broadcast: "WhatsApp Broadcast",
  hexmail_sequence: "HexMail Sequence", ai_calling: "AI Calling",
  referral: "Referral Campaign", reactivation: "Reactivation", launch: "Launch Campaign",
};

function PayloadSummary({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  const items: string[] = [];

  if (type === "growthmind_video_campaign") {
    const vt = payload.video_type as string | undefined;
    if (vt)                       items.push(VIDEO_TYPE_LABELS_SHORT[vt] ?? vt);
    if (payload.quality_mode)     items.push(`Quality: ${payload.quality_mode}`);
    if (payload.target_audience)  items.push(`Audience: ${String(payload.target_audience).slice(0, 40)}`);
    if (payload.tone)             items.push(`Tone: ${payload.tone}`);
    if (payload.cta)              items.push(`CTA: ${String(payload.cta).slice(0, 30)}`);
  } else if (type === "growthmind_growth_campaign") {
    const ct = payload.campaign_type as string | undefined;
    if (ct)                       items.push(CAMPAIGN_TYPE_LABELS_SHORT[ct] ?? ct);
    if (payload.budget != null)   items.push(`Budget: £${payload.budget}/mo`);
    if (payload.goal)             items.push(`Goal: ${String(payload.goal).slice(0, 50)}`);
  } else {
    if (payload.name)             items.push(`Name: "${payload.name}"`);
    if (payload.lead_ids && Array.isArray(payload.lead_ids))
                                  items.push(`${(payload.lead_ids as string[]).length} leads`);
    if (payload.title)            items.push(`Title: "${payload.title}"`);
    if (payload.priority)         items.push(`Priority: ${payload.priority}`);
    if (payload.new_status)       items.push(`→ ${payload.new_status}`);
    if (payload.agent_id)         items.push(`Agent: ${payload.agent_id}`);
  }

  if (items.length === 0)         return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {items.map((item, i) => (
        <span key={i} className="text-[10px] bg-white/[0.04] border border-white/[0.07] rounded px-2 py-0.5 text-muted-foreground">
          {item}
        </span>
      ))}
    </div>
  );
}

// ── GrowthMind result deep-link ───────────────────────────────────────────────
function GrowthMindResultLink({ action }: { action: HiveMindAction }) {
  if (action.status !== "executed" || !action.result) return null;

  const r = action.result as Record<string, unknown>;

  if (action.action_type === "growthmind_video_campaign" && r.video_asset_id) {
    return (
      <a
        href="/growthmind/video-studio"
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-pink-400 hover:text-pink-300 transition-colors"
      >
        <Film className="h-3 w-3" />
        Video job queued — see Video Studio
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  if (action.action_type === "growthmind_growth_campaign" && r.campaign_draft_id) {
    return (
      <a
        href="/growthmind/campaign-factory"
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-violet-400 hover:text-violet-300 transition-colors"
      >
        <TrendingUp className="h-3 w-3" />
        Campaign draft ready — see Campaign Factory
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  return null;
}

// ── Action card ───────────────────────────────────────────────────────────────
function ActionCard({
  action, onApprove, onReject, onDelete, isMutating,
}: {
  action: HiveMindAction;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
  onDelete:  (id: string) => void;
  isMutating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const style = getActionStyle(action.action_type);
  const Icon  = style.icon;

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      action.status === "rejected" || action.status === "failed"
        ? "opacity-50 bg-white/[0.01] border-white/[0.05]"
        : action.status === "executed"
          ? "bg-emerald-500/[0.03] border-emerald-500/10"
          : "bg-[hsl(var(--card))] border-white/[0.08]",
    )}>
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Type icon */}
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg border shrink-0 mt-0.5", style.bg)}>
          <Icon className={cn("h-4 w-4", style.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={cn("text-[10px] font-semibold rounded-full px-1.5 py-0.5 border", style.bg, style.color)}>
              {style.label}
            </span>
            {action.status === "pending" && (
              <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">
                Awaiting approval
              </span>
            )}
            {action.status === "executed" && (
              <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium">
                Executed
              </span>
            )}
            {action.status === "rejected" && (
              <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-slate-500/15 text-slate-400 border border-slate-500/20 font-medium">
                Rejected
              </span>
            )}
            {action.status === "failed" && (
              <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-red-500/15 text-red-400 border border-red-500/20 font-medium">
                Failed
              </span>
            )}
          </div>
          <p className="text-sm font-medium">{action.title}</p>
          {action.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{action.description}</p>
          )}
          <PayloadSummary type={action.action_type} payload={action.action_payload} />
          <GrowthMindResultLink action={action} />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {action.status === "pending" && (
            <>
              <button
                onClick={() => onApprove(action.id)}
                disabled={isMutating}
                className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve
              </button>
              <button
                onClick={() => onReject(action.id)}
                disabled={isMutating}
                className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[11px] text-muted-foreground hover:text-red-400 hover:border-red-500/30 transition-all disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            onClick={() => setOpen(o => !o)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded */}
      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
          <div className="text-[11px] text-muted-foreground space-y-1">
            <p>Proposed by <span className="text-foreground font-medium">{action.proposed_by}</span> · <RelativeTime date={action.created_at} short /></p>
            {action.approved_by && <p>Approved by <span className="text-foreground font-medium">{action.approved_by}</span></p>}
            {action.executed_at && <p>Executed <RelativeTime date={action.executed_at} short /></p>}
          </div>

          {/* Full payload */}
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Action payload</p>
            <pre className="text-[10px] text-muted-foreground bg-white/[0.02] rounded-lg p-2 overflow-x-auto border border-white/[0.05]">
              {JSON.stringify(action.action_payload, null, 2)}
            </pre>
          </div>

          {/* Result */}
          {action.result && (
            <div>
              <p className="text-[10px] text-emerald-400 uppercase tracking-wide mb-1">Result</p>
              <pre className="text-[10px] text-emerald-400/70 bg-emerald-500/[0.04] rounded-lg p-2 border border-emerald-500/10">
                {JSON.stringify(action.result, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {action.error_message && (
            <div>
              <p className="text-[10px] text-red-400 uppercase tracking-wide mb-1">Error</p>
              <p className="text-[11px] text-red-400/80 bg-red-500/[0.04] rounded-lg px-3 py-2 border border-red-500/10">
                {action.error_message}
              </p>
            </div>
          )}

          <div className="flex justify-end pt-1 border-t border-white/[0.04]">
            <button
              onClick={() => onDelete(action.id)}
              disabled={isMutating}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create action modal ───────────────────────────────────────────────────────
function CreateActionModal({ onClose, onCreate }: {
  onClose:  () => void;
  onCreate: (data: { title: string; description?: string; action_type: string; action_payload: Record<string, unknown> }) => void;
}) {
  const [title,   setTitle]   = useState("");
  const [desc,    setDesc]    = useState("");
  const [type,    setType]    = useState<string>("create_task");
  const [payload, setPayload] = useState("{}");
  const [payErr,  setPayErr]  = useState("");

  function submit() {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(payload); setPayErr(""); }
    catch { setPayErr("Invalid JSON payload"); return; }
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: desc || undefined, action_type: type, action_payload: parsed });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-white/[0.12] bg-[hsl(var(--card))] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <p className="text-sm font-semibold">Propose Action</p>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">Title *</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What should HiveMind do?"
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/40" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Why is this action needed?"
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/40 resize-none" />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">Action type</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/40">
              {Object.entries(ACTION_STYLES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground mb-1.5 block">Payload (JSON)</label>
            <textarea value={payload} onChange={e => setPayload(e.target.value)} rows={4} spellCheck={false}
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-violet-500/40 resize-none" />
            {payErr && <p className="text-[11px] text-red-400 mt-1">{payErr}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!title.trim()} className="bg-violet-600 hover:bg-violet-700 text-white">
            Propose Action
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type Tab = "pending" | "executed" | "rejected" | "all";

function HiveMindActionsPage() {
  const qc           = useQueryClient();
  const mode         = useHiveMindMode();
  const getActionsFn = useServerFn(getHiveMindActionsAndCounts);
  const approveFn    = useServerFn(approveHiveMindAction);
  const rejectFn     = useServerFn(rejectHiveMindAction);
  const deleteFn     = useServerFn(deleteHiveMindAction);
  const proposeFn    = useServerFn(proposeHiveMindAction);
  const generateFn   = useServerFn(generateOperatorActions);

  const [tab,        setTab]       = useState<Tab>("pending");
  const [mutating,   setMutating]  = useState(false);
  const [generating, setGenerating]= useState(false);
  const [genMsg,     setGenMsg]    = useState<string | null>(null);
  const [showCreate, setShowCreate]= useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["hivemind-actions"],
    queryFn:  () => getActionsFn(),
    staleTime: 30_000,
  });

  const actions = data?.actions ?? [];
  const tabCounts = {
    pending:  actions.filter(a => a.status === "pending").length,
    executed: actions.filter(a => a.status === "executed").length,
    rejected: actions.filter(a => ["rejected","failed"].includes(a.status)).length,
    all:      actions.length,
  };
  const visible = tab === "all" ? actions :
    tab === "rejected" ? actions.filter(a => ["rejected","failed"].includes(a.status)) :
    actions.filter(a => a.status === tab);

  async function handleApprove(id: string) {
    setMutating(true);
    try { await approveFn({ data: { id, approved_by: "You" } }); await refetch(); qc.invalidateQueries({ queryKey: ["hivemind-shell-badge"] }); }
    finally { setMutating(false); }
  }
  async function handleReject(id: string) {
    setMutating(true);
    try { await rejectFn({ data: { id } }); await refetch(); qc.invalidateQueries({ queryKey: ["hivemind-shell-badge"] }); }
    finally { setMutating(false); }
  }
  async function handleDelete(id: string) {
    setMutating(true);
    try { await deleteFn({ data: { id } }); await refetch(); }
    finally { setMutating(false); }
  }
  async function handleCreate(d: Parameters<typeof proposeFn>[0]["data"]) {
    setMutating(true);
    try { await proposeFn({ data: d }); await refetch(); }
    finally { setMutating(false); }
  }
  async function handleGenerate() {
    setGenerating(true); setGenMsg(null);
    try {
      const r = await generateFn();
      setGenMsg(r.proposed > 0 ? `${r.proposed} new action${r.proposed !== 1 ? "s" : ""} proposed` : "No new actions — platform looks healthy");
      await refetch();
      qc.invalidateQueries({ queryKey: ["hivemind-shell-badge"] });
      setTimeout(() => setGenMsg(null), 5000);
    } finally { setGenerating(false); }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "pending",  label: "Pending" },
    { key: "executed", label: "Executed" },
    { key: "rejected", label: "Rejected" },
    { key: "all",      label: "All" },
  ];

  return (
    <HiveMindShell>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/[0.07] bg-[hsl(var(--background))]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 ring-1 ring-amber-500/30 shrink-0">
          <Zap className="h-4 w-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Action Approval Centre</p>
          <p className="text-[11px] text-muted-foreground">
            {tabCounts.pending > 0
              ? `${tabCounts.pending} action${tabCounts.pending !== 1 ? "s" : ""} awaiting your approval`
              : "No pending actions"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {genMsg && <p className="text-[11px] text-emerald-400 hidden sm:block">{genMsg}</p>}
          {mode === "operator" && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-40"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Generate Actions
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-xs font-medium text-white transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            Propose
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/[0.06] px-5">
        <div className="flex gap-0">
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                tab === key ? "border-amber-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}>
              {label}
              {tabCounts[key] > 0 && (
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                  tab === key ? "bg-amber-500/20 text-amber-400" : "bg-white/[0.08] text-muted-foreground")}>
                  {tabCounts[key]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading actions…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-3">
              {tab === "pending" ? <Zap className="h-5 w-5 text-amber-400" /> : <CheckCircle2 className="h-5 w-5 text-muted-foreground" />}
            </div>
            <p className="text-sm font-medium">No {tab} actions</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tab === "pending" && mode === "operator"
                ? "Click 'Generate Actions' to let HiveMind analyse your platform"
                : tab === "pending"
                  ? "Switch to Operator mode to generate intelligent action proposals"
                  : `Actions will appear here when they are ${tab}`}
            </p>
            {tab === "pending" && mode === "operator" && (
              <button onClick={handleGenerate} disabled={generating}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/25 transition-all disabled:opacity-40">
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Generate actions now
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(action => (
              <ActionCard
                key={action.id}
                action={action}
                onApprove={handleApprove}
                onReject={handleReject}
                onDelete={handleDelete}
                isMutating={mutating}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateActionModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </HiveMindShell>
  );
}
