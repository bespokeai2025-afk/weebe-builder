import { createFileRoute } from "@tanstack/react-router";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { HiveMindWorkflowIntelligence } from "@/components/hivemind/HiveMindWorkflowIntelligence";

export const Route = createFileRoute("/_authenticated/hivemind/workflow-intelligence")({
  head: () => ({ meta: [{ title: "Workflow Intelligence — HiveMind" }] }),
  component: Page,
});

function Page() {
  return (
    <HiveMindShell>
      <HiveMindWorkflowIntelligence />
    </HiveMindShell>
  );
}
