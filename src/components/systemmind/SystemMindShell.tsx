import { Link, useRouterState } from "@tanstack/react-router";
import {
  Server, BarChart3, ShieldCheck, BookOpen, GitBranch, Shield,
  AlertTriangle, PlugZap, ClipboardList, Lightbulb, Wrench,
  CheckSquare, FileText, Layers, MessageSquare, Settings2, Wand2, Database,
  Users, Activity, Network, Boxes, Share2, BrainCircuit, Rocket, Gauge, GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type NavItem = { label: string; href: string; icon: React.ElementType };

const BASE_NAV_GROUPS: Array<{ title?: string; adminOnly?: boolean; items: NavItem[] }> = [
  {
    items: [
      { label: "Overview",        href: "/systemmind",                  icon: BarChart3     },
    ],
  },
  {
    title: "Diagnose",
    items: [
      { label: "Issues",          href: "/systemmind/issues",           icon: AlertTriangle },
      { label: "Providers",       href: "/systemmind/providers",        icon: PlugZap       },
      { label: "Audits",          href: "/systemmind/audits",           icon: ClipboardList },
      { label: "Data Limits",     href: "/systemmind/data-limits",      icon: Database      },
    ],
  },
  {
    title: "Improve",
    items: [
      { label: "Recommendations",     href: "/systemmind/recommendations",     icon: Lightbulb  },
      { label: "Fix Plans",           href: "/systemmind/fix-plans",           icon: Wrench     },
      { label: "Workflows",           href: "/systemmind/workflows",           icon: GitBranch  },
      { label: "Workflow Generator",  href: "/systemmind/workflow-generator",  icon: Wand2      },
      { label: "Workflow Drafts",     href: "/systemmind/workflow-drafts",     icon: Layers     },
      { label: "Playbooks",           href: "/systemmind/playbooks",           icon: Shield     },
    ],
  },
  {
    title: "Intelligence",
    adminOnly: true,
    items: [
      { label: "Workflow Intelligence", href: "/systemmind/workflow-intelligence", icon: Network },
      { label: "Template Library",      href: "/systemmind/template-library",      icon: Boxes   },
      { label: "Knowledge Graph",       href: "/systemmind/graph",                 icon: Network },
      { label: "CRM Abstraction",       href: "/systemmind/crm-adapters",          icon: Share2  },
    ],
  },
  {
    title: "Plan",
    items: [
      { label: "Tasks",           href: "/systemmind/tasks",            icon: CheckSquare   },
      { label: "Reports",         href: "/systemmind/reports",          icon: FileText      },
      { label: "Architecture",    href: "/systemmind/architecture",     icon: Layers        },
    ],
  },
  {
    title: "Converse",
    items: [
      { label: "Chat",            href: "/systemmind/chat",             icon: MessageSquare },
    ],
  },
  {
    title: "Clients",
    adminOnly: true,
    items: [
      { label: "Overview",        href: "/systemmind/clients",           icon: Users     },
      { label: "Workspace Setup", href: "/systemmind/clients/setup",     icon: Users     },
      { label: "API Probe",       href: "/systemmind/clients/api-probe", icon: Activity  },
    ],
  },
  {
    title: "Configure",
    items: [
      { label: "Settings",        href: "/systemmind/settings",         icon: Settings2     },
      { label: "Knowledge",       href: "/systemmind/knowledge",        icon: BookOpen      },
    ],
  },
];

function NavLink({ label, href, icon: Icon, active }: NavItem & { active: boolean }) {
  return (
    <Link
      to={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
        active
          ? "bg-sky-500/15 text-sky-300"
          : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-sky-400")} />
      {label}
    </Link>
  );
}

export function SystemMindShell({ children }: { children: React.ReactNode }) {
  const router = useRouterState();
  const path   = router.location.pathname;
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session || !active) return;
      supabase
        .from("profiles")
        .select("user_type")
        .eq("user_id", session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (active) setIsAdmin(data?.user_type === "admin");
        });
    });
    return () => { active = false; };
  }, []);

  const visibleGroups = BASE_NAV_GROUPS.filter((g) => !g.adminOnly || isAdmin);
  const allItems      = visibleGroups.flatMap((g) => g.items);

  function isActive(href: string) {
    // Exact match for root, prefix match for others (but not /clients for /clients/setup etc)
    if (href === "/systemmind") return path === "/systemmind";
    if (href === "/systemmind/clients") return path === "/systemmind/clients";
    return path.startsWith(href);
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Left sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-white/[0.06] bg-[hsl(var(--sidebar-background))] py-4 overflow-y-auto">
        <div className="px-4 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sky-500/20 ring-1 ring-sky-500/30">
              <Server className="h-3.5 w-3.5 text-sky-400" />
            </div>
            <div>
              <p className="text-xs font-semibold">SystemMind</p>
              <p className="text-[10px] text-muted-foreground leading-none mt-0.5">AI Chief Technology Officer</p>
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-0 px-2 flex-1">
          {visibleGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? "mt-3" : ""}>
              {group.title && (
                <p className="px-2.5 mb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  {group.title}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} {...item} active={isActive(item.href)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-3 mt-4">
          <div className="flex items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-2.5 py-2">
            <ShieldCheck className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-sky-300 font-semibold leading-none">Reports to HiveMind</p>
              <p className="text-[10px] text-sky-400/60 mt-0.5 leading-tight truncate">Technical advisor</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile nav */}
      <div className="flex md:hidden border-b border-white/[0.06] overflow-x-auto shrink-0 w-full">
        {allItems.map(({ label, href, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link key={href} to={href}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors shrink-0",
                active ? "border-sky-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}>
              <Icon className="h-3 w-3" />
              {label}
            </Link>
          );
        })}
      </div>

      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
