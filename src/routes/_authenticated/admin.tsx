import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        if (active) navigate({ to: "/login", search: { redirect: "/admin" } });
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("user_type")
        .eq("user_id", sess.session.user.id)
        .maybeSingle();
      if (!active) return;
      if (profile?.user_type !== "admin") {
        navigate({ to: "/dashboard" });
      } else {
        setReady(true);
      }
    })();
    return () => { active = false; };
  }, [navigate]);

  if (!ready) return null;
  return <Outlet />;
}
