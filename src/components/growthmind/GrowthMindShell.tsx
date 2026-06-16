import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  TrendingUp, BarChart3, Lightbulb, FileText,
  MessageSquareMore, Target, Megaphone, Compass,
  BarChart2, Filter, BookOpen, Search, Swords, LineChart, Flag, Wand2,
  CalendarDays, Rocket, Clapperboard, Dna, Database, Zap, Newspaper, Mail, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getAllProposals } from "@/lib/executives/executive-bridge";

const CORE_NAV = [
  { label: "Overview",           href: "/growthmind",                      icon: BarChart3 },
  { label: "AI Assistant",       href: "/growthmind/chat",                 icon: MessageSquareMore, highlight: true },
  { label: "Business DNA",       href: "/growthmind/business-dna",         icon: Dna,         highlight: true },
  { label: "Opportunities",      href: "/growthmind/lead-opportunities",   icon: Zap },
  { label: "Recommendations",    href: "/growthmind/recommendations",      icon: Lightbulb },
  { label: "Goals",              href: "/growthmind/goals",                icon: Flag },
  { label: "Reports",            href: "/growthmind/reports",              icon: FileText },
  { label: "Proposals",          href: "/growthmind/proposals",            icon: Filter },
];

const STRATEGY_NAV = [
  { label: "Strategy Centre",    href: "/growthmind/strategy-centre",      icon: Compass,     highlight: true },
  { label: "Strategy",           href: "/growthmind/strategy",             icon: Target,      highlight: true },
  { label: "Campaign Factory",   href: "/growthmind/campaign-factory",     icon: Rocket,      highlight: true },
  { label: "Email Campaigns",    href: "/growthmind/email-campaigns",      icon: Mail,        highlight: true },
  { label: "Data Sources",       href: "/growthmind/data-sources",         icon: Database },
  { label: "Campaigns",          href: "/growthmind/campaigns",            icon: Megaphone },
  { label: "Content Calendar",   href: "/growthmind/content-calendar",     icon: CalendarDays },
  { label: "Growth Scheduler",   href: "/growthmind/growth-scheduler",     icon: Rocket },
];

const INTELLIGENCE_NAV = [
  { label: "Content Studio",  href: "/growthmind/content-studio",  icon: Wand2,        highlight: true },
  { label: "Video Studio",    href: "/growthmind/video-studio",    icon: Clapperboard, highlight: true },
  { label: "Prompt Studio",   href: "/growthmind/prompt-studio",   icon: Sparkles,     highlight: true },
  { label: "Blog Writer",     href: "/growthmind/blog-writer",     icon: Newspaper,    highlight: true },
  { label: "Ads",             href: "/growthmind/ads",            icon: BarChart2 },
  { label: "Funnels",         href: "/growthmind/funnels",        icon: Filter },
  { label: "Forecast",        href: "/growthmind/forecast",       icon: LineChart },
  { label: "Playbooks",       href: "/growthmind/playbooks",      icon: BookOpen },
  { label: "SEO",             href: "/growthmind/seo",            icon: Search },
  { label: "Competitors",     href: "/growthmind/competitors",    icon: Swords },
];

const ALL_NAV = [...CORE_NAV, ...STRATEGY_NAV, ...INTELLIGENCE_NAV];

function NavItem({ label, href, icon: Icon, highlight, active, badge }: {
  label: string; href: string; icon: React.ElementType; highlight?: boolean; active: boolean; badge?: number;
}) {
  return (
    <Link
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
      {highlight && !active && !badge && (
        <span className="ml-auto rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 leading-none">AI</span>
      )}
      {badge != null && badge > 0 && (
        <span className={cn(
          "ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
          active
            ? "bg-emerald-500/30 text-emerald-300"
            : "bg-emerald-500/20 text-emerald-400",
        )}>{badge}</span>
      )}
    </Link>
  );
}

export function GrowthMindShell({ children }: { children: React.ReactNode }) {
  const router = useRouterState();
  const path   = router.location.pathname;

  const getProposalsFn = useServerFn(getAllProposals);
  const { data: proposalsData } = useQuery({
    queryKey: ["growthmind-all-proposals"],
    queryFn:  () => getProposalsFn(),
    staleTime: 60_000,
  });
  const approvedCount = proposalsData?.approvedCount ?? 0;

  function isActive(href: string) {
    return href === "/growthmind" ? path === "/growthmind" : path.startsWith(href);
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Left sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-white/[0.06] bg-[hsl(var(--sidebar-background))] py-4 overflow-y-auto">
        {/* Brand */}
        <div className="px-4 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/20 ring-1 ring-emerald-500/30">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold">GrowthMind</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">AI Chief Marketing Officer</p>
            </div>
          </div>
        </div>

        {/* Core nav */}
        <nav className="flex flex-col gap-0.5 px-2">
          {CORE_NAV.map(item => (
            <NavItem
              key={item.href}
              {...item}
              active={isActive(item.href)}
              badge={item.href === "/growthmind/proposals" ? approvedCount : undefined}
            />
          ))}
        </nav>

        {/* Strategy nav */}
        <div className="mt-4 px-4 mb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Strategy & Campaigns</p>
        </div>
        <nav className="flex flex-col gap-0.5 px-2">
          {STRATEGY_NAV.map(item => (
            <NavItem key={item.href} {...item} active={isActive(item.href)} />
          ))}
        </nav>

        {/* Intelligence nav */}
        <div className="mt-4 px-4 mb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50">Intelligence</p>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {INTELLIGENCE_NAV.map(item => (
            <NavItem key={item.href} {...item} active={isActive(item.href)} />
          ))}
        </nav>

        {/* Footer CTA */}
        <div className="px-3 mt-4">
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

      {/* Mobile nav — scrollable horizontal tabs */}
      <div className="flex md:hidden border-b border-white/[0.06] overflow-x-auto shrink-0 w-full">
        {ALL_NAV.map(({ label, href, icon: Icon }) => {
          const active = isActive(href);
          const isProposals = href === "/growthmind/proposals";
          return (
            <Link key={href} to={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors shrink-0",
                active ? "border-emerald-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}>
              <Icon className="h-3 w-3" />
              {label}
              {isProposals && approvedCount > 0 && (
                <span className="ml-0.5 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[8px] font-bold text-emerald-400 leading-none">
                  {approvedCount}
                </span>
              )}
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
