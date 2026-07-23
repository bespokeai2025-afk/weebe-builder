import { useEffect, useState } from "react";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getDbHealthStatus } from "@/lib/maintenance/db-health.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function DbHealthBanner() {
  const fetchStatus = useServerFn(getDbHealthStatus);
  const { data } = useQuery({
    queryKey: ["admin", "db-health-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 60_000,
    throwOnError: false,
    retry: false,
  });

  if (!data || data.status !== "unhealthy") return null;

  const failing = data.services.filter((s) => !s.healthy).map((s) => s.name);
  return (
    <div className="flex items-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Database platform is unhealthy
        {failing.length > 0 ? ` (${failing.join(", ")})` : ""}
        {data.outageStartedAt
          ? ` since ${new Date(data.outageStartedAt).toLocaleTimeString()}`
          : ""}
        . Platform admins have been alerted — check the Supabase dashboard and restart the project if it stays down.
      </span>
    </div>
  );
}

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
  return (
    <>
      <DbHealthBanner />
      <Outlet />
    </>
  );
}
