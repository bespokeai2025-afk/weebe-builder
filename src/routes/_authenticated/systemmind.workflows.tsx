import { createFileRoute } from "@tanstack/react-router";
import { SystemMindWorkflowsPage } from "@/components/systemmind/SystemMindWorkflowsPage";

export const Route = createFileRoute("/_authenticated/systemmind/workflows")({
  component: SystemMindWorkflowsPage,
});
