import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/systemmind/workflows")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string | undefined) ?? "Library",
    health: (search.health as string | undefined) ?? "all",
  }),
  beforeLoad: ({ search }) => {
    // Old links used ?tab= for the internal Workflow Intelligence tab — remap
    // it to wfTab so it survives inside the console (whose own tab param is
    // the console tab), and keep the health filter.
    throw redirect({
      to: "/systemmind/build",
      search: { tab: "workflows", wfTab: search.tab, health: search.health } as any,
    });
  },
});
