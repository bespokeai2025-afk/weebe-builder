import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/systemmind/workflow-drafts")({
  beforeLoad: () => {
    throw redirect({ to: "/systemmind/build", search: { tab: "drafts" } });
  },
});
