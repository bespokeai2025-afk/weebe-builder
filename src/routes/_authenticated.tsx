import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { OnboardingWelcome } from "@/components/onboarding/OnboardingWelcome";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { HiveMindOrb } from "@/components/hivemind/HiveMindOrb";
import { getOnboardingState } from "@/lib/onboarding/onboarding.server";
import { PrefetchOnLogin } from "@/components/PrefetchOnLogin";
import { LockedRouteGuard } from "@/components/shared/LockedRouteGuard";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

// Tracks the authenticated user whose data currently populates the React Query
// cache. Module-level so it persists across route remounts but resets on a full
// page reload (same lifetime as the QueryClient in router.tsx). Acts as a
// belt-and-suspenders boundary: if a different user is detected on this same SPA
// session (any login path), we wipe the cache so no prior account's data is
// served under the shared (non-workspace-keyed) query keys.
let lastAuthUserId: string | null = null;

/**
 * Gates the legacy agent-builder tour so it only shows for:
 * - Users with path "agent_builder" or "both"
 * - Pre-V2 users who have no workspace_onboarding row (null path) — we don't break them
 * Suppressed for "grow"-only onboarding path users.
 */
function GatedOnboardingTour() {
  const getStateFn = useServerFn(getOnboardingState);
  const { data: onboardingState } = useQuery({
    queryKey: ["onboarding-state"],
    queryFn:  () => getStateFn(),
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });

  // Show tour if: no row (legacy user), path is agent_builder or both
  // Hide for grow-only users (they shouldn't see the builder tour)
  if (onboardingState?.path === "grow") return null;

  return <OnboardingTour />;
}

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideHeader = pathname.startsWith("/builder");
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        if (active) {
          setChecked(true);
          navigate({
            to: "/login",
            search: { redirect: window.location.pathname },
          });
        }
        return;
      }
      // Account-isolation boundary: if a different user is now authenticated on
      // this same SPA session, clear cached query data before this layout's
      // children render their queries, so no prior account's data is served.
      const uid = sess.session.user.id;
      if (lastAuthUserId !== null && lastAuthUserId !== uid) {
        qc.clear();
      }
      lastAuthUserId = uid;
      setAuthed(true);
      setChecked(true);
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="relative flex min-h-screen w-full min-w-0 bg-background bg-noise">
        {/* Dashboard depth: soft dotted grid that fades toward the bottom */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-grid-fade opacity-60"
        />
        <AppSidebar />
        {/* Thin blurred divider between sidebar and content */}
        <div
          aria-hidden
          className="pointer-events-none hidden md:block w-px shrink-0 bg-gradient-to-b from-transparent via-white/10 to-transparent backdrop-blur-sm"
        />
        <SidebarInset className="flex min-w-0 flex-1 flex-col overflow-x-hidden bg-transparent">
          {!hideHeader && (
            <div className="sticky top-0 z-30 flex h-10 items-center gap-2 border-b border-white/[0.04] bg-background/60 px-2.5 backdrop-blur-xl">
              <SidebarTrigger />
              <div className="ml-auto flex items-center gap-1">
                <NotificationsBell />
                <ThemeToggle />
              </div>
            </div>
          )}
          <LockedRouteGuard>
            <Outlet />
          </LockedRouteGuard>
        </SidebarInset>
      </div>
      {/* Onboarding V2 — path-selection welcome modal (first login only) */}
      <OnboardingWelcome />
      {/* Legacy builder tour — gated to agent_builder + both paths */}
      <GatedOnboardingTour />
      {/* Progress checklist widget — shown after path is selected */}
      <OnboardingChecklist />
      <HiveMindOrb />
      <PrefetchOnLogin authed={authed} />
    </SidebarProvider>
  );
}
