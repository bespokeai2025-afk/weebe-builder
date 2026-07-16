import { createFileRoute } from "@tanstack/react-router";
import { SystemMindBuildConsolePage } from "@/components/systemmind/SystemMindBuildConsolePage";

export const Route = createFileRoute("/_authenticated/systemmind/build")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:      (search.tab as string | undefined) || undefined,
    wfTab:    (search.wfTab as string | undefined) || undefined,
    health:   (search.health as string | undefined) || undefined,
    session:  (search.session as string | undefined) || undefined,
    workflow: (search.workflow as string | undefined) || undefined,
    agent:    (search.agent as string | undefined) || undefined,
    convert:  (search.convert as string | undefined) || undefined,
  }),
  head: () => ({ meta: [{ title: "Build Console — SystemMind" }] }),
  component: SystemMindBuildConsolePage,
});
