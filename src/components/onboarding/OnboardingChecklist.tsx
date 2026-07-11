import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2, Circle, ChevronDown, ChevronUp, X,
  TrendingUp, Cpu, Zap, ExternalLink, ListChecks, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getOnboardingState, type OnboardingPath } from "@/lib/onboarding/onboarding.server";

interface ChecklistStep {
  key: string;
  label: string;
  href?: string;
  done: (state: any) => boolean;
  paths: OnboardingPath[];
}

const STEPS: ChecklistStep[] = [
  {
    key: "dna",
    label: "Complete Business DNA",
    href: "/growthmind/business-dna",
    done: (s) => s.business_dna_done,
    paths: ["grow", "both"],
  },
  {
    key: "knowledge",
    label: "Upload business knowledge",
    href: "/knowledge-centre",
    done: (s) => s.knowledge_uploaded,
    paths: ["grow", "both"],
  },
  {
    key: "connections",
    label: "Connect marketing platforms",
    href: "/settings/providers",
    done: (s) => s.connections_done,
    paths: ["grow", "both"],
  },
  {
    key: "analysis",
    label: "Review GrowthMind analysis",
    href: "/growthmind",
    done: (s) => s.analysis_done,
    paths: ["grow", "both"],
  },
  {
    key: "campaign",
    label: "Launch first campaign",
    href: "/growthmind/campaign-factory",
    done: (s) => s.first_campaign_done,
    paths: ["grow", "both"],
  },
  {
    key: "agent",
    label: "Create first AI Agent",
    href: "/builder",
    done: (s) => s.first_agent_done,
    paths: ["agent_builder", "both"],
  },
  {
    key: "telephony",
    label: "Configure telephony",
    href: "/settings/providers",
    done: (s) => s.telephony_done,
    paths: ["agent_builder", "both"],
  },
];

const PATH_META: Record<OnboardingPath, { label: string; icon: any; color: string }> = {
  agent_builder: { label: "Agent Builder", icon: Cpu,        color: "text-orange-400" },
  grow:          { label: "Growth",        icon: TrendingUp, color: "text-emerald-400" },
  both:          { label: "Full Platform", icon: Zap,        color: "text-violet-400"  },
};

export function OnboardingChecklist() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const getStateFn = useServerFn(getOnboardingState);

  const { data: state } = useQuery({
    queryKey: ["onboarding-state"],
    queryFn:  () => getStateFn(),
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });

  // Don't show if no state, completed, or dismissed locally
  if (!state || state.completed || state.dismissed || dismissed) return null;
  // Don't show if path not yet set (the welcome modal handles that)
  if (!state.path) return null;

  const path = state.path as OnboardingPath;
  const pathMeta = PATH_META[path];
  const relevantSteps = STEPS.filter(s => s.paths.includes(path));
  const doneCount = relevantSteps.filter(s => s.done(state)).length;
  const pct = relevantSteps.length > 0 ? Math.round((doneCount / relevantSteps.length) * 100) : 0;
  const allDone = doneCount === relevantSteps.length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72">
      {/* Collapsed trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="ml-auto flex items-center gap-2 rounded-xl border border-white/[0.10] bg-card/90 backdrop-blur px-4 py-2.5 shadow-xl hover:border-white/20 transition-all">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1 text-left">
            <p className="text-xs font-semibold leading-tight">Getting Started</p>
            <p className="text-[10px] text-muted-foreground">{doneCount}/{relevantSteps.length} steps · {pct}%</p>
          </div>
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

      {/* Expanded panel */}
      {open && (
        <div className="rounded-2xl border border-white/[0.10] bg-card/95 backdrop-blur shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
            <pathMeta.icon className={cn("h-4 w-4", pathMeta.color)} />
            <div className="flex-1">
              <p className="text-xs font-semibold">{pathMeta.label} Setup</p>
              <p className="text-[10px] text-muted-foreground">{doneCount} of {relevantSteps.length} complete</p>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-1 bg-white/[0.04]">
            <div
              className="h-1 bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Steps */}
          <div className="p-3 space-y-1">
            {relevantSteps.map(step => {
              const done = step.done(state);
              return (
                <button
                  key={step.key}
                  onClick={() => step.href && navigate({ to: step.href as any })}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                    done
                      ? "text-muted-foreground/60"
                      : "hover:bg-white/[0.04] text-foreground",
                  )}>
                  {done
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />}
                  <span className={cn("flex-1 text-xs", done && "line-through")}>{step.label}</span>
                  {!done && step.href && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                </button>
              );
            })}
          </div>

          {allDone && (
            <div className="mx-3 mb-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
              <p className="text-xs font-semibold text-emerald-400">🎉 Setup complete!</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">You're all set to get results from WEBEE.</p>
            </div>
          )}

          {!allDone && (
            <button
              onClick={() => navigate({ to: "/systemmind/setup-assistant" as any })}
              className="w-full flex items-center gap-2 border-t border-white/[0.06] px-4 py-2.5 text-left hover:bg-sky-500/[0.06] transition-colors group">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span className="flex-1 text-[11px] text-muted-foreground group-hover:text-sky-300 transition-colors">
                Get a personalised setup plan from the Setup Assistant
              </span>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/40 group-hover:text-sky-400 transition-colors" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
