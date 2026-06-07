import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/")({
  loader: () => {
    throw redirect({ to: "/admin/users" });
  },
});
