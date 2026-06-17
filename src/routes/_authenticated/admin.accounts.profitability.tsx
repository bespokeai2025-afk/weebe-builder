import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindProfitability } from "@/components/accountsmind/AccountsMindProfitability";

export const Route = createFileRoute("/_authenticated/admin/accounts/profitability")({
  component: AccountsMindProfitabilityPage,
});

function AccountsMindProfitabilityPage() {
  return (
    <AccountsMindShell>
      <AccountsMindProfitability />
    </AccountsMindShell>
  );
}
