import { createFileRoute } from "@tanstack/react-router";
import { SystemMindBuildWorkspacePage } from "@/components/systemmind/SystemMindBuildWorkspacePage";

export const Route = createFileRoute("/_authenticated/systemmind/build")({
  validateSearch: (search: Record<string, unknown>) => ({
    session:  (search.session as string | undefined) || undefined,
    workflow: (search.workflow as string | undefined) || undefined,
    agent:    (search.agent as string | undefined) || undefined,
  }),
  head: () => ({ meta: [{ title: "Build Workspace — SystemMind" }] }),
  component: SystemMindBuildWorkspacePage,
});
