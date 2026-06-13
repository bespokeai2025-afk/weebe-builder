import { Link, useRouterState } from "@tanstack/react-router";
import { Brain, BarChart3, Lightbulb, FileText, Activity, MessageSquareMore } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Overview",       href: "/hivemind",             icon: BarChart3 },
  { label: "Assistant",      href: "/hivemind/chat",        icon: MessageSquareMore, highlight: true },
  { label: "Recommendations",href: "/hivemind/recommendations", icon: Lightbulb },
  { label: "Reports",        href: "/hivemind/reports",     icon: FileText },
  { label: "System Health",  href: "/hivemind/system-health", icon: Activity },
];

export function HiveMindShell({ children }: { children: React.ReactNode }) {
  const router = useRouterState();
  const path = router.location.pathname;

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Left sidebar */}
      <aside className="hidden md:flex w-52 shrink-0 flex-col border-r border-white/[0.06] bg-[hsl(var(--sidebar-background))] py-4">
        {/* Brand */}
        <div className="px-4 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/20 ring-1 ring-violet-500/30">
              <Brain className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div>
              <p className="text-xs font-semibold">HiveMind</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">Platform Observer</p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map(({ label, href, icon: Icon, highlight }) => {
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
              </Link>
            );
          })}
        </nav>

        {/* Footer badge */}
        <div className="mt-auto px-4 space-y-2">
          <Link
            to="/hivemind/chat"
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-all",
              path.startsWith("/hivemind/chat")
                ? "border-violet-500/30 bg-violet-500/15"
                : "border-violet-500/20 bg-violet-500/[0.06] hover:bg-violet-500/15"
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

      {/* Fix #4: mobile nav is relative (not absolute) so content isn't hidden under it */}
      <div className="flex md:hidden border-b border-white/[0.06] px-4 overflow-x-auto shrink-0">
        {NAV.map(({ label, href, icon: Icon }) => {
          const active = href === "/hivemind" ? path === "/hivemind" : path.startsWith(href);
          return (
            <Link
              key={href}
              to={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                active ? "border-violet-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
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
  );
}
