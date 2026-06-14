import { createFileRoute } from "@tanstack/react-router";
import { SystemMindWorkflowsPage } from "@/components/systemmind/SystemMindWorkflowsPage";

export const Route = createFileRoute("/_authenticated/systemmind/workflows")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string | undefined) ?? "Library",
    health: (search.health as string | undefined) ?? "all",
  }),
  component: SystemMindWorkflowsPage,
});
