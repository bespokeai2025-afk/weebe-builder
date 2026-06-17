import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindCosts } from "@/components/accountsmind/AccountsMindCosts";

export const Route = createFileRoute("/_authenticated/admin/accounts/costs")({
  component: AccountsMindCostsPage,
});

function AccountsMindCostsPage() {
  return (
    <AccountsMindShell>
      <AccountsMindCosts />
    </AccountsMindShell>
  );
}
