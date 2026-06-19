import { createFileRoute } from "@tanstack/react-router";
import { WorkflowEnginePage } from "@/components/workflow-engine/WorkflowEnginePage";

export const Route = createFileRoute("/_authenticated/workflow-engine")({
  head: () => ({ meta: [{ title: "Workflow Engine — Webee" }] }),
  component: WorkflowEnginePage,
});
