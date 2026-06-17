import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindDashboard } from "@/components/accountsmind/AccountsMindDashboard";

export const Route = createFileRoute("/_authenticated/admin/accounts/")({
  component: AccountsMindIndex,
});

function AccountsMindIndex() {
  return (
    <AccountsMindShell>
      <AccountsMindDashboard />
    </AccountsMindShell>
  );
}
