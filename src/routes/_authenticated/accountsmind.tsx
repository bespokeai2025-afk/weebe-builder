import { createFileRoute } from "@tanstack/react-router";
import { ClientAccountsView } from "@/components/accountsmind/ClientAccountsView";

export const Route = createFileRoute("/_authenticated/accountsmind")({
  head: () => ({ meta: [{ title: "Account Dashboard" }] }),
  component: ClientAccountsView,
});
