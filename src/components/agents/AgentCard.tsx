import { useState } from "react";
import { RelativeTime } from "@/components/ui/relative-time";

import {
  Loader2,
  Trash2,
  Rocket,
  Phone,
  Activity,
  Clock,
  CalendarCheck,
  TrendingUp,
  MoreHorizontal,
  Pencil,
  Copy as CopyIcon,
  AlertTriangle,
  CircleDot,
  Radio,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type AgentStatus = "live" | "training" | "draft" | "failed";

export interface AgentCardData {
  id: string;
  name: string;
  retell_agent_id: string | null;
  cost_seconds: number;
  updated_at: string;
  settings: Record<string, unknown>;
}

interface AgentCardProps {
  agent: AgentCardData;
  loading?: boolean;
  onOpen: (id: string) => void;
  onDeploy: () => void;
  onGuidedDeploy?: () => void;
  onDelete: () => void;
}

const STATUS_LABEL: Record<AgentStatus, string> = {
  live: "Live",
  training: "Training",
  draft: "Draft",
  failed: "Failed",
};

const STATUS_TONES: Record<AgentStatus, StatusTone> = {
  live: "success",
  training: "warning",
  draft: "neutral",
  failed: "danger",
};

type VoiceProvider = "RETELL" | "OPENAI_REALTIME";

export function deriveVoiceProvider(a: AgentCardData): VoiceProvider {
  const vp = (a.settings ?? {}).voiceProvider;
  return vp === "OPENAI_REALTIME" ? "OPENAI_REALTIME" : "RETELL";
}

function deriveStatus(a: AgentCardData): AgentStatus {
  const s = a.settings ?? {};
  if (s.deployError) return "failed";
  if (s.deployedRetellAgentId) return "live";
  if (a.retell_agent_id) return "training";
  return "draft";
}

function deriveTags(a: AgentCardData): string[] {
  const s = a.settings ?? {};
  const raw = (s.tags as unknown) ?? (s.category as unknown);
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string") as string[];
  if (typeof raw === "string" && raw.trim()) return [raw];
  return ["Voice"];
}

/** Animated dot for live agents */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-current opacity-70" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
    </span>
  );
}

/** Subtle waveform — pure CSS bars, only animates when live */
function Waveform({ live }: { live: boolean }) {
  const bars = [3, 6, 4, 8, 5, 7, 4, 6, 3, 5, 7, 4];
  return (
    <div className="flex h-7 items-end gap-[3px] opacity-80" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-gradient-to-t from-primary/30 to-primary/70",
            live && "animate-waveform motion-reduce:animate-none",
          )}
          style={{
            height: `${h * 3}px`,
            animationDelay: `${i * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-label text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
      {hint && <div className="text-caption text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function AgentCard({ agent, loading, onOpen, onDeploy, onGuidedDeploy, onDelete }: AgentCardProps) {
  const status = deriveStatus(agent);
  const tags = deriveTags(agent);
  const voiceProvider = deriveVoiceProvider(agent);
  const settings = agent.settings ?? {};
  const phone = settings.phoneNumber as string | undefined;
  const deployedId = settings.deployedRetellAgentId as string | undefined;
  const callsMin = (agent.cost_seconds ?? 0) / 60;
  const metrics = (settings.metrics ?? {}) as {
    calls?: number;
    latencyMs?: number;
    bookings?: number;
    conversion?: number;
  };
  const calls = metrics.calls ?? Math.max(0, Math.round(callsMin * 0.6));
  const latency = metrics.latencyMs ? `${metrics.latencyMs}ms` : "—";
  const bookings = metrics.bookings ?? 0;
  const conversion =
    metrics.conversion !== undefined ? `${Math.round(metrics.conversion * 100)}%` : "—";
  const isLive = status === "live";
  const [showCopied, setShowCopied] = useState(false);

  async function copyId() {
    if (!agent.retell_agent_id) return;
    await navigator.clipboard.writeText(agent.retell_agent_id);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 1200);
  }

  return (
    <div
      className={cn(
        "group/card relative isolate flex flex-col rounded-2xl bg-card/80 backdrop-blur-sm",
        "ring-1 ring-border transition-all duration-200",
        "p-6 md:p-7",
        "motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none hover:ring-brand/25",
        "shadow-soft hover:shadow-elevated",
      )}
    >
      {/* Active-agent glow */}
      {isLive && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-px -z-10 rounded-2xl opacity-70 blur-2xl"
          style={{
            background:
              "radial-gradient(ellipse at top left, rgba(16,185,129,0.18), transparent 60%), radial-gradient(ellipse at bottom right, rgba(79,140,255,0.14), transparent 60%)",
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONES[status]}>
              {status === "live" ? (
                <LiveDot />
              ) : status === "failed" ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <CircleDot className="h-3 w-3" />
              )}
              {STATUS_LABEL[status]}
            </StatusBadge>
            {tags.slice(0, 2).map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="min-h-5 rounded-full bg-muted px-2 text-metadata font-normal text-muted-foreground ring-1 ring-border hover:bg-muted/70"
              >
                {t}
              </Badge>
            ))}
            <Badge
              variant="secondary"
              className="min-h-5 gap-1 rounded-full bg-muted px-2 text-metadata font-normal ring-1 ring-border hover:bg-muted/70"
              title={voiceProvider === "OPENAI_REALTIME" ? "HyperStream Engine (Instant Response)" : "OmniVoice Engine (Premium Catalog)"}
            >
              {voiceProvider === "OPENAI_REALTIME" ? (
                <>
                  <Zap className="h-2.5 w-2.5 text-violet-700 dark:text-violet-300" />
                  <span className="text-violet-700 dark:text-violet-300">HyperStream</span>
                </>
              ) : (
                <>
                  <Radio className="h-2.5 w-2.5 text-sky-700 dark:text-sky-300" />
                  <span className="text-sky-700 dark:text-sky-300">OmniVoice</span>
                </>
              )}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-lg font-semibold tracking-tight text-foreground">
              {agent.name}
            </h3>
            {voiceProvider === "OPENAI_REALTIME" && (
              <Badge
                variant="outline"
                className="shrink-0 border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300 gap-1 px-2 py-0.5 text-metadata font-semibold"
              >
                <Zap className="h-3 w-3" />
                Enterprise Line
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-metadata text-muted-foreground">
            {phone ? (
              <span className="inline-flex items-center gap-1 font-mono">
                <Phone className="h-3 w-3" />
                {phone}
              </span>
            ) : null}
            {(deployedId || agent.retell_agent_id) && (
              <button
                onClick={copyId}
                className="inline-flex min-h-6 items-center gap-1 rounded font-mono hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Copy agent ID for ${agent.name}`}
                title="Copy agent ID"
              >
                <CopyIcon className="h-3 w-3" />
                <span className="max-w-[120px] truncate">
                  {deployedId ?? agent.retell_agent_id}
                </span>
                {showCopied && <span className="text-success" role="status">copied</span>}
              </button>
            )}
            <span>Updated <RelativeTime date={agent.updated_at} /></span>
          </div>
        </div>

        <Waveform live={isLive} />
      </div>

      {/* Metrics */}
      <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Metric icon={Activity} label="Calls" value={String(calls)} />
        <Metric icon={Clock} label="Latency" value={latency} />
        <Metric icon={CalendarCheck} label="Bookings" value={String(bookings)} />
        <Metric icon={TrendingUp} label="Conversion" value={conversion} />
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-xs"
            onClick={() => onOpen(agent.id)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Pencil className="h-3.5 w-3.5" />
            )}
            Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={`More actions for ${agent.name}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onOpen(agent.id)}>
                <Pencil className="mr-2 h-4 w-4" />
                Open in builder
              </DropdownMenuItem>
              {agent.retell_agent_id && (
                <DropdownMenuItem onClick={copyId}>
                  <CopyIcon className="mr-2 h-4 w-4" />
                  Copy agent ID
                </DropdownMenuItem>
              )}
              {onGuidedDeploy && (
                <DropdownMenuItem onClick={onGuidedDeploy} data-testid="menu-guided-deploy">
                  <Rocket className="mr-2 h-4 w-4" />
                  Guided deployment
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button data-tour="agent-deploy-btn" size="sm" variant="default" onClick={onDeploy} className="h-9 gap-1.5 px-4">
          <Rocket className="h-3.5 w-3.5" />
          {isLive ? "Manage deployment" : "Deploy"}
        </Button>
      </div>
    </div>
  );
}
