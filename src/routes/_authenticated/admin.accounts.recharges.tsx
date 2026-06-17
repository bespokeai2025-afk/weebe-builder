import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindRecharges } from "@/components/accountsmind/AccountsMindRecharges";

export const Route = createFileRoute("/_authenticated/admin/accounts/recharges")({
  component: AccountsMindRechargesPage,
});

function AccountsMindRechargesPage() {
  return (
    <AccountsMindShell>
      <AccountsMindRecharges />
    </AccountsMindShell>
  );
}
