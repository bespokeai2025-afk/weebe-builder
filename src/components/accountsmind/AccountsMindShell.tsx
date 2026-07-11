import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  BarChart3,
  Zap,
  TrendingUp,
  Bell,
  Settings,
  ChevronRight,
  DollarSign,
  SlidersHorizontal,
  Hammer,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Dashboard",     href: "/admin/accounts",              icon: LayoutDashboard },
  { label: "Clients",       href: "/admin/accounts/clients",      icon: Users },
  { label: "Provider Costs",href: "/admin/accounts/costs",        icon: DollarSign },
  { label: "Recharges",     href: "/admin/accounts/recharges",    icon: Zap },
  { label: "Profitability", href: "/admin/accounts/profitability",icon: TrendingUp },
  { label: "SystemMind",    href: "/admin/accounts/systemmind",   icon: Hammer },
  { label: "Alerts",        href: "/admin/accounts/alerts",       icon: Bell },
  { label: "Workspace Config", href: "/admin/accounts/workspace-config", icon: SlidersHorizontal },
  { label: "Settings",      href: "/admin/accounts/settings",     icon: Settings },
];

interface Props { children: React.ReactNode }

export function AccountsMindShell({ children }: Props) {
  const { location } = useRouterState();
  const path = location.pathname;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-gray-800 bg-gray-950 flex flex-col">
        {/* Brand */}
        <div className="px-4 py-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white leading-none">AccountsMind</div>
              <div className="text-[10px] text-gray-500 mt-0.5">Finance Agent</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.map(({ label, href, icon: Icon }) => {
            const active =
              href === "/admin/accounts"
                ? path === "/admin/accounts" || path === "/admin/accounts/"
                : path.startsWith(href);
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-emerald-600/20 text-emerald-400 font-medium"
                    : "text-gray-400 hover:text-white hover:bg-gray-800",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Admin back link */}
        <div className="px-4 py-3 border-t border-gray-800">
          <Link
            to="/admin/users"
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <ChevronRight className="w-3 h-3 rotate-180" />
            Back to Admin
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
