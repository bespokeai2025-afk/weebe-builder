/**
 * Shared Intelligence Packet renderer — used by the Tasks page, the Action
 * Approval Centre and the HiveMind orb. Renders the human-readable summary
 * (objective, target, readiness, evidence, proposed outcome, approval scope,
 * freshness, blocker) with expandable detail sections; raw UUIDs and raw JSON
 * live ONLY behind "Developer details".
 */
import { useState } from "react";
import {
  ChevronDown, ChevronUp, AlertTriangle, ShieldCheck, Database,
  Target, ClipboardList, TrendingUp, Wrench, Eye, Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  isApprovableReadiness,
  type UniversalMindIntelligencePacket,
} from "@/lib/minds/intelligence-packet.shared";
import {
  readinessLabel, packetDataFreshness, packetMainBlocker, packetConfidence,
  type ApprovalDialogMeta,
} from "@/lib/minds/intelligence-packet-ui.shared";

// ── Readiness badge ──────────────────────────────────────────────────────────
export function ReadinessBadge({ state }: { state: string | null | undefined }) {
  if (state == null) return null;
  const approvable = isApprovableReadiness(state);
  const blocked = state === "blocked";
  return (
    <span className={cn(
      "text-[10px] rounded-full px-1.5 py-0.5 border font-medium whitespace-nowrap",
      approvable ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
        : blocked ? "bg-red-500/15 text-red-400 border-red-500/25"
        : "bg-amber-500/15 text-amber-400 border-amber-500/25",
    )}>
      {readinessLabel(state)}
    </span>
  );
}

// ── Detail section helper ────────────────────────────────────────────────────
function Section({ icon: Icon, title, children }: {
  icon: React.ElementType; title: string; children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
        <Icon className="h-3 w-3" /> {title}
      </p>
      {children}
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────
export function IntelligencePacketPanel({ packet, readinessState, compact = false }: {
  packet: UniversalMindIntelligencePacket | null | undefined;
  readinessState?: string | null;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  if (!packet) return null;

  const target = packet.targets?.[0];
  const freshness = packetDataFreshness(packet);
  const blocker = packetMainBlocker(packet);
  const confidence = packetConfidence(packet);
  const scope = packet.approval_scope;

  return (
    <div className="rounded-lg border border-sky-500/15 bg-sky-500/[0.03]">
      {/* Summary — always visible */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold text-sky-300 uppercase tracking-wider">Intelligence Packet</span>
          <ReadinessBadge state={readinessState ?? null} />
          {confidence != null && (
            <span className="text-[10px] text-muted-foreground">Confidence {confidence}%</span>
          )}
          {freshness && (
            <span className="text-[10px] text-muted-foreground">Data as of <RelativeTime date={freshness} short /></span>
          )}
        </div>
        <p className="text-[11px] text-foreground/85 leading-relaxed">{packet.objective}</p>
        {target && (
          <p className="text-[11px] text-muted-foreground">
            <Target className="inline h-3 w-3 mr-1 -mt-0.5" />
            Target: <span className="text-foreground/80">
              {target.entity_name ?? target.entity_type}
            </span>{" "}
            <span className="text-muted-foreground/70">({target.domain}{target.resolved ? "" : " · unresolved"})</span>
          </p>
        )}
        {packet.evidence.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            <Database className="inline h-3 w-3 mr-1 -mt-0.5" />
            {packet.evidence.length} evidence source{packet.evidence.length !== 1 ? "s" : ""} —{" "}
            <span className="text-foreground/70">{packet.evidence[0].description}</span>
          </p>
        )}
        {packet.deliverables.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            <ClipboardList className="inline h-3 w-3 mr-1 -mt-0.5" />
            Outcome: <span className="text-foreground/70">{packet.deliverables.join("; ")}</span>
          </p>
        )}
        {scope && (
          <p className="text-[11px] text-muted-foreground">
            <ShieldCheck className="inline h-3 w-3 mr-1 -mt-0.5" />
            Approval needed: <span className="text-foreground/70">{scope.summary}</span>
            {scope.sensitive && <span className="ml-1.5 text-amber-400">(sensitive)</span>}
          </p>
        )}
        {blocker && (
          <p className="text-[11px] text-amber-300/90">
            <AlertTriangle className="inline h-3 w-3 mr-1 -mt-0.5" />
            {blocker}
          </p>
        )}
        {!compact && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-[10px] text-sky-400/80 hover:text-sky-300 transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide full packet" : "Show full packet"}
          </button>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && !compact && (
        <div className="border-t border-sky-500/10 px-3 py-3 space-y-3">
          {packet.diagnosis && (
            <Section icon={Eye} title="Diagnosis">
              <p className="text-[11px] text-foreground/80 leading-relaxed">{packet.diagnosis}</p>
            </Section>
          )}
          {packet.evidence.length > 0 && (
            <Section icon={Database} title="Evidence">
              <ul className="space-y-1">
                {packet.evidence.map((e, i) => (
                  <li key={i} className="text-[11px] text-foreground/75 leading-relaxed">
                    <span className="text-muted-foreground">{e.source}:</span> {e.description}
                    {" "}<span className="text-muted-foreground/60">(<RelativeTime date={e.retrieved_at} short />)</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {packet.plan_steps.length > 0 && (
            <Section icon={ClipboardList} title="Execution plan">
              <ol className="space-y-0.5 list-decimal list-inside">
                {packet.plan_steps.map((s) => (
                  <li key={s.order} className="text-[11px] text-foreground/75">
                    {s.title}{s.detail ? <span className="text-muted-foreground"> — {s.detail}</span> : null}
                  </li>
                ))}
              </ol>
            </Section>
          )}
          {packet.proposed_changes.length > 0 && (
            <Section icon={Wrench} title="Proposed changes">
              <ul className="space-y-1">
                {packet.proposed_changes.map((c, i) => (
                  <li key={i} className="text-[11px] text-foreground/75">
                    <span className="text-muted-foreground">{c.target}:</span> {c.change}{" "}
                    <span className={c.reversible ? "text-emerald-400/70" : "text-red-400/80"}>
                      ({c.reversible ? "reversible" : "not reversible"})
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {packet.success_criteria.length > 0 && (
            <Section icon={TrendingUp} title="Success criteria">
              <ul className="space-y-0.5">
                {packet.success_criteria.map((s, i) => (
                  <li key={i} className="text-[11px] text-foreground/75">• {s}</li>
                ))}
              </ul>
            </Section>
          )}
          <Section icon={TrendingUp} title="Cost">
            <p className="text-[11px] text-foreground/75">
              {packet.cost.known
                ? `${packet.cost.currency ?? "£"}${packet.cost.amount ?? 0}${packet.cost.basis ? ` (${packet.cost.basis})` : ""}`
                : "No known spend change."}
              {packet.cost.note ? ` ${packet.cost.note}` : ""}
            </p>
          </Section>
          {packet.limitations.length > 0 && (
            <Section icon={Ban} title="Limitations & risks">
              <ul className="space-y-0.5">
                {packet.limitations.map((l, i) => (
                  <li key={i} className="text-[11px] text-amber-300/80">• {l}</li>
                ))}
              </ul>
            </Section>
          )}
          {packet.monitoring && packet.monitoring.metrics.length > 0 && (
            <Section icon={Eye} title="Monitoring">
              <p className="text-[11px] text-foreground/75">
                {packet.monitoring.metrics.join(", ")}
                {packet.monitoring.reassess_after_days
                  ? ` — reassessed after ${packet.monitoring.reassess_after_days} days`
                  : ""}
              </p>
            </Section>
          )}

          {/* Developer details — raw ids/JSON only here */}
          <div>
            <button
              onClick={() => setDevOpen(o => !o)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {devOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Developer details
            </button>
            {devOpen && (
              <pre className="mt-1.5 text-[10px] text-muted-foreground bg-white/[0.02] rounded-lg p-2 overflow-x-auto border border-white/[0.05] max-h-64">
                {JSON.stringify(packet, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Rich approval dialog ─────────────────────────────────────────────────────
export function ApprovalDialog({ meta, packet, readinessState, onConfirm, onCancel, busy }: {
  meta: ApprovalDialogMeta;
  packet?: UniversalMindIntelligencePacket | null;
  readinessState?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-white/[0.1] bg-[hsl(var(--card))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25 shrink-0">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{meta.approveLabel}</p>
            <p className="text-[11px] text-muted-foreground">Explicit approval — review exactly what you are authorising</p>
          </div>
          <ReadinessBadge state={readinessState ?? null} />
        </div>

        <div className="px-5 py-4 space-y-3">
          {meta.sensitive && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-300/90 leading-relaxed">
                Sensitive approval — this is never auto-executed and is consumed once.
              </p>
            </div>
          )}
          <Row label="What happens">{meta.effect}</Row>
          <Row label="Records affected">{meta.recordsAffected}</Row>
          {meta.provider && <Row label="Provider">{meta.provider}</Row>}
          {meta.currentState && <Row label="Current state">{meta.currentState}</Row>}
          {meta.proposedState && <Row label="Proposed">{meta.proposedState}</Row>}
          <Row label="Risk">
            {meta.risk}
            {meta.reversible != null && (
              <span className={cn("ml-1.5 font-medium", meta.reversible ? "text-emerald-400" : "text-red-400")}>
                {meta.reversible ? "Reversible." : "Not reversible."}
              </span>
            )}
          </Row>
          <Row label="What happens next">{meta.whatHappensNext}</Row>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <Ban className="h-3 w-3" /> Not authorised by this approval
            </p>
            <p className="text-[11px] text-foreground/75 leading-relaxed">{meta.notAuthorised}</p>
          </div>
          {meta.version && <p className="text-[10px] text-muted-foreground">{meta.version}</p>}

          {packet && <IntelligencePacketPanel packet={packet} readinessState={readinessState} />}
        </div>

        <div className="px-5 py-3.5 border-t border-white/[0.07] flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/25 transition-all disabled:opacity-40"
          >
            {meta.approveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-[11px] text-foreground/85 leading-relaxed">{children}</p>
    </div>
  );
}
