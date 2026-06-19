import { createFileRoute } from "@tanstack/react-router";
import { SystemMindShell } from "@/components/systemmind/SystemMindShell";
import { WorkspaceSetupPage } from "@/components/systemmind/clients/WorkspaceSetupPage";

export const Route = createFileRoute("/_authenticated/systemmind/clients/setup")({
  component: SystemMindClientsSetupPage,
});

function SystemMindClientsSetupPage() {
  return (
    <SystemMindShell>
      <WorkspaceSetupPage />
    </SystemMindShell>
  );
}
