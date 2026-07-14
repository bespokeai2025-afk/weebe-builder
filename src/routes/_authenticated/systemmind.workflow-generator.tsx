import { createFileRoute, redirect } from "@tanstack/react-router";

// The Workflow Generator has been merged into the Build Workspace — its
// "describe a workflow in plain English" flow now lives on /systemmind/build
// as the quick-start panel. Old links/bookmarks land there.
export const Route = createFileRoute("/_authenticated/systemmind/workflow-generator")({
  beforeLoad: () => {
    throw redirect({ to: "/systemmind/build" });
  },
});
