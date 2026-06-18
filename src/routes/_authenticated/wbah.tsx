/**
 * Webuyanyhouse Workspace Layout Guard
 *
 * Wraps all /wbah/* routes. Verifies the logged-in WEBEE user belongs to the
 * Webuyanyhouse workspace. Non-WBAH users are redirected to /dashboard.
 * Super Admin accounts are NOT redirected here automatically.
 */
import { Outlet } from "@tanstack/react-router";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkWbahWorkspace } from "@/lib/integrations/webespokeEnterprise/wbah-workspace.server";
import { useEffect } from "react";
import { Building2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/wbah")({
  component: WbahLayout,
});

function WbahLayout() {
  const navigate = useNavigate();
  const checkFn = useServerFn(checkWbahWorkspace);

  const { data: wsCheck, isLoading } = useQuery({
    queryKey: ["wbah-workspace-check"],
    queryFn: () => checkFn(),
    staleTime: 120_000,
    retry: 1,
  });

  useEffect(() => {
    if (wsCheck && !wsCheck.isWebuyanyhouse) {
      navigate({ to: "/dashboard" });
    }
  }, [wsCheck, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Building2 className="h-8 w-8 text-emerald-400 animate-pulse" />
          <span className="text-sm">Loading workspace…</span>
        </div>
      </div>
    );
  }

  if (!wsCheck?.isWebuyanyhouse) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
      </div>
    );
  }

  return <Outlet />;
}
