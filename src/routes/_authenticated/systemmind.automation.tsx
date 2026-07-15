import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/systemmind/automation")({
  beforeLoad: () => {
    throw redirect({ to: "/systemmind/build", search: { tab: "automation" } });
  },
});
