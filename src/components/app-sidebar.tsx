import { useEffect, useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutGrid,
  LayoutTemplate,
  LayoutDashboard,
  Workflow,
  CalendarDays,
  CreditCard,
  ShieldCheck,
  Mail,
  ChevronsUpDown,
  LogOut,
  Settings,
  Check,
  Database,
  PhoneCall,
  BarChart3,
  MessageSquare,
  UserCheck,
  BookUser,
  MapPin,
  Phone,
  Megaphone,
  Settings2,
  PhoneIncoming,
} from "lucide-react";
import { restartTour } from "@/components/onboarding/useOnboarding";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getMyAdminStatus, getMyProfile } from "@/lib/auth/auth.functions";
import { ThemeToggle } from "@/components/ThemeToggle";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Agents",    url: "/my-agents", icon: LayoutGrid,    tourId: "nav-agents" },
  { title: "Builder",   url: "/builder",   icon: Workflow },
  { title: "Templates", url: "/templates", icon: LayoutTemplate, tourId: "nav-templates" },
  { title: "Data",      url: "/data",      icon: Database },
  { title: "Contacts",  url: "/contacts",  icon: BookUser },
  { title: "Leads",     url: "/leads",     icon: UserCheck },
  { title: "Qualified", url: "/qualified", icon: Check },
  { title: "Calls",     url: "/calls",     icon: PhoneCall },
  { title: "Calendar",  url: "/calendar",  icon: CalendarDays },
  { title: "WhatsApp",  url: "/whatsapp",  icon: MessageSquare },
  { title: "Billing",   url: "/billing",   icon: CreditCard },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const currentPath = useRouterState({
    select: (router) => router.location.pathname,
  });
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [profile, adminStatus] = await Promise.all([
          getMyProfile(),
          getMyAdminStatus().catch(() => ({ isAdmin: false })),
        ]);
        if (!active) return;
        const e = profile?.email ?? "";
        setEmail(e);
        setIsAdmin(adminStatus.isAdmin);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const isActive = (path: string) =>
    path === "/builder"
      ? currentPath.startsWith("/builder")
      : currentPath === path || currentPath.startsWith(path + "/");

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", search: { redirect: "/" } });
  };

  const initials = (email || "U").slice(0, 2).toUpperCase();
  const workspaceName = "Webee";

  const navButtonClasses = (active: boolean) =>
    cn(
      "group/nav relative h-9 rounded-lg px-2.5 text-sm transition-all duration-200",
      "text-muted-foreground hover:text-foreground hover:bg-primary/[0.06]",
      "hover:shadow-[0_0_0_1px_rgba(79,140,255,0.08),0_0_18px_-6px_rgba(79,140,255,0.35)]",
      // collapsed: center the icon in a compact square
      "group-data-[collapsible=icon]:!h-9 group-data-[collapsible=icon]:!w-9",
      "group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:justify-center",
      "group-data-[collapsible=icon]:mx-auto",
      active && [
        "text-foreground font-medium bg-primary/[0.08]",
        "shadow-[inset_0_0_0_1px_rgba(79,140,255,0.14),0_0_22px_-8px_rgba(79,140,255,0.35)]",
        // slim left accent line
        "before:content-[''] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2",
        "before:h-5 before:w-[2px] before:rounded-r-full before:bg-primary",
        "group-data-[collapsible=icon]:before:left-[-3px]",
      ],
    );

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        "border-r border-white/[0.06]",
        "bg-[linear-gradient(180deg,hsl(var(--sidebar-background))_0%,hsl(var(--sidebar-background))_100%)]",
        "backdrop-blur-xl",
      )}
    >
      <SidebarHeader className="px-2 pt-3 pb-2 group-data-[collapsible=icon]:px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-all duration-200",
                "hover:bg-white/[0.04]",
                "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
              )}
            >
              <div className="flex h-8 w-8 shrink-0 overflow-hidden rounded-lg">
                <img src="/webee-logo-dark.png" alt="Webee" className="hidden h-8 w-8 object-cover dark:block" />
                <img src="/webee-logo-yellow.png" alt="Webee" className="block h-8 w-8 object-cover dark:hidden" />
              </div>
              {!collapsed && (
                <>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {workspaceName}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {isAdmin ? "Admin · Pro" : "by Webespoke AI"}
                    </span>
                  </div>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:text-foreground" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            <DropdownMenuItem className="gap-2">
              <div className="flex h-7 w-7 overflow-hidden rounded-md">
                <img src="/webee-logo-dark.png" alt="Webee" className="hidden h-7 w-7 object-cover dark:block" />
                <img src="/webee-logo-yellow.png" alt="Webee" className="block h-7 w-7 object-cover dark:hidden" />
              </div>
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium">{workspaceName}</span>
                <span className="text-[11px] text-muted-foreground">Current</span>
              </div>
              <Check className="h-3.5 w-3.5 text-primary" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              Multi-workspace coming soon
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      {/* divider under header */}
      <div className="mx-2 my-1 h-px bg-white/[0.05] group-data-[collapsible=icon]:mx-1.5" />

      <SidebarContent className="px-1.5 pt-2 group-data-[collapsible=icon]:px-1.5">
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              Workspace
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
              {navItems.map((item) => {
                const active = isActive(item.url);
                return (
                  <SidebarMenuItem key={item.url} className="group-data-[collapsible=icon]:w-auto" data-tour={(item as { tourId?: string }).tourId}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className={navButtonClasses(active)}
                    >
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon
                          className={cn(
                            "h-[18px] w-[18px] shrink-0 transition-colors",
                            active
                              ? "text-primary"
                              : "text-muted-foreground group-hover/nav:text-foreground",
                          )}
                        />
                        <span className="truncate group-data-[collapsible=icon]:hidden">
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Telephony ──────────────────────────────────────── */}
        <div className="mx-2 my-3 h-px bg-white/[0.05] group-data-[collapsible=icon]:mx-1.5" />
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              Telephony
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
              {[
                { title: "Phone Numbers",    url: "/phone-numbers",      icon: Phone },
                { title: "Telephony Calls",  url: "/telephony-calls",    icon: PhoneIncoming },
                { title: "Campaigns",        url: "/campaigns",          icon: Megaphone },
                { title: "Telephony Config", url: "/telephony-settings", icon: Settings2 },
              ].map((item) => {
                const active = isActive(item.url);
                return (
                  <SidebarMenuItem key={item.url} className="group-data-[collapsible=icon]:w-auto">
                    <SidebarMenuButton asChild tooltip={item.title} className={navButtonClasses(active)}>
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon
                          className={cn(
                            "h-[18px] w-[18px] shrink-0 transition-colors",
                            active
                              ? "text-primary"
                              : "text-muted-foreground group-hover/nav:text-foreground",
                          )}
                        />
                        <span className="truncate group-data-[collapsible=icon]:hidden">
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <>
            <div className="mx-2 my-3 h-px bg-white/[0.05] group-data-[collapsible=icon]:mx-1.5" />
            <SidebarGroup>
              {!collapsed && (
                <SidebarGroupLabel className="px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                  Administration
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu className="gap-1 group-data-[collapsible=icon]:items-center">
                  <SidebarMenuItem className="group-data-[collapsible=icon]:w-auto">
                    <SidebarMenuButton
                      asChild
                      tooltip="Admin"
                      className={navButtonClasses(isActive("/admin"))}
                    >
                      <Link to="/admin" className="flex items-center gap-3">
                        <ShieldCheck
                          className={cn(
                            "h-[18px] w-[18px] shrink-0",
                            isActive("/admin")
                              ? "text-primary"
                              : "text-muted-foreground group-hover/nav:text-foreground",
                          )}
                        />
                        <span className="truncate group-data-[collapsible=icon]:hidden">Admin</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem className="group-data-[collapsible=icon]:w-auto">
                    <SidebarMenuButton
                      asChild
                      tooltip="User activity"
                      className={navButtonClasses(isActive("/admin/user-activity"))}
                    >
                      <Link to="/admin/user-activity" className="flex items-center gap-3">
                        <Mail
                          className={cn(
                            "h-[18px] w-[18px] shrink-0",
                            isActive("/admin/user-activity")
                              ? "text-primary"
                              : "text-muted-foreground group-hover/nav:text-foreground",
                          )}
                        />
                        <span className="truncate group-data-[collapsible=icon]:hidden">
                          User activity
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <div className="mx-2 mb-1 h-px bg-white/[0.05] group-data-[collapsible=icon]:mx-1.5" />
      <SidebarFooter className="px-1.5 pb-3 group-data-[collapsible=icon]:px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition-all duration-200",
                "hover:bg-white/[0.04]",
                "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
              )}
            >
              <Avatar className="h-8 w-8 ring-1 ring-white/10">
                <AvatarFallback className="bg-gradient-to-br from-primary/30 to-primary/10 text-[11px] font-semibold text-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {email || "Account"}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {isAdmin ? (
                        <Badge
                          variant="secondary"
                          className="h-4 rounded px-1.5 py-0 text-[10px] font-normal"
                        >
                          Admin
                        </Badge>
                      ) : (
                        "Member"
                      )}
                    </span>
                  </div>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="truncate text-xs text-muted-foreground">
              {email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: "/settings/calendar" })}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: "/settings/crm" })}>
              <Settings className="mr-2 h-4 w-4" />
              CRM Integrations
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                restartTour();
                navigate({ to: "/builder" });
              }}
            >
              <MapPin className="mr-2 h-4 w-4" />
              Start Walkthrough Tour
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
