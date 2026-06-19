import { createFileRoute } from "@tanstack/react-router";
import { SystemMindShell } from "@/components/systemmind/SystemMindShell";
import { ClientsOverviewPage } from "@/components/systemmind/clients/ClientsOverviewPage";

export const Route = createFileRoute("/_authenticated/systemmind/clients/")({
  component: ClientsIndexPage,
});

function ClientsIndexPage() {
  return (
    <SystemMindShell>
      <ClientsOverviewPage />
    </SystemMindShell>
  );
}
