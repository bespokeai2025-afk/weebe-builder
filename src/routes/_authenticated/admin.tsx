import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) throw redirect({ to: "/login", search: { redirect: "/admin" } });

    const { data: profile } = await supabase
      .from("profiles")
      .select("user_type")
      .eq("user_id", session.session.user.id)
      .maybeSingle();

    if (profile?.user_type !== "admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return <Outlet />;
}
