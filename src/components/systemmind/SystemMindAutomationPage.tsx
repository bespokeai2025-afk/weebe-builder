import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Zap, Loader2, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck,
  CheckCircle2, XCircle, Pause, Play, Send, Sparkles, ScrollText,
  AlertTriangle, Bot, ListChecks, KeyRound, Clock,
  MessageSquare, CalendarClock, GitBranch, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  generateAutomationDraft,
  listAutomationDrafts,
  listAutomationAudit,
  submitDraftForApproval,
  rejectAutomationDraft,
  setAutomationPaused,
} from "@/lib/systemmind/systemmind-automation.functions";
import {
  generateWhatsAppSetupDraft,
  generateFollowUpSequenceDraft,
  convertN8nWorkflowToDraft,
  listConvertibleN8nWorkflows,
} from "@/lib/systemmind/systemmind-generators.functions";
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

const KIND_META: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  workspace_workflow: { label: "Workflow",           color: "text-cyan-400 border-cyan-500/30",     icon: Workflow },
  whatsapp_setup:     { label: "WhatsApp Setup",     color: "text-green-400 border-green-500/30",   icon: MessageSquare },
  follow_up_sequence: { label: "Follow-Up Sequence", color: "text-violet-400 border-violet-500/30", icon: CalendarClock },
  n8n_blueprint:      { label: "n8n Conversion",     color: "text-orange-400 border-orange-500/30", icon: GitBranch },
  accountsmind_config:{ label: "AccountsMind Config",color: "text-emerald-400 border-emerald-500/30",icon: ListChecks },
  onboarding_plan:    { label: "Onboarding Plan",    color: "text-sky-400 border-sky-500/30",       icon: CheckCircle2 },
};

interface AutomationDraft {
  id:                   string;
  action_kind:          string;
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

function stepsSummaryFor(draft: AutomationDraft): { count: number; noun: string } {
  const p = draft.payload ?? {};
  switch (draft.action_kind) {
    case "whatsapp_setup":     return { count: (p.setup_steps ?? []).length,        noun: "setup steps" };
    case "follow_up_sequence": return { count: (p.sequence ?? []).length,           noun: "sequence steps" };
    case "n8n_blueprint":      return { count: (p.blueprint?.steps ?? []).length,   noun: "steps" };
    case "accountsmind_config": return { count: (p.fields ?? []).length + (p.stats ?? []).length + (p.widgets ?? []).length, noun: "config items" };
    case "onboarding_plan":    return { count: (p.items ?? []).length,             noun: "checklist steps" };
    default:                   return { count: (p.flow_definition?.steps ?? []).length, noun: "steps" };
  }
}

// ── Kind-specific expanded detail renderers ───────────────────────────────────
function WhatsAppSetupDetail({ payload }: { payload: Record<string, any> }) {
  const setupSteps: any[] = payload.setup_steps ?? [];
  const webhook = payload.webhook_config ?? {};
  const binding = payload.agent_binding ?? {};
  const templates: any[] = payload.message_templates ?? [];

  return (
    <>
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
          Setup checklist ({String(payload.provider ?? "")})
        </p>
        <ol className="space-y-1.5">
          {setupSteps.map((s: any, i: number) => (
            <li key={i} className="text-[11px] flex items-start gap-2">
              <span className="text-muted-foreground w-5 text-right shrink-0">{s.order ?? i + 1}.</span>
              <div className="min-w-0">
                <span className="font-medium">{s.title}</span>
                {s.requires_credentials && (
                  <Badge variant="outline" className="ml-1.5 text-[9px] border-amber-500/30 text-amber-400">
                    <KeyRound className="mr-0.5 h-2 w-2" /> credentials
                  </Badge>
                )}
                {s.details && <p className="text-muted-foreground mt-0.5">{s.details}</p>}
                {Array.isArray(s.credential_names) && s.credential_names.length > 0 && (
                  <p className="text-[10px] text-amber-400/80 mt-0.5">
                    Needs: {s.credential_names.join(", ")} (enter in WhatsApp Settings — never stored here)
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {(webhook.inbound_path || webhook.verify_hint || webhook.notes) && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Webhook</p>
          {webhook.inbound_path && (
            <p className="text-[11px] font-mono text-cyan-300 break-all">{webhook.inbound_path}</p>
          )}
          {webhook.verify_hint && <p className="text-[11px] text-muted-foreground mt-0.5">{webhook.verify_hint}</p>}
          {webhook.notes && <p className="text-[11px] text-muted-foreground mt-0.5">{webhook.notes}</p>}
        </div>
      )}

      {(binding.agent_id || binding.agent_name || binding.notes) && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Agent binding</p>
          <p className="text-[11px] text-muted-foreground">
            {binding.agent_name ?? binding.agent_id ?? "No agent selected"}
            {binding.notes ? ` — ${binding.notes}` : ""}
          </p>
        </div>
      )}

      {templates.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Starter message templates</p>
          <div className="space-y-2">
            {templates.map((t: any, i: number) => (
              <div key={i} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
                <p className="text-[11px] font-medium">
                  {t.name}{t.language ? <span className="text-muted-foreground font-normal"> · {t.language}</span> : null}
                </p>
                <p className="text-[11px] text-muted-foreground whitespace-pre-wrap mt-1">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function FollowUpSequenceDetail({ payload }: { payload: Record<string, any> }) {
  const sequence: any[] = payload.sequence ?? [];
  const stops: string[] = payload.stop_conditions ?? [];
  const targets: string[] = payload.target_statuses ?? [];

  return (
    <>
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Sequence timeline</p>
        <div className="space-y-1.5">
          {sequence.map((s: any, i: number) => (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <Badge variant="outline" className="text-[10px] shrink-0 border-violet-500/30 text-violet-300">
                Day {s.day_number}
              </Badge>
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">{s.channel}</Badge>
              <div className="min-w-0">
                <span className="font-medium">{s.title}</span>
                {s.message && <p className="text-muted-foreground mt-0.5 line-clamp-3 whitespace-pre-wrap">{s.message}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {targets.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Target lead statuses</p>
          <div className="flex flex-wrap gap-1.5">
            {targets.map((t, i) => <Badge key={i} variant="outline" className="text-[10px]">{t}</Badge>)}
          </div>
        </div>
      )}

      {stops.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Stops when</p>
          <ul className="space-y-0.5">
            {stops.map((s, i) => <li key={i} className="text-[11px] text-muted-foreground">• {s}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function N8nBlueprintDetail({ payload }: { payload: Record<string, any> }) {
  const bpSteps: any[] = payload.blueprint?.steps ?? [];
  const report = payload.mapping_report ?? {};
  const converted: any[] = report.converted ?? [];
  const unconvertible: any[] = report.unconvertible ?? [];
  const warnings: string[] = report.warnings ?? [];

  return (
    <>
      {payload.source?.name && (
        <p className="text-[11px] text-muted-foreground">
          Converted from n8n workflow: <span className="font-medium text-foreground">{payload.source.name}</span>
        </p>
      )}

      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">WEBEE workflow steps</p>
        <div className="space-y-1">
          {bpSteps.map((s: any, i: number) => (
            <div key={s.id ?? i} className="flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground w-5 text-right">{i + 1}.</span>
              <Badge variant="outline" className="text-[10px] font-mono">{s.type}</Badge>
              {s.title && <span className="text-muted-foreground truncate">{s.title}</span>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Conversion report</p>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
            {converted.length} converted
          </Badge>
          <Badge variant="outline" className={cn(
            "text-[10px]",
            unconvertible.length > 0 ? "border-red-500/30 text-red-400" : "border-white/10 text-muted-foreground",
          )}>
            {unconvertible.length} unconvertible
          </Badge>
        </div>
        {unconvertible.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] p-2.5 space-y-1 mb-2">
            <p className="text-[11px] font-semibold text-red-400">Needs manual attention:</p>
            {unconvertible.map((u: any, i: number) => (
              <p key={i} className="text-[10px] text-red-300/80">
                • <span className="font-mono">{u.node}</span> ({u.n8n_type}) — {u.reason}
              </p>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <ul className="space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-[10px] text-amber-400/80">⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function AccountsMindConfigDetail({ payload }: { payload: Record<string, any> }) {
  const fields:  any[] = payload.fields  ?? [];
  const stats:   any[] = payload.stats   ?? [];
  const widgets: any[] = payload.widgets ?? [];
  const risks: string[] = payload.risks ?? [];

  const Section = ({ title, items, render }: { title: string; items: any[]; render: (i: any) => React.ReactNode }) =>
    items.length === 0 ? null : (
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{title}</p>
        <div className="space-y-1">{items.map((it, i) => <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">{render(it)}</div>)}</div>
      </div>
    );

  return (
    <>
      <Section title={`Custom fields (${fields.length})`} items={fields} render={(f) => (
        <>
          <Badge variant="outline" className="text-[10px] font-mono">{f.field_key}</Badge>
          <span className="font-medium">{f.label}</span>
          <span className="text-muted-foreground">{f.field_type} · {f.entity_type}</span>
          {f.client_visible && <Badge variant="outline" className="text-[9px] border-sky-500/30 text-sky-400">client-visible</Badge>}
        </>
      )} />
      <Section title={`Stats (${stats.length})`} items={stats} render={(s) => (
        <>
          <Badge variant="outline" className="text-[10px] font-mono">{s.stat_key}</Badge>
          <span className="font-medium">{s.label}</span>
          <span className="text-muted-foreground">metric: {s.metric_key} · {s.format}</span>
          {s.client_visible && <Badge variant="outline" className="text-[9px] border-sky-500/30 text-sky-400">client-visible</Badge>}
        </>
      )} />
      <Section title={`Widgets (${widgets.length})`} items={widgets} render={(w) => (
        <>
          <Badge variant="outline" className="text-[10px] font-mono">{w.widget_key}</Badge>
          <span className="font-medium">{w.title}</span>
          <span className="text-muted-foreground">{w.widget_type} · metric: {w.metric_key}</span>
          {w.client_visible && <Badge variant="outline" className="text-[9px] border-sky-500/30 text-sky-400">client-visible</Badge>}
        </>
      )} />
      {risks.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Risks noted by SystemMind</p>
          <ul className="space-y-0.5">
            {risks.map((r, i) => <li key={i} className="text-[11px] text-amber-400/80">• {r}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function OnboardingPlanDetail({ payload }: { payload: Record<string, any> }) {
  const items: any[] = payload.items ?? [];
  return (
    <>
      {payload.business_summary && (
        <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{payload.business_summary}</p>
      )}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Checklist steps (completion is verified automatically once live)</p>
        <ol className="space-y-1.5">
          {items.map((s: any, i: number) => (
            <li key={i} className="text-[11px] flex items-start gap-2">
              <span className="text-muted-foreground w-5 text-right shrink-0">{i + 1}.</span>
              <div className="min-w-0">
                <span className="font-medium">{s.title}</span>
                <Badge variant="outline" className="ml-1.5 text-[9px] font-mono">{s.check_key}</Badge>
                {s.why && <p className="text-muted-foreground mt-0.5">{s.why}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
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
  const kMeta = KIND_META[draft.action_kind] ?? KIND_META.workspace_workflow;
  const KindIcon = kMeta.icon;
  const stepsSummary = stepsSummaryFor(draft);
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
              <Badge variant="outline" className={cn("text-[10px] font-semibold", kMeta.color)}>
                <KindIcon className="mr-1 h-2.5 w-2.5" />{kMeta.label}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <ListChecks className="mr-1 h-2.5 w-2.5" />{stepsSummary.count} {stepsSummary.noun}
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
          {/* Kind-specific detail */}
          {draft.action_kind === "whatsapp_setup" ? (
            <WhatsAppSetupDetail payload={draft.payload ?? {}} />
          ) : draft.action_kind === "follow_up_sequence" ? (
            <FollowUpSequenceDetail payload={draft.payload ?? {}} />
          ) : draft.action_kind === "n8n_blueprint" ? (
            <N8nBlueprintDetail payload={draft.payload ?? {}} />
          ) : draft.action_kind === "accountsmind_config" ? (
            <AccountsMindConfigDetail payload={draft.payload ?? {}} />
          ) : draft.action_kind === "onboarding_plan" ? (
            <OnboardingPlanDetail payload={draft.payload ?? {}} />
          ) : (
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
          )}

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
type GeneratorMode = "workflow" | "whatsapp" | "sequence" | "n8n";

const MODE_TABS: Array<{ id: GeneratorMode; label: string; icon: React.ElementType }> = [
  { id: "workflow", label: "Workflow",           icon: Workflow },
  { id: "whatsapp", label: "WhatsApp Setup",     icon: MessageSquare },
  { id: "sequence", label: "Follow-Up Sequence", icon: CalendarClock },
  { id: "n8n",      label: "n8n Conversion",     icon: GitBranch },
];

const MODE_PLACEHOLDERS: Record<GeneratorMode, string> = {
  workflow: 'e.g. "When a new lead is added, create a task for my team, wait 2 hours, then queue a callback if the lead is still in need_to_call."',
  whatsapp: 'e.g. "Set up WhatsApp for our dental clinic — appointment reminders and answering opening-hours questions with our receptionist agent."',
  sequence: 'e.g. "A 7-day follow-up for leads we could not reach: email on day 1, WhatsApp on day 3, AI call on day 5, final email on day 7. Stop if they book."',
  n8n:      "",
};

export function SystemMindAutomationPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<GeneratorMode>("workflow");
  const [description, setDescription] = useState("");
  const [waProvider, setWaProvider] = useState<"twilio" | "wati" | "meta">("twilio");
  const [n8nRowId, setN8nRowId] = useState<string>("");
  const [auditFor, setAuditFor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const generateFn   = useServerFn(generateAutomationDraft);
  const generateWaFn = useServerFn(generateWhatsAppSetupDraft);
  const generateSeqFn = useServerFn(generateFollowUpSequenceDraft);
  const convertN8nFn = useServerFn(convertN8nWorkflowToDraft);
  const listN8nFn    = useServerFn(listConvertibleN8nWorkflows);
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

  const { data: n8nWorkflows, isLoading: n8nLoading } = useQuery({
    queryKey: ["systemmind-convertible-n8n"],
    queryFn: () => listN8nFn(),
    enabled: mode === "n8n",
    throwOnError: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["systemmind-automation-drafts"] });
    if (auditFor) qc.invalidateQueries({ queryKey: ["systemmind-automation-audit", auditFor] });
  };

  const generateMut = useMutation({
    mutationFn: async () => {
      if (mode === "whatsapp") {
        return generateWaFn({ data: { provider: waProvider, description: description.trim() } });
      }
      if (mode === "sequence") {
        return generateSeqFn({ data: { description: description.trim() } });
      }
      if (mode === "n8n") {
        return convertN8nFn({ data: { n8nRowId } });
      }
      return generateFn({ data: { description: description.trim() } });
    },
    onSuccess: (res: any) => {
      const model = res?.modelUsed ? ` with ${res.modelUsed}${res.usedFallback ? " (fallback)" : ""}` : "";
      toast.success(`Draft generated${model} — review it below.`);
      setDescription("");
      setN8nRowId("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Generation failed"),
  });

  const canGenerate = mode === "n8n"
    ? n8nRowId.length > 0
    : description.trim().length >= 10;

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

  const Wrapper = embedded ? AutomationEmbedded : SystemMindShell;
  return (
    <Wrapper>
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
          {/* Generator kind tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {MODE_TABS.map((t) => {
              const TabIcon = t.icon;
              const active = mode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMode(t.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                    active
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground hover:border-white/20",
                  )}
                >
                  <TabIcon className="h-3 w-3" /> {t.label}
                </button>
              );
            })}
          </div>

          <p className="text-sm font-semibold">
            {mode === "workflow" && "Describe what you want automated"}
            {mode === "whatsapp" && "Describe your WhatsApp use case"}
            {mode === "sequence" && "Describe the follow-up sequence you want"}
            {mode === "n8n" && "Pick an n8n workflow to convert into a WEBEE workflow draft"}
          </p>

          {mode === "whatsapp" && (
            <Select value={waProvider} onValueChange={(v) => setWaProvider(v as "twilio" | "wati" | "meta")}>
              <SelectTrigger className="w-56 h-8 text-xs bg-white/[0.02] border-white/[0.08]">
                <SelectValue placeholder="WhatsApp provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="twilio">Twilio WhatsApp</SelectItem>
                <SelectItem value="wati">WATI</SelectItem>
                <SelectItem value="meta">Meta WhatsApp Cloud API</SelectItem>
              </SelectContent>
            </Select>
          )}

          {mode === "n8n" ? (
            n8nLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading discovered n8n workflows…
              </div>
            ) : !n8nWorkflows || n8nWorkflows.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No discovered n8n workflows for this workspace yet. Run n8n discovery first (SystemMind → n8n),
                then come back here to convert one.
              </p>
            ) : (
              <Select value={n8nRowId} onValueChange={setN8nRowId}>
                <SelectTrigger className="w-full h-9 text-xs bg-white/[0.02] border-white/[0.08]">
                  <SelectValue placeholder="Choose an n8n workflow…" />
                </SelectTrigger>
                <SelectContent>
                  {(n8nWorkflows as any[]).map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name ?? w.n8n_workflow_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={MODE_PLACEHOLDERS[mode]}
              className="min-h-[90px] text-sm bg-white/[0.02] border-white/[0.08]"
              maxLength={4000}
            />
          )}

          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              SystemMind only drafts — nothing runs without your approval.
            </p>
            <Button
              size="sm"
              disabled={!canGenerate || generateMut.isPending}
              onClick={() => generateMut.mutate()}
            >
              {generateMut.isPending
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> {mode === "n8n" ? "Converting…" : "Generating…"}</>
                : <><Sparkles className="mr-1.5 h-3.5 w-3.5" /> {mode === "n8n" ? "Convert to draft" : "Generate draft"}</>}
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
    </Wrapper>
  );
}

function AutomationEmbedded({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
