import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { checkWebuyanyhouseWorkspace } from "@/lib/integrations/webespokeEnterprise/wbah.functions";
import { WebuyanyhouseLeads } from "@/components/webuyanyhouse/WebuyanyhouseLeads";
import { Building2, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/wbah")({
  head: () => ({ meta: [{ title: "Webuyanyhouse — Leads" }] }),
  component: WebuyanyhouseDash,
});

function WebuyanyhouseDash() {
  const checkFn = useServerFn(checkWebuyanyhouseWorkspace);
  const { data, isLoading } = useQuery({
    queryKey: ["wbah-workspace-check"],
    queryFn:  () => checkFn(),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!data?.isWebuyanyhouse) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4 p-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20">
          <Lock className="h-7 w-7 text-red-400" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          This section is only accessible to the Webuyanyhouse workspace.
          Please log in with the Webuyanyhouse account to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 border border-emerald-500/20">
          <Building2 className="h-4 w-4 text-emerald-500" />
        </div>
        <div>
          <span className="text-sm font-semibold">Webuyanyhouse</span>
          <span className="ml-2 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            Property Seller Qualification
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 max-w-5xl w-full mx-auto">
        <WebuyanyhouseLeads />
      </div>
    </div>
  );
}
