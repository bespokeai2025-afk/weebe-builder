import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/systemmind/fix-plans")({
  beforeLoad: () => {
    throw redirect({ to: "/systemmind/build", search: { tab: "fix-plans" } });
  },
});
