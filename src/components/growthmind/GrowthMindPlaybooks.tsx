import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BookOpen, Loader2, CheckCircle2, Phone, Mail, MessageSquare,
  RefreshCw, ChevronDown, Zap,
  Home, Landmark, Users, Sun, Shield, Smile, Monitor, Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import {
  PLAYBOOKS,
  getActivePlaybook,
  activatePlaybook,
  deactivatePlaybook,
  type Playbook,
} from "@/lib/growthmind/growthmind.playbooks";

// ── Icon map ────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Home, Landmark, Users, Sun, Shield, Smile, Monitor, Briefcase,
};

function PlaybookIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? BookOpen;
  return <Icon className={className} />;
}

// ── Channel icon ────────────────────────────────────────────────────────────

function channelIcon(channel: string) {
  if (channel === "Calling")            return <Phone className="h-3.5 w-3.5 text-emerald-400" />;
  if (channel === "Email")              return <Mail className="h-3.5 w-3.5 text-blue-400" />;
  if (channel === "WhatsApp")           return <MessageSquare className="h-3.5 w-3.5 text-green-400" />;
  if (channel === "Follow-up Sequences") return <Zap className="h-3.5 w-3.5 text-amber-400" />;
  return null;
}

// ── Playbook card ────────────────────────────────────────────────────────────

function PlaybookCard({
  playbook, isActive, onActivate, onDeactivate, activating, deactivating,
}: {
  playbook: Playbook;
  isActive: boolean;
  onActivate: (industry: string) => void;
  onDeactivate?: () => void;
  activating: boolean;
  deactivating?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      "rounded-xl border bg-card/60 overflow-hidden transition-all",
      isActive
        ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
        : "border-white/[0.06] hover:border-white/[0.1]",
    )}>
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
              isActive ? "bg-emerald-500/20 ring-1 ring-emerald-500/30" : "bg-white/[0.05]",
            )}>
              <PlaybookIcon
                name={playbook.iconName}
                className={cn("h-4.5 w-4.5", isActive ? "text-emerald-400" : "text-muted-foreground")}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{playbook.industry}</p>
                {isActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {playbook.description}
              </p>
            </div>
          </div>
        </div>

        {/* Channel pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {playbook.sections.map(s => (
            <span
              key={s.channel}
              className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground border border-white/[0.06]"
            >
              {channelIcon(s.channel)}
              {s.channel}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
            {expanded ? "Hide tactics" : "View tactics"}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {isActive ? (
              <>
                <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Currently active
                </span>
                {onDeactivate && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onDeactivate}
                    disabled={deactivating}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {deactivating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                    Deactivate
                  </Button>
                )}
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => onActivate(playbook.id)}
                disabled={activating}
                className="h-7 text-xs"
              >
                {activating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                Activate
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded tactics */}
      {expanded && (
        <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
          {playbook.sections.map(section => (
            <div key={section.channel} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                {channelIcon(section.channel)}
                <p className="text-xs font-semibold">{section.channel}</p>
              </div>
              <ul className="space-y-1.5">
                {section.tactics.map((tactic, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-emerald-400 text-[10px] font-bold mt-0.5 shrink-0">{i + 1}.</span>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{tactic}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function GrowthMindPlaybooks() {
  const [activating,   setActivating]   = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [msg, setMsg]                   = useState<string | null>(null);

  const qc              = useQueryClient();
  const getActiveFn     = useServerFn(getActivePlaybook);
  const activateFn      = useServerFn(activatePlaybook);
  const deactivateFn    = useServerFn(deactivatePlaybook);

  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-active-playbook"],
    queryFn:  () => getActiveFn(),
    staleTime: 60_000,
  });

  const activeIndustry = data?.activePlaybook?.industry ?? null;
  const activePlaybook = PLAYBOOKS.find(p => p.id === activeIndustry) ?? null;

  async function handleActivate(industryId: string) {
    setActivating(industryId);
    try {
      await activateFn({ industry: industryId });
      setMsg("Playbook activated!");
      setTimeout(() => setMsg(null), 3000);
      qc.invalidateQueries({ queryKey: ["growthmind-active-playbook"] });
    } catch (e: any) {
      setMsg("Error: " + e.message);
    } finally {
      setActivating(null);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      await deactivateFn();
      setMsg("Playbook deactivated.");
      setTimeout(() => setMsg(null), 3000);
      qc.invalidateQueries({ queryKey: ["growthmind-active-playbook"] });
    } catch (e: any) {
      setMsg("Error: " + e.message);
    } finally {
      setDeactivating(false);
    }
  }

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-5xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-emerald-400" />
              Playbook Library
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              8 industry playbooks — activate one to guide your GrowthMind strategy
            </p>
          </div>
          <div className="flex items-center gap-2">
            {msg && (
              <span className={cn("text-xs font-medium", msg.startsWith("Error") ? "text-red-400" : "text-emerald-400")}>
                {msg}
              </span>
            )}
            <Button
              variant="outline" size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-active-playbook"] })}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading playbooks…</span>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Active playbook pinned section */}
            {activePlaybook && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/60 mb-3">
                  Your Active Playbook
                </p>
                <PlaybookCard
                  playbook={activePlaybook}
                  isActive={true}
                  onActivate={handleActivate}
                  onDeactivate={handleDeactivate}
                  activating={activating === activePlaybook.id}
                  deactivating={deactivating}
                />
              </div>
            )}

            {/* Full library */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground/60 mb-3">
                {activePlaybook ? "All Playbooks" : "Choose a Playbook"}
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {PLAYBOOKS.filter(p => p.id !== activeIndustry).map(playbook => (
                  <PlaybookCard
                    key={playbook.id}
                    playbook={playbook}
                    isActive={false}
                    onActivate={handleActivate}
                    activating={activating === playbook.id}
                  />
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
