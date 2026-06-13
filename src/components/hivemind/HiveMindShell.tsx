import { createContext, useContext, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Brain, BarChart3, Lightbulb, FileText, Activity, MessageSquareMore,
  CheckCircle2, Zap, Newspaper, Eye, MessageSquare, ChevronDown, ChevronUp,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { getHiveMindTasksAndEvents } from "@/lib/hivemind/hivemind.tasks";
import { getHiveMindActionsAndCounts, getHiveMindMode, setHiveMindMode, type HiveMindMode } from "@/lib/hivemind/hivemind.actions";

// ── Mode context ──────────────────────────────────────────────────────────────
export const HiveMindModeCtx = createContext<HiveMindMode>("assistant");
export function useHiveMindMode(): HiveMindMode { return useContext(HiveMindModeCtx); }

// ── Mode config ───────────────────────────────────────────────────────────────
const MODE_CONFIG: Record<HiveMindMode, { icon: React.ElementType; label: string; desc: string; color: string; ring: string; bg: string }> = {
  observe:   { icon: Eye,            label: "Observe Only",   desc: "View-only access",            color: "text-slate-400",  ring: "ring-slate-500/30",  bg: "bg-slate-500/10" },
  recommend: { icon: Lightbulb,      label: "Recommend Only", desc: "Insights and recommendations", color: "text-blue-400",   ring: "ring-blue-500/30",   bg: "bg-blue-500/10" },
  assistant: { icon: MessageSquare,  label: "Assistant",      desc: "Create tasks and insights",    color: "text-violet-400", ring: "ring-violet-500/30", bg: "bg-violet-500/10" },
  operator:  { icon: Zap,            label: "Operator",       desc: "Propose and execute actions",  color: "text-amber-400",  ring: "ring-amber-500/30",  bg: "bg-amber-500/10" },
};

// Mode gates: which nav hrefs are visible per mode
const MODE_VISIBILITY: Record<HiveMindMode, string[]> = {
  observe:   ["/hivemind", "/hivemind/briefing", "/hivemind/system-health"],
  recommend: ["/hivemind", "/hivemind/briefing", "/hivemind/recommendations", "/hivemind/reports", "/hivemind/system-health"],
  assistant: ["/hivemind", "/hivemind/briefing", "/hivemind/chat", "/hivemind/tasks", "/hivemind/recommendations", "/hivemind/reports", "/hivemind/system-health"],
  operator:  ["/hivemind", "/hivemind/briefing", "/hivemind/chat", "/hivemind/tasks", "/hivemind/actions", "/hivemind/recommendations", "/hivemind/reports", "/hivemind/system-health"],
};

const ALL_NAV = [
  { label: "Overview",        href: "/hivemind",                  icon: BarChart3 },
  { label: "Briefing",        href: "/hivemind/briefing",         icon: Newspaper },
  { label: "Assistant",       href: "/hivemind/chat",             icon: MessageSquareMore, highlight: true },
  { label: "Tasks",           href: "/hivemind/tasks",            icon: CheckCircle2,      tasks: true },
  { label: "Actions",         href: "/hivemind/actions",          icon: Zap,               actions: true },
  { label: "Recommendations", href: "/hivemind/recommendations",  icon: Lightbulb },
  { label: "Reports",         href: "/hivemind/reports",          icon: FileText },
  { label: "System Health",   href: "/hivemind/system-health",    icon: Activity },
];

// ── Badge sub-components ──────────────────────────────────────────────────────
function TasksBadge() {
  const getFn = useServerFn(getHiveMindTasksAndEvents);
  const { data } = useQuery({
    queryKey: ["hivemind-shell-badge"],
    queryFn:  () => getFn(),
    staleTime: 60_000, refetchInterval: 120_000,
  });
  const n = data?.badge ?? 0;
  if (!n) return null;
  return <span className="ml-auto rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400 leading-none">{n > 99 ? "99+" : n}</span>;
}

function ActionsBadge() {
  const getFn = useServerFn(getHiveMindActionsAndCounts);
  const { data } = useQuery({
    queryKey: ["hivemind-actions-badge"],
    queryFn:  () => getFn(),
    staleTime: 60_000, refetchInterval: 120_000,
  });
  const n = data?.pending ?? 0;
  if (!n) return null;
  return <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400 leading-none">{n > 99 ? "99+" : n}</span>;
}

// ── Mode selector ─────────────────────────────────────────────────────────────
function ModeSelector({ mode, onModeChange }: { mode: HiveMindMode; onModeChange: (m: HiveMindMode) => void }) {
  const [open, setOpen] = useState(false);
  const cfg = MODE_CONFIG[mode];
  const ModeIcon = cfg.icon;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "w-full flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-all",
          cfg.ring, cfg.bg,
        )}
      >
        <ModeIcon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
        <div className="flex-1 min-w-0 text-left">
          <p className={cn("text-[10px] font-semibold leading-none", cfg.color)}>{cfg.label}</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-tight truncate">{cfg.desc}</p>
        </div>
        {open ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 right-0 rounded-xl border border-white/[0.10] bg-[hsl(var(--card))] shadow-xl overflow-hidden z-50">
          {(Object.entries(MODE_CONFIG) as [HiveMindMode, typeof cfg][]).map(([key, m]) => {
            const MIcon = m.icon;
            return (
              <button
                key={key}
                onClick={() => { onModeChange(key); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]",
                  key === mode && "bg-white/[0.03]",
                )}
              >
                <div className={cn("flex h-6 w-6 items-center justify-center rounded-md shrink-0", m.bg)}>
                  <MIcon className={cn("h-3 w-3", m.color)} />
                </div>
                <div className="min-w-0">
                  <p className={cn("text-[11px] font-semibold leading-none", m.color)}>{m.label}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">{m.desc}</p>
                </div>
                {key === mode && <CheckCircle2 className="h-3.5 w-3.5 text-violet-400 ml-auto shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── HiveMindShell ─────────────────────────────────────────────────────────────
export function HiveMindShell({ children }: { children: React.ReactNode }) {
  const router   = useRouterState();
  const path     = router.location.pathname;
  const qc       = useQueryClient();
  const modeFn   = useServerFn(getHiveMindMode);
  const setModeFn = useServerFn(setHiveMindMode);

  const { data: modeData } = useQuery({
    queryKey: ["hivemind-mode"],
    queryFn:  () => modeFn(),
    staleTime: Infinity,
  });
  const mode: HiveMindMode = modeData?.mode ?? "assistant";

  async function handleModeChange(m: HiveMindMode) {
    await setModeFn({ data: { mode: m } });
    qc.setQueryData(["hivemind-mode"], { mode: m });
  }

  const allowed = MODE_VISIBILITY[mode];
  const nav = ALL_NAV.filter(item => allowed.includes(item.href));

  return (
    <HiveMindModeCtx.Provider value={mode}>
      <div className="flex h-full min-h-0 w-full">
        {/* Left sidebar */}
        <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-white/[0.06] bg-[hsl(var(--sidebar-background))] py-4">
          {/* Brand + mode badge */}
          <div className="px-4 mb-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/20 ring-1 ring-violet-500/30">
                <Brain className="h-3.5 w-3.5 text-violet-400" />
              </div>
              <div>
                <p className="text-xs font-semibold">HiveMind</p>
                <p className="text-[10px] text-muted-foreground leading-none mt-0.5">AI Operations Director</p>
              </div>
            </div>
          </div>

          {/* Nav items */}
          <nav className="flex flex-col gap-0.5 px-2 flex-1">
            {nav.map(({ label, href, icon: Icon, highlight, tasks, actions }) => {
              const active = href === "/hivemind" ? path === "/hivemind" : path.startsWith(href);
              return (
                <Link
                  key={href}
                  to={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
                    active
                      ? "bg-violet-500/15 text-violet-300"
                      : highlight
                        ? "text-violet-400/80 hover:bg-violet-500/[0.08] hover:text-violet-300"
                        : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", (active || highlight) && "text-violet-400")} />
                  {label}
                  {highlight && !active && (
                    <span className="ml-auto rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-violet-400 leading-none">AI</span>
                  )}
                  {tasks && !active && <TasksBadge />}
                  {actions && !active && <ActionsBadge />}
                </Link>
              );
            })}
          </nav>

          {/* Footer: mode selector + activate */}
          <div className="px-3 space-y-2 mt-3">
            <ModeSelector mode={mode} onModeChange={handleModeChange} />
            <Link
              to="/hivemind/chat"
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-all",
                path.startsWith("/hivemind/chat")
                  ? "border-violet-500/30 bg-violet-500/15"
                  : "border-violet-500/20 bg-violet-500/[0.06] hover:bg-violet-500/15",
              )}
            >
              <Brain className="h-3.5 w-3.5 text-violet-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-violet-300 font-semibold leading-none">Activate HiveMind</p>
                <p className="text-[10px] text-violet-400/60 mt-0.5 leading-tight truncate">Voice AI assistant</p>
              </div>
            </Link>
          </div>
        </aside>

        {/* Mobile nav */}
        <div className="flex md:hidden border-b border-white/[0.06] overflow-x-auto shrink-0">
          {nav.map(({ label, href, icon: Icon }) => {
            const active = href === "/hivemind" ? path === "/hivemind" : path.startsWith(href);
            return (
              <Link key={href} to={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                  active ? "border-violet-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}>
                <Icon className="h-3 w-3" />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </HiveMindModeCtx.Provider>
  );
}
