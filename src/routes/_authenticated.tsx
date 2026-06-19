import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { OnboardingWelcome } from "@/components/onboarding/OnboardingWelcome";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";
import { HiveMindOrb } from "@/components/hivemind/HiveMindOrb";
import { getOnboardingState } from "@/lib/onboarding/onboarding.server";
import { PrefetchOnLogin } from "@/components/PrefetchOnLogin";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

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
      setAuthed(true);
      setChecked(true);
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen={false}>
      <div className="relative flex min-h-screen w-full bg-background bg-noise">
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
        <SidebarInset className="flex-1 bg-transparent">
          {!hideHeader && (
            <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-white/[0.04] bg-background/60 px-3 backdrop-blur-xl">
              <SidebarTrigger />
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </div>
          )}
          <Outlet />
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
