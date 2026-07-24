import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Zap, CheckCircle2, XCircle, Clock, Loader2, Plus, RefreshCw,
  ChevronDown, ChevronUp, Trash2, AlertTriangle, Play, X,
  Mail, Users, ArrowRight, BookOpen, Megaphone, ClipboardList,
  Film, TrendingUp, ExternalLink, Dna, Package2,
  BarChart3, MessageSquare, Phone, Video, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell, useHiveMindMode } from "@/components/hivemind/HiveMindShell";
import {
  getHiveMindActionsAndCounts, approveHiveMindAction, rejectHiveMindAction,
  deleteHiveMindAction, proposeHiveMindAction, generateOperatorActions,
  getHiveMindLearningSummary,
  type HiveMindAction, type ActionType, type ConfidenceAdjustmentRow,
} from "@/lib/hivemind/hivemind.actions";
import { getCampaignProposals, updateProposalStatus } from "@/lib/growthmind/growthmind.campaign-proposals";
import {
  listExecutiveRecommendations, actOnExecutiveRecommendation, updateExecutiveRecommendationStatus,
  type ExecutiveRecommendation,
} from "@/lib/hivemind/executive-recommendations";
import { generateDnaProposalsFn } from "@/lib/hivemind/business-dna.functions";
import { runOrchestrationPlaybookFn, listOrchestrationRunsFn } from "@/lib/hivemind/orchestration.functions";
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
  activate_lead_intake_workflow: { label: "Lead Intake Auto-Call", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", icon: Phone },
  activate_systemmind_automation: { label: "SystemMind Automation", color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20", icon: Zap },
  run_orchestration_playbook: { label: "Orchestration Playbook", color: "text-fuchsia-400", bg: "bg-fuchsia-500/10 border-fuchsia-500/20", icon: Zap },
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

// ── Outcome display (learning loop) ───────────────────────────────────────────
const OUTCOME_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  successful:   { label: "Outcome: Successful",   color: "text-emerald-400", bg: "bg-emerald-500/15 border-emerald-500/25" },
  partial:      { label: "Outcome: Partial",      color: "text-amber-400",   bg: "bg-amber-500/15 border-amber-500/25" },
  no_change:    { label: "Outcome: No Change",    color: "text-slate-400",   bg: "bg-slate-500/15 border-slate-500/25" },
  unsuccessful: { label: "Outcome: Unsuccessful", color: "text-red-400",     bg: "bg-red-500/15 border-red-500/25" },
  inconclusive: { label: "Outcome: Inconclusive", color: "text-muted-foreground", bg: "bg-white/[0.05] border-white/[0.10]" },
};

function OutcomeBadge({ classification }: { classification: string | null | undefined }) {
  if (!classification) return null;
  const s = OUTCOME_STYLES[classification];
  if (!s) return null;
  return (
    <span className={cn("text-[10px] rounded-full px-1.5 py-0.5 border font-medium", s.bg, s.color)}>
      {s.label}
    </span>
  );
}

function OutcomeSection({ action }: { action: HiveMindAction }) {
  const outcome = action.outcome as Record<string, any> | null | undefined;
  const classification = action.outcome_classification;

  // Executed but not yet reassessed — show when the check is due.
  if (action.status === "executed" && !classification) {
    if (!action.reassess_at) return null;
    const due = new Date(action.reassess_at);
    const pastDue = due.getTime() <= Date.now();
    return (
      <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {pastDue
            ? "Outcome check is due — HiveMind will assess this action's real-world result on its next learning pass."
            : <>HiveMind will check this action's real-world result after {due.toLocaleDateString()} and record what it learned here.</>}
        </p>
      </div>
    );
  }

  if (!classification) return null;
  const s = OUTCOME_STYLES[classification] ?? OUTCOME_STYLES.inconclusive;
  const detail = (outcome?.detail ?? {}) as Record<string, unknown>;
  const expected = (outcome?.expected_result ?? action.expected_result) as string | null | undefined;
  const assessedAt = outcome?.assessed_at as string | undefined;

  const detailItems = Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .slice(0, 6);

  return (
    <div className={cn("rounded-lg border px-3 py-2.5 space-y-2", s.bg)}>
      <div className="flex items-center gap-2 flex-wrap">
        <TrendingUp className={cn("h-3.5 w-3.5 shrink-0", s.color)} />
        <p className={cn("text-[11px] font-semibold", s.color)}>{s.label.replace("Outcome: ", "What HiveMind found: ")}</p>
        {assessedAt && (
          <span className="text-[10px] text-muted-foreground">assessed <RelativeTime date={assessedAt} short /></span>
        )}
      </div>
      {expected && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Expected</p>
          <p className="text-[11px] text-foreground/80 leading-relaxed">{expected}</p>
        </div>
      )}
      {detailItems.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Actual (measured)</p>
          <div className="flex flex-wrap gap-1.5">
            {detailItems.map(([k, v]) => (
              <span key={k} className="text-[10px] bg-white/[0.05] border border-white/[0.08] rounded px-2 py-0.5 text-foreground/70">
                {k.replace(/_/g, " ")}: {String(v)}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        This outcome feeds HiveMind's confidence learning — repeated successes make similar proposals more
        confident; failures make them more cautious.
      </p>
    </div>
  );
}

// ── Learning summary panel (confidence adjustments, read-only) ────────────────
function adjustmentKeyLabel(key: string): string {
  if (key.startsWith("action:")) {
    const t = key.slice("action:".length);
    return `Action · ${getActionStyle(t).label}`;
  }
  if (key.startsWith("rec:")) {
    const d = key.slice("rec:".length);
    return `Recommendations · ${d.charAt(0).toUpperCase()}${d.slice(1).replace(/_/g, " ")}`;
  }
  return key;
}

function LearningSummaryPanel({ adjustments }: { adjustments: ConfidenceAdjustmentRow[] }) {
  const [open, setOpen] = useState(true);
  if (adjustments.length === 0) return null;

  return (
    <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.03] mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25 shrink-0">
          <TrendingUp className="h-3.5 w-3.5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">What HiveMind has learned</p>
          <p className="text-[10px] text-muted-foreground">
            Confidence adjustments from {adjustments.length} action type{adjustments.length !== 1 ? "s" : ""} / department{adjustments.length !== 1 ? "s" : ""}, based on real outcomes
          </p>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {adjustments.map((adj) => {
              const positive = adj.adjustment > 0;
              const negative = adj.adjustment < 0;
              const total = adj.successes + adj.partials + adj.failures + adj.inconclusive;
              return (
                <div key={adj.adjustment_key} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[11px] font-medium truncate">{adjustmentKeyLabel(adj.adjustment_key)}</p>
                    <span className={cn(
                      "text-[10px] font-semibold rounded-full px-1.5 py-0.5 border shrink-0",
                      positive ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                      negative ? "text-red-400 bg-red-500/10 border-red-500/20" :
                      "text-muted-foreground bg-white/[0.04] border-white/[0.08]",
                    )}>
                      {positive ? "+" : ""}{(adj.adjustment * 100).toFixed(1)}% confidence
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span className="text-emerald-400/80">{adj.successes} successful</span>
                    {adj.partials > 0 && <span className="text-amber-400/80">{adj.partials} partial</span>}
                    <span className={adj.failures > 0 ? "text-red-400/80" : ""}>{adj.failures} unsuccessful</span>
                    {adj.inconclusive > 0 && <span>{adj.inconclusive} inconclusive</span>}
                    <span>· {total} assessed</span>
                  </div>
                  {adj.last_outcome && (
                    <p className="text-[10px] text-muted-foreground/70 mt-1">
                      Last outcome: {adj.last_outcome.replace(/_/g, " ")} · <RelativeTime date={adj.updated_at} short />
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2.5 leading-relaxed">
            HiveMind reassesses each executed action about a week after it ran, classifies the real-world outcome,
            and nudges its future confidence up or down (bounded at ±20%). These adjustments are applied automatically
            to new recommendations — this view is read-only.
          </p>
        </div>
      )}
    </div>
  );
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
            {action.status === "executed" && <OutcomeBadge classification={action.outcome_classification} />}
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
            {(action.approved_by || action.authorised_by_email) && (
              <p>
                Authorised by <span className="text-foreground font-medium">{action.authorised_by_email ?? action.approved_by}</span>
                {action.consumed_at && <> · {new Date(action.consumed_at).toLocaleString()}</>}
              </p>
            )}
            {action.executed_at && <p>Executed <RelativeTime date={action.executed_at} short /></p>}
          </div>
          {action.sensitive === true && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300/90 leading-relaxed">
                Sensitive action{action.sensitive_category ? ` (${String(action.sensitive_category).replace(/_/g, " ")})` : ""} —
                requires explicit human approval and is never auto-executed.
              </p>
            </div>
          )}

          {/* Outcome (learning loop) */}
          <OutcomeSection action={action} />

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

// ── Campaign Proposal Card ────────────────────────────────────────────────────
function ProposalCard({
  proposal, onApprove, onReject, isMutating,
}: {
  proposal: any;
  onApprove: (id: string) => void;
  onReject:  (id: string) => void;
  isMutating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const channels: string[] = proposal.channels ?? [];

  const CHANNEL_ICONS: Record<string, React.ElementType> = {
    "AI Calling": Phone, "WhatsApp": MessageSquare, "Email": Mail,
    "Meta Ads": BarChart3, "Google Ads": BarChart3, "LinkedIn Ads": BarChart3,
    "Video": Video, "Content SEO": FileText,
  };

  return (
    <div className={cn(
      "rounded-xl border bg-[hsl(var(--card))] transition-all",
      proposal.status === "draft" ? "border-violet-500/20" : "border-white/[0.07]",
    )}>
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25 mt-0.5">
          <Package2 className="h-3.5 w-3.5 text-violet-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded border",
              proposal.status === "draft"    ? "text-violet-400 bg-violet-500/10 border-violet-500/20" :
              proposal.status === "approved" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
              "text-muted-foreground bg-white/[0.04] border-white/[0.08]",
            )}>
              {proposal.status}
            </span>
            {channels.slice(0, 3).map((ch: string) => {
              const Icon = CHANNEL_ICONS[ch] ?? Zap;
              return (
                <span key={ch} className="flex items-center gap-1 text-[9px] text-muted-foreground/60 bg-white/[0.03] border border-white/[0.06] px-1.5 py-0.5 rounded">
                  <Icon className="h-2.5 w-2.5" />{ch}
                </span>
              );
            })}
            {proposal.expected_roi_pct && (
              <span className="text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                ~{proposal.expected_roi_pct}% ROI
              </span>
            )}
            {proposal.estimated_leads && (
              <span className="text-[9px] text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">
                ~{proposal.estimated_leads} leads
              </span>
            )}
          </div>
          <p className="text-sm font-semibold leading-tight">{proposal.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{proposal.reason}</p>
          <p className="text-[10px] text-muted-foreground/50 mt-1">{proposal.evidence?.slice(0, 100)}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {proposal.status === "draft" && (
            <>
              <button
                onClick={() => onApprove(proposal.id)}
                disabled={isMutating}
                className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Approve
              </button>
              <button
                onClick={() => onReject(proposal.id)}
                disabled={isMutating}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
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

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-4 space-y-4">
          {/* Core sections */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {proposal.audience && (
              <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Target Audience</p><p className="text-foreground/80">{proposal.audience}</p></div>
            )}
            {proposal.expected_outcome && (
              <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Expected Outcome</p><p className="text-foreground/80">{proposal.expected_outcome}</p></div>
            )}
            {proposal.budget_estimate && (
              <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Budget</p><p className="text-foreground/80">{proposal.budget_estimate}</p></div>
            )}
            {proposal.landing_page_rec && (
              <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Landing Page</p><p className="text-foreground/80">{proposal.landing_page_rec.slice(0, 200)}</p></div>
            )}
          </div>

          {/* Content plan */}
          {proposal.content_plan && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Content Plan</p>
              <p className="text-xs text-foreground/70 whitespace-pre-line leading-relaxed">{proposal.content_plan}</p>
            </div>
          )}

          {/* Video prompt */}
          {proposal.video_prompt && (
            <div className="rounded-lg border border-pink-500/15 bg-pink-500/[0.05] p-3">
              <p className="text-[10px] text-pink-400 uppercase tracking-wide mb-1.5 font-semibold">🎬 Video Prompt</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{proposal.video_prompt}</p>
            </div>
          )}

          {/* Image prompt */}
          {proposal.image_prompt && (
            <div className="rounded-lg border border-blue-500/15 bg-blue-500/[0.05] p-3">
              <p className="text-[10px] text-blue-400 uppercase tracking-wide mb-1.5 font-semibold">🖼 Image Prompt</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{proposal.image_prompt}</p>
            </div>
          )}

          {/* Ad copy */}
          {proposal.ad_copy && Object.keys(proposal.ad_copy).length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Ad Copy</p>
              <div className="space-y-1">
                {(proposal.ad_copy.headlines ?? []).map((h: string, i: number) => (
                  <p key={i} className="text-xs font-medium text-foreground/90">"{h}"</p>
                ))}
                {(proposal.ad_copy.body ?? []).slice(0, 1).map((b: string, i: number) => (
                  <p key={i} className="text-xs text-muted-foreground/70 leading-relaxed">{b}</p>
                ))}
              </div>
            </div>
          )}

          {/* Email sequence */}
          {Array.isArray(proposal.email_sequence) && proposal.email_sequence.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Email Sequence ({proposal.email_sequence.length} emails)</p>
              <div className="space-y-2">
                {proposal.email_sequence.map((e: any, i: number) => (
                  <div key={i} className="rounded-lg bg-white/[0.02] border border-white/[0.05] p-2.5">
                    <p className="text-[10px] text-amber-400 font-medium">Day {e.day}</p>
                    <p className="text-xs font-medium mt-0.5">{e.subject}</p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-2">{e.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* WhatsApp sequence */}
          {Array.isArray(proposal.whatsapp_sequence) && proposal.whatsapp_sequence.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">WhatsApp Sequence ({proposal.whatsapp_sequence.length} messages)</p>
              <div className="space-y-1.5">
                {proposal.whatsapp_sequence.map((m: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-emerald-500/[0.03] border border-emerald-500/10 p-2.5">
                    <span className="text-[9px] text-emerald-400 font-semibold shrink-0 mt-0.5">Day {m.day}</span>
                    <p className="text-xs text-foreground/80 leading-relaxed">{m.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Measurement */}
          {proposal.measurement_strategy && (proposal.measurement_strategy.kpis ?? []).length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">KPIs & Measurement</p>
              <ul className="space-y-1">
                {(proposal.measurement_strategy.kpis ?? []).map((k: string, i: number) => (
                  <li key={i} className="flex items-center gap-1.5 text-xs">
                    <BarChart3 className="h-3 w-3 text-blue-400 shrink-0" />
                    <span className="text-foreground/80">{k}</span>
                  </li>
                ))}
              </ul>
              {proposal.measurement_strategy.reviewCadence && (
                <p className="text-[10px] text-muted-foreground/50 mt-1">Review: {proposal.measurement_strategy.reviewCadence}</p>
              )}
            </div>
          )}

          {/* ROI summary */}
          {(proposal.estimated_leads || proposal.estimated_cost_pence || proposal.expected_roi_pct) && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] p-3">
              {proposal.estimated_leads && (
                <div className="text-center">
                  <p className="text-base font-bold text-emerald-400">{proposal.estimated_leads}</p>
                  <p className="text-[9px] text-muted-foreground uppercase">Est. Leads</p>
                </div>
              )}
              {proposal.estimated_cost_pence && (
                <div className="text-center">
                  <p className="text-base font-bold">£{Math.round(proposal.estimated_cost_pence / 100).toLocaleString()}</p>
                  <p className="text-[9px] text-muted-foreground uppercase">Est. Cost</p>
                </div>
              )}
              {proposal.expected_roi_pct && (
                <div className="text-center">
                  <p className="text-base font-bold text-emerald-400">{proposal.expected_roi_pct}%</p>
                  <p className="text-[9px] text-muted-foreground uppercase">Expected ROI</p>
                </div>
              )}
            </div>
          )}

          <div className="text-[10px] text-muted-foreground/40 pt-1 border-t border-white/[0.04]">
            Generated <RelativeTime date={proposal.generated_at} />
            {proposal.package_complete && " · Full 15-section package"}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Executive Recommendation card ────────────────────────────────────────────
const REC_PRIORITY_STYLES: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  high:     "text-amber-400 bg-amber-500/10 border-amber-500/20",
  medium:   "text-blue-400 bg-blue-500/10 border-blue-500/20",
  low:      "text-muted-foreground bg-white/[0.04] border-white/[0.08]",
};

const REC_OPEN_STATES = ["new", "acknowledged", "under_review", "reopened"];

function RecommendationCard({
  rec, linked, mode, onAct, onDismiss, isMutating,
}: {
  rec: ExecutiveRecommendation;
  linked?: { id: string; status: string; action_type: string; sensitive: boolean };
  mode: string;
  onAct:     (id: string) => void;
  onDismiss: (id: string) => void;
  isMutating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = REC_OPEN_STATES.includes(rec.status);
  const metrics = (rec.evidence?.metrics ?? {}) as Record<string, unknown>;

  return (
    <div className={cn(
      "rounded-xl border transition-all",
      isOpen ? "bg-[hsl(var(--card))] border-white/[0.08]" : "opacity-60 bg-white/[0.01] border-white/[0.05]",
    )}>
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border shrink-0 mt-0.5 bg-violet-500/10 border-violet-500/20">
          <TrendingUp className="h-4 w-4 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={cn("text-[10px] font-semibold rounded-full px-1.5 py-0.5 border capitalize",
              REC_PRIORITY_STYLES[rec.priority] ?? REC_PRIORITY_STYLES.low)}>
              {rec.priority}
            </span>
            <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.08] text-muted-foreground capitalize">
              {rec.department}
            </span>
            <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.08] text-muted-foreground capitalize">
              {rec.status.replace(/_/g, " ")}
            </span>
            {linked && (
              <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">
                {linked.status === "pending"
                  ? (linked.sensitive ? "Sensitive action awaiting approval" : "Action awaiting approval")
                  : `Action ${linked.status}`}
              </span>
            )}
          </div>
          <p className="text-sm font-medium">{rec.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{rec.business_issue}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isOpen && !linked && (
            <>
              <button
                onClick={() => onAct(rec.id)}
                disabled={isMutating || mode === "observe"}
                title={mode === "observe" ? "Switch out of Observe mode to act on recommendations" : undefined}
                className="flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-[11px] font-semibold text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" />
                Act on this
              </button>
              <button
                onClick={() => onDismiss(rec.id)}
                disabled={isMutating}
                className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1.5 text-[11px] text-muted-foreground hover:text-red-400 hover:border-red-500/30 transition-all disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button onClick={() => setOpen(o => !o)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3 text-xs">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Recommended action</p>
            <p className="text-foreground/85 leading-relaxed">{rec.recommended_action}</p>
            {rec.next_step && <p className="text-muted-foreground mt-1">Next step: {rec.next_step}</p>}
          </div>
          {rec.risk_of_inaction && (
            <div>
              <p className="text-[10px] text-amber-400 uppercase tracking-wide mb-1">Risk of inaction</p>
              <p className="text-foreground/70">{rec.risk_of_inaction}</p>
            </div>
          )}
          {Object.keys(metrics).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(metrics).slice(0, 8).map(([k, v]) => (
                <span key={k} className="text-[10px] bg-white/[0.04] border border-white/[0.07] rounded px-2 py-0.5 text-muted-foreground">
                  {k}: {String(v)}
                </span>
              ))}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/50">
            Confidence {(Number(rec.confidence) * 100).toFixed(0)}% · Raised <RelativeTime date={rec.created_at} short />
            {rec.result ? ` · ${rec.result}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
type Tab = "recommendations" | "pending" | "executed" | "rejected" | "all" | "proposals";

const ORCH_PLAYBOOKS: { key: string; title: string; description: string }[] = [
  { key: "campaign_underperforming", title: "Campaign underperforming", description: "Chains GrowthMind, AccountsMind and SystemMind analyses on stalled call campaigns and creates a coordinated fix plan." },
  { key: "invoice_missing", title: "Recurring invoice missing", description: "Finds recurring invoice schedules that skipped this month and coordinates AccountsMind follow-up tasks." },
  { key: "lead_not_followed_up", title: "Qualified lead not followed up", description: "Finds interested/qualified leads gone quiet for 3+ days and coordinates follow-up tasks with GrowthMind messaging input." },
];

function OrchestrationPanel({ mode }: { mode: string }) {
  const qc = useQueryClient();
  const runFn = useServerFn(runOrchestrationPlaybookFn);
  const listFn = useServerFn(listOrchestrationRunsFn);
  const [open, setOpen] = useState(false);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["hivemind-orchestration-runs"],
    queryFn: () => listFn(),
    enabled: open,
    throwOnError: false,
  });
  const runs: any[] = data?.runs ?? [];
  const canRun = mode === "operator" || mode === "executive_operator";

  async function handleRun(key: string) {
    setRunningKey(key); setMsg(null);
    try {
      const r: any = await runFn({ data: { playbook: key } });
      if (r?.ok) {
        setMsg(r.status === "no_findings"
          ? "No issues found — nothing to coordinate."
          : `Coordinated plan created: ${r.findings} finding(s), ${r.taskIds.length} linked task(s), ${r.escalations.length} escalation(s).`);
      } else {
        setMsg(r?.error ?? "Orchestration failed");
      }
      qc.invalidateQueries({ queryKey: ["hivemind-orchestration-runs"] });
      qc.invalidateQueries({ queryKey: ["hivemind-shell-badge"] });
    } catch (e: any) {
      setMsg(e?.message ?? "Orchestration failed");
    } finally { setRunningKey(null); }
  }

  return (
    <div className="border-b border-white/[0.06] px-5 py-3">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 text-left">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-fuchsia-500/20 ring-1 ring-fuchsia-500/30 shrink-0">
          <Zap className="h-3.5 w-3.5 text-fuchsia-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">Cross-Mind Orchestration</p>
          <p className="text-[11px] text-muted-foreground truncate">
            {mode === "executive_operator"
              ? "Executive Operator active — playbooks can run automatically and on demand"
              : canRun
                ? "Run coordinated playbooks across your AI executives"
                : "Enable Operator or Executive Operator mode in Settings to run playbooks"}
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {ORCH_PLAYBOOKS.map(pb => (
              <div key={pb.key} className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-3 flex flex-col gap-2">
                <p className="text-xs font-medium">{pb.title}</p>
                <p className="text-[11px] text-muted-foreground flex-1">{pb.description}</p>
                <button
                  onClick={() => handleRun(pb.key)}
                  disabled={!canRun || runningKey !== null}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1.5 text-[11px] font-medium text-fuchsia-400 hover:bg-fuchsia-500/20 transition-all disabled:opacity-40"
                >
                  {runningKey === pb.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  Run playbook
                </button>
              </div>
            ))}
          </div>
          {msg && <p className="text-[11px] text-fuchsia-300">{msg}</p>}

          <div>
            <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Recent runs</p>
            {isLoading ? (
              <p className="text-[11px] text-muted-foreground">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No orchestration runs yet.</p>
            ) : (
              <div className="space-y-1.5">
                {runs.slice(0, 6).map((r: any) => (
                  <div key={r.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[11px] font-medium",
                        r.status === "completed" ? "text-emerald-400" : r.status === "no_findings" ? "text-muted-foreground" : "text-red-400")}>
                        {r.status === "completed" ? "Completed" : r.status === "no_findings" ? "No findings" : "Failed"}
                      </span>
                      <span className="text-[11px] text-foreground/80">
                        {ORCH_PLAYBOOKS.find(p => p.key === r.playbook)?.title ?? r.playbook}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{r.trigger_source}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground"><RelativeTime date={r.created_at} /></span>
                    </div>
                    {r.recommendation && <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{r.recommendation}</p>}
                    {(Array.isArray(r.task_ids) && r.task_ids.length > 0) && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {r.task_ids.length} linked task(s){Array.isArray(r.escalations) && r.escalations.length > 0 ? ` · ${r.escalations.length} escalation(s)` : ""}
                      </p>
                    )}
                    {r.error && <p className="mt-0.5 text-[10px] text-red-400">{r.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HiveMindActionsPage() {
  const qc           = useQueryClient();
  const mode         = useHiveMindMode();
  const getActionsFn     = useServerFn(getHiveMindActionsAndCounts);
  const approveFn        = useServerFn(approveHiveMindAction);
  const rejectFn         = useServerFn(rejectHiveMindAction);
  const deleteFn         = useServerFn(deleteHiveMindAction);
  const proposeFn        = useServerFn(proposeHiveMindAction);
  const generateFn       = useServerFn(generateOperatorActions);
  const getProposalsFn   = useServerFn(getCampaignProposals);
  const getLearningFn    = useServerFn(getHiveMindLearningSummary);
  const listRecsFn       = useServerFn(listExecutiveRecommendations);
  const actOnRecFn       = useServerFn(actOnExecutiveRecommendation);
  const updateRecFn      = useServerFn(updateExecutiveRecommendationStatus);
  const updateStatusFn   = useServerFn(updateProposalStatus);
  const genDnaProposalFn = useServerFn(generateDnaProposalsFn);

  const [tab,            setTab]         = useState<Tab>("pending");
  const [mutating,       setMutating]    = useState(false);
  const [generating,     setGenerating]  = useState(false);
  const [genMsg,         setGenMsg]      = useState<string | null>(null);
  const [showCreate,     setShowCreate]  = useState(false);
  const [genDna,         setGenDna]      = useState(false);
  const [proposalMuting, setPropMuting]  = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["hivemind-actions"],
    queryFn:  () => getActionsFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const { data: propData, isLoading: propLoading, refetch: refetchProps } = useQuery({
    queryKey: ["campaign-proposals-actions"],
    queryFn:  () => getProposalsFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const { data: learningData } = useQuery({
    queryKey: ["hivemind-learning-summary"],
    queryFn:  () => getLearningFn(),
    staleTime: 60_000,
    throwOnError: false,
    enabled: tab === "executed" || tab === "all",
  });

  const { data: recData, isLoading: recLoading, refetch: refetchRecs } = useQuery({
    queryKey: ["executive-recommendations"],
    queryFn:  () => listRecsFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const actions   = data?.actions ?? [];
  const proposals = propData?.proposals ?? [];
  const recs      = recData?.recommendations ?? [];
  const linkedActions = recData?.linkedActions ?? {};
  const tabCounts = {
    recommendations: recData?.openCount ?? 0,
    pending:   actions.filter(a => a.status === "pending").length,
    executed:  actions.filter(a => a.status === "executed").length,
    rejected:  actions.filter(a => ["rejected","failed"].includes(a.status)).length,
    all:       actions.length,
    proposals: proposals.filter((p: any) => p.status === "draft").length,
  };
  const visible = tab === "all" ? actions :
    tab === "rejected" ? actions.filter(a => ["rejected","failed"].includes(a.status)) :
    tab === "proposals" || tab === "recommendations" ? [] :
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
  async function handleCreate(d: { title: string; description?: string; action_type: string; action_payload?: Record<string, any>; proposed_by?: string }) {
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

  async function handlePropApprove(id: string) {
    setPropMuting(true);
    try { await updateStatusFn({ data: { proposalId: id, status: "approved" } }); await refetchProps(); }
    finally { setPropMuting(false); }
  }
  async function handlePropReject(id: string) {
    setPropMuting(true);
    try { await updateStatusFn({ data: { proposalId: id, status: "rejected" } }); await refetchProps(); }
    finally { setPropMuting(false); }
  }
  async function handleActOnRec(id: string) {
    setMutating(true); setGenMsg(null);
    try {
      const r = await actOnRecFn({ data: { id } });
      setGenMsg(
        r.downgraded
          ? "Routed as an internal task (Recommend mode limits external actions)"
          : r.sensitive
            ? "Sensitive follow-through created — explicit approval required before it runs"
            : "Follow-through action created — awaiting approval",
      );
      await Promise.all([refetchRecs(), refetch()]);
      qc.invalidateQueries({ queryKey: ["hivemind-shell-badge"] });
      setTimeout(() => setGenMsg(null), 6000);
    } catch (e: any) {
      setGenMsg(e?.message ?? "Could not act on this recommendation");
      setTimeout(() => setGenMsg(null), 6000);
    } finally { setMutating(false); }
  }
  async function handleDismissRec(id: string) {
    setMutating(true);
    try { await updateRecFn({ data: { id, status: "dismissed" } }); await refetchRecs(); }
    catch (e: any) { setGenMsg(e?.message ?? "Could not dismiss"); setTimeout(() => setGenMsg(null), 5000); }
    finally { setMutating(false); }
  }
  async function handleGenDnaProposals() {
    setGenDna(true); setGenMsg(null);
    try {
      const r = await genDnaProposalFn();
      setGenMsg(`${(r as any).count ?? 0} full campaign packages generated from your Business DNA`);
      await refetchProps();
      setTimeout(() => setGenMsg(null), 6000);
    } catch (e: any) {
      setGenMsg(e?.message ?? "Failed to generate proposals");
    } finally { setGenDna(false); }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "recommendations", label: "Executive Recommendations" },
    { key: "proposals", label: "Campaign Proposals" },
    { key: "pending",   label: "Pending Actions" },
    { key: "executed",  label: "Executed" },
    { key: "rejected",  label: "Rejected" },
    { key: "all",       label: "All Actions" },
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
            {tab === "proposals"
              ? tabCounts.proposals > 0
                ? `${tabCounts.proposals} campaign package${tabCounts.proposals !== 1 ? "s" : ""} awaiting approval`
                : "No draft campaign proposals"
              : tabCounts.pending > 0
                ? `${tabCounts.pending} action${tabCounts.pending !== 1 ? "s" : ""} awaiting your approval`
                : "No pending actions"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {genMsg && <p className="text-[11px] text-emerald-400 hidden sm:block">{genMsg}</p>}
          {tab === "proposals" ? (
            <button
              onClick={handleGenDnaProposals}
              disabled={genDna}
              className="flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-400 hover:bg-violet-500/20 transition-all disabled:opacity-40"
            >
              {genDna ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Dna className="h-3.5 w-3.5" />}
              Generate from DNA
            </button>
          ) : (
            (mode === "operator" || mode === "executive_operator") && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-40"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Generate Actions
              </button>
            )
          )}
          {tab !== "proposals" && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-xs font-medium text-white transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              Propose
            </button>
          )}
        </div>
      </div>

      {/* Cross-Mind orchestration (Executive Operator) */}
      <OrchestrationPanel mode={mode} />

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
        {tab === "recommendations" ? (
          recLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading recommendations…
            </div>
          ) : recs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
                <TrendingUp className="h-5 w-5 text-violet-400" />
              </div>
              <p className="text-sm font-medium">No executive recommendations yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                HiveMind's executive reasoning raises evidence-backed recommendations here as it
                analyses your workspace. Acting on one routes its follow-through into the approval queue.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {mode === "observe" && (
                <p className="text-[11px] text-muted-foreground rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  Observe mode: recommendations are read-only. Switch to Recommend, Assistant or Operator mode to act on them.
                </p>
              )}
              {recs.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  linked={linkedActions[rec.id]}
                  mode={mode}
                  onAct={handleActOnRec}
                  onDismiss={handleDismissRec}
                  isMutating={mutating}
                />
              ))}
            </div>
          )
        ) : tab === "proposals" ? (
          propLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading campaign proposals…
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-12 w-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3">
                <Package2 className="h-5 w-5 text-violet-400" />
              </div>
              <p className="text-sm font-medium">No campaign proposals yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Click "Generate from DNA" to create full 15-section campaign packages powered by your Business DNA profile.
              </p>
              <button onClick={handleGenDnaProposals} disabled={genDna}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-violet-500/15 border border-violet-500/30 px-4 py-2 text-xs font-medium text-violet-400 hover:bg-violet-500/25 transition-all disabled:opacity-40">
                {genDna ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Dna className="h-3.5 w-3.5" />}
                Generate from DNA
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {proposals.map((p: any) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  onApprove={handlePropApprove}
                  onReject={handlePropReject}
                  isMutating={proposalMuting}
                />
              ))}
            </div>
          )
        ) : isLoading ? (
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
              {tab === "pending" && (mode === "operator" || mode === "executive_operator")
                ? "Click 'Generate Actions' to let HiveMind analyse your platform"
                : tab === "pending"
                  ? "Switch to Operator mode to generate intelligent action proposals"
                  : `Actions will appear here when they are ${tab}`}
            </p>
            {tab === "pending" && (mode === "operator" || mode === "executive_operator") && (
              <button onClick={handleGenerate} disabled={generating}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-4 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/25 transition-all disabled:opacity-40">
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Generate actions now
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {(tab === "executed" || tab === "all") && (
              <LearningSummaryPanel adjustments={learningData?.adjustments ?? []} />
            )}
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
