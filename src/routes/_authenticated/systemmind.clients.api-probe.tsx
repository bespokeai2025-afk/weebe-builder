import { createFileRoute } from "@tanstack/react-router";
import { SystemMindShell } from "@/components/systemmind/SystemMindShell";
import { ApiProbePage } from "@/components/systemmind/clients/api-probe/ApiProbePage";

export const Route = createFileRoute("/_authenticated/systemmind/clients/api-probe")({
  component: SystemMindApiProbePage,
});

function SystemMindApiProbePage() {
  return (
    <SystemMindShell>
      <ApiProbePage />
    </SystemMindShell>
  );
}
