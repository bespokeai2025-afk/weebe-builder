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
    let sessionEstablished = false;

    const redirectToLogin = () => {
      if (!active) return;
      lastAuthUserId = null;
      qc.clear();
      setAuthed(false);
      setChecked(true);
      navigate({
        to: "/login",
        search: { redirect: window.location.pathname },
        replace: true,
      });
    };

    const acceptSession = (
      session: NonNullable<
        Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]
      >,
    ) => {
      if (!active) return;
      // Account-isolation boundary: if a different user is now authenticated on
      // this same SPA session, clear cached query data before this layout's
      // children render their queries, so no prior account's data is served.
      const uid = session.user.id;
      if (lastAuthUserId !== null && lastAuthUserId !== uid) {
        qc.clear();
      }
      lastAuthUserId = uid;
      sessionEstablished = true;
      setAuthed(true);
      setChecked(true);
    };

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error || !data.session) {
          redirectToLogin();
          return;
        }
        acceptSession(data.session);
      })
      .catch(redirectToLogin);

    // If the session dies mid-use (e.g. the refresh token was revoked or
    // already rotated — surfaces as "Invalid Refresh Token: Refresh Token Not
    // Found"), supabase-js emits SIGNED_OUT. Without this listener the user
    // stays on the page while every data request fails; bounce them cleanly
    // to the sign-in page instead.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        acceptSession(session);
        return;
      }

      // Ignore a stale sign-out notification emitted while Supabase is still
      // restoring local storage. The definitive getSession() result above will
      // redirect if no usable session exists.
      if (event === "SIGNED_OUT" && sessionEstablished) {
        redirectToLogin();
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate, qc]);

  // Do not mount authenticated routes, dashboard queries, or the HiveMind
  // renderer until the session check has completed successfully.
  if (!checked || !authed) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-background"
        aria-busy="true"
      >
        <span className="text-sm text-muted-foreground">Checking your sign-in…</span>
      </main>
    );
  }

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="app-shell-root relative flex min-h-screen w-full min-w-0">
        {/* Dashboard depth: soft dotted grid that fades toward the bottom */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-grid-fade opacity-60"
        />
        <AppSidebar />
        {/* Soft divider between sidebar and content */}
        <div
          aria-hidden
          className="app-shell-divider pointer-events-none hidden md:block w-px shrink-0"
        />
        <SidebarInset className="app-shell-main flex min-w-0 flex-1 flex-col overflow-x-hidden">
          {!hideHeader && (
            <div className="app-shell-header sticky top-0 z-30 flex h-10 items-center gap-2 px-2.5">
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
