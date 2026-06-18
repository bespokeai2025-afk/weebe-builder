import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/enterprise/webuyanyhouse")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/accounts/clients/webuyanyhouse" });
  },
  component: () => null,
});
