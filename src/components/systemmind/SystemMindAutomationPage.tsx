import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Zap, Loader2, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck,
  CheckCircle2, XCircle, Pause, Play, Send, Sparkles, ScrollText,
  AlertTriangle, Bot, ListChecks, KeyRound, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  generateAutomationDraft,
  listAutomationDrafts,
  listAutomationAudit,
  submitDraftForApproval,
  rejectAutomationDraft,
  setAutomationPaused,
} from "@/lib/systemmind/systemmind-automation.functions";
import { approveHiveMindAction } from "@/lib/hivemind/hivemind.actions";

// ── Meta ──────────────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; color: string }> = {
  draft:            { label: "Draft",            color: "text-muted-foreground border-white/10" },
  pending_approval: { label: "Pending Approval", color: "text-amber-400 border-amber-500/30"    },
  approved:         { label: "Approved",         color: "text-sky-400 border-sky-500/30"        },
  active:           { label: "Active",           color: "text-emerald-400 border-emerald-500/30"},
  paused:           { label: "Paused",           color: "text-orange-400 border-orange-500/30"  },
  rejected:         { label: "Rejected",         color: "text-red-400 border-red-500/30"        },
  failed:           { label: "Failed",           color: "text-red-400 border-red-500/30"        },
};

const RISK_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  low:    { label: "Low risk",    color: "text-emerald-400 border-emerald-500/30", icon: ShieldCheck },
  medium: { label: "Medium risk", color: "text-amber-400 border-amber-500/30",     icon: ShieldAlert },
  high:   { label: "HIGH RISK",   color: "text-red-400 border-red-500/30",         icon: ShieldAlert },
};

interface AutomationDraft {
  id:                   string;
  title:                string;
  purpose:              string | null;
  status:               string;
  risk_level:           "low" | "medium" | "high";
  risk_reasons:         string[];
  payload:              Record<string, any>;
  required_credentials: string[];
  test_plan:            string[];
  model_provider:       string | null;
  model_id:             string | null;
  hivemind_action_id:   string | null;
  activated_target_id:  string | null;
  error_message:        string | null;
  created_at:           string;
}

// ── Draft card ────────────────────────────────────────────────────────────────
function DraftCard({
  draft, busy,
  onSubmit, onApprove, onReject, onPause, onResume, onShowAudit,
}: {
  draft: AutomationDraft;
  busy: boolean;
  onSubmit:    (d: AutomationDraft) => void;
  onApprove:   (d: AutomationDraft) => void;
  onReject:    (d: AutomationDraft) => void;
  onPause:     (d: AutomationDraft) => void;
  onResume:    (d: AutomationDraft) => void;
  onShowAudit: (d: AutomationDraft) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sMeta = STATUS_META[draft.status] ?? { label: draft.status, color: "text-muted-foreground border-white/10" };
  const rMeta = RISK_META[draft.risk_level] ?? RISK_META.low;
  const RiskIcon = rMeta.icon;
  const steps: any[] = draft.payload?.flow_definition?.steps ?? [];
  const customPrompt: string = draft.payload?.custom_prompt ?? "";

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/20">
            <Zap className="h-3.5 w-3.5 text-cyan-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold">{draft.title}</p>
                {draft.purpose && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{draft.purpose}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className={cn("text-[10px] font-semibold", rMeta.color)}>
                  <RiskIcon className="mr-1 h-2.5 w-2.5" />{rMeta.label}
                </Badge>
                <Badge variant="outline" className={cn("text-[10px] font-semibold", sMeta.color)}>
                  {sMeta.label}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                <ListChecks className="mr-1 h-2.5 w-2.5" />{steps.length} steps
              </Badge>
              {draft.model_id && (
                <Badge variant="outline" className="text-[10px]">
                  <Bot className="mr-1 h-2.5 w-2.5" />
                  {draft.model_provider === "claude" ? "Claude" : draft.model_provider === "openai" ? "GPT" : draft.model_provider} · {draft.model_id}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" /><RelativeTime date={draft.created_at} />
              </span>
            </div>

            {draft.risk_level === "high" && draft.status !== "rejected" && (
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
                <p className="text-[11px] font-semibold text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> High-risk automation — explicit approval required
                </p>
                {draft.risk_reasons?.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {draft.risk_reasons.map((r, i) => (
                      <li key={i} className="text-[10px] text-red-300/80">• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {draft.error_message && (
              <p className="mt-2 text-[11px] text-red-400">{draft.error_message}</p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {draft.status === "draft" && (
                <>
                  <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => onSubmit(draft)}>
                    {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                    Submit for approval
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300" disabled={busy} onClick={() => onReject(draft)}>
                    <XCircle className="mr-1 h-3 w-3" /> Discard
                  </Button>
                </>
              )}
              {draft.status === "pending_approval" && (
                <>
                  <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500" disabled={busy} onClick={() => onApprove(draft)}>
                    {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                    Approve &amp; Activate
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300" disabled={busy} onClick={() => onReject(draft)}>
                    <XCircle className="mr-1 h-3 w-3" /> Reject
                  </Button>
                </>
              )}
              {draft.status === "active" && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onPause(draft)}>
                  <Pause className="mr-1 h-3 w-3" /> Pause
                </Button>
              )}
              {draft.status === "paused" && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onResume(draft)}>
                  <Play className="mr-1 h-3 w-3" /> Resume
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => onShowAudit(draft)}>
                <ScrollText className="mr-1 h-3 w-3" /> Audit trail
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground ml-auto" onClick={() => setExpanded((e) => !e)}>
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? "Hide details" : "Details"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] bg-black/20 p-4 space-y-4">
          {/* Steps */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Workflow steps</p>
            <div className="space-y-1">
              {steps.map((s: any, i: number) => (
                <div key={s.id ?? i} className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
                  <Badge variant="outline" className="text-[10px] font-mono">{s.type}</Badge>
                  {s.title && <span className="text-muted-foreground truncate">{s.title}</span>}
                  {s.status && <span className="text-muted-foreground">→ {s.status}</span>}
                  {s.template && <span className="text-muted-foreground">template: {s.template}</span>}
                  {(s.delay_hours != null || s.delay_minutes != null) && (
                    <span className="text-muted-foreground">
                      delay {s.delay_hours ?? 0}h {s.delay_minutes ?? 0}m
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {customPrompt && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Custom prompt</p>
              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap bg-white/[0.02] border border-white/[0.05] rounded-lg p-3 max-h-48 overflow-y-auto">{customPrompt}</pre>
            </div>
          )}

          {draft.required_credentials?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <KeyRound className="h-3 w-3" /> Required credentials (placeholders — values never stored)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {draft.required_credentials.map((c, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">{c}</Badge>
                ))}
              </div>
            </div>
          )}

          {draft.test_plan?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Test plan (run before approving)</p>
              <ol className="space-y-0.5">
                {draft.test_plan.map((t, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground">{i + 1}. {t}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Audit dialog (inline panel) ───────────────────────────────────────────────
function AuditPanel({ draftId, onClose }: { draftId: string; onClose: () => void }) {
  const listAuditFn = useServerFn(listAutomationAudit);
  const { data: rows, isLoading } = useQuery({
    queryKey: ["systemmind-automation-audit", draftId],
    queryFn: () => listAuditFn({ data: { targetId: draftId } }),
    throwOnError: false,
  });

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-cyan-400" /> Audit trail
        </p>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>Close</Button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading audit log…
        </div>
      ) : !rows || rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No audit entries for this draft yet.</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {rows.map((r: any) => (
            <div key={r.id} className="flex items-start gap-2 text-[11px] border-b border-white/[0.04] pb-2 last:border-0">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">{r.action_type}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground">
                  {r.before_state?.status && r.final_after_state?.status
                    ? `${r.before_state.status} → ${r.final_after_state.status}`
                    : r.proposed_after_state?.status
                      ? `→ ${r.proposed_after_state.status}`
                      : r.error
                        ? <span className="text-red-400">{r.error}</span>
                        : "—"}
                  {r.approved_by ? ` · approved by ${r.approved_by}` : ""}
                </p>
              </div>
              <span className="text-muted-foreground shrink-0"><RelativeTime date={r.created_at} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function SystemMindAutomationPage() {
  const qc = useQueryClient();
  const [description, setDescription] = useState("");
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const generateFn   = useServerFn(generateAutomationDraft);
  const listFn       = useServerFn(listAutomationDrafts);
  const submitFn     = useServerFn(submitDraftForApproval);
  const approveFn    = useServerFn(approveHiveMindAction);
  const rejectFn     = useServerFn(rejectAutomationDraft);
  const pauseFn      = useServerFn(setAutomationPaused);

  const { data, isLoading } = useQuery({
    queryKey: ["systemmind-automation-drafts"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const drafts: AutomationDraft[] = (data?.drafts ?? []) as AutomationDraft[];
  const claudeEnabled = data?.claudeEnabled ?? false;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["systemmind-automation-drafts"] });
    if (auditFor) qc.invalidateQueries({ queryKey: ["systemmind-automation-audit", auditFor] });
  };

  const generateMut = useMutation({
    mutationFn: () => generateFn({ data: { description: description.trim() } }),
    onSuccess: (res: any) => {
      toast.success(`Draft generated with ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""} — review it below.`);
      setDescription("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  async function runAction(draft: AutomationDraft, fn: () => Promise<unknown>, okMsg: string) {
    setBusyId(draft.id);
    try {
      await fn();
      toast.success(okMsg);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
      invalidate();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SystemMindShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-cyan-400" /> SystemMind Automation
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Describe an automation and SystemMind will draft a workspace workflow. Drafts never run
            until you approve them — high-risk drafts are flagged and always require explicit approval.
          </p>
        </div>

        {/* Model banner */}
        <div className={cn(
          "rounded-lg border px-3 py-2 text-[11px] flex items-center gap-2",
          claudeEnabled
            ? "border-violet-500/20 bg-violet-500/[0.06] text-violet-300"
            : "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
        )}>
          <Sparkles className="h-3.5 w-3.5" />
          {claudeEnabled
            ? "Claude (claude-sonnet-4-5) is generating drafts, with GPT-4.1 as automatic fallback."
            : "Claude generation is disabled — drafts are generated with GPT-4.1. Set SYSTEMMIND_CLAUDE_ENABLED=true to enable Claude."}
        </div>

        {/* Generate form */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <p className="text-sm font-semibold">Describe what you want automated</p>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "When a new lead is added, create a task for my team, wait 2 hours, then queue a callback if the lead is still in need_to_call."'
            className="min-h-[90px] text-sm bg-white/[0.02] border-white/[0.08]"
            maxLength={4000}
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              SystemMind only drafts — nothing runs without your approval.
            </p>
            <Button
              size="sm"
              disabled={description.trim().length < 10 || generateMut.isPending}
              onClick={() => generateMut.mutate()}
            >
              {generateMut.isPending
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Generating…</>
                : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Generate draft</>}
            </Button>
          </div>
        </div>

        {/* Audit panel */}
        {auditFor && <AuditPanel draftId={auditFor} onClose={() => setAuditFor(null)} />}

        {/* Drafts list */}
        <div className="space-y-3">
          <p className="text-sm font-semibold">Drafts &amp; automations</p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading drafts…
            </div>
          ) : drafts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] p-8 text-center">
              <Zap className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No automation drafts yet — describe one above to get started.</p>
            </div>
          ) : (
            drafts.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                busy={busyId === d.id}
                onSubmit={(dr) => runAction(dr, () => submitFn({ data: { draftId: dr.id } }), "Submitted for approval — approve below or in HiveMind Action Centre.")}
                onApprove={(dr) => {
                  if (!dr.hivemind_action_id) { toast.error("No approval record linked."); return; }
                  runAction(dr, () => approveFn({ data: { id: dr.hivemind_action_id!, approved_by: "User" } }), "Approved — automation is now active.");
                }}
                onReject={(dr) => runAction(dr, () => rejectFn({ data: { draftId: dr.id } }), "Draft rejected.")}
                onPause={(dr) => runAction(dr, () => pauseFn({ data: { draftId: dr.id, paused: true } }), "Automation paused.")}
                onResume={(dr) => runAction(dr, () => pauseFn({ data: { draftId: dr.id, paused: false } }), "Automation resumed.")}
                onShowAudit={(dr) => setAuditFor(auditFor === dr.id ? null : dr.id)}
              />
            ))
          )}
        </div>
      </div>
    </SystemMindShell>
  );
}
