/**
 * WBAH workspace — post-call workflow builder (n8n-style self-service in SystemMind).
 */
import { Link } from "@tanstack/react-router";
import { Workflow, AlertTriangle } from "lucide-react";
import { SystemMindShell } from "@/components/systemmind/SystemMindShell";
import { WbahPostCallHub } from "@/components/wbah/WbahPostCallHub";
import { useIsWbahWorkspace } from "@/hooks/useIsWbahWorkspace";
import { Button } from "@/components/ui/button";

export function WbahPostCallWorkflowsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { isWbah, resolved } = useIsWbahWorkspace();

  if (resolved && !isWbah && !embedded) {
    return (
      <SystemMindShell>
        <div className="p-6 max-w-lg space-y-3">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">Webuyanyhouse workspace required</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Post-call workflow builder is only available when your active workspace is Webuyanyhouse.
            Switch workspace from the sidebar, then return here.
          </p>
          <Button size="sm" variant="outline" asChild>
            <Link to="/systemmind">Back to SystemMind</Link>
          </Button>
        </div>
      </SystemMindShell>
    );
  }

  const body = (
    <div className={embedded ? "px-4 py-3 md:px-5" : "p-4 md:p-5"}>
      {!embedded && (
        <div className="flex items-center gap-2 mb-4">
          <Workflow className="h-5 w-5 text-violet-400 shrink-0" />
          <h1 className="text-base font-semibold">Post-Call Workflows</h1>
        </div>
      )}
      <WbahPostCallHub />
    </div>
  );

  if (embedded) return body;

  return <SystemMindShell>{body}</SystemMindShell>;
}
