import { Link, useRouterState } from "@tanstack/react-router";
import {
  TrendingUp, BarChart3, Lightbulb, FileText,
  MessageSquareMore, Target, Megaphone, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ALL_NAV = [
  { label: "Overview",         href: "/growthmind",                        icon: BarChart3 },
  { label: "AI Assistant",     href: "/growthmind/chat",                   icon: MessageSquareMore, highlight: true },
  { label: "Recommendations",  href: "/growthmind/recommendations",        icon: Lightbulb },
  { label: "Lead Opportunities", href: "/growthmind/lead-opportunities",   icon: Target },
  { label: "Campaigns",        href: "/growthmind/campaigns",              icon: Megaphone },
  { label: "Reports",          href: "/growthmind/reports",                icon: FileText },
];

export function GrowthMindShell({ children }: { children: React.ReactNode }) {
  const router = useRouterState();
  const path   = router.location.pathname;

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Left sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-white/[0.06] bg-[hsl(var(--sidebar-background))] py-4">
        {/* Brand */}
        <div className="px-4 mb-5">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/20 ring-1 ring-emerald-500/30">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold">GrowthMind</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">AI Chief Marketing Officer</p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {ALL_NAV.map(({ label, href, icon: Icon, highlight }) => {
            const active = href === "/growthmind" ? path === "/growthmind" : path.startsWith(href);
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
                  active
                    ? "bg-emerald-500/15 text-emerald-300"
                    : highlight
                      ? "text-emerald-400/80 hover:bg-emerald-500/[0.08] hover:text-emerald-300"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", (active || highlight) && "text-emerald-400")} />
                {label}
                {highlight && !active && (
                  <span className="ml-auto rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 leading-none">AI</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer CTA */}
        <div className="px-3 mt-3">
          <Link
            to="/growthmind/chat"
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-all",
              path.startsWith("/growthmind/chat")
                ? "border-emerald-500/30 bg-emerald-500/15"
                : "border-emerald-500/20 bg-emerald-500/[0.06] hover:bg-emerald-500/15",
            )}
          >
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-emerald-300 font-semibold leading-none">Ask GrowthMind</p>
              <p className="text-[10px] text-emerald-400/60 mt-0.5 leading-tight truncate">AI marketing advisor</p>
            </div>
          </Link>
        </div>
      </aside>

      {/* Mobile nav */}
      <div className="flex md:hidden border-b border-white/[0.06] overflow-x-auto shrink-0">
        {ALL_NAV.map(({ label, href, icon: Icon }) => {
          const active = href === "/growthmind" ? path === "/growthmind" : path.startsWith(href);
          return (
            <Link key={href} to={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                active ? "border-emerald-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
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
  );
}
