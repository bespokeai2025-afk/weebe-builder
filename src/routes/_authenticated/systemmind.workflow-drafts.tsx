import { createFileRoute } from "@tanstack/react-router";
import { WorkflowDraftsPage } from "@/components/systemmind/WorkflowDraftsPage";

export const Route = createFileRoute("/_authenticated/systemmind/workflow-drafts")({
  component: WorkflowDraftsPage,
});
