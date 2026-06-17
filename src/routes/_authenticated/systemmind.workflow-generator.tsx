import { createFileRoute } from "@tanstack/react-router";
import { WorkflowGeneratorPage } from "@/components/systemmind/WorkflowGeneratorPage";

export const Route = createFileRoute("/_authenticated/systemmind/workflow-generator")({
  component: WorkflowGeneratorPage,
});
