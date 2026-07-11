import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindWorkspaceConfig } from "@/components/accountsmind/AccountsMindWorkspaceConfig";

export const Route = createFileRoute("/_authenticated/admin/accounts/workspace-config")({
  head: () => ({ meta: [{ title: "Workspace Config — AccountsMind" }] }),
  component: AccountsMindWorkspaceConfig,
});
