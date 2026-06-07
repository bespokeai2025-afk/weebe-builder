import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth/auth.functions";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

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
      try {
        const profile = await getMyProfile();
        if (!active) return;
        if (profile?.denied || !profile?.approved) {
          navigate({ to: "/pending-approval" });
          setChecked(true);
          return;
        }
        setAuthed(true);
        setChecked(true);
      } catch {
        if (active) {
          setChecked(true);
          navigate({ to: "/login" });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [navigate]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!authed) return null;

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
            </div>
          )}
          <Outlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

