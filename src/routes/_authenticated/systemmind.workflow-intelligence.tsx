import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SystemMindWorkflowIntelligencePage } from "@/components/systemmind/SystemMindWorkflowIntelligencePage";

export const Route = createFileRoute("/_authenticated/systemmind/workflow-intelligence")({
  beforeLoad: async ({ location }) => {
    // Skip on SSR — server fn middleware (requirePlatformAdmin) handles server-side auth.
    if (typeof window === "undefined") return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("user_type")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (profile?.user_type !== "admin") {
      throw redirect({ to: "/systemmind" });
    }
  },
  component: SystemMindWorkflowIntelligencePage,
});
